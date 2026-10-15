// Normalising receipts from two sources (the agent API and a JSONL file) into the Merkle leaf each one
// contributes. A receipt's leaf is its EIP-712 hash under the AccountabilityLedger domain of the ledger the
// action happened on (receipt.source), so the indexer recomputes it exactly as apps/agent did and verifies
// any receiptHash the API already carried.
import { readFileSync } from "node:fs";
import {
  receiptDomain,
  receiptHash,
  type LedgerName,
  type Outcome,
  type Receipt,
  type ReceiptSource,
  type Tier,
} from "@yinglong/sdk";
import { loadDeployment } from "@yinglong/sdk/server";
import type { Hex } from "viem";

export const SOURCE_TO_LEDGER: Record<ReceiptSource, LedgerName> = {
  "live-base": "base-sepolia",
  "live-fisco": "fisco",
  "anvil-bench": "anvil",
};

export interface IncomingReceipt {
  receipt: Receipt;
  receiptHash: Hex;
  principal?: string;
  ledger: LedgerName;
}

const depCache = new Map<LedgerName, ReturnType<typeof loadDeployment>>();
function deployment(ledger: LedgerName) {
  let d = depCache.get(ledger);
  if (!d) {
    d = loadDeployment(ledger);
    depCache.set(ledger, d);
  }
  return d;
}

/** Parse one receipt JSON object (bigint fields as decimal strings) into a typed Receipt. */
export function parseReceipt(raw: Record<string, unknown>): Receipt {
  const s = (k: string) => raw[k] as Hex;
  return {
    receiptId: s("receiptId"),
    chainId: Number(raw.chainId),
    agentId: BigInt(raw.agentId as string | number),
    mandateHash: s("mandateHash"),
    delegationHash: s("delegationHash"),
    intentHash: s("intentHash"),
    planHash: s("planHash"),
    policyDecisionHash: s("policyDecisionHash"),
    stateReadsHash: s("stateReadsHash"),
    counterpartyCheckHash: s("counterpartyCheckHash"),
    simulationHash: s("simulationHash"),
    tier: raw.tier as Tier,
    approvalSigHash: s("approvalSigHash"),
    txHash: s("txHash"),
    outcome: raw.outcome as Outcome,
    explanationHash: s("explanationHash"),
    aigcHash: s("aigcHash"),
    source: raw.source as ReceiptSource,
    prevReceiptHash: s("prevReceiptHash"),
    timestamp: BigInt(raw.timestamp as string | number),
  };
}

/** The Merkle leaf for a receipt: EIP-712 hash under its ledger's AccountabilityLedger domain. */
export function leafOf(receipt: Receipt): Hex {
  const ledger = SOURCE_TO_LEDGER[receipt.source];
  const d = deployment(ledger);
  return receiptHash(receipt, receiptDomain(d.contracts.AccountabilityLedger.address, d.chainId, d.domainSalt));
}

export function normalise(raw: Record<string, unknown>): IncomingReceipt {
  // The agent API nests the full receipt under `receipt` and carries a precomputed `receiptHash`.
  const receipt = parseReceipt((raw.receipt as Record<string, unknown>) ?? raw);
  const computed = leafOf(receipt);
  const provided = (raw.receiptHash as Hex | undefined)?.toLowerCase();
  if (provided && provided !== computed.toLowerCase()) {
    process.stderr.write(`[indexer] receipt ${receipt.receiptId} hash mismatch (provided ${provided} != computed ${computed}); using computed\n`);
  }
  return { receipt, receiptHash: computed, principal: raw.principal as string | undefined, ledger: SOURCE_TO_LEDGER[receipt.source] };
}

/** Read receipts from a JSONL file (each line a receipt or an agent-API receiptView), from offset `since`. */
export function readReceiptsFile(path: string, since = 0): IncomingReceipt[] {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  return lines.slice(since).map((l) => normalise(JSON.parse(l) as Record<string, unknown>));
}

/** Pull receipts from the agent API: GET <base>/v1/receipts?since=<n>. */
export async function fetchReceiptsApi(baseUrl: string, since: number, principal?: string): Promise<IncomingReceipt[]> {
  const url = new URL("/v1/receipts", baseUrl);
  url.searchParams.set("since", String(since));
  if (principal) url.searchParams.set("principal", principal);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`agent API ${url.pathname} returned HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  const rows = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? []);
  return (rows as Record<string, unknown>[]).map(normalise);
}
