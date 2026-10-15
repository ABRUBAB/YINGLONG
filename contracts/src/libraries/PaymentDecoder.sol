// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { UndecodableExecution, NativeValueNotAllowed } from "../utils/Errors.sol";

/// @title PaymentDecoder
/// @notice Decodes a single ERC-7579 execution into the payment it performs. Every YINGLONG enforcer that
/// reasons about money (payee, category, budget, velocity, jurisdiction, suitability) reads the payment
/// from the execution calldata through this library, never from caveat args (args come from the redeemer
/// and are untrusted).
///
/// Supported shapes (anything else is undecodable and the money enforcers revert):
///  1. ERC-20 `transfer(address to, uint256 amount)`                 -> recipient = beneficiary = to
///  2. ERC-1363 `transferAndCall(address to, uint256 amount, bytes data)`
///     -> recipient = to (a YINGLONG rail contract: escrow, quote settlement, fund) and
///        beneficiary = first ABI word of `data` when present (the escrow payee, the FX desk), else `to`
///  3. `instruct(address payee, uint256 amount, bytes32 purposeHash, bytes32 conditionHash, uint64 validUntil)`
///     on a coin-free ConditionalPaymentInstructions contract -> asset = target, recipient = beneficiary = payee
library PaymentDecoder {
    using ExecutionLib for bytes;

    bytes4 internal constant TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    bytes4 internal constant TRANSFER_AND_CALL = 0x4000aea0; // transferAndCall(address,uint256,bytes)
    bytes4 internal constant INSTRUCT = bytes4(keccak256("instruct(address,uint256,bytes32,bytes32,uint64)"));

    struct Payment {
        address asset; // token or instruction contract (the execution target)
        address recipient; // address that receives the asset
        address beneficiary; // party economically paid (payee checked by the payee and category rules)
        uint256 amount; // base units
        bytes4 selector;
    }

    /// @notice Decode the single execution in `_executionCallData`. Reverts on native value or unknown shape.
    function decode(bytes calldata _executionCallData) internal pure returns (Payment memory p_) {
        (address target_, uint256 value_, bytes calldata callData_) = _executionCallData.decodeSingle();
        if (value_ != 0) revert NativeValueNotAllowed(value_);
        if (callData_.length < 4) revert UndecodableExecution(bytes4(0));
        bytes4 selector_ = bytes4(callData_[:4]);
        p_.selector = selector_;
        p_.asset = target_;

        if (selector_ == TRANSFER) {
            if (callData_.length != 68) revert UndecodableExecution(selector_);
            (address to_, uint256 amount_) = abi.decode(callData_[4:], (address, uint256));
            p_.recipient = to_;
            p_.beneficiary = to_;
            p_.amount = amount_;
        } else if (selector_ == TRANSFER_AND_CALL) {
            (address to_, uint256 amount_, bytes memory data_) = abi.decode(callData_[4:], (address, uint256, bytes));
            p_.recipient = to_;
            p_.amount = amount_;
            if (data_.length >= 32) {
                address beneficiary_;
                assembly {
                    beneficiary_ := mload(add(data_, 32))
                }
                // A beneficiary word with dirty upper bits is not a valid address encoding.
                if (uint256(uint160(beneficiary_)) != _firstWord(data_)) revert UndecodableExecution(selector_);
                p_.beneficiary = beneficiary_;
            } else {
                p_.beneficiary = to_;
            }
        } else if (selector_ == INSTRUCT) {
            if (callData_.length != 164) revert UndecodableExecution(selector_);
            (address payee_, uint256 amount_,,,) = abi.decode(callData_[4:], (address, uint256, bytes32, bytes32, uint64));
            p_.recipient = payee_;
            p_.beneficiary = payee_;
            p_.amount = amount_;
        } else {
            revert UndecodableExecution(selector_);
        }
    }

    function _firstWord(bytes memory _data) private pure returns (uint256 w_) {
        assembly {
            w_ := mload(add(_data, 32))
        }
    }
}
