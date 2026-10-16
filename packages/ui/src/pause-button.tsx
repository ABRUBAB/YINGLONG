import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.ts";

export type PauseState = "active" | "pausing" | "paused" | "resuming";

export interface PauseButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  state: PauseState;
  /** Who is paused: "Ying", "Treasurer agent". */
  agentName?: string;
  /** Compact form for the mobile tab bar. */
  compact?: boolean;
}

/**
 * The one inverted control in the product: always visible, bone on obsidian
 * (ink on paper in light mode). One tap pauses every delegation in the next block; resuming is an
 * owner-only passkey action and is drawn as an outline button so the two are never confused.
 */
export function PauseButton({ state, agentName = "Ying", compact, className, ...rest }: PauseButtonProps) {
  const paused = state === "paused" || state === "resuming";
  const busy = state === "pausing" || state === "resuming";
  const title = paused ? `Resume ${agentName}` : `Pause ${agentName}`;
  const sub = paused ? "Owner passkey required" : "Every delegation, next block";
  return (
    <button
      type="button"
      aria-live="polite"
      aria-busy={busy || undefined}
      className={cn(
        "group inline-flex w-full items-center gap-3 rounded-control text-left font-medium transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        compact ? "h-11 justify-center px-3" : "h-14 px-3.5",
        paused
          ? "border border-line-3 bg-transparent text-fg-1 hover:border-fg-2"
          : "bg-fg-1 text-bg-0 hover:bg-fg-0 active:bg-fg-2",
        busy && "cursor-progress",
        className,
      )}
      {...rest}
    >
      <svg viewBox="0 0 24 24" width={compact ? 18 : 20} height={compact ? 18 : 20} aria-hidden="true" className="shrink-0">
        <circle
          cx="12"
          cy="12"
          r="9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeDasharray={paused ? "3.6 2.6" : undefined}
          className={busy ? "yl-spin-slow origin-center" : undefined}
        />
        {paused ? (
          <path d="M10 8.5l5.5 3.5-5.5 3.5z" fill="currentColor" />
        ) : (
          <path d="M9.75 8.25v7.5M14.25 8.25v7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
      {compact ? (
        <span className="text-13">{busy ? (paused ? "Resuming" : "Pausing") : title}</span>
      ) : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-15">{busy ? (paused ? "Resuming…" : "Pausing…") : title}</span>
          <span className={cn("text-11 font-normal", paused ? "text-fg-muted" : "text-bg-3")}>{sub}</span>
        </span>
      )}
    </button>
  );
}
