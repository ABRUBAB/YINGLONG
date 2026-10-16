import { hashRingGeometry } from "@yinglong/ui";
import type { ServiceHashRing } from "./api/view";

/**
 * Cross-checks the agent service's Hash Ring against this page's own computation (two
 * implementations of docs/HASH_RING.md). Values are compared after normalising by R (the service
 * may use any radius): r / R must agree to 1e-9 and angles exactly.
 */
export function compareHashRing(hash: string, service: ServiceHashRing | null, revoked = false): "match" | "mismatch" | "absent" {
  if (!service) return "absent";
  const mine = hashRingGeometry(hash, { revoked });
  if (mine.ticks.length !== service.ticks.length || mine.arcs.length !== service.arcs.length) return "mismatch";
  const R = service.ticks[0] ? service.ticks[0].r0 / 0.8 : 1;
  if (!(R > 0)) return "mismatch";
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  for (let k = 0; k < mine.ticks.length; k++) {
    const a = mine.ticks[k]!;
    const b = service.ticks[k]!;
    if (a.i !== b.i || !close(a.angleDeg, b.angleDeg) || !close(a.r0, b.r0 / R) || !close(a.r1, b.r1 / R)) return "mismatch";
  }
  for (let k = 0; k < mine.arcs.length; k++) {
    const a = mine.arcs[k]!;
    const b = service.arcs[k]!;
    if (a.j !== b.j || !close(a.startDeg, b.startDeg) || !close(a.sweepDeg, b.sweepDeg) || !close(a.r, b.r / R)) return "mismatch";
  }
  return "match";
}
