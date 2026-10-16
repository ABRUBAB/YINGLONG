// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Delegation } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { VetoTimelockEnforcer } from "../../src/enforcers/VetoTimelockEnforcer.sol";
import {
    VetoWindowOpen,
    Vetoed,
    NotScheduled,
    InvalidTerms,
    InvalidSignature,
    SignatureExpired,
    Unauthorized,
    InvalidExecutionMode
} from "../../src/utils/Errors.sol";

/// @notice VetoTimelockEnforcer: announce (schedule), wait out the veto window, redeem once; the delegator vetoes
/// directly or with a relayed signature. Schedules are keyed by (DelegationManager, delegation, execution).
contract VetoTimelockEnforcerTest is CoverageBase {
    event Scheduled(
        address indexed delegationManager,
        bytes32 indexed delegationHash,
        bytes32 indexed executionHash,
        address delegator,
        address scheduler,
        uint64 scheduledAt
    );
    event VetoRecorded(address indexed delegationManager, bytes32 indexed delegationHash, bytes32 indexed executionHash);
    event ScheduleConsumed(address indexed delegationManager, bytes32 indexed delegationHash, bytes32 indexed executionHash);

    uint256 internal constant WINDOW = 1 hours;
    address internal alice;
    uint256 internal aliceKey;
    bytes internal execution;
    bytes32 internal eh;

    function setUp() public override {
        super.setUp();
        vm.warp(1_760_000_000);
        (alice, aliceKey) = makeAddrAndKey("alice-veto");
        execution = _transferCall(address(tHKD), foodMart, 10 * U);
        eh = keccak256(execution);
    }

    function _schedule() internal {
        vm.prank(ying);
        vetoE.schedule(address(dm), DH, alice, execution);
    }

    function _hookAs(address _dm, address _delegator, address _redeemer) internal {
        bytes memory t_ = abi.encode(WINDOW);
        bytes memory e_ = execution;
        vm.prank(_dm);
        vetoE.beforeHook(t_, "", singleMode, e_, DH, _delegator, _redeemer);
    }

    function _stored() internal view returns (address scheduler_, address delegator_, uint64 at_, bool vetoed_) {
        (scheduler_, delegator_, at_, vetoed_) = vetoE.schedules(vetoE.scheduleKey(address(dm), DH, eh));
    }

    // ------------------------------------------------------------------ terms, keys, digest

    function test_getTermsInfo_decodesAndChecksLength() public {
        assertEq(vetoE.getTermsInfo(abi.encode(WINDOW)), WINDOW);
        vm.expectRevert(InvalidTerms.selector);
        vetoE.getTermsInfo(abi.encodePacked(bytes31(0)));
        vm.expectRevert(InvalidTerms.selector);
        vetoE.getTermsInfo(abi.encode(WINDOW, WINDOW));
    }

    function test_scheduleKeyAndVetoDigest_areRecomputable() public {
        assertEq(vetoE.scheduleKey(address(dm), DH, eh), keccak256(abi.encode(address(dm), DH, eh)));
        assertEq(
            vetoE.VETO_TYPEHASH(),
            keccak256("Veto(address delegationManager,bytes32 delegationHash,bytes32 executionHash,uint256 deadline)")
        );
        bytes32 domain_ = _domain("YINGLONG Veto Timelock", address(vetoE), SALT);
        assertEq(vetoE.domainSeparator(), domain_);
        bytes32 struct_ = keccak256(abi.encode(vetoE.VETO_TYPEHASH(), address(dm), DH, eh, uint256(123)));
        assertEq(vetoE.vetoDigest(address(dm), DH, eh, 123), _typed(domain_, struct_));
    }

    function test_nonSingleDefaultMode_reverts() public {
        _schedule();
        vm.warp(block.timestamp + WINDOW);
        bytes memory t_ = abi.encode(WINDOW);
        bytes memory e_ = execution;
        vm.expectRevert(InvalidExecutionMode.selector);
        vm.prank(address(dm));
        vetoE.beforeHook(t_, "", tryMode, e_, DH, alice, ying);
    }

    // ------------------------------------------------------------------ schedule and consume

    function test_schedule_recordsAndEmits_secondScheduleReverts() public {
        vm.expectEmit(true, true, true, true, address(vetoE));
        emit Scheduled(address(dm), DH, eh, alice, ying, uint64(block.timestamp));
        _schedule();
        (address s_, address d_, uint64 at_, bool v_) = _stored();
        assertEq(s_, ying);
        assertEq(d_, alice);
        assertEq(at_, block.timestamp);
        assertFalse(v_);

        vm.expectRevert(VetoTimelockEnforcer.AlreadyScheduled.selector);
        vm.prank(alice);
        vetoE.schedule(address(dm), DH, alice, execution);
    }

    function test_unscheduledExecution_reverts() public {
        vm.expectRevert(NotScheduled.selector);
        _hookAs(address(dm), alice, ying);
    }

    function test_windowBoundary_thenConsumedOnce() public {
        _schedule();
        uint64 readyAt_ = uint64(block.timestamp + WINDOW);
        vm.expectRevert(abi.encodeWithSelector(VetoWindowOpen.selector, readyAt_));
        _hookAs(address(dm), alice, ying);
        vm.warp(readyAt_ - 1);
        vm.expectRevert(abi.encodeWithSelector(VetoWindowOpen.selector, readyAt_));
        _hookAs(address(dm), alice, ying);

        vm.warp(readyAt_);
        vm.expectEmit(true, true, true, true, address(vetoE));
        emit ScheduleConsumed(address(dm), DH, eh);
        _hookAs(address(dm), alice, ying);
        (,, uint64 at_,) = _stored();
        assertEq(at_, 0);

        vm.expectRevert(NotScheduled.selector);
        _hookAs(address(dm), alice, ying);
    }

    function test_onlyTheSchedulerMayRedeem() public {
        _schedule();
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(NotScheduled.selector);
        _hookAs(address(dm), alice, mirage);
    }

    function test_delegatorMustMatchTheSchedule() public {
        _schedule();
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(NotScheduled.selector);
        _hookAs(address(dm), address(nadia), ying);
    }

    function test_schedulesAreKeyedByDelegationManager() public {
        _schedule();
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(NotScheduled.selector);
        _hookAs(address(dm2), alice, ying);
        _hookAs(address(dm), alice, ying);
    }

    function test_scheduleIsBoundToTheExactExecution() public {
        _schedule();
        vm.warp(block.timestamp + WINDOW);
        bytes memory t_ = abi.encode(WINDOW);
        bytes memory other_ = _transferCall(address(tHKD), foodMart, 10 * U + 1);
        vm.expectRevert(NotScheduled.selector);
        vm.prank(address(dm));
        vetoE.beforeHook(t_, "", singleMode, other_, DH, alice, ying);
    }

    function test_zeroWindowRedeemsInTheSameBlock() public {
        _schedule();
        bytes memory e_ = execution;
        vm.prank(address(dm));
        vetoE.beforeHook(abi.encode(uint256(0)), "", singleMode, e_, DH, alice, ying);
    }

    function test_rescheduleAfterConsumptionOpensAFreshWindow() public {
        _schedule();
        vm.warp(block.timestamp + WINDOW);
        _hookAs(address(dm), alice, ying);
        _schedule();
        vm.expectRevert(abi.encodeWithSelector(VetoWindowOpen.selector, uint64(block.timestamp + WINDOW)));
        _hookAs(address(dm), alice, ying);
    }

    // ------------------------------------------------------------------ veto

    function test_veto_byDelegator_blocksRedemption() public {
        _schedule();
        vm.expectEmit(true, true, true, true, address(vetoE));
        emit VetoRecorded(address(dm), DH, eh);
        vm.prank(alice);
        vetoE.veto(address(dm), DH, eh);
        (,,, bool v_) = _stored();
        assertTrue(v_);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(Vetoed.selector);
        _hookAs(address(dm), alice, ying);
    }

    function test_veto_byAnyoneElse_reverts() public {
        _schedule();
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, ying));
        vm.prank(ying);
        vetoE.veto(address(dm), DH, eh);
    }

    function test_veto_unscheduled_reverts() public {
        vm.expectRevert(NotScheduled.selector);
        vm.prank(alice);
        vetoE.veto(address(dm), DH, eh);
    }

    function test_vetoWithSig_relayedByAnyone() public {
        _schedule();
        uint256 deadline_ = block.timestamp;
        bytes memory sig_ = _ecdsa(aliceKey, vetoE.vetoDigest(address(dm), DH, eh, deadline_));
        vm.expectEmit(true, true, true, true, address(vetoE));
        emit VetoRecorded(address(dm), DH, eh);
        vm.prank(makeAddr("relayer"));
        vetoE.vetoWithSig(address(dm), DH, eh, deadline_, sig_); // deadline == now is still valid
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(Vetoed.selector);
        _hookAs(address(dm), alice, ying);
    }

    function test_vetoWithSig_expired_reverts() public {
        _schedule();
        uint256 deadline_ = block.timestamp - 1;
        bytes memory sig_ = _ecdsa(aliceKey, vetoE.vetoDigest(address(dm), DH, eh, deadline_));
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, deadline_));
        vetoE.vetoWithSig(address(dm), DH, eh, deadline_, sig_);
    }

    function test_vetoWithSig_unscheduled_reverts() public {
        uint256 deadline_ = block.timestamp + 1;
        bytes memory sig_ = _ecdsa(aliceKey, vetoE.vetoDigest(address(dm), DH, eh, deadline_));
        vm.expectRevert(NotScheduled.selector);
        vetoE.vetoWithSig(address(dm), DH, eh, deadline_, sig_);
    }

    function test_vetoWithSig_wrongSignerOrOtherExecution_reverts() public {
        _schedule();
        uint256 deadline_ = block.timestamp + 1;
        bytes memory bySomeoneElse_ = _ecdsa(mirageKey, vetoE.vetoDigest(address(dm), DH, eh, deadline_));
        vm.expectRevert(InvalidSignature.selector);
        vetoE.vetoWithSig(address(dm), DH, eh, deadline_, bySomeoneElse_);
        bytes memory forOther_ = _ecdsa(aliceKey, vetoE.vetoDigest(address(dm), DH, keccak256("other"), deadline_));
        vm.expectRevert(InvalidSignature.selector);
        vetoE.vetoWithSig(address(dm), DH, eh, deadline_, forOther_);
        (,,, bool v_) = _stored();
        assertFalse(v_);
    }

    // ------------------------------------------------------------------ open item (docs/ENFORCERS.md, section 5)

    /// @dev Pins the documented open item: `schedule` is open to any caller and its key omits the scheduler, so
    /// a third party that learns the execution first occupies the key; the agent can then neither schedule nor
    /// redeem that exact execution. This test asserts the current behaviour and will need updating if the key
    /// ever includes the scheduler.
    function test_openItem_thirdPartyCanOccupyAScheduleKey() public {
        vm.prank(mirage);
        vetoE.schedule(address(dm), DH, alice, execution);
        vm.expectRevert(VetoTimelockEnforcer.AlreadyScheduled.selector);
        vm.prank(ying);
        vetoE.schedule(address(dm), DH, alice, execution);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(NotScheduled.selector);
        _hookAs(address(dm), alice, ying);
    }

    // ------------------------------------------------------------------ through the DelegationManager

    function test_redeem_scheduleWaitRedeemOnce_thenPasskeyVeto() public {
        Delegation memory d_ = _signed(_delegation(address(nadia), ying, _one(address(vetoE), abi.encode(WINDOW)), 1501));
        bytes32 dh_ = _hashOf(d_);
        bytes memory e1_ = _transferCall(address(tHKD), foodMart, 25 * U);
        vm.prank(ying);
        vetoE.schedule(address(dm), dh_, address(nadia), e1_);
        vm.expectRevert(abi.encodeWithSelector(VetoWindowOpen.selector, uint64(block.timestamp + WINDOW)));
        _redeem(ying, d_, e1_);
        vm.warp(block.timestamp + WINDOW);
        _redeem(ying, d_, e1_);
        assertEq(tHKD.balanceOf(foodMart), 25 * U);
        vm.expectRevert(NotScheduled.selector);
        _redeem(ying, d_, e1_);

        // Nadia vetoes a second scheduled payment from her phone; anyone relays the passkey signature.
        bytes memory e2_ = _transferCall(address(tHKD), foodMart, 26 * U);
        vm.prank(ying);
        vetoE.schedule(address(dm), dh_, address(nadia), e2_);
        uint256 deadline_ = block.timestamp + 10 minutes;
        bytes memory sig_ = _passkeySign(vetoE.vetoDigest(address(dm), dh_, keccak256(e2_), deadline_));
        vetoE.vetoWithSig(address(dm), dh_, keccak256(e2_), deadline_, sig_);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(Vetoed.selector);
        _redeem(ying, d_, e2_);
        assertEq(tHKD.balanceOf(foodMart), 25 * U);
    }
}
