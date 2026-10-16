// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Delegation, Caveat } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { MandateRegistry } from "../../src/registries/MandateRegistry.sol";
import { MandateNotLive, MandateDelegationMismatch, InvalidTerms, InvalidArgs, InvalidExecutionMode } from
    "../../src/utils/Errors.sol";

/// @notice MandateBindingEnforcer: the redeemed delegation must be the one recorded for the mandate, the mandate
/// must be live, and the (untrusted) args are only logged.
contract MandateBindingEnforcerTest is CoverageBase {
    event MandateRedemption(
        address indexed delegationManager,
        address indexed delegator,
        bytes32 indexed mandateHash,
        bytes32 delegationHash,
        address redeemer,
        bytes32 intentHash,
        uint256 receiptNonce
    );

    address internal alice = makeAddr("alice");
    bytes32 internal constant M = keccak256("mandate:binding");

    function _publish(bytes32 _m, uint64 _from, uint64 _until) internal returns (bytes32 dh_) {
        MandateRegistry.PublishParams memory p_ = MandateRegistry.PublishParams({
            mandateHash: _m,
            agent: ying,
            lineageId: keccak256(abi.encode("lineage", _m)),
            jurisdiction: 1,
            validFrom: _from,
            validUntil: _until,
            salt: 1,
            caveats: _one(address(bindingE), abi.encode(address(mandates), _m))
        });
        vm.prank(alice);
        dh_ = mandates.publish(p_);
    }

    function _terms(bytes32 _m) internal view returns (bytes memory) {
        return abi.encode(address(mandates), _m);
    }

    function _hook(bytes memory _t, bytes memory _args, bytes32 _dh) internal {
        bindingE.beforeHook(_t, _args, singleMode, "", _dh, alice, ying);
    }

    function test_getTermsInfo_decodesAndChecksLength() public {
        (address r_, bytes32 m_) = bindingE.getTermsInfo(_terms(M));
        assertEq(r_, address(mandates));
        assertEq(m_, M);
        vm.expectRevert(InvalidTerms.selector);
        bindingE.getTermsInfo(abi.encode(address(mandates)));
        vm.expectRevert(InvalidTerms.selector);
        bindingE.getTermsInfo(abi.encode(address(mandates), M, uint256(0)));
    }

    function test_nonSingleDefaultMode_reverts() public {
        bytes32 dh_ = _publish(M, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        bytes memory t_ = _terms(M);
        vm.expectRevert(InvalidExecutionMode.selector);
        bindingE.beforeHook(t_, "", tryMode, "", dh_, alice, ying);
    }

    function test_unpublishedMandate_mismatchAgainstZero() public {
        bytes memory t_ = _terms(M);
        vm.expectRevert(abi.encodeWithSelector(MandateDelegationMismatch.selector, M, bytes32(0), DH));
        _hook(t_, "", DH);
    }

    function test_otherDelegationOfPublishedMandate_reverts() public {
        bytes32 dh_ = _publish(M, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        bytes memory t_ = _terms(M);
        vm.expectRevert(abi.encodeWithSelector(MandateDelegationMismatch.selector, M, dh_, DH));
        _hook(t_, "", DH);
    }

    function test_emptyArgs_logsZeroCommitments() public {
        bytes32 dh_ = _publish(M, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        vm.expectEmit(true, true, true, true, address(bindingE));
        emit MandateRedemption(address(this), alice, M, dh_, ying, bytes32(0), 0);
        _hook(_terms(M), "", dh_);
    }

    function test_intentArgs_areLogged() public {
        bytes32 dh_ = _publish(M, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        vm.expectEmit(true, true, true, true, address(bindingE));
        emit MandateRedemption(address(dm), alice, M, dh_, ying, keccak256("intent"), 42);
        vm.prank(address(dm));
        _hook(_terms(M), abi.encode(keccak256("intent"), uint256(42)), dh_);
    }

    function test_argsOfAnyOtherLength_revert() public {
        bytes32 dh_ = _publish(M, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        bytes memory t_ = _terms(M);
        vm.expectRevert(InvalidArgs.selector);
        _hook(t_, abi.encode(keccak256("intent")), dh_);
        vm.expectRevert(InvalidArgs.selector);
        _hook(t_, abi.encode(keccak256("intent"), uint256(1), uint256(2)), dh_);
        vm.expectRevert(InvalidArgs.selector);
        _hook(t_, hex"01", dh_);
    }

    function test_revokedMandate_notLive() public {
        bytes32 dh_ = _publish(M, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        vm.prank(alice);
        mandates.revoke(M);
        bytes memory t_ = _terms(M);
        vm.expectRevert(abi.encodeWithSelector(MandateNotLive.selector, M));
        _hook(t_, "", dh_);
    }

    function test_supersededMandate_notLive() public {
        bytes32 dh_ = _publish(M, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        bytes32 m2_ = keccak256("mandate:binding:v2");
        MandateRegistry.PublishParams memory p_ = MandateRegistry.PublishParams({
            mandateHash: m2_,
            agent: ying,
            lineageId: keccak256(abi.encode("lineage", M)),
            jurisdiction: 1,
            validFrom: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 days),
            salt: 2,
            caveats: _one(address(bindingE), _terms(m2_))
        });
        vm.prank(alice);
        bytes32 dh2_ = mandates.supersede(M, p_);
        bytes memory t_ = _terms(M);
        vm.expectRevert(abi.encodeWithSelector(MandateNotLive.selector, M));
        _hook(t_, "", dh_);
        _hook(_terms(m2_), "", dh2_);
    }

    function test_validityWindowBoundaries() public {
        uint64 from_ = uint64(block.timestamp + 1 hours);
        uint64 until_ = uint64(block.timestamp + 2 hours);
        bytes32 dh_ = _publish(M, from_, until_);
        bytes memory t_ = _terms(M);

        vm.warp(from_ - 1);
        vm.expectRevert(abi.encodeWithSelector(MandateNotLive.selector, M));
        _hook(t_, "", dh_);
        vm.warp(from_);
        _hook(t_, "", dh_);
        vm.warp(until_);
        _hook(t_, "", dh_);
        vm.warp(until_ + 1);
        vm.expectRevert(abi.encodeWithSelector(MandateNotLive.selector, M));
        _hook(t_, "", dh_);
    }

    function test_redeem_argsAreNotSignedButLogged() public {
        bytes32 m_ = keccak256("mandate:nadia:binding");
        Delegation memory d_ = _sealNadia(m_, 1, 801);
        bytes32 dh_ = _hashOf(d_);
        // Args are not part of the delegation hash: the agent attaches them after Nadia signed.
        Caveat[] memory c_ = new Caveat[](d_.caveats.length);
        for (uint256 i; i < c_.length; ++i) {
            c_[i] = d_.caveats[i];
        }
        c_[6].args = abi.encode(keccak256("intent:food"), uint256(7));
        d_.caveats = c_;
        assertEq(_hashOf(d_), dh_);
        vm.expectEmit(true, true, true, true, address(bindingE));
        emit MandateRedemption(address(dm), address(nadia), m_, dh_, ying, keccak256("intent:food"), 7);
        _redeem(ying, d_, _transferCall(address(tHKD), foodMart, 5 * U));
    }
}
