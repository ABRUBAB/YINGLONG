// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { Delegation } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { Categories } from "../../src/utils/Categories.sol";
import { ForbiddenTarget, InvalidTerms, InvalidExecutionMode } from "../../src/utils/Errors.sol";

/// @notice ForbiddenTargetsEnforcer: the delegator, the calling DelegationManager and every listed address are
/// unreachable; terms are packed 20-byte addresses.
contract ForbiddenTargetsEnforcerTest is CoverageBase {
    function _call(address _target) internal pure returns (bytes memory) {
        return ExecutionLib.encodeSingle(_target, 0, abi.encodeWithSelector(TRANSFER_SEL, address(1), 1));
    }

    function _hook(bytes memory _terms, address _target) internal {
        forbiddenE.beforeHook(_terms, "", singleMode, _call(_target), DH, address(nadia), ying);
    }

    // ------------------------------------------------------------------ terms

    function test_getTermsInfo_decodesPackedList() public {
        address[] memory f_ = forbiddenE.getTermsInfo(_forbiddenList());
        assertEq(f_.length, 8);
        assertEq(f_[0], address(dm));
        assertEq(f_[2], address(payeeBook));
        assertEq(f_[7], address(products));
    }

    function test_getTermsInfo_emptyListIsValid() public {
        assertEq(forbiddenE.getTermsInfo("").length, 0);
    }

    function test_getTermsInfo_notAMultipleOf20_reverts() public {
        vm.expectRevert(InvalidTerms.selector);
        forbiddenE.getTermsInfo(abi.encodePacked(address(1), bytes1(0)));
        vm.expectRevert(InvalidTerms.selector);
        forbiddenE.getTermsInfo(abi.encodePacked(bytes19(0)));
    }

    function test_beforeHook_malformedTerms_reverts() public {
        vm.expectRevert(InvalidTerms.selector);
        vm.prank(address(dm));
        _hook(abi.encodePacked(address(1), bytes1(0)), address(tHKD));
    }

    function test_beforeHook_batchOrTryMode_reverts() public {
        vm.expectRevert(InvalidExecutionMode.selector);
        vm.prank(address(dm));
        forbiddenE.beforeHook(_forbiddenList(), "", batchMode, _call(address(tHKD)), DH, address(nadia), ying);
        vm.expectRevert(InvalidExecutionMode.selector);
        vm.prank(address(dm));
        forbiddenE.beforeHook(_forbiddenList(), "", tryMode, _call(address(tHKD)), DH, address(nadia), ying);
    }

    // ------------------------------------------------------------------ rules

    function test_delegatorItselfIsAlwaysForbidden() public {
        vm.expectRevert(abi.encodeWithSelector(ForbiddenTarget.selector, address(nadia)));
        vm.prank(address(dm));
        _hook("", address(nadia));
    }

    function test_callingDelegationManagerIsAlwaysForbidden() public {
        // Not listed in the terms: refused because it is msg.sender.
        vm.expectRevert(abi.encodeWithSelector(ForbiddenTarget.selector, address(dm)));
        vm.prank(address(dm));
        _hook("", address(dm));
    }

    function test_otherDelegationManagerIsOnlyForbiddenWhenListed() public {
        // msg.sender is dm2, so dm is just another address: allowed with empty terms, refused when listed.
        vm.prank(address(dm2));
        _hook("", address(dm));
        vm.expectRevert(abi.encodeWithSelector(ForbiddenTarget.selector, address(dm)));
        vm.prank(address(dm2));
        _hook(abi.encodePacked(address(dm)), address(dm));
    }

    function test_firstAndLastListedTargetsAreForbidden() public {
        bytes memory terms_ = _forbiddenList();
        vm.expectRevert(abi.encodeWithSelector(ForbiddenTarget.selector, address(dm)));
        vm.prank(address(dm2));
        _hook(terms_, address(dm));
        vm.expectRevert(abi.encodeWithSelector(ForbiddenTarget.selector, address(products)));
        vm.prank(address(dm));
        _hook(terms_, address(products));
    }

    function test_unlistedTargetPasses() public {
        vm.prank(address(dm));
        _hook(_forbiddenList(), address(tHKD));
    }

    function testFuzz_everyListedTargetIsRefused(uint8 _i) public {
        address[] memory f_ = forbiddenE.getTermsInfo(_forbiddenList());
        address target_ = f_[bound(_i, 0, f_.length - 1)];
        bytes memory terms_ = _forbiddenList();
        vm.expectRevert(abi.encodeWithSelector(ForbiddenTarget.selector, target_));
        vm.prank(address(dm2));
        _hook(terms_, target_);
    }

    // ------------------------------------------------------------------ through the DelegationManager

    function test_redeem_listedRegistryIsUnreachable_paymentPasses() public {
        Delegation memory d_ = _signed(_delegation(address(nadia), ying, _one(address(forbiddenE), _forbiddenList()), 501));
        // A call into the payee book (a T3 action) is refused...
        bytes memory exec_ = ExecutionLib.encodeSingle(
            address(payeeBook), 0, abi.encodeWithSignature("setPayee(address,uint32,bytes32)", mirage, Categories.FOOD, bytes32(0))
        );
        vm.expectRevert(abi.encodeWithSelector(ForbiddenTarget.selector, address(payeeBook)));
        _redeem(ying, d_, exec_);
        (bool active_,) = payeeBook.lookup(address(nadia), mirage);
        assertFalse(active_);
        // ...while a payment through an unlisted asset passes.
        _redeem(ying, d_, _transferCall(address(tHKD), foodMart, 7 * U));
        assertEq(tHKD.balanceOf(foodMart), 7 * U);
    }
}
