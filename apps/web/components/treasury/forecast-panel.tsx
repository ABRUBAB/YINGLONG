"use client";

import { cn, StateRing } from "@yinglong/ui";
import type { CashForecast } from "@/lib/api/view";
import { useAgent } from "@/lib/api/hooks";
import { formatDay, formatTime, formatUnits } from "@/lib/format";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { AmountFlow } from "@/components/data/amount-flow";
import { ErrorLine, Loading } from "@/components/data/parts";
import { NarrationBlock, Panel, ReadFrom } from "@/components/data/panel";

function Signed({ v, f }: { v: string; f: CashForecast }) {
  return <>{formatUnits(v, f.decimals, 0)}</>;
}

/** 30-day cash forecast: posted balance, pending instructions, recurring payroll and supplier run-rate. */
export function ForecastPanel({ entityId }: { entityId: string }) {
  const q = useAgent(`forecast:${entityId}`, (api) => api.forecast(entityId, 30), ["treasury", "forecast"]);
  const f = q.data;
  const headroom = f ? BigInt(f.headroomAboveFloor) : 0n;
  return (
    <Panel
      id="forecast-h"
      eyebrow={f ? `Cash forecast, ${f.horizonDays} days` : "Cash forecast"}
      title={
        f ? (
          f.firstBreach ? (
            <span className="flex items-start gap-2">
              <StateRing state="waiting" size={20} glyphOnly label="Needs the board" className="mt-px shrink-0" />
              Reserve floor breached on day {f.firstBreach.day}, {formatDay(f.firstBreach.date)}
            </span>
          ) : (
            "The reserve floor holds over the horizon"
          )
        ) : (
          "Cash forecast"
        )
      }
      meta={f ? <span>{f.rail}. Deterministic projection{f.modelBands ? "; the amber band is the M5 model's 5th to 95th percentile and only advises" : ""}; nothing else here is a model output except the labelled paragraph.</span> : null}
      footer={f ? f.label : null}
      tone={f?.firstBreach ? "brass" : undefined}
    >
      <ErrorLine error={q.error} />
      {q.loading && !f ? <Loading label="Loading the forecast" rows={4} /> : null}
      {f ? (
        <div className="grid gap-6">
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <div className="grid gap-1">
              <dt className="text-12 text-fg-muted">Posted balance</dt>
              <dd className="m-0 font-mono text-18 text-fg-0 tabular">
                <AmountFlow value={BigInt(f.start.posted.value)} decimals={f.decimals} fractionDigits={0} />
              </dd>
              <dd className="m-0 text-11 text-fg-muted">read on chain, {f.symbol}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-12 text-fg-muted">Lowest projected</dt>
              <dd className="m-0 font-mono text-18 text-fg-1 tabular">
                <Signed v={f.minBalance} f={f} />
              </dd>
              <dd className="m-0 text-11 text-fg-muted">over {f.horizonDays} days</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-12 text-fg-muted">{headroom < 0n ? "Shortfall under the floor" : "Headroom above the floor"}</dt>
              <dd className={cn("m-0 font-mono text-18 tabular", headroom < 0n ? "text-brass" : "text-fg-1")}>{formatUnits(headroom < 0n ? -headroom : headroom, f.decimals, 0)}</dd>
              <dd className="m-0 text-11 text-fg-muted">floor {formatUnits(f.reserveFloor.value, f.decimals, 0)}</dd>
            </div>
            {f.velocity ? (
              <div className="grid gap-1">
                <dt className="text-12 text-fg-muted">Left in this window</dt>
                <dd className="m-0 font-mono text-18 text-fg-1 tabular">
                  {f.velocity.countLeft} <span className="text-13 text-fg-muted">of {f.velocity.maxCount} payments</span>
                </dd>
                <dd className="m-0 text-11 text-fg-muted">
                  {formatUnits(f.velocity.outflowLeft.value, f.decimals, 0)} outflow, until {formatTime(f.velocity.windowEndsAt, { date: false })}
                </dd>
              </div>
            ) : (
              <div className="grid gap-1">
                <dt className="text-12 text-fg-muted">Pending instructions</dt>
                <dd className="m-0 font-mono text-18 text-fg-1 tabular">{formatUnits(f.start.pending.value, f.decimals, 0)}</dd>
                <dd className="m-0 text-11 text-fg-muted">leave today</dd>
              </div>
            )}
          </dl>

          <ForecastChart f={f} />
          {f.modelBands ? (
            <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-12 text-fg-muted">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-0.5 w-5 bg-steel" /> projected balance (decides)
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm bg-brass/25" /> {f.modelBands.model}: 5th to 95th percentile (advises)
              </span>
            </p>
          ) : null}

          {f.flags.length ? (
            <ul className="m-0 grid list-none gap-1 p-0">
              {f.flags.map((fl) => (
                <li key={fl} className="flex items-start gap-2 text-12 text-fg-1">
                  <StateRing state={f.firstBreach ? "waiting" : "verified"} size={16} glyphOnly label={f.firstBreach ? "Needs the board" : "Holds"} className="mt-px" />
                  {fl}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-2">
            <h3 className="m-0 text-12 font-medium text-fg-2">What the projection includes</h3>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Forecast inputs (scrolls sideways on small screens)">
              <table className="yl-table min-w-[520px]">
                <caption className="sr-only">Dated outflows and run-rates the forecast subtracts</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Kind</th>
                    <th scope="col">What</th>
                    <th scope="col" className="text-right">
                      Amount <span className="block text-11 font-normal">{f.symbol}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {f.events.map((e, i) => (
                    <tr key={`${e.day}-${e.kind}-${i}`}>
                      <td className="font-mono text-12 whitespace-nowrap text-fg-2 tabular">
                        {e.kind === "supplier run-rate" ? "every day" : e.day === 0 ? "today" : `day ${e.day}`}
                        <span className="block text-11 text-fg-muted">{e.kind === "supplier run-rate" ? "from day 1" : formatDay(e.date)}</span>
                      </td>
                      <td className="text-12 text-fg-2">{e.kind}</td>
                      <td className="text-12 text-fg-1">{e.label}</td>
                      <td className="num text-13 text-fg-1">
                        {formatUnits(e.amount.value, e.amount.decimals)}
                        {e.kind === "supplier run-rate" ? <span className="block text-11 text-fg-muted">per day</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="group">
            <summary className="cursor-pointer text-12 text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-0">Daily projection, day by day</summary>
            <div className="mt-3 max-h-72 overflow-auto" tabIndex={0} role="region" aria-label="Daily projection">
              <table className="yl-table">
                <caption className="sr-only">Projected balance per day</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col" className="text-right">
                      Outflow
                    </th>
                    <th scope="col" className="text-right">
                      Balance
                    </th>
                    <th scope="col">Floor</th>
                  </tr>
                </thead>
                <tbody>
                  {f.daily.map((d) => (
                    <tr key={d.day}>
                      <td className="font-mono text-12 text-fg-2 tabular">
                        {d.day} <span className="text-fg-muted">{formatDay(d.date)}</span>
                      </td>
                      <td className="num text-12 text-fg-2">{formatUnits(d.outflow, f.decimals, 0)}</td>
                      <td className="num text-12 text-fg-1">{formatUnits(d.balance, f.decimals, 0)}</td>
                      <td className="text-12 text-fg-muted">{d.belowFloor ? "below" : "above"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <NarrationBlock n={f.explanation} className="border-t border-line-1 pt-4" />
          <p className="m-0 text-11 text-fg-muted">
            <ReadFrom ledger={f.ledger} block={f.block} />
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
