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
  /** Requested addition: MandateRegistry.isLive(mandateHash), so a revoked mandate is shown as revoked. */
  live: z.boolean().nullish(),
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
  suitability: z.lazy(() => WireSuitability).nullish(),
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
  kind: z.enum(["cosign", "seal", "pause", "veto", "resume", "revoke"]),
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

/* ------------------------------------------------------------------ visitors */

export const WireVisitorSignUp = z.object({
  visitorId: z.string().regex(/^v-[0-9a-f]+$/),
  token: z.string().min(8),
  account: Address,
  did: z.string(),
  ledger: WireLedger,
  ledgerBadge: z.string().nullish(),
  agent: z.object({ label: z.string(), wallet: Address, agentId: z.union([z.string(), z.number()]).transform(String), identityCode: z.string() }),
  mandate: z.object({ title: z.string(), sentences: z.array(z.string()), mandateHash: Hex32, delegationHash: Hex32 }),
  requests: z.array(z.object({ kind: z.literal("seal"), step: z.enum(["publish", "delegation"]), title: z.string(), digest: Hex32, typedData: WireTypedData })),
});
export type WireVisitorSignUp = z.infer<typeof WireVisitorSignUp>;

export const WireVisitorDraft = z.object({
  draft: z.unknown(),
  adjustments: z.array(z.object({ field: z.string(), said: z.string().nullish(), enforced: z.string(), kind: z.enum(["clamped", "default", "adjusted"]), reason: z.string() })),
  compiled: z.object({ mandateHash: Hex32, delegationHash: Hex32, caveatCount: z.number().int(), preview: z.boolean().nullish() }),
  decodedSentences: z.array(z.string()),
  payeeBook: z.array(z.object({ id: z.string(), label: z.string(), category: z.string(), address: Address })),
  userSentences: z.array(z.string()),
  diff: z.array(
    z.object({
      rule: z.string(),
      said: z.string().nullish(),
      enforced: z.string(),
      source: z.string(),
      status: z.enum(["as you said", "clamped", "default", "adjusted", "not enforced"]),
      flagged: z.boolean(),
      note: z.string().nullish(),
    }),
  ),
  flagged: z.number().int(),
  roundTrip: z.object({ ok: z.boolean(), checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().nullish() })) }),
  hashRing: WireHashRing.nullish(),
  ledger: WireLedger,
  ledgerBadge: z.string().nullish(),
  aigc: z.object({ label: z.string(), model: z.string(), provider: z.string(), via: z.enum(["llm", "rules"]), latencyMs: z.number().nullish() }),
  note: z.string().nullish(),
});

export const WireVisitorSeal = z.object({ principal: WirePrincipal, mandateHash: Hex32, publishTx: Hex32.nullish() });

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
  /** "demo" agents of the scenario principals, or "visitor" agents of people who signed up with a passkey. */
  kind: z.enum(["demo", "visitor"]).nullish(),
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

/* ------------------------------------------------------------------ anchoring batches (indexer, GET /batches) */

export const WireBatches = z.object({
  batches: z.array(
    z.object({
      batchId: z.union([z.number(), z.string()]).transform(Number),
      root: Hex32,
      count: z.number().int(),
      createdAt: Time,
      anchors: z.array(z.object({ ledger: WireLedger, txHash: Hex32, blockNumber: IntLike.nullish() })),
      crossAnchors: z.array(z.object({ onLedger: WireLedger, remoteLedger: WireLedger, txHash: Hex32 })).nullish(),
    }),
  ),
});
export type WireBatches = z.infer<typeof WireBatches>;

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
  // `args` is a list, an object, or a one-line summary (redeemDelegations).
  call: z.object({ contract: z.string().nullish(), function: z.string(), args: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown()), z.string()]).nullish() }).nullish(),
  events: z
    .array(z.object({ contract: z.string().nullish(), addressName: z.string().nullish(), event: z.string(), args: z.record(z.string(), z.unknown()).nullish() }))
    .nullish(),
  note: z.string().nullish(),
  revert: z.object({ name: z.string(), message: z.string().nullish() }).nullish(),
  revertSource: z.string().nullish(),
});

/* ------------------------------------------------------------------ capabilities (docs/API.md section 3.10) */

export const SInt = z.string().regex(/^-?(0|[1-9]\d*)$/, "expected an integer string");

export const WireNarration = z.object({
  text: z.string(),
  aiGenerated: z.boolean(),
  label: z.string().nullish(),
  model: z.string().nullish(),
  provider: z.string().nullish(),
  fallbackReason: z.string().nullish(),
});

export const WireInsights = z.object({
  period: z.object({ start: Time, end: Time, daysLeft: z.number().int(), timeCompressed: z.boolean() }).nullable(),
  categories: z.array(
    z.object({
      symbol: z.string(),
      decimals: z.number().int(),
      category: z.string(),
      kind: z.enum(["scheduled", "one-off", "variable"]),
      cap: UInt,
      spent: UInt,
      remaining: UInt,
      usedBps: z.number().int(),
      forecastPeriodEnd: UInt,
      forecastMethod: z.string(),
      wouldReachCapAt: Time.nullish(),
      status: z.enum(["on track", "at cap", "due this period", "would reach the cap before the period ends"]),
    }),
  ),
  topPayees: z.array(z.object({ label: z.string(), address: Address, symbol: z.string(), decimals: z.number().int(), amount: UInt, payments: z.number().int(), receiptIds: z.array(z.string()) })),
  totals: z.array(z.object({ symbol: z.string(), decimals: z.number().int(), cap: UInt, spent: UInt, forecastPeriodEnd: UInt })),
  explanation: WireNarration,
  block: IntLike.nullish(),
  ledger: WireLedger,
  label: z.string(),
});

export const WireCoverage = z.object({
  obligations: z.array(
    z.object({
      payeeId: z.string(),
      payeeLabel: z.string(),
      category: z.string(),
      cadence: z.enum(["every period", "one-off", "per invoice"]),
      symbol: z.string(),
      decimals: z.number().int(),
      upTo: UInt,
      protection: z.enum(["escrow-protected", "settled through escrow", "paid directly (no protection)", "unprotected"]),
      escrowIds: z.array(z.number().int()),
      refundableAfter: Time.nullish(),
      why: z.string(),
    }),
  ),
  coverItems: z.array(z.object({ item: z.string(), status: z.string(), gap: z.boolean(), note: z.string() })),
  gaps: z.array(z.string()),
  summary: z.object({ protected: z.number().int(), unprotected: z.number().int(), settled: z.number().int(), gaps: z.number().int() }),
  label: z.string(),
  block: IntLike.nullish(),
  ledger: WireLedger,
});

export const WireEscrow = z.object({
  escrowId: z.number().int(),
  ledger: WireLedger,
  payer: Address.nullish(),
  payee: z.object({ address: Address, id: z.string().nullish(), label: z.string() }),
  token: z.object({ address: Address.nullish(), symbol: z.string(), decimals: z.number().int() }),
  amount: UInt,
  conditionId: Hex32,
  releaseAttester: z.object({ address: Address, label: z.string(), heldByService: z.boolean() }),
  createdAt: Time,
  refundAfter: Time,
  state: z.enum(["held", "released", "refunded"]),
  canRelease: z.boolean(),
  canRefundNow: z.boolean(),
  fundingReceiptId: z.string().nullish(),
});
export type WireEscrow = z.infer<typeof WireEscrow>;

export const WireEscrowList = z.object({ escrows: z.array(WireEscrow), block: IntLike.nullish(), contract: Address.nullish() });

export const WireCredential = z.object({
  id: Hex32,
  principal: z.string(),
  ledger: WireLedger,
  issuer: Address,
  issuerLabel: z.string(),
  typedData: z.object({
    domain: z.record(z.string(), z.unknown()),
    message: z.object({
      subject: z.string(),
      onTimePayments: z.union([z.number(), z.string()]),
      periodStart: IntLike,
      periodEnd: IntLike,
      receiptIds: z.array(z.string()),
      issuedAt: IntLike,
      statement: z.string(),
    }),
  }),
  signature: HexData,
  anchorReceiptId: z.string().nullish(),
  rule: z.string(),
  label: z.string(),
  issuedAt: Time,
  reused: z.boolean().nullish(),
});
export type WireCredential = z.infer<typeof WireCredential>;

export const WireCredentialVerification = z.object({
  credentialHash: Hex32,
  valid: z.boolean(),
  signatureValid: z.boolean(),
  recovered: Address.nullish(),
  issuer: Address.nullish(),
  issuerLabel: z.string(),
  trustedIssuer: z.boolean(),
  receipts: z.array(
    z.object({
      receiptId: z.string(),
      found: z.boolean(),
      intact: z.boolean().nullish(),
      confirmed: z.boolean().nullish(),
      toRentPayee: z.boolean().nullish(),
      ownReceipt: z.boolean().nullish(),
      txHash: Hex32.nullish(),
      ledger: WireLedger.nullish(),
      ok: z.boolean(),
    }),
  ),
  anchorReceiptId: z.string().nullish(),
  anchorCommitsCredential: z.boolean(),
  label: z.string(),
});

export const WireForecast = z.object({
  symbol: z.string(),
  decimals: z.number().int(),
  horizonDays: z.number().int(),
  start: z.object({ posted: UInt, pending: UInt }),
  reserveFloor: UInt,
  events: z.array(z.object({ day: z.number().int(), date: Time, kind: z.enum(["scheduled instruction", "payroll", "supplier run-rate"]), label: z.string(), amount: UInt })),
  supplierRunRatePerDay: UInt,
  daily: z.array(z.object({ day: z.number().int(), date: Time, outflow: UInt, balance: SInt, belowFloor: z.boolean() })),
  minBalance: SInt,
  headroomAboveFloor: SInt,
  firstBreach: z.object({ day: z.number().int(), date: Time, balance: SInt, shortfall: UInt }).nullable(),
  flags: z.array(z.string()),
  velocity: z
    .object({ windowSeconds: IntLike, windowEndsAt: Time, maxCount: z.number().int(), used: z.number().int(), countLeft: z.number().int(), maxOutflow: UInt, outflow: UInt, outflowLeft: UInt })
    .nullable(),
  ledger: WireLedger,
  block: IntLike.nullish(),
  rail: z.string(),
  explanation: WireNarration,
  label: z.string(),
});

export const WireSuitability = z.object({
  product: z.object({ id: z.string().nullish(), label: z.string(), address: Address, onChainName: z.string().nullish(), nameMatchesRegistry: z.boolean().nullish() }),
  listed: z.boolean(),
  riskClass: z.number().int().nullable(),
  riskLabel: z.string(),
  mandateMaxRiskClass: z.number().int().nullable(),
  mandateMaxLabel: z.string(),
  verdict: z.enum(["suitable", "unsuitable", "not a listed product", "no suitability rule sealed"]),
  outcome: z.enum(["approved", "needs your approval", "refused", "held"]),
  why: z.array(z.string()),
  source: z.object({ registry: Address, function: z.string(), enforcer: z.string(), block: IntLike, ledger: WireLedger }),
  label: z.string(),
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
