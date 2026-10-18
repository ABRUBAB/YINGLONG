/**
 * Cash-flow bands from the forecasting model (M5: LightGBM quantile models, served by ml/serving at POST /forecast).
 * The deterministic projection in forecast.ts stays the base: it decides what is scheduled. The model adds percentile
 * bands for the balance and the probability of a reserve breach within 14 days. Advisory only: the reserve floor
 * itself is enforced by a contract.
 *
 * History: the service needs at least 29 daily balances. The agent only knows the balance today and the payments it
 * made, so the history is reconstructed from those payments (balance on day d = balance now + payments after d,
 * assuming no deposits), and the result says how many days of real activity it rests on.
 */
import type { ReceiptRecord } from "./receipts";

const DAY_MS = 86_400_000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fen = (v: bigint, decimals: number): number => (decimals >= 2 ? Number(v / 10n ** BigInt(decimals - 2)) : Number(v) * 10 ** (2 - decimals));

export interface ForecastModelInput {
  nowMs: number;
  decimals: number;
  posted: bigint;
  floor: bigint;
  /** This principal's payments in the asset, confirmed. */
  payments: ReceiptRecord[];
  /** Scheduled payroll by day offset (base units) and the supplier run-rate per day (base units). */
  payrollByDay: Map<number, bigint>;
  supplierPerDay: bigint;
  horizonDays: number;
}

export interface ForecastModelResult {
  model: string;
  label: string;
  pBreach14d: number;
  quantileLevels: number[];
  days: { day: number; date: string; q05: number; q50: number; q95: number }[];
  historyDays: number;
  activityDays: number;
}

export async function forecastModel(i: ForecastModelInput): Promise<ForecastModelResult | undefined> {
  const url = process.env.SENTINEL_URL;
  if (!url || process.env.FORECAST_MODEL_DISABLED === "1") return undefined;
  const paid = i.payments
    .filter((r) => r.payment && r.receipt.outcome === "confirmed")
    .map((r) => ({ at: new Date(r.createdAt).getTime(), amt: BigInt(r.payment!.amount) }));
  const history: { date: string; balance_fen: number }[] = [];
  for (let d = 28; d >= 0; d--) {
    const dayEnd = i.nowMs - d * DAY_MS;
    const after = paid.filter((p) => p.at > dayEnd).reduce((s, p) => s + p.amt, 0n);
    history.push({ date: isoDate(dayEnd), balance_fen: fen(i.posted + after, i.decimals) });
  }
  const first = paid.length ? Math.min(...paid.map((p) => p.at)) : i.nowMs;
  const future: { date: string; [k: string]: number | string }[] = [];
  const H = Math.min(28, Math.max(1, i.horizonDays));
  for (let d = 1; d <= H; d++) {
    const ms = i.nowMs + d * DAY_MS;
    const dow = new Date(ms).getUTCDay();
    future.push({
      date: isoDate(ms),
      payroll_out: fen(i.payrollByDay.get(d) ?? 0n, i.decimals),
      ap_due_out: fen(i.supplierPerDay, i.decimals),
      utilities_out: 0, forwarders_out: 0, cloud_out: 0, sweep_out: 0,
      is_weekend: dow === 0 || dow === 6 ? 1 : 0,
      is_holiday: 0,
    });
  }
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/forecast`, {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.FORECAST_TIMEOUT_MS ?? 5_000)),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history, future, floor_fen: fen(i.floor, i.decimals) }),
    });
    if (!r.ok) return undefined;
    const j = (await r.json()) as { quantile_levels: number[]; balance_quantiles_fen: number[][]; p_breach_14d: number; model_sha?: string };
    const lo = j.quantile_levels.indexOf(0.05), mid = j.quantile_levels.indexOf(0.5), hi = j.quantile_levels.indexOf(0.95);
    return {
      model: `M5 quantile forecaster ${j.model_sha?.slice(0, 12) ?? ""}`.trim(),
      label: "Percentile bands from the trained M5 model, run on the balance history rebuilt from this company's recorded payments (no deposits assumed). They sit beside the deterministic projection and never replace it.",
      pBreach14d: j.p_breach_14d,
      quantileLevels: j.quantile_levels,
      days: j.balance_quantiles_fen.map((row, k) => ({ day: k + 1, date: future[k]!.date, q05: row[lo]! / 100, q50: row[mid]! / 100, q95: row[hi]! / 100 })),
      historyDays: history.length,
      activityDays: Math.max(0, Math.min(29, Math.round((i.nowMs - first) / DAY_MS) + 1)),
    };
  } catch {
    return undefined;
  }
}
