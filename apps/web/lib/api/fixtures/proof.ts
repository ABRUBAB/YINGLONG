/**
 * The sample proof bundle (NEXT_PUBLIC_DATA_MODE=fixtures only). The ML and bench parts are a copy of
 * the real result files (./proof-data.ts); the chain and transaction parts are built from the sample
 * ledger (./data.ts) with keccak-of-a-label hashes (./util.ts), so no sample value can be mistaken for
 * evidence. It passes through the same wire schema and mapper as a live response.
 */
import { WireProofBundle } from "../types";
import { mapProof } from "../proof";
import type { ProofBundle } from "../view";
import { PROOF_DATA_SAMPLE } from "./proof-data";
import { receipts } from "./data";
import { addr, at, h, NOW } from "./util";

/** The contract names of the real deployment (contracts/deployments/*.json), enforcers and framework alike. */
const NAMES = [
  "AccountabilityLedger",
  "AgentLineageEnforcer",
  "AllowedCalldataEnforcer",
  "AllowedMethodsEnforcer",
  "AllowedTargetsEnforcer",
  "CategoryBudgetEnforcer",
  "CoSignEnforcer",
  "ConditionalPaymentInstructions",
  "DelegationManager",
  "ERC20TransferAmountEnforcer",
  "EntryPoint",
  "ForbiddenTargetsEnforcer",
  "GlobalPauseEnforcer",
  "HonkVerifier",
  "HybridDeleGatorImpl",
  "JurisdictionEnforcer",
  "KillSwitchRegistry",
  "LimitedCallsEnforcer",
  "MandateBindingEnforcer",
  "MandateRegistry",
  "MultiSigDeleGatorImpl",
  "NonceEnforcer",
  "PayeeBook",
  "ProductRegistry",
  "ProtectedPayment",
  "RedeemerEnforcer",
  "ReputationGateEnforcer",
  "ReserveFloorEnforcer",
  "SignedQuoteSettlement",
  "SimpleFactory",
  "SuitabilityEnforcer",
  "TestGrowthFund",
  "TestHKD",
  "TestMoneyMarketFund",
  "TestUSD",
  "TimestampEnforcer",
  "ValueLteEnforcer",
  "VelocityEnforcer",
  "VerifiedPayeeEnforcer",
  "VetoTimelockEnforcer",
  "YinglongCreate2Deployer",
  "YinglongPassportRegistry",
  "ZKMandateEnforcer",
  "ZKRelationsLib",
  "ZKTranscriptLib",
  "ZKVerifierRouter",
];

/** In the sample, the framework contracts with chain-specific constructor values carry different hashes. */
const DIFFER = new Set(["DelegationManager", "EntryPoint", "HybridDeleGatorImpl", "MultiSigDeleGatorImpl", "SimpleFactory", "TestHKD", "TestUSD", "YinglongCreate2Deployer"]);

const LEDGERS = [
  { ledger: "fisco", label: "FISCO BCOS 3.17.1 (consortium ledger)", chainId: 20200, explorer: null as null | ((a: string) => string) },
  { ledger: "base-sepolia", label: "Base Sepolia (public testnet)", chainId: 84532, explorer: (a: string) => `https://sepolia.basescan.org/address/${a}` },
];

function contractsOf(l: (typeof LEDGERS)[number]) {
  return NAMES.map((name) => {
    const address = addr(`${l.ledger}:${name}`);
    return { name, address, codeHash: h(`code:${DIFFER.has(name) ? `${l.ledger}:` : ""}${name}`), explorerUrl: l.explorer ? l.explorer(address) : null };
  });
}

let cached: ProofBundle | null = null;

export function sampleProof(): ProofBundle {
  if (cached) return cached;
  const onLedger = receipts.filter((r) => r.ledger !== "anvil-bench");
  const counts: Record<string, Record<string, number>> = {};
  for (const r of onLedger) {
    const by = (counts[r.ledger] ??= {});
    by[r.outcome] = (by[r.outcome] ?? 0) + 1;
  }
  const latest = onLedger
    .filter((r) => r.txHash)
    .slice(0, 12)
    .map((r) => ({
      receiptId: r.receiptId,
      ledger: r.ledger,
      outcome: r.outcome,
      tier: r.tier,
      title: r.summary,
      txHash: r.txHash,
      explorerUrl: r.explorerUrl ?? null,
      revertError: r.revertError,
      at: r.timestamp,
      auditUrl: `/v1/receipts/${r.receiptId}/audit`,
    }));
  const wire = WireProofBundle.parse({
    schema: "yinglong.proof/1",
    generatedAt: at(new Date(NOW).toISOString()),
    build: { repo: "https://github.com/ABRUBAB/YINGLONG", commit: "sample", commitUrl: null },
    service: { startedAt: at(new Date(NOW - (3 * 86_400 + 4 * 3_600 + 12 * 60) * 1000).toISOString()), uptimeSeconds: 3 * 86_400 + 4 * 3_600 + 12 * 60, health: "/v1/health", evidence: "/v1/evidence" },
    chain: {
      ledgers: LEDGERS.map((l) => {
        const contracts = contractsOf(l);
        return { ledger: l.ledger, label: l.label, chainId: l.chainId, contractCount: contracts.length, contracts };
      }),
      bytecode: { compared: NAMES.length, identical: NAMES.length - DIFFER.size, differ: [...DIFFER] },
    },
    transactions: { counts, latest },
    ml: PROOF_DATA_SAMPLE.ml,
    bench: PROOF_DATA_SAMPLE.bench,
    sources: { results: PROOF_DATA_SAMPLE.sources, resultsGeneratedAt: PROOF_DATA_SAMPLE.generatedAt },
  });
  cached = mapProof(wire, "fixtures");
  return cached;
}

/** What the sample "Try it live" answers: the same shape as the service's GET /v1/health, labelled. */
export const SAMPLE_HEALTH_BODY = {
  ok: true,
  version: "sample",
  ledgers: [
    { name: "base-sepolia", chainId: 84532, block: "31884517", badge: "Base Sepolia (testnet)", ok: true },
    { name: "fisco", chainId: 20200, block: "1204639", badge: "FISCO BCOS (consortium)", ok: true },
  ],
  models: { intent: { provider: "sample", model: "qwen3.5-9b-instruct-q4 (sample)" }, sentinel: { model: "mmBERT-base sentinel (sample)" } },
  note: "Sample data: no service was contacted.",
};
