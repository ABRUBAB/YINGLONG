// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

/// @title ERC-8262-style zero-knowledge verifier router
/// @notice One entry point for every YINGLONG proof type. Proof type 0x01 = mandate compliance.
interface IZKVerifierRouter {
    /// @notice True iff `proof` is valid for `publicInputs` under the verifier registered for `proofType`.
    /// @param proofType Registered proof type (0x01 = mandate compliance).
    /// @param proof Raw proof bytes as produced by the prover.
    /// @param publicInputs Public inputs as consecutive 32-byte big-endian words, in circuit order.
    /// @dev Reverts on an unknown proof type or malformed public inputs; returns false for a rejected proof.
    function verifyProof(uint8 proofType, bytes calldata proof, bytes calldata publicInputs) external view returns (bool);

    /// @notice The verifier contract registered for `proofType`, or address(0).
    function verifierOf(uint8 proofType) external view returns (address);
}

/// @notice Interface of the bb-generated UltraHonk Solidity verifier (HonkVerifier).
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
