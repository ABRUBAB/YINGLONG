// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { PaymentDecoder } from "../libraries/PaymentDecoder.sol";
import { IRailInfo } from "../interfaces/IYinglongViews.sol";
import { RailNotPermitted, InvalidTerms } from "../utils/Errors.sol";

/// @title JurisdictionEnforcer
/// @notice Rails as code. The paid asset must be one of the assets sealed for the mandate's jurisdiction
/// profile. In addition, a rule no mandate can override: under the MAINLAND profile only coin-free
/// instruction rails (railKind 3) are permitted, because virtual-currency business is not allowed on the
/// mainland (PBoC and seven departments, notice of 6 Feb 2026). A token that does not report a rail kind
/// is treated as a value-bearing token.
/// Terms: abi.encode(uint8 profile, address[] allowedAssets).
contract JurisdictionEnforcer is YinglongEnforcer {
    uint8 public constant PROFILE_HONG_KONG = 1;
    uint8 public constant PROFILE_INTERNATIONAL = 2;
    uint8 public constant PROFILE_MAINLAND = 3;
    uint8 public constant RAIL_COIN_FREE = 3;

    function getTermsInfo(bytes calldata _terms) public pure returns (uint8 profile_, address[] memory assets_) {
        if (_terms.length < 96) revert InvalidTerms();
        (profile_, assets_) = abi.decode(_terms, (uint8, address[]));
        if (profile_ < PROFILE_HONG_KONG || profile_ > PROFILE_MAINLAND) revert InvalidTerms();
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
        (uint8 profile_, address[] memory assets_) = getTermsInfo(_terms);
        PaymentDecoder.Payment memory p_ = PaymentDecoder.decode(_executionCallData);

        bool allowed_;
        for (uint256 i; i < assets_.length; ++i) {
            if (assets_[i] == p_.asset) {
                allowed_ = true;
                break;
            }
        }
        if (!allowed_) revert RailNotPermitted(p_.asset, profile_);
        if (profile_ == PROFILE_MAINLAND && railKindOf(p_.asset) != RAIL_COIN_FREE) revert RailNotPermitted(p_.asset, profile_);
    }

    /// @notice Rail kind reported by an asset, or 0 if it does not implement IRailInfo.
    function railKindOf(address _asset) public view returns (uint8 kind_) {
        (bool ok_, bytes memory ret_) = _asset.staticcall(abi.encodeWithSelector(IRailInfo.railKind.selector));
        if (ok_ && ret_.length == 32) {
            uint256 v_ = abi.decode(ret_, (uint256));
            if (v_ <= type(uint8).max) kind_ = uint8(v_);
        }
    }
}
