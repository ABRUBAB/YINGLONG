// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { YinglongEIP712 } from "../utils/YinglongEIP712.sol";
import { Unauthorized, InvalidSignature, SignatureExpired, NonceAlreadyUsed } from "../utils/Errors.sol";

/// @title KillSwitchRegistry
/// @notice One-tap pause for every delegation of an account, checked by GlobalPauseEnforcer at every
/// redemption. Ways to pause:
///  - `tripWithSig`: the user's passkey signs a Trip message; anyone (our relayer) submits it as a plain
///    transaction, so the pause lands in the next block without a bundler;
///  - `trip`: a guardian or the breaker watcher configured by the account (pause only, never unpause);
///  - `tripIfStale`: anyone, when the account's dead-man timer has expired;
///  - `setAgentHalt`: the supervisor halts an agent identity across all accounts (pause only).
/// Only the account itself (directly, or via its passkey signature) can unpause.
contract KillSwitchRegistry is YinglongEIP712 {
    bytes32 public constant TRIP_TYPEHASH = keccak256("Trip(address account,uint256 nonce,uint256 deadline)");
    bytes32 public constant UNTRIP_TYPEHASH = keccak256("Untrip(address account,uint256 nonce,uint256 deadline)");

    address public supervisor;
    address public pendingSupervisor;

    mapping(address account => bool) public tripped;
    mapping(address account => uint256) public nonces;
    mapping(address account => mapping(address guardian => bool)) public isGuardian;
    mapping(address agent => bool) public agentHalted;
    mapping(address account => uint64) public deadmanInterval;
    mapping(address account => uint64) public lastHeartbeat;

    event Tripped(address indexed account, address indexed by, uint8 kind);
    event Untripped(address indexed account, address indexed by);
    event GuardianSet(address indexed account, address indexed guardian, bool enabled);
    event AgentHaltSet(address indexed agent, bool halted, address indexed by);
    event DeadmanSet(address indexed account, uint64 interval);
    event Heartbeat(address indexed account, uint64 at);
    event SupervisorTransferred(address indexed from, address indexed to);

    uint8 public constant KIND_SELF = 0;
    uint8 public constant KIND_SIGNATURE = 1;
    uint8 public constant KIND_GUARDIAN = 2;
    uint8 public constant KIND_DEADMAN = 3;

    error DeadmanNotExpired(address account);

    constructor(address _supervisor, bytes32 _domainSalt) YinglongEIP712(_domainSalt) {
        supervisor = _supervisor;
    }

    function _domainName() internal pure override returns (string memory) {
        return "YINGLONG Kill Switch";
    }

    // ------------------------------------------------------------------ pause

    function trip(address _account) external {
        if (msg.sender == _account) {
            _trip(_account, KIND_SELF);
        } else if (isGuardian[_account][msg.sender]) {
            _trip(_account, KIND_GUARDIAN);
        } else {
            revert Unauthorized(msg.sender);
        }
    }

    /// @notice Relayed pause: `_sig` is the account's ERC-1271 signature (passkey) over Trip(account, nonce, deadline).
    function tripWithSig(address _account, uint256 _nonce, uint256 _deadline, bytes calldata _sig) external {
        _useSig(TRIP_TYPEHASH, _account, _nonce, _deadline, _sig);
        _trip(_account, KIND_SIGNATURE);
    }

    function tripIfStale(address _account) external {
        uint64 interval_ = deadmanInterval[_account];
        if (interval_ == 0 || block.timestamp <= uint256(lastHeartbeat[_account]) + interval_) revert DeadmanNotExpired(_account);
        _trip(_account, KIND_DEADMAN);
    }

    // ------------------------------------------------------------------ unpause (account only)

    function untrip() external {
        _untrip(msg.sender);
    }

    function untripWithSig(address _account, uint256 _nonce, uint256 _deadline, bytes calldata _sig) external {
        _useSig(UNTRIP_TYPEHASH, _account, _nonce, _deadline, _sig);
        _untrip(_account);
    }

    // ------------------------------------------------------------------ configuration (account only)

    function setGuardian(address _guardian, bool _enabled) external {
        isGuardian[msg.sender][_guardian] = _enabled;
        emit GuardianSet(msg.sender, _guardian, _enabled);
    }

    function setDeadman(uint64 _interval) external {
        deadmanInterval[msg.sender] = _interval;
        lastHeartbeat[msg.sender] = uint64(block.timestamp);
        emit DeadmanSet(msg.sender, _interval);
    }

    function heartbeat() external {
        lastHeartbeat[msg.sender] = uint64(block.timestamp);
        emit Heartbeat(msg.sender, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------ supervisor (pause only)

    function setAgentHalt(address _agent, bool _halted) external {
        if (msg.sender != supervisor) revert Unauthorized(msg.sender);
        agentHalted[_agent] = _halted;
        emit AgentHaltSet(_agent, _halted, msg.sender);
    }

    function transferSupervisor(address _to) external {
        if (msg.sender != supervisor) revert Unauthorized(msg.sender);
        pendingSupervisor = _to;
    }

    function acceptSupervisor() external {
        if (msg.sender != pendingSupervisor) revert Unauthorized(msg.sender);
        emit SupervisorTransferred(supervisor, msg.sender);
        supervisor = msg.sender;
        pendingSupervisor = address(0);
    }

    // ------------------------------------------------------------------ views

    /// @notice True if the account is tripped, its dead-man timer expired, or the agent is halted.
    function isPaused(address _account, address _agent) external view returns (bool) {
        if (tripped[_account] || agentHalted[_agent]) return true;
        uint64 interval_ = deadmanInterval[_account];
        return interval_ != 0 && block.timestamp > uint256(lastHeartbeat[_account]) + interval_;
    }

    function tripDigest(address _account, uint256 _nonce, uint256 _deadline) external view returns (bytes32) {
        return _hashTypedData(keccak256(abi.encode(TRIP_TYPEHASH, _account, _nonce, _deadline)));
    }

    function untripDigest(address _account, uint256 _nonce, uint256 _deadline) external view returns (bytes32) {
        return _hashTypedData(keccak256(abi.encode(UNTRIP_TYPEHASH, _account, _nonce, _deadline)));
    }

    // ------------------------------------------------------------------ internals

    function _useSig(bytes32 _typehash, address _account, uint256 _nonce, uint256 _deadline, bytes calldata _sig) private {
        if (block.timestamp > _deadline) revert SignatureExpired(_deadline);
        if (_nonce != nonces[_account]) revert NonceAlreadyUsed(_nonce);
        bytes32 digest_ = _hashTypedData(keccak256(abi.encode(_typehash, _account, _nonce, _deadline)));
        if (!SignatureChecker.isValidSignatureNow(_account, digest_, _sig)) revert InvalidSignature();
        nonces[_account] = _nonce + 1;
    }

    function _trip(address _account, uint8 _kind) private {
        tripped[_account] = true;
        emit Tripped(_account, msg.sender, _kind);
    }

    function _untrip(address _account) private {
        tripped[_account] = false;
        lastHeartbeat[_account] = uint64(block.timestamp);
        emit Untripped(_account, msg.sender);
    }
}
