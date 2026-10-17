"use client";

import { ThemedImg } from "@/components/fx/themed-img";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn, LabelChip, StateRing, shortHash } from "@yinglong/ui";
import { getApi, isSample } from "@/lib/api";
import { useAgent } from "@/lib/api/hooks";
import type { CityFeed } from "@/lib/api/view";
import { explorerTxUrl } from "@/lib/chain";
import { formatAmount, formatTime, LEDGER_SHORT } from "@/lib/format";
import { MotionToggle, useMotionOff } from "@/components/preferences";
import { ErrorLine, Loading, SampleBadge } from "@/components/data/parts";
import { Segmented } from "@/components/ui/controls";
import { CityMap, type Filter, type PulseBatch } from "./city-map";
import { Details, itemTitle } from "./details";
import { GLYPH_WORD, NodeGlyphIcon, STATE_WORD, StateGlyph } from "./glyphs";
import { layoutCity } from "./layout";
import { buildCity, stateOf, type CityModel, type EdgeState } from "./model";
import styles from "./city.module.css";

const POLL_MS = 12_000;
const FULL_MS = 120_000;

export function AgentCity() {
  const q = useAgent("city", (api) => api.city(), ["city"]);
  const snap = q.data;
  const motionOff = useMotionOff();
  const [feed, setFeed] = useState<CityFeed | null>(null);
  const [status, setStatus] = useState<{ at: string; error: string | null } | null>(null);

  // The snapshot carries a feed; polling replaces it with newer ones.
  useEffect(() => {
    if (!snap) return;
    setFeed((f) => (!f || Date.parse(snap.feed.fetchedAt) >= Date.parse(f.fetchedAt) ? snap.feed : f));
    setStatus({ at: snap.feed.fetchedAt, error: null });
  }, [snap]);

  const hasSnap = Boolean(snap);
  const refetch = q.refetch;
  useEffect(() => {
    if (isSample || !hasSnap) return;
    let stopped = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const f = await getApi().cityFeed();
        if (stopped) return;
        setFeed(f);
        setStatus({ at: f.fetchedAt, error: null });
      } catch (e) {
        if (!stopped) setStatus((s) => ({ at: s?.at ?? new Date().toISOString(), error: (e as Error).message }));
      }
    };
    const t = window.setInterval(poll, POLL_MS);
    const full = window.setInterval(() => !document.hidden && refetch(), FULL_MS);
    return () => {
      stopped = true;
      window.clearInterval(t);
      window.clearInterval(full);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSnap]);

  const current = feed ?? snap?.feed ?? null;
  const model = useMemo(() => (snap && current ? buildCity({ ...snap, feed: current }) : null), [snap, current]);

  /* ---------------- width -> layout */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const set = () => setWidth(Math.max(280, Math.floor(el.getBoundingClientRect().width) - 2));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [model !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useMemo(() => (model && width ? layoutCity(model, width) : null), [model, width]);

  /* ---------------- new receipts and batches -> packets */
  const seen = useRef<{ r: Set<string>; b: Set<number> } | null>(null);
  const [pulses, setPulses] = useState<PulseBatch | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seq = useRef(0);
  useEffect(() => {
    if (!model) return;
    const pulse = (rs: CityModel["receipts"], anchors: string[][]) => {
      const receipts = rs
        .map((r) => ({ edgeId: model.edgeOfReceipt.get(r.receiptId)!, state: stateOf(r)! }))
        .filter((p) => p.edgeId && p.state);
      setPulses({ seq: ++seq.current, receipts, anchors: anchors as PulseBatch["anchors"] });
    };
    if (!seen.current) {
      seen.current = { r: new Set(model.receipts.map((r) => r.receiptId)), b: new Set(model.batches.map((b) => b.batchId)) };
      // On arrival each recent payment travels its edge once, oldest first.
      pulse(model.receipts.slice(0, 8).reverse(), model.batches.slice(0, 1).map((b) => b.anchors.map((a) => a.ledger)));
      return;
    }
    const newR = model.receipts.filter((r) => !seen.current!.r.has(r.receiptId));
    const newB = model.batches.filter((b) => !seen.current!.b.has(b.batchId));
    newR.forEach((r) => seen.current!.r.add(r.receiptId));
    newB.forEach((b) => seen.current!.b.add(b.batchId));
    if (newR.length || newB.length) {
      pulse([...newR].reverse(), newB.map((b) => b.anchors.map((a) => a.ledger)));
      setFresh(new Set(newR.map((r) => r.receiptId)));
    }
  }, [model]);
  const replay = () => {
    if (!model) return;
    setPulses({
      seq: ++seq.current,
      receipts: model.receipts
        .slice(0, 8)
        .reverse()
        .map((r) => ({ edgeId: model.edgeOfReceipt.get(r.receiptId)!, state: stateOf(r)! }))
        .filter((p) => p.edgeId),
      anchors: model.batches.slice(0, 1).map((b) => b.anchors.map((a) => a.ledger)),
    });
  };

  /* ---------------- selection */
  const [selected, setSelected] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const select = (id: string | null) => {
    setSelected((cur) => (id && cur === id ? null : id));
    if (id) setTrail((t) => [id, ...t.filter((x) => x !== id)].slice(0, 6));
  };
  const exists = (id: string) => Boolean(model && (model.nodes.has(id) || model.edges.some((e) => e.id === id)));

  const stats = model ? summary(model) : null;

  return (
    <div className="bg-bg-0 text-fg-1">
      <div className="yl-container pt-10 pb-6">
        <div className="yl-card yl-card--glass relative isolate mb-2 grid items-center gap-6 overflow-hidden p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div aria-hidden="true" className="yl-hero-glow" />
          <div className="min-w-0">
            <p className="eyebrow m-0 text-fg-muted">Live map</p>
            <h1 className="type-display m-0 mt-2 text-[1.9rem] leading-tight text-fg-0">Every agent and payment, live</h1>
            <p className="m-0 mt-2 max-w-[56ch] text-15 text-fg-2">
              Shenzhen on top, Hong Kong below. Each card is a person, a company, an AI agent or a shop; each line is a payment. Tap anything for details.
            </p>
          </div>
          <div className="hidden lg:block" aria-hidden="true">
            <ThemedImg name="city-glass" alt="" width={640} height={440} className="yl-float h-auto w-full" />
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0" />
          <div className="flex flex-wrap items-center gap-2">
            <SampleBadge />
            {!isSample && status ? (
              <span className="inline-flex items-center gap-2 text-12 text-fg-muted" aria-live="polite">
                {status.error ? <StateRing state="unknown" size={16} glyphOnly label="Offline" /> : <StateRing state="onchain" size={16} glyphOnly label="Live" />}
                {status.error ? "Last read" : "Live, read"} {formatTime(status.at, { seconds: true, date: false })} HKT
              </span>
            ) : null}
            {!motionOff && model ? (
              <button type="button" onClick={replay} className="inline-flex h-8 items-center rounded-control px-2 text-12 text-fg-2 hover:bg-bg-3 hover:text-fg-0">
                Replay payments
              </button>
            ) : null}
            <MotionToggle />
          </div>
        </div>

        {stats ? (
          <dl className="m-0 mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line-2 pt-4 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="grid min-w-0 gap-0.5">
                <dt className="truncate text-12 text-fg-muted">{s.label}</dt>
                <dd className="m-0 font-mono text-18 text-fg-0 tabular">{s.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className="yl-container">
        <ErrorLine error={q.error} />
        {q.error && !snap ? (
          <button type="button" onClick={() => q.refetch()} className="mt-3 inline-flex h-8 items-center rounded-control border border-line-3 px-3 text-13 text-fg-1 hover:bg-bg-2">
            Try again
          </button>
        ) : null}
        {q.loading && !snap ? <Loading rows={8} label="Reading the city from the agent service" /> : null}

        {model ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-labelledby="city-map-title" className="grid min-w-0 content-start gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="city-map-title" className="m-0 text-15 font-semibold text-fg-0">
                  The map
                </h2>
                <Segmented
                  label="Show payments"
                  size="sm"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "settled", label: <FilterLabel state="settled" /> },
                    { value: "awaiting", label: <FilterLabel state="awaiting" /> },
                    { value: "refused", label: <FilterLabel state="refused" /> },
                  ]}
                />
              </div>
              <div ref={wrapRef} className="min-w-0">
                {layout ? (
                  <CityMap
                    model={model}
                    layout={layout}
                    filter={filter}
                    selected={selected && exists(selected) ? selected : null}
                    onSelect={select}
                    motion={!motionOff}
                    pulses={pulses}
                    sample={isSample}
                  />
                ) : (
                  <div className="h-[640px] rounded-sheet border border-line-2 bg-bg-1" aria-hidden="true" />
                )}
              </div>
              <Legend />
            </section>

            <aside aria-labelledby="city-inspector" className="grid min-w-0 content-start gap-6 lg:sticky lg:top-[calc(var(--nav-h)+16px)] lg:max-h-[calc(100dvh-var(--nav-h)-32px)] lg:overflow-y-auto">
              <section className="grid gap-3 rounded-sheet border border-line-2 bg-bg-1 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="city-inspector" className="m-0 text-15 font-semibold text-fg-0">
                    Inspector
                  </h2>
                  {selected ? (
                    <button type="button" onClick={() => setSelected(null)} className="inline-flex h-7 items-center rounded-control px-2 text-12 text-fg-2 hover:bg-bg-3 hover:text-fg-0">
                      Clear
                    </button>
                  ) : null}
                </div>
                <div aria-live="polite">
                  {selected && exists(selected) ? (
                    <Details model={model} id={selected} merged={layout ? layout.mode !== "wide" : false} />
                  ) : (
                    <p className="m-0 text-13 text-fg-muted">Select a principal, an agent, a payee or a payment glyph on the map to see its passport, mandate and receipts.</p>
                  )}
                </div>
                {trail.filter((id) => id !== selected && exists(id)).length ? (
                  <div className="grid gap-2 border-t border-line-1 pt-3">
                    <h3 className="eyebrow m-0 text-fg-muted">Inspected</h3>
                    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {trail
                        .filter((id) => id !== selected && exists(id))
                        .map((id) => (
                          <li key={id} className="min-w-0">
                            <button
                              type="button"
                              onClick={() => select(id)}
                              className="inline-flex h-7 max-w-[16rem] items-center rounded-pill border border-line-3 px-2.5 text-12 text-fg-1 hover:bg-bg-3"
                            >
                              <span className="truncate">{itemTitle(model, id)}</span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </section>

              <section aria-labelledby="city-feed" className="grid gap-2">
                <h2 id="city-feed" className="m-0 text-15 font-semibold text-fg-0">
                  Latest receipts
                </h2>
                <ul className="m-0 grid list-none p-0">
                  {model.receipts.slice(0, 8).map((r) => {
                    const s = stateOf(r)!;
                    const edge = model.edgeOfReceipt.get(r.receiptId);
                    return (
                      <li key={r.receiptId} className={cn("border-t border-line-1", fresh.has(r.receiptId) && styles.fresh)}>
                        <button
                          type="button"
                          onClick={() => edge && select(edge)}
                          className="grid w-full min-w-0 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2.5 py-2 text-left hover:bg-bg-2"
                        >
                          <StateGlyph state={s} size={16} className="mt-0.5" />
                          <span className="grid min-w-0 gap-0.5">
                            <span className="truncate text-13 text-fg-1">{r.summary}</span>
                            <span className="truncate text-11 text-fg-muted">
                              {STATE_WORD[s]}
                              {r.revertError ? ` · ${r.revertError}` : ""} · {LEDGER_SHORT[r.ledger]}
                              {fresh.has(r.receiptId) ? " · new" : ""}
                            </span>
                          </span>
                          <span className="font-mono text-11 text-fg-muted">{formatTime(r.timestamp, { date: false })}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </aside>
          </div>
        ) : null}
      </div>

      {model ? <Tables model={model} onSelect={select} /> : null}

      <p className="yl-container pb-10 text-12 text-fg-muted">
        All names on this map are fictional demo principals and services. The FISCO chain is run by the team; anchoring proves consistency between ledgers, not
        consensus. All third-party marks are the property of their respective owners.
      </p>
    </div>
  );
}

function FilterLabel({ state }: { state: EdgeState }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StateGlyph state={state} size={12} />
      {STATE_WORD[state]}
    </span>
  );
}

function summary(m: CityModel) {
  const groups = m.groups.length;
  const passports = new Set<string>();
  for (const g of m.groups) {
    const a = m.nodes.get(g.agent);
    if (a?.kind === "agent") for (const p of a.principals) passports.add(`${p.agent.agentId}:${p.agent.wallet.toLowerCase()}`);
  }
  const anchored = m.batches.reduce((n, b) => n + b.count, 0);
  return [
    { label: "Principals on the map", value: String(groups - (m.groups.some((g) => g.kind === "visitors") ? 1 : 0) + m.visitorCount) },
    { label: "Agent passports", value: String(passports.size) },
    { label: "Receipts on the map", value: String(m.receipts.length) },
    { label: "Receipts anchored", value: m.batchesReadable ? `${anchored} in ${m.batches.length}` : "not readable" },
  ];
}

function Legend() {
  const items: { glyph: React.ReactNode; word: string }[] = [
    { glyph: <NodeGlyphIcon glyph="attested" size={16} />, word: GLYPH_WORD.attested },
    { glyph: <NodeGlyphIcon glyph="self-registered" size={16} />, word: GLYPH_WORD["self-registered"] },
    { glyph: <NodeGlyphIcon glyph="payee" size={16} />, word: GLYPH_WORD.payee },
    { glyph: <NodeGlyphIcon glyph="unverified" size={16} />, word: GLYPH_WORD.unverified },
    { glyph: <LineSample stroke="var(--fg-2)" glyph={<StateGlyph state="settled" />} />, word: "Settled" },
    { glyph: <LineSample stroke="var(--brass)" dash="5 4" glyph={<StateGlyph state="awaiting" />} />, word: "Waiting for a person" },
    { glyph: <LineSample stroke="var(--line-3)" ring />, word: "Refused at the payee's ring" },
    { glyph: <LineSample stroke="var(--chrome-1)" />, word: "Sealed mandate" },
    { glyph: <NodeGlyphIcon glyph="anchor" size={16} />, word: "Anchor and regulator (ledger facts)" },
  ];
  return (
    <dl className="m-0 flex flex-wrap gap-x-5 gap-y-2 text-12 text-fg-muted">
      {items.map((i) => (
        <div key={i.word} className="flex items-center gap-2">
          <dt className="inline-flex items-center" aria-hidden="true">
            {i.glyph}
          </dt>
          <dd className="m-0">{i.word}</dd>
        </div>
      ))}
    </dl>
  );
}

function LineSample({ stroke, dash, glyph, ring }: { stroke: string; dash?: string; glyph?: React.ReactNode; ring?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true">
        <path d={ring ? "M1 7H17" : "M1 7H27"} stroke={stroke} strokeWidth="1.5" strokeDasharray={dash} fill="none" strokeLinecap="round" />
        {ring ? (
          <g transform="translate(22 7)">
            <circle r="5" fill="var(--bg-0)" stroke="var(--fg-1)" strokeWidth="1.3" />
            <path d="M-3.4 3.4L3.4 -3.4" stroke="var(--fg-1)" strokeWidth="1.3" strokeLinecap="round" />
          </g>
        ) : null}
      </svg>
      {glyph}
    </span>
  );
}

function Tables({ model, onSelect }: { model: CityModel; onSelect: (id: string) => void }) {
  const pays = model.edges
    .filter((e) => e.kind === "payment" && e.receipts.length)
    .sort((a, b) => Date.parse(b.receipts[0]!.timestamp) - Date.parse(a.receipts[0]!.timestamp));
  const owner = (agentId: string) => {
    const n = model.nodes.get(agentId);
    if (n?.kind !== "agent") return { agent: n?.title ?? agentId, owner: "" };
    const g = model.groups.find((x) => x.id === n.group)!;
    return { agent: n.title, owner: model.nodes.get(g.principal)!.title };
  };
  return (
    <div className="yl-container mt-12 grid gap-12 pb-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section aria-labelledby="city-pay" className="grid min-w-0 content-start gap-3">
        <h2 id="city-pay" className="m-0 text-15 font-semibold text-fg-0">
          Payments on the map
        </h2>
        <p className="m-0 text-12 text-fg-muted">One row per agent, payee and outcome, the same edges as the map. Newest first.</p>
        <div className="-mx-1 overflow-x-auto px-1" tabIndex={0} role="region" aria-label="Payments table (scrolls sideways on small screens)">
          <table className="yl-table min-w-[620px]">
            <caption className="sr-only">Every payment edge drawn on the map</caption>
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Payee</th>
                <th scope="col">Outcome</th>
                <th scope="col" className="text-right">
                  Receipts
                </th>
                <th scope="col" className="text-right">
                  Latest amount
                </th>
                <th scope="col">Latest</th>
              </tr>
            </thead>
            <tbody>
              {pays.map((e) => {
                const last = e.receipts[0]!;
                const href = explorerTxUrl(last.ledger, last.txHash, last.explorerUrl);
                return (
                  <tr key={e.id}>
                    <td className="min-w-[9rem]">
                      <span className="block text-fg-1">{owner(e.from).agent}</span>
                      <span className="block text-11 text-fg-muted">{owner(e.from).owner}</span>
                    </td>
                    <td className="min-w-[8rem]">
                      <button type="button" onClick={() => onSelect(e.id)} className="text-left text-fg-1 underline decoration-line-3 underline-offset-4 hover:decoration-fg-2">
                        {model.nodes.get(e.to)?.title ?? e.to}
                      </button>
                    </td>
                    <td>
                      {e.state === "settled" ? (
                        <StateRing state="verified" label="Settled" />
                      ) : e.state === "awaiting" ? (
                        <StateRing state="waiting" label="Needs a person" />
                      ) : (
                        <StateRing state="refused" label="Refused" error={last.revertError ?? undefined} />
                      )}
                    </td>
                    <td className="num text-fg-1">{e.receipts.length}</td>
                    <td className="num text-fg-1">{last.amount ? formatAmount(last.amount) : "-"}</td>
                    <td className="whitespace-nowrap">
                      {last.txHash && href ? (
                        <a href={href} className="font-mono text-12 text-steel underline decoration-steel/50 underline-offset-2 hover:decoration-steel">
                          {shortHash(last.txHash)}
                        </a>
                      ) : (
                        <span className="text-12 text-fg-muted">No transaction</span>
                      )}
                      <span className="ml-2 font-mono text-11 text-fg-muted">{formatTime(last.timestamp, { date: false })}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="city-anchor" className="grid min-w-0 content-start gap-3">
        <h2 id="city-anchor" className="m-0 text-15 font-semibold text-fg-0">
          Anchors across the seam
        </h2>
        {model.batches.length === 0 ? (
          <p className="m-0 text-13 text-fg-muted">{model.batchesReadable ? "No anchor batch yet." : "The anchoring relayer's batch list could not be read from this page."}</p>
        ) : null}
        <ul className="m-0 grid list-none gap-0 p-0">
          {model.batches.slice(0, 8).map((b) => (
            <li key={b.batchId} className="grid gap-1.5 border-t border-line-2 py-3 text-13">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-fg-1">
                  Batch {b.batchId} · {b.count} receipts
                </span>
                <span className="font-mono text-11 text-fg-muted">{formatTime(b.createdAt)} HKT</span>
              </span>
              <span className="font-mono text-12 break-all text-fg-muted">root {b.root}</span>
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                {b.anchors.map((a) => (
                  <StateRing key={a.ledger} state="onchain" label={LEDGER_SHORT[a.ledger]} hash={a.txHash} href={explorerTxUrl(a.ledger, a.txHash)} />
                ))}
                {b.crossAnchors.map((c) => (
                  <span key={`${c.onLedger}-${c.remoteLedger}`} className="text-12 text-fg-muted">
                    Cross-anchored {LEDGER_SHORT[c.remoteLedger]} root on {LEDGER_SHORT[c.onLedger]}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 flex flex-wrap items-center gap-2 text-12 text-fg-muted">
          <LabelChip>Test units</LabelChip> Receipts are batched by the anchoring relayer and each root is written to AccountabilityLedger.
        </p>
      </section>
    </div>
  );
}
