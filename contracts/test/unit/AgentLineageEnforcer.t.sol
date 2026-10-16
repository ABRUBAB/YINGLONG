// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Delegation } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { LineageViolation, InvalidTerms, InvalidExecutionMode } from "../../src/utils/Errors.sol";

/// @notice AgentLineageEnforcer: the redeemer must be an ACTIVE passport bound to the sealed owner DID, or the
/// facilitator pinned in the terms.
contract AgentLineageEnforcerTest is CoverageBase {
    function _terms(bytes32 _did, address _facilitator) internal view returns (bytes memory) {
        return abi.encode(address(passports), _did, _facilitator);
    }

    function _hook(bytes memory _t, address _redeemer) internal view {
        lineageE.beforeHook(_t, "", singleMode, "", DH, address(nadia), _redeemer);
    }

    function test_getTermsInfo_decodesAndChecksLength() public {
        (address r_, bytes32 did_, address f_) = lineageE.getTermsInfo(_terms(nadiaDid, mirage));
        assertEq(r_, address(passports));
        assertEq(did_, nadiaDid);
        assertEq(f_, mirage);
        vm.expectRevert(InvalidTerms.selector);
        lineageE.getTermsInfo(abi.encode(address(passports), nadiaDid));
        vm.expectRevert(InvalidTerms.selector);
        lineageE.getTermsInfo(abi.encodePacked(_terms(nadiaDid, address(0)), bytes1(0)));
    }

    function test_nonSingleDefaultMode_reverts() public {
        bytes memory t_ = _terms(nadiaDid, address(0));
        vm.expectRevert(InvalidExecutionMode.selector);
        lineageE.beforeHook(t_, "", batchMode, "", DH, address(nadia), ying);
    }

    function test_activePassportWithSealedDidPasses() public {
        _hook(_terms(nadiaDid, address(0)), ying);
    }

    function test_subAgentOfSamePrincipalPasses() public {
        (address sub_, uint256 subKey_) = makeAddrAndKey("ying-sub-agent");
        _registerPassport(sub_, subKey_, nadiaDid, "YL-TEST-0002");
        _hook(_terms(nadiaDid, address(0)), sub_);
    }

    function test_passportOfAnotherPrincipal_reverts() public {
        // Pearl River holds an active, attested passport, but bound to its own DID.
        bytes memory t_ = _terms(nadiaDid, address(0));
        vm.expectRevert(abi.encodeWithSelector(LineageViolation.selector, pearlRiver));
        _hook(t_, pearlRiver);
    }

    function test_wrongSealedDid_reverts() public {
        bytes memory t_ = _terms(keccak256("did:example:someone-else"), address(0));
        vm.expectRevert(abi.encodeWithSelector(LineageViolation.selector, ying));
        _hook(t_, ying);
    }

    function test_haltedPassport_reverts() public {
        vm.prank(supervisor);
        passports.supervisorSetStatus(yingAgentId, true);
        bytes memory t_ = _terms(nadiaDid, address(0));
        vm.expectRevert(abi.encodeWithSelector(LineageViolation.selector, ying));
        _hook(t_, ying);
    }

    function test_revokedPassport_reverts() public {
        vm.prank(agentOwner);
        passports.revoke(yingAgentId);
        bytes memory t_ = _terms(nadiaDid, address(0));
        vm.expectRevert(abi.encodeWithSelector(LineageViolation.selector, ying));
        _hook(t_, ying);
    }

    function test_rotatedOutWallet_reverts() public {
        (address newYing_, uint256 newKey_) = makeAddrAndKey("ying-rotated");
        uint256 dl_ = block.timestamp + 1 hours;
        bytes memory sig_ = _ecdsa(newKey_, passports.bindWalletDigest(yingAgentId, agentOwner, newYing_, dl_));
        vm.prank(agentOwner);
        passports.setAgentWallet(yingAgentId, newYing_, dl_, sig_);
        bytes memory t_ = _terms(nadiaDid, address(0));
        vm.expectRevert(abi.encodeWithSelector(LineageViolation.selector, ying));
        _hook(t_, ying);
        _hook(t_, newYing_);
    }

    function test_pinnedFacilitatorPassesWithoutPassport_othersDoNot() public {
        bytes memory t_ = _terms(nadiaDid, mirage);
        _hook(t_, mirage);
        address stranger_ = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(LineageViolation.selector, stranger_));
        _hook(t_, stranger_);
    }

    function test_zeroFacilitatorIsNotAWildcardForTheZeroAddress() public {
        bytes memory t_ = _terms(nadiaDid, address(0));
        vm.expectRevert(abi.encodeWithSelector(LineageViolation.selector, address(0)));
        _hook(t_, address(0));
    }

    function test_redeem_pinnedFacilitatorRedeemsThroughDelegationManager() public {
        Delegation memory d_ = _signed(_delegation(address(nadia), mirage, _one(address(lineageE), _terms(nadiaDid, mirage)), 701));
        _redeem(mirage, d_, _transferCall(address(tHKD), foodMart, 3 * U));
        assertEq(tHKD.balanceOf(foodMart), 3 * U);

        Delegation memory d2_ = _signed(_delegation(address(nadia), mirage, _one(address(lineageE), _terms(nadiaDid, address(0))), 702));
        vm.expectRevert(abi.encodeWithSelector(LineageViolation.selector, mirage));
        _redeem(mirage, d2_, _transferCall(address(tHKD), foodMart, 3 * U));
    }
}
