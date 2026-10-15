import { hashTypedData, keccak256, stringToBytes, type Address, type Hex } from "viem";

/** Outcome codes (stable; shared with the AccountabilityLedger `ReceiptLogged.outcome` field). */
export const OUTCOMES = ["confirmed", "reverted", "rejected_policy", "awaiting_approval", "expired", "unknown", "asked"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const TIERS = ["T0", "T1", "T2", "T3", "T4", "ASK"] as const;
export type Tier = (typeof TIERS)[number];

export const SOURCES = ["live-base", "live-fisco", "anvil-bench"] as const;
export type ReceiptSource = (typeof SOURCES)[number];

/**
 * Accountability receipt (plan section 9.8). Every action, allowed or refused, produces one. Off-chain
 * documents (intent, plan, policy decision, state reads, counterparty check, simulation, explanation, AIGC
 * block) are committed by hash; the receipt hash is a Merkle leaf anchored on both ledgers.
 */
export interface Receipt {
  receiptId: Hex;
  chainId: number;
  agentId: bigint;
  mandateHash: Hex;
  delegationHash: Hex;
  intentHash: Hex;
  planHash: Hex;
  policyDecisionHash: Hex;
  stateReadsHash: Hex;
  counterpartyCheckHash: Hex;
  simulationHash: Hex;
  tier: Tier;
  approvalSigHash: Hex;
  txHash: Hex;
  outcome: Outcome;
  explanationHash: Hex;
  aigcHash: Hex;
  source: ReceiptSource;
  prevReceiptHash: Hex;
  timestamp: bigint;
}

export const RECEIPT_TYPES = {
  Receipt: [
    { name: "receiptId", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "agentId", type: "uint256" },
    { name: "mandateHash", type: "bytes32" },
    { name: "delegationHash", type: "bytes32" },
    { name: "intentHash", type: "bytes32" },
    { name: "planHash", type: "bytes32" },
    { name: "policyDecisionHash", type: "bytes32" },
    { name: "stateReadsHash", type: "bytes32" },
    { name: "counterpartyCheckHash", type: "bytes32" },
    { name: "simulationHash", type: "bytes32" },
    { name: "tier", type: "uint8" },
    { name: "approvalSigHash", type: "bytes32" },
    { name: "txHash", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "explanationHash", type: "bytes32" },
    { name: "aigcHash", type: "bytes32" },
    { name: "source", type: "uint8" },
    { name: "prevReceiptHash", type: "bytes32" },
    { name: "timestamp", type: "uint64" },
  ],
} as const;

export const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

export function receiptDomain(ledgerContract: Address, chainId: number, salt: Hex) {
  return { name: "YINGLONG Accountability Ledger", version: "1", chainId, verifyingContract: ledgerContract, salt } as const;
}

/** EIP-712 receipt hash (the Merkle leaf). The domain is the anchoring ledger's AccountabilityLedger. */
export function receiptHash(r: Receipt, domain: ReturnType<typeof receiptDomain>): Hex {
  return hashTypedData({
    domain,
    types: RECEIPT_TYPES,
    primaryType: "Receipt",
    message: {
      ...r,
      chainId: BigInt(r.chainId),
      tier: TIERS.indexOf(r.tier),
      outcome: OUTCOMES.indexOf(r.outcome),
      source: SOURCES.indexOf(r.source),
    },
  });
}

/** Hash of any off-chain JSON document committed by a receipt. */
export function docHash(doc: unknown): Hex {
  return keccak256(stringToBytes(JSON.stringify(doc, (_, v) => (typeof v === "bigint" ? v.toString() : v))));
}
