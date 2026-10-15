// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Unauthorized } from "../utils/Errors.sol";

/// @title ProtectedPayment
/// @notice Protected prepayment (escrow) for the tuition-deposit and supplier-prepayment scenarios. The payer
/// funds an escrow in one ERC-1363 `transferAndCall`; the funds are released to the payee only when the
/// named release attester (e.g. the university confirming enrolment) releases them, or refunded to the payer
/// after the refund time. Nobody else can move escrowed funds.
/// Data layout for `transferAndCall`: abi.encode(address payee, bytes32 conditionId, address releaseAttester,
/// uint64 refundAfter). The first word is the payee, which is what YINGLONG's payee rules check.
contract ProtectedPayment is ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes4 internal constant ERC1363_RECEIVED = 0x88a7ca5c;

    enum State {
        None,
        Held,
        Released,
        Refunded
    }

    struct Escrow {
        address payer;
        address payee;
        address token;
        address releaseAttester;
        uint256 amount;
        bytes32 conditionId;
        uint64 createdAt;
        uint64 refundAfter;
        State state;
    }

    Escrow[] private _escrows;

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

    error InvalidState(uint256 escrowId);
    error TooEarly(uint64 refundAfter);
    error InvalidEscrowData();

    function onTransferReceived(address, address _from, uint256 _value, bytes calldata _data)
        external
        nonReentrant
        returns (bytes4)
    {
        if (_data.length != 128) revert InvalidEscrowData();
        (address payee_, bytes32 conditionId_, address attester_, uint64 refundAfter_) =
            abi.decode(_data, (address, bytes32, address, uint64));
        if (payee_ == address(0) || attester_ == address(0) || _value == 0) revert InvalidEscrowData();
        uint256 id_ = _escrows.length;
        _escrows.push(
            Escrow({
                payer: _from,
                payee: payee_,
                token: msg.sender,
                releaseAttester: attester_,
                amount: _value,
                conditionId: conditionId_,
                createdAt: uint64(block.timestamp),
                refundAfter: refundAfter_,
                state: State.Held
            })
        );
        emit EscrowCreated(id_, _from, payee_, msg.sender, _value, conditionId_, attester_, refundAfter_);
        return ERC1363_RECEIVED;
    }

    /// @notice The release attester confirms the condition (e.g. enrolment) and releases funds to the payee.
    function release(uint256 _escrowId, bytes32 _evidenceHash) external nonReentrant {
        Escrow storage e_ = _escrows[_escrowId];
        if (e_.state != State.Held) revert InvalidState(_escrowId);
        if (msg.sender != e_.releaseAttester) revert Unauthorized(msg.sender);
        e_.state = State.Released;
        IERC20(e_.token).safeTransfer(e_.payee, e_.amount);
        emit EscrowReleased(_escrowId, msg.sender, _evidenceHash);
    }

    /// @notice Anyone may return unreleased funds to the payer after the refund time.
    function refund(uint256 _escrowId) external nonReentrant {
        Escrow storage e_ = _escrows[_escrowId];
        if (e_.state != State.Held) revert InvalidState(_escrowId);
        if (block.timestamp < e_.refundAfter) revert TooEarly(e_.refundAfter);
        e_.state = State.Refunded;
        IERC20(e_.token).safeTransfer(e_.payer, e_.amount);
        emit EscrowRefunded(_escrowId);
    }

    function escrowOf(uint256 _escrowId) external view returns (Escrow memory) {
        return _escrows[_escrowId];
    }

    function escrowCount() external view returns (uint256) {
        return _escrows.length;
    }
}
