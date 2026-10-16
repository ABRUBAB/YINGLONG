"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn, LabelChip, RingGlyph, SampleDataChip, shortHash, type RingState } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import type { CityReceipt, Ledger } from "@/lib/api/view";
import { explorerTxUrl } from "@/lib/chain";
import { formatTime, TIER_WHO } from "@/lib/format";
import { ruleForError, SITE } from "@/content/site-data";
import { ErrorLine } from "@/components/data/parts";
import { SectionHead } from "./sections";
import { useInView, useVisibleInterval } from "./use-live";

/**
 * Proof wall: the newest events on both ledgers, each with the rule that allowed or stopped it.
 * FISCO BCOS rows are the live receipt feed (GET /v1/receipts, polled every 15 s while the wall is
 * on screen and the tab is visible). Base Sepolia rows come from the same feed when the service has
 * any; until then the wall shows the recorded Base Sepolia run (apps/agent/data/e2e-base-sepolia.json,
 * copied at build time), labelled as a recorded run. A row that arrives after the first read rises
 * into place once (CSS); nothing else moves.
 */

const POLL_MS = 15_000;
const PER_LANE = 6;

interface WallRow {
  id: string;
  state: RingState;
  word: string;
  summary: string;
  rule: string;
  ruleBy: string | null;
  hash: string | null;
  href: string | undefined;
  when: string | null;
}

function outcomeOf(r: Pick<CityReceipt, "outcome" | "txHash">): { state: RingState; word: string } {
  switch (r.outcome) {
    case "confirmed":
      return { state: "onchain", word: "Settled" };
    case "reverted":
      return { state: "refused", word: "Reverted on chain" };
    case "rejected_policy":
      return { state: "refused", word: "Refused" };
    case "asked":
      return { state: "asking", word: "Asked the owner" };
    case "awaiting_approval":
    case "pending":
      return { state: "waiting", word: "Waiting for a passkey" };
    default:
      return { state: "unknown", word: "Recorded" };
  }
}

function fromReceipt(r: CityReceipt): WallRow {
  const o = outcomeOf(r);
  const stop = ruleForError(r.revertError);
  const refused = o.state === "refused";
  return {
    id: r.receiptId,
    ...o,
    summary: r.summary,
    rule: refused
      ? stop?.rule ?? (r.revertError ? `Typed error ${r.revertError}` : "Refused by the nine scales before the chain")
      : r.outcome === "confirmed"
        ? `${r.tier}: ${TIER_WHO[r.tier]}`
        : r.outcome === "asked"
          ? TIER_WHO.ASK
          : o.state === "waiting"
            ? `T2: ${TIER_WHO.T2}`
            : TIER_WHO[r.tier],
    ruleBy: refused ? (stop?.enforcer ?? (r.revertError ? null : "off-chain scales")) : null,
    hash: r.txHash,
    href: explorerTxUrl(r.ledger, r.txHash, r.explorerUrl),
    when: r.timestamp,
  };
}

function recordedBaseRows(): WallRow[] {
  return [...(SITE.baseScenario ?? [])].reverse().map((s) => {
    const stop = ruleForError(s.revert);
    const tier = s.step.match(/^T(\d)\b/)?.[0] as keyof typeof TIER_WHO | undefined;
    const refused = s.ok === false;
    return {
      id: `base-${s.index}`,
      state: refused ? "refused" : "onchain",
      word: refused ? (s.tx ? "Reverted on chain" : "Refused in simulation") : "Settled",
      summary: s.step.replace(/^T\d\s+/, ""),
      rule: refused ? stop?.rule ?? "Refused by the caveat enforcers" : tier ? `${tier}: ${TIER_WHO[tier]}` : "Set-up step of the scripted run",
      ruleBy: refused ? (stop?.enforcer ?? null) : null,
      hash: s.tx,
      href: s.tx ? explorerTxUrl("base-sepolia", s.tx) : undefined,
      when: null,
    };
  });
}

export function ProofWall() {
  const root = useRef<HTMLElement>(null);
  const near = useInView(root, { once: false, margin: "200px 0px 200px 0px" });
  const q = useAgent("city-feed", (api) => api.cityFeed(), ["receipts", "city"]);
  useVisibleInterval(() => q.refetch(), POLL_MS, near && !isSample);

  const lanes = useMemo(() => {
    const rows = q.data?.receipts ?? [];
    const lane = (ledger: Ledger) => rows.filter((r) => r.ledger === ledger).slice(0, PER_LANE).map(fromReceipt);
    const base = lane("base-sepolia");
    return {
      fisco: lane("fisco"),
      base: base.length ? base : recordedBaseRows().slice(0, PER_LANE),
      baseRecorded: base.length === 0,
    };
  }, [q.data]);

  // Rows present at the first read are the wall; rows that appear in a later read are arrivals.
  const shown = useRef<Set<string> | null>(null);
  const fresh = useMemo(() => {
    const before = shown.current;
    if (!before) return new Set<string>();
    return new Set([...lanes.fisco, ...lanes.base].map((r) => r.id).filter((id) => !before.has(id)));
  }, [lanes]);
  useEffect(() => {
    if (q.data) shown.current = new Set([...lanes.fisco, ...lanes.base].map((r) => r.id));
  }, [lanes, q.data]);

  return (
    <section ref={root} aria-labelledby="wall-title" className="yl-section yl-defer border-y border-line-1 bg-bg-1">
      <div className="yl-container">
        <SectionHead
          index="06"
          eyebrow="Proof wall"
          id="wall-title"
          title="Every action, on both ledgers, with the rule that decided it"
          lead="The newest receipts from the agent service. Allowed actions name the tier that let them through; refusals name the enforcer that stopped them."
        >
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-12 text-fg-muted">
            {isSample ? <SampleDataChip /> : <span>Read from GET /v1/receipts every 15 s while this wall is on screen</span>}
            {q.data ? <span>Last read {formatTime(q.data.fetchedAt, { date: false, seconds: true })} HKT</span> : null}
          </div>
        </SectionHead>
        <ErrorLine error={q.error} />
        <div className="mt-12 grid gap-3 lg:grid-cols-2">
          <Lane
            title="FISCO BCOS"
            badge="FISCO BCOS (team-run consortium ledger)"
            note="Live feed"
            rows={lanes.fisco}
            fresh={fresh}
            empty={q.loading ? "Reading the feed" : "No receipts on this ledger yet"}
          />
          <Lane
            title="Base Sepolia"
            badge="Base Sepolia (testnet)"
            note={lanes.baseRecorded ? "Recorded run: scripted student scenario on Base Sepolia, newest step first" : "Live feed"}
            rows={lanes.base}
            fresh={fresh}
            empty="No receipts on this ledger yet"
            steel
          />
        </div>
      </div>
    </section>
  );
}

function Lane({
  title,
  badge,
  note,
  rows,
  fresh,
  empty,
  steel,
}: {
  title: string;
  badge: string;
  note: string;
  rows: WallRow[];
  fresh: Set<string>;
  empty: string;
  steel?: boolean;
}) {
  return (
    <div className="yl-card yl-card-raised yl-reveal flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-1 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <LedgerMark steel={steel} />
          <div className="min-w-0">
            <h3 className="m-0 text-15 font-medium text-fg-0">{title}</h3>
            <p className="m-0 text-12 text-fg-muted">{note}</p>
          </div>
        </div>
        <LabelChip tone={steel ? "steel" : "neutral"}>{badge}</LabelChip>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 px-5 py-8 text-13 text-fg-muted sm:px-6">{empty}</p>
      ) : (
        <ol className="m-0 grid list-none p-0" aria-live="polite" aria-relevant="additions">
          {rows.map((r) => (
            <li
              key={r.id}
              className={cn("grid min-w-0 grid-cols-[20px_1fr] gap-x-3 border-b border-line-1 px-5 py-4 last:border-b-0 sm:px-6", fresh.has(r.id) && "yl-arrive")}
            >
              <span className="pt-0.5 text-fg-1">
                <RingGlyph state={r.state} size={20} />
              </span>
              <div className="grid min-w-0 gap-1">
                <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-13">
                  <span className={cn("font-medium", r.state === "refused" ? "text-fg-0" : "text-fg-1")}>{r.word}</span>
                  <span className="min-w-0 text-fg-2 [overflow-wrap:anywhere]">{r.summary}</span>
                </p>
                <p className="m-0 text-12 text-fg-muted [overflow-wrap:anywhere]">
                  {r.ruleBy ? <span className="font-mono text-fg-2">{r.ruleBy}</span> : null}
                  {r.ruleBy ? " · " : null}
                  {r.rule}
                </p>
                <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-11 text-fg-muted">
                  {r.hash ? (
                    r.href ? (
                      <a
                        href={r.href}
                        target={r.href.startsWith("http") ? "_blank" : undefined}
                        rel={r.href.startsWith("http") ? "noreferrer" : undefined}
                        className="font-mono text-fg-2 underline decoration-line-2 underline-offset-4 hover:text-fg-0 hover:decoration-fg-1"
                      >
                        {shortHash(r.hash, 8, 6)}
                        {r.href.startsWith("http") ? <span className="sr-only"> (opens the explorer in a new tab)</span> : null}
                      </a>
                    ) : (
                      <span className="font-mono text-fg-2">{shortHash(r.hash, 8, 6)}</span>
                    )
                  ) : (
                    <span>No transaction (refused before the chain)</span>
                  )}
                  {r.when ? <span>{formatTime(r.when)} HKT</span> : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A ledger: a ring with its pearl; steel marks the public chain's pearl. */
function LedgerMark({ steel }: { steel?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" className="shrink-0 text-fg-1">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="18" cy="6" r="2.6" fill={steel ? "var(--steel)" : "currentColor"} />
    </svg>
  );
}
