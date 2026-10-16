// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { stdError } from "forge-std/StdError.sol";
import { Delegation, Caveat } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { ConditionalPaymentInstructions } from "../../src/rails/ConditionalPaymentInstructions.sol";
import { Unauthorized, ReserveFloorBreached } from "../../src/utils/Errors.sol";

/// @notice ConditionalPaymentInstructions (coin-free mainland rail, e-CNY-style simulator): operator-only results,
/// pending -> executed / rejected / expired, and balanceOf = posted balance net of pending instructions.
contract ConditionalPaymentInstructionsTest is CoverageBase {
    event Instructed(
        uint256 indexed id,
        address indexed account,
        address indexed payee,
        uint256 amount,
        bytes32 purposeHash,
        bytes32 conditionHash,
        uint64 validUntil
    );
    event Executed(uint256 indexed id, bytes32 simulatorRef);
    event Rejected(uint256 indexed id, bytes32 reasonCode);
    event Expired(uint256 indexed id);
    event BalancePosted(address indexed account, uint256 balance, bytes32 statementRef);
    event OperatorTransferred(address indexed from, address indexed to);

    address internal alice = makeAddr("alice-cny");
    address internal shop = makeAddr("shop-cny");
    uint64 internal validUntil;

    function setUp() public override {
        super.setUp();
        vm.warp(1_760_000_000);
        validUntil = uint64(block.timestamp + 1 days);
        cpi.postBalance(alice, 10_000, keccak256("statement-0"));
    }

    function _instruct(uint256 _amount) internal returns (uint256 id_) {
        vm.prank(alice);
        id_ = cpi.instruct(shop, _amount, keccak256("purpose"), keccak256("cond"), validUntil);
    }

    function _status(uint256 _id) internal view returns (ConditionalPaymentInstructions.Status) {
        return cpi.instructionOf(_id).status;
    }

    function test_constants() public {
        assertEq(cpi.railKind(), 3);
        assertEq(cpi.decimals(), 2);
        assertEq(cpi.name(), "Coin-free conditional payment instructions (e-CNY-style simulator)");
        assertEq(cpi.operator(), address(this));
    }

    function test_operatorOnlyFunctions_revertForOthers() public {
        uint256 id_ = _instruct(100);
        vm.startPrank(mirage);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        cpi.execute(id_, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        cpi.reject(id_, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        cpi.postBalance(mirage, 1e30, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        cpi.transferOperator(mirage);
        vm.stopPrank();
    }

    function test_postBalance_emitsAndSets() public {
        vm.expectEmit(true, true, true, true, address(cpi));
        emit BalancePosted(alice, 777, keccak256("statement-1"));
        cpi.postBalance(alice, 777, keccak256("statement-1"));
        assertEq(cpi.postedBalance(alice), 777);
        assertEq(cpi.balanceOf(alice), 777);
    }

    function test_instruct_recordsPendingAndEmits() public {
        vm.expectEmit(true, true, true, true, address(cpi));
        emit Instructed(0, alice, shop, 2_500, keccak256("purpose"), keccak256("cond"), validUntil);
        uint256 id_ = _instruct(2_500);
        assertEq(id_, 0);
        assertEq(cpi.instructionCount(), 1);
        ConditionalPaymentInstructions.Instruction memory i_ = cpi.instructionOf(0);
        assertEq(i_.account, alice);
        assertEq(i_.payee, shop);
        assertEq(i_.amount, 2_500);
        assertEq(i_.purposeHash, keccak256("purpose"));
        assertEq(i_.conditionHash, keccak256("cond"));
        assertEq(i_.validUntil, validUntil);
        assertEq(i_.createdAt, block.timestamp);
        assertEq(uint8(i_.status), uint8(ConditionalPaymentInstructions.Status.Pending));
        assertEq(i_.resultRef, bytes32(0));
        assertEq(cpi.pendingTotal(alice), 2_500);
        assertEq(cpi.balanceOf(alice), 7_500);
        assertEq(cpi.postedBalance(alice), 10_000);
    }

    function test_instruct_exactlyAvailablePasses_oneMoreReverts() public {
        _instruct(6_000);
        vm.expectRevert(abi.encodeWithSelector(ConditionalPaymentInstructions.InsufficientAvailable.selector, 4_000, 4_001));
        _instruct(4_001);
        _instruct(4_000);
        assertEq(cpi.balanceOf(alice), 0);
        vm.expectRevert(abi.encodeWithSelector(ConditionalPaymentInstructions.InsufficientAvailable.selector, 0, 1));
        _instruct(1);
    }

    function test_execute_movesPostedBalanceAndClearsPending() public {
        uint256 id_ = _instruct(2_500);
        vm.expectEmit(true, true, true, true, address(cpi));
        emit Executed(id_, keccak256("sim-ref"));
        cpi.execute(id_, keccak256("sim-ref"));
        assertEq(uint8(_status(id_)), uint8(ConditionalPaymentInstructions.Status.Executed));
        assertEq(cpi.instructionOf(id_).resultRef, keccak256("sim-ref"));
        assertEq(cpi.pendingTotal(alice), 0);
        assertEq(cpi.postedBalance(alice), 7_500);
        assertEq(cpi.postedBalance(shop), 2_500);
        assertEq(cpi.balanceOf(alice), 7_500);
    }

    function test_reject_releasesPendingOnly() public {
        uint256 id_ = _instruct(2_500);
        vm.expectEmit(true, true, true, true, address(cpi));
        emit Rejected(id_, keccak256("CONDITION_NOT_MET"));
        cpi.reject(id_, keccak256("CONDITION_NOT_MET"));
        assertEq(uint8(_status(id_)), uint8(ConditionalPaymentInstructions.Status.Rejected));
        assertEq(cpi.instructionOf(id_).resultRef, keccak256("CONDITION_NOT_MET"));
        assertEq(cpi.pendingTotal(alice), 0);
        assertEq(cpi.postedBalance(alice), 10_000);
        assertEq(cpi.postedBalance(shop), 0);
    }

    function test_expire_onlyAfterValidUntil_byAnyone() public {
        uint256 id_ = _instruct(2_500);
        vm.warp(validUntil);
        vm.expectRevert(abi.encodeWithSelector(ConditionalPaymentInstructions.NotExpired.selector, id_));
        cpi.expire(id_);
        vm.warp(validUntil + 1);
        vm.expectEmit(true, true, true, true, address(cpi));
        emit Expired(id_);
        vm.prank(mirage);
        cpi.expire(id_);
        assertEq(uint8(_status(id_)), uint8(ConditionalPaymentInstructions.Status.Expired));
        assertEq(cpi.pendingTotal(alice), 0);
        assertEq(cpi.balanceOf(alice), 10_000);
    }

    function test_finalStatesAreTerminal() public {
        uint256 a_ = _instruct(100);
        uint256 b_ = _instruct(100);
        uint256 c_ = _instruct(100);
        cpi.execute(a_, bytes32(0));
        cpi.reject(b_, bytes32(0));
        vm.warp(validUntil + 1);
        cpi.expire(c_);
        uint256[3] memory ids_ = [a_, b_, c_];
        for (uint256 i; i < 3; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ConditionalPaymentInstructions.InvalidStatus.selector, ids_[i]));
            cpi.execute(ids_[i], bytes32(0));
            vm.expectRevert(abi.encodeWithSelector(ConditionalPaymentInstructions.InvalidStatus.selector, ids_[i]));
            cpi.reject(ids_[i], bytes32(0));
            vm.expectRevert(abi.encodeWithSelector(ConditionalPaymentInstructions.InvalidStatus.selector, ids_[i]));
            cpi.expire(ids_[i]);
        }
        assertEq(cpi.postedBalance(alice), 9_900);
        assertEq(cpi.pendingTotal(alice), 0);
    }

    function test_unknownInstruction_reverts() public {
        vm.expectRevert(stdError.indexOOBError);
        cpi.execute(5, bytes32(0));
        vm.expectRevert(stdError.indexOOBError);
        cpi.instructionOf(5);
    }

    function test_balanceOf_saturatesAtZeroWhenStatementDropsBelowPending() public {
        uint256 id_ = _instruct(8_000);
        cpi.postBalance(alice, 5_000, keccak256("statement-2"));
        assertEq(cpi.balanceOf(alice), 0);
        // Executing would overdraw the posted balance: the simulator cannot record it (arithmetic panic).
        vm.expectRevert(stdError.arithmeticError);
        cpi.execute(id_, bytes32(0));
        cpi.reject(id_, keccak256("INSUFFICIENT_FUNDS"));
        assertEq(cpi.balanceOf(alice), 5_000);
    }

    function test_transferOperator_handsOverTheRole() public {
        address sim_ = makeAddr("simulator-2");
        vm.expectEmit(true, true, true, true, address(cpi));
        emit OperatorTransferred(address(this), sim_);
        cpi.transferOperator(sim_);
        assertEq(cpi.operator(), sim_);
        uint256 id_ = _instruct(100);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, address(this)));
        cpi.execute(id_, bytes32(0));
        vm.prank(sim_);
        cpi.execute(id_, bytes32(0));
    }

    function testFuzz_availableIsPostedMinusPending(uint64 _posted, uint64[4] memory _amounts, uint8 _outcomes) public {
        cpi.postBalance(alice, _posted, bytes32(0));
        uint256 pending_;
        uint256 posted_ = _posted;
        for (uint256 i; i < 4; ++i) {
            uint256 available_ = posted_ - pending_;
            uint256 a_ = _amounts[i];
            if (a_ > available_) {
                vm.expectRevert(abi.encodeWithSelector(ConditionalPaymentInstructions.InsufficientAvailable.selector, available_, a_));
                _instruct(a_);
                continue;
            }
            uint256 id_ = _instruct(a_);
            pending_ += a_;
            uint8 o_ = (_outcomes >> (2 * i)) & 3;
            if (o_ == 1) {
                cpi.execute(id_, bytes32(0));
                pending_ -= a_;
                posted_ -= a_;
            } else if (o_ == 2) {
                cpi.reject(id_, bytes32(0));
                pending_ -= a_;
            }
            assertEq(cpi.pendingTotal(alice), pending_);
            assertEq(cpi.postedBalance(alice), posted_);
            assertEq(cpi.balanceOf(alice), posted_ - pending_);
        }
    }

    // ------------------------------------------------------------------ through the DelegationManager

    function test_redeem_mainlandInstructionUnderReserveFloorOnCoinFreeRail() public {
        cpi.postBalance(address(nadia), 10_000, keccak256("nadia-statement"));
        Caveat[] memory c_ = new Caveat[](4);
        c_[0] = Caveat(address(allowedTargets), abi.encodePacked(address(cpi)), "");
        c_[1] = Caveat(address(jurisdictionE), abi.encode(uint8(3), _a1(address(cpi))), "");
        c_[2] = Caveat(address(payeeE), abi.encode(address(payeeBook), address(passports), new address[](0), new address[](0)), "");
        c_[3] = Caveat(address(floorE), abi.encode(address(cpi), uint256(500)), "");
        Delegation memory d_ = _signed(_delegation(address(nadia), ying, c_, 1601));

        _redeem(ying, d_, _instructCall(address(cpi), harbourHomes, 9_000, validUntil));
        assertEq(cpi.balanceOf(address(nadia)), 1_000);
        assertEq(cpi.instructionOf(0).account, address(nadia));
        assertEq(cpi.instructionOf(0).payee, harbourHomes);

        // A second instruction would leave 400 available, below the 500 floor.
        vm.expectRevert(abi.encodeWithSelector(ReserveFloorBreached.selector, address(cpi), 400, 500));
        _redeem(ying, d_, _instructCall(address(cpi), harbourHomes, 600, validUntil));
        // Rejecting the first instruction restores the available balance.
        cpi.reject(0, keccak256("CONDITION_NOT_MET"));
        _redeem(ying, d_, _instructCall(address(cpi), harbourHomes, 600, validUntil));
        assertEq(cpi.balanceOf(address(nadia)), 9_400);
    }
}
