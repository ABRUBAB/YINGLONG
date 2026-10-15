"""Constants shared with contracts/src/utils/Categories.sol, JurisdictionEnforcer, MandateRegistry and
packages/mandate/src/constants.ts. Written out here independently; tests compare them with the golden files."""

from __future__ import annotations

CATEGORY_IDS: dict[str, int] = {
    "rent": 1,
    "food": 2,
    "tuition": 3,
    "transport": 4,
    "utilities": 5,
    "supplier": 6,
    "payroll": 7,
    "services": 8,
    "treasury": 9,
    "other": 10,
}
CATEGORY_NAMES: dict[int, str] = {v: k for k, v in CATEGORY_IDS.items()}

PROFILE_IDS: dict[str, int] = {"hk": 1, "international": 2, "mainland": 3}
PROFILE_NAMES: dict[int, str] = {v: k for k, v in PROFILE_IDS.items()}
PROFILE_LABELS: dict[str, str] = {
    "hk": "Hong Kong",
    "international": "International",
    "mainland": "Mainland China (coin-free rail)",
}

# 4-byte selectors: transfer(address,uint256), transferAndCall(address,uint256,bytes), instruct(...)
SELECTORS: dict[str, str] = {
    "transfer": "0xa9059cbb",
    "transferAndCall": "0x4000aea0",
    "instruct": "0xa755512d",
}
SELECTOR_NAMES: dict[str, str] = {v: k for k, v in SELECTORS.items()}

ROOT_AUTHORITY = "0x" + "ff" * 32

# MetaMask Delegation Framework v1.3.0, utils/Constants.sol
DELEGATION_TYPE = (
    "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)"
    "Caveat(address enforcer,bytes terms)"
)
CAVEAT_TYPE = "Caveat(address enforcer,bytes terms)"

# Order of CONTRACT_NAMES in packages/sdk/src/deployments.ts (it decides label precedence).
CONTRACT_NAMES: list[str] = [
    "EntryPoint",
    "DelegationManager",
    "HybridDeleGatorImpl",
    "MultiSigDeleGatorImpl",
    "SimpleFactory",
    "AllowedTargetsEnforcer",
    "AllowedMethodsEnforcer",
    "AllowedCalldataEnforcer",
    "ValueLteEnforcer",
    "LimitedCallsEnforcer",
    "TimestampEnforcer",
    "NonceEnforcer",
    "RedeemerEnforcer",
    "ERC20TransferAmountEnforcer",
    "KillSwitchRegistry",
    "PayeeBook",
    "MandateRegistry",
    "YinglongPassportRegistry",
    "AccountabilityLedger",
    "MandateBindingEnforcer",
    "ForbiddenTargetsEnforcer",
    "AgentLineageEnforcer",
    "VerifiedPayeeEnforcer",
    "CategoryBudgetEnforcer",
    "ReserveFloorEnforcer",
    "VelocityEnforcer",
    "SuitabilityEnforcer",
    "JurisdictionEnforcer",
    "GlobalPauseEnforcer",
    "ReputationGateEnforcer",
    "CoSignEnforcer",
    "VetoTimelockEnforcer",
    "TestHKD",
    "TestUSD",
    "ProductRegistry",
    "TestMoneyMarketFund",
    "TestGrowthFund",
    "ProtectedPayment",
    "SignedQuoteSettlement",
    "ConditionalPaymentInstructions",
    "YinglongCreate2Deployer",
]

# Deployment name -> ABI file name (abi/<name>.json).
ABI_OF_CONTRACT: dict[str, str] = {
    "HybridDeleGatorImpl": "HybridDeleGator",
    "MultiSigDeleGatorImpl": "MultiSigDeleGator",
    "TestHKD": "TestUnits",
    "TestUSD": "TestUnits",
    "TestGrowthFund": "TestMoneyMarketFund",
}

# Extra addresses no delegation may ever call, on top of the deployment's own protocol contracts.
EXTRA_FORBIDDEN: dict[str, list[str]] = {
    "base-sepolia": [
        "0x0000000071727De22E5E9d8BAf0edAc6f37da032",  # EntryPoint v0.7
        "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",  # EntryPoint v0.8
        "0x433709009B8330FDa32311DF1C2AFA402eD8D009",  # EntryPoint v0.9
        "0x31BE08D380A21fc740883c0BC434FcFc88740b58",  # Circle Paymaster v0.7
        "0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966",  # Circle Paymaster v0.8
        "0x8004A818BFB912233c491871b3d84c89A494BD9e",  # ERC-8004 IdentityRegistry
        "0x8004B663056A597Dffe9eCcC1965A193B7388713",  # ERC-8004 ReputationRegistry
    ],
}

# Display labels for protocol contracts (packages/mandate/src/names.ts PRETTY).
PRETTY: dict[str, str] = {
    "TestHKD": "tHKD",
    "TestUSD": "tUSD",
    "ProtectedPayment": "escrow (ProtectedPayment)",
    "SignedQuoteSettlement": "quote settlement",
    "ConditionalPaymentInstructions": "coin-free instructions",
    "TestMoneyMarketFund": "Test Money Market Fund",
    "TestGrowthFund": "Test Growth Fund",
}

# Receipt enums (packages/sdk/src/receipt.ts; stable codes shared with AccountabilityLedger.ReceiptLogged).
OUTCOMES = ["confirmed", "reverted", "rejected_policy", "awaiting_approval", "expired", "unknown", "asked"]
TIERS = ["T0", "T1", "T2", "T3", "T4", "ASK"]
SOURCES = ["live-base", "live-fisco", "anvil-bench"]
