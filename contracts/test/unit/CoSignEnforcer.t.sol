// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Delegation, Caveat } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { CoSignEnforcer } from "../../src/enforcers/CoSignEnforcer.sol";
import { Categories } from "../../src/utils/Categories.sol";
import {
    CoSignRequired,
    AboveTierCeiling,
    InvalidTerms,
    InvalidArgs,
    InvalidExecutionMode,
    NonceAlreadyUsed,
    SignatureExpired
} from "../../src/utils/Errors.sol";

/// @notice CoSignEnforcer: T1 thresholds per payee class, the T2 ceiling, and the approval (EIP-712 digest,
/// expiry window, nonce, exact execution, exact delegation). Direct hook calls use an EOA delegator so the
/// approval is a plain ECDSA signature; the passkey (ERC-1271) path runs through the DelegationManager.
contract CoSignEnforcerTest is CoverageBase {
    event CoSigned(address indexed delegationManager, bytes32 indexed delegationHash, uint256 nonce, uint256 amount);

    uint256 internal constant DEFAULT_CAP = 1_000 * U;
    uint256 internal constant NEW_PAYEE_CAP = 50 * U;
    uint256 internal constant CEILING = 5_000 * U;
    uint256 internal constant WINDOW = 10 minutes;
    uint256 internal constant RENT_CAP = 4_000 * U;
    bytes32 internal constant DH2 = keccak256("coverage:other-delegation");

    address internal alice;
    uint256 internal aliceKey;
    address internal landlord = makeAddr("landlord");
    address internal grocer = makeAddr("grocer");
    address internal stranger = makeAddr("stranger");

    function setUp() public override {
        super.setUp();
        vm.warp(1_760_000_000);
        (alice, aliceKey) = makeAddrAndKey("alice-cosign");
        vm.startPrank(alice);
        payeeBook.setPayee(landlord, Categories.RENT, keccak256("Landlord"));
        payeeBook.setPayee(grocer, Categories.FOOD, keccak256("Grocer"));
        vm.stopPrank();
    }

    function _terms() internal view returns (bytes memory) {
        return abi.encode(
            address(payeeBook), address(tHKD), DEFAULT_CAP, NEW_PAYEE_CAP, CEILING, WINDOW, _c1(Categories.RENT), _u1(RENT_CAP)
        );
    }

    function _exec(address _to, uint256 _amount) internal view returns (bytes memory) {
        return _transferCall(address(tHKD), _to, _amount);
    }

    function _approval(bytes32 _dh, bytes memory _execution, uint256 _nonce, uint256 _expiry, uint256 _key)
        internal
        view
        returns (bytes memory)
    {
        return abi.encode(_nonce, _expiry, _ecdsa(_key, cosignE.approvalDigest(_dh, keccak256(_execution), _nonce, _expiry)));
    }

    function _hook(bytes memory _args, bytes memory _execution, bytes32 _dh) internal {
        cosignE.beforeHook(_terms(), _args, singleMode, _execution, _dh, alice, ying);
    }

    // ------------------------------------------------------------------ terms, digest, thresholds

    function test_getTermsInfo_decodesAndValidates() public {
        CoSignEnforcer.Terms memory t_ = cosignE.getTermsInfo(_terms());
        assertEq(t_.payeeBook, address(payeeBook));
        assertEq(t_.asset, address(tHKD));
        assertEq(t_.defaultT1Cap, DEFAULT_CAP);
        assertEq(t_.newPayeeT1Cap, NEW_PAYEE_CAP);
        assertEq(t_.t2Ceiling, CEILING);
        assertEq(t_.maxApprovalWindow, WINDOW);
        assertEq(t_.categoryIds[0], Categories.RENT);
        assertEq(t_.categoryT1Caps[0], RENT_CAP);

        bytes memory min_ = abi.encode(address(payeeBook), address(tHKD), 1, 1, 1, 1, new uint32[](0), new uint256[](0));
        assertEq(min_.length, 320);
        cosignE.getTermsInfo(min_);
        assembly {
            mstore(min_, 319)
        }
        vm.expectRevert(InvalidTerms.selector);
        cosignE.getTermsInfo(min_);

        bytes memory mismatch_ = abi.encode(address(payeeBook), address(tHKD), 1, 1, 1, 1, _c1(1), new uint256[](0));
        vm.expectRevert(InvalidTerms.selector);
        cosignE.getTermsInfo(mismatch_);
    }

    function test_approvalDigest_isTheRecomputedEip712Digest() public {
        assertEq(cosignE.APPROVAL_TYPEHASH(), keccak256("Approval(bytes32 delegationHash,bytes32 executionHash,uint256 nonce,uint256 expiry)"));
        assertEq(cosignE.domainSalt(), SALT);
        bytes32 domain_ = _domain("YINGLONG CoSign", address(cosignE), SALT);
        assertEq(cosignE.domainSeparator(), domain_);
        bytes32 eh_ = keccak256(_exec(grocer, 1));
        bytes32 struct_ = keccak256(abi.encode(cosignE.APPROVAL_TYPEHASH(), DH, eh_, uint256(3), uint256(99)));
        assertEq(cosignE.approvalDigest(DH, eh_, 3, 99), _typed(domain_, struct_));

        // The separator is recomputed on every call: another chain id yields another domain.
        vm.chainId(20_200);
        assertEq(cosignE.domainSeparator(), _domain("YINGLONG CoSign", address(cosignE), SALT));
        assertTrue(cosignE.domainSeparator() != domain_);
    }

    function test_thresholdFor_eachPayeeClass() public {
        CoSignEnforcer.Terms memory t_ = cosignE.getTermsInfo(_terms());
        assertEq(cosignE.thresholdFor(t_, alice, landlord), RENT_CAP); // category cap
        assertEq(cosignE.thresholdFor(t_, alice, grocer), DEFAULT_CAP); // known payee, no category cap
        assertEq(cosignE.thresholdFor(t_, alice, stranger), NEW_PAYEE_CAP); // not in the book
        assertEq(cosignE.thresholdFor(t_, ying, landlord), NEW_PAYEE_CAP); // someone else's book
        vm.prank(alice);
        payeeBook.removePayee(landlord);
        assertEq(cosignE.thresholdFor(t_, alice, landlord), NEW_PAYEE_CAP); // removed
    }

    function test_nonSingleDefaultMode_reverts() public {
        bytes memory t_ = _terms();
        bytes memory e_ = _exec(grocer, 1);
        vm.expectRevert(InvalidExecutionMode.selector);
        cosignE.beforeHook(t_, "", batchMode, e_, DH, alice, ying);
    }

    // ------------------------------------------------------------------ tiers without approval

    function test_otherAssetIsNotGoverned_argsNotEvenRead() public {
        _hook(hex"deadbeef", _transferCall(address(tUSD), stranger, 1e30), DH);
        assertFalse(cosignE.nonceUsed(address(this), DH, 0));
    }

    function test_noApproval_exactlyAtEachThresholdPasses() public {
        _hook("", _exec(landlord, RENT_CAP), DH);
        _hook("", _exec(grocer, DEFAULT_CAP), DH);
        _hook("", _exec(stranger, NEW_PAYEE_CAP), DH);
    }

    function test_noApproval_oneOverEachThreshold_requiresCoSign() public {
        bytes memory e1_ = _exec(landlord, RENT_CAP + 1);
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, RENT_CAP + 1, RENT_CAP));
        _hook("", e1_, DH);
        bytes memory e2_ = _exec(grocer, DEFAULT_CAP + 1);
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, DEFAULT_CAP + 1, DEFAULT_CAP));
        _hook("", e2_, DH);
        bytes memory e3_ = _exec(stranger, NEW_PAYEE_CAP + 1);
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, NEW_PAYEE_CAP + 1, NEW_PAYEE_CAP));
        _hook("", e3_, DH);
    }

    function test_aboveCeiling_reverts_evenWithValidApproval() public {
        bytes memory e_ = _exec(landlord, CEILING + 1);
        bytes memory args_ = _approval(DH, e_, 1, block.timestamp + 1 minutes, aliceKey);
        vm.expectRevert(abi.encodeWithSelector(AboveTierCeiling.selector, CEILING + 1, CEILING));
        _hook(args_, e_, DH);
    }

    // ------------------------------------------------------------------ approvals

    function test_approvalExactlyAtCeilingPasses_andEmits() public {
        bytes memory e_ = _exec(landlord, CEILING);
        bytes memory args_ = _approval(DH, e_, 1, block.timestamp + 1 minutes, aliceKey);
        vm.expectEmit(true, true, true, true, address(cosignE));
        emit CoSigned(address(dm), DH, 1, CEILING);
        vm.prank(address(dm));
        _hook(args_, e_, DH);
        assertTrue(cosignE.nonceUsed(address(dm), DH, 1));
    }

    function test_expiredApproval_reverts_expiryNowPasses() public {
        bytes memory e_ = _exec(grocer, 2_000 * U);
        bytes memory late_ = _approval(DH, e_, 1, block.timestamp - 1, aliceKey);
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, block.timestamp - 1));
        _hook(late_, e_, DH);
        _hook(_approval(DH, e_, 2, block.timestamp, aliceKey), e_, DH);
    }

    function test_expiryBeyondWindow_reverts_exactlyAtWindowPasses() public {
        bytes memory e_ = _exec(grocer, 2_000 * U);
        bytes memory far_ = _approval(DH, e_, 1, block.timestamp + WINDOW + 1, aliceKey);
        vm.expectRevert(InvalidArgs.selector);
        _hook(far_, e_, DH);
        _hook(_approval(DH, e_, 2, block.timestamp + WINDOW, aliceKey), e_, DH);
    }

    function test_nonceReplay_reverts() public {
        bytes memory e_ = _exec(grocer, 2_000 * U);
        bytes memory args_ = _approval(DH, e_, 7, block.timestamp + 1 minutes, aliceKey);
        _hook(args_, e_, DH);
        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, uint256(7)));
        _hook(args_, e_, DH);
    }

    function test_approvalByAnotherKey_reverts() public {
        bytes memory e_ = _exec(grocer, 2_000 * U);
        bytes memory args_ = _approval(DH, e_, 1, block.timestamp + 1 minutes, yingKey);
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, 2_000 * U, DEFAULT_CAP));
        _hook(args_, e_, DH);
    }

    function test_approvalIsBoundToTheExactExecution() public {
        bytes memory args_ = _approval(DH, _exec(grocer, 2_000 * U), 1, block.timestamp + 1 minutes, aliceKey);
        bytes memory other_ = _exec(grocer, 2_000 * U + 1);
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, 2_000 * U + 1, DEFAULT_CAP));
        _hook(args_, other_, DH);
    }

    function test_approvalIsBoundToTheDelegation() public {
        bytes memory e_ = _exec(grocer, 2_000 * U);
        bytes memory args_ = _approval(DH2, e_, 1, block.timestamp + 1 minutes, aliceKey);
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, 2_000 * U, DEFAULT_CAP));
        _hook(args_, e_, DH);
        _hook(args_, e_, DH2);
    }

    function test_escalatedApprovalBelowThreshold_isCheckedAndConsumed() public {
        bytes memory e_ = _exec(grocer, 10 * U);
        bytes memory bad_ = _approval(DH, e_, 4, block.timestamp + 1 minutes, yingKey);
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, 10 * U, DEFAULT_CAP));
        _hook(bad_, e_, DH);

        bytes memory good_ = _approval(DH, e_, 4, block.timestamp + 1 minutes, aliceKey);
        vm.expectEmit(true, true, true, true, address(cosignE));
        emit CoSigned(address(this), DH, 4, 10 * U);
        _hook(good_, e_, DH);
        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, uint256(4)));
        _hook(good_, e_, DH);
    }

    function test_malformedArgs_revert() public {
        bytes memory e_ = _exec(grocer, 2_000 * U);
        vm.expectRevert();
        _hook(hex"01", e_, DH);
    }

    // ------------------------------------------------------------------ state keyed by msg.sender

    function test_noncesAreKeyedByDelegationManager() public {
        bytes memory e_ = _exec(grocer, 2_000 * U);
        bytes memory args_ = _approval(DH, e_, 1, block.timestamp + 1 minutes, aliceKey);
        vm.prank(address(dm));
        _hook(args_, e_, DH);
        assertTrue(cosignE.nonceUsed(address(dm), DH, 1));
        assertFalse(cosignE.nonceUsed(address(dm2), DH, 1));
        vm.prank(address(dm2));
        _hook(args_, e_, DH);
        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, uint256(1)));
        vm.prank(address(dm));
        _hook(args_, e_, DH);
    }

    function test_directCallCannotBurnTheManagersNonce() public {
        // An observer copies a pending approval and calls the hook directly: only its own key space is touched.
        bytes memory e_ = _exec(grocer, 2_000 * U);
        bytes memory args_ = _approval(DH, e_, 9, block.timestamp + 1 minutes, aliceKey);
        vm.prank(mirage);
        _hook(args_, e_, DH);
        assertTrue(cosignE.nonceUsed(mirage, DH, 9));
        vm.prank(address(dm));
        _hook(args_, e_, DH);
    }

    // ------------------------------------------------------------------ properties

    function testFuzz_withoutApproval_passesIffWithinTier(uint256 _amount, uint8 _who) public {
        _amount = bound(_amount, 0, 2 * CEILING);
        address to_ = _who % 3 == 0 ? landlord : (_who % 3 == 1 ? grocer : stranger);
        uint256 thr_ = _who % 3 == 0 ? RENT_CAP : (_who % 3 == 1 ? DEFAULT_CAP : NEW_PAYEE_CAP);
        bytes memory e_ = _exec(to_, _amount);
        if (_amount > CEILING) {
            vm.expectRevert(abi.encodeWithSelector(AboveTierCeiling.selector, _amount, CEILING));
        } else if (_amount > thr_) {
            vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, _amount, thr_));
        }
        _hook("", e_, DH);
    }

    // ------------------------------------------------------------------ through the DelegationManager (passkey)

    function test_redeem_escalatedFoodPaymentWithPasskeyApproval() public {
        Delegation memory d_ = _sealNadia(keccak256("mandate:cosign"), 1, 1001);
        bytes32 dh_ = _hashOf(d_);
        bytes memory e_ = _transferCall(address(tHKD), foodMart, 100 * U);
        uint256 expiry_ = block.timestamp + 5 minutes;
        bytes memory sig_ = _passkeySign(cosignE.approvalDigest(dh_, keccak256(e_), 11, expiry_));
        Caveat[] memory c_ = new Caveat[](d_.caveats.length);
        for (uint256 i; i < c_.length; ++i) {
            c_[i] = d_.caveats[i];
        }
        c_[COSIGN_IDX].args = abi.encode(uint256(11), expiry_, sig_);
        d_.caveats = c_;
        vm.expectEmit(true, true, true, true, address(cosignE));
        emit CoSigned(address(dm), dh_, 11, 100 * U);
        _redeem(ying, d_, e_);
        assertTrue(cosignE.nonceUsed(address(dm), dh_, 11));
        // An ECDSA signature by the agent over the same digest never satisfies the passkey account.
        c_[COSIGN_IDX].args = abi.encode(uint256(12), expiry_, _ecdsa(yingKey, cosignE.approvalDigest(dh_, keccak256(e_), 12, expiry_)));
        vm.expectRevert(abi.encodeWithSelector(CoSignRequired.selector, 100 * U, 2_000 * U));
        _redeem(ying, d_, e_);
    }
}
