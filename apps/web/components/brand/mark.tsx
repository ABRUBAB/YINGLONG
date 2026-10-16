import { cn, type LiveState } from "@yinglong/ui";
import { BRAND } from "./paths";

/**
 * <Mark size> picks the brand tier by size (BRAND.md section 4): full mark at 96 px and up, coil
 * from 40 px, the orbit glyph below 40 px. Inlined so it inherits currentColor.
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
  if (size < 40) {
    return (
      <svg viewBox={BRAND.glyph.viewBox} width={size} height={size} className={cn("shrink-0", className)} {...a11y}>
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.25" />
        <circle cx="20.7" cy="7" r="2.4" fill="currentColor" />
        <path d={BRAND.glyph.spine} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  const t = size < 96 ? BRAND.coil : BRAND.mark;
  return (
    <svg viewBox={t.viewBox} width={size} height={size} className={cn("shrink-0", className)} {...a11y}>
      <circle cx={t.orbit.cx} cy={t.orbit.cy} r={t.orbit.r} fill="none" stroke="currentColor" strokeWidth={t.orbit.strokeWidth} />
      <circle cx={t.pearl!.cx} cy={t.pearl!.cy} r={t.pearl!.r} fill="currentColor" />
      {t.spine.map((p) => (
        <path key={p.id} d={p.d} fill="currentColor" />
      ))}
      <g fillRule="evenodd" fill="currentColor">
        {t.head.map((p) => (
          <path key={p.id} d={p.d} />
        ))}
      </g>
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
  const pearlPos =
    state === "asking" ? { cx: ring.cx, cy: ring.cy } : { cx: pearl.cx, cy: pearl.cy };
  return (
    <svg
      viewBox={w.viewBox}
      height={height}
      width={(height * vw) / vh}
      role="img"
      aria-label="YINGLONG"
      className={cn("shrink-0", className)}
    >
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
        <circle
          cx={pearlPos.cx}
          cy={pearlPos.cy}
          r={pearl.r}
          fill={state === "waiting" || state === "asking" ? "var(--brass)" : "currentColor"}
        />
      </g>
    </svg>
  );
}

/** Coin: the coil mark on an obsidian disc (any chrome or raster mark on a light page sits in it). */
export function DragonCoin({ size = 40, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/png/avatar-512-coin.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
      className={cn("shrink-0 rounded-pill", className)}
    />
  );
}
