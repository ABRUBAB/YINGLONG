// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Delegation } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { CategoryBudgetEnforcer } from "../../src/enforcers/CategoryBudgetEnforcer.sol";
import { Categories } from "../../src/utils/Categories.sol";
import { CategoryBudgetExceeded, InvalidTerms, InvalidExecutionMode } from "../../src/utils/Errors.sol";

/// @notice CategoryBudgetEnforcer: per-period caps per PayeeBook category, unlisted beneficiaries in the
/// sealed fallback category, counters keyed by (DelegationManager, delegator, asset, category, period).
contract CategoryBudgetEnforcerTest is CoverageBase {
    event BudgetSpent(
        address indexed delegationManager,
        address indexed delegator,
        uint32 indexed categoryId,
        address asset,
        uint256 period,
        uint256 spent,
        uint256 cap
    );

    uint64 internal constant PERIOD = 30 days;
    uint256 internal constant RENT_CAP = 9_500 * U;
    uint256 internal constant FOOD_CAP = 3_000 * U;
    uint256 internal constant SERVICES_CAP = 200 * U;
    uint64 internal start;

    function setUp() public override {
        super.setUp();
        vm.warp(1_760_000_000);
        start = uint64(block.timestamp);
    }

    function _terms() internal view returns (bytes memory) {
        uint32[] memory cats_ = new uint32[](3);
        uint256[] memory caps_ = new uint256[](3);
        (cats_[0], caps_[0]) = (Categories.RENT, RENT_CAP);
        (cats_[1], caps_[1]) = (Categories.FOOD, FOOD_CAP);
        (cats_[2], caps_[2]) = (Categories.SERVICES, SERVICES_CAP);
        return abi.encode(address(payeeBook), address(tHKD), start, PERIOD, Categories.SERVICES, cats_, caps_);
    }

    function _pay(address _delegator, address _to, uint256 _amount) internal {
        budgetE.beforeHook(_terms(), "", singleMode, _transferCall(address(tHKD), _to, _amount), DH, _delegator, ying);
    }

    function _spent(address _dm, uint32 _cat) internal view returns (uint256) {
        return budgetE.spentNow(_dm, address(nadia), address(tHKD), _cat, start, PERIOD);
    }

    // ------------------------------------------------------------------ terms and views

    function test_getTermsInfo_decodesAndValidates() public {
        CategoryBudgetEnforcer.Terms memory t_ = budgetE.getTermsInfo(_terms());
        assertEq(t_.payeeBook, address(payeeBook));
        assertEq(t_.asset, address(tHKD));
        assertEq(t_.periodStart, start);
        assertEq(t_.periodLength, PERIOD);
        assertEq(t_.unlistedCategory, Categories.SERVICES);
        assertEq(t_.caps[1], FOOD_CAP);

        bytes memory min_ = abi.encode(address(payeeBook), address(tHKD), start, PERIOD, uint32(0), new uint32[](0), new uint256[](0));
        assertEq(min_.length, 288);
        budgetE.getTermsInfo(min_);
        assembly {
            mstore(min_, 287)
        }
        vm.expectRevert(InvalidTerms.selector);
        budgetE.getTermsInfo(min_);

        vm.expectRevert(InvalidTerms.selector);
        budgetE.getTermsInfo(abi.encode(address(payeeBook), address(tHKD), start, PERIOD, uint32(0), _c1(1), new uint256[](0)));
        vm.expectRevert(InvalidTerms.selector);
        budgetE.getTermsInfo(abi.encode(address(payeeBook), address(tHKD), start, uint64(0), uint32(0), _c1(1), _u1(1)));
    }

    function test_periodOf_boundaries() public {
        assertEq(budgetE.periodOf(start + 10, PERIOD), 0); // before the start
        assertEq(budgetE.periodOf(start, PERIOD), 0);
        vm.warp(start + PERIOD - 1);
        assertEq(budgetE.periodOf(start, PERIOD), 0);
        vm.warp(start + PERIOD);
        assertEq(budgetE.periodOf(start, PERIOD), 1);
        vm.warp(start + 5 * PERIOD + 3);
        assertEq(budgetE.periodOf(start, PERIOD), 5);
    }

    function test_spentKey_isTheDocumentedHash() public {
        assertEq(
            budgetE.spentKey(address(dm), address(nadia), address(tHKD), Categories.FOOD, 4),
            keccak256(abi.encode(address(dm), address(nadia), address(tHKD), Categories.FOOD, uint256(4)))
        );
    }

    function test_nonSingleDefaultMode_reverts() public {
        bytes memory t_ = _terms();
        bytes memory e_ = _transferCall(address(tHKD), foodMart, 1);
        vm.expectRevert(InvalidExecutionMode.selector);
        budgetE.beforeHook(t_, "", tryMode, e_, DH, address(nadia), ying);
    }

    // ------------------------------------------------------------------ caps

    function test_otherAssetIsNotGoverned() public {
        budgetE.beforeHook(_terms(), "", singleMode, _transferCall(address(tUSD), foodMart, 1e30), DH, address(nadia), ying);
        assertEq(_spent(address(this), Categories.FOOD), 0);
    }

    function test_exactlyAtCapPasses_oneOverReverts_andEmits() public {
        vm.prank(address(dm));
        _pay(address(nadia), foodMart, FOOD_CAP - 1);
        vm.expectEmit(true, true, true, true, address(budgetE));
        emit BudgetSpent(address(dm), address(nadia), Categories.FOOD, address(tHKD), 0, FOOD_CAP, FOOD_CAP);
        vm.prank(address(dm));
        _pay(address(nadia), foodMart, 1);
        assertEq(_spent(address(dm), Categories.FOOD), FOOD_CAP);

        vm.expectRevert(abi.encodeWithSelector(CategoryBudgetExceeded.selector, Categories.FOOD, FOOD_CAP + 1, FOOD_CAP));
        vm.prank(address(dm));
        _pay(address(nadia), foodMart, 1);
    }

    function test_zeroAmountPassesAtCap() public {
        vm.prank(address(dm));
        _pay(address(nadia), foodMart, FOOD_CAP);
        vm.prank(address(dm));
        _pay(address(nadia), foodMart, 0);
        assertEq(_spent(address(dm), Categories.FOOD), FOOD_CAP);
    }

    function test_unlistedBeneficiaryFallsIntoSealedCategory() public {
        // Pearl River is not in Nadia's book: SERVICES, cap 200.
        _pay(address(nadia), pearlRiver, SERVICES_CAP);
        assertEq(_spent(address(this), Categories.SERVICES), SERVICES_CAP);
        vm.expectRevert(abi.encodeWithSelector(CategoryBudgetExceeded.selector, Categories.SERVICES, SERVICES_CAP + 1, SERVICES_CAP));
        _pay(address(nadia), pearlRiver, 1);
    }

    function test_removedPayeeFallsIntoSealedCategory() public {
        vm.prank(address(nadia));
        payeeBook.removePayee(harbourHomes);
        vm.expectRevert(abi.encodeWithSelector(CategoryBudgetExceeded.selector, Categories.SERVICES, 201 * U, SERVICES_CAP));
        _pay(address(nadia), harbourHomes, 201 * U);
    }

    function test_categoryWithoutCapHasCapZero() public {
        // Tuition is a book category, but these terms give it no cap.
        vm.expectRevert(abi.encodeWithSelector(CategoryBudgetExceeded.selector, Categories.TUITION, 1, 0));
        _pay(address(nadia), hbuBursar, 1);
    }

    function test_newPeriodStartsFromZero_oldPeriodKept() public {
        _pay(address(nadia), harbourHomes, RENT_CAP);
        vm.warp(start + PERIOD);
        assertEq(_spent(address(this), Categories.RENT), 0);
        _pay(address(nadia), harbourHomes, RENT_CAP);
        assertEq(_spent(address(this), Categories.RENT), RENT_CAP);
        assertEq(budgetE.spent(budgetE.spentKey(address(this), address(nadia), address(tHKD), Categories.RENT, 0)), RENT_CAP);
    }

    function test_paymentsBeforePeriodStartCountInPeriodZero() public {
        bytes memory future_ = abi.encode(
            address(payeeBook), address(tHKD), start + 1 days, PERIOD, Categories.SERVICES, _c1(Categories.FOOD), _u1(FOOD_CAP)
        );
        budgetE.beforeHook(future_, "", singleMode, _transferCall(address(tHKD), foodMart, FOOD_CAP), DH, address(nadia), ying);
        vm.warp(start + 1 days);
        bytes memory e_ = _transferCall(address(tHKD), foodMart, 1);
        vm.expectRevert(abi.encodeWithSelector(CategoryBudgetExceeded.selector, Categories.FOOD, FOOD_CAP + 1, FOOD_CAP));
        budgetE.beforeHook(future_, "", singleMode, e_, DH, address(nadia), ying);
    }

    // ------------------------------------------------------------------ state keys

    function test_countersAreKeyedByDelegationManager() public {
        vm.prank(address(dm));
        _pay(address(nadia), foodMart, FOOD_CAP);
        // An exhausted budget under dm does not touch dm2 (or a direct caller).
        vm.prank(address(dm2));
        _pay(address(nadia), foodMart, FOOD_CAP);
        vm.prank(mirage);
        _pay(address(nadia), foodMart, FOOD_CAP);
        assertEq(_spent(address(dm), Categories.FOOD), FOOD_CAP);
        assertEq(_spent(address(dm2), Categories.FOOD), FOOD_CAP);
    }

    function test_countersAreKeyedByDelegator_notByDelegation() public {
        vm.prank(address(dm));
        _pay(address(nadia), foodMart, FOOD_CAP);
        // Another delegation hash of the same delegator shares the counter (a re-seal never resets a budget)...
        vm.expectRevert(abi.encodeWithSelector(CategoryBudgetExceeded.selector, Categories.FOOD, FOOD_CAP + 1, FOOD_CAP));
        vm.prank(address(dm));
        budgetE.beforeHook(_terms(), "", singleMode, _transferCall(address(tHKD), foodMart, 1), keccak256("other"), address(nadia), ying);
        // ...while another delegator has its own counter (and its own book: food mart is unlisted there).
        vm.prank(address(dm));
        _pay(mirage, foodMart, SERVICES_CAP);
    }

    // ------------------------------------------------------------------ properties

    function testFuzz_spentNeverExceedsCap(uint256[8] memory _amounts) public {
        uint256 accepted_;
        for (uint256 i; i < _amounts.length; ++i) {
            uint256 a_ = bound(_amounts[i], 0, FOOD_CAP);
            bytes memory t_ = _terms();
            bytes memory e_ = _transferCall(address(tHKD), foodMart, a_);
            vm.prank(address(dm));
            try budgetE.beforeHook(t_, "", singleMode, e_, DH, address(nadia), ying) {
                accepted_ += a_;
            } catch (bytes memory err_) {
                assertGt(accepted_ + a_, FOOD_CAP);
                assertEq(err_, abi.encodeWithSelector(CategoryBudgetExceeded.selector, Categories.FOOD, accepted_ + a_, FOOD_CAP));
            }
            assertLe(accepted_, FOOD_CAP);
            assertEq(_spent(address(dm), Categories.FOOD), accepted_);
        }
    }

    function testFuzz_periodIndex(uint64 _start, uint64 _length, uint64 _now) public {
        _length = uint64(bound(_length, 1, 365 days));
        _now = uint64(bound(_now, 1, type(uint64).max));
        vm.warp(_now);
        uint256 p_ = budgetE.periodOf(_start, _length);
        if (_now < _start) {
            assertEq(p_, 0);
        } else {
            assertLe(uint256(_start) + p_ * _length, _now);
            assertGt(uint256(_start) + (p_ + 1) * _length, _now);
        }
    }

    // ------------------------------------------------------------------ through the DelegationManager

    function test_redeem_tusdBudgetIsSeparateFromTheTHKDBudget() public {
        Delegation memory d_ = _sealNadia(keccak256("mandate:budget"), 1, 1101);
        _redeem(ying, d_, _transferCall(address(tUSD), pearlRiver, 40 * U));
        assertEq(budgetE.spentNow(address(dm), address(nadia), address(tUSD), Categories.SERVICES, 0, 30 days), 40 * U);
        assertEq(budgetE.spentNow(address(dm), address(nadia), address(tHKD), Categories.SERVICES, 0, 30 days), 0);
        // Same category, other asset: the tHKD services budget (200) is untouched by the tUSD payment.
        _redeem(ying, d_, _transferCall(address(tHKD), pearlRiver, 45 * U));
        assertEq(budgetE.spentNow(address(dm), address(nadia), address(tHKD), Categories.SERVICES, 0, 30 days), 45 * U);
    }
}
