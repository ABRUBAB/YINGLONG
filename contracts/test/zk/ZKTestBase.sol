// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";

/// @notice Shared helpers for the zero-knowledge tests: deploys the bb-generated UltraHonk verifier from
/// its exported artifact (compiled separately with solc 0.8.27 for london, see circuits/verifier) and
/// reads the real-proof fixtures produced by circuits/prover/scripts/make-fixtures.ts.
abstract contract ZKTestBase is Test {
    string internal constant ARTIFACT_PATH = "test/vectors/zk/HonkVerifier.artifact.json";
    string internal constant FIXTURES_PATH = "test/vectors/zk/mandate_compliance.fixtures.json";

    string internal artifactJson;
    string internal fx;

    address internal relationsLib;
    address internal transcriptLib;
    address internal honkVerifier;

    function _loadVectors() internal {
        artifactJson = vm.readFile(ARTIFACT_PATH);
        fx = vm.readFile(FIXTURES_PATH);
    }

    /// @dev Deploys RelationsLib and ZKTranscriptLib, links them into the verifier creation code at the
    /// exported offsets, deploys the verifier and checks its runtime code against the artifact.
    function _deployHonkVerifier() internal returns (address verifier_) {
        relationsLib = _create(vm.parseJsonBytes(artifactJson, ".relationsLib.bytecode"));
        transcriptLib = _create(vm.parseJsonBytes(artifactJson, ".transcriptLib.bytecode"));

        bytes memory code_ = vm.parseJsonBytes(artifactJson, ".verifier.bytecode");
        _link(code_, vm.parseJsonUintArray(artifactJson, ".verifier.relationsLibOffsets"), relationsLib);
        _link(code_, vm.parseJsonUintArray(artifactJson, ".verifier.transcriptLibOffsets"), transcriptLib);
        verifier_ = _create(code_);

        bytes memory runtime_ = vm.parseJsonBytes(artifactJson, ".verifier.deployedBytecode");
        _link(runtime_, vm.parseJsonUintArray(artifactJson, ".verifier.deployedRelationsLibOffsets"), relationsLib);
        _link(runtime_, vm.parseJsonUintArray(artifactJson, ".verifier.deployedTranscriptLibOffsets"), transcriptLib);
        // Immutables (N, LOG_N, VK_HASH, public input count, MSM size) are filled by the constructor from
        // compile-time constants; copy those slots, compare everything else byte for byte.
        bytes memory deployed_ = verifier_.code;
        uint256[] memory imm_ = vm.parseJsonUintArray(artifactJson, ".verifier.deployedImmutableOffsets");
        assertEq(deployed_.length, runtime_.length, "verifier runtime length differs from the artifact");
        for (uint256 i = 0; i < imm_.length; ++i) {
            for (uint256 j = 0; j < 32; ++j) {
                require(runtime_[imm_[i] + j] == 0, "immutable slot not zero in artifact");
                runtime_[imm_[i] + j] = deployed_[imm_[i] + j];
            }
        }
        assertEq(keccak256(deployed_), keccak256(runtime_), "verifier runtime differs from the artifact");
        honkVerifier = verifier_;
    }

    function _create(bytes memory _code) internal returns (address addr_) {
        assembly {
            addr_ := create(0, add(_code, 0x20), mload(_code))
        }
        require(addr_ != address(0) && addr_.code.length != 0, "create failed");
    }

    function _link(bytes memory _code, uint256[] memory _offsets, address _lib) internal pure {
        require(_offsets.length != 0, "no link offsets");
        bytes20 lib_ = bytes20(_lib);
        for (uint256 i = 0; i < _offsets.length; ++i) {
            uint256 off_ = _offsets[i];
            require(off_ + 20 <= _code.length, "link offset out of range");
            for (uint256 j = 0; j < 20; ++j) {
                require(_code[off_ + j] == 0, "link slot not zero");
                _code[off_ + j] = lib_[j];
            }
        }
    }

    ////////////////////////////// Fixture getters //////////////////////////////

    function _key(string memory _case, string memory _field) internal pure returns (string memory) {
        return string.concat(".cases.", _case, ".", _field);
    }

    function _fxBytes(string memory _case, string memory _field) internal view returns (bytes memory) {
        return vm.parseJsonBytes(fx, _key(_case, _field));
    }

    function _fxUint(string memory _case, string memory _field) internal view returns (uint256) {
        return vm.parseJsonUint(fx, _key(_case, _field));
    }

    function _fxAddress(string memory _case, string memory _field) internal view returns (address) {
        return vm.parseJsonAddress(fx, _key(_case, _field));
    }

    function _fxBytes32(string memory _case, string memory _field) internal view returns (bytes32) {
        return vm.parseJsonBytes32(fx, _key(_case, _field));
    }
}
