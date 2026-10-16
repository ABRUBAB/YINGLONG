import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalise } from "../src/scales/normalise";
import { leaks, SET, type Kind } from "./scrubber-set";

// Recall of the PII scrubber on a labelled synthetic set. The measured recall is reported, not asserted: formats the
// scrubber misses are a measured gap, not a test failure. When SCRUBBER_REPORT names a file (scripts/finalize sets
// it), the per-kind result is written there as JSON.

const KINDS: Kind[] = ["mainland-mobile", "mainland-id", "unionpay-card", "private-key", "seed-phrase"];

function measure() {
  const perKind = Object.fromEntries(KINDS.map((k) => [k, { n: 0, detected: 0, missedFormats: [] as string[] }]));
  for (const p of SET.positives) {
    const r = perKind[p.kind]!;
    r.n++;
    if (leaks(p, normalise(p.text).text)) {
      if (!r.missedFormats.includes(p.format)) r.missedFormats.push(p.format);
    } else r.detected++;
  }
  const falsePositives: string[] = [];
  for (const q of SET.negatives) if (normalise(q.text).scrubbed.length) falsePositives.push(q.format);
  const n = SET.positives.length;
  const detected = Object.values(perKind).reduce((a, r) => a + r.detected, 0);
  return { n, detected, perKind, negatives: { n: SET.negatives.length, falsePositives } };
}

describe("PII scrubber recall on a labelled synthetic set", () => {
  const m = measure();

  it("the labelled set covers every kind the scrubber claims, in several formats", () => {
    for (const k of KINDS) expect(m.perKind[k]!.n).toBeGreaterThanOrEqual(10);
    expect(m.negatives.n).toBeGreaterThanOrEqual(10);
  });

  it("scrubs the canonical form of every kind", () => {
    const canonical = SET.positives.filter((p) => ["plain 11 digits", "plain 18 characters", "plain 16 digits", "0x + 64 hex", "'seed phrase:' + 12 words"].includes(p.format));
    expect(canonical.length).toBeGreaterThanOrEqual(5);
    for (const p of canonical) expect(leaks(p, normalise(p.text).text), `${p.kind} (${p.format})`).toBe(false);
  });

  it("a scrubbed identifier leaves a redaction tag, never a partial identifier", () => {
    for (const p of SET.positives) {
      const out = normalise(p.text);
      if (!leaks(p, out.text)) expect(out.text).toMatch(/\[REDACTED_[A-Z_]+\]/);
    }
  });

  it("reports recall", () => {
    const report = { generatedBy: "apps/agent/test/scrubber.test.ts", scrubber: "apps/agent/src/scales/normalise.ts", ...m };
    if (process.env.SCRUBBER_REPORT) writeFileSync(process.env.SCRUBBER_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    expect(m.detected).toBeLessThanOrEqual(m.n);
  });
});
