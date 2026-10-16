// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Delegation } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { ReserveFloorBreached, InvalidTerms, InvalidExecutionMode } from "../../src/utils/Errors.sol";

/// @notice ReserveFloorEnforcer: beforeHook validates mode and terms; afterAllHook refuses a final balance below
/// the floor (also on the coin-free rail, where balanceOf is the posted balance net of pending instructions).
contract ReserveFloorEnforcerTest is CoverageBase {
    address internal alice = makeAddr("alice-floor");

    function _after(bytes memory _t, address _delegator) internal view {
        floorE.afterAllHook(_t, "", singleMode, "", DH, _delegator, ying);
    }

    function test_getTermsInfo_decodesAndChecksLength() public {
        (address a_, uint256 f_) = floorE.getTermsInfo(abi.encode(address(tHKD), 1_500 * U));
        assertEq(a_, address(tHKD));
        assertEq(f_, 1_500 * U);
        vm.expectRevert(InvalidTerms.selector);
        floorE.getTermsInfo(abi.encode(address(tHKD)));
        vm.expectRevert(InvalidTerms.selector);
        floorE.getTermsInfo(abi.encode(address(tHKD), 1, 2));
    }

    function test_beforeHook_checksModeAndTerms() public {
        bytes memory good_ = abi.encode(address(tHKD), 1);
        floorE.beforeHook(good_, "", singleMode, "", DH, alice, ying);
        vm.expectRevert(InvalidExecutionMode.selector);
        floorE.beforeHook(good_, "", batchMode, "", DH, alice, ying);
        vm.expectRevert(InvalidTerms.selector);
        floorE.beforeHook(abi.encode(address(tHKD)), "", singleMode, "", DH, alice, ying);
    }

    function test_afterAllHook_malformedTerms_reverts() public {
        vm.expectRevert(InvalidTerms.selector);
        _after(abi.encode(address(tHKD)), alice);
    }

    function test_exactlyAtFloorPasses_oneBelowReverts() public {
        tHKD.mint(alice, 1_500 * U);
        _after(abi.encode(address(tHKD), 1_500 * U), alice);
        bytes memory t_ = abi.encode(address(tHKD), 1_500 * U + 1);
        vm.expectRevert(abi.encodeWithSelector(ReserveFloorBreached.selector, address(tHKD), 1_500 * U, 1_500 * U + 1));
        _after(t_, alice);
    }

    function test_zeroFloorAlwaysPasses() public {
        _after(abi.encode(address(tHKD), 0), alice);
    }

    function test_coinFreeRail_floorIsNetOfPendingInstructions() public {
        cpi.postBalance(alice, 1_000, keccak256("stmt"));
        vm.prank(alice);
        cpi.instruct(harbourHomes, 300, keccak256("p"), keccak256("c"), uint64(block.timestamp + 1 days));
        _after(abi.encode(address(cpi), 700), alice);
        bytes memory t_ = abi.encode(address(cpi), 701);
        vm.expectRevert(abi.encodeWithSelector(ReserveFloorBreached.selector, address(cpi), 700, 701));
        _after(t_, alice);
    }

    function testFuzz_floorHolds(uint256 _balance, uint256 _floor) public {
        _balance = bound(_balance, 0, 1e30);
        tHKD.mint(alice, _balance);
        bytes memory t_ = abi.encode(address(tHKD), _floor);
        if (_balance < _floor) {
            vm.expectRevert(abi.encodeWithSelector(ReserveFloorBreached.selector, address(tHKD), _balance, _floor));
        }
        _after(t_, alice);
    }

    function test_redeem_paymentLandingExactlyOnFloorPasses_nextUnitRefused() public {
        Delegation memory d_ = _sealNadia(keccak256("mandate:floor"), 1, 1201);
        vm.prank(address(nadia));
        tHKD.transfer(address(0xdead), 18_000 * U); // Nadia keeps 2,000
        _redeem(ying, d_, _transferCall(address(tHKD), foodMart, 500 * U));
        assertEq(tHKD.balanceOf(address(nadia)), 1_500 * U);
        vm.expectRevert(abi.encodeWithSelector(ReserveFloorBreached.selector, address(tHKD), 1_500 * U - 1, 1_500 * U));
        _redeem(ying, d_, _transferCall(address(tHKD), foodMart, 1));
    }
}
