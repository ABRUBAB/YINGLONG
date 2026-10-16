/**
 * Front-end view model. Pages render only these shapes. The fixture adapter produces them directly;
 * the live adapter maps the agent service's wire format (./types.ts) into them.
 *
 * Conventions
 * - Amounts are integer strings in base units plus `decimals` (no floats for money, CLAUDE.md rule 4).
 * - Hashes are 0x-prefixed 32-byte hex; addresses are 0x-prefixed 20-byte hex (any case).
 * - Text marked "code-filled" is produced by templates from reason codes, never free LLM text.
 *   AI-generated text always travels with an `aigc` label (null means the text is a template).
 */
import { z } from "zod";

/* ------------------------------------------------------------------ primitives */

export const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte 0x hex string");
export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte 0x address");
export const HexData = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/, "expected 0x hex bytes");
/** Unsigned integer in base units, as a decimal string. */
export const BaseUnits = z.string().regex(/^(0|[1-9]\d*)$/, "expected an unsigned integer string");
export const IsoTime = z.string().min(1);
export const TypedError = z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "expected a PascalCase typed error");

export const Ledger = z.enum(["base-sepolia", "fisco", "anvil-bench"]);
export type Ledger = z.infer<typeof Ledger>;

export const Jurisdiction = z.enum(["hk", "international", "mainland"]);
export type Jurisdiction = z.infer<typeof Jurisdiction>;

export const Tier = z.enum(["T0", "T1", "T2", "T3", "T4", "ASK"]);
export type Tier = z.infer<typeof Tier>;

export const Amount = z.object({
  value: BaseUnits,
  decimals: z.number().int().min(0).max(36),
  /** Display unit, always honest: "tHKD", "USDC (testnet)", "CNY test units". */
  symbol: z.string().min(1),
});
export type Amount = z.infer<typeof Amount>;

export const AigcLabel = z.object({
  label: z.literal("AI-generated"),
  model: z.string(),
  provider: z.string().optional(),
  contentId: z.string().optional(),
});
export type AigcLabel = z.infer<typeof AigcLabel>;

export const TxRef = z.object({
  ledger: Ledger,
  chainId: z.number().int().nonnegative(),
  txHash: Hex32,
  blockNumber: z.number().int().nonnegative().nullable().optional(),
  explorerUrl: z.string().nullable().optional(),
  /** Ledger badge from the service, shown next to the hash (e.g. "Anvil bench (simulated)"). */
  badge: z.string().nullable().optional(),
});
export type TxRef = z.infer<typeof TxRef>;

export const KNOWN_ERRORS = [
  "PayeeNotVerified",
  "CategoryBudgetExceeded",
  "ReserveFloorBreached",
  "VelocityExceeded",
  "UnsuitableProduct",
  "RailNotPermitted",
  "Paused",
  "CoSignRequired",
  "VetoWindowOpen",
  "ForbiddenTarget",
  "InvalidMandateProof",
  "QuoteExpired",
  "LineageViolation",
  "InjectionSuspected",
  "TaintedField",
  "UngroundedValue",
  "SimulationMismatch",
  "AnomalyEscalation",
  "AmbiguousIntent",
  "StaleState",
] as const;

/* ------------------------------------------------------------------ service health */

export const Health = z.object({
  ok: z.boolean(),
  version: z.string(),
  ledgers: z.array(z.object({ ledger: Ledger, chainId: z.number().int(), block: z.string(), badge: z.string() })),
  models: z.object({ intent: z.string(), sentinel: z.string() }),
});
export type Health = z.infer<typeof Health>;

/* ------------------------------------------------------------------ principal and passport */

export const PasskeyInfo = z.object({
  /** WebAuthn credential id (base64url); keyIdHash = keccak256(utf8(keyId)) on the HybridDeleGator. */
  keyId: z.string().min(1),
  label: z.string(),
});
export type PasskeyInfo = z.infer<typeof PasskeyInfo>;

export const Principal = z.object({
  id: z.string(),
  kind: z.enum(["person", "company"]),
  did: z.string(),
  displayName: z.string(),
  account: Address,
  ledger: Ledger,
  ledgerBadge: z.string().nullable(),
  agentId: z.string(),
  agentName: z.string(),
  jurisdiction: Jurisdiction,
  signer: z.string(),
  paused: z.boolean(),
  passkeys: z.array(PasskeyInfo),
});
export type Principal = z.infer<typeof Principal>;

export const Attestation = z.object({
  id: z.string(),
  issuerName: z.string(),
  issuerDid: z.string(),
  kind: z.string(),
  trusted: z.boolean(),
  status: z.enum(["valid", "expired", "revoked"]),
  expiresAt: IsoTime.nullable(),
  tx: TxRef.nullable(),
});
export type Attestation = z.infer<typeof Attestation>;

export const Passport = z.object({
  agentId: z.string(),
  agentName: z.string(),
  agentWallet: Address,
  ownerDid: z.string(),
  ownerName: z.string(),
  /** GB/Z 185 identity code: always a labelled placeholder, no code has been issued. */
  identityCode: z.object({ value: z.string(), placeholder: z.literal(true), label: z.string() }),
  attestations: z.array(Attestation),
  status: z.enum(["active", "paused", "revoked", "self-registered"]),
  reputation: z.object({ score: z.number().int().min(0).max(100), clients: z.number().int().nonnegative() }).nullable(),
  provenance: z
    .object({ modelHash: Hex32, promptsHash: Hex32, policyHash: Hex32, codeHash: Hex32, enforcerTableHash: Hex32 })
    .nullable(),
});
export type Passport = z.infer<typeof Passport>;

/* ------------------------------------------------------------------ mandates */

export const RuleParamValue = z.union([z.string(), z.boolean(), z.array(z.string())]);

export const MandateRule = z.object({
  id: z.string(),
  /** English sentence (code-filled). */
  sentence: z.string(),
  /** Caveat enforcer that implements the rule, e.g. "CategoryBudgetEnforcer". */
  enforcer: z.string(),
  enforcerAddress: Address.nullable(),
  /** ABI-level parameters; every amount is a base-unit integer string. */
  params: z.record(z.string(), RuleParamValue),
  tierCeiling: Tier.nullable(),
});
export type MandateRule = z.infer<typeof MandateRule>;

export const CheckLine = z.object({ id: z.string(), label: z.string(), passed: z.boolean() });
export type CheckLine = z.infer<typeof CheckLine>;

export const ServiceHashRing = z.object({
  ticks: z.array(z.object({ i: z.number(), angleDeg: z.number(), r0: z.number(), r1: z.number() })),
  arcs: z.array(z.object({ j: z.number(), startDeg: z.number(), sweepDeg: z.number(), r: z.number() })),
});
export type ServiceHashRing = z.infer<typeof ServiceHashRing>;

export const MandateStatus = z.enum(["live", "superseded", "revoked"]);
export type MandateStatus = z.infer<typeof MandateStatus>;

export const Mandate = z.object({
  id: z.string(),
  mandateHash: Hex32,
  /** EIP-712 delegation hash accepted by the DelegationManager (Hash Ring input H). */
  delegationHash: Hex32,
  version: z.number().int().positive(),
  status: MandateStatus,
  jurisdiction: Jurisdiction,
  title: z.string(),
  ownerName: z.string(),
  agentId: z.string(),
  rules: z.array(MandateRule),
  /** Sentences decoded back from the on-chain caveats (round trip). */
  decodedSentences: z.array(z.string()),
  roundTrip: z.array(CheckLine),
  validity: z.object({ notBefore: IsoTime, notAfter: IsoTime }),
  sealedAt: IsoTime.nullable(),
  /** MandateRegistry.publish transactions (one per ledger). */
  published: z.array(TxRef),
  supersedes: Hex32.nullable(),
  /** What the user said, verbatim (may be Bangla; echoed in Anek Bangla). */
  sourceText: z.string().nullable(),
  /** The agent service's own Hash Ring computation, cross-checked against ours when present. */
  serviceHashRing: ServiceHashRing.nullable(),
});
export type Mandate = z.infer<typeof Mandate>;

export const CompileRequest = z.object({
  text: z.string().min(1).max(4000),
  jurisdiction: Jurisdiction,
});
export type CompileRequest = z.infer<typeof CompileRequest>;

export const RoundTripLine = z.object({
  ruleId: z.string(),
  compiled: z.string(),
  decoded: z.string(),
  matches: z.boolean(),
});
export type RoundTripLine = z.infer<typeof RoundTripLine>;

export const MandateDraft = z.object({
  draftId: z.string(),
  jurisdiction: Jurisdiction,
  rules: z.array(MandateRule),
  delegationHash: Hex32,
  mandateHash: Hex32,
  roundTrip: z.array(RoundTripLine),
  checks: z.array(CheckLine),
  warnings: z.array(z.string()),
  language: z.enum(["en", "bn", "zh", "mixed"]),
  serviceHashRing: ServiceHashRing.nullable(),
  /** Opaque compiled mandate returned by the service, sent back unchanged to seal it. */
  wire: z.unknown().optional(),
});
export type MandateDraft = z.infer<typeof MandateDraft>;

/* ------------------------------------------------------------------ signing requests (signing-domain guard input) */

export const TypedData = z.object({
  domain: z.record(z.string(), z.unknown()),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});
export type TypedData = z.infer<typeof TypedData>;

/** Something the user's passkey is asked to sign: exactly `digest`, which must equal hashTypedData(typedData). */
export const SigningRequest = z.object({
  id: z.string(),
  kind: z.enum(["cosign", "seal", "pause", "resume", "veto", "revoke"]),
  digest: Hex32,
  typedData: TypedData,
  expiresAt: IsoTime,
});
export type SigningRequest = z.infer<typeof SigningRequest>;

export const SignatureSubmission = z.object({ keyId: z.string(), signature: HexData });
export type SignatureSubmission = z.infer<typeof SignatureSubmission>;

/* ------------------------------------------------------------------ budgets */

export const BudgetLane = z.object({
  id: z.string(),
  category: z.string(),
  label: z.string(),
  cap: Amount,
  spent: Amount,
  period: z.enum(["day", "week", "month", "once", "window"]),
  periodEnd: IsoTime.nullable(),
  floor: Amount.nullable(),
  /** Forecast (Estimate): reserve floor breach expected within this many days. */
  breachForecastDays: z.number().int().nonnegative().nullable(),
  enforcer: z.string(),
});
export type BudgetLane = z.infer<typeof BudgetLane>;

/* ------------------------------------------------------------------ decisions */

export const SCALE_IDS = [
  "normalise",
  "sentinel",
  "quarantine",
  "ground",
  "policy",
  "counterparty",
  "simulate",
  "anomaly",
  "chain",
] as const;
export const ScaleId = z.enum(SCALE_IDS);
export type ScaleId = z.infer<typeof ScaleId>;

export const SCALE_NAMES: Record<ScaleId, string> = {
  normalise: "Normalise",
  sentinel: "Sentinel",
  quarantine: "Quarantine and taint",
  ground: "Ground",
  policy: "Policy",
  counterparty: "Counterparty",
  simulate: "Simulate",
  anomaly: "Anomaly",
  chain: "Chain",
};

export const ScaleResult = z.object({
  scale: ScaleId,
  status: z.enum(["passed", "stopped", "escalated", "skipped"]),
  reason: z.string().nullable(),
  error: TypedError.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  revert: TxRef.nullable(),
});
export type ScaleResult = z.infer<typeof ScaleResult>;

export const Intent = z.object({
  action: z.enum(["pay", "convert", "sweep", "escrow", "observe", "change-mandate", "other"]),
  summary: z.string(),
  /** PayeeBook id, or NEW_PAYEE_REQUEST: the model can never emit an address. */
  payeeId: z.string().nullable(),
  payeeName: z.string().nullable(),
  amount: Amount.nullable(),
  category: z.string().nullable(),
  intentHash: Hex32.nullable(),
});
export type Intent = z.infer<typeof Intent>;

export const Decision = z.object({
  proposalId: z.string(),
  createdAt: IsoTime,
  input: z.object({ text: z.string(), language: z.enum(["en", "bn", "zh", "mixed"]) }),
  intent: Intent,
  plan: z.array(z.string()),
  tier: Tier,
  scales: z.array(ScaleResult).length(9),
  /** executable = T0/T1 the agent may run now; reserved = T3, only the user's own account. */
  outcome: z.enum(["executable", "executed", "awaiting_approval", "asking", "refused", "reserved", "observed"]),
  question: z.string().nullable(),
  explanation: z.string(),
  /** null when the explanation is a template (not AI-generated). */
  aigc: AigcLabel.nullable(),
  approvalId: z.string().nullable(),
  receiptId: z.string().nullable(),
  /** Set when the service executed a T1 decision in the same call (autoExecute). */
  receipt: z.lazy(() => Receipt).nullable().optional(),
});
export type Decision = z.infer<typeof Decision>;

export const AskRequest = z.object({ text: z.string().min(1).max(2000) });
export type AskRequest = z.infer<typeof AskRequest>;

/* ------------------------------------------------------------------ receipts */

export const ReceiptOutcome = z.enum([
  "confirmed",
  "reverted",
  "rejected_policy",
  "pending",
  "awaiting_approval",
  "asked",
  "expired",
  "unknown",
]);
export type ReceiptOutcome = z.infer<typeof ReceiptOutcome>;

export const Anchor = z.object({ root: Hex32, baseTx: Hex32.nullable(), fiscoTx: Hex32.nullable() });
export type Anchor = z.infer<typeof Anchor>;

export const Receipt = z.object({
  receiptId: z.string(),
  receiptHash: Hex32.nullable(),
  chainId: z.number().int().nonnegative(),
  ledger: Ledger,
  ledgerBadge: z.string().nullable(),
  agentId: z.string(),
  mandateHash: Hex32,
  delegationHash: Hex32,
  intentHash: Hex32,
  tier: Tier,
  txHash: Hex32.nullable(),
  explorerUrl: z.string().nullable(),
  outcome: ReceiptOutcome,
  revertError: TypedError.nullable(),
  explanation: z.string(),
  aigc: AigcLabel.nullable(),
  timestamp: IsoTime,
  prevReceiptHash: Hex32,
  anchor: Anchor.nullable(),
  /** Display fields (code-filled). */
  summary: z.string(),
  payeeName: z.string().nullable(),
  amount: Amount.nullable(),
  category: z.string().nullable(),
});
export type Receipt = z.infer<typeof Receipt>;

export const Page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const MerkleProof = z.object({
  receiptId: z.string(),
  leaf: Hex32,
  /** positional: sibling side per level; sorted: OpenZeppelin commutative pair hashing. */
  pairing: z.enum(["positional", "sorted"]),
  path: z.array(z.object({ sibling: Hex32, position: z.enum(["left", "right"]).nullable() })),
  root: Hex32,
  anchors: z.array(
    z.object({
      ledger: Ledger,
      chainId: z.number().int(),
      txHash: Hex32,
      blockNumber: z.number().int().nonnegative().nullable(),
      /** Root read back from that ledger, when the service reports it; null = not read on chain. */
      root: Hex32.nullable(),
      explorerUrl: z.string().nullable(),
    }),
  ),
});
export type MerkleProof = z.infer<typeof MerkleProof>;

/* ------------------------------------------------------------------ approvals */

export const AbiArg = z.object({ name: z.string(), type: z.string(), value: z.string() });

export const ApprovalRequest = z.object({
  id: z.string(),
  kind: z.enum(["cosign", "seal", "pause", "resume", "veto", "revoke"]),
  status: z.enum(["pending", "approved", "declined", "expired"]),
  expiresAt: IsoTime,
  tier: Tier.nullable(),
  ledger: Ledger,
  chainId: z.number().int().nonnegative(),
  /** The 32 bytes the passkey signs; must equal hashTypedData(typedData). */
  digest: Hex32,
  typedData: TypedData,
  /** Raw execution when the service provides it: the page then decodes the call itself. */
  execution: z.object({ target: Address, value: BaseUnits, callData: HexData }).nullable(),
  /** The service's description, compared against the page's own decoding before signing. */
  decoded: z
    .object({
      target: Address,
      targetName: z.string(),
      method: z.string(),
      args: z.array(AbiArg),
      payee: z.object({ id: z.string().nullable(), name: z.string(), address: Address.nullable(), source: z.string(), verified: z.boolean() }).nullable(),
      amount: Amount.nullable(),
    })
    .nullable(),
  reason: z.string().nullable(),
  explanation: z.string().nullable(),
  aigc: AigcLabel.nullable(),
  /** The principal whose account signs (service principal id); null when the service does not say. */
  principal: z.string().nullable().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const ApprovalResult = z.object({ approval: ApprovalRequest, receipt: Receipt.nullable() });
export type ApprovalResult = z.infer<typeof ApprovalResult>;

/* ------------------------------------------------------------------ visitors (sign up with your own passkey) */

/** One message the new passkey signs during sign-up: the publish user operation, then the root delegation. */
export const VisitorSealRequest = z.object({
  kind: z.literal("seal"),
  step: z.enum(["publish", "delegation"]),
  title: z.string(),
  digest: Hex32,
  typedData: TypedData,
});
export type VisitorSealRequest = z.infer<typeof VisitorSealRequest>;

export const VisitorSignUp = z.object({
  visitorId: z.string(),
  token: z.string(),
  account: Address,
  did: z.string(),
  ledger: Ledger,
  ledgerBadge: z.string().nullable(),
  agent: z.object({ label: z.string(), wallet: Address, agentId: z.string(), identityCode: z.string() }),
  mandate: z.object({ title: z.string(), sentences: z.array(z.string()), mandateHash: Hex32, delegationHash: Hex32 }),
  requests: z.array(VisitorSealRequest),
});
export type VisitorSignUp = z.infer<typeof VisitorSignUp>;

export const VisitorSealResult = z.object({
  principal: Principal,
  mandateHash: Hex32,
  publishTx: Hex32.nullable(),
  ledger: Ledger,
  ledgerBadge: z.string().nullable(),
});
export type VisitorSealResult = z.infer<typeof VisitorSealResult>;

/* ------------------------------------------------------------------ pause */

export const PauseStatus = z.object({
  paused: z.boolean(),
  since: IsoTime.nullable(),
  txs: z.array(TxRef),
  measuredMs: z.number().int().nonnegative().nullable(),
});
export type PauseStatus = z.infer<typeof PauseStatus>;

/* ------------------------------------------------------------------ treasury */

export const TreasuryEntity = z.object({
  id: z.string(),
  name: z.string(),
  jurisdiction: Jurisdiction,
  rail: z.object({ label: z.string(), ledger: Ledger, note: z.string() }),
  agentName: z.string(),
  directors: z.array(z.object({ id: z.string(), name: z.string() })),
  threshold: z.number().int().positive(),
});
export type TreasuryEntity = z.infer<typeof TreasuryEntity>;

export const DirectorProposal = z.object({
  id: z.string(),
  title: z.string(),
  payeeName: z.string(),
  amount: Amount.nullable(),
  reason: z.string(),
  tier: Tier,
  createdAt: IsoTime.nullable(),
  signatures: z.array(z.object({ directorId: z.string(), signedAt: IsoTime })),
  status: z.enum(["open", "approved", "executed", "rejected", "expired"]),
  tx: TxRef.nullable(),
});
export type DirectorProposal = z.infer<typeof DirectorProposal>;

export const LedgerInstruction = z.object({
  id: z.string(),
  instructionHash: Hex32,
  kind: z.string(),
  payeeName: z.string(),
  amount: Amount.nullable(),
  condition: z.string().nullable(),
  status: z.enum(["executed", "scheduled", "pending", "rejected"]),
  rejectError: TypedError.nullable(),
  tx: TxRef.nullable(),
  createdAt: IsoTime,
  anchor: z.object({
    status: z.enum(["anchored", "pending", "not-anchored"]),
    root: Hex32.nullable(),
    baseTx: Hex32.nullable(),
  }),
});
export type LedgerInstruction = z.infer<typeof LedgerInstruction>;

export const TreasuryView = z.object({
  entity: TreasuryEntity,
  lanes: z.array(BudgetLane),
  proposals: z.array(DirectorProposal),
  instructions: z.array(LedgerInstruction),
  mandate: Mandate.nullable(),
  forecast: z.object({ breachInDays: z.number().int().nonnegative().nullable(), note: z.string(), model: z.string() }).nullable(),
});
export type TreasuryView = z.infer<typeof TreasuryView>;

/* ------------------------------------------------------------------ supervisor */

export const RegistryAgent = z.object({
  agentId: z.string(),
  agentName: z.string(),
  ownerName: z.string(),
  ownerDid: z.string(),
  wallet: Address,
  ledger: Ledger,
  jurisdiction: Jurisdiction.nullable(),
  status: z.enum(["active", "paused", "revoked", "self-registered"]),
  identityCode: z.string().nullable(),
  /** null when the service does not report attestations. */
  trustedAttestations: z.number().int().nonnegative().nullable(),
  issuers: z.array(z.string()),
  reputation: z.number().int().min(0).max(100).nullable(),
  receipts: z.number().int().nonnegative().nullable(),
  lastReceiptId: z.string().nullable(),
  /** Scenario agents, or agents of visitors who signed up with their own passkey (grouped separately). */
  kind: z.enum(["demo", "visitor"]).optional(),
});
export type RegistryAgent = z.infer<typeof RegistryAgent>;

export const PrivateMandate = z.object({
  agentId: z.string(),
  commitment: Hex32,
  proofStatus: z.enum(["verified", "pending", "failed"]),
  verifierTx: TxRef.nullable(),
  statements: z.array(z.string()),
});
export type PrivateMandate = z.infer<typeof PrivateMandate>;

/* ------------------------------------------------------------------ Judge's Challenge */

export const ChallengeSession = z.object({
  sessionId: z.string(),
  guestPrincipal: z.string(),
  joinUrl: z.string(),
  rule: z.string(),
  guestMandate: z.object({ mandateHash: Hex32, delegationHash: Hex32, cap: Amount, expiresAt: IsoTime }),
  quota: z.object({ perDay: z.number().int().positive(), used: z.number().int().nonnegative().nullable() }),
  ledgerBadge: z.string().nullable().optional(),
  sentences: z.array(z.string()).optional(),
  shadowMode: z.boolean(),
});
export type ChallengeSession = z.infer<typeof ChallengeSession>;

export const ChallengeAttempt = z.object({
  id: z.string(),
  at: IsoTime,
  handle: z.string().max(32),
  family: z.string(),
  stoppedAt: ScaleId.nullable(),
  outcome: z.enum(["refused", "reverted", "escalated", "simulated", "executed", "asked"]),
  error: TypedError.nullable(),
  revert: TxRef.nullable(),
  proposalId: z.string().nullable().optional(),
});
export type ChallengeAttempt = z.infer<typeof ChallengeAttempt>;

export const ChallengeAttemptRequest = z.object({
  text: z.string().min(1).max(1000),
  handle: z.string().max(32).optional(),
  bypass: z.boolean(),
});
export type ChallengeAttemptRequest = z.infer<typeof ChallengeAttemptRequest>;

export const ChallengeVerdict = z.object({ attempt: ChallengeAttempt, decision: Decision, receipt: Receipt.nullable() });
export type ChallengeVerdict = z.infer<typeof ChallengeVerdict>;

/* ------------------------------------------------------------------ Agent City */

export const CityNode = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["user", "agent", "service", "regulator", "anchor", "rogue"]),
  rail: z.enum(["hk", "fisco", "seam"]),
  passport: z.enum(["attested", "self-registered", "none"]),
  reputation: z.number().int().min(0).max(100),
});
export type CityNode = z.infer<typeof CityNode>;

export const CityEdge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  state: z.enum(["settled", "awaiting", "reverted"]),
  receiptId: z.string().nullable(),
  amount: Amount.nullable(),
  label: z.string(),
});
export type CityEdge = z.infer<typeof CityEdge>;

export const CityGraph = z.object({
  nodes: z.array(CityNode),
  edges: z.array(CityEdge),
  anchors: z.array(z.object({ at: IsoTime, root: Hex32, baseTx: Hex32.nullable(), fiscoTx: Hex32.nullable() })),
});
export type CityGraph = z.infer<typeof CityGraph>;

/* ------------------------------------------------------------------ evidence (generated by scripts/finalize) */

export const EvidenceSource = z.string();
export type EvidenceSource = z.infer<typeof EvidenceSource>;

export const EvidenceMetric = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  unit: z.string().nullable(),
  n: z.number().int().nonnegative().nullable(),
  interval: z.tuple([z.string(), z.string()]).nullable(),
  source: EvidenceSource,
  note: z.string().nullable(),
});
export type EvidenceMetric = z.infer<typeof EvidenceMetric>;

export const EvidenceHash = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["seal", "payment", "revert", "refusal", "pause", "anchor", "revoke", "rotation", "zk", "other"]),
  tx: TxRef,
  typedError: TypedError.nullable(),
});
export type EvidenceHash = z.infer<typeof EvidenceHash>;

export const EvidenceSummary = z.object({
  generatedAt: IsoTime,
  commit: z.string(),
  generator: z.string(),
  metrics: z.array(EvidenceMetric),
  hashes: z.array(EvidenceHash),
  contracts: z.array(z.object({ name: z.string(), ledger: Ledger, chainId: z.number().int(), address: Address, codeHash: Hex32 })),
  verifyCommand: z.string(),
  receipt: Receipt.nullable(),
});
export type EvidenceSummary = z.infer<typeof EvidenceSummary>;

/* ------------------------------------------------------------------ read-only ledger explorer (FISCO, Anvil bench) */

export const TxView = z.object({
  ledger: Ledger,
  badge: z.string().nullable(),
  chainId: z.number().int(),
  hash: Hex32,
  status: z.enum(["success", "reverted", "pending", "unknown"]),
  blockNumber: z.string().nullable(),
  from: Address.nullable(),
  to: Address.nullable(),
  toName: z.string().nullable(),
  gasUsed: z.string().nullable(),
  call: z.object({ contract: z.string(), fn: z.string(), args: z.array(z.string()) }).nullable(),
  events: z.array(z.object({ contract: z.string(), event: z.string(), args: z.record(z.string(), z.string()) })),
  note: z.string().nullable(),
});
export type TxView = z.infer<typeof TxView>;
