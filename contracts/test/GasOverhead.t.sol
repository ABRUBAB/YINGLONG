// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { console } from "forge-std/console.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { ModeLib } from "@erc7579/lib/ModeLib.sol";
import { DelegationManager } from "@delegation-framework/DelegationManager.sol";
import { EncoderLib } from "@delegation-framework/libraries/EncoderLib.sol";
import { Delegation, Caveat, ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongBase } from "./YinglongBase.t.sol";
import { MandateRegistry } from "../src/registries/MandateRegistry.sol";

/// @notice Gas overhead of a redemption under Nadia's full YINGLONG mandate versus the same payment under a
/// delegation that carries only stock framework enforcers (AllowedTargets, AllowedMethods, ValueLte,
/// ERC20TransferAmount). Both delegations are signed by the same P-256 passkey and redeemed by the same agent
/// through the same DelegationManager, so signature verification and the token transfer cancel out.
///
/// Every sample is one redemption of a 1 tHKD transfer to a verified payee (Kowloon Food Mart). Samples of the
/// configurations are interleaved so they see the same period and balance state. Two cadences:
///  - "daily": one day between samples, so every redemption opens a fresh VelocityEnforcer window (the
///    expensive case for that caveat: its counters go from zero to non-zero);
///  - "intraday": 90 minutes between samples, so the full mandate pays every 3 hours (8 per day, the sealed
///    velocity limit) and most redemptions update existing counters.
///
/// Output lines (parsed by contracts/reports/gen_reports.py gas):
///   GAS|<cadence>|<config>|<sample index>|<gasleft delta of redeemDelegations>|<EIP-2028 calldata gas of the call>
/// With this project's foundry.toml the effective config has `isolate = true` (`forge config --json`), so each
/// top-level call runs as its own transaction and the gasleft delta includes the 21,000 base cost and the
/// calldata cost; the calldata column is the calldata component, computed separately.
contract GasOverheadTest is YinglongBase {
    uint256 internal constant N = 20; // samples per configuration
    uint256 internal constant PAY = 1 * U; // 1 tHKD
    uint256 internal constant FIRST_YINGLONG_IDX = 3; // _nadiaCaveats: 0..2 are stock, 3..14 are YINGLONG

    function _caveatName(uint256 _idx) internal pure returns (string memory) {
        if (_idx == 3) return "ForbiddenTargetsEnforcer";
        if (_idx == 4) return "GlobalPauseEnforcer";
        if (_idx == 5) return "AgentLineageEnforcer";
        if (_idx == 6) return "MandateBindingEnforcer";
        if (_idx == 7) return "JurisdictionEnforcer";
        if (_idx == 8) return "VerifiedPayeeEnforcer";
        if (_idx == 9) return "CoSignEnforcer";
        if (_idx == 10) return "CategoryBudgetEnforcer(tHKD)";
        if (_idx == 11) return "ReserveFloorEnforcer";
        if (_idx == 12) return "VelocityEnforcer";
        if (_idx == 13) return "SuitabilityEnforcer";
        if (_idx == 14) return "CategoryBudgetEnforcer(tUSD)";
        return "unknown";
    }

    // ------------------------------------------------------------------ delegations

    function _stockCaveats() internal view returns (Caveat[] memory c_) {
        c_ = new Caveat[](4);
        address[] memory targets_ = new address[](2);
        targets_[0] = address(tHKD);
        targets_[1] = address(tUSD);
        c_[0] = Caveat(address(allowedTargets), _packAddrs(targets_), "");
        c_[1] = Caveat(address(allowedMethods), abi.encodePacked(bytes4(0xa9059cbb), bytes4(0x4000aea0)), "");
        c_[2] = Caveat(address(valueLte), abi.encode(uint256(0)), "");
        c_[3] = Caveat(address(transferAmount), abi.encodePacked(address(tHKD), uint256(3_000 * U)), "");
    }

    function _without(Caveat[] memory _c, uint256 _skip) internal pure returns (Caveat[] memory out_) {
        out_ = new Caveat[](_c.length - 1);
        uint256 j_;
        for (uint256 i; i < _c.length; ++i) {
            if (i == _skip) continue;
            out_[j_++] = _c[i];
        }
    }

    function _sign(Delegation memory _d) internal view returns (Delegation memory) {
        _d.signature = _passkeySign(MessageHashUtils.toTypedDataHash(dm.getDomainHash(), EncoderLib._getDelegationHash(_d)));
        return _d;
    }

    /// @notice Publish a mandate (own lineage) for `_caveats` from Nadia's account and sign the delegation.
    function _publishAndSign(bytes32 _mandateHash, Caveat[] memory _caveats, uint256 _salt) internal returns (Delegation memory) {
        Delegation memory d_ = _delegation(address(nadia), ying, _caveats, _salt);
        MandateRegistry.PublishParams memory p_ = MandateRegistry.PublishParams({
            mandateHash: _mandateHash,
            agent: ying,
            lineageId: keccak256(abi.encode("gas-lineage", _salt)),
            jurisdiction: 1,
            validFrom: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 365 days),
            salt: _salt,
            caveats: _caveats
        });
        vm.prank(address(nadia));
        mandates.publish(p_);
        return _sign(d_);
    }

    function _fullDelegation(uint256 _salt) internal returns (Delegation memory) {
        bytes32 mh_ = keccak256(abi.encode("mandate:gas", _salt));
        return _publishAndSign(mh_, _nadiaCaveats(mh_, 1), _salt);
    }

    function _fullWithoutDelegation(uint256 _skip, uint256 _salt) internal returns (Delegation memory) {
        bytes32 mh_ = keccak256(abi.encode("mandate:gas", _salt));
        return _publishAndSign(mh_, _without(_nadiaCaveats(mh_, 1), _skip), _salt);
    }

    function _stockDelegation(uint256 _salt) internal view returns (Delegation memory) {
        return _sign(_delegation(address(nadia), ying, _stockCaveats(), _salt));
    }

    // ------------------------------------------------------------------ measurement

    function _calldataGas(bytes memory _b) internal pure returns (uint256 g_) {
        for (uint256 i; i < _b.length; ++i) {
            g_ += _b[i] == 0 ? 4 : 16;
        }
    }

    /// @return used_ gasleft delta around DelegationManager.redeemDelegations
    /// @return calldataGas_ EIP-2028 calldata cost of the same call (4 per zero byte, 16 per non-zero byte)
    function _measure(Delegation memory _d) internal returns (uint256 used_, uint256 calldataGas_) {
        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = _d;
        bytes[] memory contexts_ = new bytes[](1);
        contexts_[0] = abi.encode(chain_);
        ModeCode[] memory modes_ = new ModeCode[](1);
        modes_[0] = ModeLib.encodeSimpleSingle();
        bytes[] memory executions_ = new bytes[](1);
        executions_[0] = _transferCall(address(tHKD), foodMart, PAY);
        calldataGas_ = _calldataGas(abi.encodeCall(DelegationManager.redeemDelegations, (contexts_, modes_, executions_)));

        uint256 before_ = tHKD.balanceOf(foodMart);
        vm.prank(ying);
        uint256 g0_ = gasleft();
        dm.redeemDelegations(contexts_, modes_, executions_);
        used_ = g0_ - gasleft();
        assertEq(tHKD.balanceOf(foodMart), before_ + PAY, "payment did not land");
    }

    function _sample(string memory _cadence, uint256 _dt, string memory _config, uint256 _i, Delegation memory _d)
        internal
        returns (uint256 used_)
    {
        vm.warp(block.timestamp + _dt);
        uint256 cd_;
        (used_, cd_) = _measure(_d);
        console.log(
            string.concat("GAS|", _cadence, "|", _config, "|", vm.toString(_i), "|", vm.toString(used_), "|", vm.toString(cd_))
        );
    }

    function _median(uint256[] memory _a) internal pure returns (uint256) {
        uint256 n_ = _a.length;
        for (uint256 i = 1; i < n_; ++i) {
            uint256 v_ = _a[i];
            uint256 j_ = i;
            while (j_ > 0 && _a[j_ - 1] > v_) {
                _a[j_] = _a[j_ - 1];
                --j_;
            }
            _a[j_] = v_;
        }
        return n_ % 2 == 1 ? _a[n_ / 2] : (_a[n_ / 2 - 1] + _a[n_ / 2]) / 2;
    }

    // ------------------------------------------------------------------ tests

    function _fullVsStock(string memory _cadence, uint256 _dt) internal {
        Delegation memory full_ = _fullDelegation(101);
        Delegation memory stock_ = _stockDelegation(102);
        uint256[] memory f_ = new uint256[](N);
        uint256[] memory s_ = new uint256[](N);
        for (uint256 i; i < N; ++i) {
            s_[i] = _sample(_cadence, _dt, "stock", i, stock_);
            f_[i] = _sample(_cadence, _dt, "full", i, full_);
        }
        uint256 medFull_ = _median(f_);
        uint256 medStock_ = _median(s_);
        console.log(string.concat("GAS_MEDIAN|", _cadence, "|full|", vm.toString(medFull_)));
        console.log(string.concat("GAS_MEDIAN|", _cadence, "|stock|", vm.toString(medStock_)));
        assertGt(medFull_, medStock_, "YINGLONG caveats cannot be free");
    }

    /// Full YINGLONG mandate (15 caveats: 3 stock + 12 YINGLONG) vs stock-only (4 stock caveats), one per day.
    function test_gasOverhead_fullVsStock_daily() public {
        _fullVsStock("daily", 1 days + 1);
    }

    /// Same comparison, full mandate paying every 3 hours (8 per day, the sealed velocity limit).
    function test_gasOverhead_fullVsStock_intraday() public {
        _fullVsStock("intraday", 90 minutes);
    }

    /// Marginal cost of each YINGLONG caveat: the full mandate minus that one caveat (daily cadence).
    function test_gasMarginal_perCaveat() public {
        uint256 k_ = 14 - FIRST_YINGLONG_IDX + 1; // 12 YINGLONG caveats
        Delegation[] memory variants_ = new Delegation[](k_);
        for (uint256 j; j < k_; ++j) {
            variants_[j] = _fullWithoutDelegation(FIRST_YINGLONG_IDX + j, 200 + j);
        }
        Delegation memory full_ = _fullDelegation(199);
        for (uint256 i; i < N; ++i) {
            _sample("daily", 1 days + 1, "full", i, full_);
            for (uint256 j; j < k_; ++j) {
                _sample("daily", 1 days + 1, string.concat("without:", _caveatName(FIRST_YINGLONG_IDX + j)), i, variants_[j]);
            }
        }
    }
}
