/**
 * Geometry shared by the 3D tunnel and the DOM that sits over it, so the text always agrees with the
 * picture. The coin starts in front of gate 1 and crosses the gates in order. When an attack was
 * stopped at gate `stop` (0 to 8) the coin ends just before that gate; with no stopped attack it
 * leaves through gate 9. The first 82% of the scroll moves the coin; the rest holds the end state.
 */
export const GATES = 9;
export const GAP = 3.4;
export const RUN = 0.82;
const Z_START = 2.2;

export function gateZ(i: number): number {
  return -i * GAP;
}

export function coinEndZ(stop: number): number {
  return stop >= 0 ? gateZ(stop) + 0.35 : gateZ(GATES - 1) - 3.2;
}

export function coinZ(p: number, stop: number): number {
  const t = Math.min(1, Math.max(0, p / RUN));
  return Z_START + (coinEndZ(stop) - Z_START) * t;
}

/** How many gates the coin has crossed at scroll progress p (0 to 9). */
export function gatesPassed(p: number, stop: number): number {
  const z = coinZ(p, stop);
  let n = 0;
  for (let i = 0; i < GATES; i++) if (z < gateZ(i) - 0.05) n++;
  return n;
}

/** 0 before the stop, 1 once the coin has shattered. */
export function shatter(p: number, stop: number): number {
  if (stop < 0) return 0;
  return Math.min(1, Math.max(0, (p - RUN) / 0.12));
}

/** The scroll position (0 to 1) at which the coin is at gate i. */
export function progressAtGate(i: number, stop: number): number {
  const z0 = Z_START;
  const z1 = coinEndZ(stop);
  const target = Math.min(i, stop >= 0 ? stop : GATES - 1);
  const z = gateZ(target) + (stop >= 0 && target === stop ? 0.35 : -0.6);
  const t = (z0 - z) / (z0 - z1);
  return Math.min(1, Math.max(0, t)) * RUN;
}
