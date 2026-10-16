import type { AgentNode, CityEdge, CityModel, CityNode, PrincipalGroup, Rail } from "./model";

/**
 * Deterministic, collision-free layout for Agent City (no force simulation, so the map never jumps).
 *
 * Geography: the Shenzhen plane (coin-free FISCO rail) is north, the Hong Kong plane (HK test rail) is
 * south, the seam between them is the boundary where anchors cross. Inside each plane, columns read
 * left to right: principal -> agent -> payee or counterparty -> ledger. Every element is a fixed-size
 * box in a column; columns never overlap horizontally and boxes in a column are swept apart
 * vertically, so no two labels can overlap. Edge glyphs are placed along their curves at the first
 * position that clears every box and every other glyph, or not at all (the counterparty box still
 * carries the same counts).
 */
export type Mode = "wide" | "compact" | "narrow";
type Col = "P" | "A" | "H" | "C" | "L";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** Cubic Bezier p0 c1 c2 p1. */
export type Bezier = [Pt, Pt, Pt, Pt];

export interface EdgeGeom {
  id: string;
  /** The drawn curve (for refused payments, it stops at the refusing ring). */
  curve: Bezier;
  /** Where a packet stops along `curve` (1 = arrives). */
  stop: number;
  ring: Pt | null;
  pill: Box | null;
  /** Chip placed where the edge crosses the seam. */
  chip: Box | null;
}

export interface Layout {
  mode: Mode;
  width: number;
  height: number;
  /** Node id -> box. In compact and narrow modes the principal shares its agent's box (one household chip). */
  boxes: Map<string, Box>;
  /** Ids actually drawn as chips. */
  drawn: string[];
  planes: Record<Rail, Box>;
  planeHeaders: Record<Rail, Box>;
  colHeaders: { rail: Rail; col: Col; label: string; box: Box }[];
  seam: Box;
  seamLabel: Box | null;
  edges: Map<string, EdgeGeom>;
}

const PLANE_HEADER_H = 58;
const COL_HEADER_H = 22;
const SEAM_H = 64;
const PILL_H = 20;

interface ModeSpec {
  mode: Mode;
  nodeH: number;
  /** Share of leftover width that widens the columns (the rest widens the gaps). */
  grow: number;
  pad: number;
  gap: number;
  cols: { key: Col; w: number; label: string }[];
  /** Minimum gap after each column but the last. */
  gaps: number[];
  /** How leftover width is shared among the gaps. */
  share: number[];
}

function spec(width: number): ModeSpec {
  if (width >= 860)
    return {
      mode: "wide",
      nodeH: 48,
      grow: 0.4,
      pad: 20,
      gap: 12,
      cols: [
        { key: "P", w: 156, label: "Principals" },
        { key: "A", w: 164, label: "Agents" },
        { key: "C", w: 192, label: "Payees and counterparties" },
        { key: "L", w: 164, label: "Ledger" },
      ],
      gaps: [44, 128, 40],
      share: [0.12, 0.66, 0.22],
    };
  if (width >= 600)
    return {
      mode: "compact",
      nodeH: 48,
      grow: 0.3,
      pad: 16,
      gap: 12,
      cols: [
        { key: "H", w: 188, label: "Principals and agents" },
        { key: "C", w: 180, label: "Counterparties" },
        { key: "L", w: 160, label: "Ledger" },
      ],
      gaps: [92, 24],
      share: [0.75, 0.25],
    };
  const pad = 12;
  const gap = Math.round(Math.min(64, Math.max(36, width * 0.12)));
  const w = Math.floor((width - pad * 2 - gap) / 2);
  return {
    mode: "narrow",
    nodeH: 58,
    grow: 0,
    pad,
    gap: 10,
    cols: [
      { key: "H", w, label: "Principals and agents" },
      { key: "C", w, label: "Counterparties and ledger" },
    ],
    gaps: [gap],
    share: [1],
  };
}

/** Column x positions for a width. */
function columns(width: number, spec0: ModeSpec): Map<Col, { x: number; w: number; label: string }> {
  let s = spec0;
  const colSum = s.cols.reduce((n, c) => n + c.w, 0);
  const fixed = colSum + s.gaps.reduce((n, g) => n + g, 0);
  const deficit = fixed - (width - s.pad * 2);
  // Too narrow for the preferred widths: shrink the columns (never the gaps the edges need).
  const shrink = deficit > 0 ? deficit / colSum : 0;
  if (shrink > 0) s = { ...s, cols: s.cols.map((c) => ({ ...c, w: Math.floor(c.w * (1 - shrink)) })) };
  const left = Math.max(0, width - s.pad * 2 - fixed);
  const extraCol = Math.floor((left * s.grow) / s.cols.length);
  const gapLeft = left * (1 - s.grow);
  const out = new Map<Col, { x: number; w: number; label: string }>();
  let x = s.pad;
  s.cols.forEach((c, i) => {
    const w = Math.min(c.w + extraCol, c.w + 72);
    out.set(c.key, { x, w, label: c.label });
    x += w + (i < s.gaps.length ? s.gaps[i]! + gapLeft * s.share[i]! + (c.w + extraCol - w) : 0);
  });
  return out;
}

/* ------------------------------------------------------------------ geometry helpers */

export function bez(c: Bezier, t: number): Pt {
  const u = 1 - t;
  const [p0, p1, p2, p3] = c;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** The part of the curve from 0 to t (de Casteljau). */
export function splitAt(c: Bezier, t: number): Bezier {
  const lerp = (a: Pt, b: Pt): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const [p0, p1, p2, p3] = c;
  const a = lerp(p0, p1);
  const b = lerp(p1, p2);
  const cc = lerp(p2, p3);
  const d = lerp(a, b);
  const e = lerp(b, cc);
  return [p0, a, d, lerp(d, e)];
}

export function pathD(c: Bezier): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  const [p0, p1, p2, p3] = c;
  return `M${f(p0.x)} ${f(p0.y)}C${f(p1.x)} ${f(p1.y)} ${f(p2.x)} ${f(p2.y)} ${f(p3.x)} ${f(p3.y)}`;
}

export function overlaps(a: Box, b: Box, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function inside(a: Box, b: Box): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

const horizontal = (p0: Pt, p1: Pt): Bezier => {
  const dx = Math.max(24, (p1.x - p0.x) * 0.5);
  return [p0, { x: p0.x + dx, y: p0.y }, { x: p1.x - dx, y: p1.y }, p1];
};
const vertical = (p0: Pt, p1: Pt): Bezier => {
  const dy = (p1.y - p0.y) * 0.4;
  return [p0, { x: p0.x, y: p0.y + dy }, { x: p1.x, y: p1.y - dy }, p1];
};

/** t at which a left-to-right curve reaches x (curves here are monotonic in x). */
function tAtX(c: Bezier, x: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bez(c, mid).x < x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function pillWidth(count: number): number {
  return 28 + String(count).length * 7;
}

/* ------------------------------------------------------------------ layout */

export function layoutCity(model: CityModel, width: number): Layout {
  const s = spec(width);
  const cols = columns(width, s);
  const merged = s.mode !== "wide";
  const boxes = new Map<string, Box>();
  const drawn: string[] = [];
  const colHeaders: Layout["colHeaders"] = [];
  const planes = {} as Record<Rail, Box>;
  const planeHeaders = {} as Record<Rail, Box>;
  const NODE_H = s.nodeH;
  const step = NODE_H + s.gap;

  const colOf = (n: CityNode): Col => {
    if (n.kind === "principal") return merged ? "H" : "P";
    if (n.kind === "agent") return merged ? "H" : "A";
    if (n.kind === "counterparty") return "C";
    return s.mode === "narrow" ? "C" : "L";
  };

  const edgesTo = (id: string) => model.edges.filter((e) => e.kind === "payment" && e.to === id);

  let y = 0;
  for (const rail of ["fisco", "hk"] as const) {
    const top = y;
    const y0 = top + PLANE_HEADER_H + COL_HEADER_H + 8;
    const groups = model.groups.filter((g) => g.rail === rail);
    const gIndex = new Map(groups.map((g, i) => [g.agent, i]));

    // Counterparties, ordered by the barycentre of the groups that pay or list them.
    const cps = [...model.nodes.values()].filter((n) => n.kind === "counterparty" && n.rail === rail);
    const bary = new Map<string, number>();
    for (const c of cps) {
      let wsum = 0;
      let isum = 0;
      for (const e of edgesTo(c.id)) {
        const i = gIndex.get(e.from);
        if (i === undefined) continue;
        wsum += e.receipts.length;
        isum += e.receipts.length * i;
      }
      if (c.kind === "counterparty")
        for (const pid of c.listedBy) {
          const g = groups.find((x) => (model.nodes.get(x.agent) as AgentNode).principals.some((p) => p.id === pid));
          if (!g) continue;
          wsum += 0.5;
          isum += 0.5 * gIndex.get(g.agent)!;
        }
      bary.set(c.id, wsum ? isum / wsum : rail === "fisco" ? -1 : groups.length + 1);
    }
    cps.sort((a, b) => bary.get(a.id)! - bary.get(b.id)! || b.receipts.length - a.receipts.length || a.title.localeCompare(b.title));

    const ledgerTop = rail === "fisco" ? ["regulator"] : ["anchor:base-sepolia"];
    const ledgerBottom = rail === "fisco" ? ["anchor:fisco"] : [];
    const cItems = s.mode === "narrow" ? [...ledgerTop, ...cps.map((c) => c.id), ...ledgerBottom] : cps.map((c) => c.id);
    const cx = cols.get("C")!;
    cItems.forEach((id, i) => boxes.set(id, { x: cx.x, y: y0 + i * step, w: cx.w, h: NODE_H }));
    let bottom = y0 + Math.max(1, cItems.length) * step - s.gap;

    // Groups: aim at the middle of what they pay, then sweep apart in order.
    let prev = y0 - step;
    const targets = groups.map((g, i) => {
      let wsum = 0;
      let ysum = 0;
      for (const e of model.edges) {
        if (e.kind !== "payment" || e.from !== g.agent) continue;
        const b = boxes.get(e.to);
        if (!b || model.nodes.get(e.to)?.rail !== rail) continue;
        wsum += e.receipts.length;
        ysum += e.receipts.length * b.y;
      }
      return wsum ? ysum / wsum : y0 + i * step;
    });
    const placeGroup = (g: PrincipalGroup, gy: number) => {
      if (merged) {
        const hx = cols.get("H")!;
        const b = { x: hx.x, y: gy, w: hx.w, h: NODE_H };
        boxes.set(g.agent, b);
        boxes.set(g.principal, b);
        drawn.push(g.agent);
      } else {
        const px = cols.get("P")!;
        const ax = cols.get("A")!;
        boxes.set(g.principal, { x: px.x, y: gy, w: px.w, h: NODE_H });
        boxes.set(g.agent, { x: ax.x, y: gy, w: ax.w, h: NODE_H });
        drawn.push(g.principal, g.agent);
      }
    };
    const ys: number[] = [];
    groups.forEach((g, i) => {
      const gy = Math.max(targets[i]!, prev + step, y0);
      ys.push(gy);
      prev = gy;
    });
    // Pull the stack up when it ends below the counterparties (keeps the plane compact).
    const overflow = (ys.at(-1) ?? 0) + NODE_H - bottom;
    if (overflow > 0) {
      for (let i = ys.length - 1; i >= 0; i--) {
        const limit = i === 0 ? y0 : ys[i - 1]! + step;
        const want = ys[i]! - overflow;
        ys[i] = Math.max(limit, want);
      }
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i]!, ys[i - 1]! + step);
    }
    groups.forEach((g, i) => placeGroup(g, ys[i]!));
    if (ys.length) bottom = Math.max(bottom, ys.at(-1)! + NODE_H);

    // Ledger column (wide, compact): regulator at the top of the Shenzhen plane with its anchor at the
    // seam edge; the HK anchor at the top of the HK plane, so the anchor link crosses the seam.
    if (s.mode !== "narrow") {
      const lx = cols.get("L")!;
      if (rail === "fisco") {
        bottom = Math.max(bottom, y0 + step * 2 + 24 + NODE_H);
        boxes.set("regulator", { x: lx.x, y: y0, w: lx.w, h: NODE_H });
        boxes.set("anchor:fisco", { x: lx.x, y: bottom - NODE_H, w: lx.w, h: NODE_H });
      } else {
        boxes.set("anchor:base-sepolia", { x: lx.x, y: y0, w: lx.w, h: NODE_H });
      }
    }
    for (const id of [...cItems, ...(s.mode === "narrow" ? [] : rail === "fisco" ? ["regulator", "anchor:fisco"] : ["anchor:base-sepolia"])]) drawn.push(id);

    const height = bottom + 18 - top;
    planes[rail] = { x: 0, y: top, w: width, h: height };
    planeHeaders[rail] = { x: s.pad, y: top + 12, w: width - s.pad * 2, h: PLANE_HEADER_H - 16 };
    for (const c of s.cols) {
      const cc = cols.get(c.key)!;
      colHeaders.push({ rail, col: c.key, label: c.label, box: { x: cc.x, y: top + PLANE_HEADER_H, w: cc.w, h: COL_HEADER_H - 4 } });
    }
    y = top + height + (rail === "fisco" ? SEAM_H : 0);
  }
  const seam: Box = { x: 0, y: planes.fisco.y + planes.fisco.h, w: width, h: SEAM_H };

  /* ---------------- edges */
  const edges = new Map<string, EdgeGeom>();
  const obstacles: Box[] = [];
  for (const id of drawn) obstacles.push(boxes.get(id)!);
  for (const rail of ["fisco", "hk"] as const) obstacles.push(planeHeaders[rail]);
  for (const h of colHeaders) obstacles.push(h.box);

  // Ports: spread the edges leaving or entering one side of a box, ordered by the far end.
  const portOffsets = new Map<string, number>();
  const NODE_SPAN = NODE_H;
  const spread = (key: (e: CityEdge) => string | null, other: (e: CityEdge) => string, prefix: string) => {
    const bySide = new Map<string, CityEdge[]>();
    for (const e of model.edges) {
      const k = key(e);
      if (!k) continue;
      const list = bySide.get(k) ?? [];
      list.push(e);
      bySide.set(k, list);
    }
    for (const list of bySide.values()) {
      const order = ["settled", "awaiting", "refused"];
      list.sort((a, b) => (boxes.get(other(a))?.y ?? 0) - (boxes.get(other(b))?.y ?? 0) || order.indexOf(a.state) - order.indexOf(b.state));
      const k = list.length;
      const span = Math.min(NODE_SPAN - 18, (k - 1) * 6);
      list.forEach((e, i) => portOffsets.set(`${prefix}:${e.id}`, k === 1 ? 0 : -span / 2 + (span * i) / (k - 1)));
    }
  };
  const isPay = (e: CityEdge) => e.kind === "payment" && boxes.has(e.from) && boxes.has(e.to);
  spread((e) => (isPay(e) ? e.from : null), (e) => e.to, "out");
  spread((e) => (isPay(e) ? e.to : null), (e) => e.from, "in");

  const rings: Box[] = [];
  const pending: { e: CityEdge; g: EdgeGeom; full: Bezier }[] = [];
  for (const e of model.edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) continue;
    if (e.kind === "payment") {
      const p0 = { x: a.x + a.w, y: a.y + a.h / 2 + (portOffsets.get(`out:${e.id}`) ?? 0) };
      const p1 = { x: b.x, y: b.y + b.h / 2 + (portOffsets.get(`in:${e.id}`) ?? 0) };
      const full = p1.x > p0.x + 8 ? horizontal(p0, p1) : vertical({ x: a.x + a.w / 2, y: a.y + a.h }, { x: b.x + b.w / 2, y: b.y });
      const g: EdgeGeom = { id: e.id, curve: full, stop: 1, ring: null, pill: null, chip: null };
      if (e.state === "refused" && p1.x > p0.x + 40) {
        const t = tAtX(full, p1.x - 16);
        g.curve = splitAt(full, t);
        g.ring = bez(full, t);
        rings.push({ x: g.ring.x - 7, y: g.ring.y - 7, w: 14, h: 14 });
      } else if (e.state === "awaiting") {
        g.stop = 0.74;
      }
      edges.set(e.id, g);
      pending.push({ e, g, full });
    } else if (e.kind === "mandate") {
      if (merged) continue;
      const p0 = { x: a.x + a.w, y: a.y + a.h / 2 };
      const p1 = { x: b.x, y: b.y + b.h / 2 };
      const g: EdgeGeom = { id: e.id, curve: horizontal(p0, p1), stop: 1, ring: null, pill: null, chip: null };
      edges.set(e.id, g);
      pending.push({ e, g, full: g.curve });
    } else if (e.kind === "identity" && e.rail === "seam") {
      const x = a.x + a.w / 2;
      const g: EdgeGeom = { id: e.id, curve: vertical({ x, y: a.y + a.h }, { x: b.x + b.w / 2, y: b.y }), stop: 1, ring: null, pill: null, chip: null };
      const w = 112;
      g.chip = { x: x - w / 2, y: seam.y + seam.h / 2 - 10, w, h: 20 };
      edges.set(e.id, g);
    } else if (e.kind === "anchor") {
      const x = a.x + a.w / 2;
      edges.set(e.id, { id: e.id, curve: vertical({ x, y: a.y + a.h }, { x: b.x + b.w / 2, y: b.y }), stop: 1, ring: null, pill: null, chip: null });
    } else if (e.kind === "observe" && s.mode !== "narrow") {
      const x = a.x + a.w / 2;
      edges.set(e.id, { id: e.id, curve: vertical({ x, y: a.y + a.h }, { x: b.x + b.w / 2, y: b.y }), stop: 1, ring: null, pill: null, chip: null });
    }
  }

  // Glyph pills (wide and compact): busiest edges first, first collision-free spot along the curve.
  if (s.mode !== "narrow") {
    const placed: Box[] = [];
    const ts = [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.2, 0.8, 0.14];
    pending.sort((x, z) => z.e.receipts.length - x.e.receipts.length || x.e.id.localeCompare(z.e.id));
    for (const { e, g } of pending) {
      const n = e.kind === "mandate" ? e.receipts.length : e.receipts.length;
      if (e.kind === "payment" && n === 0) continue;
      const w = e.kind === "mandate" ? 24 : pillWidth(n);
      const plane = planes[e.rail as Rail];
      if (!plane) continue;
      const area: Box = { x: plane.x + 2, y: plane.y + PLANE_HEADER_H + COL_HEADER_H, w: plane.w - 4, h: plane.h - PLANE_HEADER_H - COL_HEADER_H - 2 };
      for (const t of ts) {
        if (g.ring && t > 0.86) continue;
        const p = bez(g.curve, t);
        const box = { x: p.x - w / 2, y: p.y - PILL_H / 2, w, h: PILL_H };
        if (!inside(box, area)) continue;
        if (obstacles.some((o) => overlaps(box, o, 6))) continue;
        if (placed.some((o) => overlaps(box, o, 4))) continue;
        if (rings.some((o) => overlaps(box, o, 2))) continue;
        g.pill = box;
        placed.push(box);
        break;
      }
    }
  }

  // Seam label: the widest stretch of the seam no crossing uses.
  const crossings: [number, number][] = [];
  for (const g of edges.values()) {
    if (g.chip) crossings.push([g.chip.x - 8, g.chip.x + g.chip.w + 8]);
    else if (model.edges.find((e) => e.id === g.id)?.kind === "anchor") crossings.push([g.curve[0].x - 14, g.curve[0].x + 14]);
  }
  crossings.sort((p, q) => p[0] - q[0]);
  let best: [number, number] | null = null;
  let cursor = s.pad;
  for (const [x0, x1] of [...crossings, [width - s.pad, width] as [number, number]]) {
    if (x0 - cursor > (best ? best[1] - best[0] : 0)) best = [cursor, x0];
    cursor = Math.max(cursor, x1);
  }
  const seamLabel = best && best[1] - best[0] >= 64 ? { x: best[0], y: seam.y + seam.h / 2 - 9, w: Math.min(380, best[1] - best[0]), h: 18 } : null;

  return { mode: s.mode, width, height: planes.hk.y + planes.hk.h, boxes, drawn, planes, planeHeaders, colHeaders, seam, seamLabel, edges };
}
