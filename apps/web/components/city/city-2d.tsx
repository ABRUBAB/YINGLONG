import { f3 } from "@yinglong/ui";
import type { CityGraph } from "@/lib/api/view";
import { layoutCity, RAIL_BOUNDS, type PlacedNode } from "./layout";

const sx = (x: number) => f3(500 + x * 96);
const sy = (z: number) => f3(290 + z * 100);

/**
 * 2D Agent City: the poster and the fallback under reduced motion or without WebGL2. Same fixed
 * layout as the 3D scene. Settled payments are bone, awaiting are brass, reverted ones stop at a
 * barred ring in front of the payee.
 */
export function City2D({ graph, className }: { graph: CityGraph; className?: string }) {
  const nodes = layoutCity(graph);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg viewBox="0 0 1000 580" className={className} role="img" aria-label="Agent City map: HK test rail on the left, coin-free FISCO rail on the right, anchors on the seam">
      {(["hk", "fisco"] as const).map((rail) => {
        const b = RAIL_BOUNDS[rail];
        return (
          <g key={rail}>
            <rect
              x={sx(b.x0)}
              y={sy(RAIL_BOUNDS.z0) - 16}
              width={f3((b.x1 - b.x0) * 96)}
              height={f3((RAIL_BOUNDS.z1 - RAIL_BOUNDS.z0) * 100) + 32}
              rx="10"
              fill="var(--bg-1)"
              stroke="var(--line-2)"
            />
            <text x={sx(b.x0) + 14} y={sy(RAIL_BOUNDS.z0) - 24} fontSize="12" fill="var(--fg-muted)" style={{ fontFamily: "var(--font-sans)", letterSpacing: "0.12em" }}>
              {rail === "hk" ? "HK TEST RAIL · BASE SEPOLIA" : "COIN-FREE RAIL · FISCO BCOS"}
            </text>
          </g>
        );
      })}
      <line x1={sx(0)} x2={sx(0)} y1={sy(RAIL_BOUNDS.z0) - 30} y2={sy(RAIL_BOUNDS.z1) + 30} stroke="var(--line-3)" strokeDasharray="3 5" />
      {graph.edges.map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const stroke = e.state === "settled" ? "var(--fg-2)" : e.state === "awaiting" ? "var(--brass)" : "var(--fg-faint)";
        // reverted payments stop short of the payee, at its refusing ring
        const t = e.state === "reverted" ? 0.78 : 1;
        const x2 = sx(a.x + (b.x - a.x) * t);
        const y2 = sy(a.z + (b.z - a.z) * t);
        return (
          <g key={e.id}>
            <line x1={sx(a.x)} y1={sy(a.z)} x2={x2} y2={y2} stroke={stroke} strokeWidth="1.25" strokeDasharray={e.state === "awaiting" ? "4 4" : undefined} />
            {e.state === "reverted" ? <circle cx={x2} cy={y2} r="5" fill="none" stroke="var(--fg-1)" strokeWidth="1.25" /> : null}
            {e.state === "reverted" ? <line x1={x2 - 3.5} y1={y2 + 3.5} x2={x2 + 3.5} y2={y2 - 3.5} stroke="var(--fg-1)" strokeWidth="1.25" /> : null}
          </g>
        );
      })}
      {graph.anchors.length ? <path d={`M${sx(-0.4)} ${sy(-1.4)} C ${sx(0.25)} ${sy(-0.6)}, ${sx(-0.25)} ${sy(0.6)}, ${sx(0.4)} ${sy(1.4)}`} fill="none" stroke="var(--steel)" strokeWidth="1" strokeDasharray="2 4" /> : null}
      {nodes.map((n) => (
        <Node key={n.id} n={n} />
      ))}
    </svg>
  );
}

function Node({ n }: { n: PlacedNode }) {
  const r = f3(n.size * 40);
  const cx = sx(n.x);
  const cy = sy(n.z);
  return (
    <g>
      {n.kind === "anchor" || n.kind === "regulator" ? (
        <rect x={cx - r} y={cy - r * 0.7} width={r * 2} height={r * 1.4} rx="3" fill="var(--bg-3)" stroke="var(--steel)" strokeWidth="1.25" />
      ) : (
        <circle cx={cx} cy={cy} r={r} fill="var(--bg-3)" stroke="var(--chrome-1)" strokeWidth={n.kind === "agent" ? 1.75 : 1} />
      )}
      {n.passport !== "none" ? (
        <circle
          cx={cx}
          cy={cy}
          r={r + 5}
          fill="none"
          stroke={n.passport === "attested" ? "var(--fg-2)" : "var(--fg-faint)"}
          strokeDasharray={n.passport === "self-registered" ? "3 3" : undefined}
        />
      ) : null}
      <text x={cx} y={cy + r + 20} textAnchor="middle" fontSize="12" fill={n.kind === "rogue" ? "var(--fg-muted)" : "var(--fg-1)"} style={{ fontFamily: "var(--font-sans)" }}>
        {n.label}
      </text>
    </g>
  );
}
