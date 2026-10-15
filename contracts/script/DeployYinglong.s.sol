// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Script, console2 } from "forge-std/Script.sol";
import { EntryPoint } from "@account-abstraction/core/EntryPoint.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";
import { DelegationManager } from "@delegation-framework/DelegationManager.sol";
import { IDelegationManager } from "@delegation-framework/interfaces/IDelegationManager.sol";
import { HybridDeleGator } from "@delegation-framework/HybridDeleGator.sol";
import { MultiSigDeleGator } from "@delegation-framework/MultiSigDeleGator.sol";
import { SimpleFactory } from "@delegation-framework/utils/SimpleFactory.sol";
import { AllowedTargetsEnforcer } from "@delegation-framework/enforcers/AllowedTargetsEnforcer.sol";
import { AllowedMethodsEnforcer } from "@delegation-framework/enforcers/AllowedMethodsEnforcer.sol";
import { AllowedCalldataEnforcer } from "@delegation-framework/enforcers/AllowedCalldataEnforcer.sol";
import { ValueLteEnforcer } from "@delegation-framework/enforcers/ValueLteEnforcer.sol";
import { LimitedCallsEnforcer } from "@delegation-framework/enforcers/LimitedCallsEnforcer.sol";
import { TimestampEnforcer } from "@delegation-framework/enforcers/TimestampEnforcer.sol";
import { NonceEnforcer } from "@delegation-framework/enforcers/NonceEnforcer.sol";
import { RedeemerEnforcer } from "@delegation-framework/enforcers/RedeemerEnforcer.sol";
import { ERC20TransferAmountEnforcer } from "@delegation-framework/enforcers/ERC20TransferAmountEnforcer.sol";

import { PayeeBook } from "../src/registries/PayeeBook.sol";
import { MandateRegistry } from "../src/registries/MandateRegistry.sol";
import { KillSwitchRegistry } from "../src/registries/KillSwitchRegistry.sol";
import { YinglongPassportRegistry } from "../src/registries/YinglongPassportRegistry.sol";
import { AccountabilityLedger } from "../src/registries/AccountabilityLedger.sol";
import { MandateBindingEnforcer } from "../src/enforcers/MandateBindingEnforcer.sol";
import { ForbiddenTargetsEnforcer } from "../src/enforcers/ForbiddenTargetsEnforcer.sol";
import { AgentLineageEnforcer } from "../src/enforcers/AgentLineageEnforcer.sol";
import { VerifiedPayeeEnforcer } from "../src/enforcers/VerifiedPayeeEnforcer.sol";
import { CategoryBudgetEnforcer } from "../src/enforcers/CategoryBudgetEnforcer.sol";
import { ReserveFloorEnforcer } from "../src/enforcers/ReserveFloorEnforcer.sol";
import { VelocityEnforcer } from "../src/enforcers/VelocityEnforcer.sol";
import { SuitabilityEnforcer } from "../src/enforcers/SuitabilityEnforcer.sol";
import { JurisdictionEnforcer } from "../src/enforcers/JurisdictionEnforcer.sol";
import { GlobalPauseEnforcer } from "../src/enforcers/GlobalPauseEnforcer.sol";
import { ReputationGateEnforcer } from "../src/enforcers/ReputationGateEnforcer.sol";
import { CoSignEnforcer } from "../src/enforcers/CoSignEnforcer.sol";
import { VetoTimelockEnforcer } from "../src/enforcers/VetoTimelockEnforcer.sol";
import { TestUnits } from "../src/rails/TestUnits.sol";
import { ProductRegistry } from "../src/rails/ProductRegistry.sol";
import { TestMoneyMarketFund } from "../src/rails/TestMoneyMarketFund.sol";
import { ProtectedPayment } from "../src/rails/ProtectedPayment.sol";
import { SignedQuoteSettlement } from "../src/rails/SignedQuoteSettlement.sol";
import { ConditionalPaymentInstructions } from "../src/rails/ConditionalPaymentInstructions.sol";
import { YinglongCreate2Deployer } from "../src/utils/YinglongCreate2Deployer.sol";

/// @notice Deploys the full YINGLONG system to one ledger and writes deployments/<LEDGER_NAME>.json with
/// every address and its runtime code hash (the cross-ledger bytecode-equality evidence).
///
/// Environment:
///   DEPLOYER_PRIVATE_KEY  deployer key (testnet only; loaded by scripts/deploy.mjs, never printed)
///   LEDGER_NAME           anvil | base-sepolia | fisco | <exhibit>
///   FRAMEWORK_MODE        deploy   -> deploy EntryPoint v0.7, DelegationManager, DeleGator implementations
///                         existing -> use ENTRYPOINT, DELEGATION_MANAGER, HYBRID_IMPL, MULTISIG_IMPL, SIMPLE_FACTORY
///   SUPERVISOR, ANCHORER, CPI_OPERATOR  role addresses
contract DeployYinglong is Script {
    string internal json;
    string internal constant KEY = "deployment";

    address internal deployer;
    address internal supervisor;
    address internal anchorer;
    address internal cpiOperator;
    bytes32 internal salt;
    string internal ledger;

    function run() external {
        uint256 pk_ = vm.envUint("DEPLOYER_PRIVATE_KEY");
        deployer = vm.addr(pk_);
        ledger = vm.envString("LEDGER_NAME");
        string memory mode_ = vm.envString("FRAMEWORK_MODE");
        supervisor = vm.envAddress("SUPERVISOR");
        anchorer = vm.envAddress("ANCHORER");
        cpiOperator = vm.envAddress("CPI_OPERATOR");
        salt = keccak256(abi.encodePacked("YINGLONG-", ledger));

        vm.startBroadcast(pk_);
        _framework(mode_);
        _stockEnforcers();
        _registries();
        _enforcers();
        _rails();
        vm.stopBroadcast();

        vm.serializeString(KEY, "ledger", ledger);
        vm.serializeUint(KEY, "chainId", block.chainid);
        vm.serializeAddress(KEY, "deployer", deployer);
        vm.serializeBytes32(KEY, "domainSalt", salt);
        vm.serializeString(KEY, "frameworkMode", mode_);
        string memory out_ = vm.serializeUint(KEY, "deployedAtBlock", block.number);
        string memory path_ = string.concat("deployments/", ledger, ".json");
        vm.writeJson(out_, path_);
        console2.log("wrote", path_);
    }

    function _framework(string memory _mode) internal {
        address entryPoint_;
        address dm_;
        address hybrid_;
        address multisig_;
        address factory_;
        if (keccak256(bytes(_mode)) == keccak256("deploy")) {
            entryPoint_ = address(new EntryPoint());
            dm_ = address(new DelegationManager(supervisor));
            hybrid_ = address(new HybridDeleGator(IDelegationManager(dm_), IEntryPoint(entryPoint_)));
            multisig_ = address(new MultiSigDeleGator(IDelegationManager(dm_), IEntryPoint(entryPoint_)));
            factory_ = address(new SimpleFactory());
        } else {
            entryPoint_ = vm.envAddress("ENTRYPOINT");
            dm_ = vm.envAddress("DELEGATION_MANAGER");
            hybrid_ = vm.envAddress("HYBRID_IMPL");
            multisig_ = vm.envAddress("MULTISIG_IMPL");
            factory_ = vm.envAddress("SIMPLE_FACTORY");
            require(dm_.code.length > 0 && hybrid_.code.length > 0 && entryPoint_.code.length > 0, "framework missing");
        }
        _rec("EntryPoint", entryPoint_);
        _rec("DelegationManager", dm_);
        _rec("HybridDeleGatorImpl", hybrid_);
        _rec("MultiSigDeleGatorImpl", multisig_);
        _rec("SimpleFactory", factory_);
    }

    /// @dev Our own copies of the stock enforcers on every ledger, so every caveat runs identical bytecode.
    function _stockEnforcers() internal {
        _rec("AllowedTargetsEnforcer", address(new AllowedTargetsEnforcer()));
        _rec("AllowedMethodsEnforcer", address(new AllowedMethodsEnforcer()));
        _rec("AllowedCalldataEnforcer", address(new AllowedCalldataEnforcer()));
        _rec("ValueLteEnforcer", address(new ValueLteEnforcer()));
        _rec("LimitedCallsEnforcer", address(new LimitedCallsEnforcer()));
        _rec("TimestampEnforcer", address(new TimestampEnforcer()));
        _rec("NonceEnforcer", address(new NonceEnforcer()));
        _rec("RedeemerEnforcer", address(new RedeemerEnforcer()));
        _rec("ERC20TransferAmountEnforcer", address(new ERC20TransferAmountEnforcer()));
    }

    function _registries() internal returns (address killSwitch_) {
        killSwitch_ = address(new KillSwitchRegistry(supervisor, salt));
        _rec("KillSwitchRegistry", killSwitch_);
        _rec("PayeeBook", address(new PayeeBook()));
        _rec("MandateRegistry", address(new MandateRegistry(killSwitch_)));
        _rec("YinglongPassportRegistry", address(new YinglongPassportRegistry(supervisor, salt)));
        AccountabilityLedger ledgerC_ = new AccountabilityLedger(deployer);
        ledgerC_.setAnchorer(anchorer, true);
        ledgerC_.transferAdmin(supervisor);
        _rec("AccountabilityLedger", address(ledgerC_));
    }

    function _enforcers() internal {
        _rec("MandateBindingEnforcer", address(new MandateBindingEnforcer()));
        _rec("ForbiddenTargetsEnforcer", address(new ForbiddenTargetsEnforcer()));
        _rec("AgentLineageEnforcer", address(new AgentLineageEnforcer()));
        _rec("VerifiedPayeeEnforcer", address(new VerifiedPayeeEnforcer()));
        _rec("CategoryBudgetEnforcer", address(new CategoryBudgetEnforcer()));
        _rec("ReserveFloorEnforcer", address(new ReserveFloorEnforcer()));
        _rec("VelocityEnforcer", address(new VelocityEnforcer()));
        _rec("SuitabilityEnforcer", address(new SuitabilityEnforcer()));
        _rec("JurisdictionEnforcer", address(new JurisdictionEnforcer()));
        _rec("GlobalPauseEnforcer", address(new GlobalPauseEnforcer()));
        _rec("ReputationGateEnforcer", address(new ReputationGateEnforcer()));
        _rec("CoSignEnforcer", address(new CoSignEnforcer(salt)));
        _rec("VetoTimelockEnforcer", address(new VetoTimelockEnforcer(salt)));
    }

    function _rails() internal {
        TestUnits tHKD_ = new TestUnits(
            "Test HKD units", "tHKD", 1, "Test units. Simulation of a regulated HKD instrument; not issued by any licensee.", deployer, salt
        );
        _rec("TestHKD", address(tHKD_));
        _rec(
            "TestUSD",
            address(new TestUnits("Test USD units", "tUSD", 2, "Test units. International test rail; no monetary value.", deployer, salt))
        );
        ProductRegistry products_ = new ProductRegistry(deployer);
        _rec("ProductRegistry", address(products_));
        TestMoneyMarketFund low_ = new TestMoneyMarketFund("Test Money Market Fund (risk class 2)", "tMMF", address(tHKD_));
        TestMoneyMarketFund high_ = new TestMoneyMarketFund("Test Growth Fund (risk class 5)", "tGRW", address(tHKD_));
        products_.list(address(low_), 2, keccak256("Test Money Market Fund"));
        products_.list(address(high_), 5, keccak256("Test Growth Fund"));
        _rec("TestMoneyMarketFund", address(low_));
        _rec("TestGrowthFund", address(high_));
        _rec("ProtectedPayment", address(new ProtectedPayment()));
        _rec("SignedQuoteSettlement", address(new SignedQuoteSettlement(salt)));
        _rec("ConditionalPaymentInstructions", address(new ConditionalPaymentInstructions(cpiOperator)));
        _rec("YinglongCreate2Deployer", address(new YinglongCreate2Deployer()));
    }

    function _rec(string memory _name, address _a) internal {
        string memory obj_ = string.concat("c_", _name);
        vm.serializeAddress(obj_, "address", _a);
        string memory entry_ = vm.serializeBytes32(obj_, "codeHash", _a.codehash);
        vm.serializeString(KEY, _name, entry_);
    }
}
