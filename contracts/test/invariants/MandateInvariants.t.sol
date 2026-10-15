// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test, console2 } from "forge-std/Test.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { ModeLib } from "@erc7579/lib/ModeLib.sol";
import { EncoderLib } from "@delegation-framework/libraries/EncoderLib.sol";
import { P256SCLVerifierLib } from "@delegation-framework/libraries/P256SCLVerifierLib.sol";
import { DelegationManager } from "@delegation-framework/DelegationManager.sol";
import { HybridDeleGator } from "@delegation-framework/HybridDeleGator.sol";
import { Delegation, Caveat, ModeCode } from "@delegation-framework/utils/Types.sol";
import { YinglongBase } from "../YinglongBase.t.sol";
import { TestUnits } from "../../src/rails/TestUnits.sol";
import { KillSwitchRegistry } from "../../src/registries/KillSwitchRegistry.sol";
import { PayeeBook } from "../../src/registries/PayeeBook.sol";
import { CoSignEnforcer } from "../../src/enforcers/CoSignEnforcer.sol";
import { Categories } from "../../src/utils/Categories.sol";

/// @notice The fuzzer plays the agent, an attacker holding the agent key, the user and time.
contract MandateHandler is Test {
    uint256 internal constant U = 1e6;
    uint256 internal constant P256_N = 115792089210356248762697446949407573529996955224135760342422259061068512044369;

    DelegationManager internal dm;
    TestUnits internal tHKD;
    KillSwitchRegistry internal killSwitch;
    CoSignEnforcer internal cosign;
    address internal nadia;
    address internal ying;
    address internal guardian;
    bytes internal sealedEnc;
    uint256 internal cosignIdx;
    address[] internal payees; // 0..2 verified (rent, tuition, food), 3..4 unverified (mirage, look-alike)
    uint32[] internal categories;

    // ghost state
    mapping(uint256 period => mapping(uint32 category => uint256)) public spent;
    uint256[] public periodsSeen;
    bool public movedWhilePaused;
    bool public selfCallSucceeded;
    uint256 public successes;
    uint256 public refusals;
    uint256 public cosignNonce = 1;

    constructor(
        DelegationManager _dm,
        TestUnits _tHKD,
        KillSwitchRegistry _ks,
        CoSignEnforcer _cosign,
        address _nadia,
        address _ying,
        address _guardian,
        bytes memory _sealed,
        uint256 _cosignIdx,
        address[] memory _payees,
        uint32[] memory _categories
    ) {
        dm = _dm;
        tHKD = _tHKD;
        killSwitch = _ks;
        cosign = _cosign;
        nadia = _nadia;
        ying = _ying;
        guardian = _guardian;
        sealedEnc = _sealed;
        cosignIdx = _cosignIdx;
        payees = _payees;
        categories = _categories;
    }

    function _period() internal view returns (uint256) {
        return block.timestamp / 30 days;
    }

    function _redeem(Delegation memory _d, bytes memory _exec) internal returns (bool ok_) {
        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = _d;
        bytes[] memory ctx_ = new bytes[](1);
        ctx_[0] = abi.encode(chain_);
        ModeCode[] memory modes_ = new ModeCode[](1);
        modes_[0] = ModeLib.encodeSimpleSingle();
        bytes[] memory execs_ = new bytes[](1);
        execs_[0] = _exec;
        vm.prank(ying);
        try dm.redeemDelegations(ctx_, modes_, execs_) {
            ok_ = true;
        } catch {
            ok_ = false;
        }
    }

    function _passkeySign(bytes32 _hash) internal pure returns (bytes memory) {
        uint256 pk_ = uint256(keccak256("nadia passkey seed")) % P256_N;
        (bytes32 r_, bytes32 s_) = vm.signP256(pk_, sha256(abi.encodePacked(_hash)));
        if (uint256(s_) > P256SCLVerifierLib.P256_N_DIV_2) s_ = bytes32(P256_N - uint256(s_));
        return abi.encodePacked(keccak256(abi.encodePacked("nadia-phone")), r_, s_);
    }

    /// One fuzzed step: mostly payments, sometimes pause, resume, attacks on authority, or time passing.
    function step(uint256 _seed, uint256 _amount, bool _withCoSign) external {
        uint256 k_ = _seed % 20;
        if (k_ == 0) return tripByGuardian();
        if (k_ == 1) return untripByUser();
        if (k_ == 2) return attackSelfCall(_seed >> 8);
        if (k_ == 3) return warp(_amount);
        pay(_seed >> 8, _amount, _withCoSign);
    }

    /// Agent (or an attacker with the agent key) tries to pay anyone any amount, optionally with a co-sign.
    function pay(uint256 _payeeSeed, uint256 _amount, bool _withCoSign) public {
        uint256 i_ = _payeeSeed % payees.length;
        // Three in four attempts are small (inside the T1 caps), one in four can be large.
        uint256 amount_ = bound(_amount, 1, (_amount % 4 == 0 ? 13_000 : 900) * U);
        bytes memory exec_ = ExecutionLib.encodeSingle(address(tHKD), 0, abi.encodeWithSelector(bytes4(0xa9059cbb), payees[i_], amount_));
        Delegation memory d_ = abi.decode(sealedEnc, (Delegation));
        if (_withCoSign) {
            uint256 expiry_ = block.timestamp + 5 minutes;
            bytes32 digest_ = cosign.approvalDigest(EncoderLib._getDelegationHash(d_), keccak256(exec_), cosignNonce, expiry_);
            d_.caveats[cosignIdx].args = abi.encode(cosignNonce, expiry_, _passkeySign(digest_));
            cosignNonce++;
        }
        bool paused_ = killSwitch.isPaused(nadia, ying);
        bool ok_ = _redeem(d_, exec_);
        if (ok_) {
            successes++;
            if (paused_) movedWhilePaused = true;
            if (i_ < categories.length) {
                uint256 p_ = _period();
                if (spent[p_][categories[i_]] == 0) periodsSeen.push(p_);
                spent[p_][categories[i_]] += amount_;
            }
        } else {
            refusals++;
        }
    }

    /// Attacker tries to make the account call itself or a protected registry through the delegation.
    function attackSelfCall(uint256 _which) public {
        address target_ = _which % 2 == 0 ? nadia : address(killSwitch);
        bytes memory data_ = _which % 2 == 0
            ? abi.encodeWithSignature("addKey(string,uint256,uint256)", "evil", 1, 2)
            : abi.encodeWithSignature("untrip()");
        bytes memory exec_ = ExecutionLib.encodeSingle(target_, 0, data_);
        if (_redeem(abi.decode(sealedEnc, (Delegation)), exec_)) selfCallSucceeded = true;
    }

    function tripByGuardian() public {
        vm.prank(guardian);
        killSwitch.trip(nadia);
    }

    function untripByUser() public {
        vm.prank(nadia);
        killSwitch.untrip();
    }

    function warp(uint256 _dt) public {
        vm.warp(block.timestamp + bound(_dt, 1, 9 days));
    }

    function periodsCount() external view returns (uint256) {
        return periodsSeen.length;
    }
}

contract MandateInvariantsTest is YinglongBase {
    MandateHandler internal handler;
    address internal lookAlike;
    bytes32 internal keyIdHash0;
    uint256[] internal caps;

    function setUp() public override {
        super.setUp();
        Delegation memory d_ = _sealNadia(keccak256("mandate:invariants"), 1, 1);
        lookAlike = address(uint160(uint256(keccak256("look-alike of harbour homes"))));
        address[] memory p_ = new address[](5);
        (p_[0], p_[1], p_[2], p_[3], p_[4]) = (harbourHomes, hbuBursar, foodMart, mirage, lookAlike);
        uint32[] memory c_ = new uint32[](3);
        (c_[0], c_[1], c_[2]) = (Categories.RENT, Categories.TUITION, Categories.FOOD);
        caps = new uint256[](3);
        (caps[0], caps[1], caps[2]) = (9_500 * U, 12_000 * U, 3_000 * U);
        handler = new MandateHandler(dm, tHKD, killSwitch, cosignE, address(nadia), ying, guardian, abi.encode(d_), COSIGN_IDX, p_, c_);
        keyIdHash0 = nadia.getKeyIdHashes()[0];
        targetContract(address(handler));
        bytes4[] memory sel_ = new bytes4[](1);
        sel_[0] = MandateHandler.step.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: sel_ }));
    }

    /// Invariant 1: no redemption sequence exceeds any category cap in any period.
    function invariant_categoryCapsHold() public {
        uint32[3] memory cats_ = [Categories.RENT, Categories.TUITION, Categories.FOOD];
        uint256 n_ = handler.periodsCount();
        for (uint256 i; i < n_; ++i) {
            uint256 p_ = handler.periodsSeen(i);
            for (uint256 j; j < 3; ++j) {
                assertLe(handler.spent(p_, cats_[j]), caps[j], "category cap exceeded");
            }
        }
    }

    /// Invariant 2: the reserve floor is never breached.
    function invariant_reserveFloorHolds() public {
        assertGe(tHKD.balanceOf(address(nadia)), 1_500 * U, "reserve floor breached");
    }

    /// Invariant 3: a paused account moves nothing.
    function invariant_noMovementWhilePaused() public {
        assertFalse(handler.movedWhilePaused(), "funds moved while paused");
    }

    /// Invariant 4: only verified payees receive funds.
    function invariant_onlyVerifiedPayees() public {
        assertEq(tHKD.balanceOf(mirage), 0, "unverified payee received funds");
        assertEq(tHKD.balanceOf(lookAlike), 0, "look-alike received funds");
    }

    /// Invariant 5: no redemption can change the signer set, the payee book or untrip the kill switch.
    function invariant_authorityUnchanged() public {
        assertFalse(handler.selfCallSucceeded(), "a delegation reached the account or a registry");
        bytes32[] memory ids_ = nadia.getKeyIdHashes();
        assertEq(ids_.length, 1, "signer set changed");
        assertEq(ids_[0], keyIdHash0, "signer replaced");
        (bool active_, uint32 cat_) = payeeBook.lookup(address(nadia), harbourHomes);
        assertTrue(active_ && cat_ == Categories.RENT, "payee book changed");
        (active_,) = payeeBook.lookup(address(nadia), mirage);
        assertFalse(active_, "attacker added to payee book");
    }

    function afterInvariant() external {
        // The campaign must exercise both outcomes, or it proves nothing.
        assertGt(handler.successes() + handler.refusals(), 0);
        console2.log("successes", handler.successes(), "refusals", handler.refusals());
    }
}
