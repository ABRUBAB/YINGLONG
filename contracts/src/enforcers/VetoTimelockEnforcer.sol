// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { YinglongEIP712 } from "../utils/YinglongEIP712.sol";
import { VetoWindowOpen, Vetoed, NotScheduled, InvalidTerms, InvalidSignature, SignatureExpired, Unauthorized } from
    "../utils/Errors.sol";

/// @title VetoTimelockEnforcer
/// @notice Scheduled payments with a veto window: the agent first announces the exact execution
/// (`schedule`), the app shows it to the user, and the redemption only succeeds after `window` seconds if
/// nobody vetoed it. The user vetoes directly from the account or with a relayed passkey signature. A
/// guardian stops everything through the kill switch. Each schedule is consumed by one redemption, and only
/// the address that scheduled it may redeem it.
/// Terms: abi.encode(uint256 window) (32 bytes).
contract VetoTimelockEnforcer is YinglongEnforcer, YinglongEIP712 {
    bytes32 public constant VETO_TYPEHASH =
        keccak256("Veto(address delegationManager,bytes32 delegationHash,bytes32 executionHash,uint256 deadline)");

    struct Schedule {
        address scheduler;
        address delegator;
        uint64 scheduledAt;
        bool vetoed;
    }

    mapping(bytes32 key => Schedule) public schedules;

    event Scheduled(
        address indexed delegationManager,
        bytes32 indexed delegationHash,
        bytes32 indexed executionHash,
        address delegator,
        address scheduler,
        uint64 scheduledAt
    );
    event VetoRecorded(address indexed delegationManager, bytes32 indexed delegationHash, bytes32 indexed executionHash);
    event ScheduleConsumed(address indexed delegationManager, bytes32 indexed delegationHash, bytes32 indexed executionHash);

    error AlreadyScheduled();

    constructor(bytes32 _domainSalt) YinglongEIP712(_domainSalt) { }

    function _domainName() internal pure override returns (string memory) {
        return "YINGLONG Veto Timelock";
    }

    function getTermsInfo(bytes calldata _terms) public pure returns (uint256 window_) {
        if (_terms.length != 32) revert InvalidTerms();
        window_ = abi.decode(_terms, (uint256));
    }

    function scheduleKey(address _dm, bytes32 _delegationHash, bytes32 _executionHash) public pure returns (bytes32) {
        return keccak256(abi.encode(_dm, _delegationHash, _executionHash));
    }

    /// @notice Announce an execution. Starts the veto window.
    function schedule(address _dm, bytes32 _delegationHash, address _delegator, bytes calldata _executionCallData) external {
        bytes32 execHash_ = keccak256(_executionCallData);
        Schedule storage s_ = schedules[scheduleKey(_dm, _delegationHash, execHash_)];
        if (s_.scheduledAt != 0) revert AlreadyScheduled();
        s_.scheduler = msg.sender;
        s_.delegator = _delegator;
        s_.scheduledAt = uint64(block.timestamp);
        emit Scheduled(_dm, _delegationHash, execHash_, _delegator, msg.sender, uint64(block.timestamp));
    }

    /// @notice Veto directly from the delegator account.
    function veto(address _dm, bytes32 _delegationHash, bytes32 _executionHash) external {
        Schedule storage s_ = _scheduled(_dm, _delegationHash, _executionHash);
        if (msg.sender != s_.delegator) revert Unauthorized(msg.sender);
        s_.vetoed = true;
        emit VetoRecorded(_dm, _delegationHash, _executionHash);
    }

    /// @notice Relayed veto signed by the delegator account (ERC-1271, passkey).
    function vetoWithSig(address _dm, bytes32 _delegationHash, bytes32 _executionHash, uint256 _deadline, bytes calldata _sig)
        external
    {
        if (block.timestamp > _deadline) revert SignatureExpired(_deadline);
        Schedule storage s_ = _scheduled(_dm, _delegationHash, _executionHash);
        bytes32 digest_ = vetoDigest(_dm, _delegationHash, _executionHash, _deadline);
        if (!SignatureChecker.isValidSignatureNow(s_.delegator, digest_, _sig)) revert InvalidSignature();
        s_.vetoed = true;
        emit VetoRecorded(_dm, _delegationHash, _executionHash);
    }

    function vetoDigest(address _dm, bytes32 _delegationHash, bytes32 _executionHash, uint256 _deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedData(keccak256(abi.encode(VETO_TYPEHASH, _dm, _delegationHash, _executionHash, _deadline)));
    }

    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    )
        public
        override
    {
        _requireSingleDefault(_mode);
        uint256 window_ = getTermsInfo(_terms);
        bytes32 execHash_ = keccak256(_executionCallData);
        bytes32 key_ = scheduleKey(msg.sender, _delegationHash, execHash_);
        Schedule storage s_ = schedules[key_];
        if (s_.scheduledAt == 0 || s_.scheduler != _redeemer || s_.delegator != _delegator) revert NotScheduled();
        if (s_.vetoed) revert Vetoed();
        uint256 readyAt_ = uint256(s_.scheduledAt) + window_;
        if (block.timestamp < readyAt_) revert VetoWindowOpen(uint64(readyAt_));
        delete schedules[key_];
        emit ScheduleConsumed(msg.sender, _delegationHash, execHash_);
    }

    function _scheduled(address _dm, bytes32 _delegationHash, bytes32 _executionHash) private view returns (Schedule storage s_) {
        s_ = schedules[scheduleKey(_dm, _delegationHash, _executionHash)];
        if (s_.scheduledAt == 0) revert NotScheduled();
    }
}
