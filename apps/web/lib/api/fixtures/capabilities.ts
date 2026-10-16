/**
 * SAMPLE DATA for the capability panels (docs/API.md section 3.10) in fixtures mode only: spending
 * insights, coverage, escrows, the payment-reliability credential, the 30-day cash forecast and the
 * suitability card. Amounts follow the sample budgets in ./data so every panel tells the same story;
 * the forecast is computed here with the same deterministic rule as the agent service.
 */
import type {
  Amount,
  CashForecast,
  Coverage,
  Credential,
  CredentialVerification,
  Decision,
  Escrow,
  ForecastEvent,
  ScaleResult,
  SpendingInsights,
  Suitability,
  TreasuryView,
} from "../view";
import { SCALE_IDS } from "../view";
import { formatUnits, parseUnits } from "../../format";
import { NADIA_ACCOUNT, PAYEES, PROTECTED_PAYMENT } from "./data";
import { addr, amt, at, CNYT, daysAgo, h, minutesAgo, NOW, THKD } from "./util";

const SAMPLE_MODEL = "qwen3.5-9b-instruct-q4 (sample)";
const narration = (text: string) => ({ text, aiGenerated: true, label: "AI-generated", model: SAMPLE_MODEL, provider: "local", fallbackReason: null });
const units = (a: Amount) => BigInt(a.value);
const same = (a: Amount, v: bigint): Amount => ({ ...a, value: v.toString() });

/* ------------------------------------------------------------------ Nadia: insights */

const PERIOD = { start: at("2026-09-30T16:00:00Z"), end: at("2026-10-31T16:00:00Z") };
const daysLeft = Math.ceil((Date.parse(PERIOD.end) - NOW) / 86_400_000);

function category(
  name: string,
  kind: SpendingInsights["categories"][number]["kind"],
  cap: Amount,
  spent: Amount,
  forecast: Amount,
  status: SpendingInsights["categories"][number]["status"],
  method: string,
  wouldReachCapAt: string | null = null,
) {
  const c = units(cap);
  const s = units(spent);
  return {
    category: name,
    kind,
    cap,
    spent,
    remaining: same(cap, c > s ? c - s : 0n),
    usedBps: c > 0n ? Number((s * 10_000n) / c) : 0,
    forecast,
    forecastMethod: method,
    wouldReachCapAt,
    status,
  };
}

const RUN_RATE = "run-rate: spent so far scaled to the whole period (at least a tenth of the period elapsed), capped by the budget the chain enforces";

export const insights: SpendingInsights = {
  period: { ...PERIOD, daysLeft, timeCompressed: false },
  categories: [
    category("rent", "scheduled", amt("9500", THKD), amt("9500", THKD), amt("9500", THKD), "at cap", "scheduled: the full amount is due every period"),
    category("food", "variable", amt("3000", THKD), amt("1846.50", THKD), amt("3000", THKD), "would reach the cap before the period ends", RUN_RATE, at("2026-10-24T09:00:00Z")),
    category("tuition", "one-off", amt("20000", THKD), amt("0", THKD), amt("0", THKD), "on track", "one-off spend: what is spent is the forecast"),
    category("transport", "variable", amt("400", THKD), amt("100", THKD), amt("193.75", THKD), "on track", RUN_RATE),
  ],
  topPayees: [
    { label: PAYEES.harbourHomes.name, address: PAYEES.harbourHomes.address, amount: amt("9500", THKD), payments: 1, receiptIds: [h("receipt:rent")] },
    { label: PAYEES.kowloonFresh.name, address: PAYEES.kowloonFresh.address, amount: amt("1846.50", THKD), payments: 7, receiptIds: [h("receipt:groceries")] },
    { label: PAYEES.mtr.name, address: PAYEES.mtr.address, amount: amt("100", THKD), payments: 1, receiptIds: [h("receipt:transit")] },
  ],
  totals: [{ cap: amt("32900", THKD), spent: amt("11446.50", THKD), forecast: amt("12693.75", THKD) }],
  explanation: narration(
    `Nadia Rahman, ${daysLeft} days are left in this budget period. Rent of 9,500 tHKD is paid and at its cap. Food is at 1,846.50 of 3,000 tHKD and, at this pace, would reach the cap before the period ends. Transport is on track at 100 of 400 tHKD. The tuition deposit of up to 20,000 tHKD has not been paid yet.`,
  ),
  ledger: "base-sepolia",
  block: "31884517",
  label: "Test units. Budgets are the caps sealed in the mandate and enforced on-chain; the forecast is a deterministic projection, not advice.",
};

/* ------------------------------------------------------------------ Nadia: escrows and coverage */

const HBU_RELEASER = { address: addr("hbu-enrolment-attester"), label: "Harbour Bay University (fictional)", heldByService: true };

export const escrows: Escrow[] = [
  {
    escrowId: 0,
    ledger: "base-sepolia",
    payee: { id: PAYEES.hbu.id, label: PAYEES.hbu.name, address: PAYEES.hbu.address },
    amount: amt("5000", THKD),
    conditionId: h("condition:hbu-enrolment-2026"),
    releaseAttester: HBU_RELEASER,
    createdAt: daysAgo(6, "10:20"),
    refundAfter: at("2026-11-09T02:20:00Z"),
    state: "held",
    canRelease: true,
    canRefundNow: false,
    fundingReceiptId: null,
  },
  {
    escrowId: 1,
    ledger: "base-sepolia",
    payee: { id: PAYEES.hbu.id, label: PAYEES.hbu.name, address: PAYEES.hbu.address },
    amount: amt("1200", THKD),
    conditionId: h("condition:hbu-orientation-2026"),
    releaseAttester: HBU_RELEASER,
    createdAt: daysAgo(40, "09:00"),
    refundAfter: at("2026-10-06T01:00:00Z"),
    state: "held",
    canRelease: true,
    canRefundNow: true,
    fundingReceiptId: null,
  },
];
export const ESCROW_CONTRACT = PROTECTED_PAYMENT;

export function coverageFrom(list: Escrow[]): Coverage {
  const held = list.filter((e) => e.state === "held");
  const released = list.filter((e) => e.state === "released");
  const tuition: Coverage["obligations"][number] = held.length
    ? {
        payeeId: PAYEES.hbu.id,
        payeeLabel: PAYEES.hbu.name,
        category: "tuition",
        cadence: "one-off",
        upTo: amt("20000", THKD),
        protection: "escrow-protected",
        escrowIds: list.map((e) => e.escrowId),
        refundableAfter: held[0]!.refundAfter,
        why: `Held in escrow until ${held[0]!.releaseAttester.label} attests the condition; refunded to you if not released by ${held[0]!.refundAfter}.`,
      }
    : {
        payeeId: PAYEES.hbu.id,
        payeeLabel: PAYEES.hbu.name,
        category: "tuition",
        cadence: "one-off",
        upTo: amt("20000", THKD),
        protection: released.length ? "settled through escrow" : "unprotected",
        escrowIds: list.map((e) => e.escrowId),
        refundableAfter: null,
        why: released.length
          ? `Paid through escrow: released to ${PAYEES.hbu.name} after ${released[0]!.releaseAttester.label} attested the condition.`
          : `Payments to ${PAYEES.hbu.name} go straight to the payee: once paid, nothing holds the money if the service is not delivered.`,
      };
  const obligations: Coverage["obligations"] = [
    {
      payeeId: PAYEES.harbourHomes.id,
      payeeLabel: PAYEES.harbourHomes.name,
      category: "rent",
      cadence: "every period",
      upTo: amt("9500", THKD),
      protection: "paid directly (no protection)",
      escrowIds: [],
      refundableAfter: null,
      why: `Paid directly to ${PAYEES.harbourHomes.name} this period; a direct payment has no claim path.`,
    },
    tuition,
  ];
  const coverItems = [
    {
      item: "medical cover",
      status: "none on record",
      gap: true,
      note: "YINGLONG holds no insurance records. Universities often ask non-local students to hold medical cover; check what yours requires. A checklist item, not advice.",
    },
  ];
  const gaps = [
    ...obligations.filter((o) => o.protection === "unprotected" || o.protection === "paid directly (no protection)").map((o) => `${o.payeeLabel} (${o.category}): ${o.protection}`),
    ...coverItems.filter((c) => c.gap).map((c) => `${c.item}: ${c.status}`),
  ];
  return {
    obligations,
    coverItems,
    gaps,
    summary: {
      protected: obligations.filter((o) => o.protection === "escrow-protected").length,
      unprotected: obligations.filter((o) => o.protection === "unprotected" || o.protection === "paid directly (no protection)").length,
      settled: obligations.filter((o) => o.protection === "settled through escrow").length,
      gaps: gaps.length,
    },
    label: "Test units and fictional institutions. Protection means the ProtectedPayment escrow as deployed; this card is a checklist, not insurance or advice.",
    ledger: "base-sepolia",
    block: "31884517",
  };
}

/* ------------------------------------------------------------------ Nadia: payment-reliability credential */

export const CREDENTIAL_STATEMENT = "test credential issued by a fictional bank; not a credit score";
const ISSUER = addr("issuer-harbour-digital-bank");

export const credential: Credential = {
  id: h("credential:nadia:payment-reliability"),
  ledger: "base-sepolia",
  issuer: ISSUER,
  issuerLabel: "Harbour Digital Bank (fictional)",
  subject: `did:pkh:eip155:84532:${NADIA_ACCOUNT}`,
  onTimePayments: 1,
  periodStart: PERIOD.start,
  periodEnd: PERIOD.end,
  receiptIds: [h("receipt:rent")],
  statement: CREDENTIAL_STATEMENT,
  signature: `0x${h("credential:sig:r").slice(2)}${h("credential:sig:s").slice(2)}1b`,
  anchorReceiptId: h("receipt:credential-anchor"),
  rule: "A budget period counts as on time when confirmed transfers to the sealed rent payee inside the first five days of the period add up to at least the sealed rent amount; at most one count per period.",
  label: CREDENTIAL_STATEMENT,
  issuedAt: minutesAgo(95),
};

export function verify(c: Credential): CredentialVerification {
  return {
    credentialHash: c.id,
    valid: true,
    signatureValid: true,
    recovered: c.issuer,
    issuer: c.issuer,
    issuerLabel: c.issuerLabel,
    trustedIssuer: true,
    receipts: c.receiptIds.map((receiptId) => ({
      receiptId,
      found: true,
      intact: true,
      confirmed: true,
      toRentPayee: true,
      ownReceipt: true,
      txHash: h(`tx:base:${receiptId}`),
      ledger: "base-sepolia",
      ok: true,
    })),
    anchorReceiptId: c.anchorReceiptId,
    anchorCommitsCredential: true,
    label: CREDENTIAL_STATEMENT,
  };
}

/* ------------------------------------------------------------------ treasury: 30-day cash forecast */

interface ForecastInput {
  name: string;
  unit: { decimals: number; symbol: string };
  posted: string;
  pending: { label: string; amount: string }[];
  floor: string;
  payroll: { label: string; amount: string; day: number; source: string } | null;
  supplierPerDay: string;
  velocity: CashForecast["velocity"];
  ledger: CashForecast["ledger"];
  rail: string;
}

/** The agent service's rule (apps/agent/src/forecast.ts): pending leaves on day 0, payroll every 30 days, supplier run-rate per day. */
function computeForecast(f: ForecastInput, horizonDays = 30): CashForecast {
  const u = (major: string) => parseUnits(major, f.unit.decimals)!;
  const A = (v: bigint): Amount => ({ value: v.toString(), decimals: f.unit.decimals, symbol: f.unit.symbol });
  const date = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
  const events: ForecastEvent[] = f.pending.map((p, i) => ({ day: 0, date: date(0), kind: "scheduled instruction", label: `pending instruction ${i + 1} to ${p.label}`, amount: A(u(p.amount)) }));
  if (f.payroll) for (let d = f.payroll.day; d <= horizonDays; d += 30) events.push({ day: d, date: date(d), kind: "payroll", label: `payroll to ${f.payroll.label} (${f.payroll.source})`, amount: A(u(f.payroll.amount)) });
  const perDay = u(f.supplierPerDay);
  const floor = u(f.floor);
  let bal = u(f.posted);
  let min = bal;
  let firstBreach: CashForecast["firstBreach"] = null;
  const daily: CashForecast["daily"] = [];
  for (let d = 0; d <= horizonDays; d++) {
    const out = events.filter((e) => e.day === d).reduce((s, e) => s + units(e.amount), 0n) + (d > 0 ? perDay : 0n);
    bal -= out;
    if (bal < min) min = bal;
    const below = bal < floor;
    daily.push({ day: d, date: date(d), outflow: out.toString(), balance: bal.toString(), belowFloor: below });
    if (below && !firstBreach) firstBreach = { day: d, date: date(d), balance: bal.toString(), shortfall: (floor - bal).toString() };
  }
  if (perDay > 0n) events.push({ day: 1, date: date(1), kind: "supplier run-rate", label: "trailing 30-day supplier payments, spread per day", amount: A(perDay) });
  events.sort((a, b) => a.day - b.day);
  const fmt = (v: bigint) => `${formatUnits(v, f.unit.decimals, 0)} ${f.unit.symbol}`;
  return {
    symbol: f.unit.symbol,
    decimals: f.unit.decimals,
    horizonDays,
    rail: f.rail,
    start: { posted: A(u(f.posted)), pending: A(f.pending.reduce((s, p) => s + u(p.amount), 0n)) },
    reserveFloor: A(floor),
    minBalance: min.toString(),
    headroomAboveFloor: (min - floor).toString(),
    supplierRunRatePerDay: A(perDay),
    events,
    daily,
    firstBreach,
    velocity: f.velocity,
    flags: [
      firstBreach
        ? `Projected balance falls below the reserve floor on day ${firstBreach.day}: optional orders would be deferred or the board asked.`
        : "Projected balance stays above the reserve floor over the horizon.",
    ],
    explanation: narration(
      `${f.name}: posted balance ${fmt(u(f.posted))}; the lowest projected balance over ${horizonDays} days is ${fmt(min)} against a reserve floor of ${fmt(floor)}. ${
        firstBreach ? `The floor would be breached on day ${firstBreach.day}, when payroll leaves.` : "The floor holds over the horizon."
      }`,
    ),
    label:
      "Coin-free instructions and test units. A deterministic projection from posted balance, pending instructions, recurring payroll and the supplier run-rate; not advice and not a bank forecast.",
    ledger: f.ledger,
    block: f.ledger === "fisco" ? "1204639" : "31884517",
  };
}

export const forecasts: Record<string, CashForecast> = {
  "lotus-sz": computeForecast({
    name: "Lotus Lane Trading (Shenzhen) Co.",
    unit: CNYT,
    posted: "905000",
    pending: [{ label: "Shenzhen Components", amount: "38500" }],
    floor: "250000",
    payroll: { label: "Staff payroll account", amount: "412000", day: 24, source: "repeats the last payroll run every 30 days" },
    supplierPerDay: "9420",
    velocity: {
      windowEndsAt: at("2026-10-16T16:00:00Z"),
      maxCount: 6,
      used: 4,
      countLeft: 2,
      maxOutflow: amt("250000", CNYT),
      outflow: amt("87900", CNYT),
      outflowLeft: amt("162100", CNYT),
    },
    ledger: "fisco",
    rail: "coin-free instructions (e-CNY-style simulator)",
  }),
  "lotus-hk": computeForecast({
    name: "Lotus Lane (HK) Ltd",
    unit: THKD,
    posted: "640000",
    pending: [],
    floor: "50000",
    payroll: { label: "Staff payroll account", amount: "96000", day: 14, source: "repeats the last payroll run every 30 days" },
    supplierPerDay: "2040",
    velocity: null,
    ledger: "base-sepolia",
    rail: "test token",
  }),
};

/* ------------------------------------------------------------------ treasury: PayeeBooks and sweeps */

export const treasuryPayees: Record<string, NonNullable<TreasuryView["payees"]>> = {
  "lotus-sz": [
    { id: "shenzhen_components", label: "Shenzhen Components", address: addr("shenzhen-components"), category: "supplier" },
    { id: "qianhai_logistics", label: "Qianhai Logistics Park", address: addr("qianhai-logistics"), category: "supplier" },
    { id: "staff_payroll", label: "Staff payroll account", address: addr("lotus-sz-payroll"), category: "payroll" },
  ],
  "lotus-hk": [
    { id: "kowloon_forwarders", label: "Kowloon Forwarders", address: addr("kowloon-forwarders"), category: "supplier" },
    { id: "test_mmf", label: "Test Money Market Fund", address: addr("test-mmf"), category: "treasury" },
    { id: "test_growth", label: "Test Growth Fund", address: addr("test-growth"), category: "treasury" },
    { id: "staff_payroll", label: "Staff payroll account", address: addr("lotus-hk-payroll"), category: "payroll" },
  ],
};

export const treasuryAssets: Record<string, NonNullable<TreasuryView["asset"]>> = {
  "lotus-sz": { symbol: CNYT.symbol, decimals: CNYT.decimals, unit: "CNY" },
  "lotus-hk": { symbol: THKD.symbol, decimals: THKD.decimals, unit: "HKD" },
};

/** Sample ProductRegistry: risk class per listed product. */
const PRODUCT_RISK: Record<string, number> = { test_mmf: 1, test_growth: 5 };
const RISK_LABEL: Record<number, string> = { 1: "lowest", 2: "low", 3: "medium", 4: "high", 5: "highest" };
const MANDATE_MAX = 2;

function treasuryScales(stop?: { at: (typeof SCALE_IDS)[number]; error: string; reason: string; kind?: "stopped" | "escalated" }): ScaleResult[] {
  let reached = true;
  return SCALE_IDS.map((id, k) => {
    const durationMs = [3, 16, 38, 5, 4, 20, 130, 8, 1700][k]!;
    if (!reached) return { scale: id, status: "skipped", reason: null, error: null, durationMs: null, revert: null };
    if (stop?.at === id) {
      reached = false;
      return { scale: id, status: stop.kind ?? "stopped", reason: stop.reason, error: stop.error, durationMs, revert: null };
    }
    return { scale: id, status: "passed", reason: null, error: null, durationMs, revert: null };
  });
}

/** A request to a treasurer agent (fixtures): sweeps get the suitability card; everything else asks. */
export function simulateTreasuryAsk(entityId: string, text: string, view: TreasuryView): Decision {
  const payees = view.payees ?? [];
  const asset = view.asset ?? treasuryAssets[entityId] ?? { symbol: THKD.symbol, decimals: THKD.decimals, unit: "HKD" };
  const t = text.toLowerCase();
  const num = /(\d[\d,]*(?:\.\d+)?)/.exec(text)?.[1];
  const value = num ? parseUnits(num, asset.decimals) : null;
  const amount: Amount | null = value !== null ? { value: value.toString(), decimals: asset.decimals, symbol: asset.symbol } : null;
  const product = payees.filter((p) => p.category === "treasury").find((p) => t.includes(p.label.toLowerCase()));
  const base = {
    proposalId: `prop-${entityId}-${h(`treasury:${text}`).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    input: { text, language: "en" as const },
    plan: [] as string[],
    approvalId: null,
    receiptId: null,
    question: null as string | null,
    aigc: { label: "AI-generated" as const, model: SAMPLE_MODEL, provider: "local" },
  };
  if (product) {
    const risk = PRODUCT_RISK[product.id] ?? null;
    const listed = risk !== null;
    const verdict: Suitability["verdict"] = !listed ? "not a listed product" : risk! > MANDATE_MAX ? "unsuitable" : "suitable";
    const refused = verdict === "unsuitable";
    const why = [
      listed
        ? `${product.label} is listed in the ProductRegistry with risk class ${risk} (${RISK_LABEL[risk!]}).`
        : `${product.label} is not listed in the ProductRegistry, so the suitability rule does not apply to it.`,
      `The mandate allows products up to risk class ${MANDATE_MAX} (${RISK_LABEL[MANDATE_MAX]}), the result of the suitability assessment sealed in it.`,
      refused
        ? `Class ${risk} is above ${MANDATE_MAX}: the SuitabilityEnforcer reverts this sweep with UnsuitableProduct, whatever the agent proposes.`
        : `Class ${risk} is within ${MANDATE_MAX}: the suitability rule allows this sweep; the other mandate rules still apply.`,
    ];
    const suitability: Suitability = {
      product: { id: product.id, label: product.label, address: product.address, onChainName: listed ? `${product.label} (risk class ${risk})` : null, nameMatchesRegistry: listed ? true : null },
      listed,
      riskClass: risk,
      riskLabel: risk ? RISK_LABEL[risk]! : "not listed",
      mandateMaxRiskClass: MANDATE_MAX,
      mandateMaxLabel: RISK_LABEL[MANDATE_MAX]!,
      verdict,
      outcome: refused ? "refused" : "needs your approval",
      why,
      source: { registry: addr("product-registry"), function: "productInfo", enforcer: "SuitabilityEnforcer", block: "31884517", ledger: view.entity.rail.ledger },
      label: "Test products only; no real fund is represented. Suitability here is the sealed risk-class rule, not advice.",
    };
    return {
      ...base,
      intent: { action: "sweep", summary: `Sweep into ${product.label}`, payeeId: product.id, payeeName: product.label, amount, category: "treasury", intentHash: h(`intent:sweep:${text}`) },
      tier: refused ? "T4" : "T2",
      outcome: refused ? "refused" : "awaiting_approval",
      scales: treasuryScales(refused ? { at: "policy", error: "UnsuitableProduct", reason: `${product.label} is risk class ${risk}; the mandate allows up to ${MANDATE_MAX}.` } : undefined),
      explanation: refused
        ? `The sweep is refused: ${product.label} is above the risk class sealed in the board's mandate.`
        : `${product.label} is within the sealed risk class. A first sweep into a product is a board decision, so it waits for the directors.`,
      plan: refused ? [] : ["Check the suitability rule against the ProductRegistry", "Queue the sweep for 2 of 3 directors", "Write and anchor the receipt"],
      suitability,
    };
  }
  return {
    ...base,
    intent: { action: "other", summary: "Unclear request", payeeId: null, payeeName: null, amount, category: null, intentHash: null },
    tier: "ASK",
    outcome: "asking",
    scales: treasuryScales({ at: "ground", kind: "escalated", error: "AmbiguousIntent", reason: "The product, payee or amount could not be traced to the request and the mandate." }),
    explanation: "The treasurer agent could not tie this request to a product or payee in the mandate, so it stopped instead of guessing.",
    question: "Which product or payee, and how much?",
  };
}
