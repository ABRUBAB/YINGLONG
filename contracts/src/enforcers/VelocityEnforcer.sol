// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { PaymentDecoder } from "../libraries/PaymentDecoder.sol";
import { VelocityExceeded, InvalidTerms } from "../utils/Errors.sol";

/// @title VelocityEnforcer
/// @notice Limits how often and how much the agent can move in a window: at most `maxCount` payments (any
/// asset) and at most `maxOutflow` of `asset` per fixed window of `window` seconds. Defeats "split the
/// payment into many small ones". Counters are keyed by (DelegationManager, delegator, window index) and so
/// aggregate across delegations.
/// Note: a reverted transaction writes nothing, so the circuit breaker trips off-chain (the policy engine
/// and the signer call KillSwitchRegistry.trip when they refuse).
/// Terms: abi.encode(address asset, uint64 window, uint32 maxCount, uint256 maxOutflow) (128 bytes).
contract VelocityEnforcer is YinglongEnforcer {
    struct Usage {
        uint32 count;
        uint256 outflow;
    }

    mapping(bytes32 key => Usage) public usage;

    event VelocityUsed(address indexed delegationManager, address indexed delegator, uint256 indexed windowIndex, uint32 count, uint256 outflow);

    function getTermsInfo(bytes calldata _terms)
        public
        pure
        returns (address asset_, uint64 window_, uint32 maxCount_, uint256 maxOutflow_)
    {
        if (_terms.length != 128) revert InvalidTerms();
        (asset_, window_, maxCount_, maxOutflow_) = abi.decode(_terms, (address, uint64, uint32, uint256));
        if (window_ == 0) revert InvalidTerms();
    }

    function usageKey(address _dm, address _delegator, uint256 _windowIndex) public pure returns (bytes32) {
        return keccak256(abi.encode(_dm, _delegator, _windowIndex));
    }

    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32,
        address _delegator,
        address
    )
        public
        override
    {
        _requireSingleDefault(_mode);
        (address asset_, uint64 window_, uint32 maxCount_, uint256 maxOutflow_) = getTermsInfo(_terms);
        PaymentDecoder.Payment memory p_ = PaymentDecoder.decode(_executionCallData);
        uint256 windowIndex_ = block.timestamp / window_;
        Usage storage u_ = usage[usageKey(msg.sender, _delegator, windowIndex_)];
        uint32 count_ = u_.count + 1;
        uint256 outflow_ = u_.outflow + (p_.asset == asset_ ? p_.amount : 0);
        if (count_ > maxCount_ || outflow_ > maxOutflow_) revert VelocityExceeded(count_, outflow_);
        u_.count = count_;
        u_.outflow = outflow_;
        emit VelocityUsed(msg.sender, _delegator, windowIndex_, count_, outflow_);
    }
}
