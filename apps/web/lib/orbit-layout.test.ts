import { describe, expect, it } from "vitest";
import { orbitLayout, orbitSummary, TRACKS } from "./orbit-layout";

const r = (receiptId: string, outcome: string, tier: string) => ({ receiptId, outcome, tier }) as Parameters<typeof orbitLayout>[0][number];

describe("Mandate Orbit layout", () => {
  const receipts = [
    r("a", "confirmed", "T1"),
    r("b", "confirmed", "T3"),
    r("c", "rejected_policy", "T4"),
    r("d", "reverted", "T2"),
    r("e", "awaiting_approval", "T2"),
    r("f", "asked", "ASK"),
    r("g", "confirmed", "T2"),
  ];
  const slots = orbitLayout(receipts);

  it("keeps one slot per receipt, in receipt order", () => {
    expect(slots.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("puts refusals outside the ring and everything else inside or on it", () => {
    for (const s of slots) {
      if (s.kind === "refused") expect(s.r).toBeGreaterThan(1.1);
      else expect(s.r).toBeLessThanOrEqual(1);
    }
  });

  it("places allowed receipts on the track of the authority they needed", () => {
    const within = (i: number, t: keyof typeof TRACKS) => {
      const [a, b] = TRACKS[t];
      expect(slots[i]!.r).toBeGreaterThanOrEqual(a);
      expect(slots[i]!.r).toBeLessThanOrEqual(b);
    };
    within(0, "t1");
    within(1, "t3");
    within(6, "t2");
    within(5, "centre");
    expect(slots[4]!.r).toBe(1);
  });

  it("is deterministic and counts every kind", () => {
    expect(orbitLayout(receipts)).toEqual(slots);
    expect(orbitSummary(slots)).toEqual({ inside: 3, waiting: 1, asked: 1, refused: 2, total: 7 });
  });
});
