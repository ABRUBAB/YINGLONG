// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import { ModeLib } from "@erc7579/lib/ModeLib.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { ZKMandateEnforcer } from "../../src/zk/ZKMandateEnforcer.sol";
import { ZKVerifierRouter } from "../../src/zk/ZKVerifierRouter.sol";
import { InvalidTerms, InvalidArgs, Unauthorized, UndecodableExecution } from "../../src/utils/Errors.sol";

/// @notice Proof-free checks of ZKMandateEnforcer's public decoders and the router's registrar guard (the proof
/// paths are covered by test/zk with real fixtures).
contract ZKDecodingTest is Test {
    ZKMandateEnforcer internal zk;
    ZKVerifierRouter internal router;
    uint256 internal field;

    function setUp() public {
        zk = new ZKMandateEnforcer();
        router = new ZKVerifierRouter(address(this));
        field = zk.SNARK_SCALAR_FIELD();
    }

    function test_getTermsInfo_validAndInvalid() public {
        (address r_, bytes32 c_) = zk.getTermsInfo(abi.encode(address(router), bytes32(uint256(5))));
        assertEq(r_, address(router));
        assertEq(c_, bytes32(uint256(5)));
        vm.expectRevert(InvalidTerms.selector);
        zk.getTermsInfo(abi.encode(address(router)));
        vm.expectRevert(InvalidTerms.selector);
        zk.getTermsInfo(abi.encode(address(0), bytes32(uint256(5))));
        vm.expectRevert(InvalidTerms.selector);
        zk.getTermsInfo(abi.encode(uint256(uint160(address(router))) | (uint256(1) << 200), bytes32(uint256(5))));
        vm.expectRevert(InvalidTerms.selector);
        zk.getTermsInfo(abi.encode(address(router), bytes32(field)));
    }

    function test_getArgsInfo_canonicalEncodingOnly() public {
        bytes memory proof_ = hex"0102030405";
        (uint256 n_, uint64 t_, bytes32 c_, bytes memory p_) = zk.getArgsInfo(abi.encode(uint256(3), uint64(77), bytes32(uint256(9)), proof_));
        assertEq(n_, 3);
        assertEq(t_, 77);
        assertEq(c_, bytes32(uint256(9)));
        assertEq(p_, proof_);

        vm.expectRevert(InvalidArgs.selector);
        zk.getArgsInfo(new bytes(159)); // shorter than the head
        vm.expectRevert(InvalidArgs.selector);
        zk.getArgsInfo(abi.encodePacked(abi.encode(uint256(3), uint64(77), bytes32(uint256(9)), proof_), bytes32(0))); // trailing word
        vm.expectRevert(InvalidArgs.selector);
        zk.getArgsInfo(abi.encode(uint256(3), uint64(77), bytes32(0), proof_)); // zero commitment
        vm.expectRevert(InvalidArgs.selector);
        zk.getArgsInfo(abi.encode(field, uint64(77), bytes32(uint256(9)), proof_)); // nonce not a field element
    }

    function test_beforeHook_shortExecution_reverts() public {
        bytes memory terms_ = abi.encode(address(router), bytes32(uint256(5)));
        bytes memory args_ = abi.encode(uint256(3), uint64(block.timestamp), bytes32(uint256(9)), hex"00");
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, bytes4(0)));
        zk.beforeHook(terms_, args_, ModeLib.encodeSimpleSingle(), new bytes(51), bytes32(0), address(1), address(2));
        bytes memory exec_ = ExecutionLib.encodeSingle(address(3), 0, abi.encodeWithSelector(bytes4(0xa9059cbb), address(4), 1));
        vm.expectRevert(InvalidArgs.selector);
        zk.beforeHook(terms_, new bytes(64), ModeLib.encodeSimpleSingle(), exec_, bytes32(0), address(1), address(2));
    }

    function test_router_renounceOnlyByRegistrar() public {
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, address(0xbeef)));
        vm.prank(address(0xbeef));
        router.renounceRegistrar();
    }
}
