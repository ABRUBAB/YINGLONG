// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { YinglongEIP712 } from "../utils/YinglongEIP712.sol";
import { QuoteExpired, InvalidSignature, NonceAlreadyUsed, Unauthorized } from "../utils/Errors.sol";

/// @title SignedQuoteSettlement
/// @notice Converts at a price an FX desk signed. The desk pre-funds liquidity of the output asset; the payer
/// settles a quote in one ERC-1363 `transferAndCall` of the input asset, and receives the output asset in
/// the same transaction. A quote is bound to its payer, single-use (desk nonce) and expires: replaying it
/// after expiry reverts with `QuoteExpired`.
/// Data layout for `transferAndCall`: abi.encode(address desk, Quote quote, bytes deskSignature). The first
/// word is the desk, which is what YINGLONG's payee rules check.
contract SignedQuoteSettlement is ReentrancyGuard, YinglongEIP712 {
    using SafeERC20 for IERC20;

    bytes4 internal constant ERC1363_RECEIVED = 0x88a7ca5c;
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address desk,address payer,address inToken,address outToken,uint256 amountIn,uint256 amountOut,uint256 expiry,uint256 nonce)"
    );

    struct Quote {
        address desk;
        address payer;
        address inToken;
        address outToken;
        uint256 amountIn;
        uint256 amountOut;
        uint256 expiry;
        uint256 nonce;
    }

    mapping(address desk => mapping(address token => uint256)) public liquidity;
    mapping(address desk => mapping(uint256 nonce => bool)) public nonceUsed;

    event LiquidityDeposited(address indexed desk, address indexed token, uint256 amount);
    event LiquidityWithdrawn(address indexed desk, address indexed token, uint256 amount);
    event QuoteSettled(bytes32 indexed quoteHash, address indexed desk, address indexed payer, uint256 amountIn, uint256 amountOut);

    error QuoteMismatch();
    error InsufficientLiquidity(uint256 available, uint256 needed);

    constructor(bytes32 _domainSalt) YinglongEIP712(_domainSalt) { }

    function _domainName() internal pure override returns (string memory) {
        return "YINGLONG Quote Settlement";
    }

    /// @notice Desks (service EOAs) fund liquidity with a standard approval + pull.
    function depositLiquidity(address _token, uint256 _amount) external nonReentrant {
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        liquidity[msg.sender][_token] += _amount;
        emit LiquidityDeposited(msg.sender, _token, _amount);
    }

    function withdrawLiquidity(address _token, uint256 _amount) external nonReentrant {
        liquidity[msg.sender][_token] -= _amount;
        IERC20(_token).safeTransfer(msg.sender, _amount);
        emit LiquidityWithdrawn(msg.sender, _token, _amount);
    }

    function quoteHash(Quote memory _q) public view returns (bytes32) {
        return _hashTypedData(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH, _q.desk, _q.payer, _q.inToken, _q.outToken, _q.amountIn, _q.amountOut, _q.expiry, _q.nonce
                )
            )
        );
    }

    function onTransferReceived(address, address _from, uint256 _value, bytes calldata _data)
        external
        nonReentrant
        returns (bytes4)
    {
        (address desk_, Quote memory q_, bytes memory sig_) = abi.decode(_data, (address, Quote, bytes));
        if (block.timestamp > q_.expiry) revert QuoteExpired(uint64(q_.expiry), block.timestamp);
        if (desk_ != q_.desk || q_.payer != _from || q_.inToken != msg.sender || q_.amountIn != _value) revert QuoteMismatch();
        if (nonceUsed[q_.desk][q_.nonce]) revert NonceAlreadyUsed(q_.nonce);
        bytes32 h_ = quoteHash(q_);
        if (!SignatureChecker.isValidSignatureNow(q_.desk, h_, sig_)) revert InvalidSignature();
        uint256 available_ = liquidity[q_.desk][q_.outToken];
        if (available_ < q_.amountOut) revert InsufficientLiquidity(available_, q_.amountOut);

        nonceUsed[q_.desk][q_.nonce] = true;
        liquidity[q_.desk][q_.outToken] = available_ - q_.amountOut;
        IERC20(q_.inToken).safeTransfer(q_.desk, q_.amountIn);
        IERC20(q_.outToken).safeTransfer(_from, q_.amountOut);
        emit QuoteSettled(h_, q_.desk, _from, q_.amountIn, q_.amountOut);
        return ERC1363_RECEIVED;
    }
}
