import type { Address, Hex } from "viem";
import type { LedgerName } from "./ledgers";

export const CONTRACT_NAMES = [
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
] as const;

/** Deployed on some ledgers only (the ZK private-mandate stack). */
export const OPTIONAL_CONTRACT_NAMES = ["ZKRelationsLib", "ZKTranscriptLib", "HonkVerifier", "ZKVerifierRouter", "ZKMandateEnforcer"] as const;

export type ContractName = (typeof CONTRACT_NAMES)[number];
export type OptionalContractName = (typeof OPTIONAL_CONTRACT_NAMES)[number];

export interface DeployedContract {
  address: Address;
  codeHash: Hex;
}

export interface Deployment {
  ledger: LedgerName;
  chainId: number;
  deployer: Address;
  domainSalt: Hex;
  frameworkMode: "deploy" | "existing";
  deployedAtBlock: number;
  contracts: Record<ContractName, DeployedContract>;
  optional: Partial<Record<OptionalContractName, DeployedContract>>;
}

/** Normalise the flat JSON written by contracts/script/DeployYinglong.s.sol. */
export function parseDeployment(raw: Record<string, unknown>): Deployment {
  const contracts = {} as Record<ContractName, DeployedContract>;
  for (const name of CONTRACT_NAMES) {
    const v = raw[name];
    const obj = (typeof v === "string" ? JSON.parse(v) : v) as DeployedContract | undefined;
    if (!obj?.address) throw new Error(`deployment is missing ${name}`);
    contracts[name] = { address: obj.address, codeHash: obj.codeHash };
  }
  const optional: Partial<Record<OptionalContractName, DeployedContract>> = {};
  for (const name of OPTIONAL_CONTRACT_NAMES) {
    const v = raw[name] as DeployedContract | string | undefined;
    const obj = (typeof v === "string" ? JSON.parse(v) : v) as DeployedContract | undefined;
    if (obj?.address) optional[name] = { address: obj.address, codeHash: obj.codeHash };
  }
  return {
    optional,
    ledger: raw.ledger as LedgerName,
    chainId: Number(raw.chainId),
    deployer: raw.deployer as Address,
    domainSalt: raw.domainSalt as Hex,
    frameworkMode: raw.frameworkMode as "deploy" | "existing",
    deployedAtBlock: Number(raw.deployedAtBlock),
    contracts,
  };
}

/** Reverse map: address (lower-case) to contract name. */
export function nameByAddress(d: Deployment): Map<string, ContractName | OptionalContractName> {
  const m = new Map<string, ContractName | OptionalContractName>();
  for (const name of CONTRACT_NAMES) m.set(d.contracts[name].address.toLowerCase(), name);
  for (const [name, c] of Object.entries(d.optional ?? {})) if (c) m.set(c.address.toLowerCase(), name as OptionalContractName);
  return m;
}

export function addr(d: Deployment, name: ContractName): Address {
  return d.contracts[name].address;
}
