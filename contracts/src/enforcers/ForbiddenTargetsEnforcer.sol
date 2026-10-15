// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { ForbiddenTarget, InvalidTerms } from "../utils/Errors.sol";

/// @title ForbiddenTargetsEnforcer
/// @notice Keeps T3 actions out of reach of any delegation: the execution target may never be the delegator
/// itself (signer changes, upgrades, deposits), the DelegationManager, or any address listed in the terms
/// (EntryPoints, paymasters, ERC-8004 registries, PayeeBook, MandateRegistry, KillSwitchRegistry,
/// ProductRegistry, PassportRegistry, AccountabilityLedger). The compiler asserts this list is disjoint from
/// the AllowedTargets list; this enforcer is the second, independent line.
/// Terms: packed 20-byte addresses (length must be a multiple of 20).
contract ForbiddenTargetsEnforcer is YinglongEnforcer {
    using ExecutionLib for bytes;

    function getTermsInfo(bytes calldata _terms) public pure returns (address[] memory forbidden_) {
        if (_terms.length % 20 != 0) revert InvalidTerms();
        uint256 n_ = _terms.length / 20;
        forbidden_ = new address[](n_);
        for (uint256 i; i < n_; ++i) {
            forbidden_[i] = address(bytes20(_terms[i * 20:(i + 1) * 20]));
        }
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
        view
        override
    {
        _requireSingleDefault(_mode);
        if (_terms.length % 20 != 0) revert InvalidTerms();
        (address target_,,) = _executionCallData.decodeSingle();
        if (target_ == _delegator || target_ == msg.sender) revert ForbiddenTarget(target_);
        uint256 n_ = _terms.length / 20;
        for (uint256 i; i < n_; ++i) {
            if (target_ == address(bytes20(_terms[i * 20:(i + 1) * 20]))) revert ForbiddenTarget(target_);
        }
    }
}
