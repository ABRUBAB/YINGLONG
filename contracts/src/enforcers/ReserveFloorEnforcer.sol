// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { ReserveFloorBreached, InvalidTerms } from "../utils/Errors.sol";

/// @title ReserveFloorEnforcer
/// @notice "Never below 1,500": after the whole redemption, the delegator's balance of `asset` must be at
/// least `floor`. Checked in afterAllHook, so it sees the final state. Works with any contract exposing
/// ERC-20 `balanceOf` (on the coin-free rail, ConditionalPaymentInstructions reports the simulated deposit
/// balance net of pending instructions).
/// Terms: abi.encode(address asset, uint256 floor) (64 bytes).
contract ReserveFloorEnforcer is YinglongEnforcer {
    function getTermsInfo(bytes calldata _terms) public pure returns (address asset_, uint256 floor_) {
        if (_terms.length != 64) revert InvalidTerms();
        (asset_, floor_) = abi.decode(_terms, (address, uint256));
    }

    function beforeHook(bytes calldata _terms, bytes calldata, ModeCode _mode, bytes calldata, bytes32, address, address)
        public
        pure
        override
    {
        _requireSingleDefault(_mode);
        getTermsInfo(_terms);
    }

    function afterAllHook(bytes calldata _terms, bytes calldata, ModeCode, bytes calldata, bytes32, address _delegator, address)
        public
        view
        override
    {
        (address asset_, uint256 floor_) = getTermsInfo(_terms);
        uint256 balance_ = IERC20(asset_).balanceOf(_delegator);
        if (balance_ < floor_) revert ReserveFloorBreached(asset_, balance_, floor_);
    }
}
