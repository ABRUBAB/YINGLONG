/**
 * SAMPLE DATA, used only when NEXT_PUBLIC_DATA_MODE=fixtures. Every surface that renders it shows a
 * "Sample data" chip. The cast is fictional (master plan 6.1). Hashes are keccak256 of labels
 * (see ./util.ts); none of them is a real transaction, and no number here is evidence.
 */
import { encodeAbiParameters, encodeFunctionData, keccak256, type Hex } from "viem";
import { typedDataDigest } from "../../signing-guard";
import { delegationStructHash, ROOT_AUTHORITY } from "../../account-ops";
import { NADIA_SOURCE } from "./source";
import { buildMerkle, cosignTypedData, decodePayment, encodeSingleExecution, ESCROW_DATA, PAYMENT_ABI } from "../../chain";
import type {
  ApprovalRequest,
  BudgetLane,
  ChallengeAttempt,
  ChallengeSession,
  EvidenceSummary,
  Mandate,
  MandateRule,
  MerkleProof,
  Passport,
  Principal,
  PrivateMandate,
  Receipt,
  RegistryAgent,
  TreasuryEntity,
  TreasuryView,
} from "../view";
import { addr, amt, at, baseTx, CNYT, daysAgo, fiscoTx, h, minutesAgo, NOW, THKD, USDC } from "./util";

/* ------------------------------------------------------------------ cast */

export const NADIA_ACCOUNT = addr("nadia-account");
export const YING_WALLET = addr("ying-wallet");
export const THKD_TOKEN = addr("thkd-token");
export const PROTECTED_PAYMENT = addr("protected-payment");

export const PAYEES = {
  harbourHomes: { id: "harbour-homes", name: "Harbour Homes", address: addr("harbour-homes"), category: "rent" },
  hbu: { id: "hbu-bursar", name: "HBU Bursar", address: addr("hbu-bursar"), category: "tuition" },
  kowloonFresh: { id: "kowloon-fresh", name: "Kowloon Fresh Market", address: addr("kowloon-fresh"), category: "food" },
  mtr: { id: "octopus-topup", name: "Transit top-up desk", address: addr("transit"), category: "transport" },
  pearlRiver: { id: "pearl-river-fx", name: "Pearl River FX Desk", address: addr("pearl-river-fx"), category: "services" },
  kowloonBooks: { id: "kowloon-books", name: "Kowloon Books", address: addr("kowloon-books"), category: "study" },
} as const;

export const principal: Principal = {
  id: "nadia",
  kind: "person",
  ledger: "base-sepolia",
  ledgerBadge: "Base Sepolia (testnet)",
  signer: "passkey (WebAuthn)",
  paused: false,
  did: "did:pkh:eip155:84532:" + NADIA_ACCOUNT,
  displayName: "Nadia Rahman",
  account: NADIA_ACCOUNT,
  agentId: "4127",
  agentName: "Ying",
  jurisdiction: "hk",
  passkeys: [
    { keyId: "nadia-phone-sample", label: "Phone" },
    { keyId: "nadia-laptop-sample", label: "Laptop" },
  ],
};

export const passport: Passport = {
  agentId: "4127",
  agentName: "Ying",
  agentWallet: YING_WALLET,
  ownerDid: principal.did,
  ownerName: "Nadia Rahman",
  identityCode: {
    value: "YL-TEST-0000-4127",
    placeholder: true,
    label: "Placeholder: no GB/Z 185 identity code has been issued",
  },
  attestations: [
    {
      id: "att-hbu",
      issuerName: "Harbour Bay University (fictional)",
      issuerDid: "did:web:hbu.example",
      kind: "enrolment",
      trusted: true,
      status: "valid",
      expiresAt: at("2027-08-31T15:59:59Z"),
      tx: baseTx("att-hbu"),
    },
    {
      id: "att-hdb",
      issuerName: "Harbour Digital Bank (fictional)",
      issuerDid: "did:web:hdb.example",
      kind: "institution-authorisation",
      trusted: true,
      status: "valid",
      expiresAt: at("2027-10-01T15:59:59Z"),
      tx: baseTx("att-hdb"),
    },
  ],
  status: "active",
  reputation: { score: 92, clients: 6 },
  provenance: {
    modelHash: h("provenance:model"),
    promptsHash: h("provenance:prompts"),
    policyHash: h("provenance:policy"),
    codeHash: h("provenance:code"),
    enforcerTableHash: h("provenance:enforcer-table"),
  },
};

/* ------------------------------------------------------------------ Nadia's mandate */

const tuitionDeadline = String(Date.parse("2026-10-31T16:00:00Z") / 1000);

export const nadiaRules: MandateRule[] = [
  {
    id: "allowlist",
    sentence: "Ying may only call transfer on tHKD and deposit on Protected Payment; nothing else.",
    enforcer: "AllowedTargetsEnforcer + AllowedMethodsEnforcer",
    enforcerAddress: "0x7F20f61b1f09b08D970938F6fa563634d65c4EeB",
    params: { targets: [THKD_TOKEN, PROTECTED_PAYMENT], methods: ["transfer(address,uint256)", "deposit(address,uint256,bytes32)"] },
    tierCeiling: null,
  },
  {
    id: "rent",
    sentence: "Pay rent of 9,500.00 tHKD to Harbour Homes on the 1st of each month.",
    enforcer: "CategoryBudgetEnforcer",
    enforcerAddress: addr("enf-category"),
    params: { category: "rent", payee: PAYEES.harbourHomes.id, cap: amt("9500", THKD).value, period: "2592000" },
    tierCeiling: "T1",
  },
  {
    id: "food",
    sentence: "Spend at most 3,000.00 tHKD on food each month.",
    enforcer: "CategoryBudgetEnforcer",
    enforcerAddress: addr("enf-category"),
    params: { category: "food", cap: amt("3000", THKD).value, period: "2592000" },
    tierCeiling: "T1",
  },
  {
    id: "floor",
    sentence: "Never let the tHKD balance fall below 1,500.00 tHKD.",
    enforcer: "ReserveFloorEnforcer",
    enforcerAddress: addr("enf-floor"),
    params: { token: THKD_TOKEN, floor: amt("1500", THKD).value },
    tierCeiling: "T4",
  },
  {
    id: "tuition",
    sentence: "Pay the tuition deposit to HBU Bursar into protected escrow before 1 Nov 2026.",
    enforcer: "VerifiedPayeeEnforcer + TimestampEnforcer",
    enforcerAddress: "0x1046bb45C8d673d4ea75321280DB34899413c069",
    params: { payee: PAYEES.hbu.id, cap: amt("20000", THKD).value, notAfter: tuitionDeadline },
    tierCeiling: "T2",
  },
  {
    id: "ask",
    sentence: "Ask me before any payment above 2,000.00 tHKD and before paying anyone new.",
    enforcer: "CoSignEnforcer",
    enforcerAddress: addr("enf-cosign"),
    params: { threshold: amt("2000", THKD).value, newPayee: true, maxExpirySeconds: "600" },
    tierCeiling: "T2",
  },
  {
    id: "payees",
    sentence: "Only pay payees in my PayeeBook, or agents attested by HBU or Harbour Digital Bank.",
    enforcer: "VerifiedPayeeEnforcer",
    enforcerAddress: addr("enf-payee"),
    params: { issuers: ["did:web:hbu.example", "did:web:hdb.example"], minReputation: "70" },
    tierCeiling: "T1",
  },
  {
    id: "velocity",
    sentence: "At most 6 payments and 12,000.00 tHKD out in any 24 hours.",
    enforcer: "VelocityEnforcer",
    enforcerAddress: addr("enf-velocity"),
    params: { maxCount: "6", maxOutflow: amt("12000", THKD).value, window: "86400" },
    tierCeiling: "T4",
  },
  {
    id: "rail",
    sentence: "Never approve tokens, call unlisted contracts or leave the Hong Kong test rail.",
    enforcer: "ForbiddenTargetsEnforcer + JurisdictionEnforcer",
    enforcerAddress: addr("enf-forbidden"),
    params: { profile: "hk", approvals: false },
    tierCeiling: "T4",
  },
];

export const ROUND_TRIP_CHECKS = [
  { id: "allowlist-first", label: "Target and method allowlist emitted first", passed: true },
  { id: "forbidden-disjoint", label: "Allowlist and forbidden set are disjoint", passed: true },
  { id: "codehash", label: "Every enforcer code hash matches the signed enforcer table", passed: true },
  { id: "decode", label: "On-chain caveats decode back to the same sentences", passed: true },
  { id: "not-disabled", label: "Delegation is not disabled in the DelegationManager", passed: true },
];

export { NADIA_SOURCE };

/**
 * Nadia's sample root delegation (one caveat per rule). Its EIP-712 struct hash is the mandate's
 * delegation hash, so a revoke in fixtures mode is checked exactly as a live one (disableDelegation of
 * the delegation whose hash is the live delegation hash).
 */
export const nadiaDelegation = {
  delegate: YING_WALLET,
  delegator: NADIA_ACCOUNT,
  authority: ROOT_AUTHORITY,
  caveats: nadiaRules.map((r, i) => ({ enforcer: (r.enforcerAddress ?? addr(`enforcer:${r.enforcer}`)) as Hex, terms: h(`terms:nadia:v3:${i}`), args: "0x" as Hex })),
  salt: 3n,
  signature: "0x" as Hex,
};

export const nadiaMandate: Mandate = {
  id: "mandate-nadia-v3",
  mandateHash: h("mandate:nadia:v3"),
  delegationHash: delegationStructHash(nadiaDelegation),
  version: 3,
  status: "live",
  jurisdiction: "hk",
  title: "Nadia's monthly mandate",
  ownerName: "Nadia Rahman",
  agentId: "4127",
  rules: nadiaRules,
  validity: { notBefore: at("2026-10-02T04:00:00Z"), notAfter: at("2027-01-31T15:59:59Z") },
  sealedAt: at("2026-10-02T04:01:12Z"),
  published: [baseTx("publish:nadia:v3"), fiscoTx("publish:nadia:v3")],
  supersedes: h("mandate:nadia:v2"),
  sourceText: NADIA_SOURCE,
  decodedSentences: nadiaRules.map((r) => r.sentence),
  roundTrip: ROUND_TRIP_CHECKS,
  serviceHashRing: null,
};

export const nadiaMandateV2: Mandate = {
  ...nadiaMandate,
  id: "mandate-nadia-v2",
  mandateHash: h("mandate:nadia:v2"),
  delegationHash: h("delegation:nadia:v2"),
  version: 2,
  status: "superseded",
  title: "Nadia's first mandate (food cap 2,500)",
  sealedAt: at("2026-10-02T03:40:00Z"),
  published: [baseTx("publish:nadia:v2"), fiscoTx("publish:nadia:v2")],
  supersedes: h("mandate:nadia:v1"),
  validity: { notBefore: at("2026-10-02T03:40:00Z"), notAfter: at("2026-10-02T04:01:12Z") },
};

export const nadiaMandateV1: Mandate = {
  ...nadiaMandate,
  id: "mandate-nadia-v1",
  mandateHash: h("mandate:nadia:v1"),
  delegationHash: h("delegation:nadia:v1"),
  version: 1,
  status: "revoked",
  title: "Key-compromise drill: revoked",
  sealedAt: at("2026-10-02T03:30:00Z"),
  published: [baseTx("publish:nadia:v1")],
  supersedes: null,
  validity: { notBefore: at("2026-10-02T03:30:00Z"), notAfter: at("2026-10-02T03:39:00Z") },
};

export const budgets: BudgetLane[] = [
  {
    id: "rent",
    category: "rent",
    label: "Rent",
    cap: amt("9500", THKD),
    spent: amt("9500", THKD),
    period: "month",
    periodEnd: at("2026-10-31T15:59:59Z"),
    floor: null,
    breachForecastDays: null,
    enforcer: "CategoryBudgetEnforcer",
  },
  {
    id: "food",
    category: "food",
    label: "Food",
    cap: amt("3000", THKD),
    spent: amt("1846.50", THKD),
    period: "month",
    periodEnd: at("2026-10-31T15:59:59Z"),
    floor: null,
    breachForecastDays: null,
    enforcer: "CategoryBudgetEnforcer",
  },
  {
    id: "tuition",
    category: "tuition",
    label: "Tuition deposit",
    cap: amt("20000", THKD),
    spent: amt("0", THKD),
    period: "once",
    periodEnd: at("2026-10-31T15:59:59Z"),
    floor: null,
    breachForecastDays: null,
    enforcer: "VerifiedPayeeEnforcer",
  },
  {
    id: "daily",
    category: "velocity",
    label: "Out today",
    cap: amt("12000", THKD),
    spent: amt("4236.80", THKD),
    period: "day",
    periodEnd: at("2026-10-16T15:59:59Z"),
    floor: amt("1500", THKD),
    breachForecastDays: null,
    enforcer: "VelocityEnforcer + ReserveFloorEnforcer",
  },
];

/* ------------------------------------------------------------------ receipts and anchors */

interface ReceiptSeed {
  key: string;
  ts: string;
  summary: string;
  payee: string | null;
  amount: ReturnType<typeof amt> | null;
  category: string | null;
  tier: Receipt["tier"];
  outcome: Receipt["outcome"];
  ledger?: Receipt["ledger"];
  error?: string;
  explanation: string;
  anchored: boolean;
  tx: boolean;
}

const seeds: ReceiptSeed[] = [
  {
    key: "fx-convert",
    ts: minutesAgo(22),
    summary: "Convert 4,000.00 USDC (testnet) to tHKD at the signed Pearl River quote",
    payee: "Pearl River FX Desk",
    amount: amt("4000", USDC),
    category: "conversion",
    tier: "T1",
    outcome: "pending",
    explanation:
      "Ying converted the stipend at the quote Pearl River FX Desk signed at 09:01. The quote was bought over x402 for 0.40 USDC (testnet) and its passport is attested by Harbour Digital Bank.",
    anchored: false,
    tx: true,
  },
  {
    key: "x402-quote",
    ts: minutesAgo(26),
    summary: "Buy a signed FX quote over x402",
    payee: "Pearl River FX Desk",
    amount: amt("0.40", USDC),
    category: "services",
    tier: "T1",
    outcome: "confirmed",
    explanation: "A single-use, exact-amount child delegation paid for one quote. The service delivered only after settlement.",
    anchored: false,
    tx: true,
  },
  {
    key: "mirage-quote",
    ts: minutesAgo(27),
    summary: "Refuse an FX quote from Mirage (self-issued passport)",
    payee: "Mirage",
    amount: null,
    category: "services",
    tier: "T4",
    outcome: "rejected_policy",
    error: "PayeeNotVerified",
    explanation:
      "Mirage presented a passport credential that no trusted issuer signed. The counterparty scale refused it before any money moved.",
    anchored: true,
    tx: false,
  },
  {
    key: "groceries",
    ts: daysAgo(1, "19:42"),
    summary: "Groceries at Kowloon Fresh Market",
    payee: "Kowloon Fresh Market",
    amount: amt("236.80", THKD),
    category: "food",
    tier: "T1",
    outcome: "confirmed",
    explanation: "Inside the food budget: 1,846.50 of 3,000.00 tHKD used this month after this payment.",
    anchored: true,
    tx: true,
  },
  {
    key: "quote-expired",
    ts: daysAgo(2, "11:05"),
    summary: "Replay of an expired FX quote",
    payee: "Pearl River FX Desk",
    amount: amt("3000", USDC),
    category: "conversion",
    tier: "T4",
    outcome: "reverted",
    error: "QuoteExpired",
    explanation: "The quote's signed expiry had passed, so SignedQuoteSettlement reverted. Nothing moved.",
    anchored: true,
    tx: true,
  },
  {
    key: "transit",
    ts: daysAgo(4, "08:12"),
    summary: "Transit card top-up",
    payee: "Transit top-up desk",
    amount: amt("100", THKD),
    category: "transport",
    tier: "T1",
    outcome: "confirmed",
    explanation: "A repeat payment to a verified payee, inside the daily outflow limit.",
    anchored: true,
    tx: true,
  },
  {
    key: "forgery",
    ts: daysAgo(15, "02:14"),
    summary: "Refuse payment to a forged HBU bank account",
    payee: "Unverified address",
    amount: amt("20000", THKD),
    category: "tuition",
    tier: "T4",
    outcome: "reverted",
    error: "PayeeNotVerified",
    explanation:
      "An email claimed HBU had changed its bank account. The address is not in the PayeeBook and no trusted issuer attests it. The raw redemption reverted on chain.",
    anchored: true,
    tx: true,
  },
  {
    key: "rent",
    ts: daysAgo(15, "02:13"),
    summary: "October rent to Harbour Homes",
    payee: "Harbour Homes",
    amount: amt("9500", THKD),
    category: "rent",
    tier: "T1",
    outcome: "confirmed",
    explanation: "Scheduled by the mandate: rent of 9,500.00 tHKD on the 1st to a verified payee.",
    anchored: true,
    tx: true,
  },
  {
    key: "bench-sample",
    ts: daysAgo(15, "01:50"),
    summary: "Bench task 118: pay a verified payee inside the cap",
    payee: "Bench payee",
    amount: amt("50", THKD),
    category: "bench",
    tier: "T1",
    outcome: "confirmed",
    ledger: "anvil-bench",
    explanation: "A benchmark task replayed on the Anvil fork. Bench receipts are never mixed with live ones.",
    anchored: false,
    tx: true,
  },
];

const receiptIds = seeds.map((s) => h(`receipt:${s.key}`));
const anchoredLeaves = seeds.map((s, k) => (s.anchored ? keccak256(receiptIds[k]!) : null)).filter((x): x is Hex => x !== null);
const tree = buildMerkle(anchoredLeaves);
export const ANCHOR_ROOT = tree.root;
const anchorBase = baseTx("anchor:batch-312");
const anchorFisco = fiscoTx("anchor:batch-312");

export const receipts: Receipt[] = seeds.map((s, k) => {
  const ledger = s.ledger ?? "base-sepolia";
  return {
    receiptId: receiptIds[k]!,
    receiptHash: keccak256(receiptIds[k]!),
    chainId: ledger === "anvil-bench" ? 31337 : 84532,
    ledger,
    ledgerBadge: ledger === "anvil-bench" ? "Anvil bench (simulated)" : "Base Sepolia (testnet)",
    agentId: "4127",
    mandateHash: nadiaMandate.mandateHash,
    delegationHash: nadiaMandate.delegationHash,
    intentHash: h(`intent:${s.key}`),
    tier: s.tier,
    txHash: s.tx ? h(`tx:base:receipt:${s.key}`) : null,
    explorerUrl: null,
    outcome: s.outcome,
    revertError: s.error ?? null,
    explanation: s.explanation,
    aigc: { label: "AI-generated", model: "qwen3.5-9b-instruct-q4 (sample)", provider: "local", contentId: h(`aigc:${s.key}`).slice(0, 18) },
    timestamp: s.ts,
    prevReceiptHash: receiptIds[k + 1] ?? h("receipt:genesis"),
    anchor: s.anchored ? { root: ANCHOR_ROOT, baseTx: anchorBase.txHash, fiscoTx: anchorFisco.txHash } : null,
    summary: s.summary,
    payeeName: s.payee,
    amount: s.amount,
    category: s.category,
  };
});

export function proofFor(receiptId: string): MerkleProof | null {
  const k = receiptIds.findIndex((r) => r.toLowerCase() === receiptId.toLowerCase());
  if (k < 0 || !seeds[k]!.anchored) return null;
  const leaf = keccak256(receiptIds[k]!);
  const index = anchoredLeaves.indexOf(leaf);
  return {
    receiptId: receiptIds[k]!,
    leaf,
    pairing: "positional",
    path: tree.proofFor(index),
    root: ANCHOR_ROOT,
    anchors: [
      { ledger: "base-sepolia", chainId: 84532, txHash: anchorBase.txHash, blockNumber: anchorBase.blockNumber ?? null, root: ANCHOR_ROOT, explorerUrl: null },
      { ledger: "fisco", chainId: 0, txHash: anchorFisco.txHash, blockNumber: anchorFisco.blockNumber ?? null, root: ANCHOR_ROOT, explorerUrl: null },
    ],
  };
}

/* ------------------------------------------------------------------ approvals */

export const COSIGN_ENFORCER = addr("enf-cosign");

export const HBU_ATTESTER = addr("hbu-enrolment-attester");

/** Builds a T2 approval exactly as the agent service does: PaymentDecoder shapes, CoSign typed data. */
function approval(opts: {
  id: string;
  escrow: boolean;
  payee: (typeof PAYEES)[keyof typeof PAYEES];
  major: string;
  reason: string;
  explanation: string;
  nonce: bigint;
}): ApprovalRequest {
  const amount = amt(opts.major, THKD);
  const expiry = BigInt(Math.floor(NOW / 1000) + 86_400 * 30);
  // Escrow: transferAndCall(ProtectedPayment, amount, abi.encode(payee, conditionId, attester, refundAfter)) on tHKD.
  const callData = opts.escrow
    ? encodeFunctionData({
        abi: PAYMENT_ABI,
        functionName: "transferAndCall",
        args: [
          PROTECTED_PAYMENT,
          BigInt(amount.value),
          encodeAbiParameters(ESCROW_DATA, [opts.payee.address, h("condition:hbu-enrolment-attested"), HBU_ATTESTER, expiry + 86_400n * 30n]),
        ],
      })
    : encodeFunctionData({ abi: PAYMENT_ABI, functionName: "transfer", args: [opts.payee.address, BigInt(amount.value)] });
  const typedData = cosignTypedData({
    chainId: 84532,
    ledgerName: "base-sepolia",
    verifyingContract: COSIGN_ENFORCER,
    delegationHash: nadiaMandate.delegationHash as Hex,
    executionCallData: encodeSingleExecution(THKD_TOKEN, 0n, callData),
    nonce: opts.nonce,
    expiry,
  });
  const pay = decodePayment(THKD_TOKEN, 0n, callData);
  return {
    id: opts.id,
    kind: "cosign",
    status: "pending",
    expiresAt: new Date(Number(expiry) * 1000).toISOString(),
    tier: "T2",
    ledger: "base-sepolia",
    chainId: 84532,
    digest: typedDataDigest(typedData),
    typedData,
    execution: { target: THKD_TOKEN, value: "0", callData },
    decoded: {
      target: opts.escrow ? PROTECTED_PAYMENT : opts.payee.address,
      targetName: opts.escrow ? "escrow (ProtectedPayment)" : opts.payee.name,
      method: opts.escrow ? "transferAndCall" : "transfer",
      args: pay.args,
      payee: { id: opts.payee.id, name: opts.payee.name, address: opts.payee.address, source: "PayeeBook", verified: true },
      amount,
    },
    reason: opts.reason,
    explanation: opts.explanation,
    aigc: { label: "AI-generated", model: "qwen3.5-9b-instruct-q4 (sample)", provider: "local" },
  };
}

export const approvals: ApprovalRequest[] = [
  approval({
    id: "apr-tuition",
    escrow: true,
    payee: PAYEES.hbu,
    major: "20000",
    reason: "Above your 2,000.00 tHKD ask threshold. Released to HBU only when HBU attests your enrolment.",
    explanation:
      "Your mandate asks Ying to pay the tuition deposit before 1 November. This puts 20,000.00 tHKD into escrow; HBU receives it only after it attests your enrolment, and you can claim it back if it does not.",
    nonce: 7n,
  }),
  approval({
    id: "apr-books",
    escrow: false,
    payee: PAYEES.kowloonBooks,
    major: "480",
    reason: "First payment to Kowloon Books. New counterparties always need you.",
    explanation:
      "You asked Ying to buy the course reader. Kowloon Books is in your PayeeBook since yesterday, so the first payment needs your approval.",
    nonce: 8n,
  }),
];

/* ------------------------------------------------------------------ treasury (Lotus Lane) */

export const entities: TreasuryEntity[] = [
  {
    id: "lotus-sz",
    name: "Lotus Lane Trading (Shenzhen) Co.",
    jurisdiction: "mainland",
    rail: {
      label: "Coin-free rail",
      ledger: "fisco",
      note: "FISCO BCOS consortium ledger. e-CNY-style simulator; not the PBoC sandbox, no connection to any bank.",
    },
    agentName: "Treasurer agent",
    directors: [
      { id: "d-chen", name: "Director A. Lin" },
      { id: "d-wong", name: "Director M. Wong" },
      { id: "d-rahim", name: "Director S. Rahim" },
    ],
    threshold: 2,
  },
  {
    id: "lotus-hk",
    name: "Lotus Lane (HK) Ltd",
    jurisdiction: "hk",
    rail: {
      label: "HK test rail",
      ledger: "base-sepolia",
      note: "Test units on Base Sepolia. Simulation of a regulated instrument; not issued by any licensee.",
    },
    agentName: "Treasurer agent (same passport, HK mandate)",
    directors: [
      { id: "d-chen", name: "Director A. Lin" },
      { id: "d-wong", name: "Director M. Wong" },
      { id: "d-rahim", name: "Director S. Rahim" },
    ],
    threshold: 2,
  },
];

function lane(id: string, label: string, cap: string, spent: string, unit: typeof CNYT | typeof THKD, extra: Partial<BudgetLane> = {}): BudgetLane {
  return {
    id,
    category: id,
    label,
    cap: amt(cap, unit),
    spent: amt(spent, unit),
    period: "month",
    periodEnd: at("2026-10-31T15:59:59Z"),
    floor: null,
    breachForecastDays: null,
    enforcer: "CategoryBudgetEnforcer",
    ...extra,
  };
}

const lotusMandate = (id: string, jurisdiction: Mandate["jurisdiction"], version: number): Mandate => ({
  id: `mandate-${id}`,
  mandateHash: h(`mandate:${id}`),
  delegationHash: h(`delegation:${id}`),
  version,
  status: "live",
  jurisdiction,
  title: jurisdiction === "mainland" ? "Board resolution 2026-07: treasurer mandate" : "Board resolution 2026-09: HK treasurer mandate",
  ownerName: jurisdiction === "mainland" ? "Lotus Lane Trading (Shenzhen) Co." : "Lotus Lane (HK) Ltd",
  agentId: "5310",
  rules: [],
  validity: { notBefore: at("2026-10-05T01:00:00Z"), notAfter: at("2027-03-31T15:59:59Z") },
  sealedAt: at("2026-10-05T01:02:00Z"),
  published: jurisdiction === "mainland" ? [fiscoTx(`publish:${id}`)] : [baseTx(`publish:${id}`)],
  supersedes: null,
  sourceText: null,
  decodedSentences: [],
  roundTrip: ROUND_TRIP_CHECKS,
  serviceHashRing: null,
});

export const treasuryViews: Record<string, TreasuryView> = {
  "lotus-sz": {
    entity: entities[0]!,
    mandate: lotusMandate("lotus-sz", "mainland", 2),
    lanes: [
      lane("payroll", "Payroll", "412000", "412000", CNYT),
      lane("suppliers", "Suppliers", "600000", "318450", CNYT),
      lane("logistics", "Logistics", "80000", "22300", CNYT),
      lane("reserve", "Operating reserve", "1200000", "905000", CNYT, {
        floor: amt("250000", CNYT),
        breachForecastDays: 24,
        enforcer: "ReserveFloorEnforcer",
        label: "Reserve floor",
      }),
    ],
    proposals: [
      {
        id: "prop-cnc",
        title: "Equipment purchase: CNC router",
        payeeName: "Shenzhen Components",
        amount: amt("186000", CNYT),
        reason: "Outside every lane: capital purchases are reserved for the board (2 of 3 directors).",
        tier: "T3",
        createdAt: minutesAgo(180),
        signatures: [{ directorId: "d-chen", signedAt: minutesAgo(150) }],
        status: "open",
        tx: null,
      },
      {
        id: "prop-defer",
        title: "Defer optional resin order to November",
        payeeName: "Shenzhen Components",
        amount: amt("42000", CNYT),
        reason: "Proposed by the treasurer agent: the 30-day forecast shows the reserve floor breached on day 24, when payroll leaves.",
        tier: "T2",
        createdAt: minutesAgo(95),
        signatures: [],
        status: "open",
        tx: null,
      },
      {
        id: "prop-lease",
        title: "Warehouse lease renewal",
        payeeName: "Qianhai Logistics Park",
        amount: amt("96000", CNYT),
        reason: "Annual lease: board decision.",
        tier: "T3",
        createdAt: daysAgo(3, "10:00"),
        signatures: [
          { directorId: "d-chen", signedAt: daysAgo(3, "10:20") },
          { directorId: "d-wong", signedAt: daysAgo(3, "11:02") },
        ],
        status: "executed",
        tx: fiscoTx("prop-lease"),
      },
    ],
    instructions: [
      {
        id: "ins-split",
        instructionHash: h("ins:split"),
        kind: "supplier-payment",
        payeeName: "Shenzhen Components (look-alike)",
        amount: amt("49900", CNYT),
        condition: "\"Director approved, urgent\" invoice, split into 4 payments",
        status: "rejected",
        rejectError: "VelocityExceeded",
        tx: fiscoTx("ins:split"),
        createdAt: minutesAgo(64),
        anchor: { status: "pending", root: null, baseTx: null },
      },
      {
        id: "ins-prepay",
        instructionHash: h("ins:prepay"),
        kind: "conditional-payment",
        payeeName: "Shenzhen Components",
        amount: amt("38500", CNYT),
        condition: "Release when the goods-received note is attested",
        status: "scheduled",
        rejectError: null,
        tx: fiscoTx("ins:prepay"),
        createdAt: minutesAgo(130),
        anchor: { status: "pending", root: null, baseTx: null },
      },
      {
        id: "ins-invoice",
        instructionHash: h("ins:invoice-2231"),
        kind: "supplier-payment",
        payeeName: "Shenzhen Components",
        amount: amt("27640", CNYT),
        condition: "Invoice 2231 read by two readers; amount and payee agree",
        status: "executed",
        rejectError: null,
        tx: fiscoTx("ins:invoice-2231"),
        createdAt: daysAgo(1, "15:10"),
        anchor: { status: "anchored", root: h("root:fisco-batch-88"), baseTx: h("tx:base:anchor:fisco-batch-88") },
      },
      {
        id: "ins-payroll",
        instructionHash: h("ins:payroll-oct"),
        kind: "payroll",
        payeeName: "Payroll, 23 employees",
        amount: amt("412000", CNYT),
        condition: "Board mandate: payroll on the 10th",
        status: "executed",
        rejectError: null,
        tx: fiscoTx("ins:payroll-oct"),
        createdAt: daysAgo(6, "09:00"),
        anchor: { status: "anchored", root: h("root:fisco-batch-81"), baseTx: h("tx:base:anchor:fisco-batch-81") },
      },
      {
        id: "ins-kyb",
        instructionHash: h("ins:kyb"),
        kind: "transfer",
        payeeName: "KYB Verifier (x402 check)",
        amount: amt("12", CNYT),
        condition: "Bought one KYB check over x402 before the first supplier payment",
        status: "executed",
        rejectError: null,
        tx: fiscoTx("ins:kyb"),
        createdAt: daysAgo(6, "08:40"),
        anchor: { status: "anchored", root: h("root:fisco-batch-81"), baseTx: h("tx:base:anchor:fisco-batch-81") },
      },
    ],
    forecast: null,
  },
  "lotus-hk": {
    entity: entities[1]!,
    mandate: lotusMandate("lotus-hk", "hk", 1),
    lanes: [
      lane("suppliers", "Suppliers", "150000", "61200", THKD),
      lane("sweeps", "Sweeps to test MMF", "500000", "200000", THKD, { enforcer: "SuitabilityEnforcer" }),
      lane("payroll", "Payroll", "96000", "0", THKD),
    ],
    proposals: [],
    instructions: [
      {
        id: "hk-rail",
        instructionHash: h("hk:rail"),
        kind: "transfer",
        payeeName: "Shenzhen mandate attempting tHKD",
        amount: amt("10000", THKD),
        condition: "Mainland profile on the HK test rail",
        status: "rejected",
        rejectError: "RailNotPermitted",
        tx: baseTx("hk:rail"),
        createdAt: minutesAgo(48),
        anchor: { status: "anchored", root: h("root:base-batch-312"), baseTx: h("tx:base:anchor:base-batch-312") },
      },
      {
        id: "hk-unsuitable",
        instructionHash: h("hk:unsuitable"),
        kind: "sweep",
        payeeName: "Test Growth Fund (risk class 5)",
        amount: amt("100000", THKD),
        condition: "Suitability: sealed risk class 2",
        status: "rejected",
        rejectError: "UnsuitableProduct",
        tx: baseTx("hk:unsuitable"),
        createdAt: minutesAgo(52),
        anchor: { status: "anchored", root: h("root:base-batch-312"), baseTx: h("tx:base:anchor:base-batch-312") },
      },
      {
        id: "hk-sweep-2",
        instructionHash: h("hk:sweep-2"),
        kind: "sweep",
        payeeName: "Test Money Market Fund",
        amount: amt("100000", THKD),
        condition: "Repeat sweep into an approved product (T1)",
        status: "executed",
        rejectError: null,
        tx: baseTx("hk:sweep-2"),
        createdAt: daysAgo(1, "17:00"),
        anchor: { status: "anchored", root: h("root:base-batch-309"), baseTx: h("tx:base:anchor:base-batch-309") },
      },
      {
        id: "hk-sweep-1",
        instructionHash: h("hk:sweep-1"),
        kind: "sweep",
        payeeName: "Test Money Market Fund",
        amount: amt("100000", THKD),
        condition: "First sweep into this product, approved by a director (T2)",
        status: "executed",
        rejectError: null,
        tx: baseTx("hk:sweep-1"),
        createdAt: daysAgo(3, "17:00"),
        anchor: { status: "anchored", root: h("root:base-batch-301"), baseTx: h("tx:base:anchor:base-batch-301") },
      },
    ],
    forecast: null,
  },
};

/* ------------------------------------------------------------------ supervisor */

export const registry: RegistryAgent[] = [
  {
    agentId: "4127",
    ledger: "base-sepolia",
    identityCode: "YL-TEST-0000-4127",
    issuers: ["Harbour Bay University (fictional)","Harbour Digital Bank (fictional)"],
    agentName: "Ying",
    ownerName: "Nadia Rahman",
    ownerDid: principal.did,
    wallet: YING_WALLET,
    jurisdiction: "hk",
    status: "active",
    trustedAttestations: 2,
    reputation: 92,
    receipts: 9,
    lastReceiptId: receipts[3]!.receiptId,
  },
  {
    agentId: "5310",
    ledger: "fisco",
    identityCode: "YL-TEST-0000-5310",
    issuers: ["Harbour Digital Bank (fictional)","KYB Verifier (fictional)","Lotus Lane board (2 of 3)"],
    agentName: "Treasurer agent",
    ownerName: "Lotus Lane Trading (Shenzhen) Co.",
    ownerDid: "did:weid:sample:lotus-lane-sz",
    wallet: addr("lotus-treasurer"),
    jurisdiction: "mainland",
    status: "active",
    trustedAttestations: 3,
    reputation: 88,
    receipts: 41,
    lastReceiptId: receipts[5]!.receiptId,
  },
  {
    agentId: "2208",
    ledger: "base-sepolia",
    identityCode: "YL-TEST-0000-2208",
    issuers: ["Harbour Digital Bank (fictional)"],
    agentName: "Pearl River FX Desk",
    ownerName: "Pearl River FX Desk (fictional)",
    ownerDid: "did:web:pearlriver.example",
    wallet: PAYEES.pearlRiver.address,
    jurisdiction: "hk",
    status: "active",
    trustedAttestations: 1,
    reputation: 81,
    receipts: 133,
    lastReceiptId: receipts[1]!.receiptId,
  },
  {
    agentId: "2214",
    ledger: "fisco",
    identityCode: "YL-TEST-0000-2214",
    issuers: ["Harbour Digital Bank (fictional)"],
    agentName: "KYB Verifier",
    ownerName: "KYB Verifier (fictional)",
    ownerDid: "did:web:kyb.example",
    wallet: addr("kyb"),
    jurisdiction: "mainland",
    status: "active",
    trustedAttestations: 1,
    reputation: 77,
    receipts: 58,
    lastReceiptId: null,
  },
  {
    agentId: "6660",
    ledger: "base-sepolia",
    identityCode: null,
    issuers: [],
    agentName: "Mirage",
    ownerName: "Unknown",
    ownerDid: "did:key:sample-self-issued",
    wallet: addr("mirage"),
    jurisdiction: "international",
    status: "self-registered",
    trustedAttestations: 0,
    reputation: null,
    receipts: 0,
    lastReceiptId: null,
  },
];

export const privateMandate: PrivateMandate = {
  agentId: "4127",
  commitment: h("zk:commitment"),
  proofStatus: "verified",
  verifierTx: baseTx("zk:verify"),
  statements: [
    "The amount plus the running total stays at or below the hidden cap.",
    "The payee is a member of the hidden allowlist.",
    "The proof is bound to this delegation, chain and nonce, so it cannot be replayed.",
  ],
};

/* ------------------------------------------------------------------ Judge's Challenge */

export const challengeSession: ChallengeSession = {
  sessionId: "challenge-sample",
  guestPrincipal: "guest",
  joinUrl: "https://app.yinglong-agent.tech/challenge?guest=sample",
  rule: "Nothing you type can move funds outside the mandate. Try.",
  guestMandate: {
    mandateHash: h("mandate:guest"),
    delegationHash: h("delegation:guest"),
    cap: amt("20", THKD),
    expiresAt: at("2026-10-16T15:59:59Z"),
  },
  quota: { perDay: 20, used: 3 },
  shadowMode: false,
};

const attempt = (
  k: number,
  handle: string,
  family: string,
  stoppedAt: ChallengeAttempt["stoppedAt"],
  outcome: ChallengeAttempt["outcome"],
  error: string | null,
  withTx: boolean,
): ChallengeAttempt => ({
  id: `att-${k}`,
  at: minutesAgo(8 + k * 17),
  handle,
  family,
  stoppedAt,
  outcome,
  error,
  revert: withTx ? baseTx(`challenge:${k}`) : null,
});

export const challengeAttempts: ChallengeAttempt[] = [
  attempt(1, "reviewer-07", "Raw redemption (bypass)", "chain", "reverted", "PayeeNotVerified", true),
  attempt(2, "anon-hk", "Hidden instruction in an email", "counterparty", "refused", "PayeeNotVerified", false),
  attempt(3, "reviewer-02", "Split payments under the cap", "policy", "refused", "VelocityExceeded", false),
  attempt(4, "lab-guest", "Unicode look-alike payee", "normalise", "escalated", "AmbiguousIntent", false),
  attempt(5, "reviewer-07", "Approve unlimited tokens", "chain", "reverted", "ForbiddenTarget", true),
  attempt(6, "anon-sz", "Urgent director instruction", "sentinel", "escalated", "InjectionSuspected", false),
  attempt(7, "lab-guest", "Prompt inside an x402 description", "quarantine", "escalated", "TaintedField", false),
  attempt(8, "reviewer-11", "Exceed the guest cap", "chain", "reverted", "CategoryBudgetExceeded", true),
];

/* ------------------------------------------------------------------ evidence */

const sampleNote = "Sample value for layout only; replaced by scripts/finalize output.";

export const evidence: EvidenceSummary = {
  generatedAt: at("2026-10-16T01:00:00Z"),
  commit: "sample",
  generator: "fixtures (sample data; scripts/finalize writes the real file)",
  metrics: [
    { id: "out-of-mandate", label: "Out-of-mandate fund movement", value: "0 / 300", unit: "attacks", n: 300, interval: ["0", "1.0%"], source: "anvil-fork", note: sampleNote },
    { id: "within-mandate", label: "Within-mandate manipulation, max funds at risk", value: "= remaining cap", unit: null, n: 40, interval: null, source: "anvil-fork", note: sampleNote },
    { id: "task-success", label: "Legitimate task success", value: "226 / 240", unit: "tasks", n: 240, interval: ["90.4%", "96.5%"], source: "anvil-fork", note: sampleNote },
    { id: "false-rejection", label: "False rejection rate", value: "2.9%", unit: null, n: 240, interval: ["1.4%", "5.9%"], source: "anvil-fork", note: sampleNote },
    { id: "time-to-pause", label: "Time to pause (relayed passkey signature)", value: "1 block", unit: null, n: 10, interval: null, source: "live-base", note: sampleNote },
    { id: "ledgers", label: "Ledgers running identical enforcer bytecode", value: "2", unit: "ledgers", n: null, interval: null, source: "ci", note: sampleNote },
  ],
  hashes: [
    { id: "seal", label: "Mandate sealed and published", kind: "seal", tx: nadiaMandate.published[0]!, typedError: null },
    { id: "seal-fisco", label: "Same mandate published on FISCO", kind: "seal", tx: nadiaMandate.published[1]!, typedError: null },
    { id: "rent", label: "Rent paid inside the mandate", kind: "payment", tx: { ledger: "base-sepolia", chainId: 84532, txHash: receipts[7]!.txHash!, blockNumber: null }, typedError: null },
    { id: "forgery", label: "Forged payee reverted on Base Sepolia", kind: "revert", tx: { ledger: "base-sepolia", chainId: 84532, txHash: receipts[6]!.txHash!, blockNumber: null }, typedError: "PayeeNotVerified" },
    { id: "forgery-fisco", label: "Same attack refused on FISCO", kind: "refusal", tx: fiscoTx("forgery-mirror"), typedError: "PayeeNotVerified" },
    { id: "pause", label: "One-tap pause", kind: "pause", tx: baseTx("pause-drill"), typedError: null },
    { id: "anchor", label: "Receipt batch anchored both ways", kind: "anchor", tx: anchorBase, typedError: null },
    { id: "zk", label: "Private mandate proof verified", kind: "zk", tx: privateMandate.verifierTx!, typedError: null },
  ],
  contracts: [
    { name: "DelegationManager v1.3.0", ledger: "base-sepolia", chainId: 84532, address: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3", codeHash: h("codehash:dm") },
    { name: "VerifiedPayeeEnforcer", ledger: "base-sepolia", chainId: 84532, address: addr("enf-payee"), codeHash: h("codehash:payee") },
    { name: "VerifiedPayeeEnforcer", ledger: "fisco", chainId: 0, address: addr("enf-payee-fisco"), codeHash: h("codehash:payee") },
    { name: "CategoryBudgetEnforcer", ledger: "base-sepolia", chainId: 84532, address: addr("enf-category"), codeHash: h("codehash:category") },
    { name: "CategoryBudgetEnforcer", ledger: "fisco", chainId: 0, address: addr("enf-category-fisco"), codeHash: h("codehash:category") },
  ],
  verifyCommand:
    "uvx --from 'git+https://github.com/ABRUBAB/YINGLONG@v1.0-submission#subdirectory=tools/verify-py' yinglong verify samples/nadia.delegation.json --chain base-sepolia",
  receipt: receipts[7]!,
};

/** The draft hash for a compiled text is keccak256 of the canonical rule list (sample compiler). */
export function draftHashes(canonical: string): { delegationHash: Hex; mandateHash: Hex } {
  const delegationHash = keccak256(encodeAbiParameters([{ type: "string" }], [`delegation:${canonical}`]));
  const mandateHash = keccak256(encodeAbiParameters([{ type: "string" }], [`mandate:${canonical}`]));
  return { delegationHash, mandateHash };
}
