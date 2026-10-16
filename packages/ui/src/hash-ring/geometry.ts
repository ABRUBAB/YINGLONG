/**
 * Hash Ring geometry (spec: docs/HASH_RING.md). Pure, deterministic, no DOM.
 *
 * Input H is the 32-byte EIP-712 delegation hash the DelegationManager accepts.
 * - 64 ticks. Tick i sits at angle -90 + i * 5.625 degrees (i = 0 at 12 o'clock, clockwise in
 *   screen coordinates, y down). Nibble n_i = high nibble of H[i >> 1] for even i, low nibble for odd i.
 *   The tick starts at r0 = 0.80 R and ends at r1 = r0 + (0.04 + 0.01 * n_i) * R.
 * - Nine arcs. K = keccak256(H). For j in 0..8: start = -90 + K[j] * 360 / 256 degrees,
 *   sweep = 8 + (K[j + 9] mod 32) degrees, radius = (0.70 - 0.025 * j) * R.
 * - Revoked: ticks 62, 63, 0 and 1 are omitted (gap at 12 o'clock); the renderer draws every tick in ash.
 *
 * Every value is computed with the exact expression order written above so that a Python twin
 * produces bit-identical IEEE-754 doubles.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";

export interface HashRingTick {
  i: number;
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
  ticks: HashRingTick[];
  arcs: HashRingArc[];
}

export interface HashRingOptions {
  /** Ring radius R. Default 1 (unit ring); golden files use 1. */
  R?: number;
  /** Revoked mandates drop ticks 62, 63, 0, 1. */
  revoked?: boolean;
}

export const HASH_RING_TICKS = 64;
export const HASH_RING_ARCS = 9;
export const REVOKED_GAP = new Set([62, 63, 0, 1]);

/** Accepts a 0x-prefixed 64-hex-digit string or a 32-byte array. */
export function hashBytes(H: string | Uint8Array): Uint8Array {
  if (H instanceof Uint8Array) {
    if (H.length !== 32) throw new Error(`hash ring: expected 32 bytes, got ${H.length}`);
    return H;
  }
  const hex = H.startsWith("0x") || H.startsWith("0X") ? H.slice(2) : H;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("hash ring: expected a 32-byte hex string");
  const out = new Uint8Array(32);
  for (let k = 0; k < 32; k++) out[k] = parseInt(hex.slice(k * 2, k * 2 + 2), 16);
  return out;
}

export function nibble(h: Uint8Array, i: number): number {
  const byte = h[i >> 1]!;
  return i % 2 === 0 ? byte >> 4 : byte & 0x0f;
}

export function hashRingGeometry(H: string | Uint8Array, opts: HashRingOptions = {}): HashRingGeometry {
  const R = opts.R ?? 1;
  const h = hashBytes(H);
  const ticks: HashRingTick[] = [];
  for (let i = 0; i < HASH_RING_TICKS; i++) {
    if (opts.revoked && REVOKED_GAP.has(i)) continue;
    const n = nibble(h, i);
    const angleDeg = -90 + i * 5.625;
    const r0 = 0.8 * R;
    const r1 = r0 + (0.04 + 0.01 * n) * R;
    ticks.push({ i, angleDeg, r0, r1 });
  }
  const K = keccak_256(h);
  const arcs: HashRingArc[] = [];
  for (let j = 0; j < HASH_RING_ARCS; j++) {
    const startDeg = -90 + (K[j]! * 360) / 256;
    const sweepDeg = 8 + (K[j + 9]! % 32);
    const r = (0.7 - 0.025 * j) * R;
    arcs.push({ j, startDeg, sweepDeg, r });
  }
  return { ticks, arcs };
}

/** Number of tick positions whose length differs between two hashes (used by the property test). */
export function tickLengthDistance(a: string | Uint8Array, b: string | Uint8Array): number {
  const ha = hashBytes(a);
  const hb = hashBytes(b);
  let d = 0;
  for (let i = 0; i < HASH_RING_TICKS; i++) if (nibble(ha, i) !== nibble(hb, i)) d++;
  return d;
}

/** Point on a circle for an angle in degrees (screen coordinates, y down). */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** SVG path for an arc (clockwise in screen space). */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const [x0, y0] = polar(cx, cy, r, startDeg);
  const [x1, y1] = polar(cx, cy, r, startDeg + sweepDeg);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M${x0.toFixed(3)} ${y0.toFixed(3)} A${r.toFixed(3)} ${r.toFixed(3)} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

/** ASCII strip (64 characters, one per tick) used by the CLI twin and in alt text. */
export function hashRingStrip(H: string | Uint8Array): string {
  const glyphs = " .:-=+*#%@ABCDEF";
  const h = hashBytes(H);
  let s = "";
  for (let i = 0; i < HASH_RING_TICKS; i++) s += glyphs[nibble(h, i)];
  return s;
}
