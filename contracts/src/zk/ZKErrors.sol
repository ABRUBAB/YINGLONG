// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

/// @title Typed errors used only by the zero-knowledge contracts
/// @notice Shared YINGLONG errors live in src/utils/Errors.sol; these cover the router and the clock
/// rule of ZKMandateEnforcer.

/// @notice No verifier is registered for this proof type.
error UnknownProofType(uint8 proofType);
/// @notice Verifiers are append-only: a registered proof type can never be re-pointed.
error ProofTypeAlreadyRegistered(uint8 proofType);
/// @notice The verifier address has no code.
error VerifierHasNoCode(address verifier);
/// @notice Public inputs must be a whole number of 32-byte words.
error MalformedPublicInputs(uint256 length);
/// @notice The proof's claimed time T is outside [block.timestamp - 300, block.timestamp + 60].
error ClaimedTimeOutOfRange(uint64 claimedTime, uint256 blockTimestamp);
/// @notice The transfer amount does not fit the circuit's u128 amount.
error AmountOutOfRange(uint256 amount);
