"use client";

import { useMemo, useState } from "react";
import { LabelChip, SampleDataChip, shortHash, StateRing } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import { formatTime, LEDGER_SHORT } from "@/lib/format";
import { explorerTxUrl } from "@/lib/chain";
import { ArrowIcon, ButtonLink } from "@/components/ui/button";
import { Qr } from "@/components/qr";
import { ErrorLine, TxLink } from "@/components/data/parts";
import { SectionHead } from "./sections";

const SOURCE_LABEL: Record<string, string> = {
  "anvil-fork": "Anvil fork",
  "live-base": "Base Sepolia",
  "live-fisco": "FISCO BCOS",
  kaggle: "Kaggle run",
  "user-study": "User study",
  ci: "CI",
};

interface RibbonItem {
  key: string;
  label: string;
  hash: string;
  ledger: string;
  href?: string;
  refused: boolean;
}

/**
 * Evidence ribbon: a marquee of real hashes (published evidence first, then the newest receipts),
 * each linking to its explorer. It loops, so it has its own visible pause (and the page-level Pause
 * motion control, hover, focus and reduced motion stop it too).
 */
export function EvidenceRibbon() {
  const ev = useAgent("evidence", (api) => api.evidence(), ["evidence"]);
  const rq = useAgent("hero-receipts", (api) => api.receipts({ limit: 200 }), ["receipts"]);
  const [paused, setPaused] = useState(false);
  const items = useMemo<RibbonItem[]>(() => {
    const out: RibbonItem[] = [];
    for (const h of ev.data?.hashes ?? []) {
      out.push({
        key: `e-${h.id}`,
        label: h.typedError ? `${h.label} · ${h.typedError}` : h.label,
        hash: h.tx.txHash,
        ledger: LEDGER_SHORT[h.tx.ledger],
        href: explorerTxUrl(h.tx.ledger, h.tx.txHash, h.tx.explorerUrl),
        refused: Boolean(h.typedError),
      });
    }
    for (const r of rq.data?.items ?? []) {
      if (out.length >= 18) break;
      if (!r.txHash) continue;
      out.push({
        key: `r-${r.receiptId}`,
        label: r.revertError ? `${r.summary} · ${r.revertError}` : r.summary,
        hash: r.txHash,
        ledger: r.ledgerBadge ?? LEDGER_SHORT[r.ledger],
        href: explorerTxUrl(r.ledger, r.txHash, r.explorerUrl),
        refused: r.outcome === "reverted" || r.outcome === "rejected_policy",
      });
    }
    return out;
  }, [ev.data, rq.data]);

  if (items.length === 0) return null;
  const track = (hidden: boolean) => (
    <ul className="yl-marquee-track m-0 list-none p-0" aria-hidden={hidden || undefined}>
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-3 text-12 whitespace-nowrap">
          <StateRing state={it.refused ? "refused" : "onchain"} size={16} label={it.refused ? "Refused" : "On chain"} />
          <span className="text-fg-2">{it.label}</span>
          {it.href ? (
            <a href={it.href} tabIndex={hidden ? -1 : undefined} target="_blank" rel="noreferrer" className="font-mono text-fg-1 underline decoration-line-2 underline-offset-4 hover:decoration-fg-1">
              {shortHash(it.hash, 8, 6)}
            </a>
          ) : (
            <span className="font-mono text-fg-1">{shortHash(it.hash, 8, 6)}</span>
          )}
          <span className="text-fg-muted">{it.ledger}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-label="Recent evidence hashes" className="border-y border-line-1 bg-bg-0">
      <div className="yl-container flex items-center gap-4 py-4">
        <p className="eyebrow m-0 hidden shrink-0 text-fg-muted md:block">On chain now</p>
        <div className="yl-marquee min-w-0 flex-1" data-paused={paused} style={{ ["--duration" as string]: `${Math.max(40, items.length * 6)}s` }}>
          {track(false)}
          {track(true)}
        </div>
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
          className="yl-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-12 text-fg-2 hover:bg-bg-3 hover:text-fg-0"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            {paused ? <path d="M5.5 4.5l6 3.5-6 3.5z" fill="currentColor" /> : <path d="M5.75 4.5v7M10.25 4.5v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
          </svg>
          {paused ? "Play" : "Pause"}
          <span className="sr-only"> the evidence ribbon</span>
        </button>
      </div>
    </section>
  );
}

/** Evidence: generated numbers only. With none generated yet, the section says so. */
export function Evidence() {
  const q = useAgent("evidence", (api) => api.evidence(), ["evidence"]);
  const e = q.data;
  return (
    <section aria-labelledby="evidence-title" className="yl-section border-y border-line-1 bg-bg-1">
      <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
        <SectionHead
          index="04"
          eyebrow="Evidence"
          id="evidence-title"
          title="Measured, not claimed"
          lead="Every number is generated from the code and carries its source. If a number is not generated, it does not appear."
          className="lg:col-span-4"
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isSample ? <SampleDataChip /> : null}
            {e ? <span className="text-12 text-fg-muted">Generated {formatTime(e.generatedAt)} HKT</span> : null}
          </div>
          <div className="mt-4">
            <ButtonLink href="/proof" variant="secondary">
              Open the proof <ArrowIcon />
            </ButtonLink>
          </div>
        </SectionHead>
        <div className="grid content-start gap-8 lg:col-span-8">
          <ErrorLine error={q.error} />
          {e && e.metrics.length ? (
            <div className="yl-card overflow-x-auto px-5 py-2 sm:px-6" tabIndex={0} role="region" aria-label="Generated metrics (scrolls sideways on small screens)">
              <table className="yl-table min-w-[560px]">
                <caption className="sr-only">Generated metrics with sample size and source</caption>
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    <th scope="col" className="text-right">
                      Value
                    </th>
                    <th scope="col" className="text-right">
                      n
                    </th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {e.metrics.map((m) => (
                    <tr key={m.id}>
                      <td className="text-fg-1">{m.label}</td>
                      <td className="num text-18 text-fg-0">
                        {m.value}
                        {m.interval ? <span className="block text-11 text-fg-muted">95% {m.interval[0]} to {m.interval[1]}</span> : null}
                      </td>
                      <td className="num text-fg-2">{m.n ?? "—"}</td>
                      <td>
                        <LabelChip dotted={m.source === "anvil-fork"}>{SOURCE_LABEL[m.source] ?? m.source}</LabelChip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : e ? (
            <p className="m-0 flex items-center gap-2 text-13 text-fg-2">
              <StateRing state="pending" size={16} label="No generated numbers yet" /> The agent service has not published metrics; transactions below are live.
            </p>
          ) : null}
          {e && e.hashes.length ? (
            <ul className="m-0 grid list-none gap-0 border-t border-line-2 p-0">
              {e.hashes.slice(0, 6).map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line-1 py-3.5 text-13">
                  <span className="text-fg-1">{h.label}</span>
                  <TxLink ledger={h.tx.ledger} hash={h.tx.txHash} href={h.tx.explorerUrl} badge={h.tx.badge} label={h.typedError ? `Reverted: ${h.typedError}` : "On chain"} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Judge's Challenge call to action with the guest QR. */
export function ChallengeCta() {
  const q = useAgent("challenge-session", (api) => api.challengeSession(), ["challenge"]);
  return (
    <section aria-labelledby="cta-title" className="yl-section">
      <div className="yl-container">
        <div className="yl-card grid items-center gap-10 overflow-hidden p-6 sm:p-10 lg:grid-cols-12 lg:p-14">
          <div className="lg:col-span-7">
            <SectionHead index="05" eyebrow="Judge's Challenge" id="cta-title" title="Nothing you type can move funds outside the mandate. Try." />
            <p className="m-0 mt-5 max-w-[52ch] text-15 text-fg-2">
              Scan the code for a guest mandate with a tiny cap, write any attack to Ying, and see which of the nine scales stopped it. Press bypass
              to send a raw redemption straight to the chain and get the revert hash.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/challenge" size="lg">
                Open the challenge <ArrowIcon />
              </ButtonLink>
              <ButtonLink href="/start" variant="secondary" size="lg">
                Sign up with your passkey
              </ButtonLink>
            </div>
          </div>
          <div className="flex items-center gap-6 lg:col-span-5 lg:justify-end">
            <div className="rounded-card border border-line-2 bg-bg-0 p-3">
              {q.data ? (
                <Qr value={q.data.joinUrl} size={156} label="QR code for a guest mandate in the Judge's Challenge" />
              ) : (
                <Qr value="https://app.yinglong-agent.tech/challenge" size={156} label="QR code for the Judge's Challenge" />
              )}
            </div>
            <div className="grid gap-1 text-12 text-fg-muted">
              <span>Guest mandate, test units only</span>
              {q.data ? <span>{q.data.quota.perDay} attempts per guest per day</span> : null}
              {isSample ? <SampleDataChip /> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
