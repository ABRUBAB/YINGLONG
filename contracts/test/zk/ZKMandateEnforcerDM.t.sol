// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { ModeLib } from "@erc7579/lib/ModeLib.sol";

import { DelegationManager } from "@delegation-framework/DelegationManager.sol";
import { HybridDeleGator } from "@delegation-framework/HybridDeleGator.sol";
import { AllowedTargetsEnforcer } from "@delegation-framework/enforcers/AllowedTargetsEnforcer.sol";
import { IDelegationManager } from "@delegation-framework/interfaces/IDelegationManager.sol";
import { Caveat, Delegation, ModeCode } from "@delegation-framework/utils/Types.sol";

import { InvalidMandateProof, NonceAlreadyUsed } from "../../src/utils/Errors.sol";
import { ZKMandateEnforcer } from "../../src/zk/ZKMandateEnforcer.sol";
import { ZKVerifierRouter } from "../../src/zk/ZKVerifierRouter.sol";
import { ZKTestBase } from "./ZKTestBase.sol";

/// @notice Test-only ERC-20 (test units, 6 decimals). Not a real asset.
contract ZKTestUnits is ERC20 {
    constructor() ERC20("YINGLONG test units", "tUNIT") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }
}

/// @notice The private mandate through the real MetaMask Delegation Framework v1.3.0: a HybridDeleGator
/// (user) delegates to an agent with [AllowedTargets(token), ZKMandateEnforcer(router, commitment)];
/// the agent redeems with real proofs. Contracts are deployed from a fixed deployer in a fixed order so
/// the prover could compute the delegation hash ahead of time (circuits/prover/scripts/make-fixtures.ts).
contract ZKMandateEnforcerDMTest is ZKTestBase {
    bytes32 internal constant ROOT_AUTHORITY = bytes32(type(uint256).max);
    address internal constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    address internal deployer = address(uint160(uint256(keccak256("yinglong.zk.it.deployer"))));
    address internal agent = address(uint160(uint256(keccak256("yinglong.zk.it.agent"))));
    uint256 internal userSigningKey = uint256(keccak256("yinglong.zk.it.user"));
    address internal user;

    DelegationManager internal dm;
    HybridDeleGator internal delegator;
    ZKTestUnits internal token;
    AllowedTargetsEnforcer internal allowedTargets;
    ZKMandateEnforcer internal enforcer;
    ZKVerifierRouter internal router;
    bytes32 internal commitment;

    function setUp() public {
        _loadVectors();
        vm.chainId(vm.parseJsonUint(fx, ".chainId"));
        user = vm.addr(userSigningKey);
        commitment = vm.parseJsonBytes32(fx, ".mandateCommitment");

        // Fixed order from a fixed deployer: nonces 0..6 (see make-fixtures.ts).
        vm.startPrank(deployer);
        dm = new DelegationManager(deployer);
        HybridDeleGator impl_ = new HybridDeleGator(IDelegationManager(address(dm)), IEntryPoint(ENTRY_POINT_V07));
        delegator = HybridDeleGator(
            payable(address(
                    new ERC1967Proxy(
                        address(impl_),
                        abi.encodeWithSelector(
                            HybridDeleGator.initialize.selector, user, new string[](0), new uint256[](0), new uint256[](0)
                        )
                    )
                ))
        );
        token = new ZKTestUnits();
        allowedTargets = new AllowedTargetsEnforcer();
        enforcer = new ZKMandateEnforcer();
        router = new ZKVerifierRouter(deployer);
        vm.stopPrank();

        address verifier_ = _deployHonkVerifier();
        vm.prank(deployer);
        router.registerVerifier(0x01, verifier_);

        token.mint(address(delegator), 5_000_000_000);

        _assertAddress(address(dm), ".integration.addresses.delegationManager");
        _assertAddress(address(delegator), ".integration.addresses.delegator");
        _assertAddress(address(token), ".integration.addresses.token");
        _assertAddress(address(allowedTargets), ".integration.addresses.allowedTargetsEnforcer");
        _assertAddress(address(enforcer), ".integration.addresses.zkMandateEnforcer");
        _assertAddress(address(router), ".integration.addresses.router");
    }

    function _assertAddress(address _actual, string memory _key) internal {
        assertEq(_actual, vm.parseJsonAddress(fx, _key), "deployment order changed: regenerate the zk fixtures");
    }

    function _it(string memory _c, string memory _f) internal pure returns (string memory) {
        return string.concat(".integration.cases.", _c, ".", _f);
    }

    /// @dev Signed delegation user -> agent carrying `_zkArgs` as the ZK caveat's args.
    function _delegation(bytes memory _zkArgs) internal view returns (Delegation memory d_) {
        Caveat[] memory caveats_ = new Caveat[](2);
        caveats_[0] = Caveat({ enforcer: address(allowedTargets), terms: abi.encodePacked(address(token)), args: "" });
        caveats_[1] = Caveat({ enforcer: address(enforcer), terms: abi.encode(address(router), commitment), args: _zkArgs });
        d_ = Delegation({
            delegate: agent, delegator: address(delegator), authority: ROOT_AUTHORITY, caveats: caveats_, salt: 0, signature: ""
        });
        bytes32 typed_ = MessageHashUtils.toTypedDataHash(dm.getDomainHash(), dm.getDelegationHash(d_));
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(userSigningKey, typed_);
        d_.signature = abi.encodePacked(r_, s_, v_);
    }

    function _redeem(string memory _c, address _to, uint256 _value) internal returns (uint256 gasUsed_) {
        gasUsed_ = _redeemExpect(_c, _to, _value, "");
    }

    /// @dev Builds and signs everything first, then (optionally) arms expectRevert for the redemption call.
    function _redeemExpect(
        string memory _c,
        address _to,
        uint256 _value,
        bytes memory _revertData
    )
        internal
        returns (uint256 gasUsed_)
    {
        vm.warp(vm.parseJsonUint(fx, _it(_c, "claimedTime")));
        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = _delegation(vm.parseJsonBytes(fx, _it(_c, "args")));

        bytes[] memory contexts_ = new bytes[](1);
        contexts_[0] = abi.encode(chain_);
        ModeCode[] memory modes_ = new ModeCode[](1);
        modes_[0] = ModeLib.encodeSimpleSingle();
        bytes[] memory execs_ = new bytes[](1);
        execs_[0] = ExecutionLib.encodeSingle(address(token), 0, abi.encodeWithSelector(IERC20.transfer.selector, _to, _value));

        if (_revertData.length != 0) vm.expectRevert(_revertData);
        vm.prank(agent);
        uint256 g_ = gasleft();
        dm.redeemDelegations(contexts_, modes_, execs_);
        gasUsed_ = g_ - gasleft();
    }

    function _payee(string memory _c) internal view returns (address) {
        return vm.parseJsonAddress(fx, _it(_c, "payee"));
    }

    function _amount(string memory _c) internal view returns (uint256) {
        return vm.parseJsonUint(fx, _it(_c, "amount"));
    }

    ////////////////////////////// Tests //////////////////////////////

    function test_delegationHashMatchesProver() public {
        Delegation memory d_ = _delegation("");
        assertEq(
            dm.getDelegationHash(d_),
            vm.parseJsonBytes32(fx, ".integration.delegationHash"),
            "delegation hash differs from the one the proofs were made for: regenerate the zk fixtures"
        );
    }

    function test_redeem_realProofs_movesTokensAndAdvancesState() public {
        bytes32 dh_ = vm.parseJsonBytes32(fx, ".integration.delegationHash");

        uint256 gas1_ = _redeem("dm1", _payee("dm1"), _amount("dm1"));
        assertEq(token.balanceOf(_payee("dm1")), _amount("dm1"));
        assertEq(enforcer.runningCommitment(address(dm), dh_), vm.parseJsonBytes32(fx, _it("dm1", "newRunningCommitment")));

        uint256 gas2_ = _redeem("dm2", _payee("dm2"), _amount("dm2"));
        assertEq(token.balanceOf(_payee("dm2")), _amount("dm2"));
        assertTrue(enforcer.nonceUsed(address(dm), dh_, 2));

        emit log_named_uint("gas.zk.redeemDelegations.firstPayment", gas1_);
        emit log_named_uint("gas.zk.redeemDelegations.laterPayment", gas2_);
    }

    function test_redeem_replay_reverts() public {
        _redeem("dm1", _payee("dm1"), _amount("dm1"));
        _redeemExpect("dm1", _payee("dm1"), _amount("dm1"), abi.encodeWithSelector(NonceAlreadyUsed.selector, 1));
    }

    function test_redeem_invariant8_secondFails() public {
        _redeem("dm1", _payee("dm1"), _amount("dm1"));
        uint256 before_ = token.balanceOf(_payee("dmOverCap"));
        _redeemExpect("dmOverCap", _payee("dmOverCap"), _amount("dmOverCap"), abi.encodeWithSelector(InvalidMandateProof.selector));
        assertEq(token.balanceOf(_payee("dmOverCap")), before_);
    }

    function test_redeem_wrongPayee_reverts() public {
        address mirage_ = vm.parseJsonAddress(fx, ".payees.notAllowlisted");
        _redeemExpect("dm1", mirage_, _amount("dm1"), abi.encodeWithSelector(InvalidMandateProof.selector));
        assertEq(token.balanceOf(mirage_), 0);
    }

    function test_redeem_tamperedAmount_reverts() public {
        _redeemExpect("dm1", _payee("dm1"), _amount("dm1") + 1, abi.encodeWithSelector(InvalidMandateProof.selector));
    }
}
