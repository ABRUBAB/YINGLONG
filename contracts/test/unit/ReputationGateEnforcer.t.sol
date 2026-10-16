// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { stdError } from "forge-std/StdError.sol";
import { Delegation } from "@delegation-framework/utils/Types.sol";
import { CoverageBase } from "./CoverageBase.sol";
import { MockReputationRegistry } from "./CoverageMocks.sol";
import { ReputationGateEnforcer } from "../../src/enforcers/ReputationGateEnforcer.sol";
import { ReputationTooLow, InvalidTerms, InvalidExecutionMode, UndecodableExecution } from "../../src/utils/Errors.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";

/// @notice ReputationGateEnforcer: a beneficiary holding a passport must have an ERC-8004 summary, over the
/// sealed clients and tag, at least the sealed minimum (both sides scaled to 18 decimals). The registry is a
/// test stand-in with settable summaries; the fixture's passport registry is real.
contract ReputationGateEnforcerTest is CoverageBase {
    uint256 internal constant ERC8004_ID = 42;
    MockReputationRegistry internal rep;
    uint256 internal deskId;
    address[] internal clients;

    function setUp() public override {
        super.setUp();
        rep = new MockReputationRegistry();
        deskId = passports.agentIdOf(pearlRiver);
        vm.prank(agentOwner);
        passports.setErc8004AgentId(deskId, ERC8004_ID);
        clients.push(makeAddr("client-hbu"));
        clients.push(makeAddr("client-bank"));
    }

    function _terms(int128 _min, uint8 _minDecimals) internal view returns (bytes memory) {
        return abi.encode(address(rep), address(passports), clients, _min, _minDecimals, "quality");
    }

    function _hook(bytes memory _t, address _to) internal view {
        reputationE.beforeHook(_t, "", singleMode, _transferCall(address(tHKD), _to, 10 * U), DH, address(nadia), ying);
    }

    function _clientsOf(uint256 _n) internal returns (address[] memory c_) {
        c_ = new address[](_n);
        for (uint256 i; i < _n; ++i) {
            c_[i] = makeAddr(string(abi.encodePacked("client-", vm.toString(i))));
        }
    }

    // ------------------------------------------------------------------ terms

    function test_getTermsInfo_decodesFields() public {
        ReputationGateEnforcer.Terms memory t_ = reputationE.getTermsInfo(_terms(80, 0));
        assertEq(t_.reputation, address(rep));
        assertEq(t_.passport, address(passports));
        assertEq(t_.clients.length, 2);
        assertEq(t_.minScore, 80);
        assertEq(t_.minScoreDecimals, 0);
        assertEq(t_.tag1, "quality");
    }

    function test_getTermsInfo_shortTerms_reverts() public {
        bytes memory t_ = abi.encode(address(rep), address(passports), new address[](0), int128(1), uint8(0), "");
        assertEq(t_.length, 256);
        assembly {
            mstore(t_, 255)
        }
        vm.expectRevert(InvalidTerms.selector);
        reputationE.getTermsInfo(t_);
    }

    function test_getTermsInfo_clientListBounds() public {
        vm.expectRevert(InvalidTerms.selector);
        reputationE.getTermsInfo(abi.encode(address(rep), address(passports), new address[](0), int128(1), uint8(0), ""));
        address[] memory eleven_ = _clientsOf(11);
        vm.expectRevert(InvalidTerms.selector);
        reputationE.getTermsInfo(abi.encode(address(rep), address(passports), eleven_, int128(1), uint8(0), ""));
        address[] memory ten_ = _clientsOf(10);
        assertEq(reputationE.getTermsInfo(abi.encode(address(rep), address(passports), ten_, int128(1), uint8(0), "")).clients.length, 10);
        assertEq(reputationE.MAX_CLIENTS(), 10);
    }

    function test_getTermsInfo_minScoreDecimalsAtMost18() public {
        reputationE.getTermsInfo(_terms(1, 18));
        vm.expectRevert(InvalidTerms.selector);
        reputationE.getTermsInfo(_terms(1, 19));
    }

    function test_nonSingleDefaultModeOrUndecodable_reverts() public {
        bytes memory t_ = _terms(80, 0);
        bytes memory e_ = _transferCall(address(tHKD), pearlRiver, 1);
        vm.expectRevert(InvalidExecutionMode.selector);
        reputationE.beforeHook(t_, "", batchMode, e_, DH, address(nadia), ying);
        bytes memory bad_ = ExecutionLib.encodeSingle(address(tHKD), 0, hex"");
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, bytes4(0)));
        reputationE.beforeHook(t_, "", singleMode, bad_, DH, address(nadia), ying);
    }

    // ------------------------------------------------------------------ gate

    function test_beneficiaryWithoutPassportIsNotAffected_registryNotRead() public {
        vm.expectCall(address(rep), abi.encodeWithSelector(MockReputationRegistry.getSummary.selector), 0);
        _hook(_terms(80, 0), harbourHomes);
    }

    function test_agentWithoutErc8004Id_reverts() public {
        // Ying holds a passport registered with erc8004AgentId = 0.
        bytes memory t_ = _terms(80, 0);
        vm.expectRevert(abi.encodeWithSelector(ReputationTooLow.selector, uint256(0), int256(0), int256(80)));
        _hook(t_, ying);
    }

    function test_noFeedback_reverts() public {
        rep.setSummary(ERC8004_ID, 0, 100, 0);
        bytes memory t_ = _terms(80, 0);
        vm.expectRevert(abi.encodeWithSelector(ReputationTooLow.selector, ERC8004_ID, int256(0), int256(80e18)));
        _hook(t_, pearlRiver);
    }

    function test_scoreExactlyAtMinimumPasses_readsSealedClientsAndTag() public {
        rep.setSummary(ERC8004_ID, 5, 80, 0);
        address[] memory sealed_ = clients;
        vm.expectCall(address(rep), abi.encodeCall(MockReputationRegistry.getSummary, (ERC8004_ID, sealed_, "quality", "")));
        _hook(_terms(80, 0), pearlRiver);
    }

    function test_scoreOneUnitBelow_reverts() public {
        rep.setSummary(ERC8004_ID, 5, 79, 0);
        bytes memory t_ = _terms(80, 0);
        vm.expectRevert(abi.encodeWithSelector(ReputationTooLow.selector, ERC8004_ID, int256(79e18), int256(80e18)));
        _hook(t_, pearlRiver);
    }

    function test_decimalsAreScaledOnBothSides() public {
        rep.setSummary(ERC8004_ID, 3, 8000, 2); // 80.00
        _hook(_terms(80, 0), pearlRiver);
        rep.setSummary(ERC8004_ID, 3, 7999, 2); // 79.99
        bytes memory t_ = _terms(80, 0);
        vm.expectRevert(abi.encodeWithSelector(ReputationTooLow.selector, ERC8004_ID, int256(7999e16), int256(80e18)));
        _hook(t_, pearlRiver);
        rep.setSummary(ERC8004_ID, 3, 80, 0); // 80 < 80.5
        bytes memory t2_ = _terms(805, 1);
        vm.expectRevert(abi.encodeWithSelector(ReputationTooLow.selector, ERC8004_ID, int256(80e18), int256(805e17)));
        _hook(t2_, pearlRiver);
    }

    function test_negativeScore_reverts_negativeMinimumCanPass() public {
        rep.setSummary(ERC8004_ID, 3, -5, 0);
        bytes memory t_ = _terms(0, 0);
        vm.expectRevert(abi.encodeWithSelector(ReputationTooLow.selector, ERC8004_ID, int256(-5e18), int256(0)));
        _hook(t_, pearlRiver);
        _hook(_terms(-5, 0), pearlRiver);
    }

    function test_registryDecimalsAbove18_failsClosed() public {
        // Out-of-spec answer: the scaling underflows and the payment is refused (arithmetic panic, not a typed error).
        rep.setSummary(ERC8004_ID, 3, 100, 19);
        bytes memory t_ = _terms(80, 0);
        vm.expectRevert(stdError.arithmeticError);
        _hook(t_, pearlRiver);
    }

    function test_agentBehindARailIsGated() public {
        rep.setSummary(ERC8004_ID, 3, 10, 0);
        bytes memory t_ = _terms(80, 0);
        bytes memory e_ = _tac(address(tUSD), address(quotes), 1, abi.encode(pearlRiver));
        vm.expectRevert(abi.encodeWithSelector(ReputationTooLow.selector, ERC8004_ID, int256(10e18), int256(80e18)));
        reputationE.beforeHook(t_, "", singleMode, e_, DH, address(nadia), ying);
    }

    // ------------------------------------------------------------------ through the DelegationManager

    function test_redeem_payAgentOnlyAboveReputationMinimum() public {
        Delegation memory d_ = _signed(_delegation(address(nadia), ying, _one(address(reputationE), _terms(80, 0)), 1401));
        rep.setSummary(ERC8004_ID, 12, 91, 0);
        _redeem(ying, d_, _transferCall(address(tHKD), pearlRiver, 10 * U));
        assertEq(tHKD.balanceOf(pearlRiver), 10 * U);
        rep.setSummary(ERC8004_ID, 12, 12, 0);
        vm.expectRevert(abi.encodeWithSelector(ReputationTooLow.selector, ERC8004_ID, int256(12e18), int256(80e18)));
        _redeem(ying, d_, _transferCall(address(tHKD), pearlRiver, 10 * U));
        // People and firms without a passport are not gated.
        _redeem(ying, d_, _transferCall(address(tHKD), harbourHomes, 10 * U));
    }
}
