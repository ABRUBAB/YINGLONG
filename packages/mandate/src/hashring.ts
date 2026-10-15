import { hexToBytes, keccak256, type Hex } from "viem";

/**
 * Hash Ring geometry, spec v1 (docs/HASH_RING.md; the Python twin in tools/verify-py must match).
 * Input H: the 32-byte EIP-712 delegation hash the DelegationManager accepts (getDelegationHash).
 *  - 64 ticks; tick i at angle -90 + i * 5.625 degrees (i = 0 at 12 o'clock, clockwise).
 *  - nibble n_i = high nibble of H[i >> 1] when i is even, low nibble when i is odd.
 *  - tick from radius 0.80R outward, length (0.04 + 0.01 * n_i) * R.
 *  - nine arcs from K = keccak256(H): for j in 0..8, start = -90 + K[j] * 360 / 256 degrees,
 *    sweep = 8 + (K[j + 9] mod 32) degrees, radius = (0.70 - 0.025 * j) * R.
 *  - revoked: ticks i in {62, 63, 0, 1} omitted (gap at 12 o'clock), all ticks ash.
 * The ring proves hash identity, not mandate correctness.
 */
export interface HashRingTick {
  i: number;
  nibble: number;
  angleDeg: number;
  r0: number;
  r1: number;
}

export interface HashRingArc {
  j: number;
  startDeg: number;
  sweepDeg: number;
  r: number;
}

export interface HashRingGeometry {
  hash: Hex;
  revoked: boolean;
  ticks: HashRingTick[];
  arcs: HashRingArc[];
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function hashRingGeometry(h: Hex, opts: { revoked?: boolean; radius?: number } = {}): HashRingGeometry {
  const R = opts.radius ?? 1;
  const bytes = hexToBytes(h);
  if (bytes.length !== 32) throw new Error("Hash Ring input must be 32 bytes");
  const k = hexToBytes(keccak256(h));
  const gap = new Set([62, 63, 0, 1]);
  const ticks: HashRingTick[] = [];
  for (let i = 0; i < 64; i++) {
    if (opts.revoked && gap.has(i)) continue;
    const b = bytes[i >> 1]!;
    const nibble = i % 2 === 0 ? b >> 4 : b & 0x0f;
    ticks.push({ i, nibble, angleDeg: round(-90 + i * 5.625), r0: round(0.8 * R), r1: round((0.8 + 0.04 + 0.01 * nibble) * R) });
  }
  const arcs: HashRingArc[] = [];
  for (let j = 0; j < 9; j++) {
    arcs.push({ j, startDeg: round(-90 + (k[j]! * 360) / 256), sweepDeg: 8 + (k[j + 9]! % 32), r: round((0.7 - 0.025 * j) * R) });
  }
  return { hash: h, revoked: !!opts.revoked, ticks, arcs };
}

/** ASCII strip of the 64 tick lengths (for terminals and the Python verifier's output). */
export function hashRingAscii(h: Hex): string {
  const glyphs = " .:-=+*#%@ABCDEF";
  return hashRingGeometry(h)
    .ticks.map((t) => glyphs[t.nibble])
    .join("");
}

/** Number of ticks whose length differs between two hashes. */
export function tickDifference(a: Hex, b: Hex): number {
  const ta = hashRingGeometry(a).ticks;
  const tb = hashRingGeometry(b).ticks;
  let d = 0;
  for (let i = 0; i < 64; i++) if (ta[i]!.nibble !== tb[i]!.nibble) d++;
  return d;
}
