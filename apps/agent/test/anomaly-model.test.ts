import { describe, expect, it } from "vitest";
import { anomalyFeatures, lookalike } from "../src/scales/anomaly-model";
import type { ReceiptRecord } from "../src/receipts";

const rec = (at: string, payee: string, amount: string): ReceiptRecord =>
  ({ receipt: { outcome: "confirmed" }, createdAt: at, principal: "nadia", payment: { symbol: "tHKD", decimals: 6, amount, payeeLabel: "x", payee, method: "transfer" } }) as unknown as ReceiptRecord;

describe("anomaly features (mirror of ml/anomaly/world.py)", () => {
  const payee = "0x1111111111111111111111111111111111111111";
  const now = new Date("2026-10-18T10:00:00Z");
  const history = [rec("2026-10-17T11:00:00Z", payee, "1000000000"), rec("2026-10-18T09:30:00Z", payee, "1000000000")];
  it("counts the recent activity and the payee history", () => {
    const f = anomalyFeatures({ archetype: "student", history, payee, amount: 1_000_000_000n, decimals: 6, t1Threshold: 5_000_000_000n, now, untrusted: false, scheduled: false });
    expect(f.f_payee_hist_n).toBe(2);
    expect(f.f_n_1h).toBe(1);
    expect(f.f_n_24h).toBe(2);
    expect(f.f_n_same_payee_24h).toBe(2);
    expect(f.f_dup_amount_24h).toBe(1);
    expect(f.f_new_payee).toBe(0);
    expect(f.f_amount_over_thr).toBeCloseTo(0.2);
    for (const v of Object.values(f)) expect(Number.isFinite(v)).toBe(true);
  });
  it("marks a first payment to a payee and a large amount", () => {
    const f = anomalyFeatures({ archetype: "student", history: [], payee, amount: 9_000_000_000n, decimals: 6, t1Threshold: 5_000_000_000n, now, untrusted: true, scheduled: false });
    expect(f.f_new_payee).toBe(1);
    expect(f.f_untrusted).toBe(1);
    expect(f.f_amount_over_thr).toBeCloseTo(1.8);
  });
  it("scores look-alike addresses", () => {
    const a = "0xabcdef0123456789abcdef0123456789abcdef01";
    expect(lookalike(a, [a])).toBe(0);
    expect(lookalike("0xabcdef9999999999999999999999999999999f01", [a])).toBeGreaterThan(0.4);
    expect(lookalike("0x22222222222222222222222222222222222222ff", [a])).toBe(0);
  });
});
