"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { cn, LabelChip, StateRing } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { formatAmount, formatTime } from "@/lib/format";
import { useMotionOff, MotionToggle } from "@/components/preferences";
import { ErrorLine, Loading, SampleBadge, TxLink } from "@/components/data/parts";
import { City2D } from "./city-2d";
import { layoutCity } from "./layout";

const City3D = dynamic(() => import("./city-3d"), { ssr: false, loading: () => null });

interface Label {
  id: string;
  label: string;
  x: number;
  y: number;
  muted: boolean;
}

function webgl2(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

export function AgentCity() {
  const q = useAgent("city", (api) => api.city(), ["city", "receipts"]);
  const motionOff = useMotionOff();
  const [can3D, setCan3D] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const [labels, setLabels] = useState<Label[]>([]);
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    setCan3D(!motionOff && webgl2() && !(nav.connection?.saveData) && !(typeof nav.deviceMemory === "number" && nav.deviceMemory < 4));
  }, [motionOff]);
  const g = q.data;
  const names = g ? new Map(layoutCity(g).map((n) => [n.id, n.label])) : new Map<string, string>();

  return (
    <div data-surface="obsidian" className="bg-bg-0 text-fg-1">
      <div className="mx-auto w-full max-w-[1320px] px-4 pt-10 pb-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow m-0 text-fg-muted">Agent City: Greater Bay</p>
            <h1 className="type-display m-0 mt-2 text-[2.2rem] leading-none text-fg-0 sm:text-[2.8rem]">Two rails, one engine</h1>
            <p className="m-0 mt-3 max-w-[64ch] text-15 text-fg-2">
              Hong Kong on a public test rail, Shenzhen on a coin-free consortium rail. The same enforcer bytecode decides on both; anchors cross the
              seam in both directions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SampleBadge />
            {can3D ? (
              <button type="button" onClick={() => setPlayKey((k) => k + 1)} className="inline-flex h-8 items-center rounded-control px-2 text-12 text-fg-2 hover:bg-bg-3 hover:text-fg-0">
                Replay payments
              </button>
            ) : null}
            <MotionToggle />
          </div>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-[1320px] px-2 sm:px-6 lg:px-8">
        <ErrorLine error={q.error} />
        {q.loading ? <Loading rows={6} /> : null}
        {g ? (
          <div className="relative aspect-[1000/580] w-full">
            <City2D graph={g} className={cn("absolute inset-0 size-full transition-opacity duration-500", can3D && drawn && "opacity-0")} />
            {can3D ? (
              <div className={cn("absolute inset-0 transition-opacity duration-500", drawn ? "opacity-100" : "opacity-0")}>
                <City3D graph={g} playKey={playKey} motion={!motionOff} onFirstFrame={() => setDrawn(true)} onProject={setLabels} />
                <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                  {labels.map((l) => (
                    <span
                      key={l.id}
                      className={cn("absolute -translate-x-1/2 text-[11px] leading-tight whitespace-nowrap", l.muted ? "text-fg-muted" : "text-fg-1")}
                      style={{ left: l.x, top: l.y }}
                    >
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-12 text-fg-muted">
          <div className="flex items-center gap-2">
            <dt className="inline-flex size-3.5 rounded-pill border border-fg-2" aria-hidden="true" />
            <dd className="m-0">Passport attested by a trusted issuer</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="inline-flex size-3.5 rounded-pill border border-dashed border-fg-faint" aria-hidden="true" />
            <dd className="m-0">Self-registered, no trusted issuer</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="h-px w-5 bg-fg-2" aria-hidden="true" />
            <dd className="m-0">Settled</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="h-px w-5 border-t border-dashed border-brass" aria-hidden="true" />
            <dd className="m-0">Waiting for a person</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt aria-hidden="true">
              <StateRing state="refused" size={16} glyphOnly label="Refused" />
            </dt>
            <dd className="m-0">Stopped at the refusing ring</dd>
          </div>
        </dl>
      </div>

      {g ? (
        <div className="mx-auto mt-12 grid w-full max-w-[1320px] gap-12 px-4 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:px-8">
          <section aria-labelledby="city-pay" className="grid content-start gap-3">
            <h2 id="city-pay" className="m-0 text-15 font-semibold text-fg-0">
              Payments on the map
            </h2>
            <div className="-mx-1 overflow-x-auto px-1" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
              <table className="yl-table min-w-[560px]">
                <caption className="sr-only">Every edge drawn on the map</caption>
                <thead>
                  <tr>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">What</th>
                    <th scope="col" className="text-right">
                      Amount
                    </th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {g.edges.map((e) => (
                    <tr key={e.id}>
                      <td className="text-fg-1">{names.get(e.from) ?? e.from}</td>
                      <td className="text-fg-1">{names.get(e.to) ?? e.to}</td>
                      <td className="text-fg-2">{e.label}</td>
                      <td className="num text-fg-1">{e.amount ? formatAmount(e.amount) : "—"}</td>
                      <td>
                        {e.state === "settled" ? (
                          <StateRing state="verified" label="Settled" />
                        ) : e.state === "awaiting" ? (
                          <StateRing state="waiting" label="Needs a person" />
                        ) : (
                          <StateRing state="refused" label="Refused" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section aria-labelledby="city-anchor" className="grid content-start gap-3">
            <h2 id="city-anchor" className="m-0 text-15 font-semibold text-fg-0">
              Anchors across the seam
            </h2>
            {g.anchors.length === 0 ? <p className="m-0 text-13 text-fg-muted">No anchor batch yet.</p> : null}
            <ul className="m-0 grid list-none gap-0 p-0">
              {g.anchors.map((a) => (
                <li key={a.root} className="grid gap-1.5 border-t border-line-2 py-3 text-13">
                  <span className="text-fg-1">Batch at {formatTime(a.at)} HKT</span>
                  <span className="font-mono text-12 break-all text-fg-muted">root {a.root}</span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    {a.baseTx ? <TxLink ledger="base-sepolia" hash={a.baseTx} label="Base" /> : null}
                    {a.fiscoTx ? <TxLink ledger="fisco" hash={a.fiscoTx} label="FISCO" /> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-2 flex flex-wrap items-center gap-2 text-12 text-fg-muted">
              <LabelChip>Test units</LabelChip> The FISCO chain is run by the team; anchoring proves consistency, not consensus.
            </p>
          </section>
        </div>
      ) : null}
      <p className="mx-auto w-full max-w-[1320px] px-4 pb-10 text-12 text-fg-muted sm:px-6 lg:px-8">
        All third-party marks are the property of their respective owners. No partnership, sponsorship or endorsement is implied.
      </p>
    </div>
  );
}
