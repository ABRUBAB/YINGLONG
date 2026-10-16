import type { Address } from "viem";
import { abi } from "@yinglong/sdk";
import { CATEGORY_IDS, formatUnits, type Mandate } from "@yinglong/mandate";
import { ledgerContext } from "./chain/ledger";
import { narrate, type Narration } from "./llm/narrate";
import { receiptLog, type ReceiptRecord } from "./receipts";
import { stateOf, type PrincipalId } from "./world";

/**
 * Spending insights (budgets that bite): per category, spent against the sealed budget for the current period
 * (read from CategoryBudgetEnforcer.spentNow, the counter the chain enforces), what remains, the time left, the
 * top payees from confirmed receipts and a deterministic projection of spend at the period end. A model may
 * explain the result in one paragraph (labelled); it never changes a number.
 */
export interface BudgetRead {
  symbol: string;
  decimals: number;
  category: string;
  cap: bigint;
  spent: bigint;
  periodStart: bigint;
  periodEnd: bigint;
  periodLength: bigint;
}

export interface SpendRow {
  at: bigint;
  symbol: string;
  decimals: number;
  amount: bigint;
  payee: Address;
  payeeLabel: string;
  receiptId: string;
}

export type SpendKind = "scheduled" | "one-off" | "variable";
/** Rent is due every period; tuition, sweeps, supplier invoices and payroll are lumpy; the rest is day-to-day. */
export function spendKind(category: string): SpendKind {
  if (category === "rent") return "scheduled";
  if (["tuition", "treasury", "supplier", "payroll"].includes(category)) return "one-off";
  return "variable";
}

const DAY = 86_400n;
const iso = (s: bigint) => new Date(Number(s) * 1000).toISOString();

export interface CategoryInsight {
  symbol: string;
  decimals: number;
  category: string;
  kind: SpendKind;
  cap: bigint;
  spent: bigint;
  remaining: bigint;
  usedBps: number;
  forecastPeriodEnd: bigint;
  forecastMethod: string;
  wouldReachCapAt?: string;
  status: "at cap" | "on track" | "would reach the cap before the period ends" | "due this period";
}

export function computeInsights(input: { now: bigint; budgets: BudgetRead[]; spend: SpendRow[] }) {
  const categories: CategoryInsight[] = input.budgets.map((b) => {
    const remaining = b.cap > b.spent ? b.cap - b.spent : 0n;
    const usedBps = b.cap > 0n ? Number((b.spent * 10_000n) / b.cap) : 0;
    const kind = spendKind(b.category);
    let forecast = b.spent;
    let method = "one-off spend: what is spent is the forecast";
    let reachAt: string | undefined;
    let status: CategoryInsight["status"] = b.spent >= b.cap && b.cap > 0n ? "at cap" : "on track";
    if (kind === "scheduled") {
      forecast = b.spent > b.cap ? b.spent : b.cap;
      method = "scheduled: the full amount is due every period";
      if (b.spent < b.cap) status = "due this period";
    } else if (kind === "variable") {
      // Linear run-rate on at least a tenth of the period, so one early purchase does not project wildly.
      const elapsed = input.now > b.periodStart ? input.now - b.periodStart : 0n;
      const minElapsed = b.periodLength / 10n > 0n ? b.periodLength / 10n : 1n;
      const eff = elapsed > minElapsed ? elapsed : minElapsed;
      const projected = (b.spent * b.periodLength) / eff;
      forecast = projected > b.cap ? b.cap : projected;
      method = "run-rate: spent so far scaled to the whole period (at least a tenth of the period elapsed), capped by the budget the chain enforces";
      if (b.spent > 0n && projected > b.cap && b.spent < b.cap) {
        const t = b.periodStart + (b.cap * eff) / b.spent;
        if (t < b.periodEnd) {
          reachAt = iso(t);
          status = "would reach the cap before the period ends";
        }
      }
    }
    return { symbol: b.symbol, decimals: b.decimals, category: b.category, kind, cap: b.cap, spent: b.spent, remaining, usedBps, forecastPeriodEnd: forecast, forecastMethod: method, wouldReachCapAt: reachAt, status };
  });

  // Top payees in the current period of each asset, from confirmed receipts.
  const byPayee = new Map<string, { label: string; address: Address; symbol: string; decimals: number; amount: bigint; payments: number; receiptIds: string[] }>();
  for (const r of input.spend) {
    const b = input.budgets.find((x) => x.symbol === r.symbol);
    if (!b || r.at < b.periodStart || r.at >= b.periodEnd) continue;
    const k = `${r.symbol}:${r.payee.toLowerCase()}`;
    const e = byPayee.get(k) ?? { label: r.payeeLabel, address: r.payee, symbol: r.symbol, decimals: r.decimals, amount: 0n, payments: 0, receiptIds: [] };
    e.amount += r.amount;
    e.payments += 1;
    e.receiptIds.push(r.receiptId);
    byPayee.set(k, e);
  }
  const topPayees = [...byPayee.values()].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0)).slice(0, 5);

  const symbols = [...new Set(input.budgets.map((b) => b.symbol))];
  const totals = symbols.map((s) => {
    const cs = categories.filter((c) => c.symbol === s);
    const sum = (f: (c: CategoryInsight) => bigint) => cs.reduce((a, c) => a + f(c), 0n);
    return { symbol: s, decimals: cs[0]!.decimals, cap: sum((c) => c.cap), spent: sum((c) => c.spent), forecastPeriodEnd: sum((c) => c.forecastPeriodEnd) };
  });

  const b0 = input.budgets[0];
  const left = b0 && b0.periodEnd > input.now ? b0.periodEnd - input.now : 0n;
  const period = b0
    ? {
        start: iso(b0.periodStart),
        end: iso(b0.periodEnd),
        lengthSeconds: Number(b0.periodLength),
        secondsLeft: Number(left),
        daysLeft: Number((left + DAY - 1n) / DAY),
        timeCompressed: b0.periodLength < 28n * DAY,
      }
    : null;
  return { period, categories, topPayees, totals };
}

export type Insights = ReturnType<typeof computeInsights>;

/** The facts a model may talk about, as display strings (the validator checks every numeral against these). */
export function insightFacts(name: string, ins: Insights): Record<string, unknown> {
  const f = (v: bigint, d: number) => formatUnits(v, d);
  return {
    accountHolder: name,
    periodDaysLeft: ins.period?.daysLeft,
    timeCompressed: ins.period?.timeCompressed,
    categories: ins.categories.map((c) => ({
      category: c.category,
      unit: c.symbol,
      budget: f(c.cap, c.decimals),
      spent: f(c.spent, c.decimals),
      remaining: f(c.remaining, c.decimals),
      percentUsed: `${Math.floor(c.usedBps / 100)}%`,
      forecastAtPeriodEnd: f(c.forecastPeriodEnd, c.decimals),
      status: c.status,
    })),
    topPayees: ins.topPayees.map((p) => ({ payee: p.label, unit: p.symbol, amount: f(p.amount, p.decimals), payments: p.payments })),
  };
}

export function insightTemplate(name: string, ins: Insights): string {
  const f = (v: bigint, d: number) => formatUnits(v, d);
  const parts = ins.categories
    .filter((c) => c.spent > 0n || c.kind === "scheduled")
    .map((c) => `${c.category} ${f(c.spent, c.decimals)} of ${f(c.cap, c.decimals)} ${c.symbol} (${c.status})`);
  const top = ins.topPayees[0];
  return [
    `${name}: ${ins.period ? `${ins.period.daysLeft} day(s) left in this budget period. ` : ""}${parts.length ? `Spent so far: ${parts.join("; ")}.` : "No spending recorded in this period yet."}`,
    top ? `Largest payee this period: ${top.label} (${f(top.amount, top.decimals)} ${top.symbol}).` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const INSIGHTS_LABEL = "Test units. Budgets are the caps sealed in the mandate and enforced on-chain; the forecast is a deterministic projection, not advice.";

/** Confirmed outgoing payments of a principal (receipts), for spend analysis. Escrow releases and refunds are not the principal's spend. */
export function spendRows(id: string, ledger?: string, rows: ReceiptRecord[] = receiptLog.all()): SpendRow[] {
  return rows
    .filter((r) => r.principal === id && (!ledger || r.ledger === ledger) && r.receipt.outcome === "confirmed" && r.payment && ["transfer", "transferAndCall", "instruct"].includes(r.payment.method))
    .map((r) => ({
      at: r.receipt.timestamp,
      symbol: r.payment!.symbol,
      decimals: r.payment!.decimals,
      amount: BigInt(r.payment!.amount),
      payee: r.payment!.payee as Address,
      payeeLabel: r.payment!.payeeLabel,
      receiptId: r.receipt.receiptId,
    }));
}

/** Budget counters from the chain, for every sealed (asset, category) cap. */
export async function readBudgets(id: PrincipalId): Promise<{ now: bigint; block: bigint; budgets: BudgetRead[] }> {
  const st = stateOf(id);
  const ctx = ledgerContext(st.ledger);
  const m = st.mandate as Mandate;
  const block = await ctx.pub.getBlock();
  const dm = ctx.addr("DelegationManager");
  const budgets: BudgetRead[] = [];
  for (const b of m.budgets) {
    const asset = m.assets.find((a) => a.symbol === b.asset)!;
    const len = BigInt(b.periodLength);
    const start0 = BigInt(b.periodStart);
    const k = block.timestamp > start0 ? (block.timestamp - start0) / len : 0n;
    const periodStart = start0 + k * len;
    const reads = await Promise.all(
      b.caps.map((cap) =>
        ctx.read<bigint>({
          address: ctx.addr("CategoryBudgetEnforcer"),
          abi: abi.CategoryBudgetEnforcerAbi,
          functionName: "spentNow",
          args: [dm, st.account, asset.address as Address, CATEGORY_IDS[cap.category as keyof typeof CATEGORY_IDS], start0, len],
        }),
      ),
    );
    b.caps.forEach((cap, i) =>
      budgets.push({ symbol: asset.symbol, decimals: asset.decimals, category: cap.category, cap: BigInt(cap.amount), spent: reads[i]!, periodStart, periodEnd: periodStart + len, periodLength: len }),
    );
  }
  return { now: block.timestamp, block: block.number, budgets };
}

export async function insightsFor(id: PrincipalId, opts: { explain?: boolean; name: string }): Promise<Insights & { block: bigint; ledger: string; explanation: Narration; label: string }> {
  const st = stateOf(id);
  const { now, block, budgets } = await readBudgets(id);
  const ins = computeInsights({ now, budgets, spend: spendRows(id, st.ledger) });
  const explanation = await narrate({
    purpose: "Explain this budget period's spending insights to the account holder.",
    facts: insightFacts(opts.name, ins),
    fallback: insightTemplate(opts.name, ins),
    enabled: opts.explain !== false,
  });
  return { ...ins, block, ledger: st.ledger, explanation, label: INSIGHTS_LABEL };
}
