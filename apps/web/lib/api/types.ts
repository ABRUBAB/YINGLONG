/**
 * YINGLONG agent service API: the wire contract (zod). The live adapter (./live.ts) parses every
 * response with these schemas and maps it to the front-end view model (./view.ts). Endpoints,
 * examples and the additions the front end requests are documented in docs/api/AGENT_API.md.
 *
 * Conventions (agreed with the agent service)
 * - Base URL: NEXT_PUBLIC_AGENT_API (default https://api.yinglong-agent.tech); JSON everywhere.
 * - Amounts: base-unit integer strings with `decimals` alongside (never floats).
 * - Hashes and addresses: 0x hex. Times: ISO 8601 strings, plus raw ledger values where useful.
 * - Fields marked "requested addition" are not in the first version of the service; the adapter
 *   treats them as optional and degrades honestly when they are absent.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ primitives */

export const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte 0x hex string");
export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte 0x address");
export const HexData = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/, "expected 0x hex bytes");
export const UInt = z.string().regex(/^(0|[1-9]\d*)$/, "expected an unsigned integer string");
/** Integer that may arrive as a JSON number or a decimal string (block numbers, ledger timestamps). */
export const IntLike = z.union([z.number().int(), UInt]);
export const Time = z.string().min(1);

export const WireLedger = z.enum(["base-sepolia", "fisco", "anvil"]);
export type WireLedger = z.infer<typeof WireLedger>;
export const WireJurisdiction = z.enum(["hk", "international", "mainland"]);
export const WireTier = z.enum(["T0", "T1", "T2", "T3", "T4", "ASK"]);
export const WireSource = z.enum(["live-base", "live-fisco", "anvil-bench"]);

/* ------------------------------------------------------------------ GET /v1/health */

export const WireHealth = z.object({
  ok: z.boolean(),
  version: z.string(),
  ledgers: z.array(
    z.object({ name: WireLedger, chainId: z.number().int().nullish(), block: IntLike.nullish(), badge: z.string().nullish(), ok: z.boolean().optional(), error: z.string().nullish() }),
  ),
  /** Free-form model status (intent: {provider, model} or {openrouter, llama, models[]}; sentinel: {model} or {url}). */
  models: z.record(z.string(), z.unknown()),
});
export type WireHealth = z.infer<typeof WireHealth>;

/* ------------------------------------------------------------------ principals */

export const WirePrincipal = z.object({
  id: z.string(),
  kind: z.enum(["person", "company"]),
  name: z.string(),
  account: Address,
  did: z.string(),
  ledger: WireLedger,
  ledgerBadge: z.string().nullish(),
  jurisdiction: WireJurisdiction,
  signer: z.string(),
  agent: z.object({
    label: z.string(),
    wallet: Address,
    agentId: z.union([z.string(), z.number()]).transform(String),
    passportStatus: z.enum(["active", "halted", "revoked"]),
    identityCode: z.string(),
  }),
  paused: z.boolean(),
  /** Requested addition: credential ids (base64url) registered on the account, for allowCredentials. */
  passkeyIds: z.array(z.string()).optional(),
});
export type WirePrincipal = z.infer<typeof WirePrincipal>;

export const WireHashRing = z.object({
  ticks: z.array(z.object({ i: z.number(), nibble: z.number(), angleDeg: z.number(), r0: z.number(), r1: z.number() })),
  arcs: z.array(z.object({ j: z.number(), startDeg: z.number(), sweepDeg: z.number(), r: z.number() })),
});
export type WireHashRing = z.infer<typeof WireHashRing>;

export const WireRoundTrip = z.object({
  ok: z.boolean(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().nullish() })),
  sentences: z.array(z.string()).nullish(),
  delegationHash: Hex32.nullish(),
});

export const WireRule = z.object({
  enforcer: z.string(),
  kind: z.string(),
  sentence: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export type WireRule = z.infer<typeof WireRule>;

export const WireMandateView = z.object({
  mandateHash: Hex32,
  delegationHash: Hex32,
  lineageId: z.string(),
  version: z.number().int().nullish(),
  status: z.enum(["live", "superseded", "revoked"]).nullish(),
  jurisdiction: WireJurisdiction,
  validFrom: z.union([Time, z.number()]),
  validUntil: z.union([Time, z.number()]),
  publishTx: Hex32.nullish(),
  explorerUrl: z.string().nullish(),
  ledger: WireLedger,
  /** Decoded from the on-chain caveats. */
  sentences: z.array(z.string()),
  /** What the user said. */
  userSentences: z.array(z.string()),
  rules: z.array(WireRule),
  roundTrip: WireRoundTrip,
  hashRing: WireHashRing,
  sealedBy: z.string().nullish(),
  sealedAt: z.union([Time, z.number()]).nullish(),
});
export type WireMandateView = z.infer<typeof WireMandateView>;

export const WireBalance = z.object({ symbol: z.string(), address: Address.nullish(), decimals: z.number().int(), amount: UInt });

export const WirePrincipalState = z.object({
  principal: WirePrincipal,
  balances: z.array(WireBalance),
  mandate: WireMandateView.nullable(),
  budgets: z.array(
    z.object({
      symbol: z.string(),
      decimals: z.number().int().nullish(),
      category: z.string(),
      cap: UInt,
      spent: UInt,
      periodLengthSeconds: IntLike,
      periodEndsAt: z.union([Time, z.number()]).nullish(),
    }),
  ),
  tiers: z.array(
    z.object({
      symbol: z.string(),
      defaultT1Cap: UInt,
      newPayeeT1Cap: UInt,
      t2Ceiling: UInt,
      categoryT1Caps: z.array(z.object({ category: z.string(), amount: UInt })),
    }),
  ),
  reserveFloors: z.array(z.object({ symbol: z.string(), amount: UInt })),
  velocity: z
    .object({
      symbol: z.string(),
      windowSeconds: IntLike,
      maxCount: IntLike,
      maxOutflow: UInt,
      count: IntLike.nullish(),
      outflow: UInt.nullish(),
    })
    .nullable(),
  payees: z.array(z.object({ id: z.string(), label: z.string(), address: Address, category: z.string().nullish() })),
  paused: z.boolean(),
  block: IntLike.nullish(),
});
export type WirePrincipalState = z.infer<typeof WirePrincipalState>;

/* ------------------------------------------------------------------ proposals */

export const WirePayment = z.object({
  symbol: z.string(),
  decimals: z.number().int(),
  amount: UInt,
  /** Either an object or a bare address with payeeLabel alongside. */
  payee: z.union([z.object({ id: z.string().nullish(), label: z.string(), address: Address.nullish() }), Address]),
  payeeLabel: z.string().nullish(),
  method: z.string(),
});
export type WirePayment = z.infer<typeof WirePayment>;

export const WireExplanation = z.object({ text: z.string(), aiGenerated: z.boolean(), model: z.string().nullish() });

export const WireProposal = z.object({
  id: z.string(),
  principal: z.string(),
  request: z.string(),
  intent: z.unknown(),
  language: z.string().nullish(),
  plan: z.array(z.object({ step: z.union([z.number(), z.string()]), description: z.string() })),
  tier: WireTier,
  decision: z.enum(["execute", "needs_approval", "refused", "ask", "answered"]),
  status: z.string().nullish(),
  answer: z.object({ kind: z.string().nullish(), text: z.string() }).nullish(),
  receiptIds: z.array(z.string()).nullish(),
  understanding: z.object({ via: z.string().nullish(), model: z.string().nullish(), provider: z.string().nullish() }).nullish(),
  scales: z.array(
    z.object({
      n: z.number().int().min(1).max(9),
      name: z.string(),
      status: z.enum(["passed", "stopped", "escalated", "skipped"]),
      reason: z.string().nullish(),
      typedError: z.string().nullish(),
      model: z.string().nullish(),
    }),
  ),
  explanation: WireExplanation,
  payment: WirePayment.nullish(),
  simulation: z.object({ ok: z.boolean(), revert: z.unknown().nullish(), block: IntLike.nullish() }).nullish(),
  approvalId: z.string().nullish(),
  createdAt: Time,
  /** Present with autoExecute when a T1 decision was executed in the same call. */
  receipt: z.lazy(() => WireReceipt).nullish(),
});
export type WireProposal = z.infer<typeof WireProposal>;

/* ------------------------------------------------------------------ receipts */

export const WireRevertError = z.object({ name: z.string(), args: z.unknown().nullish(), message: z.string().nullish(), raw: z.string().nullish() });

export const WireReceipt = z.object({
  receiptId: z.string(),
  principal: z.string(),
  ledger: WireLedger,
  ledgerBadge: z.string().nullish(),
  chainId: z.number().int(),
  source: WireSource,
  tier: WireTier,
  outcome: z.enum(["confirmed", "reverted", "rejected_policy", "awaiting_approval", "expired", "unknown", "asked"]),
  txHash: Hex32.nullish(),
  explorerUrl: z.string().nullish(),
  revertError: WireRevertError.nullish(),
  mandateHash: Hex32,
  delegationHash: Hex32,
  intentHash: Hex32,
  agentId: z.union([z.string(), z.number()]).transform(String),
  payment: WirePayment.nullish(),
  explanation: WireExplanation,
  aigc: z.object({ label: z.literal("AI-generated"), model: z.string(), provider: z.string().nullish() }),
  prevReceiptHash: Hex32,
  receiptHash: Hex32,
  timestamp: Time,
  anchor: z
    .object({
      batchId: z.union([z.string(), z.number()]).transform(String),
      root: Hex32,
      base: z.object({ txHash: Hex32, explorerUrl: z.string().nullish() }).nullish(),
      fisco: z.object({ txHash: Hex32 }).nullish(),
    })
    .nullish(),
  /** Merkle siblings from the receipt leaf (receiptHash) to anchor.root. */
  proof: z.array(Hex32).nullish(),
  /** Requested addition: "sorted" (OpenZeppelin commutative pair hashing) or per-level positions. */
  proofPairing: z.enum(["sorted", "positional"]).nullish(),
  proofPositions: z.array(z.enum(["left", "right"])).nullish(),
});
export type WireReceipt = z.infer<typeof WireReceipt>;

/* ------------------------------------------------------------------ approvals and signatures */

export const WireTypedData = z.object({
  domain: z.record(z.string(), z.unknown()),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});
export type WireTypedData = z.infer<typeof WireTypedData>;

export const WireApproval = z.object({
  id: z.string(),
  principal: z.string(),
  proposalId: z.string().nullish(),
  kind: z.enum(["cosign", "seal", "pause", "veto", "resume"]),
  decoded: z
    .object({
      target: Address,
      targetLabel: z.string(),
      method: z.string(),
      payeeLabel: z.string().nullish(),
      payeeAddress: Address.nullish(),
      symbol: z.string().nullish(),
      decimals: z.number().int().nullish(),
      amount: UInt.nullish(),
    })
    .nullish(),
  typedData: WireTypedData,
  digest: Hex32,
  expiresAt: Time,
  status: z.enum(["pending", "signed", "expired", "declined"]),
  nonce: UInt.nullish(),
  expiry: UInt.nullish(),
  /** Requested addition: the raw execution, so the approval page decodes the call itself. */
  execution: z.object({ target: Address, value: UInt, callData: HexData }).nullish(),
  /** Requested addition: why this needs the user, and the explanation (with its AI label). */
  reason: z.string().nullish(),
  explanation: WireExplanation.nullish(),
  /** Requested addition (treasury): director signatures collected so far and the threshold. */
  signatures: z.array(z.object({ signer: z.string(), signedAt: Time })).nullish(),
  threshold: z.number().int().nullish(),
});
export type WireApproval = z.infer<typeof WireApproval>;

export const WireSignatureResult = z.object({ receipt: WireReceipt.nullish() });
export const WireApprovalRef = z.object({ approvalId: z.string(), approval: WireApproval.nullish() });

/* ------------------------------------------------------------------ mandates */

export const WireCompileResult = z.object({
  /** Opaque mandate object; sent back unchanged to /v1/mandates/seal. */
  mandate: z.unknown(),
  mandateHash: Hex32,
  delegationHash: Hex32,
  caveats: z.array(z.object({ enforcer: z.string(), terms: z.string() })),
  sentences: z.array(z.string()),
  rules: z.array(WireRule),
  hashRing: WireHashRing,
  roundTrip: WireRoundTrip.nullish(),
});
export type WireCompileResult = z.infer<typeof WireCompileResult>;

/* ------------------------------------------------------------------ registry and evidence */

export const WireRegistryAgent = z.object({
  agentId: z.union([z.string(), z.number()]).transform(String),
  wallet: Address,
  label: z.string(),
  ownerDidHash: z.string(),
  identityCode: z.string().nullish(),
  status: z.string(),
  principal: z.string().nullish(),
  attestations: z
    .array(z.object({ issuer: z.string(), issuerLabel: z.string(), claimHash: z.string(), expiresAt: z.union([Time, z.number()]).nullish() }))
    .nullish(),
  ledger: WireLedger,
});
export type WireRegistryAgent = z.infer<typeof WireRegistryAgent>;

export const WireEvidence = z.object({
  generatedAt: Time,
  items: z.array(
    z.object({
      beat: z.union([z.string(), z.number()]).transform(String).nullish(),
      title: z.string(),
      principal: z.string().nullish(),
      tier: WireTier.nullish(),
      ledger: WireLedger,
      txHash: Hex32,
      explorerUrl: z.string().nullish(),
      outcome: z.string(),
      revertError: z.union([z.string(), WireRevertError]).nullish(),
    }),
  ),
  /** Requested addition: generated metrics and the cross-ledger code-hash table. */
  metrics: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        value: z.string(),
        unit: z.string().nullish(),
        n: z.number().int().nullish(),
        interval: z.tuple([z.string(), z.string()]).nullish(),
        source: z.string(),
        note: z.string().nullish(),
      }),
    )
    .nullish(),
  contracts: z
    .array(z.object({ name: z.string(), ledger: WireLedger, chainId: z.number().int(), address: Address, codeHash: Hex32 }))
    .nullish(),
  commit: z.string().nullish(),
});
export type WireEvidence = z.infer<typeof WireEvidence>;

/* ------------------------------------------------------------------ Judge's Challenge (apps/agent/src/challenge.ts) */

export const WireChallengeSession = z.object({
  guestPrincipal: z.string(),
  joinUrl: z.string(),
  rule: z.string(),
  cap: z.object({ symbol: z.string(), decimals: z.number().int(), amount: UInt }),
  dailyCap: z.object({ symbol: z.string(), decimals: z.number().int(), amount: UInt }).nullish(),
  ledger: WireLedger.nullish(),
  ledgerBadge: z.string().nullish(),
  expiresAt: Time,
  quota: z.object({ perDay: z.number().int(), used: z.number().int().nullish() }),
  shadowMode: z.boolean(),
  mandateHash: Hex32,
  delegationHash: Hex32,
  sentences: z.array(z.string()).nullish(),
});

export const WireChallengeAttempt = z.object({
  id: z.string(),
  at: Time,
  handle: z.string(),
  family: z.string(),
  stoppedAt: z.number().int().min(1).max(9).nullish(),
  stoppedName: z.string().nullish(),
  outcome: z.enum(["refused", "reverted", "escalated", "executed", "asked", "simulated"]),
  tier: WireTier.nullish(),
  typedError: z.string().nullish(),
  ledger: WireLedger.nullish(),
  txHash: Hex32.nullish(),
  explorerUrl: z.string().nullish(),
  proposalId: z.string().nullish(),
  text: z.string().nullish(),
});

/* ------------------------------------------------------------------ company board (2 of 3 directors) */

export const WireBoardProposal = z.object({
  id: z.string(),
  principal: z.string(),
  ledger: WireLedger,
  title: z.string(),
  payee: z.object({ id: z.string().nullish(), label: z.string(), address: Address.nullish() }),
  amount: UInt,
  decimals: z.number().int(),
  symbol: z.string(),
  digest: Hex32.nullish(),
  threshold: z.number().int(),
  signatures: z.array(z.object({ director: z.string(), address: Address.nullish(), signedAt: Time.nullish() })),
  status: z.enum(["collecting", "executed", "failed"]),
  txHash: Hex32.nullish(),
  createdAt: Time.nullish(),
});
export type WireBoardProposal = z.infer<typeof WireBoardProposal>;

/* ------------------------------------------------------------------ Merkle proof (indexer, GET /proof/:receiptId?verify=1) */

export const WireProof = z.object({
  receiptHash: Hex32,
  batchId: z.union([z.number(), z.string()]).nullish(),
  index: z.number().int().nullish(),
  /** Sibling hashes, OpenZeppelin commutative (sorted-pair) keccak256. */
  proof: z.array(Hex32),
  root: Hex32,
  anchors: z.array(z.object({ ledger: WireLedger, txHash: Hex32, blockNumber: IntLike.nullish(), onchainBatchId: z.union([z.number(), z.string()]).nullish() })),
  valid: z.boolean().nullish(),
  /** AccountabilityLedger.verifyReceipt on the anchoring ledger. */
  onChain: z.object({ ledger: WireLedger, onchainBatchId: z.union([z.number(), z.string()]).nullish(), valid: z.boolean() }).nullish(),
});

/* ------------------------------------------------------------------ read-only explorer (GET /v1/tx/:ledger/:hash) */

export const WireTx = z.object({
  ledger: WireLedger,
  ledgerBadge: z.string().nullish(),
  chainId: z.number().int(),
  hash: Hex32,
  status: z.string(),
  blockNumber: IntLike.nullish(),
  from: Address.nullish(),
  to: Address.nullish(),
  toName: z.string().nullish(),
  gasUsed: IntLike.nullish(),
  call: z.object({ contract: z.string().nullish(), function: z.string(), args: z.array(z.unknown()) }).nullish(),
  events: z
    .array(z.object({ contract: z.string().nullish(), addressName: z.string().nullish(), event: z.string(), args: z.record(z.string(), z.unknown()).nullish() }))
    .nullish(),
  note: z.string().nullish(),
});

/* ------------------------------------------------------------------ requested additions */

export const WirePrivateMandate = z.object({
  agentId: z.union([z.string(), z.number()]).transform(String),
  commitment: Hex32,
  proofStatus: z.enum(["verified", "pending", "failed"]),
  verifierTx: z.object({ ledger: WireLedger, chainId: z.number().int(), txHash: Hex32 }).nullish(),
  statements: z.array(z.string()),
});

/** The service answers errors as {ok: false, error: "<message>"}; the structured form is accepted too. */
export const WireError = z.union([
  z.object({ ok: z.literal(false), error: z.string() }),
  z.object({ error: z.object({ code: z.string(), message: z.string(), typedError: z.string().nullish() }) }),
]);
