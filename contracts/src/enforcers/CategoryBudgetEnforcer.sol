// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { PaymentDecoder } from "../libraries/PaymentDecoder.sol";
import { IPayeeBookView } from "../interfaces/IYinglongViews.sol";
import { CategoryBudgetExceeded, InvalidTerms } from "../utils/Errors.sol";

/// @title CategoryBudgetEnforcer
/// @notice Budgets that bite: per-period caps per spending category for one asset. The category is the
/// PayeeBook category of the beneficiary (never an agent argument); beneficiaries outside the book (attested
/// service agents) fall into `unlistedCategory`. Counters are keyed by (DelegationManager, delegator, asset,
/// category, period), NOT by delegation, so they aggregate across every delegation of the account and a
/// re-sealed mandate can never reset or widen what was already spent in the period.
/// Payments in other assets are not governed by this caveat (the compiler emits one per allowed asset and
/// JurisdictionEnforcer limits the assets).
/// Terms: abi.encode(address payeeBook, address asset, uint64 periodStart, uint64 periodLength,
///                   uint32 unlistedCategory, uint32[] categoryIds, uint256[] caps).
contract CategoryBudgetEnforcer is YinglongEnforcer {
    struct Terms {
        address payeeBook;
        address asset;
        uint64 periodStart;
        uint64 periodLength;
        uint32 unlistedCategory;
        uint32[] categoryIds;
        uint256[] caps;
    }

    mapping(bytes32 key => uint256 amount) public spent;

    event BudgetSpent(
        address indexed delegationManager,
        address indexed delegator,
        uint32 indexed categoryId,
        address asset,
        uint256 period,
        uint256 spent,
        uint256 cap
    );

    function getTermsInfo(bytes calldata _terms) public pure returns (Terms memory t_) {
        if (_terms.length < 288) revert InvalidTerms();
        (t_.payeeBook, t_.asset, t_.periodStart, t_.periodLength, t_.unlistedCategory, t_.categoryIds, t_.caps) =
            abi.decode(_terms, (address, address, uint64, uint64, uint32, uint32[], uint256[]));
        if (t_.categoryIds.length != t_.caps.length || t_.periodLength == 0) revert InvalidTerms();
    }

    function periodOf(uint64 _start, uint64 _length) public view returns (uint256) {
        if (block.timestamp < _start) return 0;
        return (block.timestamp - _start) / _length;
    }

    function spentKey(address _dm, address _delegator, address _asset, uint32 _categoryId, uint256 _period)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(_dm, _delegator, _asset, _categoryId, _period));
    }

    /// @notice Amount already spent in the current period (for the app's orbit gauges and the policy mirror).
    function spentNow(address _dm, address _delegator, address _asset, uint32 _categoryId, uint64 _start, uint64 _length)
        external
        view
        returns (uint256)
    {
        return spent[spentKey(_dm, _delegator, _asset, _categoryId, periodOf(_start, _length))];
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
        Terms memory t_ = getTermsInfo(_terms);
        PaymentDecoder.Payment memory p_ = PaymentDecoder.decode(_executionCallData);
        if (p_.asset != t_.asset) return;

        (bool active_, uint32 category_) = IPayeeBookView(t_.payeeBook).lookup(_delegator, p_.beneficiary);
        if (!active_) category_ = t_.unlistedCategory;

        uint256 cap_;
        bool found_;
        for (uint256 i; i < t_.categoryIds.length; ++i) {
            if (t_.categoryIds[i] == category_) {
                cap_ = t_.caps[i];
                found_ = true;
                break;
            }
        }
        if (!found_) revert CategoryBudgetExceeded(category_, p_.amount, 0);

        uint256 period_ = periodOf(t_.periodStart, t_.periodLength);
        bytes32 key_ = spentKey(msg.sender, _delegator, t_.asset, category_, period_);
        uint256 newSpent_ = spent[key_] + p_.amount;
        if (newSpent_ > cap_) revert CategoryBudgetExceeded(category_, newSpent_, cap_);
        spent[key_] = newSpent_;
        emit BudgetSpent(msg.sender, _delegator, category_, t_.asset, period_, newSpent_, cap_);
    }
}
