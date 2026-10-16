/**
 * Mandate Orbit layout (the landing hero). Pure and deterministic: the 3D
 * scene, the poster and the hero's numbers all read the same slots.
 *
 * Grammar (one unit = the mandate ring's radius, the disc lies in the x/z plane):
 * - inside the ring: receipts the mandate allowed. Distance from the centre is the authority the
 *   action needed: T0/T1 (the agent alone) on the inner track, T2 (you confirmed) in the middle,
 *   T3 (only your own account: seals, payees, limits) on the outer track, next to the boundary;
 * - on the ring: actions waiting on a person (pending, awaiting approval), drawn in brass;
 * - at the centre, by the agent: "Not sure, your call" (asked) receipts, brass;
 * - outside the ring: refused or reverted attempts. They never enter; in motion they deflect off it.
 * Angle is time: the newest receipt of each track sits at 12 o'clock, older ones follow clockwise.
 */
import type { Receipt } from "@/lib/api/view";

export type OrbitKind = "inside" | "waiting" | "asked" | "refused";
export type OrbitTrack = "t1" | "t2" | "t3" | "ring" | "centre" | "outside";

export interface OrbitSlot {
  /** Index into the receipts array (newest first). */
  index: number;
  kind: OrbitKind;
  track: OrbitTrack;
  /** Polar position in the disc plane: radius in ring units, angle in radians (0 = 3 o'clock, counter-clockwise). */
  r: number;
  a: number;
  /** Small vertical offset so neighbours never z-fight. */
  y: number;
}

export interface OrbitSummary {
  inside: number;
  waiting: number;
  asked: number;
  refused: number;
  total: number;
}

/** Track radii (ring units). The tracks are drawn as faint guide circles at their middle. */
export const TRACKS: Record<OrbitTrack, [number, number]> = {
  centre: [0.07, 0.17],
  t1: [0.28, 0.44],
  t2: [0.5, 0.62],
  t3: [0.68, 0.86],
  ring: [1, 1],
  outside: [1.1, 1.26],
};

export function orbitKind(r: Pick<Receipt, "outcome" | "tier">): OrbitKind {
  if (r.outcome === "reverted" || r.outcome === "rejected_policy") return "refused";
  if (r.outcome === "pending" || r.outcome === "awaiting_approval") return "waiting";
  if (r.outcome === "asked") return "asked";
  return "inside";
}

function trackOf(r: Pick<Receipt, "outcome" | "tier">, kind: OrbitKind): OrbitTrack {
  if (kind === "refused") return "outside";
  if (kind === "waiting") return "ring";
  if (kind === "asked") return "centre";
  if (r.tier === "T3") return "t3";
  if (r.tier === "T2" || r.tier === "ASK") return "t2";
  return "t1";
}

/** FNV-1a over the id: a stable 0..1 jitter per receipt (never Math.random, so posters are repeatable). */
export function unitHash(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function orbitLayout(receipts: Pick<Receipt, "receiptId" | "outcome" | "tier">[]): OrbitSlot[] {
  const groups = new Map<OrbitTrack, { index: number; kind: OrbitKind; id: string }[]>();
  receipts.forEach((r, index) => {
    const kind = orbitKind(r);
    const track = trackOf(r, kind);
    const list = groups.get(track) ?? [];
    list.push({ index, kind, id: r.receiptId });
    groups.set(track, list);
  });
  const slots: OrbitSlot[] = [];
  for (const [track, list] of groups) {
    const [r0, r1] = TRACKS[track];
    const n = list.length;
    // Spread a track evenly once it is busy; a sparse track keeps a readable 14-degree spacing.
    const step = Math.min((Math.PI * 2) / Math.max(n, 1), (14 * Math.PI) / 180);
    list.forEach((item, k) => {
      const j = unitHash(item.id, 1);
      const r = track === "ring" ? 1 : r0 + (r1 - r0) * j;
      // Outside, refusals are spread round the whole ring (golden angle) so they press on every side.
      const a = track === "outside" ? Math.PI / 2 - k * 2.399963 : Math.PI / 2 - k * step - (j - 0.5) * step * 0.35;
      slots.push({ index: item.index, kind: item.kind, track, r, a, y: (unitHash(item.id, 2) - 0.5) * 0.012 });
    });
  }
  return slots.sort((x, y) => x.index - y.index);
}

export function orbitSummary(slots: OrbitSlot[]): OrbitSummary {
  const s: OrbitSummary = { inside: 0, waiting: 0, asked: 0, refused: 0, total: slots.length };
  for (const x of slots) s[x.kind]++;
  return s;
}
