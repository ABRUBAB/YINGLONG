// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { MandateNotLive, MandateDelegationMismatch, InvalidTerms, InvalidArgs } from "../utils/Errors.sol";

interface IMandateRegistryView {
    function delegationOf(bytes32 mandateHash) external view returns (bytes32);
    function isLive(bytes32 mandateHash) external view returns (bool);
}

/// @title MandateBindingEnforcer
/// @notice Binds a delegation to a published, live mandate: the delegation being redeemed must be the one
/// the MandateRegistry records for `mandateHash`, and the mandate must be live (not superseded, revoked or
/// outside its validity window). Logs the agent's intent hash and receipt nonce as commitments that the
/// accountability receipt later references.
/// Terms: abi.encode(address mandateRegistry, bytes32 mandateHash) (64 bytes).
/// Args (optional, untrusted, logged only): abi.encode(bytes32 intentHash, uint256 receiptNonce).
contract MandateBindingEnforcer is YinglongEnforcer {
    event MandateRedemption(
        address indexed delegationManager,
        address indexed delegator,
        bytes32 indexed mandateHash,
        bytes32 delegationHash,
        address redeemer,
        bytes32 intentHash,
        uint256 receiptNonce
    );

    function getTermsInfo(bytes calldata _terms) public pure returns (address registry_, bytes32 mandateHash_) {
        if (_terms.length != 64) revert InvalidTerms();
        (registry_, mandateHash_) = abi.decode(_terms, (address, bytes32));
    }

    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    )
        public
        override
    {
        _requireSingleDefault(_mode);
        (address registry_, bytes32 mandateHash_) = getTermsInfo(_terms);
        bytes32 recorded_ = IMandateRegistryView(registry_).delegationOf(mandateHash_);
        if (recorded_ != _delegationHash) revert MandateDelegationMismatch(mandateHash_, recorded_, _delegationHash);
        if (!IMandateRegistryView(registry_).isLive(mandateHash_)) revert MandateNotLive(mandateHash_);

        bytes32 intentHash_;
        uint256 receiptNonce_;
        if (_args.length == 64) {
            (intentHash_, receiptNonce_) = abi.decode(_args, (bytes32, uint256));
        } else if (_args.length != 0) {
            revert InvalidArgs();
        }
        emit MandateRedemption(msg.sender, _delegator, mandateHash_, _delegationHash, _redeemer, intentHash_, receiptNonce_);
    }
}
