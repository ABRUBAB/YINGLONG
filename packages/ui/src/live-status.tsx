import { cn, f3 } from "./cn.ts";

/**
 * Live status "O" (master plan 14.6.7, BRAND.md section 1): the wordmark's O as a 24 px indicator.
 * ring = mandate active; pearl orbiting = acting; pearl stopped at the ring in brass = waiting for
 * you; pearl centred = asking; dashed ring = paused; no ring = no mandate.
 */
export type LiveState = "active" | "acting" | "waiting" | "asking" | "paused" | "none";

export const LIVE_WORD: Record<LiveState, string> = {
  active: "Mandate active",
  acting: "Acting",
  waiting: "Waiting for you",
  asking: "Asking you",
  paused: "Paused",
  none: "No mandate",
};

export function LiveStatusO({
  state,
  size = 24,
  showWord = false,
  className,
  wordClassName,
}: {
  state: LiveState;
  size?: number;
  showWord?: boolean;
  className?: string;
  wordClassName?: string;
}) {
  // Status O construction: ring stroke 0.94 stem, pearl 2.3 stems; scaled into a 24-unit box.
  const r = 8.4;
  const pearlR = state === "asking" ? 2.6 : 2.9;
  const px = state === "asking" ? 12 : f3(12 + r * Math.cos((-30 * Math.PI) / 180));
  const py = state === "asking" ? 12 : f3(12 + r * Math.sin((-30 * Math.PI) / 180));
  const pearlTone = state === "waiting" || state === "asking" ? "var(--brass)" : "currentColor";
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="status"
      aria-label={`Live status: ${LIVE_WORD[state]}`}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="shrink-0 overflow-visible">
        {state !== "none" ? (
          <circle
            cx="12"
            cy="12"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeDasharray={state === "paused" ? "3.3 2.6" : undefined}
            opacity={state === "paused" ? 0.7 : 1}
          />
        ) : null}
        <g className={state === "acting" ? "yl-orbit" : undefined} style={{ transformOrigin: "12px 12px" }}>
          <circle
            cx={px}
            cy={py}
            r={pearlR}
            fill={state === "none" ? "var(--fg-faint)" : pearlTone}
            opacity={state === "paused" ? 0.7 : 1}
          />
        </g>
      </svg>
      {showWord ? <span className={cn("text-12 text-fg-2", wordClassName)}>{LIVE_WORD[state]}</span> : null}
    </span>
  );
}
