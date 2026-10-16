import type { CSSProperties } from "react";
import { cn, shortHash } from "./cn.ts";
import { RingGlyph, type RingState } from "./state-ring.tsx";

export type ScaleStatus = "passed" | "stopped" | "escalated" | "skipped";

export interface TraceScale {
  /** Stable id: normalise, sentinel, quarantine, ground, policy, counterparty, simulate, anomaly, chain */
  id: string;
  /** Display name, e.g. "Counterparty" */
  name: string;
  status: ScaleStatus;
  /** Plain-English reason (code-filled, never free LLM text). */
  reason?: string;
  /** Typed error, e.g. "PayeeNotVerified". */
  error?: string;
  /** Revert or refusal transaction hash when the chain decided. */
  revertHash?: string;
  revertHref?: string;
  durationMs?: number;
}

const GLYPH: Record<ScaleStatus, RingState> = {
  passed: "verified",
  stopped: "refused",
  escalated: "waiting",
  skipped: "skipped",
};

const WORD: Record<ScaleStatus, string> = {
  passed: "Passed",
  stopped: "Stopped",
  escalated: "Escalated",
  skipped: "Not reached",
};

/**
 * Trace (master plan 14.6.5): the nine scales as nine lines. The scale that stopped or escalated
 * the action is expanded with its reason, typed error and revert hash. Used by the inspector,
 * the Judge's Challenge verdict and the Merkle path.
 */
export function Trace({
  scales,
  animate = true,
  className,
  caption,
}: {
  scales: TraceScale[];
  animate?: boolean;
  className?: string;
  caption?: string;
}) {
  return (
    <ol className={cn("yl-trace m-0 list-none p-0", animate && "yl-trace--animate", className)} aria-label={caption ?? "Nine scales"}>
      {scales.map((s, idx) => {
        const expanded = s.status === "stopped" || s.status === "escalated";
        const tone =
          s.status === "stopped"
            ? "text-fg-0"
            : s.status === "escalated"
              ? "text-brass"
              : s.status === "skipped"
                ? "text-fg-muted"
                : "text-fg-1";
        return (
          <li
            key={s.id}
            className="yl-trace-row relative grid grid-cols-[20px_1fr_auto] gap-x-3 pb-2.5 last:pb-0"
            style={{ "--k": idx } as CSSProperties}
          >
            {idx < scales.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-[18px] bottom-0 left-[9.5px] w-px",
                  s.status === "skipped" || scales[idx + 1]?.status === "skipped" ? "bg-line-1" : "bg-line-2",
                )}
              />
            ) : null}
            <span className={cn("relative z-[1] mt-px flex size-5 items-center justify-center", s.status === "stopped" ? "text-fg-0" : tone)}>
              <span className="bg-[inherit]">
                <RingGlyph state={GLYPH[s.status]} size={16} />
              </span>
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="w-4 shrink-0 font-mono text-11 text-fg-muted tabular">{idx + 1}</span>
                <span className={cn("text-13 font-medium", tone)}>{s.name}</span>
                <span className="text-12 text-fg-muted">{s.status === "skipped" && s.reason ? "Bypassed" : WORD[s.status]}</span>
              </div>
              {expanded && (s.reason || s.error || s.revertHash) ? (
                <div className="mt-1.5 ml-6 grid gap-1.5 border-l border-line-3 pl-3 text-12">
                  {s.reason ? <p className="m-0 text-fg-2">{s.reason}</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {s.error ? (
                      s.status === "stopped" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-pill bg-refused-bg py-0.5 pr-2.5 pl-1 text-12 font-medium leading-none text-refused-fg">
                          <RingGlyph state="refused" size={16} />
                          Refused <span aria-hidden="true">&middot;</span> <span className="font-mono">{s.error}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-pill border border-brass/50 bg-brass-tint py-0.5 pr-2.5 pl-1 text-12 leading-none text-brass">
                          <RingGlyph state="waiting" size={16} />
                          <span className="font-mono">{s.error}</span>
                        </span>
                      )
                    ) : null}
                    {s.revertHash ? (
                      <span className="inline-flex items-center gap-1.5 text-steel">
                        <RingGlyph state="onchain" size={16} />
                        <span>Revert</span>
                        {s.revertHref ? (
                          <a
                            className="font-mono underline decoration-line-3 underline-offset-2 hover:decoration-steel"
                            href={s.revertHref}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {shortHash(s.revertHash, 8, 6)}
                            <span className="sr-only"> (opens the block explorer)</span>
                          </a>
                        ) : (
                          <span className="font-mono">{shortHash(s.revertHash, 8, 6)}</span>
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <span className="font-mono text-11 text-fg-muted tabular">
              {s.durationMs !== undefined && s.status !== "skipped" ? `${s.durationMs} ms` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
