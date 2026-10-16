// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Delegation } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { Paused, InvalidTerms, InvalidExecutionMode } from "../../src/utils/Errors.sol";

/// @notice GlobalPauseEnforcer: kill switch (account trip, dead-man timer, supervisor agent halt) and the
/// redeemer's passport status, checked in beforeAllHook.
contract GlobalPauseEnforcerTest is CoverageBase {
    bytes32 internal constant M = keccak256("mandate:pause");

    function _terms() internal view returns (bytes memory) {
        return abi.encode(address(killSwitch), address(passports));
    }

    function _hook(bytes memory _t, address _redeemer) internal {
        pauseE.beforeAllHook(_t, "", singleMode, _transferCall(address(tHKD), foodMart, 1), DH, address(nadia), _redeemer);
    }

    function test_getTermsInfo_decodesAndChecksLength() public {
        (address ks_, address pp_) = pauseE.getTermsInfo(_terms());
        assertEq(ks_, address(killSwitch));
        assertEq(pp_, address(passports));
        vm.expectRevert(InvalidTerms.selector);
        pauseE.getTermsInfo(abi.encodePacked(_terms(), bytes1(0)));
        vm.expectRevert(InvalidTerms.selector);
        pauseE.getTermsInfo(abi.encode(address(killSwitch)));
    }

    function test_malformedTerms_reverts() public {
        bytes memory t_ = abi.encode(address(killSwitch));
        vm.expectRevert(InvalidTerms.selector);
        _hook(t_, ying);
    }

    function test_nonSingleDefaultMode_reverts() public {
        bytes memory t_ = _terms();
        bytes memory e_ = _transferCall(address(tHKD), foodMart, 1);
        vm.expectRevert(InvalidExecutionMode.selector);
        pauseE.beforeAllHook(t_, "", batchMode, e_, DH, address(nadia), ying);
        vm.expectRevert(InvalidExecutionMode.selector);
        pauseE.beforeAllHook(t_, "", tryMode, e_, DH, address(nadia), ying);
    }

    function test_activeAgentOfUnpausedAccountPasses() public {
        _hook(_terms(), ying);
    }

    function test_accountTripped_reverts() public {
        vm.prank(guardian);
        killSwitch.trip(address(nadia));
        bytes memory t_ = _terms();
        vm.expectRevert(abi.encodeWithSelector(Paused.selector, address(nadia), ying));
        _hook(t_, ying);
    }

    function test_agentHaltedBySupervisor_reverts() public {
        vm.prank(supervisor);
        killSwitch.setAgentHalt(ying, true);
        bytes memory t_ = _terms();
        vm.expectRevert(abi.encodeWithSelector(Paused.selector, address(nadia), ying));
        _hook(t_, ying);
        vm.prank(supervisor);
        killSwitch.setAgentHalt(ying, false);
        _hook(t_, ying);
    }

    function test_passportHalted_reverts_unlessNoPassportRegistryIsSealed() public {
        vm.prank(supervisor);
        passports.supervisorSetStatus(yingAgentId, true);
        bytes memory t_ = _terms();
        vm.expectRevert(abi.encodeWithSelector(Paused.selector, address(nadia), ying));
        _hook(t_, ying);
        // With no passport registry in the terms only the kill switch is consulted.
        _hook(abi.encode(address(killSwitch), address(0)), ying);
    }

    function test_passportRevoked_reverts() public {
        vm.prank(agentOwner);
        passports.revoke(yingAgentId);
        bytes memory t_ = _terms();
        vm.expectRevert(abi.encodeWithSelector(Paused.selector, address(nadia), ying));
        _hook(t_, ying);
    }

    function test_redeemerWithoutPassportIsNotPausedHere() public {
        // Lineage is AgentLineageEnforcer's job; the pause rule only refuses a passport that exists and is not active.
        _hook(_terms(), mirage);
    }

    function test_redeem_deadmanTimerExpiryPausesThenHeartbeatResumes() public {
        Delegation memory d_ = _sealNadia(M, 1, 601);
        vm.prank(address(nadia));
        killSwitch.setDeadman(1 days);
        vm.warp(block.timestamp + 1 days);
        _redeem(ying, d_, _transferCall(address(tHKD), foodMart, 10 * U)); // exactly at the deadline: still live
        vm.warp(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(Paused.selector, address(nadia), ying));
        _redeem(ying, d_, _transferCall(address(tHKD), foodMart, 10 * U));
        vm.prank(address(nadia));
        killSwitch.heartbeat();
        _redeem(ying, d_, _transferCall(address(tHKD), foodMart, 10 * U));
        assertEq(tHKD.balanceOf(foodMart), 20 * U);
    }
}
