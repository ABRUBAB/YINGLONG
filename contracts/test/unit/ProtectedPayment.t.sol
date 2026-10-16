// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { stdError } from "forge-std/StdError.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { ProtectedPayment } from "../../src/rails/ProtectedPayment.sol";
import { Unauthorized } from "../../src/utils/Errors.sol";

/// @notice ProtectedPayment (escrow): Held -> Released (by the named attester) or Refunded (by anyone after the
/// refund time); malformed escrow data is refused; nobody else can move escrowed funds.
contract ProtectedPaymentTest is CoverageBase {
    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed payer,
        address indexed payee,
        address token,
        uint256 amount,
        bytes32 conditionId,
        address releaseAttester,
        uint64 refundAfter
    );
    event EscrowReleased(uint256 indexed escrowId, address indexed by, bytes32 evidenceHash);
    event EscrowRefunded(uint256 indexed escrowId);

    address internal payer = makeAddr("payer");
    bytes32 internal constant COND = keccak256("enrolment:HBU:2026");
    uint64 internal refundAfter;

    function setUp() public override {
        super.setUp();
        vm.warp(1_760_000_000);
        refundAfter = uint64(block.timestamp + 30 days);
        tHKD.mint(payer, 10_000 * U);
    }

    function _data(address _payee, address _attester) internal view returns (bytes memory) {
        return abi.encode(_payee, COND, _attester, refundAfter);
    }

    function _fund(uint256 _amount) internal returns (uint256 id_) {
        id_ = escrow.escrowCount();
        vm.prank(payer);
        tHKD.transferAndCall(address(escrow), _amount, _data(hbuBursar, issuerHbu));
    }

    function test_create_recordsEscrowAndEmits() public {
        vm.expectEmit(true, true, true, true, address(escrow));
        emit EscrowCreated(0, payer, hbuBursar, address(tHKD), 5_000 * U, COND, issuerHbu, refundAfter);
        vm.prank(payer);
        tHKD.transferAndCall(address(escrow), 5_000 * U, _data(hbuBursar, issuerHbu));
        uint256 id_ = 0;
        ProtectedPayment.Escrow memory e_ = escrow.escrowOf(id_);
        assertEq(e_.payer, payer);
        assertEq(e_.payee, hbuBursar);
        assertEq(e_.token, address(tHKD));
        assertEq(e_.releaseAttester, issuerHbu);
        assertEq(e_.amount, 5_000 * U);
        assertEq(e_.conditionId, COND);
        assertEq(e_.createdAt, block.timestamp);
        assertEq(e_.refundAfter, refundAfter);
        assertEq(uint8(e_.state), uint8(ProtectedPayment.State.Held));
        assertEq(escrow.escrowCount(), 1);
        assertEq(tHKD.balanceOf(address(escrow)), 5_000 * U);
    }

    function test_create_malformedData_reverts_andMovesNothing() public {
        bytes[5] memory bad_ = [
            abi.encodePacked(_data(hbuBursar, issuerHbu), bytes1(0)), // 129 bytes
            abi.encode(hbuBursar, COND, issuerHbu), // 96 bytes
            _data(address(0), issuerHbu), // zero payee
            _data(hbuBursar, address(0)), // zero attester
            _data(hbuBursar, issuerHbu) // zero value (below)
        ];
        for (uint256 i; i < 5; ++i) {
            uint256 amount_ = i == 4 ? 0 : 100;
            vm.expectRevert(ProtectedPayment.InvalidEscrowData.selector);
            vm.prank(payer);
            tHKD.transferAndCall(address(escrow), amount_, bad_[i]);
        }
        assertEq(tHKD.balanceOf(payer), 10_000 * U);
        assertEq(escrow.escrowCount(), 0);
    }

    function test_release_onlyByAttester_once() public {
        uint256 id_ = _fund(5_000 * U);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, hbuBursar));
        vm.prank(hbuBursar);
        escrow.release(id_, bytes32(0));

        vm.expectEmit(true, true, true, true, address(escrow));
        emit EscrowReleased(id_, issuerHbu, keccak256("enrolled"));
        vm.prank(issuerHbu);
        escrow.release(id_, keccak256("enrolled"));
        assertEq(tHKD.balanceOf(hbuBursar), 5_000 * U);
        assertEq(uint8(escrow.escrowOf(id_).state), uint8(ProtectedPayment.State.Released));

        vm.expectRevert(abi.encodeWithSelector(ProtectedPayment.InvalidState.selector, id_));
        vm.prank(issuerHbu);
        escrow.release(id_, bytes32(0));
        vm.warp(refundAfter);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPayment.InvalidState.selector, id_));
        escrow.refund(id_);
    }

    function test_refund_onlyFromRefundTime_byAnyone() public {
        uint256 id_ = _fund(5_000 * U);
        vm.warp(refundAfter - 1);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPayment.TooEarly.selector, refundAfter));
        escrow.refund(id_);
        vm.warp(refundAfter);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit EscrowRefunded(id_);
        vm.prank(mirage);
        escrow.refund(id_);
        assertEq(tHKD.balanceOf(payer), 10_000 * U);
        assertEq(tHKD.balanceOf(mirage), 0);
        assertEq(uint8(escrow.escrowOf(id_).state), uint8(ProtectedPayment.State.Refunded));

        vm.expectRevert(abi.encodeWithSelector(ProtectedPayment.InvalidState.selector, id_));
        vm.prank(issuerHbu);
        escrow.release(id_, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ProtectedPayment.InvalidState.selector, id_));
        escrow.refund(id_);
    }

    function test_escrowsAreIndependent() public {
        uint256 a_ = _fund(1_000 * U);
        uint256 b_ = _fund(2_000 * U);
        vm.prank(issuerHbu);
        escrow.release(b_, bytes32(0));
        assertEq(tHKD.balanceOf(hbuBursar), 2_000 * U);
        assertEq(tHKD.balanceOf(address(escrow)), 1_000 * U);
        assertEq(uint8(escrow.escrowOf(a_).state), uint8(ProtectedPayment.State.Held));
    }

    function test_unknownEscrow_reverts() public {
        vm.expectRevert(stdError.indexOOBError);
        escrow.release(3, bytes32(0));
        vm.expectRevert(stdError.indexOOBError);
        escrow.refund(3);
        vm.expectRevert(stdError.indexOOBError);
        escrow.escrowOf(3);
    }

    function test_forgedNotificationCannotMoveRealFunds() public {
        _fund(5_000 * U);
        // Mirage calls the receiver hook directly, claiming 5,000 units: the escrow's token is Mirage itself (an address without code).
        vm.prank(mirage);
        escrow.onTransferReceived(mirage, mirage, 5_000 * U, abi.encode(mirage, COND, mirage, uint64(0)));
        assertEq(escrow.escrowOf(1).token, mirage);
        vm.expectRevert(abi.encodeWithSelector(Address.AddressEmptyCode.selector, mirage));
        vm.prank(mirage);
        escrow.release(1, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(Address.AddressEmptyCode.selector, mirage));
        escrow.refund(1);
        assertEq(tHKD.balanceOf(address(escrow)), 5_000 * U);
    }
}
