// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { YinglongEIP712 } from "../utils/YinglongEIP712.sol";
import { Unauthorized, InvalidSignature, SignatureExpired } from "../utils/Errors.sol";

/// @title YinglongPassportRegistry
/// @notice The agent passport (Pearl pillar): binds an agent wallet to the DID of the person or company it
/// acts for, to provenance hashes (model, prompts, policy, code, enforcer table), to the key that signs its
/// A2A agent card, and to attestations from trusted issuers (a university, a bank: "dual authorisation").
/// It mirrors and extends the agent's ERC-8004 identity where a canonical ERC-8004 registry exists.
///
/// Roles:
///  - controller: the passport owner key (held apart from the user's smart account, so no delegation can
///    ever change `agentWallet`);
///  - issuer: any address may attest; relying contracts only count attestations from issuers that the
///    user sealed into the mandate (trusted-issuer set);
///  - supervisor: may pause or resume an agent identity (supervisory halt). It can never spend.
contract YinglongPassportRegistry is YinglongEIP712 {
    uint8 public constant STATUS_NONE = 0;
    uint8 public constant STATUS_ACTIVE = 1;
    uint8 public constant STATUS_HALTED = 2; // supervisory halt
    uint8 public constant STATUS_REVOKED = 3; // revoked by its controller, terminal

    bytes32 public constant BIND_WALLET_TYPEHASH =
        keccak256("BindWallet(uint256 agentId,address controller,address wallet,uint256 deadline)");

    struct Passport {
        address controller;
        address agentWallet;
        bytes32 ownerDidHash; // keccak256 of the principal's DID string
        bytes32 passportVcHash; // hash of the VC 2.0 passport credential
        bytes32 provenanceHash; // hash of the provenance manifest (model, prompts, policy, code)
        bytes32 enforcerTableHash; // hash of the signed enforcer code-hash table
        bytes32 jwksHash; // hash of the JWKS that signs the A2A agent card
        uint256 erc8004AgentId; // canonical ERC-8004 agentId on this ledger (0 if none)
        uint8 status;
        string identityCode; // placeholder agent identity code, e.g. "YL-TEST-0001" (never an issued official code)
        string kid; // key id of the agent-card signing key
        string registrationURI; // ERC-8004 style registration file URI
    }

    struct Attestation {
        bytes32 claimHash;
        uint64 issuedAt;
        uint64 expiresAt;
        bool revoked;
    }

    address public supervisor;
    address public pendingSupervisor;
    uint256 public nextAgentId;

    mapping(uint256 agentId => Passport) private _passports;
    mapping(address wallet => uint256 agentId) public agentIdOf;
    mapping(uint256 agentId => mapping(address issuer => Attestation)) private _attestations;
    mapping(uint256 agentId => address[]) private _issuers;

    event PassportRegistered(uint256 indexed agentId, address indexed controller, address indexed agentWallet, bytes32 ownerDidHash);
    event PassportUpdated(uint256 indexed agentId, bytes32 passportVcHash, bytes32 provenanceHash, bytes32 enforcerTableHash, bytes32 jwksHash);
    event AgentWalletChanged(uint256 indexed agentId, address indexed oldWallet, address indexed newWallet);
    event StatusChanged(uint256 indexed agentId, uint8 status, address indexed by);
    event Attested(uint256 indexed agentId, address indexed issuer, bytes32 claimHash, uint64 expiresAt);
    event AttestationRevoked(uint256 indexed agentId, address indexed issuer);
    event SupervisorTransferStarted(address indexed from, address indexed to);
    event SupervisorTransferred(address indexed from, address indexed to);

    error WalletAlreadyBound(address wallet, uint256 agentId);
    error UnknownAgent(uint256 agentId);
    error PassportRevoked(uint256 agentId);

    constructor(address _supervisor, bytes32 _domainSalt) YinglongEIP712(_domainSalt) {
        supervisor = _supervisor;
        nextAgentId = 1;
    }

    function _domainName() internal pure override returns (string memory) {
        return "YINGLONG Passport Registry";
    }

    modifier onlyController(uint256 _agentId) {
        if (_passports[_agentId].controller != msg.sender) revert Unauthorized(msg.sender);
        _;
    }

    // ------------------------------------------------------------------ registration

    /// @notice Register a passport. The caller becomes its controller. `walletSig` is the agent wallet's
    /// signature over BindWallet(agentId, controller, wallet, deadline), proving the controller holds the wallet.

    struct RegisterParams {
        address agentWallet;
        bytes32 ownerDidHash;
        bytes32 passportVcHash;
        bytes32 provenanceHash;
        bytes32 enforcerTableHash;
        bytes32 jwksHash;
        uint256 erc8004AgentId;
        string identityCode;
        string kid;
        string registrationURI;
        uint256 deadline;
        bytes walletSig;
    }

    function register(RegisterParams calldata _p) external returns (uint256 agentId_) {
        agentId_ = nextAgentId++;
        _bindWallet(agentId_, msg.sender, _p.agentWallet, _p.deadline, _p.walletSig);
        Passport storage p_ = _passports[agentId_];
        p_.controller = msg.sender;
        p_.agentWallet = _p.agentWallet;
        p_.ownerDidHash = _p.ownerDidHash;
        p_.passportVcHash = _p.passportVcHash;
        p_.provenanceHash = _p.provenanceHash;
        p_.enforcerTableHash = _p.enforcerTableHash;
        p_.jwksHash = _p.jwksHash;
        p_.erc8004AgentId = _p.erc8004AgentId;
        p_.status = STATUS_ACTIVE;
        p_.identityCode = _p.identityCode;
        p_.kid = _p.kid;
        p_.registrationURI = _p.registrationURI;
        agentIdOf[_p.agentWallet] = agentId_;
        emit PassportRegistered(agentId_, msg.sender, _p.agentWallet, _p.ownerDidHash);
        emit PassportUpdated(agentId_, _p.passportVcHash, _p.provenanceHash, _p.enforcerTableHash, _p.jwksHash);
    }

    /// @notice Rotate the agent wallet (key-compromise drill). The new wallet signs the binding.
    function setAgentWallet(uint256 _agentId, address _newWallet, uint256 _deadline, bytes calldata _walletSig)
        external
        onlyController(_agentId)
    {
        Passport storage p_ = _passports[_agentId];
        if (p_.status == STATUS_REVOKED) revert PassportRevoked(_agentId);
        _bindWallet(_agentId, msg.sender, _newWallet, _deadline, _walletSig);
        address old_ = p_.agentWallet;
        delete agentIdOf[old_];
        p_.agentWallet = _newWallet;
        agentIdOf[_newWallet] = _agentId;
        emit AgentWalletChanged(_agentId, old_, _newWallet);
    }

    function updateHashes(
        uint256 _agentId,
        bytes32 _passportVcHash,
        bytes32 _provenanceHash,
        bytes32 _enforcerTableHash,
        bytes32 _jwksHash,
        string calldata _kid
    )
        external
        onlyController(_agentId)
    {
        Passport storage p_ = _passports[_agentId];
        p_.passportVcHash = _passportVcHash;
        p_.provenanceHash = _provenanceHash;
        p_.enforcerTableHash = _enforcerTableHash;
        p_.jwksHash = _jwksHash;
        p_.kid = _kid;
        emit PassportUpdated(_agentId, _passportVcHash, _provenanceHash, _enforcerTableHash, _jwksHash);
    }

    function setErc8004AgentId(uint256 _agentId, uint256 _erc8004AgentId) external onlyController(_agentId) {
        _passports[_agentId].erc8004AgentId = _erc8004AgentId;
    }

    /// @notice The controller revokes its own passport (terminal).
    function revoke(uint256 _agentId) external onlyController(_agentId) {
        _passports[_agentId].status = STATUS_REVOKED;
        emit StatusChanged(_agentId, STATUS_REVOKED, msg.sender);
    }

    // ------------------------------------------------------------------ attestations

    /// @notice Attest a claim about an agent (e.g. "enrolled student of HBU", "KYB-verified merchant").
    function attest(uint256 _agentId, bytes32 _claimHash, uint64 _expiresAt) external {
        if (_passports[_agentId].status == STATUS_NONE) revert UnknownAgent(_agentId);
        Attestation storage a_ = _attestations[_agentId][msg.sender];
        if (a_.issuedAt == 0) _issuers[_agentId].push(msg.sender);
        a_.claimHash = _claimHash;
        a_.issuedAt = uint64(block.timestamp);
        a_.expiresAt = _expiresAt;
        a_.revoked = false;
        emit Attested(_agentId, msg.sender, _claimHash, _expiresAt);
    }

    function revokeAttestation(uint256 _agentId) external {
        _attestations[_agentId][msg.sender].revoked = true;
        emit AttestationRevoked(_agentId, msg.sender);
    }

    /// @notice True if `_issuer` holds a live, unexpired attestation for `_agentId`.
    function isAttestedBy(uint256 _agentId, address _issuer) public view returns (bool) {
        Attestation storage a_ = _attestations[_agentId][_issuer];
        return a_.issuedAt != 0 && !a_.revoked && (a_.expiresAt == 0 || a_.expiresAt >= block.timestamp);
    }

    /// @notice True if any issuer in `_trustedIssuers` attests the agent bound to `_wallet` and that agent is active.
    function isTrustedAgentWallet(address _wallet, address[] calldata _trustedIssuers) external view returns (bool) {
        uint256 id_ = agentIdOf[_wallet];
        if (id_ == 0 || _passports[id_].status != STATUS_ACTIVE) return false;
        for (uint256 i; i < _trustedIssuers.length; ++i) {
            if (isAttestedBy(id_, _trustedIssuers[i])) return true;
        }
        return false;
    }

    function attestationOf(uint256 _agentId, address _issuer) external view returns (Attestation memory) {
        return _attestations[_agentId][_issuer];
    }

    function issuersOf(uint256 _agentId) external view returns (address[] memory) {
        return _issuers[_agentId];
    }

    // ------------------------------------------------------------------ supervision

    /// @notice Supervisory halt or resume of an agent identity. Pause only: the supervisor cannot spend,
    /// rotate keys or change any mandate.
    function supervisorSetStatus(uint256 _agentId, bool _halted) external {
        if (msg.sender != supervisor) revert Unauthorized(msg.sender);
        Passport storage p_ = _passports[_agentId];
        if (p_.status == STATUS_NONE) revert UnknownAgent(_agentId);
        if (p_.status == STATUS_REVOKED) revert PassportRevoked(_agentId);
        p_.status = _halted ? STATUS_HALTED : STATUS_ACTIVE;
        emit StatusChanged(_agentId, p_.status, msg.sender);
    }

    function transferSupervisor(address _to) external {
        if (msg.sender != supervisor) revert Unauthorized(msg.sender);
        pendingSupervisor = _to;
        emit SupervisorTransferStarted(msg.sender, _to);
    }

    function acceptSupervisor() external {
        if (msg.sender != pendingSupervisor) revert Unauthorized(msg.sender);
        emit SupervisorTransferred(supervisor, msg.sender);
        supervisor = msg.sender;
        pendingSupervisor = address(0);
    }

    // ------------------------------------------------------------------ views

    function passportOf(uint256 _agentId) external view returns (Passport memory) {
        return _passports[_agentId];
    }

    /// @notice Compact view used by enforcers: agent id, status and owner DID hash for a wallet.
    function walletInfo(address _wallet) external view returns (uint256 agentId_, uint8 status_, bytes32 ownerDidHash_) {
        agentId_ = agentIdOf[_wallet];
        Passport storage p_ = _passports[agentId_];
        return (agentId_, p_.status, p_.ownerDidHash);
    }

    /// @notice Canonical ERC-8004 agentId of the agent bound to `_wallet` (0 if none).
    function erc8004IdOfWallet(address _wallet) external view returns (uint256) {
        return _passports[agentIdOf[_wallet]].erc8004AgentId;
    }

    function bindWalletDigest(uint256 _agentId, address _controller, address _wallet, uint256 _deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedData(keccak256(abi.encode(BIND_WALLET_TYPEHASH, _agentId, _controller, _wallet, _deadline)));
    }

    function _bindWallet(uint256 _agentId, address _controller, address _wallet, uint256 _deadline, bytes calldata _sig)
        private
        view
    {
        if (block.timestamp > _deadline) revert SignatureExpired(_deadline);
        uint256 existing_ = agentIdOf[_wallet];
        if (existing_ != 0) revert WalletAlreadyBound(_wallet, existing_);
        bytes32 digest_ = bindWalletDigest(_agentId, _controller, _wallet, _deadline);
        if (!SignatureChecker.isValidSignatureNow(_wallet, digest_, _sig)) revert InvalidSignature();
    }
}
