"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { cn, SampleDataChip } from "@yinglong/ui";
import { formatMs, type GraphNode, type NodeStatus } from "./execution-state";

/**
 * Layout and motion for the execution graph. Edges and rings animate transform and opacity only.
 * The whole block is static under reduced motion and when the page's "Pause motion" control is on.
 * (Scoped here because the component owns its layout; the page stylesheet is not touched.)
 */
const CSS = `
.yl-xg-wrap { container: xg / inline-size; }
.yl-xg { display: grid; row-gap: 12px; }
.yl-xg-node { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; column-gap: 12px; align-items: start; }
.yl-xg-edge { position: absolute; left: 13.5px; top: 30px; bottom: -14px; width: 1px; transform-origin: left top; }
.yl-xg-body { min-width: 0; display: grid; gap: 2px; padding-top: 4px; }
.yl-xg-ms { padding-top: 6px; }
.yl-xg-gauge { grid-column: 2; }
@container xg (min-width: 42rem) {
  .yl-xg { grid-template-columns: repeat(9, minmax(0, 1fr)); row-gap: 0; }
  .yl-xg-node { display: flex; flex-direction: column; align-items: center; row-gap: 4px; padding: 0 2px; text-align: center; }
  .yl-xg-edge { left: calc(50% + 16px); right: calc(-50% + 16px); top: 13.5px; bottom: auto; width: auto; height: 1px; }
  .yl-xg-body { display: contents; }
  .yl-xg-ms { padding-top: 0; }
}
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion="off"]) .yl-xg[data-animate] .yl-xg-ring,
  :root:not([data-motion="off"]) .yl-xg[data-animate] .yl-xg-body,
  :root:not([data-motion="off"]) .yl-xg[data-animate] .yl-xg-ms { animation: yl-xg-in 180ms var(--ease-out) both; animation-delay: calc(var(--k) * 60ms); }
  :root:not([data-motion="off"]) .yl-xg[data-animate] .yl-xg-edge { animation: yl-xg-draw 180ms var(--ease-out) both; animation-delay: calc(var(--k) * 60ms + 70ms); }
  :root:not([data-motion="off"]) .yl-xg-ring[data-pending] { animation: yl-xg-pulse 1.6s var(--ease-in-out) infinite; }
}
@keyframes yl-xg-in { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: none; } }
@keyframes yl-xg-draw { from { transform: scale(0); } to { transform: scale(1); } }
@keyframes yl-xg-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
`;

const WORD: Record<NodeStatus, string> = {
  pending: "Checking",
  passed: "Passed",
  stopped: "Stopped",
  escalated: "Escalated",
  skipped: "Not reached",
};

const RING: Record<NodeStatus, string> = {
  pending: "border border-dashed border-line-3 text-fg-muted",
  passed: "border-[1.5px] border-jade text-jade",
  stopped: "bg-refused-bg text-refused-fg",
  escalated: "border-[1.5px] border-brass text-brass",
  skipped: "border border-dashed border-fg-faint text-fg-muted",
};

const NAME: Record<NodeStatus, string> = {
  pending: "text-fg-2",
  passed: "text-fg-1",
  stopped: "text-seal",
  escalated: "text-brass",
  skipped: "text-fg-muted",
};

function edgeTone(from: GraphNode, to: GraphNode): string {
  if (to.status === "stopped") return "bg-seal/70";
  if (to.status === "escalated") return "bg-brass/70";
  if (to.status === "skipped" || from.status === "skipped") return "bg-line-1";
  if (to.status === "pending" || from.status === "pending") return "bg-line-2";
  if (to.status === "passed" && (from.status === "passed" || from.status === "escalated")) return "bg-jade/60";
  return "bg-line-2";
}

/**
 * The nine checks as a rail: left to right in a wide column, top to bottom on a phone. Each node
 * shows its real status and the time the service reported for it ("12 ms"). Nothing is timed on this
 * page: the response arrives as one JSON and the nodes then resolve in order, as presentation only.
 */
export function ExecutionGraph({
  nodes,
  pending = false,
  startedAt = null,
  resolveKey = 0,
  sample = false,
  className,
}: {
  nodes: GraphNode[];
  /** Waiting for the response: every ring pulses together (no per-step progress is pretended). */
  pending?: boolean;
  /** performance.now() when the request was sent; drives the one real elapsed timer. */
  startedAt?: number | null;
  /** Change it when a new result lands so the nodes resolve in order again. */
  resolveKey?: number;
  /** Sample data: timings are illustrative and say so. */
  sample?: boolean;
  className?: string;
}) {
  const elapsed = useElapsed(pending ? startedAt : null);
  const deciding = nodes.find((n) => n.status === "stopped") ?? nodes.find((n) => n.status === "escalated") ?? null;
  const timed = nodes.some((n) => n.ms !== null);
  return (
    <div className={cn("yl-xg-wrap grid gap-3", className)}>
      <style precedence="default" href="yl-execution-graph">
        {CSS}
      </style>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="eyebrow m-0 text-fg-muted">Nine checks</p>
        <p role="status" className="m-0 flex items-center gap-2 font-mono text-11 text-fg-muted tabular">
          {pending ? (
            <>
              <span>Checking</span>
              {elapsed !== null ? <span aria-label="elapsed">{(elapsed / 1000).toFixed(1)} s</span> : null}
            </>
          ) : timed ? (
            <>
              <span>{sample ? "Sample timings" : "Recorded timings from this request"}</span>
              {sample ? <SampleDataChip /> : null}
            </>
          ) : (
            <span>Timings not reported by this server</span>
          )}
        </p>
      </div>
      <ol key={resolveKey} className="yl-xg m-0 list-none p-0" aria-label="Nine scales, in order" data-animate={pending ? undefined : ""} aria-busy={pending || undefined}>
        {nodes.map((node, k) => {
          const next = nodes[k + 1];
          const gauge = node.id === "sentinel" && node.score !== null && node.threshold !== null ? { score: node.score, threshold: node.threshold } : null;
          return (
            <li key={node.id} className="yl-xg-node" style={{ "--k": k } as CSSProperties} aria-current={deciding?.id === node.id ? "step" : undefined}>
              {next ? <span aria-hidden="true" className={cn("yl-xg-edge", edgeTone(node, next))} /> : null}
              <span
                className={cn("yl-xg-ring relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-1 font-mono text-11 leading-none", RING[node.status])}
                data-pending={node.status === "pending" ? "" : undefined}
                aria-hidden="true"
              >
                {node.status === "stopped" ? (
                  <svg viewBox="0 0 28 28" width="28" height="28" className="absolute inset-0" focusable="false">
                    <line x1="9" y1="19" x2="19" y2="9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                ) : (
                  node.n
                )}
              </span>
              <div className="yl-xg-body">
                <span className={cn("text-12 font-medium leading-4 [overflow-wrap:anywhere]", NAME[node.status])}>
                  <span className="sr-only">{node.n}. </span>
                  {node.short}
                  {node.short !== node.name ? <span className="sr-only"> ({node.name})</span> : null}
                </span>
                <span className="text-11 leading-4 text-fg-muted">{WORD[node.status]}</span>
              </div>
              <span className="yl-xg-ms font-mono text-11 leading-4 text-fg-muted tabular">
                {node.ms !== null && node.status !== "skipped" && node.status !== "pending" ? formatMs(node.ms) : <span className="sr-only">no time reported</span>}
              </span>
              {gauge ? <SentinelGauge score={gauge.score} threshold={gauge.threshold} /> : null}
            </li>
          );
        })}
      </ol>
      {deciding && (deciding.reason || deciding.error) ? (
        <p
          className={cn(
            "m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-control px-3 py-2 text-12",
            deciding.status === "stopped" ? "bg-seal-tint text-fg-1" : "bg-brass-tint text-fg-1",
          )}
        >
          <span className={cn("font-medium", deciding.status === "stopped" ? "text-seal" : "text-brass")}>
            {deciding.status === "stopped" ? "Stopped" : "Escalated"} at {deciding.n}, {deciding.name}
          </span>
          {deciding.error ? <span className="font-mono text-11 text-fg-2">{deciding.error}</span> : null}
          {deciding.reason ? <span className="basis-full text-fg-2">{deciding.reason}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

/** The sentinel's injection score against its escalation threshold: a 40 px bar with a tick. */
function SentinelGauge({ score, threshold }: { score: number; threshold: number }) {
  const over = score >= threshold;
  const s = score.toFixed(2);
  const t = threshold.toFixed(2);
  return (
    <span className="yl-xg-gauge mt-0.5 grid justify-items-start gap-1 @2xl/xg:justify-items-center" title={`Injection score ${s}; escalates at ${t}`}>
      <span className="relative block h-1 w-10 overflow-hidden rounded-pill bg-line-2" aria-hidden="true">
        <span className={cn("absolute inset-y-0 left-0 rounded-pill", over ? "bg-brass" : "bg-jade")} style={{ width: `${Math.round(score * 100)}%` }} />
        <span className="absolute inset-y-0 w-px bg-fg-1" style={{ left: `${Math.round(threshold * 100)}%` }} />
      </span>
      <span className="font-mono text-11 leading-4 text-fg-muted tabular">
        <span className="sr-only">Injection score </span>
        {s}
        <span aria-hidden="true"> / </span>
        <span className="sr-only">, escalates at </span>
        {t}
      </span>
    </span>
  );
}

/** One real, client-measured elapsed time while waiting; null when not waiting. */
function useElapsed(startedAt: number | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return startedAt === null || now === null || now < startedAt ? null : now - startedAt;
}
