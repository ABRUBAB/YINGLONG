// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { IKillSwitchView, IPassportView } from "../interfaces/IYinglongViews.sol";
import { Paused, InvalidTerms } from "../utils/Errors.sol";

/// @title GlobalPauseEnforcer
/// @notice One tap stops everything: refuses every redemption while the delegator's kill switch is tripped
/// (passkey pause, guardian, breaker watcher, dead-man timer), while the redeeming agent is halted by the
/// supervisor, or while the redeemer's passport is not active. Runs in beforeAllHook, before any other hook.
/// Terms: abi.encode(address killSwitch, address passportRegistry) (64 bytes).
contract GlobalPauseEnforcer is YinglongEnforcer {
    uint8 internal constant STATUS_ACTIVE = 1;

    function getTermsInfo(bytes calldata _terms) public pure returns (address killSwitch_, address passport_) {
        if (_terms.length != 64) revert InvalidTerms();
        (killSwitch_, passport_) = abi.decode(_terms, (address, address));
    }

    function beforeAllHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata,
        bytes32,
        address _delegator,
        address _redeemer
    )
        public
        view
        override
    {
        _requireSingleDefault(_mode);
        (address killSwitch_, address passport_) = getTermsInfo(_terms);
        if (IKillSwitchView(killSwitch_).isPaused(_delegator, _redeemer)) revert Paused(_delegator, _redeemer);
        if (passport_ != address(0)) {
            (uint256 agentId_, uint8 status_,) = IPassportView(passport_).walletInfo(_redeemer);
            if (agentId_ != 0 && status_ != STATUS_ACTIVE) revert Paused(_delegator, _redeemer);
        }
    }
}
