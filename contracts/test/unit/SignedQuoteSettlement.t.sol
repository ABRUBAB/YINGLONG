// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { stdError } from "forge-std/StdError.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { SignedQuoteSettlement } from "../../src/rails/SignedQuoteSettlement.sol";
import { QuoteExpired, InvalidSignature, NonceAlreadyUsed } from "../../src/utils/Errors.sol";

/// @notice SignedQuoteSettlement: desk liquidity accounting, the EIP-712 quote digest, and every refusal of a
/// settlement (expiry, field mismatch, replayed nonce, wrong signer, insufficient liquidity).
contract SignedQuoteSettlementTest is CoverageBase {
    event LiquidityDeposited(address indexed desk, address indexed token, uint256 amount);
    event LiquidityWithdrawn(address indexed desk, address indexed token, uint256 amount);
    event QuoteSettled(bytes32 indexed quoteHash, address indexed desk, address indexed payer, uint256 amountIn, uint256 amountOut);

    address internal payer = makeAddr("quote-payer");

    function setUp() public override {
        super.setUp();
        vm.warp(1_760_000_000);
        tHKD.mint(pearlRiver, 50_000 * U);
        tUSD.mint(payer, 5_000 * U);
        vm.startPrank(pearlRiver);
        tHKD.approve(address(quotes), type(uint256).max);
        quotes.depositLiquidity(address(tHKD), 20_000 * U);
        vm.stopPrank();
    }

    function _quote(uint256 _nonce) internal view returns (SignedQuoteSettlement.Quote memory) {
        return SignedQuoteSettlement.Quote({
            desk: pearlRiver,
            payer: payer,
            inToken: address(tUSD),
            outToken: address(tHKD),
            amountIn: 1_000 * U,
            amountOut: 7_810 * U,
            expiry: block.timestamp + 2 minutes,
            nonce: _nonce
        });
    }

    function _data(SignedQuoteSettlement.Quote memory _q, uint256 _key) internal view returns (bytes memory) {
        return abi.encode(_q.desk, _q, _ecdsa(_key, quotes.quoteHash(_q)));
    }

    function _settle(address _from, address _token, uint256 _amount, bytes memory _d) internal {
        vm.prank(_from);
        IERC1363Payer(_token).transferAndCall(address(quotes), _amount, _d);
    }

    // ------------------------------------------------------------------ liquidity

    function test_depositAndWithdrawLiquidity() public {
        assertEq(quotes.liquidity(pearlRiver, address(tHKD)), 20_000 * U);
        vm.expectEmit(true, true, true, true, address(quotes));
        emit LiquidityDeposited(pearlRiver, address(tHKD), 1_000 * U);
        vm.prank(pearlRiver);
        quotes.depositLiquidity(address(tHKD), 1_000 * U);
        vm.expectEmit(true, true, true, true, address(quotes));
        emit LiquidityWithdrawn(pearlRiver, address(tHKD), 21_000 * U);
        vm.prank(pearlRiver);
        quotes.withdrawLiquidity(address(tHKD), 21_000 * U);
        assertEq(quotes.liquidity(pearlRiver, address(tHKD)), 0);
        assertEq(tHKD.balanceOf(pearlRiver), 50_000 * U);
    }

    function test_withdrawMoreThanOwnLiquidity_reverts() public {
        vm.expectRevert(stdError.arithmeticError);
        vm.prank(pearlRiver);
        quotes.withdrawLiquidity(address(tHKD), 20_000 * U + 1);
        // Another address cannot draw on the desk's liquidity.
        vm.expectRevert(stdError.arithmeticError);
        vm.prank(mirage);
        quotes.withdrawLiquidity(address(tHKD), 1);
    }

    // ------------------------------------------------------------------ digest

    function test_quoteHash_isTheRecomputedEip712Digest() public {
        SignedQuoteSettlement.Quote memory q_ = _quote(1);
        assertEq(
            quotes.QUOTE_TYPEHASH(),
            keccak256(
                "Quote(address desk,address payer,address inToken,address outToken,uint256 amountIn,uint256 amountOut,uint256 expiry,uint256 nonce)"
            )
        );
        bytes32 domain_ = _domain("YINGLONG Quote Settlement", address(quotes), SALT);
        assertEq(quotes.domainSeparator(), domain_);
        bytes32 struct_ = keccak256(
            abi.encode(quotes.QUOTE_TYPEHASH(), q_.desk, q_.payer, q_.inToken, q_.outToken, q_.amountIn, q_.amountOut, q_.expiry, q_.nonce)
        );
        assertEq(quotes.quoteHash(q_), _typed(domain_, struct_));
    }

    // ------------------------------------------------------------------ settlement

    function test_settle_convertsAtSignedPrice_thenNonceIsSpent() public {
        SignedQuoteSettlement.Quote memory q_ = _quote(1);
        bytes memory d_ = _data(q_, pearlRiverKey);
        bytes32 h_ = quotes.quoteHash(q_);
        vm.expectEmit(true, true, true, true, address(quotes));
        emit QuoteSettled(h_, pearlRiver, payer, 1_000 * U, 7_810 * U);
        _settle(payer, address(tUSD), 1_000 * U, d_);
        assertEq(tUSD.balanceOf(payer), 4_000 * U);
        assertEq(tUSD.balanceOf(pearlRiver), 1_000 * U);
        assertEq(tHKD.balanceOf(payer), 7_810 * U);
        assertEq(quotes.liquidity(pearlRiver, address(tHKD)), 12_190 * U);
        assertTrue(quotes.nonceUsed(pearlRiver, 1));

        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, uint256(1)));
        _settle(payer, address(tUSD), 1_000 * U, d_);
    }

    function test_expiryBoundary() public {
        SignedQuoteSettlement.Quote memory q_ = _quote(1);
        bytes memory d_ = _data(q_, pearlRiverKey);
        vm.warp(q_.expiry + 1);
        vm.expectRevert(abi.encodeWithSelector(QuoteExpired.selector, uint64(q_.expiry), q_.expiry + 1));
        _settle(payer, address(tUSD), 1_000 * U, d_);
        vm.warp(q_.expiry);
        _settle(payer, address(tUSD), 1_000 * U, d_);
    }

    function test_mismatchedFields_revert() public {
        SignedQuoteSettlement.Quote memory q_ = _quote(1);
        bytes memory sig_ = _ecdsa(pearlRiverKey, quotes.quoteHash(q_));
        // Desk word differs from the quote's desk.
        vm.expectRevert(SignedQuoteSettlement.QuoteMismatch.selector);
        _settle(payer, address(tUSD), 1_000 * U, abi.encode(mirage, q_, sig_));
        // Someone other than the quoted payer settles it.
        tUSD.mint(mirage, 1_000 * U);
        vm.expectRevert(SignedQuoteSettlement.QuoteMismatch.selector);
        _settle(mirage, address(tUSD), 1_000 * U, abi.encode(pearlRiver, q_, sig_));
        // Paid in the wrong token.
        tHKD.mint(payer, 1_000 * U);
        vm.expectRevert(SignedQuoteSettlement.QuoteMismatch.selector);
        _settle(payer, address(tHKD), 1_000 * U, abi.encode(pearlRiver, q_, sig_));
        // Paid a different amount.
        vm.expectRevert(SignedQuoteSettlement.QuoteMismatch.selector);
        _settle(payer, address(tUSD), 999 * U, abi.encode(pearlRiver, q_, sig_));
    }

    function test_signatureByAnotherKey_reverts() public {
        bytes memory d_ = _data(_quote(1), mirageKey);
        vm.expectRevert(InvalidSignature.selector);
        _settle(payer, address(tUSD), 1_000 * U, d_);
    }

    function test_alteredQuoteBreaksTheSignature() public {
        SignedQuoteSettlement.Quote memory q_ = _quote(1);
        bytes memory sig_ = _ecdsa(pearlRiverKey, quotes.quoteHash(q_));
        q_.amountOut = 9_000 * U;
        vm.expectRevert(InvalidSignature.selector);
        _settle(payer, address(tUSD), 1_000 * U, abi.encode(pearlRiver, q_, sig_));
    }

    function test_insufficientLiquidity_reverts() public {
        SignedQuoteSettlement.Quote memory q_ = _quote(1);
        q_.amountOut = 20_000 * U + 1;
        bytes memory d_ = _data(q_, pearlRiverKey);
        vm.expectRevert(abi.encodeWithSelector(SignedQuoteSettlement.InsufficientLiquidity.selector, 20_000 * U, 20_000 * U + 1));
        _settle(payer, address(tUSD), 1_000 * U, d_);
    }

    function test_directNotificationByNonToken_isRefused() public {
        // A valid signed quote replayed straight into the hook: msg.sender is not the quoted input token.
        SignedQuoteSettlement.Quote memory q_ = _quote(1);
        bytes memory d_ = _data(q_, pearlRiverKey);
        vm.expectRevert(SignedQuoteSettlement.QuoteMismatch.selector);
        vm.prank(mirage);
        quotes.onTransferReceived(mirage, payer, 1_000 * U, d_);
    }
}

interface IERC1363Payer {
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);
}
