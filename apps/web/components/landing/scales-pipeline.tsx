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
import { Qr } from "@/components/qr";
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
  const session = useAgent("challenge-session", (api) => api.challengeSession(), ["challenge"]);
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
    <section aria-labelledby="scales-title" className="yl-landing-section border-t border-line-1">
      <div className="yl-container">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
          <SectionHead
            index="01"
            eyebrow="How it works"
            id="scales-title"
            title="Nine checks before any money moves"
            lead="The AI can raise a warning, but only fixed rules can say no. The rail below shows where the latest hacking attempt was stopped."
            className="lg:col-span-6"
          >
            {isSample ? (
              <div className="mt-2">
                <SampleDataChip />
              </div>
            ) : null}
          </SectionHead>

          {/* The Judge's Challenge, with the guest QR: the natural next step after seeing where an attack stopped. */}
          <div className="grid content-start gap-3 border-t border-line-1 pt-6 lg:col-span-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
            <p className="eyebrow m-0 text-fg-muted">Try to hack it</p>
            <p className="m-0 text-18 leading-snug text-fg-0">Nothing you type can make the agent send money outside its rules. Try.</p>
            <p className="m-0 max-w-[52ch] text-13 text-fg-2">
              Type any trick (a fake invoice, &quot;ignore your instructions&quot;, an urgent request) and see which check stops it. Press
              &quot;bypass&quot; to skip the AI and send the payment straight to the blockchain: it is still blocked, with proof.
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-5">
              <ButtonLink href="/challenge">
                Open the challenge <ArrowIcon />
              </ButtonLink>
              <div className="flex items-center gap-3">
                <div className="rounded-card border border-line-2 bg-bg-0 p-1.5">
                  <Qr value={session.data?.joinUrl ?? "https://app.yinglong-agent.tech/challenge"} size={72} label="QR code for a guest mandate in the Judge's Challenge" />
                </div>
                <p className="m-0 grid gap-0.5 text-11 text-fg-muted">
                  <span>Guest mandate, test units only</span>
                  {session.data ? <span>{session.data.quota.perDay} attempts per guest per day</span> : null}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
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

          <div className="mt-6 border-t border-line-1 pt-5">
            {latest ? (
                <div className="grid content-start gap-2">
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
                  <button
                    type="button"
                    onClick={() => setRunKey((k) => k + 1)}
                    className="yl-press mt-2 inline-flex h-9 w-fit items-center gap-2 rounded-control border border-line-3 px-3 text-13 text-fg-1 hover:bg-bg-2"
                  >
                    Replay the request
                  </button>
                </div>
            ) : (
              <p className="m-0 text-13 text-fg-muted">{q.loading ? "Reading GET /v1/challenge/attempts" : "No stopped attempts have been recorded yet."}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
