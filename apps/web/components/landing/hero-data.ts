import type { BudgetLane, Receipt } from "@/lib/api/view";
import type { Tier } from "@/lib/api/view";

/** How many receipts the hero asks GET /v1/receipts for. */
export const HERO_RECEIPTS = 200;

/**
 * Fixtures only: a deterministic bench-style set of receipts fills the orbit so the e2e build and
 * the posters show it at working density. The hero labels them "Sample data"; live builds never call this.
 */
export function sampleBench(count: number): Pick<Receipt, "receiptId" | "outcome" | "tier">[] {
  const out: Pick<Receipt, "receiptId" | "outcome" | "tier">[] = [];
  let x = 2463534242;
  for (let i = 0; i < count; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = (x >>> 0) / 4294967296;
    const [outcome, tier]: [Receipt["outcome"], Tier] =
      r < 0.42 ? ["confirmed", "T3"] : r < 0.58 ? ["confirmed", "T1"] : r < 0.62 ? ["confirmed", "T2"] : r < 0.66 ? ["asked", "ASK"] : r < 0.68 ? ["awaiting_approval", "T2"] : r < 0.92 ? ["rejected_policy", "T4"] : ["reverted", "T4"];
    out.push({ receiptId: `bench-${i}`, outcome, tier });
  }
  return out;
}

/** Unspent share across the period lanes (ratio of base-unit integers; drawing only). */
export function remainingShare(lanes: BudgetLane[]): number {
  let cap = 0n;
  let left = 0n;
  // One unit only: never add base units of different assets.
  const symbol = lanes.find((l) => l.period !== "once")?.cap.symbol;
  for (const l of lanes) {
    if (l.period === "once" || l.cap.symbol !== symbol) continue;
    const c = BigInt(l.cap.value);
    const s = BigInt(l.spent.value);
    cap += c;
    left += s > c ? 0n : c - s;
  }
  if (cap === 0n) return 1;
  return Number((left * 10000n) / cap) / 10000;
}
