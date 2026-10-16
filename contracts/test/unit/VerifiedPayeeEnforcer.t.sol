// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { CoverageBase } from "./CoverageBase.sol";
import { PayeeNotVerified, InvalidTerms, InvalidExecutionMode, NativeValueNotAllowed } from "../../src/utils/Errors.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";

/// @notice VerifiedPayeeEnforcer: the beneficiary must be an active payee of the delegator's book or an active
/// agent attested by a sealed issuer; a rail contract between them must be a sealed intermediary.
contract VerifiedPayeeEnforcerTest is CoverageBase {
    uint256 internal deskId;

    function setUp() public override {
        super.setUp();
        deskId = passports.agentIdOf(pearlRiver);
    }

    function _terms(address[] memory _issuers, address[] memory _intermediaries) internal view returns (bytes memory) {
        return abi.encode(address(payeeBook), address(passports), _issuers, _intermediaries);
    }

    function _std() internal view returns (bytes memory) {
        return _terms(_a2(issuerHbu, issuerBank), _a2(address(escrow), address(quotes)));
    }

    function _hook(bytes memory _t, bytes memory _exec) internal view {
        payeeE.beforeHook(_t, "", singleMode, _exec, DH, address(nadia), ying);
    }

    function _escrowData(address _payee) internal view returns (bytes memory) {
        return abi.encode(_payee, keccak256("cond"), issuerHbu, uint64(block.timestamp + 1 days));
    }

    // ------------------------------------------------------------------ terms and modes

    function test_getTermsInfo_decodesAndChecksLength() public {
        (address book_, address pp_, address[] memory iss_, address[] memory mid_) = payeeE.getTermsInfo(_std());
        assertEq(book_, address(payeeBook));
        assertEq(pp_, address(passports));
        assertEq(iss_.length, 2);
        assertEq(mid_[1], address(quotes));
        bytes memory min_ = _terms(new address[](0), new address[](0));
        assertEq(min_.length, 192);
        payeeE.getTermsInfo(min_);
        vm.expectRevert(InvalidTerms.selector);
        payeeE.getTermsInfo(abi.encode(address(payeeBook), address(passports)));
    }

    function test_nonSingleDefaultMode_reverts() public {
        bytes memory t_ = _std();
        bytes memory e_ = _transferCall(address(tHKD), harbourHomes, 1);
        vm.expectRevert(InvalidExecutionMode.selector);
        payeeE.beforeHook(t_, "", tryMode, e_, DH, address(nadia), ying);
    }

    function test_nativeValue_reverts() public {
        bytes memory t_ = _std();
        bytes memory e_ = ExecutionLib.encodeSingle(harbourHomes, 1 ether, "");
        vm.expectRevert(abi.encodeWithSelector(NativeValueNotAllowed.selector, 1 ether));
        _hook(t_, e_);
    }

    // ------------------------------------------------------------------ payee book

    function test_activePayeeOfTheDelegatorPasses() public {
        _hook(_std(), _transferCall(address(tHKD), harbourHomes, 9_500 * U));
    }

    function test_removedPayee_reverts() public {
        vm.prank(address(nadia));
        payeeBook.removePayee(foodMart);
        bytes memory t_ = _std();
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, foodMart));
        _hook(t_, _transferCall(address(tHKD), foodMart, 1));
    }

    function test_anotherAccountsPayeeBookDoesNotCount() public {
        bytes memory t_ = _std();
        bytes memory e_ = _transferCall(address(tHKD), harbourHomes, 1);
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, harbourHomes));
        payeeE.beforeHook(t_, "", singleMode, e_, DH, mirage, ying);
    }

    // ------------------------------------------------------------------ attested agents

    function test_attestedAgentOfSealedIssuerPasses() public {
        _hook(_terms(_a1(issuerBank), new address[](0)), _transferCall(address(tHKD), pearlRiver, 1));
    }

    function test_attestedAgent_noTrustedIssuersSealed_reverts() public {
        bytes memory t_ = _terms(new address[](0), new address[](0));
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, pearlRiver));
        _hook(t_, _transferCall(address(tHKD), pearlRiver, 1));
    }

    function test_attestedAgent_byUnsealedIssuer_reverts() public {
        bytes memory t_ = _terms(_a1(issuerHbu), new address[](0));
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, pearlRiver));
        _hook(t_, _transferCall(address(tHKD), pearlRiver, 1));
    }

    function test_attestationRevoked_reverts() public {
        vm.prank(issuerBank);
        passports.revokeAttestation(deskId);
        bytes memory t_ = _std();
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, pearlRiver));
        _hook(t_, _transferCall(address(tHKD), pearlRiver, 1));
    }

    function test_attestationExpired_reverts() public {
        vm.prank(issuerBank);
        passports.attest(deskId, keccak256("KYB-verified FX desk"), uint64(block.timestamp + 1 hours));
        bytes memory t_ = _std();
        _hook(t_, _transferCall(address(tHKD), pearlRiver, 1));
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, pearlRiver));
        _hook(t_, _transferCall(address(tHKD), pearlRiver, 1));
    }

    function test_haltedAgent_reverts() public {
        vm.prank(supervisor);
        passports.supervisorSetStatus(deskId, true);
        bytes memory t_ = _std();
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, pearlRiver));
        _hook(t_, _transferCall(address(tHKD), pearlRiver, 1));
    }

    // ------------------------------------------------------------------ intermediaries

    function test_sealedIntermediaryToVerifiedPayeePasses() public {
        _hook(_std(), _tac(address(tHKD), address(escrow), 100, _escrowData(hbuBursar)));
    }

    function test_unsealedIntermediary_revertsWithIntermediary() public {
        // The beneficiary is verified, but the escrow is not a sealed intermediary.
        bytes memory t_ = _terms(_a1(issuerBank), _a1(address(quotes)));
        bytes memory e_ = _tac(address(tHKD), address(escrow), 100, _escrowData(hbuBursar));
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, address(escrow)));
        _hook(t_, e_);
    }

    function test_sealedIntermediaryToUnverifiedPayee_revertsWithPayee() public {
        bytes memory t_ = _std();
        bytes memory e_ = _tac(address(tHKD), address(escrow), 100, _escrowData(mirage));
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, mirage));
        _hook(t_, e_);
    }

    function test_directSubscriptionToBookedFundNeedsNoIntermediary() public {
        // transferAndCall with empty data: beneficiary == recipient == the fund, which is in the book.
        _hook(_terms(new address[](0), new address[](0)), _tac(address(tHKD), address(fundLow), 100, ""));
    }
}
