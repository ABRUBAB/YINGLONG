import type { CityGraph, CityNode } from "@/lib/api/view";

/**
 * Fixed semantic layout for Agent City (master plan 14.7): not a force graph. The HK test rail is the
 * left plane, the coin-free FISCO rail the right plane, the seam between them carries the two anchors.
 * Units: x in [-5, 5], z in [-2.6, 2.6] (z towards the viewer). The same coordinates drive the 3D
 * scene and the 2D fallback, so both tell the same story.
 */
export interface PlacedNode extends CityNode {
  x: number;
  z: number;
  size: number;
}

const KIND_ORDER: Record<CityNode["kind"], number> = { user: 0, agent: 1, service: 2, rogue: 3, regulator: 4, anchor: 5 };

export const RAIL_BOUNDS = {
  hk: { x0: -4.9, x1: -0.55 },
  fisco: { x0: 0.55, x1: 4.9 },
  z0: -2.4,
  z1: 2.4,
};

function placeRail(nodes: CityNode[], rail: "hk" | "fisco"): PlacedNode[] {
  const b = RAIL_BOUNDS[rail];
  const sorted = [...nodes].sort((a, c) => KIND_ORDER[a.kind] - KIND_ORDER[c.kind] || a.label.localeCompare(c.label));
  const cols = 3;
  const rows = Math.max(1, Math.ceil(sorted.length / cols));
  const w = b.x1 - b.x0;
  const h = RAIL_BOUNDS.z1 - RAIL_BOUNDS.z0;
  return sorted.map((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // HK reads left to right towards the seam; FISCO mirrors it, so agents sit next to the seam.
    const fx = (col + 0.5) / cols;
    const x = rail === "hk" ? b.x1 - fx * w : b.x0 + fx * w;
    const z = RAIL_BOUNDS.z0 + ((row + 0.5) / rows) * h;
    return { ...n, x, z, size: 0.16 + (n.reputation / 100) * 0.16 };
  });
}

export function layoutCity(g: CityGraph): PlacedNode[] {
  const hk = g.nodes.filter((n) => n.rail === "hk");
  const fisco = g.nodes.filter((n) => n.rail === "fisco");
  const seam = g.nodes.filter((n) => n.rail === "seam");
  const placedSeam: PlacedNode[] = seam.map((n, i) => ({
    ...n,
    x: 0,
    z: seam.length === 1 ? 0 : -1.4 + (2.8 * i) / (seam.length - 1),
    size: 0.2,
  }));
  return [...placeRail(hk, "hk"), ...placeRail(fisco, "fisco"), ...placedSeam];
}
