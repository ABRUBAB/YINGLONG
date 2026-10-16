"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { cn, LiveStatusO, SampleDataChip, shortHash } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import { formatTime } from "@/lib/format";
import type { Receipt } from "@/lib/api/view";
import { ButtonLink, ArrowIcon } from "@/components/ui/button";
import { Mark } from "@/components/brand/mark";
import { MotionToggle, useMotionOff } from "@/components/preferences";
import { eventsFrom, remainingShare, sampleBench, scaleState, SLOT_COUNT } from "./hero-data";
import type { ScaleState } from "@/components/three/receipt-dragon";

// The 3D chunk loads only after first paint, and never under reduced motion, Save-Data,
// low device memory or without WebGL2 (the WebP poster stays).
const ReceiptDragon = dynamic(() => import("@/components/three/receipt-dragon"), { ssr: false, loading: () => null });

function webgl2(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

function canRender3D(motionOff: boolean): boolean {
  if (motionOff) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) return false;
  return webgl2();
}

function useAfterLoad(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const go = () => {
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idle(() => !cancelled && setReady(true), { timeout: 1500 });
      else setTimeout(() => !cancelled && setReady(true), 300);
    };
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", go);
    };
  }, []);
  return ready;
}

export function Hero({ poster = false }: { poster?: boolean }) {
  const motionOff = useMotionOff();
  const afterLoad = useAfterLoad();
  const [webglOk, setWebglOk] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const [eventIndex, setEventIndex] = useState(-1);
  const [hover, setHover] = useState<{ r: Receipt | null; x: number; y: number; bench: boolean } | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => setWebglOk(poster || canRender3D(motionOff)), [motionOff, poster]);

  const receiptsQ = useAgent("hero-receipts", (api) => api.receipts({ limit: SLOT_COUNT }), ["receipts"]);
  const budgetsQ = useAgent("budgets", (api) => api.budgets(), ["budgets", "receipts"]);
  const receipts = receiptsQ.data?.items ?? [];
  const scales: ScaleState[] = useMemo(() => {
    const own = receipts.map(scaleState);
    return isSample ? [...own, ...sampleBench(SLOT_COUNT - own.length)] : own;
  }, [receipts]);
  const events = useMemo(() => (poster ? [] : eventsFrom(receipts)), [receipts, poster]);
  const remaining = useMemo(() => remainingShare(budgetsQ.data ?? []), [budgetsQ.data]);
  const latest = receipts[0];
  const show3D = webglOk && (afterLoad || poster);

  return (
    <section data-surface="obsidian" aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-bg-0 text-fg-1">
      <div className="mx-auto grid w-full max-w-[1320px] gap-0 px-4 sm:px-6 lg:min-h-[min(calc(100dvh-64px),900px)] lg:grid-cols-12 lg:px-8">
        <div className={cn("relative z-10 order-2 flex flex-col justify-center pt-2 pb-14 lg:order-1 lg:col-span-7 lg:py-20", poster && "invisible")}>
          <p className="eyebrow m-0 text-fg-muted">Personal Agent Identity &amp; Mandated Finance</p>
          <h1 id="hero-title" className="type-display m-0 mt-5 text-[2.5rem] leading-[1.02] text-fg-0 sm:text-h1 xl:text-[4.6rem]">
            <span className="block">Always with you.</span>
            <span className="block text-fg-2">Never beyond your mandate.</span>
          </h1>
          <p className="m-0 mt-6 max-w-[34rem] text-15 leading-relaxed text-fg-2 sm:text-18 sm:leading-[1.55]">
            An AI agent that acts on your money only as you, only inside the mandate you sealed, and always with a receipt.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/app" size="lg">
              Open Nadia&apos;s console <ArrowIcon />
            </ButtonLink>
            <ButtonLink href="/start" variant="secondary" size="lg">
              Try it with your own passkey
            </ButtonLink>
            <ButtonLink href="/proof" variant="quiet" size="lg">
              Read the proof
            </ButtonLink>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-1 pt-5 text-13 text-fg-muted">
            <LiveStatusO state={eventIndex >= 0 ? "acting" : "active"} size={20} showWord className="text-fg-1" />
            {latest ? (
              <span>
                Last receipt {formatTime(latest.timestamp, { date: false })} HKT{" "}
                <span className="font-mono text-fg-2">{shortHash(latest.receiptId, 6, 4)}</span>
                {latest.ledgerBadge ? <span className="text-fg-muted"> · {latest.ledgerBadge}</span> : null}
              </span>
            ) : null}
            {isSample ? <SampleDataChip /> : null}
          </div>
        </div>

        <div className="relative order-1 lg:order-2 lg:col-span-5">
          <div className="relative mx-auto aspect-square w-[min(100%,560px)] lg:absolute lg:top-1/2 lg:right-[-3.5rem] lg:w-[min(50vw,720px)] lg:-translate-y-1/2">
            {/* Poster first: the WebP is the LCP-safe frame; the canvas fades in over it. */}
            {!posterFailed ? (
              <picture>
                <source media="(min-width: 1024px)" srcSet="/posters/dragon-1440.webp" />
                <source media="(min-width: 640px)" srcSet="/posters/dragon-768.webp" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/posters/dragon-375.webp"
                  alt=""
                  aria-hidden="true"
                  width={780}
                  height={780}
                  fetchPriority="high"
                  decoding="async"
                  onError={() => setPosterFailed(true)}
                  className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500", drawn && "opacity-0", poster && "hidden")}
                />
              </picture>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-fg-1" aria-hidden="true">
                <Mark size={420} decorative className="w-[72%]" />
              </div>
            )}
            {show3D ? (
              <div className={cn("absolute inset-0 transition-opacity duration-700", drawn ? "opacity-100" : "opacity-0")} data-hero-canvas>
                <ReceiptDragon
                  scales={scales}
                  remaining={remaining}
                  events={events}
                  playKey={playKey}
                  poster={poster}
                  motion={!motionOff && !poster}
                  onFirstFrame={() => {
                    setDrawn(true);
                    if (poster) (window as Window & { __posterReady?: boolean }).__posterReady = true;
                  }}
                  onEvent={setEventIndex}
                  onHover={(i, x, y) => {
                    if (i === null) return setHover(null);
                    setHover({ r: receipts[i] ?? null, x, y, bench: i >= receipts.length });
                  }}
                />
              </div>
            ) : null}
            {hover ? (
              <div
                role="tooltip"
                className="pointer-events-none fixed z-40 w-64 rounded-card border border-line-2 bg-bg-2 px-3 py-2.5 text-12"
                style={{ left: Math.min(hover.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1200) - 280), top: hover.y + 16 }}
              >
                {hover.r ? (
                  <>
                    <p className="m-0 font-medium text-fg-0">{hover.r.summary}</p>
                    <p className="m-0 mt-1 text-fg-muted">
                      {formatTime(hover.r.timestamp)} · {hover.r.tier === "ASK" ? "T?" : hover.r.tier} · {hover.r.ledgerBadge ?? hover.r.ledger}
                    </p>
                    <p className="m-0 mt-1 font-mono text-fg-2">{shortHash(hover.r.receiptId, 10, 6)}</p>
                  </>
                ) : (
                  <p className="m-0 text-fg-2">{hover.bench ? "Sample bench receipt (Anvil fork), not a live transaction." : "Slot for a future receipt."}</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {!poster ? (
        <div className="relative z-10 mx-auto flex w-full max-w-[1320px] flex-wrap items-end justify-between gap-x-8 gap-y-3 px-4 pb-8 sm:px-6 lg:px-8">
          <dl className="m-0 grid gap-x-8 gap-y-1.5 text-12 text-fg-muted sm:grid-cols-3">
            <div className="flex gap-2">
              <dt className="font-medium text-fg-2">Scales</dt>
              <dd className="m-0">receipts: chrome confirmed, graphite refused, grey pending</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-fg-2">Ring</dt>
              <dd className="m-0">the sealed mandate; bright arc = budget left</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-fg-2">Pearl</dt>
              <dd className="m-0">the agent&apos;s on-chain identity</dd>
            </div>
          </dl>
          <div className="flex items-center gap-2 text-12 text-fg-muted">
            <span aria-live="polite" className="min-h-4 font-mono text-fg-2">
              {eventIndex >= 0 ? events[eventIndex]?.label : ""}
            </span>
            {isSample ? <span>Sample receipts (bench)</span> : null}
            {show3D && events.length ? (
              <button
                type="button"
                onClick={() => setPlayKey((k) => k + 1)}
                className="inline-flex h-8 items-center rounded-control px-2 text-12 text-fg-2 hover:bg-bg-3 hover:text-fg-0"
              >
                Replay events
              </button>
            ) : null}
            <MotionToggle />
          </div>
        </div>
      ) : null}
      <p className="sr-only">
        The illustration shows the YINGLONG dragon inside a ring. Each scale on its body is one accountability receipt; the ring is the sealed mandate;
        the pearl on the ring is the agent&apos;s on-chain identity.
      </p>
    </section>
  );
}
