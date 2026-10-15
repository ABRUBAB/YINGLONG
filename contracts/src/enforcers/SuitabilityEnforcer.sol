// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { PaymentDecoder } from "../libraries/PaymentDecoder.sol";
import { IProductRegistryView } from "../interfaces/IYinglongViews.sol";
import { UnsuitableProduct, InvalidTerms } from "../utils/Errors.sol";

/// @title SuitabilityEnforcer
/// @notice Suitability as code: when money flows into a listed investment product (a test money-market fund),
/// the product's risk class must not exceed the class sealed in the mandate (the result of the user's
/// suitability assessment). Payments to non-product payees are not affected.
/// Terms: abi.encode(address productRegistry, uint8 maxRiskClass) (64 bytes).
contract SuitabilityEnforcer is YinglongEnforcer {
    function getTermsInfo(bytes calldata _terms) public pure returns (address registry_, uint8 maxRiskClass_) {
        if (_terms.length != 64) revert InvalidTerms();
        (registry_, maxRiskClass_) = abi.decode(_terms, (address, uint8));
    }

    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32,
        address,
        address
    )
        public
        view
        override
    {
        _requireSingleDefault(_mode);
        (address registry_, uint8 max_) = getTermsInfo(_terms);
        PaymentDecoder.Payment memory p_ = PaymentDecoder.decode(_executionCallData);
        _check(registry_, p_.recipient, max_);
        if (p_.beneficiary != p_.recipient) _check(registry_, p_.beneficiary, max_);
    }

    function _check(address _registry, address _product, uint8 _max) private view {
        (bool listed_, uint8 class_) = IProductRegistryView(_registry).productInfo(_product);
        if (listed_ && class_ > _max) revert UnsuitableProduct(_product, class_, _max);
    }
}
