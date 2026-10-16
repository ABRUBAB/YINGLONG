import { dir, roles } from "./helpers/env";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { computeInsights, insightFacts, spendKind, type BudgetRead } from "../src/insights";
import { computeForecast } from "../src/forecast";
import { buildSuitabilityCard } from "../src/suitability";
import { coverageCard, viewEscrow, type EscrowView } from "../src/escrows";
import { _clearNarrationCache, narrate, validateNarration } from "../src/llm/narrate";
import { _resetProviderState } from "../src/llm/provider";
import { seedLotusSz, seedNadia } from "./helpers/seed";
import type { Mandate } from "@yinglong/mandate";

const DAY = 86_400n;
const U = (n: number) => BigInt(n) * 1_000_000n;
const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;

describe("spending insights (deterministic)", () => {
  const start = 1_000n * DAY;
  const b = (category: string, cap: bigint, spent: bigint): BudgetRead => ({ symbol: "tHKD", decimals: 6, category, cap, spent, periodStart: start, periodEnd: start + 30n * DAY, periodLength: 30n * DAY });

  it("computes remaining, use, and a capped run-rate forecast per category", () => {
    const now = start + 10n * DAY;
    const ins = computeInsights({
      now,
      budgets: [b("rent", U(9_500), U(9_500)), b("food", U(3_000), U(1_200)), b("tuition", U(12_000), 0n), b("transport", U(500), 0n)],
      spend: [
        { at: start + DAY, symbol: "tHKD", decimals: 6, amount: U(9_500), payee: A(1), payeeLabel: "Harbour Homes", receiptId: "0x01" },
        { at: start + 2n * DAY, symbol: "tHKD", decimals: 6, amount: U(700), payee: A(2), payeeLabel: "Kowloon Food Mart", receiptId: "0x02" },
        { at: start + 3n * DAY, symbol: "tHKD", decimals: 6, amount: U(500), payee: A(2), payeeLabel: "Kowloon Food Mart", receiptId: "0x03" },
        { at: start - DAY, symbol: "tHKD", decimals: 6, amount: U(999), payee: A(3), payeeLabel: "last period", receiptId: "0x04" },
      ],
    });
    const food = ins.categories.find((c) => c.category === "food")!;
    expect(food.remaining).toBe(U(1_800));
    expect(food.usedBps).toBe(4_000);
    // 1,200 in 10 of 30 days -> 3,600 projected, capped at the 3,000 budget; the cap would be reached on day 25.
    expect(food.forecastPeriodEnd).toBe(U(3_000));
    expect(food.status).toBe("would reach the cap before the period ends");
    expect(food.wouldReachCapAt).toBe(new Date(Number(start + 25n * DAY) * 1000).toISOString());
    const rent = ins.categories.find((c) => c.category === "rent")!;
    expect(rent).toMatchObject({ kind: "scheduled", forecastPeriodEnd: U(9_500), status: "at cap" });
    expect(ins.categories.find((c) => c.category === "tuition")!.forecastPeriodEnd).toBe(0n);
    expect(ins.topPayees.map((p) => [p.label, p.amount, p.payments])).toEqual([
      ["Harbour Homes", U(9_500), 1],
      ["Kowloon Food Mart", U(1_200), 2],
    ]);
    expect(ins.totals[0]).toMatchObject({ symbol: "tHKD", spent: U(10_700), forecastPeriodEnd: U(12_500) });
    expect(ins.period).toMatchObject({ daysLeft: 20, timeCompressed: false });
  });

  it("does not extrapolate wildly from the first minutes of a period", () => {
    const ins = computeInsights({ now: start + 60n, budgets: [b("food", U(3_000), U(100))], spend: [] });
    // At least a tenth of the period counts as elapsed: 100 over 3 days -> 1,000 over 30 days.
    expect(ins.categories[0]!.forecastPeriodEnd).toBe(U(1_000));
    expect(spendKind("rent")).toBe("scheduled");
    expect(spendKind("payroll")).toBe("one-off");
    expect(spendKind("food")).toBe("variable");
  });

  it("rent not yet paid is forecast as due", () => {
    const ins = computeInsights({ now: start + DAY, budgets: [b("rent", U(9_500), 0n)], spend: [] });
    expect(ins.categories[0]).toMatchObject({ forecastPeriodEnd: U(9_500), status: "due this period" });
  });
});

describe("narration (AI explains, never decides)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.LLM_DISABLED = "1";
    process.env.DASHSCOPE_DISABLED = "1";
    delete process.env.OPENROUTER_KEY_FILE;
  });

  it("the validator accepts only numerals that appear in the facts", () => {
    const facts = { spent: "1,200", budget: "3000", days: 20 };
    expect(validateNarration("You spent 1200 of 3,000 with 20 days left.", facts).ok).toBe(true);
    expect(validateNarration("You spent 1,250 so far.", facts).ok).toBe(false);
    expect(validateNarration("See https://example.com", facts).ok).toBe(false);
    expect(validateNarration("Pay 0xdeadbeef", facts).ok).toBe(false);
  });

  it("uses the model's paragraph when it validates, labelled with the model; otherwise the template", async () => {
    const orFile = join(dir, "or-narrate.txt");
    writeFileSync(orFile, "sk-or-TESTONLY-narrate");
    process.env.OPENROUTER_KEY_FILE = orFile;
    process.env.LLM_DISABLED = "0";
    _resetProviderState();
    _clearNarrationCache();
    let reply = "Food spending is 1,200 of 3,000, with 20 days left.";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ paragraph: reply }) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const facts = { spent: "1,200", budget: "3,000", daysLeft: 20 };
    const good = await narrate({ purpose: "p", facts, fallback: "template" });
    expect(good).toMatchObject({ aiGenerated: true, label: "AI-generated", provider: "openrouter" });
    expect(good.model.endsWith(":free")).toBe(true);
    // Cached: same facts, no second call.
    await narrate({ purpose: "p", facts, fallback: "template" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    reply = "You will spend 4,000 by the end.";
    const bad = await narrate({ purpose: "p", facts: { ...facts, daysLeft: 19 }, fallback: "template" });
    expect(bad).toMatchObject({ aiGenerated: false, text: "template", model: "none (template)" });
    expect(bad.fallbackReason).toMatch(/validator/);
    const off = await narrate({ purpose: "p", facts, fallback: "template", enabled: false });
    expect(off.aiGenerated).toBe(false);
  });

  it("a slow model does not block the caller: the template now, the paragraph on the next request", async () => {
    const orFile = join(dir, "or-narrate-slow.txt");
    writeFileSync(orFile, "sk-or-TESTONLY-slow");
    process.env.OPENROUTER_KEY_FILE = orFile;
    process.env.LLM_DISABLED = "0";
    _resetProviderState();
    _clearNarrationCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 150));
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"paragraph":"Spent 5 of 9."}' } }] }), { status: 200 });
      }),
    );
    const facts = { spent: "5", budget: "9" };
    const first = await narrate({ purpose: "slow", facts, fallback: "template", waitMs: 10 });
    expect(first).toMatchObject({ aiGenerated: false, text: "template" });
    expect(first.fallbackReason).toMatch(/still writing/);
    await new Promise((r) => setTimeout(r, 300));
    expect(await narrate({ purpose: "slow", facts, fallback: "template", waitMs: 10 })).toMatchObject({ aiGenerated: true, text: "Spent 5 of 9." });
  });

  it("insight facts carry display strings only", () => {
    const ins = computeInsights({ now: 10n, budgets: [], spend: [] });
    expect(insightFacts("Nadia", ins)).toMatchObject({ accountHolder: "Nadia", categories: [], topPayees: [] });
  });
});

describe("30-day cash forecast (deterministic)", () => {
  const now = 2_000n * DAY;
  const F = (n: number) => BigInt(n) * 100n; // CNY fen

  it("finds the first reserve-floor breach from payroll and the supplier run-rate", () => {
    const fc = computeForecast({
      now,
      horizonDays: 30,
      symbol: "CNY",
      decimals: 2,
      posted: F(400_000),
      pending: [{ id: 4, payee: A(9), payeeLabel: "Shenzhen Components", amount: F(42_000), validUntil: now + DAY }],
      floor: F(100_000),
      payroll: { amount: F(120_000), nextAt: now + 5n * DAY, source: "last run", payeeLabel: "Staff payroll account" },
      supplierTrailing30: F(300_000),
    });
    // Day 0: 400,000 - 42,000 = 358,000. Then 10,000 a day of supplier run-rate; payroll 120,000 on day 5.
    expect(fc.daily[0]!.balance).toBe(F(358_000));
    expect(fc.daily[5]!.balance).toBe(F(358_000 - 50_000 - 120_000));
    // 188,000 on day 5, falls under 100,000 on day 14 (188,000 - 9 x 10,000 = 98,000).
    expect(fc.firstBreach).toMatchObject({ day: 14, balance: F(98_000), shortfall: F(2_000) });
    expect(fc.events.filter((e) => e.kind === "payroll").map((e) => e.day)).toEqual([5]);
    expect(fc.supplierRunRatePerDay).toBe(F(10_000));
    expect(fc.flags[0]).toMatch(/day 14/);
  });

  it("repeats payroll every 30 days and reports headroom when the floor holds", () => {
    const fc = computeForecast({
      now,
      horizonDays: 60,
      symbol: "CNY",
      decimals: 2,
      posted: F(1_000_000),
      pending: [],
      floor: F(100_000),
      payroll: { amount: F(80_000), nextAt: now - DAY, source: "cap", payeeLabel: "Staff payroll account" },
      supplierTrailing30: 0n,
    });
    expect(fc.events.filter((e) => e.kind === "payroll").map((e) => e.day)).toEqual([0, 30, 60]);
    expect(fc.firstBreach).toBeNull();
    expect(fc.minBalance).toBe(F(760_000));
    expect(fc.headroomAboveFloor).toBe(F(660_000));
  });
});

describe("suitability explanation card", () => {
  const base = { product: { id: "test_mmf", label: "Test Money Market Fund", address: A(5) }, registry: A(6), block: 12n, ledger: "anvil" };
  it("explains approval of a suitable product and refusal of an unsuitable one", () => {
    const ok = buildSuitabilityCard({ ...base, listed: true, riskClass: 2, maxRiskClass: 2, decision: "needs_approval" });
    expect(ok).toMatchObject({ verdict: "suitable", outcome: "needs your approval", riskClass: 2, mandateMaxRiskClass: 2, riskLabel: "low" });
    expect(ok.why.join(" ")).toMatch(/within 2/);
    const bad = buildSuitabilityCard({ ...base, product: { ...base.product, label: "Test Growth Fund" }, listed: true, riskClass: 5, maxRiskClass: 2, decision: "refused" });
    expect(bad).toMatchObject({ verdict: "unsuitable", outcome: "refused", riskLabel: "highest" });
    expect(bad.why.join(" ")).toMatch(/UnsuitableProduct/);
    expect(buildSuitabilityCard({ ...base, listed: false, riskClass: 0, maxRiskClass: 2, decision: "execute" }).verdict).toBe("not a listed product");
    expect(buildSuitabilityCard({ ...base, listed: true, riskClass: 2, maxRiskClass: null, decision: "execute" }).verdict).toBe("no suitability rule sealed");
  });
});

describe("escrow views and the coverage-gap card", () => {
  it("maps escrow state and the release attester, and finds the gaps", () => {
    const st = seedNadia();
    const m = st.mandate as Mandate;
    const bursar = m.payees.find((p) => p.id === "hbu_bursar")!.address as Address;
    const now = 5_000n;
    const raw = (state: number, refundAfter: bigint) => ({
      payer: st.account,
      payee: bursar,
      token: m.assets[0]!.address as Address,
      releaseAttester: roles["issuer-hbu"]!.address,
      amount: U(2_500),
      conditionId: `0x${"11".repeat(32)}` as Hex,
      createdAt: 4_000n,
      refundAfter,
      state,
    });
    const held = viewEscrow(3, raw(1, 9_000n), m, now, "anvil", [], "nadia");
    expect(held).toMatchObject({ escrowId: 3, state: "held", canRelease: true, canRefundNow: false, payee: { id: "hbu_bursar", label: "HBU Bursar" } });
    expect(held.releaseAttester).toMatchObject({ label: "Harbour Bay University (fictional)", heldByService: true });
    expect(viewEscrow(4, raw(1, 4_500n), m, now, "anvil", [], "nadia").canRefundNow).toBe(true);
    expect(viewEscrow(5, raw(2, 4_500n), m, now, "anvil", [], "nadia")).toMatchObject({ state: "released", canRelease: false, canRefundNow: false });

    const rent = m.payees.find((p) => p.category === "rent")!.address.toLowerCase();
    const card = coverageCard({ kind: "person", mandate: m, escrows: [held], paidDirect: new Set([rent]) });
    const by = Object.fromEntries(card.obligations.map((o) => [o.payeeId, o.protection]));
    expect(by).toEqual({ harbour_homes: "paid directly (no protection)", hbu_bursar: "escrow-protected" });
    expect(card.coverItems[0]).toMatchObject({ item: "medical cover", gap: true });
    expect(card.summary).toEqual({ protected: 1, unprotected: 1, settled: 0, gaps: 2 });
    const released: EscrowView = { ...held, state: "released" };
    expect(coverageCard({ kind: "person", mandate: m, escrows: [released], paidDirect: new Set() }).obligations.find((o) => o.payeeId === "hbu_bursar")!.protection).toBe("settled through escrow");
  });

  it("a company card lists supplier and payroll obligations", () => {
    const st = seedLotusSz();
    const card = coverageCard({ kind: "company", mandate: st.mandate as Mandate, escrows: [], paidDirect: new Set() });
    expect(card.obligations.map((o) => [o.category, o.cadence, o.protection])).toEqual([
      ["supplier", "per invoice", "unprotected"],
      ["payroll", "every period", "unprotected"],
    ]);
  });
});
