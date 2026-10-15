// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { ModeLib, ModeSelector, ModePayload } from "@erc7579/lib/ModeLib.sol";
import { CALLTYPE_BATCH, CALLTYPE_SINGLE, EXECTYPE_DEFAULT, EXECTYPE_TRY } from "@delegation-framework/utils/Constants.sol";
import { ModeCode } from "@delegation-framework/utils/Types.sol";

import {
    InvalidArgs,
    InvalidExecutionMode,
    InvalidMandateProof,
    InvalidTerms,
    NativeValueNotAllowed,
    NonceAlreadyUsed,
    UndecodableExecution
} from "../../src/utils/Errors.sol";
import { ZKMandateEnforcer } from "../../src/zk/ZKMandateEnforcer.sol";
import { ZKVerifierRouter } from "../../src/zk/ZKVerifierRouter.sol";
import { AmountOutOfRange, ClaimedTimeOutOfRange } from "../../src/zk/ZKErrors.sol";
import { ZKTestBase } from "./ZKTestBase.sol";

/// @notice ZKMandateEnforcer with REAL UltraHonk proofs (contracts/test/vectors/zk). The test contract
/// plays the DelegationManager (msg.sender of the hooks); ZKMandateEnforcerDM.t.sol runs the same caveat
/// through the real DelegationManager.
contract ZKMandateEnforcerTest is ZKTestBase {
    address internal constant TOKEN = address(0x7E57);
    uint8 internal constant MANDATE = 0x01;

    ZKVerifierRouter internal router;
    ZKMandateEnforcer internal enforcer;

    bytes32 internal delegationHash;
    bytes32 internal commitment;
    ModeCode internal singleMode;
    address internal delegator = makeAddr("delegator");
    address internal agent = makeAddr("agent");

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

    function setUp() public {
        _loadVectors();
        address verifier_ = _deployHonkVerifier();
        router = new ZKVerifierRouter(address(this));
        router.registerVerifier(MANDATE, verifier_);
        enforcer = new ZKMandateEnforcer();

        delegationHash = vm.parseJsonBytes32(fx, ".delegationHash");
        commitment = vm.parseJsonBytes32(fx, ".mandateCommitment");
        vm.chainId(vm.parseJsonUint(fx, ".chainId"));
        singleMode = ModeLib.encodeSimpleSingle();
    }

    ////////////////////////////// Helpers //////////////////////////////

    function _terms() internal view returns (bytes memory) {
        return abi.encode(address(router), commitment);
    }

    function _exec(address _payee, uint256 _amount) internal pure returns (bytes memory) {
        return ExecutionLib.encodeSingle(TOKEN, 0, abi.encodeWithSelector(IERC20.transfer.selector, _payee, _amount));
    }

    function _execOf(string memory _c) internal view returns (bytes memory) {
        return _exec(_fxAddress(_c, "payee"), _fxUint(_c, "amount"));
    }

    function _args(string memory _c, uint256 _nonce, uint64 _t) internal view returns (bytes memory) {
        return abi.encode(_nonce, _t, _fxBytes32(_c, "newRunningCommitment"), _fxBytes(_c, "proof"));
    }

    function _time(string memory _c) internal view returns (uint64) {
        return uint64(_fxUint(_c, "claimedTime"));
    }

    function _hook(bytes memory _args_, bytes memory _exec_) internal {
        enforcer.beforeHook(_terms(), _args_, singleMode, _exec_, delegationHash, delegator, agent);
    }

    /// @dev Redeems fixture case `_c` exactly as generated, at block time T.
    function _redeem(string memory _c) internal returns (uint256 gasUsed_) {
        vm.warp(_time(_c));
        bytes memory args_ = _fxBytes(_c, "args");
        bytes memory exec_ = _execOf(_c);
        bytes memory terms_ = _terms();
        uint256 g_ = gasleft();
        enforcer.beforeHook(terms_, args_, singleMode, exec_, delegationHash, delegator, agent);
        gasUsed_ = g_ - gasleft();
    }

    ////////////////////////////// Fixture integrity //////////////////////////////

    function test_fixtureArgsMatchSolidityAbiEncoding() public {
        string[5] memory cases_ = ["p1", "p2", "p3", "overCap", "atExpiry"];
        for (uint256 i = 0; i < cases_.length; ++i) {
            assertEq(
                _fxBytes(cases_[i], "args"),
                _args(cases_[i], _fxUint(cases_[i], "nonce"), _time(cases_[i])),
                "TypeScript args encoding differs from abi.encode"
            );
        }
    }

    function test_initialRunningCommitmentMatchesProver() public {
        assertEq(enforcer.INITIAL_RUNNING_COMMITMENT(), vm.parseJsonBytes32(fx, ".initialRunningCommitment"));
        assertEq(enforcer.runningCommitment(address(this), delegationHash), enforcer.INITIAL_RUNNING_COMMITMENT());
    }

    function test_publicInputLayoutMatchesProver() public {
        // The router accepts the prover's own packed public inputs for every fixture case.
        string[5] memory cases_ = ["p1", "p2", "p3", "overCap", "atExpiry"];
        for (uint256 i = 0; i < cases_.length; ++i) {
            assertTrue(router.verifyProof(MANDATE, _fxBytes(cases_[i], "proof"), _fxBytes(cases_[i], "publicInputs")));
        }
        // And the enforcer builds the same bytes from terms, calldata and args.
        bytes memory expected_ = abi.encode(
            commitment,
            uint256(delegationHash) >> 128,
            uint256(delegationHash) & type(uint128).max,
            block.chainid,
            uint256(uint160(_fxAddress("p1", "payee"))),
            _fxUint("p1", "amount"),
            _fxUint("p1", "nonce"),
            uint256(_time("p1")),
            _fxBytes32("p1", "oldRunningCommitment"),
            _fxBytes32("p1", "newRunningCommitment")
        );
        assertEq(expected_, _fxBytes("p1", "publicInputs"));
    }

    ////////////////////////////// Happy path //////////////////////////////

    function test_validProof_passes_and_advancesState() public {
        vm.expectEmit(true, true, true, true, address(enforcer));
        emit MandatePaymentProven(
            address(this),
            delegationHash,
            agent,
            TOKEN,
            _fxAddress("p1", "payee"),
            _fxUint("p1", "amount"),
            1,
            _time("p1"),
            _fxBytes32("p1", "newRunningCommitment")
        );
        uint256 gas_ = _redeem("p1");
        emit log_named_uint("gas.zk.beforeHook.firstPayment", gas_);

        assertTrue(enforcer.nonceUsed(address(this), delegationHash, 1));
        assertEq(enforcer.runningCommitment(address(this), delegationHash), _fxBytes32("p1", "newRunningCommitment"));
    }

    function test_chainOfThree_reachesCapExactly() public {
        _redeem("p1");
        uint256 gas2_ = _redeem("p2");
        uint256 gas3_ = _redeem("p3");
        emit log_named_uint("gas.zk.beforeHook.laterPayment", gas2_);
        emit log_named_uint("gas.zk.beforeHook.laterPayment.atCap", gas3_);
        assertEq(enforcer.runningCommitment(address(this), delegationHash), _fxBytes32("p3", "newRunningCommitment"));
    }

    function test_gas_verifyPath() public {
        bytes memory proof_ = _fxBytes("p1", "proof");
        bytes memory pi_ = _fxBytes("p1", "publicInputs");
        bytes32[] memory words_ = new bytes32[](10);
        for (uint256 i = 0; i < 10; ++i) {
            words_[i] = bytes32(_slice(pi_, i * 32));
        }

        uint256 g_ = gasleft();
        bool okRaw_ = ZKVerifierLike(honkVerifier).verify(proof_, words_);
        uint256 rawGas_ = g_ - gasleft();

        g_ = gasleft();
        bool okRouter_ = router.verifyProof(MANDATE, proof_, pi_);
        uint256 routerGas_ = g_ - gasleft();

        assertTrue(okRaw_ && okRouter_);
        emit log_named_uint("gas.zk.honkVerifier.verify", rawGas_);
        emit log_named_uint("gas.zk.router.verifyProof", routerGas_);
        emit log_named_uint("size.zk.proofBytes", proof_.length);
    }

    ////////////////////////////// Replay and invariant 8 //////////////////////////////

    function test_replaySameNonce_reverts() public {
        _redeem("p1");
        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, 1));
        _redeem("p1");
    }

    function test_replayProofUnderFreshNonce_reverts() public {
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(_args("p1", 100, _time("p1")), _execOf("p1"));
    }

    /// Invariant 8: two proofs, each valid on its own, whose amounts sum above the hidden cap. The
    /// second fails because the stored running commitment moved on.
    function test_invariant8_twoValidProofsAboveCap_secondFails() public {
        assertGt(_fxUint("p1", "amount") + _fxUint("overCap", "amount"), 1_000_000_000);
        assertTrue(router.verifyProof(MANDATE, _fxBytes("p1", "proof"), _fxBytes("p1", "publicInputs")));
        assertTrue(router.verifyProof(MANDATE, _fxBytes("overCap", "proof"), _fxBytes("overCap", "publicInputs")));

        _redeem("p1");
        vm.expectRevert(InvalidMandateProof.selector);
        _redeem("overCap");
    }

    function test_invariant8_reverseOrder_secondFails() public {
        _redeem("overCap");
        vm.expectRevert(InvalidMandateProof.selector);
        _redeem("p1");
    }

    function test_outOfOrderChain_reverts() public {
        // p2 opens p1's new commitment; it cannot run first.
        vm.expectRevert(InvalidMandateProof.selector);
        _redeem("p2");
    }

    ////////////////////////////// Payee, amount, context binding //////////////////////////////

    function test_wrongPayee_notAllowlisted_reverts() public {
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(_fxBytes("p1", "args"), _exec(vm.parseJsonAddress(fx, ".payees.notAllowlisted"), _fxUint("p1", "amount")));
    }

    function test_wrongPayee_otherAllowlisted_reverts() public {
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(_fxBytes("p1", "args"), _exec(vm.parseJsonAddress(fx, ".payees.tuition"), _fxUint("p1", "amount")));
    }

    function test_tamperedAmount_reverts() public {
        vm.warp(_time("p1"));
        uint256 amount_ = _fxUint("p1", "amount");
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(_fxBytes("p1", "args"), _exec(_fxAddress("p1", "payee"), amount_ + 1));
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(_fxBytes("p1", "args"), _exec(_fxAddress("p1", "payee"), amount_ - 1));
    }

    /// forge-config: default.fuzz.runs = 16
    function testFuzz_tamperedAmount_reverts(uint128 _amount) public {
        vm.assume(_amount != _fxUint("p1", "amount"));
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(_fxBytes("p1", "args"), _exec(_fxAddress("p1", "payee"), _amount));
    }

    function test_tamperedNewRunningCommitment_reverts() public {
        vm.warp(_time("p1"));
        bytes memory args_ = abi.encode(uint256(1), _time("p1"), bytes32(uint256(12345)), _fxBytes("p1", "proof"));
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(args_, _execOf("p1"));
    }

    function test_wrongChainId_reverts() public {
        vm.chainId(84532);
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(_fxBytes("p1", "args"), _execOf("p1"));
    }

    function test_wrongDelegationHash_reverts() public {
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidMandateProof.selector);
        enforcer.beforeHook(_terms(), _fxBytes("p1", "args"), singleMode, _execOf("p1"), ~delegationHash, delegator, agent);
    }

    function test_wrongMandateCommitment_reverts() public {
        vm.warp(_time("p1"));
        bytes memory terms_ = abi.encode(address(router), bytes32(uint256(commitment) ^ 1));
        vm.expectRevert(InvalidMandateProof.selector);
        enforcer.beforeHook(terms_, _fxBytes("p1", "args"), singleMode, _execOf("p1"), delegationHash, delegator, agent);
    }

    function test_tamperedProofByte_reverts() public {
        bytes memory proof_ = _fxBytes("p1", "proof");
        proof_[proof_.length / 2] = bytes1(uint8(proof_[proof_.length / 2]) ^ 0x01);
        assertFalse(router.verifyProof(MANDATE, proof_, _fxBytes("p1", "publicInputs")));
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(abi.encode(uint256(1), _time("p1"), _fxBytes32("p1", "newRunningCommitment"), proof_), _execOf("p1"));
    }

    function test_stateIsKeyedByDelegationManager() public {
        _redeem("p1");
        // Another caller (another DelegationManager, or anyone calling the hook directly) has its own
        // namespace: it can neither consume nor advance this one.
        address otherDM_ = makeAddr("otherDM");
        bytes memory terms_ = _terms();
        bytes memory args_ = _fxBytes("p1", "args");
        bytes memory exec_ = _execOf("p1");
        vm.prank(otherDM_);
        enforcer.beforeHook(terms_, args_, singleMode, exec_, delegationHash, delegator, agent);
        assertEq(enforcer.runningCommitment(otherDM_, delegationHash), _fxBytes32("p1", "newRunningCommitment"));
        assertEq(enforcer.runningCommitment(address(this), delegationHash), _fxBytes32("p1", "newRunningCommitment"));
        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, 1));
        _redeem("p1");
    }

    ////////////////////////////// Clock rule and expiry //////////////////////////////

    function test_claimedTimeTooOld_reverts() public {
        uint64 t_ = _time("p1");
        vm.warp(uint256(t_) + 301);
        vm.expectRevert(abi.encodeWithSelector(ClaimedTimeOutOfRange.selector, t_, uint256(t_) + 301));
        _hook(_fxBytes("p1", "args"), _execOf("p1"));
    }

    function test_claimedTimeTooFarAhead_reverts() public {
        uint64 t_ = _time("p1");
        vm.warp(uint256(t_) - 61);
        vm.expectRevert(abi.encodeWithSelector(ClaimedTimeOutOfRange.selector, t_, uint256(t_) - 61));
        _hook(_fxBytes("p1", "args"), _execOf("p1"));
    }

    function test_claimedTimeWindowEdges_pass() public {
        vm.warp(uint256(_time("p1")) + 300);
        _hook(_fxBytes("p1", "args"), _execOf("p1"));
        vm.warp(uint256(_time("p2")) - 60);
        _hook(_fxBytes("p2", "args"), _execOf("p2"));
    }

    function test_expired_proofAtExpiry_lateBlock_reverts() public {
        uint256 expiry_ = vm.parseJsonUint(fx, ".expiry");
        assertEq(uint256(_time("atExpiry")), expiry_);
        vm.warp(expiry_ + 301);
        vm.expectRevert(abi.encodeWithSelector(ClaimedTimeOutOfRange.selector, uint64(expiry_), expiry_ + 301));
        _hook(_fxBytes("atExpiry", "args"), _execOf("atExpiry"));
    }

    function test_expired_claimingLaterTimeThanProven_reverts() public {
        // A proof made at T = expiry cannot be presented as T = expiry + 1 (T is a public input).
        uint256 expiry_ = vm.parseJsonUint(fx, ".expiry");
        vm.warp(expiry_ + 1);
        vm.expectRevert(InvalidMandateProof.selector);
        _hook(_args("atExpiry", 9, uint64(expiry_ + 1)), _execOf("atExpiry"));
    }

    function test_expiryTolerance_isAtMost300Seconds() public {
        // Documented tolerance: a proof at T = expiry still lands up to 300 s after the hidden expiry.
        uint256 expiry_ = vm.parseJsonUint(fx, ".expiry");
        vm.warp(expiry_ + 300);
        _hook(_fxBytes("atExpiry", "args"), _execOf("atExpiry"));
    }

    ////////////////////////////// Execution decoding //////////////////////////////

    function test_nativeValue_reverts() public {
        bytes memory exec_ = ExecutionLib.encodeSingle(
            TOKEN, 1, abi.encodeWithSelector(IERC20.transfer.selector, _fxAddress("p1", "payee"), _fxUint("p1", "amount"))
        );
        vm.warp(_time("p1"));
        vm.expectRevert(abi.encodeWithSelector(NativeValueNotAllowed.selector, 1));
        _hook(_fxBytes("p1", "args"), exec_);
    }

    function test_notATransfer_reverts() public {
        bytes memory exec_ = ExecutionLib.encodeSingle(
            TOKEN, 0, abi.encodeWithSelector(IERC20.approve.selector, _fxAddress("p1", "payee"), _fxUint("p1", "amount"))
        );
        vm.warp(_time("p1"));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, IERC20.approve.selector));
        _hook(_fxBytes("p1", "args"), exec_);
    }

    function test_transferWithExtraCalldata_reverts() public {
        bytes memory exec_ = ExecutionLib.encodeSingle(
            TOKEN,
            0,
            abi.encodePacked(
                abi.encodeWithSelector(IERC20.transfer.selector, _fxAddress("p1", "payee"), _fxUint("p1", "amount")), uint256(0)
            )
        );
        vm.warp(_time("p1"));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, IERC20.transfer.selector));
        _hook(_fxBytes("p1", "args"), exec_);
    }

    function test_dirtyRecipientBits_reverts() public {
        uint256 dirty_ = uint256(uint160(_fxAddress("p1", "payee"))) | (uint256(1) << 200);
        bytes memory exec_ = ExecutionLib.encodeSingle(
            TOKEN, 0, abi.encodeWithSelector(IERC20.transfer.selector, dirty_, _fxUint("p1", "amount"))
        );
        vm.warp(_time("p1"));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, IERC20.transfer.selector));
        _hook(_fxBytes("p1", "args"), exec_);
    }

    function test_amountAboveU128_reverts() public {
        uint256 amount_ = uint256(type(uint128).max) + 1;
        vm.warp(_time("p1"));
        vm.expectRevert(abi.encodeWithSelector(AmountOutOfRange.selector, amount_));
        _hook(_fxBytes("p1", "args"), _exec(_fxAddress("p1", "payee"), amount_));
    }

    function test_shortExecution_reverts() public {
        vm.warp(_time("p1"));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, bytes4(0)));
        _hook(_fxBytes("p1", "args"), abi.encodePacked(TOKEN));
    }

    function test_batchCallType_reverts() public {
        ModeCode batch_ = ModeLib.encode(CALLTYPE_BATCH, EXECTYPE_DEFAULT, ModeSelector.wrap(0x00), ModePayload.wrap(0x00));
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidExecutionMode.selector);
        enforcer.beforeHook(_terms(), _fxBytes("p1", "args"), batch_, _execOf("p1"), delegationHash, delegator, agent);
    }

    function test_tryExecType_reverts() public {
        ModeCode try_ = ModeLib.encode(CALLTYPE_SINGLE, EXECTYPE_TRY, ModeSelector.wrap(0x00), ModePayload.wrap(0x00));
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidExecutionMode.selector);
        enforcer.beforeHook(_terms(), _fxBytes("p1", "args"), try_, _execOf("p1"), delegationHash, delegator, agent);
    }

    ////////////////////////////// Args and terms validation //////////////////////////////

    function test_truncatedArgs_reverts() public {
        bytes memory args_ = _fxBytes("p1", "args");
        assembly {
            mstore(args_, sub(mload(args_), 32))
        }
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidArgs.selector);
        _hook(args_, _execOf("p1"));
    }

    function test_nonCanonicalArgs_reverts() public {
        // Same fields, proof offset 0xa0 with a padding word: abi.decode would accept it, we do not.
        bytes memory args_ = abi.encodePacked(
            uint256(1),
            uint256(_time("p1")),
            _fxBytes32("p1", "newRunningCommitment"),
            uint256(0xa0),
            uint256(0),
            uint256(_fxBytes("p1", "proof").length),
            _fxBytes("p1", "proof")
        );
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidArgs.selector);
        _hook(args_, _execOf("p1"));
    }

    function test_nonceNotAFieldElement_reverts() public {
        uint256 p_ = enforcer.SNARK_SCALAR_FIELD();
        vm.warp(_time("p1"));
        // nonce + p would alias nonce inside the field; refused before the verifier sees it.
        vm.expectRevert(InvalidArgs.selector);
        _hook(_args("p1", 1 + p_, _time("p1")), _execOf("p1"));
    }

    function test_zeroNewRunningCommitment_reverts() public {
        vm.warp(_time("p1"));
        vm.expectRevert(InvalidArgs.selector);
        _hook(abi.encode(uint256(1), _time("p1"), bytes32(0), _fxBytes("p1", "proof")), _execOf("p1"));
    }

    function test_badTerms_revert() public {
        vm.warp(_time("p1"));
        bytes memory args_ = _fxBytes("p1", "args");
        bytes memory exec_ = _execOf("p1");
        bytes32 notAField_ = bytes32(enforcer.SNARK_SCALAR_FIELD());

        vm.expectRevert(InvalidTerms.selector);
        enforcer.beforeHook(
            abi.encodePacked(address(router), commitment), args_, singleMode, exec_, delegationHash, delegator, agent
        );

        vm.expectRevert(InvalidTerms.selector);
        enforcer.beforeHook(abi.encode(address(0), commitment), args_, singleMode, exec_, delegationHash, delegator, agent);

        vm.expectRevert(InvalidTerms.selector);
        enforcer.beforeHook(abi.encode(address(router), notAField_), args_, singleMode, exec_, delegationHash, delegator, agent);
    }

    ////////////////////////////// Bytecode //////////////////////////////

    function test_noImmutables_runtimeBytecodeIsChainIndependent() public {
        // type(C).runtimeCode does not compile for contracts with immutables, so this test is also a
        // compile-time guard. The deployed code equals the compiler's runtime code byte for byte.
        assertEq(keccak256(address(enforcer).code), keccak256(type(ZKMandateEnforcer).runtimeCode));
        assertEq(keccak256(address(router).code), keccak256(type(ZKVerifierRouter).runtimeCode));
    }

    function _slice(bytes memory _b, uint256 _off) private pure returns (bytes32 w_) {
        assembly {
            w_ := mload(add(add(_b, 0x20), _off))
        }
    }
}

interface ZKVerifierLike {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
