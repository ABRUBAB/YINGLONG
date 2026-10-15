// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { PaymentDecoder } from "../libraries/PaymentDecoder.sol";
import { IPayeeBookView, IPassportView } from "../interfaces/IYinglongViews.sol";
import { PayeeNotVerified, InvalidTerms } from "../utils/Errors.sol";

/// @title VerifiedPayeeEnforcer
/// @notice Only verified payees receive funds. The beneficiary (decoded from calldata, never from args) must
/// be an active entry of the delegator's PayeeBook, or the wallet of an active agent passport attested by an
/// issuer in the sealed trusted-issuer set. When funds go through a rail contract (escrow, quote
/// settlement, fund), that contract must be one of the sealed intermediaries.
/// Terms: abi.encode(address payeeBook, address passportRegistry, address[] trustedIssuers, address[] intermediaries).
contract VerifiedPayeeEnforcer is YinglongEnforcer {
    function getTermsInfo(bytes calldata _terms)
        public
        pure
        returns (address payeeBook_, address passport_, address[] memory issuers_, address[] memory intermediaries_)
    {
        if (_terms.length < 192) revert InvalidTerms();
        (payeeBook_, passport_, issuers_, intermediaries_) = abi.decode(_terms, (address, address, address[], address[]));
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
        (address payeeBook_, address passport_, address[] memory issuers_, address[] memory intermediaries_) =
            getTermsInfo(_terms);
        PaymentDecoder.Payment memory p_ = PaymentDecoder.decode(_executionCallData);

        if (p_.recipient != p_.beneficiary && !_contains(intermediaries_, p_.recipient)) revert PayeeNotVerified(p_.recipient);

        (bool active_,) = IPayeeBookView(payeeBook_).lookup(_delegator, p_.beneficiary);
        if (active_) return;
        if (issuers_.length != 0 && IPassportView(passport_).isTrustedAgentWallet(p_.beneficiary, issuers_)) return;
        revert PayeeNotVerified(p_.beneficiary);
    }

    function _contains(address[] memory _list, address _a) private pure returns (bool) {
        for (uint256 i; i < _list.length; ++i) {
            if (_list[i] == _a) return true;
        }
        return false;
    }
}
