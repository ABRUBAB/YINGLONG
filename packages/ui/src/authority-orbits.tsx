import { cn, f3 } from "./cn.ts";
import { arcPath } from "./hash-ring/geometry.ts";

export type AuthorityStatus = "active" | "paused" | "revoked";

export interface AuthorityNode {
  id: string;
  /** "Nadia (passkey)", "Ying", "FX quote child" */
  label: string;
  /** Short role line: "Owner, sealed v3", "Agent, passport #4127" */
  sublabel?: string;
  status: AuthorityStatus;
  /** Draw the identity pearl on this ring (the agent's on-chain passport). */
  identity?: boolean;
  children?: AuthorityNode[];
}

const RADII = [0.94, 0.66];

function Ring({
  r,
  cx = 0,
  cy = 0,
  status,
  depth,
  identity,
  fontSize,
  label,
}: {
  r: number;
  cx?: number;
  cy?: number;
  status: AuthorityStatus;
  depth: number;
  identity?: boolean;
  fontSize: number;
  label: string;
}) {
  const stroke = depth === 0 ? "var(--chrome-1)" : depth === 1 ? "var(--fg-1)" : "var(--fg-2)";
  const sw = depth === 0 ? 1.5 : depth === 1 ? 1.25 : 1;
  const pearl = identity ? { x: f3(cx + r * Math.cos((-30 * Math.PI) / 180)), y: f3(cy + r * Math.sin((-30 * Math.PI) / 180)) } : null;
  return (
    <g data-status={status}>
      {status === "revoked" ? (
        <path
          d={arcPath(cx, cy, r, -78, 336)}
          fill="none"
          stroke="var(--fg-faint)"
          strokeWidth={sw}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={status === "paused" ? "var(--fg-muted)" : stroke}
          strokeWidth={sw}
          strokeDasharray={status === "paused" ? "4 4" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {pearl && status !== "revoked" ? <circle cx={pearl.x} cy={pearl.y} r={0.045} fill="var(--steel)" /> : null}
      <text
        x={cx}
        y={f3(cy - r + fontSize * 1.6)}
        textAnchor="middle"
        fontSize={f3(fontSize)}
        fill={status === "revoked" ? "var(--fg-faint)" : "var(--fg-2)"}
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Authority Orbits (master plan 14.6.3): nested rings, user > agent > sub-agents. Every
 * re-delegation is drawn strictly inside its parent, which shows the narrowing-only rule without a
 * caption. A revoked ring collapses to a dashed arc with a gap at 12 o'clock.
 */
export function AuthorityOrbits({ root, size = 232, className }: { root: AuthorityNode; size?: number; className?: string }) {
  const fontSize = 11 / (size / 2);
  const agent = root.children?.[0];
  const subs = agent?.children ?? [];
  const subR = subs.length > 2 ? 0.15 : 0.18;
  const orbitR = RADII[1]! - subR - 0.1;
  const flat: Array<{ node: AuthorityNode; depth: number }> = [{ node: root, depth: 0 }];
  if (agent) flat.push({ node: agent, depth: 1 });
  subs.forEach((s) => flat.push({ node: s, depth: 2 }));
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <svg
        viewBox="-1 -1 2 2"
        width={size}
        height={size}
        role="img"
        aria-label={`Authority: ${flat
          .map(({ node, depth }) => `${"inside ".repeat(depth)}${node.label} (${node.status})`)
          .join(", ")}`}
        className="overflow-visible"
      >
        <Ring r={RADII[0]!} status={root.status} depth={0} fontSize={fontSize} label={root.label} />
        {agent ? (
          <Ring
            r={RADII[1]!}
            status={agent.status}
            depth={1}
            identity={agent.identity}
            fontSize={fontSize}
            label={agent.label}
          />
        ) : null}
        {subs.map((s, k) => {
          const spread = subs.length === 1 ? [90] : subs.map((_, q) => 40 + (100 * q) / Math.max(1, subs.length - 1));
          const deg = spread[k]!;
          const cx = f3(orbitR * Math.cos((deg * Math.PI) / 180));
          const cy = f3(orbitR * Math.sin((deg * Math.PI) / 180) * 0.92);
          return (
            <Ring
              key={s.id}
              r={subR}
              cx={cx}
              cy={cy}
              status={s.status}
              depth={2}
              identity={s.identity}
              fontSize={fontSize * 0.92}
              label={s.label}
            />
          );
        })}
      </svg>
      <ol className="m-0 grid w-full list-none gap-1.5 p-0">
        {flat.map(({ node, depth }) => (
          <li key={node.id} className="flex items-baseline gap-2 text-12" style={{ paddingLeft: depth * 12 }}>
            <span
              aria-hidden="true"
              className={cn(
                "inline-block size-2 shrink-0 translate-y-[1px] rounded-pill border",
                node.status === "active" ? "border-fg-1" : "border-dashed border-fg-muted",
              )}
            />
            <span className="text-fg-1">{node.label}</span>
            {node.sublabel ? <span className="truncate text-fg-muted">{node.sublabel}</span> : null}
            {node.status !== "active" ? (
              <span className="ml-auto text-fg-muted">{node.status === "paused" ? "Paused" : "Revoked"}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
