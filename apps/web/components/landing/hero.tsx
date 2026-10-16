"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { cn, hashRingGeometry, LiveStatusO, SampleDataChip, shortHash } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { orbitLayout, orbitSummary, type OrbitSlot } from "@/lib/orbit-layout";
import type { Receipt } from "@/lib/api/view";
import { ArrowIcon, ButtonLink } from "@/components/ui/button";
import { PasskeyIcon } from "@/components/shell/site-nav";
import { MotionToggle, useMotionOff } from "@/components/preferences";
import { HERO_RECEIPTS, remainingShare, sampleBench } from "./hero-data";
import { OrbitSvg } from "./orbit-svg";

// The 3D and shader chunks load only after first paint and idle, and never under reduced motion,
// the Pause motion control, Save-Data, low device memory or without WebGL2 (the poster stays).
const MandateOrbit = dynamic(() => import("@/components/three/mandate-orbit"), { ssr: false, loading: () => null });
const Atmosphere = dynamic(() => import("./atmosphere"), { ssr: false, loading: () => null });

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

function useOnScreen<T extends Element>(ref: React.RefObject<T | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOn(Boolean(e?.isIntersecting)), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

const KIND_WORD: Record<OrbitSlot["kind"], string> = {
  inside: "Inside the mandate",
  waiting: "Waiting for you, at the boundary",
  asked: "Not sure, your call",
  refused: "Refused at the boundary",
};

export function Hero({ poster = false }: { poster?: boolean }) {
  const motionOff = useMotionOff();
  const afterLoad = useAfterLoad();
  const section = useRef<HTMLElement>(null);
  const onScreen = useOnScreen(section);
  const pointer = useRef({ x: 0, y: 0 });
  const [webglOk, setWebglOk] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  // The tooltip owns its state: pointer moves over coins re-render the tooltip only, never the hero.
  const tooltip = useRef<HoverApi | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const posterImg = useRef<HTMLImageElement>(null);
  // The image may fail before hydration attaches onError: check it once on mount.
  useEffect(() => {
    const img = posterImg.current;
    if (img && img.complete && img.naturalWidth === 0) setPosterFailed(true);
  }, []);

  useEffect(() => setWebglOk(poster || canRender3D(motionOff)), [motionOff, poster]);

  const receiptsQ = useAgent("hero-receipts", (api) => api.receipts({ limit: HERO_RECEIPTS }), ["receipts"]);
  const budgetsQ = useAgent("budgets", (api) => api.budgets(), ["budgets", "receipts"]);
  const mandatesQ = useAgent("mandates", (api) => api.mandates(), ["mandates"]);
  const receipts: Receipt[] = useMemo(() => receiptsQ.data?.items ?? [], [receiptsQ.data]);
  const shown = useMemo(() => (isSample ? [...receipts, ...sampleBench(Math.max(0, 120 - receipts.length))] : receipts), [receipts]);
  const slots = useMemo(() => orbitLayout(shown), [shown]);
  const summary = useMemo(() => orbitSummary(slots), [slots]);
  const remaining = useMemo(() => remainingShare(budgetsQ.data ?? []), [budgetsQ.data]);
  const liveMandate = mandatesQ.data?.find((m) => m.status === "live");
  const delegationHash = liveMandate?.delegationHash ?? receipts[0]?.delegationHash ?? null;
  const ticks = useMemo(() => {
    if (!delegationHash) return null;
    try {
      return hashRingGeometry(delegationHash).ticks.map((t) => t.r1 - t.r0);
    } catch {
      return null;
    }
  }, [delegationHash]);
  const latest = receipts[0];
  const show3D = webglOk && (afterLoad || poster);

  useEffect(() => {
    const el = section.current;
    if (!el || poster) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      pointer.current.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    };
    const leave = () => {
      pointer.current.x = 0;
      pointer.current.y = 0;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [poster]);

  const stage = (
    <div
      className={cn(
        "relative w-full",
        poster ? "aspect-[16/10]" : "yl-hero-stage",
      )}
    >
      {/* Poster first: the WebP is the LCP-safe frame; the canvas fades in over it. */}
      {!poster && !posterFailed ? (
        <picture>
          <source media="(min-width: 1024px)" srcSet="/posters/orbit-1440.webp" />
          <source media="(min-width: 640px)" srcSet="/posters/orbit-768.webp" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={posterImg}
            src="/posters/orbit-375.webp"
            alt=""
            aria-hidden="true"
            width={1600}
            height={1000}
            fetchPriority="high"
            decoding="async"
            onError={() => setPosterFailed(true)}
            className={cn("absolute inset-0 size-full object-contain transition-opacity duration-500 ease-[var(--ease-out)]", drawn && "opacity-0")}
          />
        </picture>
      ) : null}
      {!poster && posterFailed && !drawn ? (
        <div className="absolute inset-0">
          <OrbitSvg slots={slots} remaining={remaining} ticks={ticks} />
        </div>
      ) : null}
      {show3D ? (
        <div className={cn("absolute inset-0 transition-opacity duration-700 ease-[var(--ease-out)]", drawn ? "opacity-100" : "opacity-0")} data-hero-canvas>
          <MandateOrbit
            slots={slots}
            remaining={remaining}
            ticks={ticks}
            motion={!motionOff && !poster}
            active={onScreen || poster}
            playKey={playKey}
            pointer={pointer}
            poster={poster}
            onFirstFrame={() => {
              setDrawn(true);
              if (poster) (window as Window & { __posterReady?: boolean }).__posterReady = true;
            }}
            onHover={(slot, x, y) => tooltip.current?.show(slot, x, y)}
          />
        </div>
      ) : null}
    </div>
  );

  if (poster) {
    return (
      <section data-surface="obsidian" className="relative bg-bg-0 p-0" aria-label="Mandate Orbit poster">
        <div className="mx-auto w-full max-w-[1600px]">{stage}</div>
      </section>
    );
  }

  return (
    <section ref={section} data-surface="obsidian" aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-bg-0 text-fg-1">
      {afterLoad && webglOk ? (
        <div className="absolute inset-0 -z-10 opacity-90 [mask-image:radial-gradient(120%_90%_at_70%_45%,#000_30%,transparent_80%)]">
          <Atmosphere moving={!motionOff && onScreen} />
        </div>
      ) : null}

      {/* First screen, full bleed: the text block and the orbit, nothing else. */}
      <div className="yl-hero-grid relative">
        <div className="yl-hero-text relative z-10">
          <p className="yl-hero-in eyebrow m-0 flex items-center gap-3 text-fg-muted" style={{ ["--d" as string]: "0ms" }}>
            <span aria-hidden="true" className="h-px w-8 bg-line-3" />
            AI agents that pay for you, safely
          </p>
          <h1 id="hero-title" className="type-hero yl-hero-h1 m-0 mt-6 text-fg-0">
            <span className="yl-hero-line block" style={{ ["--d" as string]: "60ms" }}>
              Always with you.
            </span>
            <span className="yl-hero-line block text-fg-muted" style={{ ["--d" as string]: "140ms" }}>
              Never beyond your rules.
            </span>
          </h1>
          <p className="yl-hero-in yl-hero-lead m-0 mt-7 text-fg-2" style={{ ["--d" as string]: "220ms" }}>
            Let an AI agent pay for you, but only inside the spending rules you set. It cannot break them: the blockchain blocks anything
            outside your rules, and every payment leaves a receipt anyone can check.
          </p>
          <div className="yl-hero-in mt-9 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "280ms" }}>
            <ButtonLink href="/start" size="lg">
              <PasskeyIcon size={16} />
              Create your agent
            </ButtonLink>
            <ButtonLink href="/app" variant="secondary" size="lg">
              See a demo <ArrowIcon />
            </ButtonLink>
            <ButtonLink href="/proof" variant="quiet" size="lg" className="ml-1">
              Check the proof
            </ButtonLink>
          </div>
        </div>
        {/* The orbit column: the canvas fills it; the scene frames itself to the box. */}
        <div className="yl-hero-orbit" data-hero-orbit>
          {stage}
        </div>
      </div>

      {/* Below the first screen: what the orbit counts, what each object means, and the visible
          pause for the looping scene. */}
      <div className="relative z-10 border-t border-line-1">
        <div className="yl-container grid gap-8 py-10 lg:grid-cols-12 lg:gap-x-10">
          <div className="grid content-start gap-5 lg:col-span-6">
            <p className="eyebrow m-0 text-fg-muted">What the ring shows (live)</p>
            <dl className="m-0 grid grid-cols-3 gap-x-6">
              <HeroStat label="Payments made inside the rules" value={summary.inside + summary.asked + summary.waiting} />
              <HeroStat label="Attempts blocked" value={summary.refused} />
              <HeroStat label="Budget left today" value={Math.round(remaining * 100)} suffix="%" />
            </dl>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-12 text-fg-muted">
              <LiveStatusO state="active" size={18} showWord className="text-fg-1" />
              {latest ? (
                <span>
                  Last receipt {formatTime(latest.timestamp, { date: false })} HKT <span className="font-mono text-fg-2">{shortHash(latest.receiptId, 6, 4)}</span>
                  {latest.ledgerBadge ? <span> · {latest.ledgerBadge}</span> : null}
                </span>
              ) : (
                <span>Reading GET /v1/receipts</span>
              )}
              {isSample ? <SampleDataChip /> : null}
            </div>
          </div>
          <div className="grid content-start gap-5 lg:col-span-6">
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 text-12 text-fg-muted sm:grid-cols-2">
              <Key glyph={<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />} term="Ring" desc="the sealed mandate; bright arc = budget left" />
              <Key glyph={<ellipse cx="8" cy="8" rx="5" ry="2.6" fill="currentColor" />} term="Coins" desc="receipts; nearer the ring = more authority needed" />
              <Key glyph={<path d="M8 3l4 5-4 5-4-5z" fill="currentColor" opacity="0.6" />} term="Shards" desc="refused attempts; they never cross" />
              <Key glyph={<circle cx="8" cy="8" r="3.6" fill="var(--steel)" />} term="Pearl" desc="the agent's on-chain identity" />
            </dl>
            <div className="flex flex-wrap items-center gap-1 text-12 text-fg-muted">
              {show3D && !motionOff ? (
                <button
                  type="button"
                  onClick={() => setPlayKey((k) => k + 1)}
                  className="yl-press inline-flex h-8 items-center rounded-control px-2 text-12 text-fg-2 hover:bg-bg-3 hover:text-fg-0"
                >
                  Replay arrival
                </button>
              ) : null}
              <MotionToggle />
            </div>
          </div>
        </div>
      </div>

      <HoverCard apiRef={tooltip} receipts={receipts} />

      <p className="sr-only">
        The illustration shows the sealed mandate as a ring. Each coin inside it is one accountability receipt from the agent service, placed
        nearer the ring the more authority it needed; {summary.refused} refused attempts sit outside the ring and deflect off it. The pearl on
        the ring is the agent&apos;s on-chain identity, and the ticks around it are the live delegation hash.
      </p>
    </section>
  );
}

function HeroStat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="grid content-start gap-1.5">
      <dt className="order-2 text-12 leading-snug text-fg-muted">{label}</dt>
      <dd className="order-1 m-0 font-mono text-26 leading-none text-fg-0 sm:text-32">
        <NumberFlow value={value} suffix={suffix} />
      </dd>
    </div>
  );
}

function Key({ glyph, term, desc }: { glyph: React.ReactNode; term: string; desc: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <dt className="inline-flex items-center gap-2 font-medium text-fg-2">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="shrink-0 self-center text-fg-1">
          {glyph}
        </svg>
        {term}
      </dt>
      <dd className="m-0">{desc}</dd>
    </div>
  );
}

interface HoverApi {
  show: (slot: OrbitSlot | null, x: number, y: number) => void;
}

/**
 * The receipt under the pointer. It re-renders only when the hovered coin changes; while the pointer
 * moves over the same coin, its position is written straight to the element's transform.
 */
function HoverCard({ apiRef, receipts }: { apiRef: React.RefObject<HoverApi | null>; receipts: Receipt[] }) {
  const [slot, setSlot] = useState<OrbitSlot | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const place = () => {
    const node = el.current;
    if (!node) return;
    const x = Math.max(8, Math.min(pos.current.x + 16, window.innerWidth - node.offsetWidth - 8));
    const y = Math.min(pos.current.y + 16, window.innerHeight - node.offsetHeight - 8);
    node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  };
  useEffect(() => {
    apiRef.current = {
      show: (s, x, y) => {
        pos.current = { x, y };
        setSlot((prev) => (prev === s ? prev : s));
        place();
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);
  useEffect(() => {
    if (slot) place();
  }, [slot]);
  if (!slot) return null;
  const receipt = slot.index < receipts.length ? receipts[slot.index] : null;
  return (
    <div
      ref={el}
      role="tooltip"
      className="pointer-events-none fixed top-0 left-0 z-40 w-72 max-w-[calc(100vw-16px)] rounded-card border border-line-2 bg-bg-2 px-3.5 py-3 text-12"
    >
      <p className="eyebrow m-0 text-fg-muted">{KIND_WORD[slot.kind]}</p>
      {receipt ? (
        <>
          <p className="m-0 mt-1.5 text-13 font-medium text-fg-0">{receipt.summary}</p>
          <p className="m-0 mt-1 text-fg-muted">
            {formatTime(receipt.timestamp)} · {receipt.tier === "ASK" ? "T?" : receipt.tier}
            {receipt.revertError ? ` · ${receipt.revertError}` : ""}
          </p>
          <p className="m-0 mt-1 font-mono text-fg-2">{shortHash(receipt.receiptId, 10, 6)}</p>
          {receipt.ledgerBadge ? <p className="m-0 mt-1 text-fg-muted">{receipt.ledgerBadge}</p> : null}
        </>
      ) : (
        <p className="m-0 mt-1.5 text-fg-2">Sample bench receipt (fixtures), not a live transaction.</p>
      )}
    </div>
  );
}
