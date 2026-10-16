import { keccak256, stringToBytes, type Hex } from "viem";
import { docHash, receiptDomain, receiptHash, ZERO32, type Outcome, type Receipt, type ReceiptSource, type Tier } from "@yinglong/sdk";
import type { DecodedRevert, LedgerName } from "@yinglong/sdk";
import { ledgerContext } from "./chain/ledger";
import { DATA_DIR, JsonlLog } from "./store";
import { statSync } from "node:fs";
import { resolve } from "node:path";

export interface ReceiptRecord {
  receipt: Receipt;
  receiptHash: Hex;
  principal: string;
  ledger: LedgerName;
  proposalId?: string;
  payment?: { symbol: string; decimals: number; amount: string; payeeLabel: string; payee: string; method: string };
  explanation: { text: string; aiGenerated: boolean; model?: string };
  aigc: { label: "AI-generated"; model: string; provider: string; contentId: Hex };
  revertError?: DecodedRevert;
  explorerUrl?: string;
  documents: Record<string, unknown>;
  createdAt: string;
}

export const receiptLog = new JsonlLog<ReceiptRecord>(resolve(DATA_DIR, "receipts.jsonl"));

const SOURCE: Record<LedgerName, ReceiptSource> = { "base-sepolia": "live-base", fisco: "live-fisco", anvil: "anvil-bench" };

// The chain's predecessor is the last receipt in the file. It is cached, but re-read whenever the file changed
// size since this process last wrote (another process, such as a script on the same data directory, appended).
let lastHash: Hex | undefined;
let knownSize = -1;
function fileSize(): number {
  try {
    return statSync(receiptLog.file).size;
  } catch {
    return 0;
  }
}
function prevHash(): Hex {
  if (lastHash && fileSize() === knownSize) return lastHash;
  const all = receiptLog.all();
  lastHash = all.length ? all[all.length - 1]!.receiptHash : ZERO32;
  return lastHash;
}

/**
 * Write one accountability receipt. Off-chain documents are committed by hash; the receipt hash (EIP-712
 * under the AccountabilityLedger domain of the action's ledger) chains to the previous receipt and is later
 * anchored in a Merkle batch on both ledgers by apps/indexer.
 */
export function recordReceipt(args: {
  principal: string;
  ledger: LedgerName;
  proposalId?: string;
  agentId: bigint;
  mandateHash: Hex;
  delegationHash: Hex;
  tier: Tier;
  outcome: Outcome;
  txHash?: Hex;
  approvalSig?: Hex;
  documents: {
    intent?: unknown;
    plan?: unknown;
    policy?: unknown;
    stateReads?: unknown;
    counterparty?: unknown;
    simulation?: unknown;
  };
  explanation: { text: string; aiGenerated: boolean; model?: string };
  aigc: { model: string; provider: string };
  payment?: ReceiptRecord["payment"];
  revertError?: DecodedRevert;
}): ReceiptRecord {
  const ctx = ledgerContext(args.ledger);
  const ts = BigInt(Math.floor(Date.now() / 1000));
  const h = (v: unknown) => (v === undefined ? ZERO32 : docHash(v));
  const aigcBlock = { label: "AI-generated", model: args.aigc.model, provider: args.aigc.provider };
  const receipt: Receipt = {
    receiptId: keccak256(stringToBytes(`${args.principal}:${args.proposalId ?? ""}:${ts}:${Math.random()}`)),
    chainId: ctx.profile.chainId,
    agentId: args.agentId,
    mandateHash: args.mandateHash,
    delegationHash: args.delegationHash,
    intentHash: h(args.documents.intent),
    planHash: h(args.documents.plan),
    policyDecisionHash: h(args.documents.policy),
    stateReadsHash: h(args.documents.stateReads),
    counterpartyCheckHash: h(args.documents.counterparty),
    simulationHash: h(args.documents.simulation),
    tier: args.tier,
    approvalSigHash: args.approvalSig ? keccak256(args.approvalSig) : ZERO32,
    txHash: args.txHash ?? ZERO32,
    outcome: args.outcome,
    explanationHash: docHash(args.explanation),
    aigcHash: docHash(aigcBlock),
    source: SOURCE[args.ledger],
    prevReceiptHash: prevHash(),
    timestamp: ts,
  };
  const rh = receiptHash(receipt, receiptDomain(ctx.addr("AccountabilityLedger"), ctx.profile.chainId, ctx.deployment.domainSalt));
  const rec: ReceiptRecord = {
    receipt,
    receiptHash: rh,
    principal: args.principal,
    ledger: args.ledger,
    proposalId: args.proposalId,
    payment: args.payment,
    explanation: args.explanation,
    aigc: { label: "AI-generated", model: args.aigc.model, provider: args.aigc.provider, contentId: receipt.aigcHash },
    revertError: args.revertError,
    explorerUrl: args.txHash ? ctx.explorerTx(args.txHash) : undefined,
    documents: args.documents as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  };
  receiptLog.append(rec);
  lastHash = rh;
  knownSize = fileSize();
  return rec;
}
