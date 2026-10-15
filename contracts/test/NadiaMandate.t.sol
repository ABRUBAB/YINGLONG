// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { EncoderLib } from "@delegation-framework/libraries/EncoderLib.sol";
import { Delegation, Caveat } from "@delegation-framework/utils/Types.sol";
import { YinglongBase } from "./YinglongBase.t.sol";
import { MandateRegistry } from "../src/registries/MandateRegistry.sol";
import { SignedQuoteSettlement } from "../src/rails/SignedQuoteSettlement.sol";
import { ProtectedPayment } from "../src/rails/ProtectedPayment.sol";
import "../src/utils/Errors.sol";

/// @notice Scenario tests for the student persona (beats 2-6 and 11 of the demo).
contract NadiaMandateTest is YinglongBase {
    bytes32 internal constant M1 = keccak256("mandate:nadia:v1");
    uint8 internal constant HK = 1;
    uint8 internal constant MAINLAND = 3;

    bytes internal sealedEnc;

    function _sealed() internal view returns (Delegation memory) {
        return abi.decode(sealedEnc, (Delegation));
    }

    function setUp() public override {
        super.setUp();
        sealedEnc = abi.encode(_sealNadia(M1, HK, 1));
    }

    // ------------------------------------------------------------------ T1: allowed inside the mandate

    function test_T1_rentToVerifiedPayeeWithinBudget() public {
        _redeem(ying, _sealed(), _transferCall(address(tHKD), harbourHomes, 9_500 * U));
        assertEq(tHKD.balanceOf(harbourHomes), 9_500 * U);
        assertEq(tHKD.balanceOf(address(nadia)), 10_500 * U);
    }

    function test_T1_foodUnderT1Cap() public {
        _redeem(ying, _sealed(), _transferCall(address(tHKD), foodMart, 1_200 * U));
        assertEq(tHKD.balanceOf(foodMart), 1_200 * U);
    }

    function test_publishedCaveatsRoundTrip() public {
        // The registry recomputed the delegation hash from the published caveats; it must equal the hash of
        // the delegation Nadia signed, which is what the DelegationManager enforces.
        assertEq(mandates.delegationOf(M1), EncoderLib._getDelegationHash(_sealed()));
        assertEq(mandates.mandateOfDelegation(EncoderLib._getDelegationHash(_sealed())), M1);
        assertTrue(mandates.isLive(M1));
        (bool ok_,) = mandates.canExecute(address(nadia), ying, address(tHKD), 1);
        assertTrue(ok_);
    }

    // ------------------------------------------------------------------ T4: refused on-chain with typed errors

    function test_T4_payeeNotVerified_mirage() public {
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, mirage));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), mirage, 100 * U));
    }

    function test_T4_categoryBudgetExceeded_food() public {
        _redeem(ying, _sealed(), _transferCall(address(tHKD), foodMart, 1_900 * U));
        vm.expectRevert(abi.encodeWithSelector(CategoryBudgetExceeded.selector, uint32(2), 3_800 * U, 3_000 * U));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), foodMart, 1_900 * U));
    }

    function test_T4_reserveFloorBreached() public {
        // Nadia holds 10,000; a co-signed tuition payment of 9,100 would leave 900 < 1,500: the floor refuses
        // even though the user approved the payment.
        vm.prank(address(nadia));
        tHKD.transfer(address(0xdead), 10_000 * U);
        bytes memory exec_ = _transferCall(address(tHKD), hbuBursar, 9_100 * U);
        Delegation memory d_ = _withCoSign(_sealed(), exec_, 1);
        vm.expectRevert(abi.encodeWithSelector(ReserveFloorBreached.selector, address(tHKD), 900 * U, 1_500 * U));
        _redeem(ying, d_, exec_);
    }

    function test_T4_aboveT2Ceiling() public {
        vm.expectRevert(abi.encodeWithSelector(AboveTierCeiling.selector, 13_000 * U, 12_000 * U));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), hbuBursar, 13_000 * U));
    }

    function test_T4_tokenApprovalIsNotAnAllowedMethod() public {
        bytes memory exec_ = ExecutionLib.encodeSingle(
            address(tHKD), 0, abi.encodeWithSignature("approve(address,uint256)", mirage, type(uint256).max)
        );
        vm.expectRevert(bytes("AllowedMethodsEnforcer:method-not-allowed"));
        _redeem(ying, _sealed(), exec_);
    }

    function test_T4_selfCallToAccountIsForbidden() public {
        // Even if a target allowlist were missing, the delegator itself can never be the target.
        Caveat[] memory c_ = new Caveat[](1);
        c_[0] = Caveat(address(forbiddenE), _forbiddenList(), "");
        Delegation memory d_ = _delegation(address(nadia), ying, c_, 99);
        d_.signature = _passkeySign(MessageHashUtils.toTypedDataHash(dm.getDomainHash(), EncoderLib._getDelegationHash(d_)));
        bytes memory exec_ = ExecutionLib.encodeSingle(address(nadia), 0, abi.encodeWithSignature("addKey(string,uint256,uint256)", "x", 1, 2));
        vm.expectRevert(abi.encodeWithSelector(ForbiddenTarget.selector, address(nadia)));
        _redeem(ying, d_, exec_);
    }

    function test_T4_lineageViolation_unregisteredRedeemer() public {
        // A delegation whose delegate is Mirage still fails: Mirage has no passport bound to Nadia's DID.
        Caveat[] memory c_ = _nadiaCaveats(keccak256("m:mirage"), HK);
        Delegation memory d_ = _delegation(address(nadia), mirage, c_, 7);
        d_.signature = _passkeySign(MessageHashUtils.toTypedDataHash(dm.getDomainHash(), EncoderLib._getDelegationHash(d_)));
        vm.expectRevert(abi.encodeWithSelector(LineageViolation.selector, mirage));
        _redeem(mirage, d_, _transferCall(address(tHKD), harbourHomes, 10 * U));
    }

    function test_T4_mandateNotPublishedIsUnbound() public {
        Caveat[] memory c_ = _nadiaCaveats(keccak256("never published"), HK);
        Delegation memory d_ = _delegation(address(nadia), ying, c_, 8);
        d_.signature = _passkeySign(MessageHashUtils.toTypedDataHash(dm.getDomainHash(), EncoderLib._getDelegationHash(d_)));
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateDelegationMismatch.selector, keccak256("never published"), bytes32(0), EncoderLib._getDelegationHash(d_)
            )
        );
        _redeem(ying, d_, _transferCall(address(tHKD), harbourHomes, 10 * U));
    }

    function test_T4_railNotPermitted_mainlandProfileCannotMoveTokens() public {
        // A mandate _sealed() under the mainland profile may only use coin-free instruction rails, whatever its
        // asset list says.
        vm.prank(address(nadia));
        mandates.revoke(M1);
        Delegation memory d_ = _sealNadia(keccak256("mandate:mainland"), MAINLAND, 2);
        vm.expectRevert(abi.encodeWithSelector(RailNotPermitted.selector, address(tHKD), MAINLAND));
        _redeem(ying, d_, _transferCall(address(tHKD), harbourHomes, 10 * U));
    }

    function test_T4_unsuitableProduct() public {
        bytes memory exec_ =
            ExecutionLib.encodeSingle(address(tHKD), 0, abi.encodeWithSelector(bytes4(0x4000aea0), address(fundHigh), 100 * U, ""));
        vm.expectRevert(abi.encodeWithSelector(UnsuitableProduct.selector, address(fundHigh), uint8(5), uint8(2)));
        _redeem(ying, _sealed(), exec_);
    }

    function test_T1_sweepIntoSuitableFund() public {
        bytes memory exec_ =
            ExecutionLib.encodeSingle(address(tHKD), 0, abi.encodeWithSelector(bytes4(0x4000aea0), address(fundLow), 1_000 * U, ""));
        _redeem(ying, _sealed(), exec_);
        assertEq(fundLow.balanceOf(address(nadia)), 1_000 * U);
    }

    function test_T4_velocityExceeded_splitPayments() public {
        for (uint256 i; i < 8; ++i) {
            _redeem(ying, _sealed(), _transferCall(address(tHKD), foodMart, 10 * U));
        }
        vm.expectRevert(abi.encodeWithSelector(VelocityExceeded.selector, uint256(9), 90 * U));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), foodMart, 10 * U));
    }

    // ------------------------------------------------------------------ T2: the user's passkey co-signs

    function test_T2_requiresCoSignAboveT1Cap() public {
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, 2_500 * U, 2_000 * U));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), foodMart, 2_500 * U));
    }

    function test_T2_coSignedPaymentPasses() public {
        bytes memory exec_ = _transferCall(address(tHKD), hbuBursar, 8_000 * U);
        _redeem(ying, _withCoSign(_sealed(), exec_, 1), exec_);
        assertEq(tHKD.balanceOf(hbuBursar), 8_000 * U);
    }

    function test_T2_coSignNonceCannotBeReplayed() public {
        bytes memory exec_ = _transferCall(address(tHKD), hbuBursar, 3_000 * U);
        Delegation memory d_ = _withCoSign(_sealed(), exec_, 5);
        _redeem(ying, d_, exec_);
        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, uint256(5)));
        _redeem(ying, d_, exec_);
    }

    function test_T2_coSignBoundToExactExecution() public {
        bytes memory signedExec_ = _transferCall(address(tHKD), hbuBursar, 3_000 * U);
        Delegation memory d_ = _withCoSign(_sealed(), signedExec_, 6);
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, 3_100 * U, 2_000 * U));
        _redeem(ying, d_, _transferCall(address(tHKD), hbuBursar, 3_100 * U));
    }

    function test_T2_ecdsaSignatureNeverSatisfiesPasskeyAccount() public {
        // Invariant 9: the account has no ECDSA owner, so a 65-byte signature from any key fails.
        bytes memory exec_ = _transferCall(address(tHKD), hbuBursar, 3_000 * U);
        uint256 expiry_ = block.timestamp + 5 minutes;
        bytes32 digest_ = cosignE.approvalDigest(keccak256(abi.encode("x")), keccak256(exec_), 1, expiry_);
        digest_ = cosignE.approvalDigest(_hashOf(_sealed()), keccak256(exec_), 1, expiry_);
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(yingKey, digest_);
        Delegation memory d_ = _sealed();
        d_.caveats[COSIGN_IDX].args = abi.encode(uint256(1), expiry_, abi.encodePacked(r_, s_, v_));
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, 3_000 * U, 2_000 * U));
        _redeem(ying, d_, exec_);
    }

    function test_T2_newPayeeServiceAboveNewPayeeCap() public {
        // Pearl River is attested but not in the payee book: T1 only up to 50 units.
        _redeem(ying, _sealed(), _transferCall(address(tHKD), pearlRiver, 40 * U));
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, 60 * U, 50 * U));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), pearlRiver, 60 * U));
    }

    // ------------------------------------------------------------------ pause, revoke, re-seal, drill

    function test_pause_passkeySignatureRelayedByAnyone() public {
        uint256 deadline_ = block.timestamp + 1 hours;
        bytes memory sig_ = _passkeySign(killSwitch.tripDigest(address(nadia), 0, deadline_));
        vm.prank(makeAddr("relayer"));
        killSwitch.tripWithSig(address(nadia), 0, deadline_, sig_);
        vm.expectRevert(abi.encodeWithSelector(Paused.selector, address(nadia), ying));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), harbourHomes, 10 * U));

        // Only Nadia can unpause (here with a relayed passkey signature).
        bytes memory unsig_ = _passkeySign(killSwitch.untripDigest(address(nadia), 1, deadline_));
        killSwitch.untripWithSig(address(nadia), 1, deadline_, unsig_);
        _redeem(ying, _sealed(), _transferCall(address(tHKD), harbourHomes, 10 * U));
    }

    function test_pause_guardianCanPauseButNotUnpause() public {
        vm.prank(guardian);
        killSwitch.trip(address(nadia));
        assertTrue(killSwitch.isPaused(address(nadia), ying));
        vm.prank(guardian);
        killSwitch.untrip(); // untrips the guardian's own (unpaused) account only
        assertTrue(killSwitch.isPaused(address(nadia), ying));
    }

    function test_supervisorHaltsAgentIdentity() public {
        vm.prank(supervisor);
        passports.supervisorSetStatus(yingAgentId, true);
        vm.expectRevert(abi.encodeWithSelector(Paused.selector, address(nadia), ying));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), harbourHomes, 10 * U));
    }

    function test_revokedMandateMovesNothing() public {
        vm.prank(address(nadia));
        mandates.revoke(M1);
        vm.expectRevert(abi.encodeWithSelector(MandateNotLive.selector, M1));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), harbourHomes, 10 * U));
    }

    function test_resealNeverResetsBudgets() public {
        _redeem(ying, _sealed(), _transferCall(address(tHKD), foodMart, 1_900 * U));
        // Supersede with a new mandate (same rules) in the same lineage.
        bytes32 m2_ = keccak256("mandate:nadia:v2");
        Caveat[] memory c_ = _nadiaCaveats(m2_, HK);
        Delegation memory d2_ = _delegation(address(nadia), ying, c_, 2);
        MandateRegistry.PublishParams memory p_ = MandateRegistry.PublishParams({
            mandateHash: m2_,
            agent: ying,
            lineageId: keccak256("nadia-daily"),
            jurisdiction: HK,
            validFrom: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 365 days),
            salt: 2,
            caveats: c_
        });
        vm.startPrank(address(nadia));
        mandates.supersede(M1, p_);
        dm.disableDelegation(_sealed());
        vm.stopPrank();
        d2_.signature = _passkeySign(MessageHashUtils.toTypedDataHash(dm.getDomainHash(), EncoderLib._getDelegationHash(d2_)));

        // The old delegation is dead...
        vm.expectRevert();
        _redeem(ying, _sealed(), _transferCall(address(tHKD), foodMart, 10 * U));
        // ...and the new one sees the 1,900 already spent this period.
        vm.expectRevert(abi.encodeWithSelector(CategoryBudgetExceeded.selector, uint32(2), 3_800 * U, 3_000 * U));
        _redeem(ying, d2_, _transferCall(address(tHKD), foodMart, 1_900 * U));
    }

    function test_drill_leakedAgentKeyIsBoundedByCaveats() public {
        // The attacker holds Ying's key. Out-of-mandate moves revert; in-mandate loss is capped by the
        // remaining budget; one tap pauses; rotation binds a new wallet.
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, mirage));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), mirage, 5_000 * U));

        uint256 deadline_ = block.timestamp + 1 hours;
        killSwitch.tripWithSig(address(nadia), 0, deadline_, _passkeySign(killSwitch.tripDigest(address(nadia), 0, deadline_)));
        vm.expectRevert(abi.encodeWithSelector(Paused.selector, address(nadia), ying));
        _redeem(ying, _sealed(), _transferCall(address(tHKD), foodMart, 10 * U));

        (address newYing_, uint256 newKey_) = makeAddrAndKey("ying-rotated");
        uint256 dl_ = block.timestamp + 1 hours;
        bytes32 digest_ = passports.bindWalletDigest(yingAgentId, agentOwner, newYing_, dl_);
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(newKey_, digest_);
        vm.prank(agentOwner);
        passports.setAgentWallet(yingAgentId, newYing_, dl_, abi.encodePacked(r_, s_, v_));
        assertEq(passports.agentIdOf(newYing_), yingAgentId);
        assertEq(passports.agentIdOf(ying), 0);
    }

    // ------------------------------------------------------------------ rails: escrow and signed quotes

    function test_escrow_tuitionDepositReleasedOnEnrolment() public {
        bytes memory data_ = abi.encode(hbuBursar, keccak256("enrolment:HBU:2026"), issuerHbu, uint64(block.timestamp + 30 days));
        bytes memory exec_ =
            ExecutionLib.encodeSingle(address(tHKD), 0, abi.encodeWithSelector(bytes4(0x4000aea0), address(escrow), 5_000 * U, data_));
        _redeem(ying, _withCoSign(_sealed(), exec_, 9), exec_);
        ProtectedPayment.Escrow memory e_ = escrow.escrowOf(0);
        assertEq(e_.amount, 5_000 * U);
        assertEq(e_.payer, address(nadia));
        vm.prank(issuerHbu);
        escrow.release(0, keccak256("enrolment confirmed"));
        assertEq(tHKD.balanceOf(hbuBursar), 5_000 * U);
    }

    function test_escrow_cannotRouteToUnverifiedPayeeThroughEscrow() public {
        bytes memory data_ = abi.encode(mirage, keccak256("x"), mirage, uint64(block.timestamp + 1));
        bytes memory exec_ =
            ExecutionLib.encodeSingle(address(tHKD), 0, abi.encodeWithSelector(bytes4(0x4000aea0), address(escrow), 10 * U, data_));
        vm.expectRevert(abi.encodeWithSelector(PayeeNotVerified.selector, mirage));
        _redeem(ying, _sealed(), exec_);
    }

    function test_quote_convertAtSignedPriceThenExpiredReplayReverts() public {
        // Pearl River funds tHKD liquidity.
        tHKD.mint(pearlRiver, 50_000 * U);
        vm.startPrank(pearlRiver);
        tHKD.approve(address(quotes), type(uint256).max);
        quotes.depositLiquidity(address(tHKD), 50_000 * U);
        vm.stopPrank();

        SignedQuoteSettlement.Quote memory q_ = SignedQuoteSettlement.Quote({
            desk: pearlRiver,
            payer: address(nadia),
            inToken: address(tUSD),
            outToken: address(tHKD),
            amountIn: 1_000 * U,
            amountOut: 7_810 * U,
            expiry: block.timestamp + 2 minutes,
            nonce: 1
        });
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(pearlRiverKey, quotes.quoteHash(q_));
        bytes memory data_ = abi.encode(pearlRiver, q_, abi.encodePacked(r_, s_, v_));
        bytes memory exec_ =
            ExecutionLib.encodeSingle(address(tUSD), 0, abi.encodeWithSelector(bytes4(0x4000aea0), address(quotes), 1_000 * U, data_));
        _redeem(ying, _sealed(), exec_);
        assertEq(tHKD.balanceOf(address(nadia)), 27_810 * U);

        // An unused second quote, replayed after its signed expiry: QuoteExpired.
        q_.nonce = 2;
        (v_, r_, s_) = vm.sign(pearlRiverKey, quotes.quoteHash(q_));
        data_ = abi.encode(pearlRiver, q_, abi.encodePacked(r_, s_, v_));
        exec_ = ExecutionLib.encodeSingle(address(tUSD), 0, abi.encodeWithSelector(bytes4(0x4000aea0), address(quotes), 1_000 * U, data_));
        vm.warp(block.timestamp + 3 minutes);
        vm.expectRevert(abi.encodeWithSelector(QuoteExpired.selector, uint64(q_.expiry), block.timestamp));
        _redeem(ying, _sealed(), exec_);
    }

    // ------------------------------------------------------------------ helpers

    function _hashOf(Delegation memory _d) internal pure returns (bytes32) {
        return EncoderLib._getDelegationHash(_d);
    }

    /// @notice Attach Nadia's passkey co-sign approval for exactly `_exec` to the CoSign caveat (index COSIGN_IDX).
    function _withCoSign(Delegation memory _d, bytes memory _exec, uint256 _nonce) internal view returns (Delegation memory d_) {
        d_ = _d;
        uint256 expiry_ = block.timestamp + 5 minutes;
        bytes32 digest_ = cosignE.approvalDigest(_hashOf(_d), keccak256(_exec), _nonce, expiry_);
        Caveat[] memory c_ = new Caveat[](_d.caveats.length);
        for (uint256 i; i < c_.length; ++i) {
            c_[i] = _d.caveats[i];
        }
        c_[COSIGN_IDX].args = abi.encode(_nonce, expiry_, _passkeySign(digest_));
        d_.caveats = c_;
    }
}
