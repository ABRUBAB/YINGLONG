"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn, RingGlyph, SampleDataChip, shortHash } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import { SCALE_IDS, SCALE_NAMES, type ChallengeAttempt } from "@/lib/api/view";
import { explorerTxUrl } from "@/lib/chain";
import { formatTime, LEDGER_SHORT } from "@/lib/format";
import { ruleForError, SITE } from "@/content/site-data";
import { ArrowIcon, ButtonLink } from "@/components/ui/button";
import { SectionHead } from "./sections";
import { useInView } from "./use-live";

/**
 * The nine scales, with the last attack that was stopped (GET /v1/challenge/attempts). A request
 * token travels from Normalise towards the chain and stops at the scale that stopped that attack;
 * the scales it passed light in order. Under each scale, a bar counts the listed attempts stopped
 * there. One CSS transition moves the token (transform only, its own custom property, no React
 * state per step); the stations reveal with CSS animation delays. Reduced motion and Pause motion
 * show the final state at once. Scale descriptions come from docs/TECHNICAL.md at build time.
 */

const STEP_MS = 240;

const OUTCOME_WORD: Record<ChallengeAttempt["outcome"], string> = {
  refused: "Refused",
  reverted: "Reverted on chain",
  escalated: "Escalated to the owner",
  simulated: "Stopped in simulation",
  executed: "Executed inside the mandate",
  asked: "Asked the owner",
};

export function ScalesPipeline() {
  const q = useAgent("challenge-attempts", (api) => api.challengeAttempts(), ["challenge"]);
  const track = useRef<HTMLDivElement>(null);
  const inView = useInView(track);
  const [runKey, setRunKey] = useState(0);
  const [running, setRunning] = useState(false);

  const { latest, counts, total } = useMemo(() => {
    const list = [...(q.data ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const stopped = list.filter((a) => a.stoppedAt);
    const c = SCALE_IDS.map((id) => stopped.filter((a) => a.stoppedAt === id).length);
    return { latest: stopped[0] ?? null, counts: c, total: stopped.length };
  }, [q.data]);
  const stop = latest?.stoppedAt ? SCALE_IDS.indexOf(latest.stoppedAt) : -1;
  const max = Math.max(1, ...counts);

  // Start the run once the track is in view (and again on Replay), one frame after the reset.
  useEffect(() => {
    if (!inView || stop < 0) return;
    setRunning(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setRunning(true)));
    return () => cancelAnimationFrame(id);
  }, [inView, stop, runKey]);

  const rule = ruleForError(latest?.error);
  const scaleDocs = SITE.scales ?? [];
  const stopDoc = stop >= 0 ? scaleDocs[stop] : undefined;
  const revertHref = latest?.revert ? explorerTxUrl(latest.revert.ledger, latest.revert.txHash, latest.revert.explorerUrl) : undefined;

  return (
    <section aria-labelledby="scales-title" className="yl-section">
      <div className="yl-container">
        <SectionHead
          index="04"
          eyebrow="Nine safety checks"
          id="scales-title"
          title="Every request passes nine safety checks before any money moves"
          lead="AI can raise a warning, but only fixed rules can say no. Here is where the latest hacking attempt was stopped:"
        >
          {isSample ? (
            <div className="mt-2">
              <SampleDataChip />
            </div>
          ) : null}
        </SectionHead>

        <div className="mt-12">
          <div
            key={runKey}
            ref={track}
            data-run={running ? "true" : "false"}
            className="yl-scales relative grid grid-rows-9 lg:grid-cols-9 lg:grid-rows-1"
            style={{ ["--stop" as string]: Math.max(0, stop) }}
          >
            {/* the line every request travels */}
            <span aria-hidden="true" className="absolute top-7 bottom-7 left-[19px] w-px bg-line-2 lg:top-[19px] lg:right-[calc(100%/18)] lg:bottom-auto lg:left-[calc(100%/18)] lg:h-px lg:w-auto" />
            {stop >= 0 ? (
              <span aria-hidden="true" className="yl-scale-rail pointer-events-none absolute top-0 left-0 z-10 flex h-14 w-10 items-start justify-center pt-[13px] lg:h-full lg:w-[calc(100%/9)] lg:pt-[13px]">
                <span className="size-3 rounded-pill bg-fg-0" />
              </span>
            ) : null}
            <ol className="contents">
              {SCALE_IDS.map((id, i) => {
                const state = stop < 0 ? "skipped" : i < stop ? "verified" : i === stop ? "refused" : "skipped";
                return (
                  <li key={id} className="relative grid h-14 grid-cols-[40px_1fr] items-start gap-3 lg:h-auto lg:grid-cols-1 lg:justify-items-center lg:gap-3 lg:text-center" style={{ ["--i" as string]: i }}>
                    <span className="relative z-0 inline-flex size-10 items-center justify-center rounded-pill border border-line-2 bg-bg-0 text-fg-muted">
                      <RingGlyph state="skipped" size={16} />
                      {state !== "skipped" ? (
                        <span className={cn("yl-station-state absolute -inset-px inline-flex items-center justify-center rounded-pill", state === "refused" ? "bg-refused-bg text-refused-fg" : "bg-bg-0 text-fg-1")}>
                          <RingGlyph state={state} size={20} />
                        </span>
                      ) : null}
                    </span>
                    <span className="grid min-w-0 gap-1 pt-1 lg:pt-0">
                      <span className="flex items-baseline gap-2 lg:flex-col lg:items-center lg:gap-0.5">
                        <span className="kicker">{i + 1}</span>
                        <span className={cn("text-13 font-medium", i === stop ? "text-fg-0" : "text-fg-2")}>{SCALE_NAMES[id]}</span>
                        <span className="sr-only">{state === "verified" ? ", passed" : state === "refused" ? ", stopped the last attack here" : ", not reached"}</span>
                      </span>
                      <span className="flex items-center gap-2 lg:justify-center" title={`${counts[i]} of the listed attempts stopped here`}>
                        <span aria-hidden="true" className="h-1 w-12 overflow-hidden rounded-pill bg-bg-3">
                          <span className="yl-bar block h-full rounded-pill bg-fg-2" style={{ ["--p" as string]: counts[i]! / max }} />
                        </span>
                        <span className="font-mono text-11 text-fg-muted">{counts[i]}</span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="mt-10 grid gap-6 border-t border-line-1 pt-8 lg:grid-cols-12 lg:gap-8">
            {latest ? (
              <>
                <div className="grid content-start gap-2 lg:col-span-7">
                  <p className="eyebrow m-0 text-fg-muted">Last attack stopped</p>
                  <p className="m-0 text-18 leading-snug text-fg-0">
                    {latest.family.charAt(0).toUpperCase() + latest.family.slice(1)}, stopped at scale {stop + 1}, {SCALE_NAMES[latest.stoppedAt!]}
                  </p>
                  <p className="m-0 text-13 text-fg-2">
                    {OUTCOME_WORD[latest.outcome]}
                    {latest.error ? (
                      <>
                        {" "}
                        with <span className="font-mono text-fg-1">{latest.error}</span>
                      </>
                    ) : null}
                    {rule ? (
                      <>
                        {" "}
                        from <span className="font-mono text-fg-1">{rule.enforcer}</span>
                        {rule.rule ? `: ${rule.rule.charAt(0).toLowerCase()}${rule.rule.slice(1)}.` : "."}
                      </>
                    ) : (
                      "."
                    )}
                  </p>
                  {stopDoc ? <p className="m-0 max-w-[60ch] text-12 leading-relaxed text-fg-muted">What scale {stop + 1} checks: {/^[A-Z][a-z]/.test(stopDoc.what) ? stopDoc.what.charAt(0).toLowerCase() + stopDoc.what.slice(1) : stopDoc.what}. Can it refuse? {stopDoc.refuses}.</p> : null}
                  <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-muted">
                    <span>{formatTime(latest.at)} HKT</span>
                    {latest.revert ? (
                      <>
                        <span>{LEDGER_SHORT[latest.revert.ledger]}</span>
                        {revertHref ? (
                          <a href={revertHref} className="font-mono text-fg-2 underline decoration-line-2 underline-offset-4 hover:text-fg-0">
                            {shortHash(latest.revert.txHash, 8, 6)}
                          </a>
                        ) : (
                          <span className="font-mono">{shortHash(latest.revert.txHash, 8, 6)}</span>
                        )}
                      </>
                    ) : null}
                    <span>
                      {total} stopped attempts listed by GET /v1/challenge/attempts
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-3 lg:col-span-5 lg:justify-end">
                  <button
                    type="button"
                    onClick={() => setRunKey((k) => k + 1)}
                    className="yl-press inline-flex h-10 items-center gap-2 rounded-control border border-line-3 px-4 text-13 text-fg-1 hover:bg-bg-2"
                  >
                    Replay the request
                  </button>
                  <ButtonLink href="/challenge" variant="secondary">
                    Try an attack yourself <ArrowIcon />
                  </ButtonLink>
                </div>
              </>
            ) : (
              <p className="m-0 text-13 text-fg-muted lg:col-span-12">{q.loading ? "Reading GET /v1/challenge/attempts" : "No stopped attempts have been recorded yet."}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
