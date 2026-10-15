import { describe, expect, it } from "vitest";
import { finalTier, ORDER } from "../src/tiers";
import type { Tier } from "@yinglong/sdk";

const TIERS: Tier[] = ["T0", "T1", "T2", "T3", "T4", "ASK"];

describe("monotonic-safety rule", () => {
  it("AI signals never lower a tier, never create T3 or T4, and only deterministic code yields T4", () => {
    let cases = 0;
    for (const t of TIERS) {
      for (let signals = 0; signals <= 5; signals++) {
        for (const clarify of [false, true]) {
          const out = finalTier(t, signals, clarify);
          cases++;
          expect(ORDER[out]).toBeGreaterThanOrEqual(ORDER[t]);
          if (out === "T4") expect(t).toBe("T4");
          if (out === "T3") expect(t).toBe("T3");
          if (signals === 0 && !clarify) expect(out).toBe(t);
        }
      }
    }
    expect(cases).toBe(72);
  });

  it("random sequences of escalations are monotone", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 5000; i++) {
      const t = TIERS[Math.floor(rnd() * TIERS.length)]!;
      const a = finalTier(t, Math.floor(rnd() * 3), rnd() < 0.3);
      const b = finalTier(a, Math.floor(rnd() * 3), rnd() < 0.3);
      expect(ORDER[b]).toBeGreaterThanOrEqual(ORDER[a]);
      expect(ORDER[a]).toBeGreaterThanOrEqual(ORDER[t]);
    }
  });
});
