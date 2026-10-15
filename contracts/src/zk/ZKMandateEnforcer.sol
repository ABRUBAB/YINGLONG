// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { ModeLib } from "@erc7579/lib/ModeLib.sol";
import { CaveatEnforcer } from "@delegation-framework/enforcers/CaveatEnforcer.sol";
import { CALLTYPE_SINGLE, EXECTYPE_DEFAULT } from "@delegation-framework/utils/Constants.sol";
import { CallType, ExecType, ModeCode } from "@delegation-framework/utils/Types.sol";

import {
    InvalidArgs,
    InvalidExecutionMode,
    InvalidMandateProof,
    InvalidTerms,
    NativeValueNotAllowed,
    NonceAlreadyUsed,
    UndecodableExecution
} from "../utils/Errors.sol";
import { IZKVerifierRouter } from "./IZKVerifierRouter.sol";
import { AmountOutOfRange, ClaimedTimeOutOfRange } from "./ZKErrors.sol";

/// @title ZKMandateEnforcer
/// @notice Private, stateful mandate for ERC-20 payments. The user seals a Poseidon2 commitment to
/// (cap, allowlist root, expiry, salt); nothing else about the mandate is on-chain. For every
/// redemption the agent proves in zero knowledge (circuits/mandate_compliance, proof type 0x01) that
/// the payee is in the hidden allowlist, the claimed time T is not after the hidden expiry, and the
/// running total stays within the hidden cap. The running total itself is carried as a hiding
/// commitment Poseidon2(total, blind) that this enforcer stores per (DelegationManager, delegationHash).
///
/// Terms (signed by the user, trusted): abi.encode(address router, bytes32 mandateCommitment).
/// Args (from the redeemer, untrusted; only the proof gives them meaning):
///   abi.encode(uint256 nonce, uint64 claimedTime, bytes32 newRunningCommitment, bytes proof).
///
/// Public inputs, in circuit order: mandateCommitment, delegationHash hi 128 bits, delegationHash lo
/// 128 bits, block.chainid, payee, amount, nonce, claimedTime, oldRunningCommitment, newRunningCommitment.
/// Payee and amount are decoded here from the execution calldata, never taken from args.
///
/// Clock rule: the circuit proves T <= expiry; this enforcer accepts T only if
/// block.timestamp - 300 <= T <= block.timestamp + 60. A proof therefore stays usable for five minutes
/// (proving time plus inclusion), may run at most 60 s ahead of the chain clock, and a payment can land
/// at most 300 s after the hidden expiry.
///
/// First payment: the stored running commitment starts as Poseidon2(0, 0) (INITIAL_RUNNING_COMMITMENT).
///
/// The token is not part of the statement: pair this caveat with AllowedTargets restricted to a single
/// ERC-20, otherwise one running total would count units of several tokens.
/// @dev Single call type and default execution type only. State is keyed by msg.sender (the
/// DelegationManager). No immutables: identical runtime bytecode on every chain.
contract ZKMandateEnforcer is CaveatEnforcer {
    using ExecutionLib for bytes;

    ////////////////////////////// Constants //////////////////////////////

    /// @notice Router proof type for the mandate compliance circuit.
    uint8 public constant PROOF_TYPE_MANDATE_COMPLIANCE = 0x01;

    /// @notice Poseidon2(0, 0): the old running commitment of the first payment under a delegation.
    bytes32 public constant INITIAL_RUNNING_COMMITMENT = 0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1;

    /// @notice BN254 scalar field modulus; every public input must be below it.
    uint256 public constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @notice How far T may trail block.timestamp (seconds).
    uint256 public constant MAX_CLAIMED_TIME_AGE = 300;

    /// @notice How far T may run ahead of block.timestamp (seconds).
    uint256 public constant MAX_CLAIMED_TIME_SKEW = 60;

    /// @notice Number of public inputs of the mandate compliance circuit.
    uint256 public constant NUM_PUBLIC_INPUTS = 10;

    bytes4 private constant _TRANSFER_SELECTOR = 0xa9059cbb; // transfer(address,uint256)
    uint256 private constant _ARGS_HEAD = 0xa0; // 4 head words + proof length word

    ////////////////////////////// State //////////////////////////////

    mapping(address delegationManager => mapping(bytes32 delegationHash => bytes32 commitment)) private _running;

    /// @notice Nonces already redeemed per (DelegationManager, delegationHash).
    mapping(address delegationManager => mapping(bytes32 delegationHash => mapping(uint256 nonce => bool used))) public nonceUsed;

    ////////////////////////////// Events //////////////////////////////

    event MandatePaymentProven(
        address indexed delegationManager,
        bytes32 indexed delegationHash,
        address indexed redeemer,
        address token,
        address payee,
        uint256 amount,
        uint256 nonce,
        uint64 claimedTime,
        bytes32 newRunningCommitment
    );

    ////////////////////////////// Hooks //////////////////////////////

    /// @notice Verifies the mandate compliance proof for one ERC-20 transfer, then consumes the nonce and
    /// advances the running commitment.
    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
        address,
        address _redeemer
    )
        public
        override
        onlyTypedSingleDefaultMode(_mode)
        onlySingleCallTypeMode(_mode)
        onlyDefaultExecutionMode(_mode)
    {
        Payment memory p_ = _parse(_terms, _args, _executionCallData);

        if (
            block.timestamp > uint256(p_.claimedTime) + MAX_CLAIMED_TIME_AGE
                || uint256(p_.claimedTime) > block.timestamp + MAX_CLAIMED_TIME_SKEW
        ) revert ClaimedTimeOutOfRange(p_.claimedTime, block.timestamp);

        if (nonceUsed[msg.sender][_delegationHash][p_.nonce]) revert NonceAlreadyUsed(p_.nonce);

        _verify(p_, _delegationHash, _args);

        nonceUsed[msg.sender][_delegationHash][p_.nonce] = true;
        _running[msg.sender][_delegationHash] = p_.newRunning;

        emit MandatePaymentProven(
            msg.sender, _delegationHash, _redeemer, p_.token, p_.payee, p_.amount, p_.nonce, p_.claimedTime, p_.newRunning
        );
    }

    ////////////////////////////// Views //////////////////////////////

    /// @notice Current running commitment for (delegationManager, delegationHash); Poseidon2(0, 0) before
    /// the first payment.
    function runningCommitment(address _delegationManager, bytes32 _delegationHash) public view returns (bytes32) {
        bytes32 c_ = _running[_delegationManager][_delegationHash];
        return c_ == bytes32(0) ? INITIAL_RUNNING_COMMITMENT : c_;
    }

    /// @notice Decodes and validates the terms: abi.encode(address router, bytes32 mandateCommitment).
    function getTermsInfo(bytes calldata _terms) public pure returns (address router_, bytes32 mandateCommitment_) {
        if (_terms.length != 64) revert InvalidTerms();
        uint256 routerWord_ = uint256(bytes32(_terms[0:32]));
        if (routerWord_ >> 160 != 0 || routerWord_ == 0) revert InvalidTerms();
        mandateCommitment_ = bytes32(_terms[32:64]);
        if (uint256(mandateCommitment_) >= SNARK_SCALAR_FIELD) revert InvalidTerms();
        router_ = address(uint160(routerWord_));
    }

    /// @notice Decodes and validates the args (strict canonical ABI encoding).
    function getArgsInfo(bytes calldata _args)
        external
        pure
        returns (uint256 nonce_, uint64 claimedTime_, bytes32 newRunningCommitment_, bytes memory proof_)
    {
        (nonce_, claimedTime_, newRunningCommitment_, proof_) = _decodeArgs(_args);
    }

    ////////////////////////////// Internal //////////////////////////////

    /// @dev Everything the hook needs except the proof bytes (kept as a calldata slice, see _proof).
    struct Payment {
        address router;
        bytes32 mandateCommitment;
        address token;
        address payee;
        uint256 amount;
        uint256 nonce;
        uint64 claimedTime;
        bytes32 newRunning;
    }

    /// @dev Typed version of the base modifiers' checks, run first so a refusal carries a YINGLONG error.
    /// The framework's own modifiers stay in place behind it.
    modifier onlyTypedSingleDefaultMode(ModeCode _mode) {
        _requireSingleDefaultMode(_mode);
        _;
    }

    function _requireSingleDefaultMode(ModeCode _mode) internal pure {
        (CallType callType_, ExecType execType_,,) = ModeLib.decode(_mode);
        if (!(callType_ == CALLTYPE_SINGLE) || !(execType_ == EXECTYPE_DEFAULT)) revert InvalidExecutionMode();
    }

    function _parse(
        bytes calldata _terms,
        bytes calldata _args,
        bytes calldata _executionCallData
    )
        internal
        pure
        returns (Payment memory p_)
    {
        (p_.router, p_.mandateCommitment) = getTermsInfo(_terms);
        (p_.token, p_.payee, p_.amount) = _decodeTransfer(_executionCallData);
        (p_.nonce, p_.claimedTime, p_.newRunning,) = _decodeArgs(_args);
    }

    /// @dev The 10 public inputs, in circuit order, as consecutive 32-byte words.
    function _publicInputs(Payment memory _p, bytes32 _delegationHash, bytes32 _oldRunning) internal view returns (bytes memory) {
        return abi.encode(
            _p.mandateCommitment,
            uint256(_delegationHash) >> 128,
            uint256(_delegationHash) & type(uint128).max,
            block.chainid,
            uint256(uint160(_p.payee)),
            _p.amount,
            _p.nonce,
            uint256(_p.claimedTime),
            _oldRunning,
            _p.newRunning
        );
    }

    /// @dev Verifies the proof against the stored running commitment through the router named in the terms.
    function _verify(Payment memory _p, bytes32 _delegationHash, bytes calldata _args) internal view {
        bytes memory publicInputs_ = _publicInputs(_p, _delegationHash, runningCommitment(msg.sender, _delegationHash));
        bytes calldata proof_ = _proof(_args);
        if (!IZKVerifierRouter(_p.router).verifyProof(PROOF_TYPE_MANDATE_COMPLIANCE, proof_, publicInputs_)) {
            revert InvalidMandateProof();
        }
    }

    /// @dev Proof bytes of already validated args.
    function _proof(bytes calldata _args) internal pure returns (bytes calldata proof_) {
        (,,, proof_) = _decodeArgs(_args);
    }

    /// @dev Single execution must be an ERC-20 transfer(address,uint256) with zero native value.
    function _decodeTransfer(bytes calldata _executionCallData)
        internal
        pure
        returns (address token_, address payee_, uint256 amount_)
    {
        if (_executionCallData.length < 52) revert UndecodableExecution(bytes4(0));
        (address target_, uint256 value_, bytes calldata callData_) = _executionCallData.decodeSingle();
        if (value_ != 0) revert NativeValueNotAllowed(value_);
        bytes4 selector_ = callData_.length >= 4 ? bytes4(callData_[0:4]) : bytes4(0);
        if (selector_ != _TRANSFER_SELECTOR || callData_.length != 68) revert UndecodableExecution(selector_);
        uint256 payeeWord_ = uint256(bytes32(callData_[4:36]));
        if (payeeWord_ >> 160 != 0) revert UndecodableExecution(selector_);
        amount_ = uint256(bytes32(callData_[36:68]));
        if (amount_ > type(uint128).max) revert AmountOutOfRange(amount_);
        token_ = target_;
        payee_ = address(uint160(payeeWord_));
    }

    /// @dev Accepts exactly abi.encode(uint256, uint64, bytes32, bytes) and nothing else. Nonce and new
    /// running commitment must be field elements; a zero commitment is refused (zero means unset).
    function _decodeArgs(bytes calldata _args)
        internal
        pure
        returns (uint256 nonce_, uint64 claimedTime_, bytes32 newRunning_, bytes calldata proof_)
    {
        if (_args.length < _ARGS_HEAD) revert InvalidArgs();
        nonce_ = uint256(bytes32(_args[0:32]));
        uint256 time_ = uint256(bytes32(_args[32:64]));
        newRunning_ = bytes32(_args[64:96]);
        uint256 offset_ = uint256(bytes32(_args[96:128]));
        uint256 len_ = uint256(bytes32(_args[128:160]));
        if (
            time_ > type(uint64).max || offset_ != 0x80 || len_ > _args.length - _ARGS_HEAD
                || _args.length != _ARGS_HEAD + ((len_ + 31) & ~uint256(31))
        ) revert InvalidArgs();
        if (nonce_ >= SNARK_SCALAR_FIELD || newRunning_ == bytes32(0) || uint256(newRunning_) >= SNARK_SCALAR_FIELD) {
            revert InvalidArgs();
        }
        claimedTime_ = uint64(time_);
        proof_ = _args[_ARGS_HEAD:_ARGS_HEAD + len_];
    }
}
