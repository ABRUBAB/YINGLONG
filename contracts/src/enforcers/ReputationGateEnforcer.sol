// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { PaymentDecoder } from "../libraries/PaymentDecoder.sol";
import { IPassportView, IERC8004ReputationView } from "../interfaces/IYinglongViews.sol";
import { ReputationTooLow, InvalidTerms } from "../utils/Errors.sol";

/// @title ReputationGateEnforcer
/// @notice When the beneficiary is an agent (it holds a passport), its ERC-8004 reputation, summarised over
/// the client list sealed in the mandate (at most 10 clients the user trusts, which limits Sybil feedback),
/// must reach the sealed minimum. Beneficiaries without a passport (people and firms in the PayeeBook) are
/// not affected; VerifiedPayeeEnforcer governs them.
/// Terms: abi.encode(address reputationRegistry, address passportRegistry, address[] clients,
///                   int128 minScore, uint8 minScoreDecimals, string tag1).
contract ReputationGateEnforcer is YinglongEnforcer {
    uint256 public constant MAX_CLIENTS = 10;

    struct Terms {
        address reputation;
        address passport;
        address[] clients;
        int128 minScore;
        uint8 minScoreDecimals;
        string tag1;
    }

    function getTermsInfo(bytes calldata _terms) public pure returns (Terms memory t_) {
        if (_terms.length < 256) revert InvalidTerms();
        (t_.reputation, t_.passport, t_.clients, t_.minScore, t_.minScoreDecimals, t_.tag1) =
            abi.decode(_terms, (address, address, address[], int128, uint8, string));
        if (t_.clients.length == 0 || t_.clients.length > MAX_CLIENTS || t_.minScoreDecimals > 18) revert InvalidTerms();
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
        Terms memory t_ = getTermsInfo(_terms);
        PaymentDecoder.Payment memory p_ = PaymentDecoder.decode(_executionCallData);

        (uint256 localId_,,) = IPassportView(t_.passport).walletInfo(p_.beneficiary);
        if (localId_ == 0) return;
        uint256 erc8004Id_ = IPassportView(t_.passport).erc8004IdOfWallet(p_.beneficiary);
        if (erc8004Id_ == 0) revert ReputationTooLow(0, 0, t_.minScore);

        (uint64 count_, int128 value_, uint8 decimals_) =
            IERC8004ReputationView(t_.reputation).getSummary(erc8004Id_, t_.clients, t_.tag1, "");
        int256 scoreWad_ = count_ == 0 ? int256(0) : int256(value_) * int256(10 ** uint256(18 - decimals_));
        int256 minWad_ = int256(t_.minScore) * int256(10 ** uint256(18 - t_.minScoreDecimals));
        if (count_ == 0 || scoreWad_ < minWad_) revert ReputationTooLow(erc8004Id_, scoreWad_, minWad_);
    }
}
