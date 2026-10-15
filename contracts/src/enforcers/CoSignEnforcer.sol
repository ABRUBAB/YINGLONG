// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongEnforcer } from "./YinglongEnforcer.sol";
import { YinglongEIP712 } from "../utils/YinglongEIP712.sol";
import { PaymentDecoder } from "../libraries/PaymentDecoder.sol";
import { IPayeeBookView } from "../interfaces/IYinglongViews.sol";
import {
    CoSignRequired, AboveTierCeiling, InvalidTerms, InvalidArgs, NonceAlreadyUsed, SignatureExpired
} from "../utils/Errors.sol";

/// @title CoSignEnforcer
/// @notice Tier T2 on-chain: a payment above its T1 cap needs the user's own approval, checked as
/// the delegator account's ERC-1271 signature (the user's passkey) over an Approval bound to this delegation,
/// this exact execution, a nonce and a short expiry. Anything above the T2 ceiling is T3 and always reverts.
/// The agent may also attach an approval below the threshold (when an AI signal escalated the action to
/// T2); if attached it must be valid.
/// T1 caps: a per-category cap for known payees (e.g. the sealed monthly rent to the landlord), else
/// `defaultT1Cap` for known payees, else `newPayeeT1Cap` for beneficiaries outside the PayeeBook (first
/// payments to verified new counterparties, x402 services).
/// Terms: abi.encode(address payeeBook, address asset, uint256 defaultT1Cap, uint256 newPayeeT1Cap,
///                   uint256 t2Ceiling, uint256 maxApprovalWindow, uint32[] categoryIds, uint256[] categoryT1Caps).
/// Args:  abi.encode(uint256 nonce, uint256 expiry, bytes signature) or empty.
contract CoSignEnforcer is YinglongEnforcer, YinglongEIP712 {
    bytes32 public constant APPROVAL_TYPEHASH =
        keccak256("Approval(bytes32 delegationHash,bytes32 executionHash,uint256 nonce,uint256 expiry)");

    struct Terms {
        address payeeBook;
        address asset;
        uint256 defaultT1Cap;
        uint256 newPayeeT1Cap;
        uint256 t2Ceiling;
        uint256 maxApprovalWindow;
        uint32[] categoryIds;
        uint256[] categoryT1Caps;
    }

    mapping(address dm => mapping(bytes32 delegationHash => mapping(uint256 nonce => bool))) public nonceUsed;

    event CoSigned(address indexed delegationManager, bytes32 indexed delegationHash, uint256 nonce, uint256 amount);

    constructor(bytes32 _domainSalt) YinglongEIP712(_domainSalt) { }

    function _domainName() internal pure override returns (string memory) {
        return "YINGLONG CoSign";
    }

    function getTermsInfo(bytes calldata _terms) public pure returns (Terms memory t_) {
        if (_terms.length < 320) revert InvalidTerms();
        (
            t_.payeeBook,
            t_.asset,
            t_.defaultT1Cap,
            t_.newPayeeT1Cap,
            t_.t2Ceiling,
            t_.maxApprovalWindow,
            t_.categoryIds,
            t_.categoryT1Caps
        ) = abi.decode(_terms, (address, address, uint256, uint256, uint256, uint256, uint32[], uint256[]));
        if (t_.categoryIds.length != t_.categoryT1Caps.length) revert InvalidTerms();
    }

    /// @notice EIP-712 digest the user's passkey signs for one approval.
    function approvalDigest(bytes32 _delegationHash, bytes32 _executionHash, uint256 _nonce, uint256 _expiry)
        public
        view
        returns (bytes32)
    {
        return _hashTypedData(keccak256(abi.encode(APPROVAL_TYPEHASH, _delegationHash, _executionHash, _nonce, _expiry)));
    }

    /// @notice T1 cap that applies to a payment from `_delegator` to `_beneficiary`.
    function thresholdFor(Terms memory _t, address _delegator, address _beneficiary) public view returns (uint256) {
        (bool known_, uint32 category_) = IPayeeBookView(_t.payeeBook).lookup(_delegator, _beneficiary);
        if (!known_) return _t.newPayeeT1Cap;
        for (uint256 i; i < _t.categoryIds.length; ++i) {
            if (_t.categoryIds[i] == category_) return _t.categoryT1Caps[i];
        }
        return _t.defaultT1Cap;
    }

    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
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

        if (p_.amount > t_.t2Ceiling) revert AboveTierCeiling(p_.amount, t_.t2Ceiling);
        uint256 threshold_ = thresholdFor(t_, _delegator, p_.beneficiary);

        if (_args.length == 0) {
            if (p_.amount > threshold_) revert CoSignRequired(p_.amount, threshold_);
            return;
        }

        (uint256 nonce_, uint256 expiry_, bytes memory sig_) = abi.decode(_args, (uint256, uint256, bytes));
        if (block.timestamp > expiry_) revert SignatureExpired(expiry_);
        if (expiry_ > block.timestamp + t_.maxApprovalWindow) revert InvalidArgs();
        if (nonceUsed[msg.sender][_delegationHash][nonce_]) revert NonceAlreadyUsed(nonce_);
        bytes32 digest_ = approvalDigest(_delegationHash, keccak256(_executionCallData), nonce_, expiry_);
        if (!SignatureChecker.isValidSignatureNow(_delegator, digest_, sig_)) revert CoSignRequired(p_.amount, threshold_);
        nonceUsed[msg.sender][_delegationHash][nonce_] = true;
        emit CoSigned(msg.sender, _delegationHash, nonce_, p_.amount);
    }
}
