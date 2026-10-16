import { cn, type LiveState } from "@yinglong/ui";
import { BRAND } from "./paths";

/**
 * <Mark>: the YINGLONG S glyph (ring = the mandate boundary, pearl = the agent's on-chain identity,
 * S stroke = the agent inside the ring). It is the only YINGLONG mark on the site: nav, footer,
 * favicon. The retired dragon mark is not drawn anywhere. Inlined so it inherits currentColor.
 */
export function Mark({
  size,
  className,
  title = "YINGLONG",
  decorative,
}: {
  size: number;
  className?: string;
  title?: string;
  decorative?: boolean;
}) {
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": title };
  return (
    <svg viewBox={BRAND.glyph.viewBox} width={size} height={size} className={cn("shrink-0", className)} {...a11y}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.25" />
      <circle cx="20.7" cy="7" r="2.4" fill="currentColor" />
      <path d={BRAND.glyph.spine} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The outlined wordmark. Its O is the live status O: pass `live` to drive the pearl
 * (acting = orbit, waiting = brass at the ring, asking = centred, paused = dashed ring).
 */
export function Wordmark({ height = 14, className, live }: { height?: number; className?: string; live?: LiveState }) {
  const w = BRAND.wordmark;
  const [, , vw, vh] = w.viewBox.split(" ").map(Number) as [number, number, number, number];
  const ring = w.statusRing;
  const pearl = w.statusPearl;
  const state = live ?? "active";
  const pearlPos = state === "asking" ? { cx: ring.cx, cy: ring.cy } : { cx: pearl.cx, cy: pearl.cy };
  return (
    <svg viewBox={w.viewBox} height={height} width={(height * vw) / vh} role="img" aria-label="YINGLONG" className={cn("shrink-0", className)}>
      <g fill="currentColor">
        {w.letters.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      {state !== "none" ? (
        <circle
          cx={ring.cx}
          cy={ring.cy}
          r={ring.r}
          fill="none"
          stroke="currentColor"
          strokeWidth={ring.strokeWidth}
          strokeDasharray={state === "paused" ? `${ring.r * 0.5} ${ring.r * 0.32}` : undefined}
        />
      ) : null}
      <g className={state === "acting" ? "yl-orbit" : undefined} style={{ transformOrigin: `${ring.cx}px ${ring.cy}px` }}>
        <circle cx={pearlPos.cx} cy={pearlPos.cy} r={pearl.r} fill={state === "waiting" || state === "asking" ? "var(--brass)" : "currentColor"} />
      </g>
    </svg>
  );
}

/** The S glyph on a raised disc: the app rail's identity badge (replaces the retired dragon coin). */
export function MarkBadge({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-pill border border-line-2 bg-bg-2 text-fg-0", className)}
      style={{ width: size, height: size }}
    >
      <Mark size={Math.round(size * 0.56)} decorative />
    </span>
  );
}

/** Shadow Chaser team mark: the monoline SC in the same thin ring (brand/shadow-chaser-mark.svg). */
export function TeamMark({ size = 40, className, decorative }: { size?: number; className?: string; decorative?: boolean }) {
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": "Shadow Chaser" };
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} className={cn("shrink-0", className)} {...a11y}>
      <circle cx="512" cy="512" r="440" fill="none" stroke="currentColor" strokeWidth="20" />
      <g fill="none" stroke="currentColor" strokeWidth="46.3" strokeLinecap="round">
        <path d="M393.6 388 A96 96 0 1 0 299.7 504 A104 104 0 1 1 198 629.6" />
        <path d="M828.3 645.8 A200 200 0 1 1 828.3 378.2" />
      </g>
    </svg>
  );
}
