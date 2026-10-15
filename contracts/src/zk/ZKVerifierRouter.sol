// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Unauthorized } from "../utils/Errors.sol";
import { IHonkVerifier, IZKVerifierRouter } from "./IZKVerifierRouter.sol";
import { MalformedPublicInputs, ProofTypeAlreadyRegistered, UnknownProofType, VerifierHasNoCode } from "./ZKErrors.sol";

/// @title ZKVerifierRouter
/// @notice ERC-8262-style router: `verifyProof(proofType, proof, publicInputs)` dispatches to the verifier
/// registered for that proof type. Registration is append-only (a proof type can never be re-pointed, so
/// a sealed mandate that names this router can never have its verifier swapped) and only the registrar
/// can register. The registrar can renounce, which freezes the router.
/// @dev No immutables: the runtime bytecode is identical on every chain.
contract ZKVerifierRouter is IZKVerifierRouter {
    /// @notice Proof type of the private mandate compliance circuit (circuits/mandate_compliance).
    uint8 public constant PROOF_TYPE_MANDATE_COMPLIANCE = 0x01;

    /// @notice Account allowed to register new proof types; address(0) once renounced.
    address public registrar;

    /// @inheritdoc IZKVerifierRouter
    mapping(uint8 proofType => address verifier) public verifierOf;

    event VerifierRegistered(uint8 indexed proofType, address indexed verifier);
    event RegistrarRenounced(address indexed registrar);

    constructor(address registrar_) {
        registrar = registrar_;
    }

    /// @notice Register the verifier for a new proof type. Append-only.
    function registerVerifier(uint8 proofType, address verifier) external {
        if (msg.sender != registrar) revert Unauthorized(msg.sender);
        if (verifierOf[proofType] != address(0)) revert ProofTypeAlreadyRegistered(proofType);
        if (verifier.code.length == 0) revert VerifierHasNoCode(verifier);
        verifierOf[proofType] = verifier;
        emit VerifierRegistered(proofType, verifier);
    }

    /// @notice Give up the registrar role for good; no further proof types can be added.
    function renounceRegistrar() external {
        if (msg.sender != registrar) revert Unauthorized(msg.sender);
        registrar = address(0);
        emit RegistrarRenounced(msg.sender);
    }

    /// @inheritdoc IZKVerifierRouter
    function verifyProof(uint8 proofType, bytes calldata proof, bytes calldata publicInputs) external view returns (bool) {
        address verifier = verifierOf[proofType];
        if (verifier == address(0)) revert UnknownProofType(proofType);
        if (publicInputs.length % 32 != 0) revert MalformedPublicInputs(publicInputs.length);

        uint256 n = publicInputs.length / 32;
        bytes32[] memory words = new bytes32[](n);
        for (uint256 i = 0; i < n; ++i) {
            words[i] = bytes32(publicInputs[i * 32:(i + 1) * 32]);
        }

        // The generated verifier reverts on most rejections (SumcheckFailed, ShpleminiFailed,
        // ProofLengthWrong, ValueGeFieldOrder, ...). Normalise every outcome to a bool.
        (bool ok, bytes memory ret) = verifier.staticcall(abi.encodeWithSelector(IHonkVerifier.verify.selector, proof, words));
        return ok && ret.length == 32 && abi.decode(ret, (bool));
    }
}
