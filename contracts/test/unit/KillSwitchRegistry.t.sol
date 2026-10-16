// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import { KillSwitchRegistry } from "../../src/registries/KillSwitchRegistry.sol";
import { Unauthorized, InvalidSignature, SignatureExpired, NonceAlreadyUsed } from "../../src/utils/Errors.sol";

/// @notice KillSwitchRegistry: who may pause (self, guardian, signature, dead-man, supervisor) and who may
/// unpause (the account only), with EIP-712 Trip/Untrip digests recomputed here and sequential nonces.
/// Signatures here come from an EOA account; the passkey (ERC-1271) path is in NadiaMandateTest.
contract KillSwitchRegistryTest is Test {
    event Tripped(address indexed account, address indexed by, uint8 kind);
    event Untripped(address indexed account, address indexed by);
    event GuardianSet(address indexed account, address indexed guardian, bool enabled);
    event AgentHaltSet(address indexed agent, bool halted, address indexed by);
    event DeadmanSet(address indexed account, uint64 interval);
    event Heartbeat(address indexed account, uint64 at);
    event SupervisorTransferred(address indexed from, address indexed to);

    bytes32 internal constant SALT = keccak256("YINGLONG-test");
    KillSwitchRegistry internal ks;
    address internal supervisor = makeAddr("supervisor");
    address internal alice;
    uint256 internal aliceKey;
    address internal guardian = makeAddr("guardian");
    address internal relayer = makeAddr("relayer");
    address internal agent = makeAddr("agent");

    function setUp() public {
        vm.warp(1_760_000_000);
        ks = new KillSwitchRegistry(supervisor, SALT);
        (alice, aliceKey) = makeAddrAndKey("alice-ks");
    }

    function _digest(bytes32 _typehash, address _account, uint256 _nonce, uint256 _deadline) internal view returns (bytes32) {
        bytes32 domain_ = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"),
                keccak256("YINGLONG Kill Switch"),
                keccak256("1"),
                block.chainid,
                address(ks),
                SALT
            )
        );
        return keccak256(abi.encodePacked(hex"1901", domain_, keccak256(abi.encode(_typehash, _account, _nonce, _deadline))));
    }

    function _sig(bytes32 _d) internal view returns (bytes memory) {
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(aliceKey, _d);
        return abi.encodePacked(r_, s_, v_);
    }

    // ------------------------------------------------------------------ direct pause

    function test_trip_selfGuardianOrNobody() public {
        vm.expectEmit(true, true, true, true, address(ks));
        emit Tripped(alice, alice, uint8(0));
        vm.prank(alice);
        ks.trip(alice);
        assertTrue(ks.tripped(alice));
        vm.prank(alice);
        ks.untrip();

        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, guardian));
        vm.prank(guardian);
        ks.trip(alice);

        vm.expectEmit(true, true, true, true, address(ks));
        emit GuardianSet(alice, guardian, true);
        vm.prank(alice);
        ks.setGuardian(guardian, true);
        assertTrue(ks.isGuardian(alice, guardian));
        vm.expectEmit(true, true, true, true, address(ks));
        emit Tripped(alice, guardian, uint8(2));
        vm.prank(guardian);
        ks.trip(alice);
        assertTrue(ks.isPaused(alice, agent));

        // The guardian cannot unpause; a removed guardian cannot pause again.
        vm.prank(guardian);
        ks.untrip();
        assertTrue(ks.tripped(alice));
        vm.prank(alice);
        ks.untrip();
        vm.prank(alice);
        ks.setGuardian(guardian, false);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, guardian));
        vm.prank(guardian);
        ks.trip(alice);
    }

    function test_untrip_emitsAndRestartsHeartbeat() public {
        vm.prank(alice);
        ks.trip(alice);
        vm.warp(block.timestamp + 5 days);
        vm.expectEmit(true, true, true, true, address(ks));
        emit Untripped(alice, alice);
        vm.prank(alice);
        ks.untrip();
        assertFalse(ks.tripped(alice));
        assertEq(ks.lastHeartbeat(alice), block.timestamp);
    }

    // ------------------------------------------------------------------ signatures

    function test_digests_matchRecomputation() public {
        assertEq(ks.TRIP_TYPEHASH(), keccak256("Trip(address account,uint256 nonce,uint256 deadline)"));
        assertEq(ks.UNTRIP_TYPEHASH(), keccak256("Untrip(address account,uint256 nonce,uint256 deadline)"));
        assertEq(ks.tripDigest(alice, 3, 99), _digest(ks.TRIP_TYPEHASH(), alice, 3, 99));
        assertEq(ks.untripDigest(alice, 3, 99), _digest(ks.UNTRIP_TYPEHASH(), alice, 3, 99));
        assertEq(ks.domainSalt(), SALT);
        assertEq(ks.KIND_SELF(), 0);
        assertEq(ks.KIND_SIGNATURE(), 1);
        assertEq(ks.KIND_GUARDIAN(), 2);
        assertEq(ks.KIND_DEADMAN(), 3);
    }

    function test_tripWithSig_relayedThenNonceAdvances() public {
        uint256 deadline_ = block.timestamp; // deadline == now is still valid
        bytes memory sig_ = _sig(ks.tripDigest(alice, 0, deadline_));
        vm.expectEmit(true, true, true, true, address(ks));
        emit Tripped(alice, relayer, uint8(1));
        vm.prank(relayer);
        ks.tripWithSig(alice, 0, deadline_, sig_);
        assertTrue(ks.tripped(alice));
        assertEq(ks.nonces(alice), 1);

        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, uint256(0)));
        ks.tripWithSig(alice, 0, deadline_, sig_);

        bytes memory un_ = _sig(ks.untripDigest(alice, 1, deadline_));
        vm.expectEmit(true, true, true, true, address(ks));
        emit Untripped(alice, relayer);
        vm.prank(relayer);
        ks.untripWithSig(alice, 1, deadline_, un_);
        assertFalse(ks.tripped(alice));
        assertEq(ks.nonces(alice), 2);
    }

    function test_tripWithSig_refusals() public {
        uint256 deadline_ = block.timestamp + 1 hours;
        bytes memory sig_ = _sig(ks.tripDigest(alice, 0, deadline_));
        vm.warp(deadline_ + 1);
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, deadline_));
        ks.tripWithSig(alice, 0, deadline_, sig_);
        vm.warp(deadline_);
        // Future nonce.
        bytes memory future_ = _sig(ks.tripDigest(alice, 1, deadline_));
        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, uint256(1)));
        ks.tripWithSig(alice, 1, deadline_, future_);
        // Signed by someone else.
        (, uint256 otherKey_) = makeAddrAndKey("other");
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(otherKey_, ks.tripDigest(alice, 0, deadline_));
        vm.expectRevert(InvalidSignature.selector);
        ks.tripWithSig(alice, 0, deadline_, abi.encodePacked(r_, s_, v_));
        // A Trip signature can never be used to unpause.
        vm.prank(alice);
        ks.trip(alice);
        vm.expectRevert(InvalidSignature.selector);
        ks.untripWithSig(alice, 0, deadline_, sig_);
        assertTrue(ks.tripped(alice));
        assertEq(ks.nonces(alice), 0);
    }

    function test_signatureIsBoundToTheChain() public {
        uint256 deadline_ = block.timestamp + 1 hours;
        bytes memory sig_ = _sig(ks.tripDigest(alice, 0, deadline_));
        vm.chainId(20_200);
        vm.expectRevert(InvalidSignature.selector);
        ks.tripWithSig(alice, 0, deadline_, sig_);
    }

    // ------------------------------------------------------------------ dead-man timer

    function test_deadman_boundaryAndHeartbeat() public {
        vm.expectRevert(abi.encodeWithSelector(KillSwitchRegistry.DeadmanNotExpired.selector, alice));
        ks.tripIfStale(alice); // no timer

        vm.expectEmit(true, true, true, true, address(ks));
        emit DeadmanSet(alice, 3 days);
        vm.prank(alice);
        ks.setDeadman(3 days);
        uint256 t0_ = block.timestamp;
        vm.warp(t0_ + 3 days);
        assertFalse(ks.isPaused(alice, agent));
        vm.expectRevert(abi.encodeWithSelector(KillSwitchRegistry.DeadmanNotExpired.selector, alice));
        ks.tripIfStale(alice);

        vm.expectEmit(true, true, true, true, address(ks));
        emit Heartbeat(alice, uint64(t0_ + 3 days));
        vm.prank(alice);
        ks.heartbeat();
        vm.warp(t0_ + 6 days + 1);
        assertTrue(ks.isPaused(alice, agent));
        assertFalse(ks.tripped(alice));
        vm.expectEmit(true, true, true, true, address(ks));
        emit Tripped(alice, relayer, uint8(3));
        vm.prank(relayer);
        ks.tripIfStale(alice);
        assertTrue(ks.tripped(alice));

        // Untrip restarts the timer; interval 0 disables it.
        vm.prank(alice);
        ks.untrip();
        assertFalse(ks.isPaused(alice, agent));
        vm.prank(alice);
        ks.setDeadman(0);
        vm.warp(block.timestamp + 365 days);
        assertFalse(ks.isPaused(alice, agent));
    }

    // ------------------------------------------------------------------ supervisor

    function test_agentHalt_onlySupervisor_pausesEveryAccount() public {
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, alice));
        vm.prank(alice);
        ks.setAgentHalt(agent, true);
        vm.expectEmit(true, true, true, true, address(ks));
        emit AgentHaltSet(agent, true, supervisor);
        vm.prank(supervisor);
        ks.setAgentHalt(agent, true);
        assertTrue(ks.isPaused(alice, agent));
        assertTrue(ks.isPaused(makeAddr("anyone"), agent));
        assertFalse(ks.isPaused(alice, makeAddr("other-agent")));
        vm.prank(supervisor);
        ks.setAgentHalt(agent, false);
        assertFalse(ks.isPaused(alice, agent));
    }

    function test_supervisorTransfer_isTwoStep() public {
        address next_ = makeAddr("next-supervisor");
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, next_));
        vm.prank(next_);
        ks.transferSupervisor(next_);
        vm.prank(supervisor);
        ks.transferSupervisor(next_);
        assertEq(ks.pendingSupervisor(), next_);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, alice));
        vm.prank(alice);
        ks.acceptSupervisor();
        vm.expectEmit(true, true, true, true, address(ks));
        emit SupervisorTransferred(supervisor, next_);
        vm.prank(next_);
        ks.acceptSupervisor();
        assertEq(ks.supervisor(), next_);
        assertEq(ks.pendingSupervisor(), address(0));
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, supervisor));
        vm.prank(supervisor);
        ks.setAgentHalt(agent, true);
    }
}
