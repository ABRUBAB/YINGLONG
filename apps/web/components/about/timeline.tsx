"use client";

import { useMemo, useState } from "react";
import { cn } from "@yinglong/ui";
import { SITE, type TimelineCommit } from "@/content/site-data";
import { REPO_URL } from "@/components/shell/site-footer";

/**
 * The build, from `git log` (scripts/site-data.mjs writes content/generated/site-data.json at build
 * time; nothing here is typed by hand). Milestones are the commits that took a capability live end
 * to end; every other commit is a small row, filterable by track. Times are the author's own clock
 * as git recorded it. The line beside the list fills with scroll (CSS scroll-driven animation).
 */

const TRACK_LABEL: Record<TimelineCommit["track"], string> = {
  contracts: "Contracts",
  ledgers: "Ledgers",
  agent: "Agent",
  web: "Web",
  evidence: "Evidence",
  infra: "Infra",
};

function parts(iso: string) {
  // ISO 8601 with the author's offset, e.g. 2026-10-16T02:39:27+06:00: show it as recorded.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const off = iso.match(/([+-]\d{2}):?(\d{2})$/);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!m) return { day: iso, time: "", zone: "" };
  const zone = off ? `UTC${off[1]!.startsWith("-") ? "-" : "+"}${Number(off[1]!.slice(1))}${off[2] !== "00" ? `:${off[2]}` : ""}` : "";
  return { day: `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`, time: `${m[4]}:${m[5]}`, zone };
}

export function BuildTimeline() {
  const t = SITE.timeline;
  const [track, setTrack] = useState<TimelineCommit["track"] | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const counts = useMemo(() => {
    const c = {} as Record<TimelineCommit["track"], number>;
    for (const k of Object.keys(TRACK_LABEL) as TimelineCommit["track"][]) c[k] = 0;
    t?.commits.forEach((x) => c[x.track]++);
    return c;
  }, [t]);
  if (!t) return <p className="m-0 text-13 text-fg-muted">The build history is generated from git at build time; this build had none.</p>;

  const list = t.commits.filter((c) => (track === "all" ? showAll || c.milestone : c.track === track));
  const first = parts(t.first);
  const last = parts(t.last);
  const milestones = t.commits.filter((c) => c.milestone).length;

  return (
    <div className="grid gap-8">
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-6 border-y border-line-1 py-6 sm:grid-cols-4">
        <div className="grid gap-1">
          <dt className="order-2 text-12 text-fg-muted">commits in the public history</dt>
          <dd className="order-1 m-0 font-mono text-32 leading-none text-fg-0">{t.count}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="order-2 text-12 text-fg-muted">milestones (a capability live end to end)</dt>
          <dd className="order-1 m-0 font-mono text-32 leading-none text-fg-0">{milestones}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="order-2 text-12 text-fg-muted">first commit, {first.zone}</dt>
          <dd className="order-1 m-0 font-mono text-18 leading-tight text-fg-0">
            {first.day} {first.time}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="order-2 text-12 text-fg-muted">latest commit in this build, {last.zone}</dt>
          <dd className="order-1 m-0 font-mono text-18 leading-tight text-fg-0">
            {last.day} {last.time}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the build history by track">
        <FilterButton on={track === "all"} onClick={() => setTrack("all")}>
          Milestones
        </FilterButton>
        {(Object.keys(TRACK_LABEL) as TimelineCommit["track"][]).map((k) => (
          <FilterButton key={k} on={track === k} onClick={() => setTrack(k)}>
            {TRACK_LABEL[k]} <span className="font-mono text-fg-muted">{counts[k]}</span>
          </FilterButton>
        ))}
      </div>

      <div className="yl-timeline-scope relative grid grid-cols-[20px_1fr] gap-x-5">
        <div aria-hidden="true" className="relative">
          <span className="absolute top-2 bottom-2 left-[9px] w-px bg-line-2" />
          <span className="yl-timeline-fill absolute top-2 bottom-2 left-[9px] w-px bg-fg-1" />
        </div>
        <ol className="m-0 grid list-none gap-0 p-0" aria-live="polite">
          {list.map((c) => {
            const p = parts(c.at);
            return (
              <li key={c.hash} className={cn("yl-reveal relative grid gap-1 py-4", c.milestone ? "border-b border-line-1" : "py-2.5")}>
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-[1.35rem] -left-[29px] rounded-pill",
                    c.milestone ? "size-3 border-2 border-bg-0 bg-fg-0 outline outline-1 outline-line-3" : "size-1.5 -left-[26px] bg-fg-muted",
                  )}
                />
                <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-12 text-fg-muted">
                  <span className="font-mono text-fg-2">
                    {p.day} · {p.time}
                  </span>
                  <span className="eyebrow">{TRACK_LABEL[c.track]}</span>
                  <a href={`${REPO_URL}/commit/${c.hash}`} target="_blank" rel="noreferrer" className="font-mono underline decoration-line-2 underline-offset-4 hover:text-fg-0">
                    {c.hash}
                    <span className="sr-only"> (opens the commit on GitHub in a new tab)</span>
                  </a>
                </p>
                <p className={cn("m-0 max-w-[72ch] [overflow-wrap:anywhere]", c.milestone ? "text-15 font-medium text-fg-0 sm:text-18 sm:leading-snug" : "text-13 text-fg-2")}>{c.subject}</p>
              </li>
            );
          })}
        </ol>
      </div>
      {track === "all" ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="yl-press inline-flex h-10 w-fit items-center rounded-control border border-line-3 px-4 text-13 text-fg-1 hover:bg-bg-2"
        >
          {showAll ? "Show milestones only" : `Show all ${t.count} commits`}
        </button>
      ) : null}
      <p className="m-0 text-12 text-fg-muted">
        Generated from git log at build time (head {t.head}). Times are the author&apos;s clock as git recorded it ({first.zone}).
      </p>
    </div>
  );
}

function FilterButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-12",
        on ? "border-fg-2 bg-bg-3 text-fg-0" : "border-line-3 text-fg-2 hover:bg-bg-2 hover:text-fg-0",
      )}
    >
      {children}
    </button>
  );
}
