import type { Tier } from "@yinglong/sdk";

/**
 * The monotonic-safety rule, as a pure function (property-tested in apps/agent/test/tiers.test.ts).
 * `deterministic` is the tier from deterministic code (policy mirror, grounding, counterparty rules).
 * AI signals (sentinel, quarantine flags, anomaly) may raise T1 to T2 and T2 to ASK; they never lower a tier
 * and never produce T3 or T4. A clarification question (missing or ungrounded data) turns T1/T2 into ASK.
 */
export const ORDER: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, ASK: 3, T3: 4, T4: 5 };

export function finalTier(deterministic: Tier, aiSignals: number, needsClarification: boolean): Tier {
  let t = deterministic;
  if (aiSignals > 0 && (t === "T1" || t === "T2")) t = t === "T1" ? "T2" : "ASK";
  if (needsClarification && (t === "T1" || t === "T2")) t = "ASK";
  return t;
}
