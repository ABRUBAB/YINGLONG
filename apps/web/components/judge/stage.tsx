"use client";

import { ThemedImg } from "@/components/fx/themed-img";
import type { ReactNode } from "react";
import { cn, StateRing } from "@yinglong/ui";
import { Button } from "@/components/ui/button";
import { SampleBadge } from "@/components/data/parts";
import { isSample } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { clock, describeError, seconds, useElapsed, type Run } from "./run";

/** One illustration per step of the demo: the chain, the phone, the vault, the nine checks, the two ledgers, the receipts. */
const STEP_ART = ["chain-glass", "phone-key", "vault-glass", "gates-glass", "ledgers-twin", "receipts-glass"] as const;

export const TOTAL_STEPS = 6;

/** The whole-demo clock, in its own component so the tick re-renders nothing else. */
export function Clock({ since, end }: { since: number | null; end: number | null }) {
  const live = useElapsed(end === null ? since : null);
  if (since === null) return null;
  const ms = end !== null ? end - since : live;
  return (
    <p className="m-0 font-mono text-13 text-fg-2 tabular" aria-label="Time since you started">
      <span className="text-fg-muted">Elapsed </span>
      <span data-clock>{clock(ms)}</span>
    </p>
  );
}

/** "Working: 4.2 s" while a step runs, then the real time it took. */
function StepStatus({ run }: { run: Run<unknown> }) {
  const live = useElapsed(run.at === "running" ? run.since : null);
  if (run.at === "idle") return null;
  const text = run.at === "running" ? `Working: ${seconds(live)}` : run.at === "done" ? `Done in ${seconds(run.ms)}` : `Stopped after ${seconds(run.ms)}`;
  return (
    <p className="m-0 min-w-0 flex-1 font-mono text-12 text-fg-muted tabular" role="status">
      {text}
      {run.at === "running" && run.note ? <span className="font-sans"> {run.note}</span> : null}
    </p>
  );
}

/**
 * One full-screen step: the progress hairline, the clock, the title, the content, and the footer with
 * Back, Skip (while the step is not done) and Next (once it is). Nothing here animates.
 */
export function Stage({
  n,
  title,
  lead,
  clockNode,
  run,
  onBack,
  onNext,
  onSkip,
  nextLabel = "Next",
  children,
}: {
  n: number;
  title: string;
  lead?: ReactNode;
  clockNode?: ReactNode;
  run: Run<unknown>;
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  nextLabel?: string;
  children: ReactNode;
}) {
  const done = run.at === "done";
  return (
    <section
      aria-labelledby={`judge-step-${n}`}
      data-step={n}
      data-run={run.at}
      className="mx-auto flex min-h-[calc(100svh-var(--nav-h))] w-full max-w-[1320px] flex-col gap-6 px-4 pt-6 pb-4 sm:px-6 sm:pt-8 lg:px-8"
    >
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="eyebrow m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-fg-muted">
            <span>3-minute demo</span>
            <span className="font-mono text-fg-2">
              Step {n} of {TOTAL_STEPS}
            </span>
            {isSample ? <SampleBadge /> : null}
          </p>
          {clockNode}
        </div>
        <div className="grid gap-2 rounded-card border border-line-1 bg-bg-1 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-3 text-12">
            <span className="font-medium text-fg-1">Demo progress</span>
            <span className="font-mono text-fg-muted tabular">{String(n).padStart(2, "0")} / {String(TOTAL_STEPS).padStart(2, "0")}</span>
          </div>
          <ol aria-label="Progress" className="m-0 grid list-none gap-1.5 p-0" style={{ gridTemplateColumns: `repeat(${TOTAL_STEPS}, minmax(0, 1fr))` }}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => {
              const k = i + 1;
              return (
                <li
                  key={k}
                  aria-current={k === n ? "step" : undefined}
                  aria-label={`Step ${k}${k < n ? ", done" : k === n ? ", now" : ""}`}
                  className={cn("h-1.5 rounded-pill transition-colors", k < n ? "bg-jade" : k === n ? "bg-accent" : "bg-line-2")}
                />
              );
            })}
          </ol>
        </div>
      </header>

      <div className="grid flex-1 content-start gap-6">
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-3">
            <h1 id={`judge-step-${n}`} className="type-display m-0 max-w-[24ch] text-[1.9rem] leading-[1.06] text-fg-0 sm:text-[2.5rem]">
              {title}
            </h1>
            {lead ? <p className="m-0 max-w-[60ch] text-15 text-fg-2 sm:text-18 sm:leading-[1.6]">{lead}</p> : null}
          </div>
          <div className="hidden lg:block" aria-hidden="true">
            <ThemedImg name={STEP_ART[(n - 1) % STEP_ART.length]!} alt="" width={640} height={440} className="yl-float h-auto w-full" />
          </div>
        </div>
        {children}
      </div>

      <footer className="sticky bottom-0 z-10 -mx-4 border-t border-line-1 bg-bg-0 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center gap-3">
          {onBack ? (
            <Button variant="quiet" onClick={onBack}>
              Back
            </Button>
          ) : null}
          <StepStatus run={run} />
          {!done && onSkip ? (
            <Button variant="secondary" onClick={onSkip}>
              Skip
            </Button>
          ) : null}
          {done && onNext ? (
            <Button size="lg" onClick={onNext}>
              {nextLabel}
            </Button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

/** Network error, distinct from a refusal: a grey ring on a bg-3 panel, the call that failed, Retry and Skip. */
export function ServiceError({ call, run, onRetry, onSkip }: { call: string; run: Extract<Run<unknown>, { at: "error" }>; onRetry: () => void; onSkip?: () => void }) {
  return (
    <div role="alert" className="grid gap-3 rounded-card bg-bg-3 p-4 sm:p-5">
      <p className="m-0 flex items-start gap-2.5 text-15 text-fg-1">
        <StateRing state="unknown" size={20} glyphOnly label="Not answered" />
        <span>
          The agent service did not answer ({call} failed at {formatTime(run.when, { seconds: true })}). {describeError(run.error)} Nothing on this step is live
          until it does.
        </span>
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={onRetry}>Retry</Button>
        {onSkip ? (
          <Button variant="secondary" onClick={onSkip}>
            Skip this step
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** One live number with its source, so a judge can check where it came from. */
export function Tile({ id, label, value, unit, source }: { id: string; label: string; value: ReactNode; unit?: string; source: string }) {
  return (
    <div data-tile={id} className="grid min-w-0 content-start gap-1.5 rounded-card border border-line-2 bg-bg-1 p-4">
      <p className="m-0 text-12 text-fg-2">{label}</p>
      <p className="m-0 font-mono text-[1.75rem] leading-none text-fg-0 tabular break-words sm:text-32">
        {value}
        {unit ? <span className="text-13 text-fg-2"> {unit}</span> : null}
      </p>
      <p className="m-0 text-11 text-fg-muted">{source}</p>
    </div>
  );
}

/** One line of real progress inside a step. */
export function Row({ state, label, children }: { state: "pending" | "waiting" | "verified" | "refused" | "onchain" | "skipped"; label: string; children?: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 border-t border-line-1 py-3">
      <StateRing state={state} size={16} glyphOnly label={state === "verified" ? "Done" : state === "waiting" || state === "pending" ? "Working" : state === "refused" ? "Stopped" : state} />
      <div className="grid min-w-0 gap-1">
        <p className={cn("m-0 text-15", state === "pending" ? "text-fg-muted" : "text-fg-0")}>{label}</p>
        {children}
      </div>
    </li>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-12 break-all text-fg-1", className)}>{children}</span>;
}

/** The judge's own request, shown as it was sent. */
export function Request({ text }: { text: string }) {
  return (
    <figure className="m-0 grid gap-1.5 rounded-card border border-line-2 bg-bg-1 p-4">
      <figcaption className="eyebrow text-fg-muted">The request, sent as is</figcaption>
      <blockquote className="m-0 text-15 text-fg-0">{text}</blockquote>
    </figure>
  );
}
