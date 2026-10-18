/**
 * Scale 8, model part: the behaviour-anomaly model (M3: isolation forest + LightGBM + Mondrian conformal calibration,
 * served by ml/serving). It can only ESCALATE (monotonic-safety rule): a flagged action is raised one tier, never refused.
 *
 * The feature definitions mirror ml/anomaly/world.py (`featurise`) one for one; amounts are in minor units (cents) as in
 * training. If the service is not configured or does not answer, the caller keeps the rule-based check and says so.
 */
import type { ReceiptRecord } from "../receipts";

export interface AnomalyInput {
  archetype: "student" | "sme";
  /** The principal's confirmed payments, any order. */
  history: ReceiptRecord[];
  payee: string; // the beneficiary address
  amount: bigint; // base units
  decimals: number;
  t1Threshold?: bigint;
  now: Date;
  untrusted: boolean;
  scheduled: boolean;
}

export interface AnomalyResult {
  escalate: boolean;
  pValue: number;
  alpha: number;
  model: string;
}

const cents = (v: bigint, decimals: number): number => (decimals >= 2 ? Number(v / 10n ** BigInt(decimals - 2)) : Number(v) * 10 ** (2 - decimals));
const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Longest shared prefix plus suffix of two 0x addresses, over 12, capped at 1 (0 for an identical address). */
export function lookalike(a: string, known: string[]): number {
  let best = 0;
  const x = a.toLowerCase();
  for (const k0 of known) {
    const k = k0.toLowerCase();
    if (k === x) return 0;
    let p = 0;
    while (p < 40 && x[2 + p] === k[2 + p]) p++;
    let s = 0;
    while (s < 40 && x[x.length - 1 - s] === k[k.length - 1 - s]) s++;
    best = Math.max(best, p + s);
  }
  return Math.min(1, best / 12);
}

export function anomalyFeatures(i: AnomalyInput): Record<string, number> {
  const amt = cents(i.amount, i.decimals);
  const thr = i.t1Threshold && i.t1Threshold > 0n ? cents(i.t1Threshold, i.decimals) : Math.max(amt * 4, 1);
  const t = i.now.getTime();
  const rows = i.history
    .filter((r) => r.payment && r.receipt.outcome === "confirmed")
    .map((r) => ({ at: new Date(r.createdAt).getTime(), payee: r.payment!.payee.toLowerCase(), amt: cents(BigInt(r.payment!.amount), r.payment!.decimals) }))
    .filter((r) => r.at <= t)
    .sort((a, b) => a.at - b.at);
  const same = rows.filter((r) => r.payee === i.payee.toLowerCase());
  const h = same.map((r) => r.amt);
  const last30 = h.slice(-30);
  const med = median(last30);
  const mad = h.length ? median(last30.map((v) => Math.abs(v - med))) + 1 : 1;
  const within = (ms: number) => rows.filter((r) => t - r.at <= ms);
  const sp = same.filter((r) => t - r.at <= 86_400_000);
  const isSub = amt >= 0.8 * thr && amt < thr ? 1 : 0;
  const subPast = within(86_400_000).filter((r) => r.amt >= 0.8 * thr && r.amt < thr).length;
  const since = same.length ? (t - same[same.length - 1]!.at) / 1000 : 1e7;
  const firstSeen = same.length ? same[0]!.at : undefined;
  const hour = i.now.getUTCHours();
  const known = [...new Set(rows.map((r) => r.payee))];
  return {
    f_log_amount: Math.log1p(amt),
    f_amount_rz: h.length ? (amt - med) / mad : 0,
    f_amount_ratio_med: med ? amt / med : 0,
    f_amount_over_thr: amt / thr,
    f_hour: hour,
    f_weekday: (i.now.getUTCDay() + 6) % 7, // Monday = 0, as Python's weekday()
    f_night: hour < 6 || hour >= 23 ? 1 : 0,
    f_log_since_same_payee: Math.log1p(since),
    f_n_same_payee_24h: sp.length,
    f_dup_amount_24h: sp.some((r) => Math.abs(r.amt - amt) <= Math.max(1, Math.floor(amt / 1000))) ? 1 : 0,
    f_n_1h: within(3_600_000).length,
    f_n_24h: within(86_400_000).length,
    f_x402: 0,
    f_x402_1h: 0,
    f_sub_thr: isSub,
    f_sub_thr_24h: subPast + isSub,
    f_new_payee: h.length === 0 ? 1 : 0,
    f_addr_changed: 0,
    f_log_addr_age: firstSeen === undefined ? 0 : Math.log1p((t - firstSeen) / 86_400_000),
    f_untrusted: i.untrusted ? 1 : 0,
    f_scheduled: i.scheduled ? 1 : 0,
    f_payee_hist_n: h.length,
    f_lookalike: lookalike(i.payee, known),
  };
}

export async function anomalyModel(input: AnomalyInput): Promise<AnomalyResult | undefined> {
  const url = process.env.SENTINEL_URL; // the same model service serves /sentinel, /anomaly and /forecast
  if (!url || process.env.ANOMALY_MODEL_DISABLED === "1") return undefined;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/anomaly`, {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.ANOMALY_TIMEOUT_MS ?? 3_000)),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archetype: input.archetype, features: anomalyFeatures(input) }),
    });
    if (!r.ok) return undefined;
    const j = (await r.json()) as { escalate: boolean; p_value: number; alpha: number; model_sha?: string };
    if (typeof j.escalate !== "boolean" || typeof j.p_value !== "number") return undefined;
    return { escalate: j.escalate, pValue: j.p_value, alpha: j.alpha, model: `M3 behaviour model ${j.model_sha?.slice(0, 12) ?? ""}`.trim() };
  } catch {
    return undefined; // the rule-based check still ran
  }
}
