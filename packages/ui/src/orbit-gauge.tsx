import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn.ts";

/** Ratio of two base-unit integers as a number in [0, 1] (for drawing only; never for money). */
export function ratio(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const clamped = part < 0n ? 0n : part > whole ? whole : part;
  return Number((clamped * 100000n) / whole) / 100000;
}

export interface OrbitGaugeProps {
  label: string;
  /** Base units already spent in the period. */
  spent: bigint;
  /** Base-unit cap for the period. */
  cap: bigint;
  /** Optional reserve floor in base units, drawn as a tick at floor / cap. */
  floor?: bigint;
  /** True when a forecast says the floor will be breached: the floor tick turns brass. */
  breachForecast?: boolean;
  /** Centre content (usually the remaining amount, formatted by the caller). */
  center?: ReactNode;
  /** Secondary line under the label, e.g. "of 3,000.00 tHKD this month". */
  caption?: ReactNode;
  size?: number;
  /** Lane is paused or revoked: ring dashed. */
  inactive?: boolean;
  className?: string;
}

/**
 * Orbit gauge (master plan 14.6.4): a thin ring per budget lane. Chrome arc = spent (drawn clockwise
 * from 12 o'clock), ash ring = remaining, one tick for the reserve floor (brass only when a breach
 * is forecast).
 */
export function OrbitGauge({
  label,
  spent,
  cap,
  floor,
  breachForecast,
  center,
  caption,
  size = 112,
  inactive,
  className,
}: OrbitGaugeProps) {
  const f = ratio(spent, cap);
  const floorF = floor !== undefined ? ratio(floor, cap) : undefined;
  const r = 0.86;
  const floorAngle = floorF !== undefined ? -90 + floorF * 360 : 0;
  const pct = Math.round(f * 100);
  return (
    <figure className={cn("m-0 flex flex-col items-center gap-2", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox="-1 -1 2 2"
          width={size}
          height={size}
          role="img"
          aria-label={`${label}: ${pct} percent of the period cap used${
            floorF !== undefined ? `, reserve floor marked${breachForecast ? ", breach forecast" : ""}` : ""
          }${inactive ? ", inactive" : ""}`}
          className="overflow-visible"
        >
          <circle
            r={r}
            fill="none"
            stroke="var(--line-3)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
            strokeDasharray={inactive ? "3 3" : undefined}
          />
          <circle
            r={r}
            fill="none"
            stroke="var(--chrome-0)"
            strokeWidth={5 / size}
            pathLength={1}
            strokeDasharray={`${f} 1`}
            strokeLinecap="butt"
            transform="rotate(-90)"
            className="yl-gauge-arc"
            style={{ "--yl-f": f } as CSSProperties}
          />
          {floorF !== undefined ? (
            <line
              x1={0}
              y1={0}
              x2={1}
              y2={0}
              stroke={breachForecast ? "var(--brass)" : "var(--fg-muted)"}
              strokeWidth={breachForecast ? 2.5 : 1.5}
              vectorEffect="non-scaling-stroke"
              style={{ transform: `rotate(${floorAngle}deg) translateX(0.74px) scaleX(0.24)` }}
            />
          ) : null}
        </svg>
        {center ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
        ) : null}
      </div>
      <figcaption className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-13 font-medium text-fg-1">{label}</span>
        {caption ? <span className="text-11 text-fg-muted">{caption}</span> : null}
      </figcaption>
    </figure>
  );
}
