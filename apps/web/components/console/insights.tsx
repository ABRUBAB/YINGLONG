"use client";

import { Fragment } from "react";
import { cn } from "@yinglong/ui";
import type { InsightCategory } from "@/lib/api/view";
import { useAgent } from "@/lib/api/hooks";
import { formatAmount, formatDay, formatTime, formatUnits } from "@/lib/format";
import { AmountFlow } from "@/components/data/amount-flow";
import { ErrorLine, Loading } from "@/components/data/parts";
import { NarrationBlock, Panel, ReadFrom } from "@/components/data/panel";

const STATUS_WORD: Record<InsightCategory["status"], string> = {
  "on track": "On track",
  "at cap": "At the cap",
  "due this period": "Due this period",
  "would reach the cap before the period ends": "Would reach the cap",
};

/** Status glyph: a ring (on track), a filled ring (at cap), a dashed ring (forecast reaches the cap), a ring with a dot (due). */
function StatusGlyph({ status }: { status: InsightCategory["status"] }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className="shrink-0">
      {status === "at cap" ? (
        <circle cx="6" cy="6" r="4.6" fill="var(--fg-1)" stroke="var(--fg-1)" strokeWidth="1.2" />
      ) : status === "would reach the cap before the period ends" ? (
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="var(--fg-1)" strokeWidth="1.2" strokeDasharray="2 1.6" />
      ) : (
        <>
          <circle cx="6" cy="6" r="4.6" fill="none" stroke="var(--fg-2)" strokeWidth="1.2" />
          {status === "due this period" ? <circle cx="6" cy="6" r="1.6" fill="var(--fg-2)" /> : null}
        </>
      )}
    </svg>
  );
}

const pct = (part: bigint, whole: bigint) => (whole > 0n ? Math.min(1, Number((part * 10_000n) / whole) / 10_000) : 0);

/**
 * One budget as a bar: the track is the cap the chain enforces; the solid fill is what was spent; the
 * outlined segment after it is the deterministic forecast to the end of the period.
 */
function CategoryBar({ c, delay }: { c: InsightCategory; delay: number }) {
  const cap = BigInt(c.cap.value);
  const spent = pct(BigInt(c.spent.value), cap);
  const forecast = pct(BigInt(c.forecast.value), cap);
  const name = c.category.charAt(0).toUpperCase() + c.category.slice(1);
  return (
    <li className="grid gap-2 border-t border-line-1 py-3.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-13 font-medium text-fg-0">{name}</span>
          <span className="text-11 text-fg-muted">{c.kind}</span>
        </span>
        <span className="font-mono text-12 text-fg-2 tabular">
          {formatUnits(c.spent.value, c.spent.decimals)} <span className="text-fg-muted">of {formatAmount(c.cap)}</span>
        </span>
      </div>
      <div
        className="relative h-2.5 overflow-hidden rounded-[3px] bg-bg-3"
        role="img"
        aria-label={`${name}: ${formatAmount(c.spent)} spent of ${formatAmount(c.cap)}; forecast at period end ${formatAmount(c.forecast)}`}
      >
        {forecast > spent ? (
          <span className="absolute inset-y-0 left-0 rounded-[3px] border border-dashed border-fg-muted" style={{ width: `${forecast * 100}%` }} />
        ) : null}
        <span className="yl-bar absolute inset-y-0 left-0 w-full rounded-[3px] bg-fg-1" style={{ ["--p" as string]: spent, transitionDelay: `${delay}ms` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-12">
        <span className="inline-flex items-center gap-1.5 text-fg-1">
          <StatusGlyph status={c.status} />
          {STATUS_WORD[c.status]}
          {c.wouldReachCapAt ? <span className="text-fg-muted">around {formatTime(c.wouldReachCapAt)}</span> : null}
        </span>
        <span className="text-fg-muted">
          Forecast <span className="font-mono text-fg-2 tabular">{formatUnits(c.forecast.value, c.forecast.decimals)}</span>
        </span>
      </div>
    </li>
  );
}

/** Spending insights: spent per category against the sealed budgets, the period-end forecast, one labelled paragraph. */
export function InsightsPanel() {
  const q = useAgent("insights", (api) => api.insights(), ["insights", "receipts", "budgets"]);
  const d = q.data;
  return (
    <Panel
      id="insights-h"
      eyebrow="Spending insights"
      title={d?.period ? `${d.period.daysLeft} day${d.period.daysLeft === 1 ? "" : "s"} left in this budget period` : "This budget period"}
      meta={
        d?.period ? (
          <span>
            {formatDay(d.period.start)} to {formatDay(d.period.end)}
            {d.period.timeCompressed ? " (time compressed for the demo: a period is shorter than a month)" : ""}
          </span>
        ) : null
      }
      footer={d ? <span>{d.label}</span> : null}
    >
      <ErrorLine error={q.error} />
      {q.loading && !d ? <Loading label="Loading insights" rows={3} /> : null}
      {d ? (
        <div className="grid gap-6">
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {d.totals.map((t) => (
              <Fragment key={t.cap.symbol}>
                <div className="grid gap-1">
                  <dt className="text-12 text-fg-muted">Spent, {t.spent.symbol}</dt>
                  <dd className="m-0 font-mono text-18 text-fg-0 tabular">
                    <AmountFlow value={BigInt(t.spent.value)} decimals={t.spent.decimals} />
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-12 text-fg-muted">Forecast at period end</dt>
                  <dd className="m-0 font-mono text-18 text-fg-2 tabular">
                    <AmountFlow value={BigInt(t.forecast.value)} decimals={t.forecast.decimals} />
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-12 text-fg-muted">Sealed budgets</dt>
                  <dd className="m-0 font-mono text-18 text-fg-muted tabular">{formatUnits(t.cap.value, t.cap.decimals)}</dd>
                </div>
              </Fragment>
            ))}
          </dl>

          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-11 text-fg-muted" aria-hidden="true">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-[2px] bg-fg-1" /> spent (enforced counter)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-[2px] border border-dashed border-fg-muted" /> forecast to period end
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-[2px] bg-bg-3" /> budget sealed in the mandate
              </span>
            </div>
            <ul className="m-0 grid list-none p-0">
              {d.categories.map((c, i) => (
                <CategoryBar key={`${c.cap.symbol}:${c.category}`} c={c} delay={Math.min(i, 7) * 50} />
              ))}
            </ul>
          </div>

          {d.topPayees.length ? (
            <div className="grid gap-2">
              <h3 className="m-0 text-12 font-medium text-fg-2">Largest payees this period</h3>
              <ol className="m-0 grid list-none gap-0 p-0">
                {d.topPayees.map((p, i) => (
                  <li key={`${p.address}:${p.amount.symbol}`} className={cn("flex items-baseline justify-between gap-3 py-1.5 text-13", i > 0 && "border-t border-line-1")}>
                    <span className="min-w-0 truncate text-fg-1">
                      {p.label} <span className="text-12 text-fg-muted">{p.payments} payment{p.payments === 1 ? "" : "s"}</span>
                    </span>
                    <span className="font-mono text-12 whitespace-nowrap text-fg-1 tabular">{formatAmount(p.amount)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <NarrationBlock n={d.explanation} className="border-t border-line-1 pt-4" />
          <p className="m-0 text-11 text-fg-muted">
            <ReadFrom ledger={d.ledger} block={d.block} label="Spent is the CategoryBudgetEnforcer counter on" />
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
