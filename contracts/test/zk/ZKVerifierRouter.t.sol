// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Unauthorized } from "../../src/utils/Errors.sol";
import { ZKVerifierRouter } from "../../src/zk/ZKVerifierRouter.sol";
import { MalformedPublicInputs, ProofTypeAlreadyRegistered, UnknownProofType, VerifierHasNoCode } from "../../src/zk/ZKErrors.sol";
import { ZKTestBase } from "./ZKTestBase.sol";

contract ZKVerifierRouterTest is ZKTestBase {
    uint8 internal constant MANDATE = 0x01;
    ZKVerifierRouter internal router;

    event VerifierRegistered(uint8 indexed proofType, address indexed verifier);

    function setUp() public {
        _loadVectors();
        _deployHonkVerifier();
        router = new ZKVerifierRouter(address(this));
        vm.expectEmit(true, true, false, false, address(router));
        emit VerifierRegistered(MANDATE, honkVerifier);
        router.registerVerifier(MANDATE, honkVerifier);
    }

    function test_validProof_true() public {
        assertTrue(router.verifyProof(MANDATE, _fxBytes("p1", "proof"), _fxBytes("p1", "publicInputs")));
        assertEq(router.verifierOf(MANDATE), honkVerifier);
        assertEq(router.PROOF_TYPE_MANDATE_COMPLIANCE(), MANDATE);
    }

    function test_proofForOtherInputs_false() public {
        // p2's proof against p1's public inputs.
        assertFalse(router.verifyProof(MANDATE, _fxBytes("p2", "proof"), _fxBytes("p1", "publicInputs")));
    }

    function test_eachPublicInputIsBound() public {
        bytes memory proof_ = _fxBytes("p1", "proof");
        bytes memory pi_ = _fxBytes("p1", "publicInputs");
        for (uint256 i = 0; i < 10; ++i) {
            bytes memory t_ = bytes.concat(pi_);
            t_[i * 32 + 31] = bytes1(uint8(t_[i * 32 + 31]) ^ 0x01);
            assertFalse(router.verifyProof(MANDATE, proof_, t_), "a public input is not bound by the proof");
        }
    }

    function test_publicInputAboveFieldModulus_false() public {
        // nonce (word 6) replaced by nonce + p: same value inside the field, refused by the verifier.
        bytes memory pi_ = _fxBytes("p1", "publicInputs");
        uint256 p_ = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        uint256 nonce_ = _fxUint("p1", "nonce");
        bytes memory t_ = bytes.concat(pi_);
        bytes32 aliased_ = bytes32(nonce_ + p_);
        for (uint256 j = 0; j < 32; ++j) {
            t_[6 * 32 + j] = aliased_[j];
        }
        assertFalse(router.verifyProof(MANDATE, _fxBytes("p1", "proof"), t_));
    }

    function test_wrongNumberOfPublicInputs_false() public {
        bytes memory pi_ = _fxBytes("p1", "publicInputs");
        assertFalse(router.verifyProof(MANDATE, _fxBytes("p1", "proof"), bytes.concat(pi_, bytes32(0))));
    }

    function test_truncatedProof_false() public {
        bytes memory proof_ = _fxBytes("p1", "proof");
        assembly {
            mstore(proof_, sub(mload(proof_), 32))
        }
        assertFalse(router.verifyProof(MANDATE, proof_, _fxBytes("p1", "publicInputs")));
    }

    function test_unknownProofType_reverts() public {
        bytes memory proof_ = _fxBytes("p1", "proof");
        bytes memory pi_ = _fxBytes("p1", "publicInputs");
        vm.expectRevert(abi.encodeWithSelector(UnknownProofType.selector, uint8(0x02)));
        router.verifyProof(0x02, proof_, pi_);
    }

    function test_malformedPublicInputs_reverts() public {
        bytes memory proof_ = _fxBytes("p1", "proof");
        vm.expectRevert(abi.encodeWithSelector(MalformedPublicInputs.selector, uint256(33)));
        router.verifyProof(MANDATE, proof_, new bytes(33));
    }

    function test_registrationIsAppendOnly() public {
        vm.expectRevert(abi.encodeWithSelector(ProofTypeAlreadyRegistered.selector, MANDATE));
        router.registerVerifier(MANDATE, address(router));
    }

    function test_onlyRegistrar() public {
        address stranger_ = makeAddr("stranger");
        vm.prank(stranger_);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, stranger_));
        router.registerVerifier(0x02, honkVerifier);
    }

    function test_verifierMustHaveCode() public {
        address eoa_ = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(VerifierHasNoCode.selector, eoa_));
        router.registerVerifier(0x02, eoa_);
    }

    function test_renounceFreezesRouter() public {
        router.renounceRegistrar();
        assertEq(router.registrar(), address(0));
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, address(this)));
        router.registerVerifier(0x02, honkVerifier);
        assertTrue(router.verifyProof(MANDATE, _fxBytes("p1", "proof"), _fxBytes("p1", "publicInputs")));
    }
}
