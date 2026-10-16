/**
 * Live adapter against wire payloads shaped exactly like the agent service contract
 * (docs/API.md). fetch is mocked; nothing leaves the process.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256, toHex } from "viem";
import { createLiveApi } from "./live";
import * as V from "./view";
import { hashRingGeometry } from "@yinglong/ui/hash-ring";
import { typedDataDigest } from "../signing-guard";
import { cosignTypedData } from "../chain";

const H = (s: string) => keccak256(toHex(s));
const A = (s: string) => `0x${H(s).slice(26)}`;

const principal = {
  id: "nadia",
  kind: "person",
  name: "Nadia Rahman",
  account: A("acct"),
  did: "did:pkh:eip155:84532:" + A("acct"),
  ledger: "base-sepolia",
  jurisdiction: "hk",
  signer: "passkey (WebAuthn)",
  agent: { label: "Ying", wallet: A("ying"), agentId: "4127", passportStatus: "active", identityCode: "YL-TEST-0000-4127" },
  paused: false,
};
const company = { ...principal, id: "lotus-sz", kind: "company", name: "Lotus Lane Trading (Shenzhen) Co.", ledger: "fisco", jurisdiction: "mainland", signer: "2-of-3 directors", agent: { ...principal.agent, label: "Treasurer", agentId: "5310" } };

const ring = hashRingGeometry(H("delegation"));
const mandateView = {
  mandateHash: H("mandate"),
  delegationHash: H("delegation"),
  lineageId: "nadia-1",
  version: 3,
  status: "live",
  jurisdiction: "hk",
  validFrom: "2026-10-02T04:00:00Z",
  validUntil: "2027-01-31T15:59:59Z",
  publishTx: H("publish"),
  explorerUrl: "https://sepolia.basescan.org/tx/" + H("publish"),
  ledger: "base-sepolia",
  sentences: ["Spend at most 3,000.00 tHKD on food each month."],
  userSentences: ["Keep food under 3,000 a month."],
  rules: [{ enforcer: "CategoryBudgetEnforcer", kind: "category-budget", sentence: "Spend at most 3,000.00 tHKD on food each month.", params: { category: "food", cap: "3000000000", period: 2592000 } }],
  roundTrip: { ok: true, checks: [{ name: "decode", ok: true, detail: "1 of 1 sentences match" }] },
  hashRing: { ticks: ring.ticks.map((t) => ({ ...t, nibble: 0 })), arcs: ring.arcs },
  sealedBy: "passkey",
};
const state = {
  principal,
  balances: [{ symbol: "tHKD", address: A("thkd"), decimals: 6, amount: "14250000000" }],
  mandate: mandateView,
  budgets: [{ symbol: "tHKD", category: "food", cap: "3000000000", spent: "1846500000", periodLengthSeconds: 2592000, periodEndsAt: "2026-10-31T15:59:59Z" }],
  tiers: [{ symbol: "tHKD", defaultT1Cap: "2000000000", newPayeeT1Cap: "0", t2Ceiling: "50000000000", categoryT1Caps: [] }],
  reserveFloors: [{ symbol: "tHKD", amount: "1500000000" }],
  velocity: { symbol: "tHKD", windowSeconds: 86400, maxCount: 6, maxOutflow: "12000000000", count: 2, outflow: "4236800000" },
  payees: [{ id: "hbu-bursar", label: "HBU Bursar", address: A("hbu"), category: "tuition" }],
  paused: false,
  block: 31884517,
};
const scales = Array.from({ length: 9 }, (_, k) => ({ n: k + 1, name: `Scale ${k + 1}`, status: k === 5 ? "stopped" : k > 5 ? "skipped" : "passed", reason: k === 5 ? "Not in the PayeeBook" : null, typedError: k === 5 ? "PayeeNotVerified" : undefined }));
const proposal = {
  id: "prop-1",
  principal: "nadia",
  request: "Pay 500 to 0xabc",
  intent: { summary: "Pay a new address" },
  language: "en",
  plan: [{ step: 1, description: "Resolve the payee" }],
  tier: "T4",
  decision: "refused",
  scales,
  explanation: { text: "Refused: the address is not a verified payee.", aiGenerated: true, model: "qwen3.5-9b" },
  payment: { symbol: "tHKD", decimals: 6, amount: "500000000", payee: { label: "Unknown", address: A("x") }, method: "transfer" },
  simulation: { ok: false, block: 31884517 },
  createdAt: "2026-10-16T01:00:00Z",
};
const receipt = {
  receiptId: "r-1",
  principal: "nadia",
  ledger: "base-sepolia",
  chainId: 84532,
  source: "live-base",
  tier: "T1",
  outcome: "confirmed",
  txHash: H("tx"),
  explorerUrl: "https://sepolia.basescan.org/tx/" + H("tx"),
  mandateHash: H("mandate"),
  delegationHash: H("delegation"),
  intentHash: H("intent"),
  agentId: 4127,
  payment: { symbol: "tHKD", decimals: 6, amount: "236800000", payee: { id: "kowloon-fresh", label: "Kowloon Fresh Market", address: A("kf") }, method: "transfer" },
  explanation: { text: "Inside the food budget.", aiGenerated: true, model: "qwen3.5-9b" },
  aigc: { label: "AI-generated", model: "qwen3.5-9b", provider: "local" },
  prevReceiptHash: H("prev"),
  receiptHash: H("receipt"),
  timestamp: "2026-10-15T11:42:00Z",
  anchor: { batchId: 312, root: H("root"), base: { txHash: H("anchor-base"), explorerUrl: null }, fisco: { txHash: H("anchor-fisco") } },
  proof: [H("sib1"), H("sib2")],
};
const td = cosignTypedData({ chainId: 84532, ledgerName: "base-sepolia", verifyingContract: A("cosign") as `0x${string}`, delegationHash: H("delegation"), executionCallData: "0x1234", nonce: 7n, expiry: 1793404800n });
const approval = {
  id: "apr-1",
  principal: "nadia",
  proposalId: "prop-2",
  kind: "cosign",
  decoded: { target: A("pp"), targetLabel: "Protected Payment", method: "deposit(address,uint256,bytes32)", payeeLabel: "HBU Bursar", payeeAddress: A("hbu"), symbol: "tHKD", decimals: 6, amount: "20000000000" },
  typedData: td,
  digest: typedDataDigest(td),
  expiresAt: "2026-10-16T02:00:00Z",
  status: "pending",
};
const narration = { text: "Nadia Rahman, one day is left in this budget period.", aiGenerated: true, label: "AI-generated", model: "qwen3.7-flash", provider: "dashscope" };
const escrow = {
  escrowId: 0,
  ledger: "fisco",
  payer: A("acct"),
  payee: { address: A("hbu"), id: "hbu_bursar", label: "HBU Bursar" },
  token: { address: A("thkd"), symbol: "tHKD", decimals: 6 },
  amount: "5000000000",
  conditionId: H("condition"),
  releaseAttester: { address: A("hbu-attester"), label: "Harbour Bay University (fictional)", heldByService: true },
  createdAt: "2026-10-15T21:24:36.000Z",
  refundAfter: "2026-11-14T21:24:32.000Z",
  state: "held",
  canRelease: true,
  canRefundNow: false,
};
const credentialWire = {
  id: H("credential"),
  principal: "nadia",
  ledger: "fisco",
  issuer: A("bank"),
  issuerLabel: "Harbour Digital Bank (fictional)",
  typedData: {
    domain: { name: "YINGLONG Payment Reliability", version: "1", chainId: 20200 },
    message: { subject: "did:pkh:eip155:20200:" + A("acct"), onTimePayments: 1, periodStart: "1792108800", periodEnd: "1792195200", receiptIds: [H("r-rent")], issuedAt: "1792130000", statement: "test credential issued by a fictional bank; not a credit score" },
  },
  signature: "0x" + "ab".repeat(65),
  anchorReceiptId: H("anchor"),
  rule: "on-time rent",
  label: "test credential issued by a fictional bank; not a credit score",
  issuedAt: "2026-10-16T01:00:00.000Z",
};
const forecastWire = {
  symbol: "CNY",
  decimals: 2,
  horizonDays: 2,
  start: { posted: "100000000", pending: "0" },
  reserveFloor: "90000000",
  events: [{ day: 0, date: "2026-10-16T01:40:11.000Z", kind: "payroll", label: "payroll to Staff payroll account", amount: "12000000" }],
  supplierRunRatePerDay: "2430000",
  daily: [
    { day: 0, date: "2026-10-16T01:40:11.000Z", outflow: "12000000", balance: "88000000", belowFloor: true },
    { day: 1, date: "2026-10-17T01:40:11.000Z", outflow: "2430000", balance: "85570000", belowFloor: true },
    { day: 2, date: "2026-10-18T01:40:11.000Z", outflow: "90000000", balance: "-4430000", belowFloor: true },
  ],
  minBalance: "-4430000",
  headroomAboveFloor: "-94430000",
  firstBreach: { day: 0, date: "2026-10-16T01:40:11.000Z", balance: "88000000", shortfall: "2000000" },
  flags: ["Projected balance falls below the reserve floor on day 0."],
  velocity: { windowSeconds: "86400", windowEndsAt: "2026-10-17T00:00:00.000Z", maxCount: 6, used: 6, countLeft: 0, maxOutflow: "25000000", outflow: "8700000", outflowLeft: "16300000" },
  ledger: "fisco",
  block: "467",
  rail: "coin-free instructions (e-CNY-style simulator)",
  explanation: { text: "Template.", aiGenerated: false, label: "template text (deterministic)", model: "none (template)", provider: "none", fallbackReason: "model unavailable" },
  label: "Coin-free instructions and test units.",
};
const routes: Record<string, unknown> = {
  "GET /v1/health": { ok: true, version: "0.3.0", ledgers: [{ name: "base-sepolia", chainId: 84532, block: 31884517, badge: "Base Sepolia" }, { name: "fisco", chainId: 20200, block: "1204639", badge: "FISCO BCOS" }], models: { intent: { provider: "openrouter", model: "qwen3.7-flash" }, sentinel: { model: "mmbert-sentinel" } } },
  "GET /v1/principals": [principal, company],
  "GET /v1/principals/nadia/state": state,
  "GET /v1/principals/lotus-sz/state": { ...state, principal: company, payees: [] },
  "POST /v1/principals/nadia/ask": proposal,
  "GET /v1/receipts?principal=nadia&limit=50": [receipt],
  "GET /v1/receipts?principal=lotus-sz&limit=30": [{ ...receipt, ledger: "fisco", chainId: 20200, source: "live-fisco", outcome: "reverted", revertError: { name: "VelocityExceeded", args: [], message: "velocity" } }],
  "GET /v1/receipts/r-1": receipt,
  "GET /proof/r-1?verify=1": {
    receiptHash: H("receipt"),
    batchId: 0,
    index: 3,
    proof: [H("sib1"), H("sib2")],
    root: H("root"),
    anchors: [{ ledger: "fisco", txHash: H("anchor-fisco"), blockNumber: "303", onchainBatchId: 1 }],
    valid: true,
    onChain: { ledger: "fisco", onchainBatchId: 1, valid: true },
  },
  "GET /v1/board-proposals?principal=lotus-sz": [
    { id: "bp-1", principal: "lotus-sz", ledger: "fisco", title: "Equipment purchase", payee: { id: "shenzhen_components", label: "Shenzhen Components", address: A("sc") }, amount: "18600000", decimals: 2, symbol: "CNY", op: {}, digest: H("op"), threshold: 2, signatures: [{ director: "director-1", address: A("d1"), signature: "0x01", signedAt: "2026-10-16T00:00:00Z" }], status: "collecting", createdAt: "2026-10-16T00:00:00Z" },
  ],
  "GET /v1/approvals?principal=nadia": [approval],
  "GET /v1/approvals?principal=lotus-sz": [{ ...approval, id: "apr-board", principal: "lotus-sz", signatures: [{ signer: "director-1", signedAt: "2026-10-16T00:00:00Z" }], threshold: 2 }],
  "GET /v1/approvals/apr-1": approval,
  "POST /v1/principals/nadia/pause": { approvalId: "apr-pause" },
  "GET /v1/approvals/apr-pause": { ...approval, id: "apr-pause", kind: "pause", decoded: null },
  "GET /v1/registry/agents": [{ agentId: "4127", wallet: A("ying"), label: "Ying", ownerDidHash: H("did"), identityCode: "YL-TEST-0000-4127", status: "active", attestations: [{ issuer: "did:web:hbu.example", issuerLabel: "HBU", claimHash: H("claim"), expiresAt: "2027-08-31T00:00:00Z" }], ledger: "base-sepolia" }, { agentId: "6660", wallet: A("mirage"), label: "Mirage", ownerDidHash: H("m"), status: "active", attestations: [], ledger: "base-sepolia" }],
  "GET /v1/principals/nadia/insights?explain=1": {
    period: { start: "2026-10-16T00:00:00.000Z", end: "2026-10-17T00:00:00.000Z", lengthSeconds: 86400, secondsLeft: 80389, daysLeft: 1, timeCompressed: true },
    categories: [
      { symbol: "tHKD", decimals: 6, category: "food", kind: "variable", cap: "3000000000", spent: "2700000000", remaining: "300000000", usedBps: 9000, forecastPeriodEnd: "3000000000", forecastMethod: "run-rate", wouldReachCapAt: "2026-10-16T02:40:00.000Z", status: "would reach the cap before the period ends" },
    ],
    topPayees: [{ label: "Kowloon Food Mart", address: A("kf"), symbol: "tHKD", decimals: 6, amount: "2700000000", payments: 2, receiptIds: [H("r-food")] }],
    totals: [{ symbol: "tHKD", decimals: 6, cap: "3000000000", spent: "2700000000", forecastPeriodEnd: "3000000000" }],
    block: "467",
    ledger: "fisco",
    explanation: narration,
    label: "Test units.",
  },
  "GET /v1/principals/nadia/coverage": {
    obligations: [
      { payeeId: "hbu_bursar", payeeLabel: "HBU Bursar", category: "tuition", cadence: "one-off", symbol: "tHKD", decimals: 6, upTo: "12000000000", protection: "escrow-protected", escrowIds: [0], refundableAfter: "2026-11-14T21:24:32.000Z", why: "Held in escrow." },
    ],
    coverItems: [{ item: "medical cover", status: "none on record", gap: true, note: "A checklist item, not advice." }],
    gaps: ["medical cover: none on record"],
    summary: { protected: 1, unprotected: 0, settled: 0, gaps: 1 },
    label: "Test units and fictional institutions.",
    block: "467",
    ledger: "fisco",
  },
  "GET /v1/principals/nadia/escrows": { escrows: [escrow], block: "467", contract: A("pp") },
  "POST /v1/principals/nadia/escrows/0/release": { escrow: { ...escrow, state: "released", canRelease: false }, receipt },
  "GET /v1/principals/nadia/credentials": [credentialWire],
  [`GET /v1/credentials/${H("credential")}/verify`]: {
    credentialHash: H("credential"),
    valid: true,
    signatureValid: true,
    recovered: A("bank"),
    issuer: A("bank"),
    issuerLabel: "Harbour Digital Bank (fictional)",
    trustedIssuer: true,
    receipts: [{ receiptId: H("r-rent"), found: true, intact: true, confirmed: true, toRentPayee: true, ownReceipt: true, txHash: H("tx-rent"), ledger: "fisco", ok: true }, { receiptId: H("r-missing"), found: false, ok: false }],
    anchorReceiptId: H("anchor"),
    anchorCommitsCredential: true,
    label: "test credential issued by a fictional bank; not a credit score",
  },
  "GET /v1/principals/lotus-sz/forecast?days=30&explain=1": forecastWire,
  "POST /v1/principals/lotus-hk/ask": {
    ...proposal,
    id: "prop-sweep",
    principal: "lotus-hk",
    request: "Sweep 10,000 HKD into the Test Growth Fund",
    suitability: {
      product: { id: "test_growth", label: "Test Growth Fund", address: A("growth"), onChainName: "Test Growth Fund (risk class 5)", nameMatchesRegistry: true },
      listed: true,
      riskClass: 5,
      riskLabel: "highest",
      mandateMaxRiskClass: 2,
      mandateMaxLabel: "low",
      verdict: "unsuitable",
      outcome: "refused",
      why: ["Class 5 is above 2."],
      source: { registry: A("registry"), function: "productInfo", enforcer: "SuitabilityEnforcer", block: "467", ledger: "fisco" },
      label: "Test products only; no real fund is represented.",
    },
  },
  [`GET /v1/tx/fisco/${H("tx-reverted")}`]: {
    ledger: "fisco",
    ledgerBadge: "FISCO BCOS (team-run consortium ledger)",
    chainId: 20200,
    hash: H("tx-reverted"),
    status: "reverted",
    blockNumber: "328",
    from: A("relayer"),
    to: A("dm"),
    toName: "DelegationManager",
    gasUsed: "664174",
    call: { contract: "DelegationManager", function: "redeemDelegations", args: "(permission contexts, modes, executions)" },
    events: [],
    revert: { name: "CategoryBudgetExceeded", args: [2, "4600000000", "3000000000"], message: "CategoryBudgetExceeded(2, 4600000000, 3000000000)", raw: "0xe6e79e50" },
    revertSource: "native receipt (exact revert data as executed)",
  },
  "GET /v1/evidence": { generatedAt: "2026-10-16T01:00:00Z", items: [{ beat: 6, title: "Forged payee reverted", ledger: "base-sepolia", txHash: H("ev"), explorerUrl: null, outcome: "reverted", revertError: { name: "PayeeNotVerified" } }] },
  "GET /v1/proof": {
    schema: "yinglong.proof/1",
    generatedAt: "2026-10-16T19:20:00Z",
    build: { repo: "https://github.com/ABRUBAB/YINGLONG", commit: "8812f4ef7d4de50ab73e039eb2b473ba0fedae6e", commitUrl: "https://github.com/ABRUBAB/YINGLONG/commit/8812f4ef7d4de50ab73e039eb2b473ba0fedae6e" },
    service: { startedAt: "2026-10-16T18:00:00Z", uptimeSeconds: 4800, health: "/v1/health", evidence: "/v1/evidence" },
    chain: {
      ledgers: [
        {
          ledger: "fisco",
          label: "FISCO BCOS 3.17.1 (consortium ledger)",
          chainId: 20200,
          contractCount: 3,
          contracts: [
            { name: "EntryPoint", address: A("ep-f"), codeHash: H("ep-fisco"), explorerUrl: null },
            { name: "VerifiedPayeeEnforcer", address: A("vp-f"), codeHash: H("vp"), explorerUrl: null },
            { name: "CategoryBudgetEnforcer", address: A("cb-f"), codeHash: H("cb"), explorerUrl: null },
          ],
        },
        {
          ledger: "base-sepolia",
          label: "Base Sepolia (public testnet)",
          chainId: 84532,
          contractCount: 3,
          contracts: [
            { name: "EntryPoint", address: A("ep-b"), codeHash: H("ep-base"), explorerUrl: `https://sepolia.basescan.org/address/${A("ep-b")}` },
            // Same bytecode, different hex case: equality must not depend on case.
            { name: "VerifiedPayeeEnforcer", address: A("vp-b"), codeHash: `0x${H("vp").slice(2).toUpperCase()}`, explorerUrl: null },
            { name: "CategoryBudgetEnforcer", address: A("cb-b"), codeHash: H("cb"), explorerUrl: null },
          ],
        },
        { ledger: "anvil", label: "Local Anvil (bench)", deployed: false },
      ],
      bytecode: { compared: 3, identical: 2, differ: ["EntryPoint"] },
    },
    transactions: {
      counts: { fisco: { confirmed: 4, reverted: 1 }, "base-sepolia": { confirmed: 2 } },
      latest: [
        { receiptId: H("r1"), ledger: "base-sepolia", outcome: "reverted", tier: "T4", title: "Forged payee reverted", txHash: H("tx1"), explorerUrl: null, revertError: "PayeeNotVerified", at: "2026-10-16T19:00:00Z", auditUrl: `/v1/receipts/${H("r1")}/audit` },
        { receiptId: H("r2"), ledger: "fisco", outcome: "confirmed", tier: "T1", title: "Rent paid", txHash: H("tx2"), explorerUrl: null, revertError: null, at: "2026-10-16T18:30:00Z", auditUrl: `/v1/receipts/${H("r2")}/audit` },
      ],
    },
    ml: {
      sentinel: {
        model: "ABRUBAB/yl-sentinel-mmbert-base",
        revision: "1062546bb103606fd85df8ea348d5d803304de26",
        arm: "mmbert",
        threshold: 0.2,
        test: { n: 2099, positives: 1169, negatives: 930, macro_f1: 0.9672, macro_f1_ci95_bootstrap: [0.9599, 0.9745], recall: 0.9624, recall_ci95: [0.9498, 0.9718], specificity: 0.9742, specificity_ci95: [0.9619, 0.9826] },
        perLanguage: {
          bn: { n: 310, positives: 164, negatives: 146, macro_f1: 0.9838, macro_f1_ci95_bootstrap: [0.9677, 0.9968], recall: 0.9817, recall_ci95: [0.9476, 0.9938], specificity: 0.9863, specificity_ci95: [0.9514, 0.9962] },
          en: { n: 1480, positives: 822, negatives: 658, macro_f1: 0.9591, macro_f1_ci95_bootstrap: [0.9485, 0.9689], recall: 0.9526, recall_ci95: [0.9358, 0.9651], specificity: 0.9681, specificity_ci95: [0.9517, 0.979] },
        },
        confusion: { tp: 1125, fn: 44, tn: 906, fp: 24, derivedFrom: "recall x positives and specificity x negatives, rounded" },
        training: { base: "jhu-clsp/mmBERT-base", epochs: 3, train_rows: 19371, train_secs: 1394, best_metric: 0.9723 },
        served: { int8_sha256: "8775f388fc9eea0c", int8_onnx_mb: 869.7, quantization: "weight-only int8" },
        arms: [{ file: "m1_sentinel_protectai_v2.json", arm: "protectai_v2", test: { n: 2099, positives: 1169, negatives: 930, macro_f1: 0.7453, macro_f1_ci95_bootstrap: [0.73, 0.76], recall: 0.7203, recall_ci95: [0.7, 0.74], specificity: 0.7785, specificity_ci95: [0.75, 0.8] }, curves: null }],
        curves: {
          repo: "ABRUBAB/yl-sentinel-mmbert-base",
          revision: "1062546bb103606fd85df8ea348d5d803304de26",
          file: "checkpoints/last/trainer_state.json",
          // Out of order on purpose: the mapper sorts by step.
          points: [
            { step: 606, epoch: 1, eval_loss: 0.0844, eval_macro_f1: 0.9723 },
            { step: 50, epoch: 0.08, loss: 0.467, learning_rate: 0.00002, grad_norm: 10.1 },
            { step: 100, epoch: 0.17, loss: 0.176 },
          ],
        },
      },
      intent: [
        {
          model: "qwen3-4b",
          base: "Qwen/Qwen3-4B",
          hfRepo: "ABRUBAB/yl-intent-qwen3-4b",
          revision: "3bd7578d4d39918adf8376c2ed2322b94139b58e",
          trainRows: null,
          trainSeconds: null,
          finalTrainLoss: 0.0035,
          epochs: 2,
          test: { n: 1255, json_validity: 0.9992, json_validity_ci95: [0.9955, 0.9999], exact_match: 0.8876, exact_match_ci95: [0.869, 0.904], slot_precision: 0.9816, slot_recall: 0.9807, slot_f1: 0.9812 },
          curves: { repo: "ABRUBAB/yl-intent-qwen3-4b", revision: "3bd7578d", file: "trainer_state.json", points: [{ step: 20, epoch: 0.03, loss: 0.343 }, { step: 40, epoch: 0.06, loss: 0.12 }] },
        },
      ],
      anomaly: {
        model: "M3 behaviour anomaly",
        escalatesOnly: true,
        heldoutFamily: "address_swap",
        test: { auroc_combined: 0.9944, auroc_isoforest: 0.9794, auroc_lightgbm: 0.9943, auprc_combined: 0.9864, false_escalation_rate: 0.0212, false_escalation_ci95: [0.0198, 0.0227], normal_actions: 38907 },
        perFamily: { address_swap: { n: 67, escalation_recall: 0.8657, recall_ci95: [0.764, 0.9277], auroc_combined: 0.9939, heldout: true } },
      },
      forecast: { model: "M5 cash-flow forecaster", horizonDays: 28, breachWindowDays: 14, quantiles: [0.05, 0.5, 0.95], methods: { lgbm_quantile: { pinball_loss_cny: 111483.2, coverage90_cqr: 0.8672 } }, brierClimatology: 0.1152 },
    },
    bench: {
      generatedAt: "2026-10-16T08:40:30.898Z",
      commit: "8812f4ef7d4de50ab73e039eb2b473ba0fedae6e",
      ledger: "Anvil bench (simulated)",
      understanding: "deterministic rule parser",
      metrics: {
        "bench.attacks.n": "300",
        "bench.oom.count": "0",
        "bench.oom.upper95": "1.0% (rule of three: 3/300)",
        "bench.family_table": "\n\n| Family | n | Out of mandate |\n|---|---|---|\n| `direct_injection` | 22 | 0 |\n| `within_mandate` | 22 | 0 |",
      },
      detail: { runs: 300 },
    },
    sources: { results: ["ml/results/m1_sentinel_mmbert.json", "bench/reports/summary.json"], resultsGeneratedAt: "2026-10-16T19:18:58.032Z" },
  },
};

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("https://api.test", "");
    const key = `${init?.method ?? "GET"} ${path}`;
    if (!(key in routes)) return new Response(JSON.stringify({ error: { code: "not_found", message: `no route ${key}` } }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live adapter maps the agent service wire format into the view model", () => {
  it("principal, passport, mandates, budgets", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test/");
    V.Health.parse(await api.health());
    const me = V.Principal.parse(await api.me());
    expect(me.agentName).toBe("Ying");
    const passport = V.Passport.parse(await api.passport("4127"));
    expect(passport.identityCode.placeholder).toBe(true);
    const [m] = (await api.mandates()) as V.Mandate[];
    V.Mandate.parse(m);
    expect(m!.serviceHashRing!.ticks).toHaveLength(64);
    expect(m!.published[0]!.explorerUrl).toContain("basescan");
    const lanes = (await api.budgets()) as V.BudgetLane[];
    expect(lanes.map((l) => l.label)).toEqual(["Food", "Out today"]);
    expect(lanes[1]!.floor!.value).toBe("1500000000");
  });

  it("ask, receipts and proofs", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const d = V.Decision.parse(await api.ask({ text: "Pay 500 to 0xabc" }));
    expect(d.outcome).toBe("refused");
    expect(d.scales[5]).toMatchObject({ scale: "counterparty", status: "stopped", error: "PayeeNotVerified" });
    const page = await api.receipts();
    const r = V.Receipt.parse((page as { items: V.Receipt[] }).items[0]);
    expect(r.summary).toBe("Payment to Kowloon Fresh Market");
    expect(r.agentId).toBe("4127");
    const proof = V.MerkleProof.parse(await api.receiptProof("r-1"));
    expect(proof.pairing).toBe("sorted");
    expect(proof.anchors.map((a) => a.ledger)).toEqual(["fisco"]);
    expect(proof.anchors[0]!.root).toBe(proof.root);
  });

  it("approvals resolve the payee against the PayeeBook; pause produces a signing request", async () => {
    // The wire approval expires at 02:00 UTC on 16 Oct 2026; read it before that, as the adapter
    // (correctly) drops pending requests past their deadline.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T01:30:00Z"));
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const [a] = (await api.approvals()) as V.ApprovalRequest[];
    V.ApprovalRequest.parse(a);
    expect(a!.decoded!.payee).toMatchObject({ name: "HBU Bursar", source: "PayeeBook", verified: true });
    const req = V.SigningRequest.parse(await api.requestPause("pause"));
    expect(req.kind).toBe("pause");
  });

  it("drops a pending approval once its deadline has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T02:00:01Z"));
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    expect(await api.approvals()).toEqual([]);
    expect((await api.approval("apr-1")).status).toBe("expired");
  });

  it("treasury, registry, evidence", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const t = V.TreasuryView.parse(await api.treasury("lotus-sz"));
    expect(t.entity.threshold).toBe(2);
    expect(t.proposals[0]!.signatures).toHaveLength(1);
    expect(t.instructions[0]).toMatchObject({ status: "rejected", rejectError: "VelocityExceeded" });
    const reg = (await api.registry()) as V.RegistryAgent[];
    expect(reg.find((x) => x.agentName === "Mirage")!.status).toBe("self-registered");
    const ev = V.EvidenceSummary.parse(await api.evidence());
    expect(ev.hashes[0]).toMatchObject({ kind: "revert", typedError: "PayeeNotVerified" });
  });

  it("proof bundle: enforcers first, equality from the hashes, absolute audit links, the bench table parsed", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const p = V.ProofBundle.parse(await api.proof());
    expect(p.build).toMatchObject({ commit: expect.stringMatching(/^8812f4ef/), commitUrl: expect.stringContaining("/commit/8812f4ef") });
    expect(p.service.uptimeSeconds).toBe(4800);
    expect(p.chain.ledgers.map((l) => [l.ledger, l.deployed])).toEqual([
      ["fisco", true],
      ["base-sepolia", true],
      ["anvil-bench", false],
    ]);
    expect(p.chain.pairs.map((x) => x.name)).toEqual(["CategoryBudgetEnforcer", "VerifiedPayeeEnforcer", "EntryPoint"]);
    expect(p.chain.pairs.map((x) => x.identical)).toEqual([true, true, false]);
    expect(p.chain.bytecode).toEqual({ compared: 3, identical: 2, differ: ["EntryPoint"] });
    expect(p.transactions.counts.find((c) => c.ledger === "fisco")).toEqual({
      ledger: "fisco",
      total: 5,
      outcomes: [
        { outcome: "confirmed", n: 4 },
        { outcome: "reverted", n: 1 },
      ],
    });
    expect(p.transactions.latest[0]).toMatchObject({ ledger: "base-sepolia", outcome: "reverted", tier: "T4", revertError: "PayeeNotVerified", auditUrl: `https://api.test/v1/receipts/${H("r1")}/audit` });
    const s = p.ml?.sentinel;
    expect(s?.test?.macroF1).toEqual({ value: 0.9672, interval: [0.9599, 0.9745] });
    expect(s?.perLanguage.map((l) => l.language)).toEqual(["en", "bn"]);
    expect(s?.confusion).toMatchObject({ tp: 1125, fn: 44, tn: 906, fp: 24 });
    expect(s?.training).toMatchObject({ base: "jhu-clsp/mmBERT-base", trainRows: 19371 });
    expect(s?.curves?.points.map((x) => x.step)).toEqual([50, 100, 606]);
    expect(s?.curves?.points[2]).toMatchObject({ evalMacroF1: 0.9723, loss: null, epoch: 1 });
    expect(s?.arms[0]).toMatchObject({ arm: "protectai_v2", curves: null });
    expect(p.ml?.intent[0]).toMatchObject({ model: "qwen3-4b", test: { exactMatch: { value: 0.8876 }, slotF1: 0.9812 } });
    expect(p.ml?.anomaly?.test?.falseEscalation).toEqual({ value: 0.0212, interval: [0.0198, 0.0227] });
    expect(p.ml?.anomaly?.perFamily[0]).toMatchObject({ family: "address_swap", heldout: true });
    expect(p.ml?.forecast?.methods[0]).toEqual({
      method: "lgbm_quantile",
      metrics: [
        { key: "pinball_loss_cny", value: 111483.2 },
        { key: "coverage90_cqr", value: 0.8672 },
      ],
    });
    expect(p.bench?.familyTable).toEqual({
      head: ["Family", "n", "Out of mandate"],
      rows: [
        ["direct_injection", "22", "0"],
        ["within_mandate", "22", "0"],
      ],
    });
    expect(p.bench?.metrics.map((m) => m.key)).toEqual(["bench.attacks.n", "bench.oom.count", "bench.oom.upper95"]);
    expect(p.sources.results).toHaveLength(2);
  });

  it("ping measures one uncached GET /v1/health and keeps the raw body", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, version: "1.2.3", ledgers: [], models: {} }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    const api = createLiveApi("https://api.test");
    const a = await api.ping();
    const b = await api.ping();
    expect(a).toMatchObject({ ok: true, status: 200, url: "https://api.test/v1/health", body: { version: "1.2.3" } });
    expect(typeof a.ms).toBe("number");
    expect(f).toHaveBeenCalledTimes(2);
    expect(b.ok).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    expect(await createLiveApi("https://api.test").ping()).toMatchObject({ ok: false, status: 0, body: null });
  });

  it("reports a missing endpoint honestly", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    await expect(api.privateMandate("4127")).rejects.toThrow(/no route|does not provide/);
    // An older deployment without /v1/proof: the page shows the evidence it already has.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404 })));
    await expect(createLiveApi("https://api.test").proof()).rejects.toMatchObject({ status: 404 });
  });

  it("shares identical GETs inside the cache window and clears the cache on a POST", async () => {
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    const api = createLiveApi("https://api.test");
    await Promise.all([api.me(), api.me(), api.budgets()]);
    const gets = () => f.mock.calls.filter(([u, i]) => (i?.method ?? "GET") === "GET" && String(u).endsWith("/v1/principals")).length;
    expect(gets()).toBe(1);
    await api.ask({ text: "Pay 500 to 0xabc" });
    await api.me();
    expect(gets()).toBe(2);
  });

  it("capability routes: insights, coverage, escrows, credentials, forecast, suitability, tx revert source", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const ins = V.SpendingInsights.parse(await api.insights());
    expect(ins.categories[0]).toMatchObject({ category: "food", status: "would reach the cap before the period ends" });
    expect(ins.categories[0]!.forecast.value).toBe("3000000000");
    expect(ins.explanation).toMatchObject({ aiGenerated: true, label: "AI-generated", model: "qwen3.7-flash" });
    const cov = V.Coverage.parse(await api.coverage());
    expect(cov.obligations[0]!.upTo).toMatchObject({ value: "12000000000", symbol: "tHKD" });
    const list = V.EscrowList.parse(await api.escrows());
    expect(list.escrows[0]!.amount.value).toBe("5000000000");
    const released = V.EscrowActionResult.parse(await api.releaseEscrow(0));
    expect(released.escrow.state).toBe("released");
    const [cred] = (await api.credentials()) as V.Credential[];
    V.Credential.parse(cred);
    expect(cred!.statement).toBe("test credential issued by a fictional bank; not a credit score");
    expect(cred!.periodStart).toBe(new Date(1792108800 * 1000).toISOString());
    const ver = V.CredentialVerification.parse(await api.verifyCredential(cred!.id));
    expect(ver.receipts.map((r) => r.ok)).toEqual([true, false]);
    const fc = V.CashForecast.parse(await api.forecast("lotus-sz"));
    expect(fc.daily.at(-1)!.balance).toBe("-4430000");
    expect(fc.explanation).toMatchObject({ aiGenerated: false, model: "none (template)", fallbackReason: "model unavailable" });
    expect(fc.velocity!.outflowLeft.value).toBe("16300000");
    const d = V.Decision.parse(await api.askAs("lotus-hk", { text: "Sweep 10,000 HKD into the Test Growth Fund" }));
    expect(d.suitability).toMatchObject({ verdict: "unsuitable", riskClass: 5, mandateMaxRiskClass: 2 });
    const tx = V.TxView.parse(await api.tx("fisco", H("tx-reverted")));
    expect(tx.revert!.name).toBe("CategoryBudgetExceeded");
    expect(tx.revertSource).toBe("native receipt (exact revert data as executed)");
    expect(tx.call!.args).toEqual(["(permission contexts, modes, executions)"]);
  });

  it("asks on the demo account without autoExecute (that needs the operator or the visitor's own token)", async () => {
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    const api = createLiveApi("https://api.test");
    await api.ask({ text: "Pay 500 to 0xabc" });
    const [, init] = f.mock.calls.find(([u, i]) => String(u).endsWith("/ask") && i?.method === "POST")!;
    expect(JSON.parse(String(init!.body))).toEqual({ text: "Pay 500 to 0xabc" });
  });

  it("falls back to the sealed mandate when the service cannot draft from free text", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const d = V.MandateDraft.parse(await api.compileMandate({ text: "Keep food under 3,000 a month", jurisdiction: "hk" }));
    expect(d.wire).toBeUndefined();
    expect(d.warnings[0]).toMatch(/does not draft mandates/);
    await expect(api.requestSeal(d)).rejects.toThrow(/no new mandate document/);
  });
});
