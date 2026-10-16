// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { Delegation } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { MockRailKind, MockWideReturn } from "./CoverageMocks.sol";
import { RailNotPermitted, InvalidTerms, InvalidExecutionMode, UndecodableExecution } from "../../src/utils/Errors.sol";

/// @notice JurisdictionEnforcer: the paid asset must be sealed for the profile, and under the mainland profile
/// only coin-free rails (railKind 3) are permitted whatever the asset list says.
contract JurisdictionEnforcerTest is CoverageBase {
    uint8 internal constant HK = 1;
    uint8 internal constant INTL = 2;
    uint8 internal constant MAINLAND = 3;

    function _hook(bytes memory _t, bytes memory _exec) internal view {
        jurisdictionE.beforeHook(_t, "", singleMode, _exec, DH, address(nadia), ying);
    }

    // ------------------------------------------------------------------ terms

    function test_constants() public {
        assertEq(jurisdictionE.PROFILE_HONG_KONG(), 1);
        assertEq(jurisdictionE.PROFILE_INTERNATIONAL(), 2);
        assertEq(jurisdictionE.PROFILE_MAINLAND(), 3);
        assertEq(jurisdictionE.RAIL_COIN_FREE(), 3);
    }

    function test_getTermsInfo_decodesEveryProfile() public {
        for (uint8 p_ = 1; p_ <= 3; ++p_) {
            (uint8 profile_, address[] memory assets_) = jurisdictionE.getTermsInfo(abi.encode(p_, _a2(address(tHKD), address(cpi))));
            assertEq(profile_, p_);
            assertEq(assets_.length, 2);
            assertEq(assets_[1], address(cpi));
        }
        // Exactly 96 bytes: a profile with an empty asset list.
        bytes memory empty_ = abi.encode(HK, new address[](0));
        assertEq(empty_.length, 96);
        (, address[] memory none_) = jurisdictionE.getTermsInfo(empty_);
        assertEq(none_.length, 0);
    }

    function test_getTermsInfo_shortTerms_reverts() public {
        vm.expectRevert(InvalidTerms.selector);
        jurisdictionE.getTermsInfo(abi.encode(HK));
        bytes memory t_ = abi.encode(HK, new address[](0));
        assembly {
            mstore(t_, 95)
        }
        vm.expectRevert(InvalidTerms.selector);
        jurisdictionE.getTermsInfo(t_);
    }

    function test_getTermsInfo_unknownProfile_reverts() public {
        vm.expectRevert(InvalidTerms.selector);
        jurisdictionE.getTermsInfo(abi.encode(uint8(0), _a1(address(tHKD))));
        vm.expectRevert(InvalidTerms.selector);
        jurisdictionE.getTermsInfo(abi.encode(uint8(4), _a1(address(tHKD))));
    }

    function test_nonSingleDefaultMode_reverts() public {
        bytes memory t_ = abi.encode(HK, _a1(address(tHKD)));
        bytes memory e_ = _transferCall(address(tHKD), foodMart, 1);
        vm.expectRevert(InvalidExecutionMode.selector);
        jurisdictionE.beforeHook(t_, "", batchMode, e_, DH, address(nadia), ying);
    }

    function test_undecodableExecution_reverts() public {
        bytes memory t_ = abi.encode(HK, _a1(address(tHKD)));
        bytes memory e_ = ExecutionLib.encodeSingle(address(tHKD), 0, abi.encodeWithSignature("approve(address,uint256)", mirage, 1));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, bytes4(0x095ea7b3)));
        _hook(t_, e_);
    }

    // ------------------------------------------------------------------ asset list

    function test_sealedAssetPasses_unsealedAssetRefused() public {
        bytes memory t_ = abi.encode(HK, _a1(address(tHKD)));
        _hook(t_, _transferCall(address(tHKD), foodMart, 1));
        vm.expectRevert(abi.encodeWithSelector(RailNotPermitted.selector, address(tUSD), HK));
        _hook(t_, _transferCall(address(tUSD), foodMart, 1));
    }

    function test_emptyAssetListRefusesEverything() public {
        bytes memory t_ = abi.encode(INTL, new address[](0));
        vm.expectRevert(abi.encodeWithSelector(RailNotPermitted.selector, address(tUSD), INTL));
        _hook(t_, _transferCall(address(tUSD), foodMart, 1));
    }

    // ------------------------------------------------------------------ mainland rule

    function test_mainland_coinFreeInstructionRailPasses() public {
        _hook(abi.encode(MAINLAND, _a1(address(cpi))), _instructCall(address(cpi), harbourHomes, 100, uint64(block.timestamp + 1 days)));
    }

    function test_mainland_valueTokenRefusedEvenWhenListed() public {
        bytes memory t_ = abi.encode(MAINLAND, _a2(address(tHKD), address(cpi)));
        vm.expectRevert(abi.encodeWithSelector(RailNotPermitted.selector, address(tHKD), MAINLAND));
        _hook(t_, _transferCall(address(tHKD), foodMart, 1));
    }

    function test_mainland_assetReportingOutOfRangeKindIsRefused() public {
        // railKind() = 3 + 256 does not truncate to 3: it is not a valid uint8 and counts as value-bearing.
        MockRailKind odd_ = new MockRailKind(259);
        bytes memory t_ = abi.encode(MAINLAND, _a1(address(odd_)));
        vm.expectRevert(abi.encodeWithSelector(RailNotPermitted.selector, address(odd_), MAINLAND));
        _hook(t_, _transferCall(address(odd_), foodMart, 1));
    }

    function test_mainland_mockCoinFreeAssetPasses() public {
        MockRailKind coinFree_ = new MockRailKind(3);
        _hook(abi.encode(MAINLAND, _a1(address(coinFree_))), _transferCall(address(coinFree_), foodMart, 1));
    }

    function test_railKindOf_everyAnswerShape() public {
        assertEq(jurisdictionE.railKindOf(address(tHKD)), 1);
        assertEq(jurisdictionE.railKindOf(address(tUSD)), 2);
        assertEq(jurisdictionE.railKindOf(address(cpi)), 3);
        assertEq(jurisdictionE.railKindOf(address(fundLow)), 0); // no railKind(): the call reverts
        assertEq(jurisdictionE.railKindOf(foodMart), 0); // no code: empty return data
        assertEq(jurisdictionE.railKindOf(address(new MockRailKind(255))), 255);
        assertEq(jurisdictionE.railKindOf(address(new MockRailKind(256))), 0);
        assertEq(jurisdictionE.railKindOf(address(new MockWideReturn())), 0); // 64-byte answer
    }

    // ------------------------------------------------------------------ through the DelegationManager

    function test_redeem_mainlandMandateIssuesInstructionOnCoinFreeRail() public {
        cpi.postBalance(address(nadia), 50_000, keccak256("statement-1"));
        Delegation memory d_ = _signed(_delegation(address(nadia), ying, _one(address(jurisdictionE), abi.encode(MAINLAND, _a1(address(cpi)))), 901));
        _redeem(ying, d_, _instructCall(address(cpi), harbourHomes, 12_000, uint64(block.timestamp + 1 days)));
        assertEq(cpi.instructionCount(), 1);
        assertEq(cpi.instructionOf(0).account, address(nadia));
        assertEq(cpi.balanceOf(address(nadia)), 38_000);

        vm.expectRevert(abi.encodeWithSelector(RailNotPermitted.selector, address(tHKD), MAINLAND));
        _redeem(ying, d_, _transferCall(address(tHKD), harbourHomes, 1));
    }
}
