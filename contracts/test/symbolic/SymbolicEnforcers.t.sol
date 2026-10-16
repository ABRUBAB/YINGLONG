// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import { ModeLib } from "@erc7579/lib/ModeLib.sol";
import { ModeCode, CallType, ExecType } from "@delegation-framework/utils/Types.sol";
import { CALLTYPE_SINGLE, EXECTYPE_DEFAULT } from "@delegation-framework/utils/Constants.sol";

import { PayeeBook } from "../../src/registries/PayeeBook.sol";
import { KillSwitchRegistry } from "../../src/registries/KillSwitchRegistry.sol";
import { TestUnits } from "../../src/rails/TestUnits.sol";
import { CategoryBudgetEnforcer } from "../../src/enforcers/CategoryBudgetEnforcer.sol";
import { ReserveFloorEnforcer } from "../../src/enforcers/ReserveFloorEnforcer.sol";
import { GlobalPauseEnforcer } from "../../src/enforcers/GlobalPauseEnforcer.sol";
import { VerifiedPayeeEnforcer } from "../../src/enforcers/VerifiedPayeeEnforcer.sol";
import { ForbiddenTargetsEnforcer } from "../../src/enforcers/ForbiddenTargetsEnforcer.sol";
import { Categories } from "../../src/utils/Categories.sol";

// Bounded symbolic checks (Halmos) of the enforcer logic behind invariants 1 to 5 of
// test/invariants/MandateInvariants.t.sol. Each check_ function calls one YINGLONG enforcer hook directly, with
// this contract in the role of the DelegationManager (enforcer state is keyed by msg.sender), and symbolic
// amounts, recipients, targets, timestamps and registry states. They do NOT execute the DelegationManager, the
// smart account or signature verification: the claim is "the enforcer refuses every bounded input that would
// break the property", which together with the framework's hook semantics gives the invariant.
//
// Run: halmos --root contracts --match-contract '^Sym' --function check_ --loop 4 (see docs/evidence/README_contracts.md).
// forge test compiles these contracts but does not run check_ functions.

abstract contract SymBase is Test {
    uint256 internal constant U = 1e6;
    address internal constant DELEGATOR = address(0xD00D);
    address internal constant REDEEMER = address(0xA9E7);

    function _mode() internal pure returns (ModeCode) {
        return ModeLib.encodeSimpleSingle();
    }

    function _transferExec(address _token, address _to, uint256 _amount) internal pure returns (bytes memory) {
        return abi.encodePacked(_token, uint256(0), abi.encodeWithSelector(bytes4(0xa9059cbb), _to, _amount));
    }
}

/// @notice Mock passport registry with directly settable answers (the registry's own logic is out of scope).
contract SymPassport {
    mapping(address => uint256) public agentIdOf;
    mapping(address => uint8) public statusOf;
    mapping(address => bool) public trusted;

    function set(address _wallet, uint256 _agentId, uint8 _status, bool _trusted) external {
        agentIdOf[_wallet] = _agentId;
        statusOf[_wallet] = _status;
        trusted[_wallet] = _trusted;
    }

    function walletInfo(address _wallet) external view returns (uint256, uint8, bytes32) {
        return (agentIdOf[_wallet], statusOf[_wallet], bytes32(0));
    }

    function isTrustedAgentWallet(address _wallet, address[] calldata) external view returns (bool) {
        return trusted[_wallet];
    }

    function erc8004IdOfWallet(address) external pure returns (uint256) {
        return 0;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Invariant 1: no redemption sequence exceeds any category cap in any period.

contract SymCategoryBudget is SymBase {
    CategoryBudgetEnforcer internal budget;
    PayeeBook internal book;
    address internal constant TOKEN = address(0x70CE);
    address internal constant RENT_PAYEE = address(0x1111);
    address internal constant FOOD_PAYEE = address(0x2222);
    address internal constant TUITION_PAYEE = address(0x3333); // listed, but TUITION has no cap in these terms
    bytes internal terms;

    // ghost: successful amounts per (category, period)
    mapping(uint32 => mapping(uint256 => uint256)) internal ghost;

    function setUp() public {
        budget = new CategoryBudgetEnforcer();
        book = new PayeeBook();
        vm.startPrank(DELEGATOR);
        book.setPayee(RENT_PAYEE, Categories.RENT, bytes32("rent"));
        book.setPayee(FOOD_PAYEE, Categories.FOOD, bytes32("food"));
        book.setPayee(TUITION_PAYEE, Categories.TUITION, bytes32("tuition"));
        vm.stopPrank();
        uint32[] memory cats_ = new uint32[](3);
        uint256[] memory caps_ = new uint256[](3);
        (cats_[0], caps_[0]) = (Categories.RENT, 9_500 * U);
        (cats_[1], caps_[1]) = (Categories.FOOD, 3_000 * U);
        (cats_[2], caps_[2]) = (Categories.SERVICES, 200 * U);
        terms = abi.encode(address(book), TOKEN, uint64(0), uint64(30 days), Categories.SERVICES, cats_, caps_);
    }

    function _capOf(uint32 _cat) internal pure returns (uint256) {
        if (_cat == Categories.RENT) return 9_500 * U;
        if (_cat == Categories.FOOD) return 3_000 * U;
        if (_cat == Categories.SERVICES) return 200 * U;
        return 0;
    }

    function _pay(address _to, uint256 _amount) internal {
        (bool active_, uint32 cat_) = book.lookup(DELEGATOR, _to);
        if (!active_) cat_ = Categories.SERVICES;
        uint256 period_ = block.timestamp / 30 days;
        (bool ok_,) = address(budget).call(
            abi.encodeCall(
                CategoryBudgetEnforcer.beforeHook, (terms, "", _mode(), _transferExec(TOKEN, _to, _amount), bytes32(0), DELEGATOR, REDEEMER)
            )
        );
        if (ok_) {
            ghost[cat_][period_] += _amount;
            // the cap of the payee's category (0 for a category without a cap) bounds everything spent in the period
            assert(ghost[cat_][period_] <= _capOf(cat_));
            assert(budget.spent(budget.spentKey(address(this), DELEGATOR, TOKEN, cat_, period_)) == ghost[cat_][period_]);
        }
    }

    /// Vacuity probe (a counterexample is EXPECTED): some symbolic payment passes the hook, so the cap check above
    /// is not vacuously true.
    function check_vacuity_budgetPaymentCanPass(address _to, uint256 _amount) public {
        (bool ok_,) = address(budget).call(
            abi.encodeCall(
                CategoryBudgetEnforcer.beforeHook, (terms, "", _mode(), _transferExec(TOKEN, _to, _amount), bytes32(0), DELEGATOR, REDEEMER)
            )
        );
        assert(!ok_);
    }

    /// Three payments to symbolic recipients, symbolic amounts, symbolic time between them.
    function check_categoryCapsHold(
        address _to1,
        uint256 _a1,
        address _to2,
        uint256 _a2,
        address _to3,
        uint256 _a3,
        uint32 _t0,
        uint32 _dt1,
        uint32 _dt2
    )
        public
    {
        vm.warp(uint256(_t0));
        _pay(_to1, _a1);
        vm.warp(block.timestamp + _dt1);
        _pay(_to2, _a2);
        vm.warp(block.timestamp + _dt2);
        _pay(_to3, _a3);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Invariant 2: the reserve floor is never breached.

contract SymReserveFloor is SymBase {
    ReserveFloorEnforcer internal floorE;
    TestUnits internal token;
    address internal constant PAYEE = address(0x2222);

    function setUp() public {
        floorE = new ReserveFloorEnforcer();
        token = new TestUnits("Test HKD units", "tHKD", 1, "Test units.", address(this), bytes32("sym"));
    }

    /// Symbolic start balance, payment and floor: afterAllHook passes only if the final balance is at least the floor.
    function check_reserveFloorHolds(uint256 _start, uint256 _amount, uint256 _floor) public {
        token.mint(DELEGATOR, _start);
        vm.prank(DELEGATOR);
        (bool paid_,) = address(token).call(abi.encodeWithSelector(bytes4(0xa9059cbb), PAYEE, _amount));
        bytes memory exec_ = _transferExec(address(token), PAYEE, _amount);
        (bool ok_,) = address(floorE).call(
            abi.encodeCall(
                ReserveFloorEnforcer.afterAllHook,
                (abi.encode(address(token), _floor), "", _mode(), exec_, bytes32(0), DELEGATOR, REDEEMER)
            )
        );
        uint256 after_ = token.balanceOf(DELEGATOR);
        assert(ok_ == (after_ >= _floor)); // refuses exactly the breaches
        if (paid_) assert(after_ == _start - _amount);
    }

    /// Vacuity probe (a counterexample is EXPECTED): the floor check passes for some symbolic state.
    function check_vacuity_floorCanPass(uint256 _balance, uint256 _floor) public {
        token.mint(DELEGATOR, _balance);
        (bool ok_,) = address(floorE).call(
            abi.encodeCall(
                ReserveFloorEnforcer.afterAllHook,
                (abi.encode(address(token), _floor), "", _mode(), "", bytes32(0), DELEGATOR, REDEEMER)
            )
        );
        assert(!ok_);
    }

    /// Every YINGLONG hook accepts only single-call, default-exec mode (try mode would let afterAllHook run after
    /// a failed execution; batch mode would let several payments share one floor check).
    function check_onlySingleDefaultMode(bytes32 _mode) public {
        (bool ok_,) = address(floorE).call(
            abi.encodeCall(
                ReserveFloorEnforcer.beforeHook,
                (abi.encode(address(token), uint256(0)), "", ModeCode.wrap(_mode), "", bytes32(0), DELEGATOR, REDEEMER)
            )
        );
        if (ok_) {
            (CallType ct_, ExecType et_,,) = ModeLib.decode(ModeCode.wrap(_mode));
            assert(CallType.unwrap(ct_) == CallType.unwrap(CALLTYPE_SINGLE));
            assert(ExecType.unwrap(et_) == ExecType.unwrap(EXECTYPE_DEFAULT));
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Invariant 3: a paused account moves nothing.

contract SymGlobalPause is SymBase {
    GlobalPauseEnforcer internal pauseE;
    KillSwitchRegistry internal ks;
    SymPassport internal passport;
    address internal constant SUPERVISOR = address(0x5E9E);
    address internal constant GUARDIAN = address(0x6A2D);

    function setUp() public {
        pauseE = new GlobalPauseEnforcer();
        ks = new KillSwitchRegistry(SUPERVISOR, bytes32("sym"));
        passport = new SymPassport();
    }

    /// Symbolic mix of pause actions (self trip, guardian trip, supervisor halt, dead-man timer, untrip), symbolic
    /// elapsed time and symbolic passport status: beforeAllHook never passes while the account is paused, the agent
    /// is halted or the redeemer's passport is not active.
    function check_pausedAccountRefused(
        uint8 _actions,
        uint64 _interval,
        uint32 _dt,
        uint256 _agentId,
        uint8 _status
    )
        public
    {
        vm.warp(1_000_000);
        if (_actions & 1 != 0) {
            vm.prank(DELEGATOR);
            ks.trip(DELEGATOR);
        }
        if (_actions & 2 != 0) {
            vm.prank(DELEGATOR);
            ks.setGuardian(GUARDIAN, true);
            vm.prank(GUARDIAN);
            ks.trip(DELEGATOR);
        }
        if (_actions & 4 != 0) {
            vm.prank(SUPERVISOR);
            ks.setAgentHalt(REDEEMER, true);
        }
        if (_actions & 8 != 0) {
            vm.prank(DELEGATOR);
            ks.setDeadman(_interval);
        }
        if (_actions & 16 != 0) {
            vm.prank(REDEEMER); // the agent tries to untrip: only its own entry is affected
            ks.untrip();
        }
        if (_actions & 32 != 0) {
            vm.prank(DELEGATOR);
            ks.untrip();
        }
        vm.warp(block.timestamp + _dt);
        passport.set(REDEEMER, _agentId, _status, false);

        bool paused_ = ks.isPaused(DELEGATOR, REDEEMER);
        (bool ok_,) = address(pauseE).call(
            abi.encodeCall(
                GlobalPauseEnforcer.beforeAllHook,
                (abi.encode(address(ks), address(passport)), "", _mode(), "", bytes32(0), DELEGATOR, REDEEMER)
            )
        );
        if (ok_) {
            assert(!paused_);
            assert(_agentId == 0 || _status == 1);
        }
        // only the account itself can clear its own trip
        if (_actions & 1 != 0 && _actions & 32 == 0) assert(ks.tripped(DELEGATOR));
    }

    /// Vacuity probe (a counterexample is EXPECTED): an unpaused account with an active passport passes.
    function check_vacuity_unpausedCanPass(uint256 _agentId, uint8 _status) public {
        passport.set(REDEEMER, _agentId, _status, false);
        (bool ok_,) = address(pauseE).call(
            abi.encodeCall(
                GlobalPauseEnforcer.beforeAllHook,
                (abi.encode(address(ks), address(passport)), "", _mode(), "", bytes32(0), DELEGATOR, REDEEMER)
            )
        );
        assert(!ok_);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Invariant 4: only verified payees receive funds.

contract SymVerifiedPayee is SymBase {
    VerifiedPayeeEnforcer internal payeeE;
    PayeeBook internal book;
    SymPassport internal passport;
    address internal constant TOKEN = address(0x70CE);
    address internal constant RENT_PAYEE = address(0x1111);
    address internal constant FOOD_PAYEE = address(0x2222);
    address internal constant SERVICE_AGENT = address(0x4444); // attested agent wallet
    address internal constant ESCROW = address(0xE5C0); // sealed intermediary
    bytes internal terms;

    function setUp() public {
        payeeE = new VerifiedPayeeEnforcer();
        book = new PayeeBook();
        passport = new SymPassport();
        passport.set(SERVICE_AGENT, 7, 1, true);
        vm.startPrank(DELEGATOR);
        book.setPayee(RENT_PAYEE, Categories.RENT, bytes32("rent"));
        book.setPayee(FOOD_PAYEE, Categories.FOOD, bytes32("food"));
        vm.stopPrank();
        address[] memory issuers_ = new address[](1);
        issuers_[0] = address(0x155E);
        address[] memory inter_ = new address[](1);
        inter_[0] = ESCROW;
        terms = abi.encode(address(book), address(passport), issuers_, inter_);
    }

    /// Symbolic payment shape (transfer, transferAndCall with a beneficiary word, transferAndCall without data,
    /// coin-free instruction), symbolic recipient, amount and beneficiary word, optional removal of a payee.
    function check_onlyVerifiedPayees(uint8 _shape, address _to, uint256 _amount, bytes32 _word, bool _removeRent) public {
        if (_removeRent) {
            vm.prank(DELEGATOR);
            book.removePayee(RENT_PAYEE);
        }
        bytes memory call_;
        address beneficiary_ = _to;
        uint8 shape_ = _shape % 4;
        if (shape_ == 0) {
            call_ = abi.encodeWithSelector(bytes4(0xa9059cbb), _to, _amount);
        } else if (shape_ == 1) {
            call_ = abi.encodeWithSelector(bytes4(0x4000aea0), _to, _amount, abi.encode(_word));
            beneficiary_ = address(uint160(uint256(_word)));
        } else if (shape_ == 2) {
            call_ = abi.encodeWithSelector(bytes4(0x4000aea0), _to, _amount, bytes(""));
        } else {
            call_ = abi.encodeWithSelector(
                bytes4(keccak256("instruct(address,uint256,bytes32,bytes32,uint64)")), _to, _amount, _word, _word, uint64(1)
            );
        }
        bytes memory exec_ = abi.encodePacked(TOKEN, uint256(0), call_);
        (bool ok_,) = address(payeeE).call(
            abi.encodeCall(VerifiedPayeeEnforcer.beforeHook, (terms, "", _mode(), exec_, bytes32(0), DELEGATOR, REDEEMER))
        );
        if (ok_) {
            (bool active_,) = book.lookup(DELEGATOR, beneficiary_);
            assert(active_ || passport.trusted(beneficiary_));
            assert(_to == beneficiary_ || _to == ESCROW);
            if (shape_ == 1) assert(uint256(_word) >> 160 == 0); // no dirty upper bits accepted
            if (_removeRent) assert(beneficiary_ != RENT_PAYEE);
        }
    }

    /// Vacuity probe (a counterexample is EXPECTED): some symbolic transfer passes the payee check.
    function check_vacuity_payeeCanPass(address _to, uint256 _amount) public {
        (bool ok_,) = address(payeeE).call(
            abi.encodeCall(
                VerifiedPayeeEnforcer.beforeHook, (terms, "", _mode(), _transferExec(TOKEN, _to, _amount), bytes32(0), DELEGATOR, REDEEMER)
            )
        );
        assert(!ok_);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Invariant 5: no redemption can reach the account itself, the DelegationManager or a protected registry
// (signer set, payee book, kill switch).

contract SymForbiddenTargets is SymBase {
    ForbiddenTargetsEnforcer internal forbiddenE;

    function setUp() public {
        forbiddenE = new ForbiddenTargetsEnforcer();
    }

    /// Symbolic target, delegator, forbidden list (4 entries) and call data.
    function check_forbiddenTargetsUnreachable(
        address _target,
        address _delegator,
        address _f0,
        address _f1,
        address _f2,
        address _f3,
        bytes4 _selector,
        uint256 _arg
    )
        public
    {
        bytes memory terms_ = abi.encodePacked(_f0, _f1, _f2, _f3);
        bytes memory exec_ = abi.encodePacked(_target, uint256(0), abi.encodeWithSelector(_selector, _arg));
        (bool ok_,) = address(forbiddenE).call(
            abi.encodeCall(ForbiddenTargetsEnforcer.beforeHook, (terms_, "", _mode(), exec_, bytes32(0), _delegator, REDEEMER))
        );
        if (ok_) {
            assert(_target != _delegator);
            assert(_target != address(this)); // the DelegationManager (msg.sender of the hook)
            assert(_target != _f0 && _target != _f1 && _target != _f2 && _target != _f3);
        }
    }

    /// Vacuity probe (a counterexample is EXPECTED): some symbolic target passes the forbidden-targets check.
    function check_vacuity_targetCanPass(address _target, address _f0, uint256 _arg) public {
        bytes memory exec_ = abi.encodePacked(_target, uint256(0), abi.encodeWithSelector(bytes4(0xa9059cbb), _arg));
        (bool ok_,) = address(forbiddenE).call(
            abi.encodeCall(
                ForbiddenTargetsEnforcer.beforeHook, (abi.encodePacked(_f0), "", _mode(), exec_, bytes32(0), DELEGATOR, REDEEMER)
            )
        );
        assert(!ok_);
    }
}
