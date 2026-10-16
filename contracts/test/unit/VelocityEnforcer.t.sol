// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Delegation } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { VelocityExceeded, InvalidTerms, InvalidExecutionMode, UndecodableExecution } from "../../src/utils/Errors.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";

/// @notice VelocityEnforcer: at most `maxCount` payments (any asset) and `maxOutflow` of the sealed asset per
/// fixed window; counters keyed by (DelegationManager, delegator, window index).
contract VelocityEnforcerTest is CoverageBase {
    event VelocityUsed(address indexed delegationManager, address indexed delegator, uint256 indexed windowIndex, uint32 count, uint256 outflow);

    uint64 internal constant WINDOW = 1 days;
    uint32 internal constant MAX_COUNT = 3;
    uint256 internal constant MAX_OUT = 1_000 * U;

    function setUp() public override {
        super.setUp();
        vm.warp(1_760_000_000 - (1_760_000_000 % WINDOW)); // start of a window
    }

    function _terms() internal view returns (bytes memory) {
        return abi.encode(address(tHKD), WINDOW, MAX_COUNT, MAX_OUT);
    }

    function _pay(address _delegator, address _asset, uint256 _amount) internal {
        velocityE.beforeHook(_terms(), "", singleMode, _transferCall(_asset, foodMart, _amount), DH, _delegator, ying);
    }

    function _usage(address _dm, address _delegator) internal view returns (uint32 c_, uint256 o_) {
        (c_, o_) = velocityE.usage(velocityE.usageKey(_dm, _delegator, block.timestamp / WINDOW));
    }

    function test_getTermsInfo_decodesAndValidates() public {
        (address a_, uint64 w_, uint32 c_, uint256 m_) = velocityE.getTermsInfo(_terms());
        assertEq(a_, address(tHKD));
        assertEq(w_, WINDOW);
        assertEq(c_, MAX_COUNT);
        assertEq(m_, MAX_OUT);
        vm.expectRevert(InvalidTerms.selector);
        velocityE.getTermsInfo(abi.encode(address(tHKD), WINDOW, MAX_COUNT));
        vm.expectRevert(InvalidTerms.selector);
        velocityE.getTermsInfo(abi.encodePacked(_terms(), bytes1(0)));
        vm.expectRevert(InvalidTerms.selector);
        velocityE.getTermsInfo(abi.encode(address(tHKD), uint64(0), MAX_COUNT, MAX_OUT));
    }

    function test_usageKey_isTheDocumentedHash() public {
        assertEq(velocityE.usageKey(address(dm), address(nadia), 9), keccak256(abi.encode(address(dm), address(nadia), uint256(9))));
    }

    function test_nonSingleDefaultModeOrUndecodable_reverts() public {
        bytes memory t_ = _terms();
        bytes memory e_ = _transferCall(address(tHKD), foodMart, 1);
        vm.expectRevert(InvalidExecutionMode.selector);
        velocityE.beforeHook(t_, "", batchMode, e_, DH, address(nadia), ying);
        bytes memory bad_ = ExecutionLib.encodeSingle(address(tHKD), 0, hex"12345678");
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, bytes4(0x12345678)));
        velocityE.beforeHook(t_, "", singleMode, bad_, DH, address(nadia), ying);
    }

    function test_countLimit_exactlyMaxPasses_nextReverts() public {
        for (uint256 i = 1; i <= MAX_COUNT; ++i) {
            vm.expectEmit(true, true, true, true, address(velocityE));
            emit VelocityUsed(address(dm), address(nadia), block.timestamp / WINDOW, uint32(i), i * U);
            vm.prank(address(dm));
            _pay(address(nadia), address(tHKD), U);
        }
        vm.expectRevert(abi.encodeWithSelector(VelocityExceeded.selector, uint256(MAX_COUNT + 1), (MAX_COUNT + 1) * U));
        vm.prank(address(dm));
        _pay(address(nadia), address(tHKD), U);
    }

    function test_outflowLimit_exactlyMaxPasses_oneMoreReverts() public {
        _pay(address(nadia), address(tHKD), MAX_OUT - 1);
        _pay(address(nadia), address(tHKD), 1);
        (uint32 c_, uint256 o_) = _usage(address(this), address(nadia));
        assertEq(c_, 2);
        assertEq(o_, MAX_OUT);
        vm.expectRevert(abi.encodeWithSelector(VelocityExceeded.selector, uint256(3), MAX_OUT + 1));
        _pay(address(nadia), address(tHKD), 1);
    }

    function test_otherAssetCountsButAddsNoOutflow() public {
        _pay(address(nadia), address(tUSD), 1e30);
        (uint32 c_, uint256 o_) = _usage(address(this), address(nadia));
        assertEq(c_, 1);
        assertEq(o_, 0);
        _pay(address(nadia), address(tHKD), MAX_OUT);
        _pay(address(nadia), address(tUSD), 1e30);
        vm.expectRevert(abi.encodeWithSelector(VelocityExceeded.selector, uint256(4), MAX_OUT));
        _pay(address(nadia), address(tUSD), 1);
    }

    function test_fixedWindowsRollOver() public {
        uint256 t0_ = block.timestamp;
        _pay(address(nadia), address(tHKD), MAX_OUT);
        vm.warp(t0_ + WINDOW - 1); // last second of the same window
        bytes memory t_ = _terms();
        bytes memory e_ = _transferCall(address(tHKD), foodMart, 1);
        vm.expectRevert(abi.encodeWithSelector(VelocityExceeded.selector, uint256(2), MAX_OUT + 1));
        velocityE.beforeHook(t_, "", singleMode, e_, DH, address(nadia), ying);
        vm.warp(t0_ + WINDOW); // first second of the next window: fresh counters (fixed, not rolling)
        _pay(address(nadia), address(tHKD), MAX_OUT);
        (uint32 c_,) = velocityE.usage(velocityE.usageKey(address(this), address(nadia), t0_ / WINDOW));
        assertEq(c_, 1);
    }

    function test_countersAreKeyedByDelegationManagerAndDelegator() public {
        vm.prank(address(dm));
        _pay(address(nadia), address(tHKD), MAX_OUT);
        vm.prank(address(dm2));
        _pay(address(nadia), address(tHKD), MAX_OUT);
        vm.prank(address(dm));
        _pay(mirage, address(tHKD), MAX_OUT);
        (uint32 c1_, uint256 o1_) = _usage(address(dm), address(nadia));
        (uint32 c2_, uint256 o2_) = _usage(address(dm2), address(nadia));
        (uint32 c3_,) = _usage(address(dm), mirage);
        assertEq(c1_ + c2_ + c3_, 3);
        assertEq(o1_, MAX_OUT);
        assertEq(o2_, MAX_OUT);
        // Aggregated across delegations of one delegator: another delegation hash shares dm's counter.
        bytes memory t_ = _terms();
        bytes memory e_ = _transferCall(address(tHKD), foodMart, 1);
        vm.expectRevert(abi.encodeWithSelector(VelocityExceeded.selector, uint256(2), MAX_OUT + 1));
        vm.prank(address(dm));
        velocityE.beforeHook(t_, "", singleMode, e_, keccak256("other"), address(nadia), ying);
    }

    function testFuzz_windowNeverExceedsLimits(uint256[6] memory _amounts, uint256[6] memory _gaps) public {
        uint256 window_ = type(uint256).max;
        uint32 count_;
        uint256 out_;
        for (uint256 i; i < 6; ++i) {
            vm.warp(block.timestamp + bound(_gaps[i], 0, WINDOW));
            uint256 a_ = bound(_amounts[i], 0, MAX_OUT);
            if (block.timestamp / WINDOW != window_) {
                window_ = block.timestamp / WINDOW;
                (count_, out_) = (0, 0);
            }
            bytes memory t_ = _terms();
            bytes memory e_ = _transferCall(address(tHKD), foodMart, a_);
            vm.prank(address(dm));
            try velocityE.beforeHook(t_, "", singleMode, e_, DH, address(nadia), ying) {
                count_ += 1;
                out_ += a_;
            } catch (bytes memory err_) {
                assertTrue(count_ + 1 > MAX_COUNT || out_ + a_ > MAX_OUT);
                assertEq(err_, abi.encodeWithSelector(VelocityExceeded.selector, uint256(count_ + 1), out_ + a_));
            }
            (uint32 c_, uint256 o_) = _usage(address(dm), address(nadia));
            assertEq(c_, count_);
            assertEq(o_, out_);
            assertLe(c_, MAX_COUNT);
            assertLe(o_, MAX_OUT);
        }
    }

    function test_redeem_splitPaymentsHitTheCountAcrossTwoDelegations() public {
        // Two live delegations of the same account in different lineages share the account's velocity counter.
        Delegation memory d1_ = _sealNadia(keccak256("mandate:velocity:a"), 1, 1301);
        for (uint256 i; i < 8; ++i) {
            _redeem(ying, d1_, _transferCall(address(tHKD), foodMart, U));
        }
        Delegation memory d2_ = _signed(_delegation(address(nadia), ying, _one(address(velocityE), abi.encode(address(tHKD), uint64(1 days), uint32(8), 15_000 * U)), 1302));
        vm.expectRevert(abi.encodeWithSelector(VelocityExceeded.selector, uint256(9), 9 * U));
        _redeem(ying, d2_, _transferCall(address(tHKD), foodMart, U));
    }
}
