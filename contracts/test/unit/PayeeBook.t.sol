// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import { PayeeBook } from "../../src/registries/PayeeBook.sol";
import { Categories } from "../../src/utils/Categories.sol";

/// @notice PayeeBook: each account writes only its own book; entries are added once, updated in place,
/// deactivated (never deleted) and reactivated.
contract PayeeBookTest is Test {
    event PayeeSet(address indexed account, address indexed payee, uint32 categoryId, bytes32 labelHash);
    event PayeeRemoved(address indexed account, address indexed payee);

    PayeeBook internal book;
    address internal alice = makeAddr("alice-book");
    address internal bob = makeAddr("bob-book");
    address internal landlord = makeAddr("landlord");
    address internal grocer = makeAddr("grocer");

    function setUp() public {
        book = new PayeeBook();
        vm.warp(1_760_000_000);
    }

    function test_setPayee_zeroAddress_reverts() public {
        vm.expectRevert(PayeeBook.ZeroPayee.selector);
        vm.prank(alice);
        book.setPayee(address(0), Categories.RENT, bytes32(0));
    }

    function test_setPayee_addsOnceAndEmits() public {
        vm.expectEmit(true, true, true, true, address(book));
        emit PayeeSet(alice, landlord, Categories.RENT, keccak256("Landlord"));
        vm.prank(alice);
        book.setPayee(landlord, Categories.RENT, keccak256("Landlord"));
        PayeeBook.Entry memory e_ = book.entryOf(alice, landlord);
        assertEq(e_.categoryId, Categories.RENT);
        assertTrue(e_.active);
        assertEq(e_.labelHash, keccak256("Landlord"));
        assertEq(e_.addedAt, block.timestamp);
        (bool active_, uint32 cat_) = book.lookup(alice, landlord);
        assertTrue(active_);
        assertEq(cat_, Categories.RENT);
        assertEq(book.payeesOf(alice).length, 1);
    }

    function test_update_keepsAddedAtAndDoesNotDuplicate() public {
        vm.prank(alice);
        book.setPayee(landlord, Categories.RENT, keccak256("Landlord"));
        uint256 t0_ = block.timestamp;
        vm.warp(t0_ + 7 days);
        vm.prank(alice);
        book.setPayee(landlord, Categories.UTILITIES, keccak256("Landlord (utilities)"));
        PayeeBook.Entry memory e_ = book.entryOf(alice, landlord);
        assertEq(e_.categoryId, Categories.UTILITIES);
        assertEq(e_.labelHash, keccak256("Landlord (utilities)"));
        assertEq(e_.addedAt, t0_);
        assertEq(book.payeesOf(alice).length, 1);
    }

    function test_remove_deactivatesThenReAddReactivates() public {
        vm.prank(alice);
        book.setPayee(grocer, Categories.FOOD, keccak256("Grocer"));
        vm.expectEmit(true, true, true, true, address(book));
        emit PayeeRemoved(alice, grocer);
        vm.prank(alice);
        book.removePayee(grocer);
        (bool active_, uint32 cat_) = book.lookup(alice, grocer);
        assertFalse(active_);
        assertEq(cat_, Categories.FOOD);
        assertEq(book.payeesOf(alice).length, 1);

        vm.prank(alice);
        book.setPayee(grocer, Categories.FOOD, keccak256("Grocer"));
        (active_,) = book.lookup(alice, grocer);
        assertTrue(active_);
        assertEq(book.payeesOf(alice).length, 1);
    }

    function test_removeUnknownPayee_isHarmless() public {
        vm.prank(alice);
        book.removePayee(grocer);
        (bool active_,) = book.lookup(alice, grocer);
        assertFalse(active_);
        assertEq(book.payeesOf(alice).length, 0);
    }

    function test_booksArePerAccount() public {
        vm.prank(alice);
        book.setPayee(landlord, Categories.RENT, bytes32(0));
        (bool active_,) = book.lookup(bob, landlord);
        assertFalse(active_);
        vm.prank(bob);
        book.removePayee(landlord); // writes bob's book only
        (active_,) = book.lookup(alice, landlord);
        assertTrue(active_);
    }

    function test_setPayees_batch() public {
        address[] memory p_ = new address[](2);
        uint32[] memory c_ = new uint32[](2);
        bytes32[] memory l_ = new bytes32[](2);
        (p_[0], c_[0], l_[0]) = (landlord, Categories.RENT, keccak256("L"));
        (p_[1], c_[1], l_[1]) = (grocer, Categories.FOOD, keccak256("G"));
        vm.prank(alice);
        book.setPayees(p_, c_, l_);
        address[] memory all_ = book.payeesOf(alice);
        assertEq(all_.length, 2);
        assertEq(all_[1], grocer);
        (, uint32 cat_) = book.lookup(alice, grocer);
        assertEq(cat_, Categories.FOOD);
    }

    function test_setPayees_lengthMismatchOrZero_revertsWholeBatch() public {
        address[] memory p_ = new address[](2);
        p_[0] = landlord;
        vm.expectRevert(PayeeBook.LengthMismatch.selector);
        vm.prank(alice);
        book.setPayees(p_, new uint32[](1), new bytes32[](2));
        vm.expectRevert(PayeeBook.LengthMismatch.selector);
        vm.prank(alice);
        book.setPayees(p_, new uint32[](2), new bytes32[](1));
        vm.expectRevert(PayeeBook.ZeroPayee.selector); // p_[1] is zero
        vm.prank(alice);
        book.setPayees(p_, new uint32[](2), new bytes32[](2));
        assertEq(book.payeesOf(alice).length, 0);
    }
}
