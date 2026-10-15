// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Delegation, Caveat } from "@delegation-framework/utils/Types.sol";
import { EncoderLib } from "@delegation-framework/libraries/EncoderLib.sol";
import { Unauthorized } from "../utils/Errors.sol";

interface IPauseView {
    function isPaused(address account, address agent) external view returns (bool);
}

/// @title MandateRegistry
/// @notice The Seal pillar's public record. A user's account publishes each sealed mandate here together
/// with the FULL caveat array of the delegation that enforces it. The registry recomputes the ERC-7710
/// delegation hash from the published fields, so anyone can check that the published caveats are exactly
/// the caveats the DelegationManager will enforce (round-trip verification).
///
/// Rules:
///  - only the account itself publishes, supersedes or revokes (T3 actions);
///  - at most one live mandate per (account, lineage) at any time;
///  - superseding is atomic in the registry; the account disables the old delegation in the same user
///    operation (DelegationManager.disableDelegation), so the old authority stops at the same block.
///
/// It also exposes an ERC-8226-compatible read interface (`canExecute`, `isFrozen`) for standards alignment.
contract MandateRegistry {
    bytes32 internal constant ROOT_AUTHORITY = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    enum Status {
        None,
        Live,
        Superseded,
        Revoked
    }

    // Jurisdiction profiles (shared with JurisdictionEnforcer and the TypeScript compiler).
    uint8 public constant PROFILE_HONG_KONG = 1;
    uint8 public constant PROFILE_INTERNATIONAL = 2;
    uint8 public constant PROFILE_MAINLAND = 3;

    struct Mandate {
        address account;
        address agent; // the delegate
        bytes32 delegationHash;
        bytes32 lineageId;
        bytes32 caveatsHash; // keccak256(abi.encode(caveats)) including args as published
        uint32 version;
        uint8 jurisdiction;
        Status status;
        uint64 validFrom;
        uint64 validUntil;
        uint64 publishedAt;
    }

    struct PublishParams {
        bytes32 mandateHash; // hash of the canonical mandate document (see packages/mandate)
        address agent;
        bytes32 lineageId;
        uint8 jurisdiction;
        uint64 validFrom;
        uint64 validUntil;
        uint256 salt; // the delegation salt
        Caveat[] caveats;
    }

    address public killSwitch;

    mapping(bytes32 mandateHash => Mandate) private _mandates;
    mapping(bytes32 delegationHash => bytes32 mandateHash) public mandateOfDelegation;
    mapping(address account => mapping(bytes32 lineageId => bytes32 mandateHash)) public liveMandateOfLineage;
    mapping(address account => mapping(bytes32 lineageId => uint32 version)) public lineageVersion;
    mapping(address account => mapping(address agent => bytes32 mandateHash)) public liveMandateOfAgent;
    mapping(address account => bytes32[]) private _history;

    event MandatePublished(
        address indexed account,
        bytes32 indexed mandateHash,
        bytes32 indexed delegationHash,
        address agent,
        bytes32 lineageId,
        uint32 version,
        uint8 jurisdiction,
        uint64 validFrom,
        uint64 validUntil,
        uint256 salt,
        Caveat[] caveats
    );
    event MandateSuperseded(address indexed account, bytes32 indexed oldMandateHash, bytes32 indexed newMandateHash);
    event MandateRevoked(address indexed account, bytes32 indexed mandateHash);

    error MandateExists(bytes32 mandateHash);
    error LineageHasLiveMandate(bytes32 lineageId, bytes32 liveMandate);
    error NotLive(bytes32 mandateHash);
    error InvalidValidity(uint64 validFrom, uint64 validUntil);
    error InvalidJurisdiction(uint8 jurisdiction);

    constructor(address _killSwitch) {
        killSwitch = _killSwitch;
    }

    // ------------------------------------------------------------------ writes (account only)

    function publish(PublishParams calldata _p) external returns (bytes32 delegationHash_) {
        delegationHash_ = _publish(_p);
    }

    /// @notice Replace a live mandate with a new one in the same lineage, atomically.
    function supersede(bytes32 _oldMandateHash, PublishParams calldata _p) external returns (bytes32 delegationHash_) {
        Mandate storage old_ = _mandates[_oldMandateHash];
        if (old_.account != msg.sender) revert Unauthorized(msg.sender);
        if (old_.status != Status.Live) revert NotLive(_oldMandateHash);
        _retire(old_, _oldMandateHash, Status.Superseded);
        delegationHash_ = _publish(_p);
        emit MandateSuperseded(msg.sender, _oldMandateHash, _p.mandateHash);
    }

    function revoke(bytes32 _mandateHash) external {
        Mandate storage m_ = _mandates[_mandateHash];
        if (m_.account != msg.sender) revert Unauthorized(msg.sender);
        if (m_.status != Status.Live) revert NotLive(_mandateHash);
        _retire(m_, _mandateHash, Status.Revoked);
        emit MandateRevoked(msg.sender, _mandateHash);
    }

    // ------------------------------------------------------------------ reads

    function mandateOf(bytes32 _mandateHash) external view returns (Mandate memory) {
        return _mandates[_mandateHash];
    }

    function delegationOf(bytes32 _mandateHash) external view returns (bytes32) {
        return _mandates[_mandateHash].delegationHash;
    }

    /// @notice Live = published, not superseded or revoked, and inside its validity window.
    function isLive(bytes32 _mandateHash) public view returns (bool) {
        Mandate storage m_ = _mandates[_mandateHash];
        return m_.status == Status.Live && block.timestamp >= m_.validFrom && block.timestamp <= m_.validUntil;
    }

    function historyOf(address _account) external view returns (bytes32[] memory) {
        return _history[_account];
    }

    /// @notice Recompute the ERC-7710 delegation hash for a root delegation from `_account` with these fields.
    function computeDelegationHash(address _account, address _agent, uint256 _salt, Caveat[] calldata _caveats)
        public
        pure
        returns (bytes32)
    {
        Delegation memory d_ = Delegation({
            delegate: _agent,
            delegator: _account,
            authority: ROOT_AUTHORITY,
            caveats: _caveats,
            salt: _salt,
            signature: ""
        });
        return EncoderLib._getDelegationHash(d_);
    }

    // ERC-8226-compatible read interface ------------------------------------------------------

    /// @notice Coarse pre-check: is there a live mandate for (account, agent) and is the account unfrozen?
    /// Caveat-level rules (amounts, payees, budgets) are decided by the enforcers at redemption.
    function canExecute(address _account, address _agent, address, uint256)
        external
        view
        returns (bool ok_, bytes32 reasonCode_)
    {
        if (isFrozen(_account, _agent)) return (false, "FROZEN");
        bytes32 h_ = liveMandateOfAgent[_account][_agent];
        if (h_ == bytes32(0) || !isLive(h_)) return (false, "NO_LIVE_MANDATE");
        return (true, "OK");
    }

    function isFrozen(address _account, address _agent) public view returns (bool) {
        if (killSwitch == address(0)) return false;
        return IPauseView(killSwitch).isPaused(_account, _agent);
    }

    // ------------------------------------------------------------------ internals

    function _publish(PublishParams calldata _p) private returns (bytes32 delegationHash_) {
        if (_mandates[_p.mandateHash].status != Status.None) revert MandateExists(_p.mandateHash);
        if (_p.validUntil <= _p.validFrom) revert InvalidValidity(_p.validFrom, _p.validUntil);
        if (_p.jurisdiction < PROFILE_HONG_KONG || _p.jurisdiction > PROFILE_MAINLAND) revert InvalidJurisdiction(_p.jurisdiction);
        bytes32 live_ = liveMandateOfLineage[msg.sender][_p.lineageId];
        if (live_ != bytes32(0) && _mandates[live_].status == Status.Live) revert LineageHasLiveMandate(_p.lineageId, live_);

        delegationHash_ = computeDelegationHash(msg.sender, _p.agent, _p.salt, _p.caveats);
        uint32 version_ = ++lineageVersion[msg.sender][_p.lineageId];

        Mandate storage m_ = _mandates[_p.mandateHash];
        m_.account = msg.sender;
        m_.agent = _p.agent;
        m_.delegationHash = delegationHash_;
        m_.lineageId = _p.lineageId;
        m_.caveatsHash = keccak256(abi.encode(_p.caveats));
        m_.version = version_;
        m_.jurisdiction = _p.jurisdiction;
        m_.status = Status.Live;
        m_.validFrom = _p.validFrom;
        m_.validUntil = _p.validUntil;
        m_.publishedAt = uint64(block.timestamp);

        mandateOfDelegation[delegationHash_] = _p.mandateHash;
        liveMandateOfLineage[msg.sender][_p.lineageId] = _p.mandateHash;
        liveMandateOfAgent[msg.sender][_p.agent] = _p.mandateHash;
        _history[msg.sender].push(_p.mandateHash);

        emit MandatePublished(
            msg.sender,
            _p.mandateHash,
            delegationHash_,
            _p.agent,
            _p.lineageId,
            version_,
            _p.jurisdiction,
            _p.validFrom,
            _p.validUntil,
            _p.salt,
            _p.caveats
        );
    }

    function _retire(Mandate storage _m, bytes32 _mandateHash, Status _status) private {
        _m.status = _status;
        if (liveMandateOfLineage[_m.account][_m.lineageId] == _mandateHash) {
            delete liveMandateOfLineage[_m.account][_m.lineageId];
        }
        if (liveMandateOfAgent[_m.account][_m.agent] == _mandateHash) {
            delete liveMandateOfAgent[_m.account][_m.agent];
        }
    }
}
