"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@yinglong/ui";
import type { Ledger } from "@/lib/api/view";
import { Details, itemTitle } from "./details";
import { GLYPH_WORD, NodeGlyphIcon, STATE_WORD, StateCountsInline, StateGlyph } from "./glyphs";
import { pathD, type Box, type Layout } from "./layout";
import { neighbourhood, type AgentNode, type CityEdge, type CityModel, type CityNode, type EdgeState, type Rail } from "./model";
import styles from "./city.module.css";

export type Filter = "all" | EdgeState;

export interface Pulse {
  edgeId: string;
  state: EdgeState;
}
export interface PulseBatch {
  seq: number;
  receipts: Pulse[];
  /** Anchoring batches: the ledgers each new batch was anchored on. */
  anchors: Ledger[][];
}

const RAIL_TITLE: Record<Rail, { place: string; rail: string; note: string }> = {
  fisco: {
    place: "Shenzhen",
    rail: "Coin-free rail",
    note: "No value moves on chain: pre-authorised conditional payment instructions to an e-CNY-style simulator. Not the PBoC sandbox.",
  },
  hk: {
    place: "Hong Kong",
    rail: "HK test rail",
    note: "Test units. Simulation of a regulated instrument; not issued by any licensee.",
  },
};

const MIN_K = 0.6;
const MAX_K = 2.4;

interface View {
  k: number;
  x: number;
  y: number;
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function CityMap({
  model,
  layout,
  filter,
  selected,
  onSelect,
  motion,
  pulses,
  sample,
}: {
  model: CityModel;
  layout: Layout;
  filter: Filter;
  selected: string | null;
  onSelect: (id: string | null) => void;
  motion: boolean;
  pulses: PulseBatch | null;
  sample: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ k: 1, x: 0, y: 0 });
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{ id: string; via: "pointer" | "focus" } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const merged = layout.mode !== "wide";
  const narrow = layout.mode === "narrow";

  /* ---------------- focusable items (roving tab stop) */
  const edgeById = useMemo(() => new Map(model.edges.map((e) => [e.id, e])), [model]);
  const visibleEdge = useCallback((e: CityEdge) => filter === "all" || e.kind !== "payment" || e.state === filter, [filter]);
  const items = useMemo(() => {
    const out: { id: string; box: Box }[] = layout.drawn.map((id) => ({ id, box: layout.boxes.get(id)! }));
    for (const g of layout.edges.values()) {
      const e = edgeById.get(g.id);
      if (g.pill && e && visibleEdge(e)) out.push({ id: g.id, box: g.pill });
    }
    return out;
  }, [layout, edgeById, visibleEdge]);
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const tabStop = active && itemIds.has(active) ? active : (items[0]?.id ?? null);

  /* ---------------- highlight */
  const focusId = hover?.id ?? selected;
  const lit = useMemo(() => {
    if (!focusId) return null;
    const set = neighbourhood(model, focusId);
    // In merged modes the household chip stands for the principal and the agent.
    if (merged) {
      for (const g of model.groups) if (set.has(g.principal) || set.has(g.agent)) set.add(g.agent).add(g.principal);
    }
    return set;
  }, [model, focusId, merged]);
  const dim = (id: string) => (lit ? !lit.has(id) : false);

  /* ---------------- pan and zoom */
  const clamp = useCallback(
    (v: View): View => {
      const fw = frameRef.current?.clientWidth ?? layout.width;
      const fh = layout.height;
      const w = layout.width * v.k;
      const h = layout.height * v.k;
      const cx = (lo: number, hi: number, val: number) => Math.min(hi, Math.max(lo, val));
      const x = w <= fw ? (fw - w) / 2 : cx(fw - w - 24, 24, v.x);
      const y = h <= fh ? (fh - h) / 2 : cx(fh - h - 24, 24, v.y);
      return { k: v.k, x, y };
    },
    [layout],
  );
  const apply = useCallback(
    (v: View, commit: boolean, animate = false) => {
      const c = clamp(v);
      viewRef.current = c;
      const el = worldRef.current;
      if (el) {
        el.style.transition = animate && motion ? "transform 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))" : "none";
        el.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.k})`;
      }
      if (commit) setView(c);
    },
    [clamp, motion],
  );
  // A new width resets to the fitted view; new data keeps the reader's zoom and pan (re-clamped).
  useEffect(() => apply({ k: 1, x: 0, y: 0 }, true), [layout.width]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => apply(viewRef.current, true), [layout, apply]);

  const zoomAt = useCallback(
    (factor: number, fx?: number, fy?: number, animate = false) => {
      const v = viewRef.current;
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      const frame = frameRef.current;
      const px = fx ?? (frame ? frame.clientWidth / 2 : 0);
      const py = fy ?? layout.height / 2;
      const wx = (px - v.x) / v.k;
      const wy = (py - v.y) / v.k;
      apply({ k, x: px - wx * k, y: py - wy * k }, true, animate);
    },
    [apply, layout.height],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // Pinch on a trackpad (ctrl + wheel) zooms the map; a plain wheel always scrolls the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = frame.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; dist?: number; k?: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button,a")) return;
    if (e.pointerType === "touch" && viewRef.current.k <= 1 && pointers.current.size === 0 && !e.isPrimary) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch" && pointers.current.size === 1 && viewRef.current.k <= 1) return; // page scroll
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    if (pts.length === 2) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      drag.current = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2, vx: v.x, vy: v.y, dist: d, k: v.k };
    } else {
      drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y };
    }
    setPanning(true);
    setHover(null);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && d.dist && d.k) {
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const r = frameRef.current!.getBoundingClientRect();
      const mx = (pts[0]!.x + pts[1]!.x) / 2 - r.left;
      const my = (pts[0]!.y + pts[1]!.y) / 2 - r.top;
      const k = Math.min(MAX_K, Math.max(MIN_K, (d.k * dist) / d.dist));
      const wx = (d.x - r.left - d.vx) / d.k;
      const wy = (d.y - r.top - d.vy) / d.k;
      apply({ k, x: mx - wx * k, y: my - wy * k }, false);
    } else {
      apply({ k: viewRef.current.k, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }, false);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 && drag.current) {
      drag.current = null;
      setPanning(false);
      setView(viewRef.current);
    }
  };

  /* ---------------- keyboard */
  const ensureVisible = useCallback(
    (b: Box) => {
      const v = viewRef.current;
      const fw = frameRef.current?.clientWidth ?? layout.width;
      const fh = layout.height;
      let { x, y } = v;
      const x0 = x + b.x * v.k;
      const y0 = y + b.y * v.k;
      const x1 = x0 + b.w * v.k;
      const y1 = y0 + b.h * v.k;
      if (x0 < 12) x += 12 - x0;
      else if (x1 > fw - 12) x -= x1 - (fw - 12);
      if (y0 < 12) y += 12 - y0;
      else if (y1 > fh - 12) y -= y1 - (fh - 12);
      if (x !== v.x || y !== v.y) apply({ k: v.k, x, y }, true, true);
    },
    [apply, layout],
  );
  const focusItem = (id: string) => {
    setActive(id);
    const el = worldRef.current?.querySelector<HTMLElement>(`[data-city-item="${CSS.escape(id)}"]`);
    el?.focus({ preventScroll: true });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-city-item]")?.dataset.cityItem;
    if (e.key === "Escape") {
      setHover(null);
      onSelect(null);
      return;
    }
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomAt(1.25, undefined, undefined, true);
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomAt(0.8, undefined, undefined, true);
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      apply({ k: 1, x: 0, y: 0 }, true, true);
      return;
    }
    if (!id) return;
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key] as [number, number] | undefined;
    if (dir) {
      e.preventDefault();
      const from = items.find((i) => i.id === id);
      if (!from) return;
      const fc = { x: from.box.x + from.box.w / 2, y: from.box.y + from.box.h / 2 };
      let best: { id: string; s: number } | null = null;
      for (const it of items) {
        if (it.id === id) continue;
        const dx = it.box.x + it.box.w / 2 - fc.x;
        const dy = it.box.y + it.box.h / 2 - fc.y;
        const along = dx * dir[0] + dy * dir[1];
        if (along <= 4) continue;
        const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
        const s = along + across * 2.2;
        if (!best || s < best.s) best = { id: it.id, s };
      }
      if (best) focusItem(best.id);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const it = e.key === "Home" ? items[0] : items.at(-1);
      if (it) focusItem(it.id);
    }
  };

  /* ---------------- hover card */
  const openHover = (id: string, via: "pointer" | "focus") => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setHover({ id, via });
  };
  const closeHoverSoon = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHover(null), 160);
  };
  useEffect(() => () => void (closeTimer.current && window.clearTimeout(closeTimer.current)), []);
  // On phones there is no hover: the card follows the selection.
  const cardId = panning ? null : (hover?.id ?? (narrow ? selected : null));
  const cardBox = cardId ? (layout.boxes.get(cardId) ?? layout.edges.get(cardId)?.pill ?? null) : null;
  const [cardPos, setCardPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!cardId || !cardBox) {
      setCardPos(null);
      return;
    }
    const fw = frameRef.current?.clientWidth ?? layout.width;
    const fh = layout.height;
    const v = view;
    const bx = v.x + cardBox.x * v.k;
    const by = v.y + cardBox.y * v.k;
    const bw = cardBox.w * v.k;
    const bh = cardBox.h * v.k;
    const width = Math.min(320, fw - 16);
    const h = cardRef.current?.offsetHeight ?? 240;
    let left: number;
    let top: number;
    if (bx + bw + 10 + width <= fw - 8) {
      left = bx + bw + 10;
      top = by;
    } else if (bx - 10 - width >= 8) {
      left = bx - 10 - width;
      top = by;
    } else {
      left = Math.min(fw - width - 8, Math.max(8, bx + bw / 2 - width / 2));
      top = by + bh + 10 + h <= fh - 8 ? by + bh + 10 : by - 10 - h;
    }
    top = Math.min(fh - h - 8, Math.max(8, top));
    setCardPos({ left, top, width });
  }, [cardId, cardBox, view, layout]);

  /* ---------------- packets */
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const played = useRef(0);
  useEffect(() => {
    if (!pulses || !motion || played.current === pulses.seq) return;
    played.current = pulses.seq;
    const jobs: { path: SVGPathElement; from: number; to: number; start: number; tone: string; hold: number }[] = [];
    const now = performance.now();
    let i = 0;
    for (const p of pulses.receipts.slice(-8)) {
      const path = pathRefs.current.get(p.edgeId);
      const g = layout.edges.get(p.edgeId);
      if (!path || !g) continue;
      jobs.push({ path, from: 0, to: g.stop, start: now + i * 180, tone: p.state, hold: p.state === "settled" ? 0 : 500 });
      i++;
    }
    const anchorPath = pathRefs.current.get("anchor:seam");
    if (anchorPath) {
      for (const ledgers of pulses.anchors.slice(-3)) {
        // The anchor link runs from the Shenzhen anchor (0) to the HK-side anchor (1): one pulse each way.
        if (ledgers.includes("fisco")) jobs.push({ path: anchorPath, from: 0.5, to: 0, start: now + i * 180, tone: "anchor", hold: 0 });
        if (ledgers.includes("base-sepolia")) jobs.push({ path: anchorPath, from: 0.5, to: 1, start: now + i * 180, tone: "anchor", hold: 0 });
        i++;
      }
    }
    if (!jobs.length) return;
    const DUR = 1100;
    let raf = 0;
    const dots = dotRefs.current;
    const tick = (t: number) => {
      let alive = false;
      jobs.forEach((j, k) => {
        const dot = dots[k % dots.length];
        if (!dot) return;
        const local = (t - j.start) / DUR;
        if (local < 0) {
          alive = true;
          return;
        }
        const end = 1 + j.hold / DUR;
        if (local > end + 0.2) {
          dot.setAttribute("opacity", "0");
          return;
        }
        alive = true;
        const e = easeInOut(Math.min(1, local));
        const len = j.path.getTotalLength();
        const pt = j.path.getPointAtLength(len * (j.from + (j.to - j.from) * e));
        dot.setAttribute("cx", String(pt.x));
        dot.setAttribute("cy", String(pt.y));
        dot.setAttribute("data-tone", j.tone);
        dot.setAttribute("opacity", local > end ? String(Math.max(0, 1 - (local - end) / 0.2)) : "1");
      });
      if (alive) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      dots.forEach((d) => d?.setAttribute("opacity", "0"));
    };
  }, [pulses, motion, layout]);

  /* ---------------- render */
  const chip = (id: string) => {
    const n = model.nodes.get(id)!;
    const b = layout.boxes.get(id)!;
    const group = n.kind === "agent" ? model.groups.find((g) => g.id === n.group) : undefined;
    const owner = group && merged ? model.nodes.get(group.principal)! : null;
    const isSel = selected === id || (merged && group && selected === group.principal);
    const ledgerish = n.kind === "regulator" || n.kind === "anchor";
    const label = chipLabel(model, n, merged);
    return (
      <button
        key={id}
        type="button"
        data-city-item={id}
        tabIndex={tabStop === id ? 0 : -1}
        aria-label={label}
        title={owner ? `${owner.title} · agent ${n.title}` : n.subtitle ? `${n.title} · ${n.subtitle}` : n.title}
        aria-pressed={Boolean(isSel)}
        onClick={() => onSelect(id)}
        onFocus={() => {
          setActive(id);
          openHover(id, "focus");
          ensureVisible(b);
        }}
        onBlur={(e) => {
          if (!cardRef.current?.contains(e.relatedTarget as Node)) closeHoverSoon();
        }}
        onPointerEnter={(e) => e.pointerType !== "touch" && openHover(id, "pointer")}
        onPointerLeave={(e) => e.pointerType !== "touch" && closeHoverSoon()}
        className={cn(
          styles.item,
          "absolute flex items-center text-left",
          narrow ? "gap-2 px-2" : "gap-2.5 px-2.5",
          ledgerish ? "rounded-[4px] border" : "rounded-card border",
          n.kind === "anchor" && n.glyph === "anchor" ? "border-steel/60 bg-steel-tint" : ledgerish ? "border-line-3 bg-bg-3" : "border-line-2 bg-bg-2",
          n.kind === "counterparty" && n.glyph === "unverified" && "border-dashed border-line-3 bg-bg-1",
          isSel && "border-fg-1",
          dim(id) && styles.dim,
        )}
        style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
      >
        <NodeGlyphIcon glyph={owner ? owner.glyph : n.glyph} size={narrow ? 16 : 20} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={cn(narrow ? "line-clamp-2 text-12 leading-[15px] font-medium break-words" : "truncate text-13 leading-4 font-medium", n.kind === "counterparty" && n.glyph === "unverified" ? "text-fg-2" : "text-fg-0")}>
            {owner ? owner.title : n.title}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-11 leading-4 text-fg-muted">
            {owner ? (
              <>
                <NodeGlyphIcon glyph={n.glyph} size={14} />
                <span className="truncate">{n.title}</span>
              </>
            ) : n.kind === "counterparty" ? (
              <>
                <StateCountsInline counts={n.counts} className="shrink-0" />
                <span className="truncate">{n.subtitle}</span>
              </>
            ) : (
              <span className="truncate">{n.subtitle}</span>
            )}
          </span>
        </span>
      </button>
    );
  };

  const edgeStroke = (e: CityEdge) => {
    if (e.kind === "mandate") return { stroke: e.mandate === "live" ? "var(--chrome-1)" : "var(--fg-muted)", dash: e.mandate === "live" ? undefined : "3 4", width: 1.5 };
    if (e.kind === "identity") return { stroke: "var(--fg-2)", dash: "2 4", width: 1.25 };
    if (e.kind === "anchor" || e.kind === "observe") return { stroke: "var(--steel)", dash: e.kind === "observe" ? "2 3" : "4 4", width: 1.25 };
    if (e.state === "awaiting") return { stroke: "var(--brass)", dash: "5 4", width: 1.4 };
    if (e.state === "refused") return { stroke: "var(--line-3)", dash: undefined, width: 1.4 };
    return { stroke: "var(--fg-2)", dash: undefined, width: 1.4 };
  };

  return (
    <div className="relative">
      <div
        ref={frameRef}
        role="group"
        aria-roledescription="map"
        aria-label={`Agent City map${sample ? " (sample data)" : ""}. Shenzhen plane above the seam, Hong Kong plane below it.`}
        aria-describedby="city-map-help"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn("relative overflow-hidden rounded-sheet border border-line-2 bg-bg-0", view.k > 1 ? "cursor-grab touch-none" : "touch-pan-y", panning && "cursor-grabbing")}
        style={{ height: layout.height }}
      >
        <p id="city-map-help" className="sr-only">
          Use the arrow keys to move between principals, agents, payees and payments, Enter to inspect one, Escape to clear, plus and minus to zoom.
        </p>
        <div ref={worldRef} className="absolute top-0 left-0 origin-top-left" style={{ width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} className="absolute inset-0" aria-hidden="true" focusable="false">
            {(["fisco", "hk"] as const).map((rail) => {
              const p = layout.planes[rail];
              return <rect key={rail} x={p.x + 0.5} y={p.y + 0.5} width={p.w - 1} height={p.h - 1} rx="13" fill="var(--bg-1)" stroke="var(--line-2)" />;
            })}
            <line x1={0} x2={layout.width} y1={layout.seam.y + layout.seam.h / 2} y2={layout.seam.y + layout.seam.h / 2} stroke="var(--line-3)" strokeDasharray="2 5" />
            {model.edges.map((e) => {
              const g = layout.edges.get(e.id);
              if (!g) return null;
              const st = edgeStroke(e);
              const hidden = !visibleEdge(e);
              return (
                <g key={e.id} className={cn(styles.edge, (dim(e.id) || hidden) && styles.dim, hidden && styles.hidden)}>
                  <path
                    ref={(el) => {
                      if (el) pathRefs.current.set(e.id, el);
                      else pathRefs.current.delete(e.id);
                    }}
                    d={pathD(g.curve)}
                    fill="none"
                    stroke={st.stroke}
                    strokeWidth={lit?.has(e.id) ? st.width + 0.6 : st.width}
                    strokeDasharray={st.dash}
                    strokeLinecap="round"
                  />
                  {g.ring ? (
                    <g transform={`translate(${g.ring.x} ${g.ring.y})`}>
                      <circle r="6" fill="var(--bg-1)" stroke="var(--fg-1)" strokeWidth="1.4" />
                      <path d="M-4 4L4 -4" stroke="var(--fg-1)" strokeWidth="1.4" strokeLinecap="round" />
                    </g>
                  ) : null}
                </g>
              );
            })}
            {Array.from({ length: 12 }, (_, i) => (
              <circle
                key={i}
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
                r="3.5"
                opacity="0"
                className={styles.packet}
              />
            ))}
          </svg>

          {(["fisco", "hk"] as const).map((rail) => {
            const h = layout.planeHeaders[rail];
            const info = model.rails[rail];
            const t = RAIL_TITLE[rail];
            return (
              <div key={rail} data-city-label="plane" className="absolute grid content-start gap-1" style={{ left: h.x, top: h.y, width: h.w, height: h.h }}>
                <div className="flex min-w-0 items-baseline gap-x-3 overflow-hidden whitespace-nowrap">
                  <span className="eyebrow shrink-0 bg-bg-1 text-fg-2">{t.place}</span>
                  <span className="shrink-0 bg-bg-1 text-13 font-semibold text-fg-0">{t.rail}</span>
                  <span className="min-w-0 truncate bg-bg-1 text-11 text-fg-muted">
                    {info.ledgers.length ? `on ${info.ledgers.map((l) => l.badge).join(", ")}` : "no principal on this rail yet"}
                  </span>
                </div>
                <p className="m-0 max-w-full justify-self-start truncate bg-bg-1 text-11 text-fg-muted" title={t.note}>
                  {t.note}
                </p>
              </div>
            );
          })}
          {layout.colHeaders.map((c) => (
            <span key={`${c.rail}-${c.col}`} data-city-label="column" aria-hidden="true" className="absolute truncate bg-bg-1 pr-1 text-11 leading-4 text-fg-muted" style={{ left: c.box.x, top: c.box.y, maxWidth: c.box.w }}>
              {c.label}
            </span>
          ))}
          {layout.seamLabel ? (
            <span
              data-city-label="seam"
              aria-hidden="true"
              className="eyebrow absolute truncate bg-bg-0 px-2 text-center leading-[18px] text-fg-muted"
              style={{ left: layout.seamLabel.x, top: layout.seamLabel.y, maxWidth: layout.seamLabel.w }}
            >
              Boundary · anchors cross here
            </span>
          ) : null}
          {[...layout.edges.values()]
            .filter((g) => g.chip)
            .map((g) => (
              <span
                key={`chip-${g.id}`}
                data-city-label="crossing"
                aria-hidden="true"
                className="absolute inline-flex items-center justify-center truncate rounded-pill border border-line-3 bg-bg-0 px-2 text-11 text-fg-2"
                style={{ left: g.chip!.x, top: g.chip!.y, width: g.chip!.w, height: g.chip!.h }}
              >
                Same passport
              </span>
            ))}

          {layout.drawn.map(chip)}

          {[...layout.edges.values()].map((g) => {
            const e = edgeById.get(g.id);
            if (!g.pill || !e || !visibleEdge(e)) return null;
            const isSel = selected === e.id;
            const mandate = e.kind === "mandate";
            return (
              <button
                key={`pill-${g.id}`}
                type="button"
                data-city-item={e.id}
                tabIndex={tabStop === e.id ? 0 : -1}
                aria-label={edgeLabel(model, e)}
                aria-pressed={isSel}
                onClick={() => onSelect(e.id)}
                onFocus={() => {
                  setActive(e.id);
                  openHover(e.id, "focus");
                  ensureVisible(g.pill!);
                }}
                onBlur={(ev) => {
                  if (!cardRef.current?.contains(ev.relatedTarget as Node)) closeHoverSoon();
                }}
                onPointerEnter={(ev) => ev.pointerType !== "touch" && openHover(e.id, "pointer")}
                onPointerLeave={(ev) => ev.pointerType !== "touch" && closeHoverSoon()}
                className={cn(
                  styles.item,
                  "absolute inline-flex items-center justify-center gap-1 rounded-pill border font-mono text-11 leading-none",
                  e.kind === "payment" && e.state === "refused"
                    ? "border-refused-bg bg-refused-bg text-refused-fg"
                    : e.kind === "payment" && e.state === "awaiting"
                      ? "border-brass/70 bg-brass-tint text-brass"
                      : "border-line-3 bg-bg-1 text-fg-1",
                  isSel && "outline-2 outline-offset-1 outline-fg-1",
                  dim(e.id) && styles.dim,
                )}
                style={{ left: g.pill.x, top: g.pill.y, width: g.pill.w, height: g.pill.h }}
              >
                {mandate ? (
                  <MandateGlyph status={e.mandate ?? "none"} />
                ) : (
                  <>
                    <StateGlyph state={e.state} size={12} />
                    {e.receipts.length}
                  </>
                )}
              </button>
            );
          })}
        </div>

        {cardId && cardPos ? (
          <div
            ref={cardRef}
            className={cn(styles.card, "absolute z-10 max-h-[min(420px,calc(100%-16px))] overflow-y-auto rounded-card border border-line-3 bg-bg-2 p-4")}
            style={{ left: cardPos.left, top: cardPos.top, width: cardPos.width }}
            onPointerEnter={() => closeTimer.current && window.clearTimeout(closeTimer.current)}
            onPointerLeave={() => hover?.via === "pointer" && closeHoverSoon()}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) closeHoverSoon();
            }}
          >
            {narrow ? (
              <button
                type="button"
                onClick={() => {
                  setHover(null);
                  onSelect(null);
                }}
                className="absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-control text-fg-2 hover:bg-bg-3 hover:text-fg-0"
                aria-label="Close details"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
            <div className={narrow ? "pr-8" : undefined}>
              <Details model={model} id={cardId} compact merged={merged} />
            </div>
            {!narrow ? <p className="m-0 mt-3 border-t border-line-1 pt-2 text-11 text-fg-muted">Select to pin it in the inspector.</p> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-11 text-fg-muted">
          {itemIds.size} elements · arrow keys move, Enter inspects{view.k !== 1 ? ` · zoom ${Math.round(view.k * 100)}%` : ""}
        </p>
        <div className="inline-flex items-center rounded-control border border-line-3 p-0.5" role="group" aria-label="Zoom">
          <ZoomButton label="Zoom out" onClick={() => zoomAt(0.8, undefined, undefined, true)} disabled={view.k <= MIN_K + 0.001}>
            <path d="M4 8h8" />
          </ZoomButton>
          <button
            type="button"
            onClick={() => apply({ k: 1, x: 0, y: 0 }, true, true)}
            className="inline-flex h-7 items-center rounded-[4px] px-2 text-12 text-fg-2 hover:bg-bg-3 hover:text-fg-0"
          >
            Fit
          </button>
          <ZoomButton label="Zoom in" onClick={() => zoomAt(1.25, undefined, undefined, true)} disabled={view.k >= MAX_K - 0.001}>
            <path d="M4 8h8M8 4v8" />
          </ZoomButton>
        </div>
      </div>
    </div>
  );
}

function ZoomButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex size-7 items-center justify-center rounded-[4px] text-fg-2 hover:bg-bg-3 hover:text-fg-0 disabled:opacity-45"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {children}
      </svg>
    </button>
  );
}

function MandateGlyph({ status }: { status: NonNullable<CityEdge["mandate"]> }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className={status === "live" ? "text-chrome-1" : "text-fg-muted"}>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray={status === "live" ? undefined : "3 3"} />
      {status === "live" ? <circle cx="12" cy="4" r="2.4" fill="currentColor" /> : null}
    </svg>
  );
}

function chipLabel(model: CityModel, n: CityNode, merged: boolean): string {
  const counts = (c: { settled: number; awaiting: number; refused: number }) =>
    [c.settled && `${c.settled} settled`, c.awaiting && `${c.awaiting} need a person`, c.refused && `${c.refused} refused`].filter(Boolean).join(", ");
  switch (n.kind) {
    case "principal":
      return `${n.title}, ${n.subtitle}`;
    case "agent": {
      const g = model.groups.find((x) => x.id === n.group)!;
      const owner = model.nodes.get(g.principal)!;
      const base = merged ? `${owner.title}, agent ${n.title}` : `Agent ${n.title} of ${owner.title}`;
      const c = counts(n.counts);
      return `${base}. ${GLYPH_WORD[n.glyph]}.${c ? ` Receipts: ${c}.` : ""}${(n as AgentNode).sharedWith.length ? " Same passport on another mandate." : ""}`;
    }
    case "counterparty": {
      const c = counts(n.counts);
      return `${n.title}${n.subtitle ? ` (${n.subtitle})` : ""}. ${GLYPH_WORD[n.glyph]}.${c ? ` Receipts: ${c}.` : ""}`;
    }
    case "regulator":
      return `Regulator node, ${n.subtitle}`;
    case "anchor":
      return `${n.title}, ${n.subtitle}`;
  }
}

function edgeLabel(model: CityModel, e: CityEdge): string {
  const name = itemTitle(model, e.id);
  if (e.kind === "mandate") return `${name}: ${e.mandate === "live" ? "sealed" : (e.mandate ?? "none")}, ${e.receipts.length} control receipts`;
  const last = e.receipts[0];
  return `${name}: ${e.receipts.length} ${STATE_WORD[e.state].toLowerCase()}${last?.revertError ? `, latest ${last.revertError}` : ""}`;
}

