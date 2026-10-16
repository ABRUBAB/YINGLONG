import type { CSSProperties } from "react";
import { cn, shortHash } from "../cn.ts";
import { hashRingGeometry } from "./geometry.ts";

export type HashRingPhase = "draft" | "holding" | "sealed" | "revoked";

export interface HashRingProps {
  /** H: the 32-byte EIP-712 delegation hash (0x-prefixed hex). */
  hash: string;
  /** Rendered size in CSS px. */
  size?: number;
  /**
   * draft: compiled but not sealed (muted, dashed base ring).
   * holding: the press-and-hold seal is filling (progress 0..1).
   * sealed: set in chrome, ticks drawn.
   * revoked: gap at 12 o'clock, ticks in ash.
   */
  phase?: HashRingPhase;
  /** Hold progress 0..1 (phase "holding"). */
  progress?: number;
  /** Draw ticks in from zero when the component mounts (signature moment: "seal set"). */
  drawIn?: boolean;
  /** Hide the caption and short hash. */
  bare?: boolean;
  className?: string;
  title?: string;
}

/**
 * The Hash Ring (master plan 14.6, spec docs/HASH_RING.md). Geometry comes only from
 * hashRingGeometry(); this component never invents a tick. Each tick is a unit line transformed by
 * rotate(angle) translate(r0) scaleX(length), so a change of hash morphs tick lengths in place.
 */
export function HashRing({
  hash,
  size = 160,
  phase = "sealed",
  progress = 0,
  drawIn = false,
  bare = true,
  className,
  title,
}: HashRingProps) {
  const revoked = phase === "revoked";
  const geo = hashRingGeometry(hash, { revoked });
  const tickTone =
    phase === "sealed" ? "var(--chrome-1)" : phase === "revoked" ? "var(--fg-faint)" : "var(--fg-muted)";
  const arcTone = phase === "sealed" ? "var(--chrome-2)" : phase === "revoked" ? "var(--line-2)" : "var(--line-3)";
  const baseTone = phase === "sealed" ? "var(--chrome-0)" : phase === "revoked" ? "var(--line-3)" : "var(--line-3)";
  const tickWidth = size >= 200 ? 1.6 : size >= 120 ? 1.3 : 1;
  const label =
    title ??
    `Hash Ring for delegation hash ${shortHash(hash, 10, 8)}, ${
      phase === "sealed" ? "sealed" : phase === "revoked" ? "revoked" : phase === "holding" ? "sealing" : "draft, not sealed"
    }`;
  const p = Math.max(0, Math.min(1, progress));
  // Dashes measured with pathLength must use user-unit strokes (non-scaling strokes ignore pathLength).
  const px = 2 / size;
  return (
    <figure className={cn("relative m-0 inline-flex flex-col items-center", className)}>
      <svg
        viewBox="-1 -1 2 2"
        width={size}
        height={size}
        role="img"
        aria-label={label}
        className={cn("yl-hash-ring overflow-visible", drawIn && "yl-hash-ring--draw")}
        data-phase={phase}
      >
        {/* base ring: the sealed boundary at 0.80 R */}
        <circle
          r={0.8}
          fill="none"
          stroke={baseTone}
          strokeWidth={phase === "sealed" ? 1.25 : 1}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={phase === "draft" || phase === "holding" ? "2 3" : undefined}
          className="yl-hr-base"
        />
        {/* hold progress: a thin ring outside the ticks that fills clockwise from 12 o'clock */}
        {phase === "holding" ? (
          <circle
            r={0.97}
            fill="none"
            stroke="var(--fg-0)"
            strokeWidth={2 * px}
            pathLength={1}
            strokeDasharray={`${p} 1`}
            transform="rotate(-90)"
          />
        ) : null}
        <g stroke={arcTone} fill="none">
          {geo.arcs.map((a) => (
            <circle
              key={a.j}
              r={a.r}
              pathLength={360}
              strokeDasharray={`${a.sweepDeg} 360`}
              strokeWidth={tickWidth * px}
              strokeLinecap="round"
              className="yl-hr-arc"
              style={{ "--j": a.j, transform: `rotate(${a.startDeg}deg)` } as CSSProperties}
            />
          ))}
        </g>
        <g stroke={tickTone}>
          {geo.ticks.map((t) => (
            <line
              key={t.i}
              x1={0}
              y1={0}
              x2={1}
              y2={0}
              strokeWidth={tickWidth}
              strokeLinecap="butt"
              vectorEffect="non-scaling-stroke"
              className="yl-hr-tick"
              style={
                {
                  "--i": t.i,
                  "--yl-a": `${t.angleDeg}deg`,
                  "--yl-r0": `${t.r0}px`,
                  "--yl-len": t.r1 - t.r0,
                } as CSSProperties
              }
            />
          ))}
        </g>
      </svg>
      {!bare ? (
        <figcaption className="mt-2 text-center text-11 text-fg-muted">
          <span className="font-mono text-fg-2">{shortHash(hash, 8, 6)}</span>
          <br />
          The ring proves hash identity, not mandate correctness.
        </figcaption>
      ) : null}
    </figure>
  );
}
