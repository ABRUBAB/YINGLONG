// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { CoverageBase } from "./CoverageBase.sol";
import { YinglongPassportRegistry } from "../../src/registries/YinglongPassportRegistry.sol";
import { Unauthorized, InvalidSignature, SignatureExpired } from "../../src/utils/Errors.sol";

/// @notice YinglongPassportRegistry: wallet binding by the wallet's own signature (EIP-712 BindWallet), controller-
/// only updates and rotation, terminal revocation, attestations with expiry, and the two-step supervisor role.
contract YinglongPassportRegistryTest is CoverageBase {
    event PassportRegistered(uint256 indexed agentId, address indexed controller, address indexed agentWallet, bytes32 ownerDidHash);
    event PassportUpdated(uint256 indexed agentId, bytes32 passportVcHash, bytes32 provenanceHash, bytes32 enforcerTableHash, bytes32 jwksHash);
    event AgentWalletChanged(uint256 indexed agentId, address indexed oldWallet, address indexed newWallet);
    event StatusChanged(uint256 indexed agentId, uint8 status, address indexed by);
    event Attested(uint256 indexed agentId, address indexed issuer, bytes32 claimHash, uint64 expiresAt);
    event AttestationRevoked(uint256 indexed agentId, address indexed issuer);
    event SupervisorTransferStarted(address indexed from, address indexed to);
    event SupervisorTransferred(address indexed from, address indexed to);

    address internal wallet;
    uint256 internal walletKey;
    address internal controller = makeAddr("controller-2");

    function setUp() public override {
        super.setUp();
        vm.warp(1_760_000_000);
        (wallet, walletKey) = makeAddrAndKey("new-agent-wallet");
    }

    function _params(address _wallet, uint256 _deadline, bytes memory _sig)
        internal
        pure
        returns (YinglongPassportRegistry.RegisterParams memory)
    {
        return YinglongPassportRegistry.RegisterParams({
            agentWallet: _wallet,
            ownerDidHash: keccak256("did:example:owner"),
            passportVcHash: keccak256("vc"),
            provenanceHash: keccak256("prov"),
            enforcerTableHash: keccak256("table"),
            jwksHash: keccak256("jwks"),
            erc8004AgentId: 7,
            identityCode: "YL-TEST-0900",
            kid: "kid-1",
            registrationURI: "https://example.test/agent.json",
            deadline: _deadline,
            walletSig: _sig
        });
    }

    function _registerParams() internal view returns (YinglongPassportRegistry.RegisterParams memory) {
        uint256 deadline_ = block.timestamp; // deadline == now is still valid
        bytes memory sig_ = _ecdsa(walletKey, passports.bindWalletDigest(passports.nextAgentId(), controller, wallet, deadline_));
        return _params(wallet, deadline_, sig_);
    }

    function _register() internal returns (uint256 id_) {
        YinglongPassportRegistry.RegisterParams memory p_ = _registerParams();
        vm.prank(controller);
        id_ = passports.register(p_);
    }

    function _bindSig(uint256 _id, address _controller, uint256 _key, address _wallet, uint256 _deadline)
        internal
        view
        returns (bytes memory)
    {
        return _ecdsa(_key, passports.bindWalletDigest(_id, _controller, _wallet, _deadline));
    }

    // ------------------------------------------------------------------ registration

    function test_bindWalletDigest_matchesRecomputation() public {
        assertEq(passports.BIND_WALLET_TYPEHASH(), keccak256("BindWallet(uint256 agentId,address controller,address wallet,uint256 deadline)"));
        bytes32 domain_ = _domain("YINGLONG Passport Registry", address(passports), SALT);
        assertEq(passports.domainSeparator(), domain_);
        bytes32 struct_ = keccak256(abi.encode(passports.BIND_WALLET_TYPEHASH(), uint256(5), controller, wallet, uint256(9)));
        assertEq(passports.bindWalletDigest(5, controller, wallet, 9), _typed(domain_, struct_));
    }

    function test_register_recordsPassportAndEmits() public {
        uint256 next_ = passports.nextAgentId();
        YinglongPassportRegistry.RegisterParams memory rp_ = _registerParams();
        vm.expectEmit(true, true, true, true, address(passports));
        emit PassportRegistered(next_, controller, wallet, keccak256("did:example:owner"));
        vm.expectEmit(true, true, true, true, address(passports));
        emit PassportUpdated(next_, keccak256("vc"), keccak256("prov"), keccak256("table"), keccak256("jwks"));
        vm.prank(controller);
        uint256 id_ = passports.register(rp_);
        assertEq(id_, next_);
        assertEq(passports.nextAgentId(), next_ + 1);
        YinglongPassportRegistry.Passport memory p_ = passports.passportOf(id_);
        assertEq(p_.controller, controller);
        assertEq(p_.agentWallet, wallet);
        assertEq(p_.erc8004AgentId, 7);
        assertEq(p_.status, passports.STATUS_ACTIVE());
        assertEq(p_.identityCode, "YL-TEST-0900");
        assertEq(p_.kid, "kid-1");
        assertEq(p_.registrationURI, "https://example.test/agent.json");
        assertEq(passports.agentIdOf(wallet), id_);
        (uint256 aid_, uint8 st_, bytes32 did_) = passports.walletInfo(wallet);
        assertEq(aid_, id_);
        assertEq(st_, 1);
        assertEq(did_, keccak256("did:example:owner"));
        assertEq(passports.erc8004IdOfWallet(wallet), 7);
        (aid_, st_,) = passports.walletInfo(mirage);
        assertEq(aid_, 0);
        assertEq(st_, 0);
    }

    function test_register_refusals() public {
        uint256 next_ = passports.nextAgentId();
        uint256 dl_ = block.timestamp - 1;
        YinglongPassportRegistry.RegisterParams memory p_ = _params(wallet, dl_, _bindSig(next_, controller, walletKey, wallet, dl_));
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, dl_));
        vm.prank(controller);
        passports.register(p_);

        dl_ = block.timestamp + 1 hours;
        // Signed by another key than the wallet's.
        p_ = _params(wallet, dl_, _bindSig(next_, controller, mirageKey, wallet, dl_));
        vm.expectRevert(InvalidSignature.selector);
        vm.prank(controller);
        passports.register(p_);
        // A binding signed for another controller cannot be used by this one.
        p_ = _params(wallet, dl_, _bindSig(next_, agentOwner, walletKey, wallet, dl_));
        vm.expectRevert(InvalidSignature.selector);
        vm.prank(controller);
        passports.register(p_);
        // Ying's wallet is already bound.
        p_ = _params(ying, dl_, _bindSig(next_, controller, yingKey, ying, dl_));
        vm.expectRevert(abi.encodeWithSelector(YinglongPassportRegistry.WalletAlreadyBound.selector, ying, yingAgentId));
        vm.prank(controller);
        passports.register(p_);
        assertEq(passports.nextAgentId(), next_);
    }

    function test_register_smartAccountWalletSignsWithPasskey() public {
        uint256 next_ = passports.nextAgentId();
        uint256 dl_ = block.timestamp + 1 hours;
        bytes memory sig_ = _passkeySign(passports.bindWalletDigest(next_, controller, address(nadia), dl_));
        vm.prank(controller);
        uint256 id_ = passports.register(_params(address(nadia), dl_, sig_));
        assertEq(passports.agentIdOf(address(nadia)), id_);
    }

    // ------------------------------------------------------------------ controller actions

    function test_controllerOnlyActions() public {
        uint256 id_ = _register();
        vm.startPrank(mirage);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        passports.setAgentWallet(id_, mirage, block.timestamp, "");
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        passports.updateHashes(id_, 0, 0, 0, 0, "");
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        passports.setErc8004AgentId(id_, 1);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        passports.revoke(id_);
        vm.stopPrank();
    }

    function test_updateHashesAndErc8004Id() public {
        uint256 id_ = _register();
        vm.expectEmit(true, true, true, true, address(passports));
        emit PassportUpdated(id_, keccak256("vc2"), keccak256("prov2"), keccak256("table2"), keccak256("jwks2"));
        vm.prank(controller);
        passports.updateHashes(id_, keccak256("vc2"), keccak256("prov2"), keccak256("table2"), keccak256("jwks2"), "kid-2");
        YinglongPassportRegistry.Passport memory p_ = passports.passportOf(id_);
        assertEq(p_.passportVcHash, keccak256("vc2"));
        assertEq(p_.provenanceHash, keccak256("prov2"));
        assertEq(p_.enforcerTableHash, keccak256("table2"));
        assertEq(p_.jwksHash, keccak256("jwks2"));
        assertEq(p_.kid, "kid-2");
        vm.prank(controller);
        passports.setErc8004AgentId(id_, 1234);
        assertEq(passports.erc8004IdOfWallet(wallet), 1234);
    }

    function test_setAgentWallet_rotatesBinding() public {
        uint256 id_ = _register();
        (address next_, uint256 nextKey_) = makeAddrAndKey("rotated-wallet");
        uint256 dl_ = block.timestamp + 1 hours;
        bytes memory sig_ = _bindSig(id_, controller, nextKey_, next_, dl_);
        vm.expectEmit(true, true, true, true, address(passports));
        emit AgentWalletChanged(id_, wallet, next_);
        vm.prank(controller);
        passports.setAgentWallet(id_, next_, dl_, sig_);
        assertEq(passports.agentIdOf(next_), id_);
        assertEq(passports.agentIdOf(wallet), 0);
        assertEq(passports.passportOf(id_).agentWallet, next_);

        // The new wallet must not be bound already, and must sign.
        bytes memory yingSig_ = _bindSig(id_, controller, yingKey, ying, dl_);
        vm.expectRevert(abi.encodeWithSelector(YinglongPassportRegistry.WalletAlreadyBound.selector, ying, yingAgentId));
        vm.prank(controller);
        passports.setAgentWallet(id_, ying, dl_, yingSig_);
        bytes memory forged_ = _bindSig(id_, controller, mirageKey, wallet, dl_);
        vm.expectRevert(InvalidSignature.selector);
        vm.prank(controller);
        passports.setAgentWallet(id_, wallet, dl_, forged_);
    }

    function test_revoke_isTerminal() public {
        uint256 id_ = _register();
        vm.expectEmit(true, true, true, true, address(passports));
        emit StatusChanged(id_, 3, controller);
        vm.prank(controller);
        passports.revoke(id_);
        (, uint8 st_,) = passports.walletInfo(wallet);
        assertEq(st_, passports.STATUS_REVOKED());
        vm.prank(issuerBank);
        passports.attest(id_, keccak256("claim"), 0);
        assertFalse(passports.isTrustedAgentWallet(wallet, _a1(issuerBank)));

        (address next_, uint256 nextKey_) = makeAddrAndKey("after-revoke");
        bytes memory sig_ = _bindSig(id_, controller, nextKey_, next_, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(YinglongPassportRegistry.PassportRevoked.selector, id_));
        vm.prank(controller);
        passports.setAgentWallet(id_, next_, block.timestamp, sig_);
        vm.expectRevert(abi.encodeWithSelector(YinglongPassportRegistry.PassportRevoked.selector, id_));
        vm.prank(supervisor);
        passports.supervisorSetStatus(id_, false);
    }

    // ------------------------------------------------------------------ attestations

    function test_attest_unknownAgent_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(YinglongPassportRegistry.UnknownAgent.selector, uint256(999)));
        vm.prank(issuerBank);
        passports.attest(999, keccak256("claim"), 0);
    }

    function test_attest_reattestRevokeAndExpiry() public {
        uint256 id_ = _register();
        vm.expectEmit(true, true, true, true, address(passports));
        emit Attested(id_, issuerBank, keccak256("kyb"), uint64(block.timestamp + 1 days));
        vm.prank(issuerBank);
        passports.attest(id_, keccak256("kyb"), uint64(block.timestamp + 1 days));
        vm.prank(issuerBank);
        passports.attest(id_, keccak256("kyb-v2"), uint64(block.timestamp + 1 days));
        assertEq(passports.issuersOf(id_).length, 1);
        assertEq(passports.attestationOf(id_, issuerBank).claimHash, keccak256("kyb-v2"));
        assertTrue(passports.isAttestedBy(id_, issuerBank));
        assertFalse(passports.isAttestedBy(id_, issuerHbu));

        vm.expectEmit(true, true, true, true, address(passports));
        emit AttestationRevoked(id_, issuerBank);
        vm.prank(issuerBank);
        passports.revokeAttestation(id_);
        assertFalse(passports.isAttestedBy(id_, issuerBank));
        vm.prank(issuerBank);
        passports.attest(id_, keccak256("kyb-v3"), uint64(block.timestamp + 1 days));
        assertTrue(passports.isAttestedBy(id_, issuerBank)); // re-attesting clears the revocation

        vm.warp(block.timestamp + 1 days);
        assertTrue(passports.isAttestedBy(id_, issuerBank)); // expiresAt == now is still valid
        vm.warp(block.timestamp + 1);
        assertFalse(passports.isAttestedBy(id_, issuerBank));
    }

    function test_revokeAttestationWithoutAttestation_isHarmless() public {
        uint256 id_ = _register();
        vm.prank(issuerHbu);
        passports.revokeAttestation(id_);
        assertFalse(passports.isAttestedBy(id_, issuerHbu));
        assertEq(passports.issuersOf(id_).length, 0);
    }

    function test_isTrustedAgentWallet_cases() public {
        uint256 id_ = _register();
        vm.prank(issuerHbu);
        passports.attest(id_, keccak256("student"), 0);
        assertTrue(passports.isTrustedAgentWallet(wallet, _a2(issuerBank, issuerHbu)));
        assertFalse(passports.isTrustedAgentWallet(wallet, _a1(issuerBank)));
        assertFalse(passports.isTrustedAgentWallet(wallet, new address[](0)));
        assertFalse(passports.isTrustedAgentWallet(mirage, _a1(issuerHbu)));
        vm.prank(supervisor);
        passports.supervisorSetStatus(id_, true);
        assertFalse(passports.isTrustedAgentWallet(wallet, _a1(issuerHbu)));
    }

    // ------------------------------------------------------------------ supervisor

    function test_supervisorSetStatus_haltResume() public {
        uint256 id_ = _register();
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, controller));
        vm.prank(controller);
        passports.supervisorSetStatus(id_, true);
        vm.expectRevert(abi.encodeWithSelector(YinglongPassportRegistry.UnknownAgent.selector, uint256(999)));
        vm.prank(supervisor);
        passports.supervisorSetStatus(999, true);

        vm.expectEmit(true, true, true, true, address(passports));
        emit StatusChanged(id_, 2, supervisor);
        vm.prank(supervisor);
        passports.supervisorSetStatus(id_, true);
        assertEq(passports.passportOf(id_).status, passports.STATUS_HALTED());
        vm.expectEmit(true, true, true, true, address(passports));
        emit StatusChanged(id_, 1, supervisor);
        vm.prank(supervisor);
        passports.supervisorSetStatus(id_, false);
        assertEq(passports.passportOf(id_).status, passports.STATUS_ACTIVE());
        assertEq(passports.STATUS_NONE(), 0);
    }

    function test_supervisorTransfer_isTwoStep() public {
        address next_ = makeAddr("next-supervisor");
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        vm.prank(mirage);
        passports.transferSupervisor(mirage);
        vm.expectEmit(true, true, true, true, address(passports));
        emit SupervisorTransferStarted(supervisor, next_);
        vm.prank(supervisor);
        passports.transferSupervisor(next_);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, mirage));
        vm.prank(mirage);
        passports.acceptSupervisor();
        vm.expectEmit(true, true, true, true, address(passports));
        emit SupervisorTransferred(supervisor, next_);
        vm.prank(next_);
        passports.acceptSupervisor();
        assertEq(passports.supervisor(), next_);
        assertEq(passports.pendingSupervisor(), address(0));
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, supervisor));
        vm.prank(supervisor);
        passports.supervisorSetStatus(yingAgentId, true);
    }
}
