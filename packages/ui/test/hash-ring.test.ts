import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  hashBytes,
  hashRingGeometry,
  hashRingStrip,
  nibble,
  tickLengthDistance,
  REVOKED_GAP,
} from "../src/hash-ring/geometry.ts";
import { GOLDEN_VECTORS, toHex } from "./vectors.ts";

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), "golden");

describe("hashRingGeometry golden files", () => {
  for (const v of GOLDEN_VECTORS) {
    it(`matches golden/${v.name}.json exactly`, () => {
      const golden = JSON.parse(readFileSync(join(goldenDir, `${v.name}.json`), "utf8"));
      expect(golden.H).toBe(v.H);
      expect(golden.K).toBe(toHex(keccak_256(hashBytes(v.H))));
      expect(hashRingGeometry(v.H, { revoked: v.revoked })).toStrictEqual(golden.geometry);
    });
  }
});

describe("hashRingGeometry spec", () => {
  const H = GOLDEN_VECTORS[2].H;
  const g = hashRingGeometry(H);

  it("has 64 ticks clockwise from 12 o'clock and nine arcs", () => {
    expect(g.ticks).toHaveLength(64);
    expect(g.arcs).toHaveLength(9);
    expect(g.ticks[0]!.angleDeg).toBe(-90);
    expect(g.ticks[16]!.angleDeg).toBe(0);
    expect(g.ticks[63]!.angleDeg).toBe(-90 + 63 * 5.625);
  });

  it("uses the high nibble for even ticks and the low nibble for odd ticks", () => {
    const h = hashBytes("0xa5" + "00".repeat(31));
    expect(nibble(h, 0)).toBe(0xa);
    expect(nibble(h, 1)).toBe(0x5);
    const geo = hashRingGeometry(h);
    expect(geo.ticks[0]!.r1 - geo.ticks[0]!.r0).toBeCloseTo(0.04 + 0.1, 12);
    expect(geo.ticks[1]!.r1 - geo.ticks[1]!.r0).toBeCloseTo(0.04 + 0.05, 12);
    expect(geo.ticks[2]!.r1 - geo.ticks[2]!.r0).toBeCloseTo(0.04, 12);
  });

  it("starts every tick at 0.80 R and keeps lengths within [0.04 R, 0.19 R]", () => {
    for (const t of hashRingGeometry(H, { R: 50 }).ticks) {
      expect(t.r0).toBeCloseTo(40, 12);
      const len = t.r1 - t.r0;
      expect(len).toBeGreaterThanOrEqual(0.04 * 50 - 1e-9);
      expect(len).toBeLessThanOrEqual(0.19 * 50 + 1e-9);
    }
  });

  it("derives the arcs from K = keccak256(H)", () => {
    const K = keccak_256(hashBytes(H));
    g.arcs.forEach((a, j) => {
      expect(a.j).toBe(j);
      expect(a.startDeg).toBe(-90 + (K[j]! * 360) / 256);
      expect(a.sweepDeg).toBe(8 + (K[j + 9]! % 32));
      expect(a.sweepDeg).toBeGreaterThanOrEqual(8);
      expect(a.sweepDeg).toBeLessThanOrEqual(39);
      expect(a.r).toBeCloseTo(0.7 - 0.025 * j, 12);
    });
  });

  it("drops ticks 62, 63, 0 and 1 when revoked and keeps the arcs", () => {
    const r = hashRingGeometry(H, { revoked: true });
    expect(r.ticks).toHaveLength(60);
    for (const t of r.ticks) expect(REVOKED_GAP.has(t.i)).toBe(false);
    expect(r.arcs).toStrictEqual(g.arcs);
  });

  it("rejects inputs that are not 32 bytes", () => {
    expect(() => hashRingGeometry("0x1234")).toThrow();
    expect(() => hashRingGeometry(new Uint8Array(31))).toThrow();
  });

  it("prints a 64-character strip", () => {
    expect(hashRingStrip(H)).toHaveLength(64);
  });
});

describe("hashRingGeometry property: distinct hashes give visibly distinct rings", () => {
  // For independent uniform hashes each tick length differs with probability 15/16, so the
  // number of differing ticks is Binomial(64, 15/16) with mean 60. P(fewer than 16 differ) is
  // below 1e-50, i.e. a failure here means the geometry no longer depends on every nibble.
  it("two random hashes differ in at least 16 tick lengths (5,000 pairs)", () => {
    let min = 64;
    for (let k = 0; k < 5000; k++) {
      const d = tickLengthDistance(randomBytes(32), randomBytes(32));
      if (d < min) min = d;
    }
    expect(min).toBeGreaterThanOrEqual(16);
  });

  it("a one-bit change in the mandate (and so a new keccak digest) moves at least 16 ticks", () => {
    const base = randomBytes(64);
    for (let k = 0; k < 2000; k++) {
      const flipped = Uint8Array.from(base);
      flipped[k % 64] = flipped[k % 64]! ^ (1 << (k % 8));
      const d = tickLengthDistance(keccak_256(base), keccak_256(flipped));
      expect(d).toBeGreaterThanOrEqual(16);
    }
  });
});
