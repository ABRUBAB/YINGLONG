import type { BudgetLane, Receipt } from "@/lib/api/view";
import type { DragonEvent, ScaleState } from "@/components/three/receipt-dragon";
import { formatTime } from "@/lib/format";

export const SLOT_COUNT = 370;

export function scaleState(r: Receipt): ScaleState {
  if (r.outcome === "confirmed") return "confirmed";
  if (r.outcome === "reverted" || r.outcome === "rejected_policy") return "reverted";
  return "pending";
}

/**
 * Fixtures only: a deterministic bench-style distribution fills the remaining slots so the poster
 * shows the dragon at working density. The page labels it "Sample receipts (bench)".
 */
export function sampleBench(count: number): ScaleState[] {
  const out: ScaleState[] = [];
  let x = 2463534242;
  for (let i = 0; i < count; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = (x >>> 0) / 4294967296;
    out.push(r < 0.04 ? "reverted" : r < 0.06 ? "pending" : "confirmed");
  }
  return out;
}

export function eventsFrom(receipts: Receipt[]): DragonEvent[] {
  const events: DragonEvent[] = [];
  for (const r of receipts.slice(0, 6)) {
    const when = formatTime(r.timestamp, { date: false });
    const tier = r.tier === "ASK" ? "T?" : r.tier;
    if (r.outcome === "reverted" || r.outcome === "rejected_policy") events.push({ kind: "refusal", label: `${when} · ${r.summary} · refused${r.revertError ? `: ${r.revertError}` : ""}` });
    else if (r.outcome === "asked" || r.tier === "ASK") events.push({ kind: "ask", label: `${when} · Ying stopped and asked · T?` });
    else if (r.outcome === "awaiting_approval" || r.tier === "T2") events.push({ kind: "t2", label: `${when} · ${r.summary} · waiting for you · ${tier}` });
    else if (r.outcome === "confirmed") events.push({ kind: "t1", label: `${when} · ${r.summary} · ${tier}` });
    if (events.length >= 4) break;
  }
  const anchored = receipts.find((r) => r.anchor);
  if (anchored?.anchor) {
    const a = anchored.anchor;
    const where = a.baseTx && a.fiscoTx ? "on both ledgers" : a.fiscoTx ? "on FISCO BCOS" : a.baseTx ? "on Base Sepolia" : "on chain";
    events.push({ kind: "anchor", label: `Receipt batch anchored ${where}` });
  }
  return events;
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
