// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { IPassportView } from "../interfaces/IYinglongViews.sol";
import { LineageViolation, InvalidTerms } from "../utils/Errors.sol";

/// @title AgentLineageEnforcer
/// @notice Identity-bound delegation: the redeemer must be the wallet of an ACTIVE passport whose owner DID
/// equals the DID sealed in the mandate (the agent, or a sub-agent of the same principal), or the x402
/// facilitator pinned in the mandate (allowed only because the compiler gives it single-use, exact-amount
/// child delegations).
/// Terms: abi.encode(address passportRegistry, bytes32 ownerDidHash, address pinnedFacilitator) (96 bytes).
contract AgentLineageEnforcer is YinglongEnforcer {
    uint8 internal constant STATUS_ACTIVE = 1;

    function getTermsInfo(bytes calldata _terms)
        public
        pure
        returns (address registry_, bytes32 ownerDidHash_, address facilitator_)
    {
        if (_terms.length != 96) revert InvalidTerms();
        (registry_, ownerDidHash_, facilitator_) = abi.decode(_terms, (address, bytes32, address));
    }

    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata,
        bytes32,
        address,
        address _redeemer
    )
        public
        view
        override
    {
        _requireSingleDefault(_mode);
        (address registry_, bytes32 ownerDidHash_, address facilitator_) = getTermsInfo(_terms);
        if (facilitator_ != address(0) && _redeemer == facilitator_) return;
        (uint256 agentId_, uint8 status_, bytes32 did_) = IPassportView(registry_).walletInfo(_redeemer);
        if (agentId_ == 0 || status_ != STATUS_ACTIVE || did_ != ownerDidHash_) revert LineageViolation(_redeemer);
    }
}
