"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { CashForecast } from "@/lib/api/view";
import { formatDay, formatUnits } from "@/lib/format";

/** The chart draws at its real pixel width, so 11 px labels stay 11 px at every size. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** bigint position on [lo, hi] as a 0..1 fraction (pixels only; money stays bigint). */
function frac(v: bigint, lo: bigint, hi: bigint): number {
  if (hi <= lo) return 0.5;
  return Number(((v - lo) * 100_000n) / (hi - lo)) / 100_000;
}

function niceStep(range: bigint, ticks: number): bigint {
  const raw = range / BigInt(ticks);
  if (raw <= 0n) return 1n;
  const mag = 10n ** BigInt(raw.toString().length - 1);
  for (const m of [1n, 2n, 5n, 10n]) if (raw <= m * mag) return m * mag;
  return 10n * mag;
}

/**
 * The 30-day cash forecast as a calm line chart: the steel line is the projected balance (dashed where
 * it sits under the reserve floor), the floor is a hairline, the first breach is the one brass mark.
 * Day 0 is the posted balance read from the ledger. A slider (pointer or arrow keys) reads any day.
 */
export function ForecastChart({ f }: { f: CashForecast }) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [box, W] = useWidth<HTMLDivElement>(720);
  const H = W < 520 ? 210 : 260;
  const [day, setDay] = useState<number | null>(null);
  const geo = useMemo(() => {
    const bal = f.daily.map((d) => BigInt(d.balance));
    const floor = BigInt(f.reserveFloor.value);
    // Model bands arrive in whole units; convert to base units (money stays bigint).
    const toUnits = (v: number) => BigInt(Math.round(v * 10 ** Math.min(f.decimals, 6))) * 10n ** BigInt(Math.max(0, f.decimals - 6));
    const bands = (f.modelBands?.days ?? []).filter((d) => d.day <= f.horizonDays).map((d) => ({ day: d.day, lo: toUnits(d.q05), mid: toUnits(d.q50), hi: toUnits(d.q95) }));
    const all = [...bal, ...bands.flatMap((d) => [d.lo, d.hi])];
    let lo = all.reduce((a, b) => (b < a ? b : a), floor);
    let hi = all.reduce((a, b) => (b > a ? b : a), floor);
    const step = niceStep(hi - lo || 1n, 4);
    lo = (lo / step - (lo < 0n || lo % step !== 0n ? 1n : 0n)) * step;
    if (lo < 0n && bal.every((b) => b >= 0n)) lo = 0n;
    hi = (hi / step + 1n) * step;
    const ticks: bigint[] = [];
    for (let v = lo; v <= hi; v += step) ticks.push(v);
    const longest = Math.max(...ticks.map((t) => formatUnits(t, f.decimals, 0).length));
    const PAD = { l: 14 + longest * 7, r: 12, t: 18, b: 34 };
    const x = (d: number) => PAD.l + (d / Math.max(1, f.horizonDays)) * (W - PAD.l - PAD.r);
    const y = (v: bigint) => PAD.t + (1 - frac(v, lo, hi)) * (H - PAD.t - PAD.b);
    const pts = f.daily.map((d, i) => [x(d.day), y(bal[i]!)] as const);
    const path = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
    // The part of the line under the floor, drawn again dashed on top (line style carries the breach).
    const below: string[] = [];
    f.daily.forEach((d, i) => {
      if (!d.belowFloor) return;
      const prev = i > 0 ? pts[i - 1]! : pts[i]!;
      below.push(`M${prev[0].toFixed(1)} ${prev[1].toFixed(1)} L${pts[i]![0].toFixed(1)} ${pts[i]![1].toFixed(1)}`);
    });
    const every = W < 520 ? 10 : 7;
    const xTicks = [...Array.from({ length: Math.floor(f.horizonDays / every) + 1 }, (_, i) => i * every).filter((d) => f.horizonDays - d >= every / 2), f.horizonDays];
    const band = bands.length > 1 ? `M${bands.map((d) => `${x(d.day).toFixed(1)} ${y(d.hi).toFixed(1)}`).join(" L")} L${[...bands].reverse().map((d) => `${x(d.day).toFixed(1)} ${y(d.lo).toFixed(1)}`).join(" L")} Z` : "";
    const median = bands.length > 1 ? bands.map((d, i) => `${i ? "L" : "M"}${x(d.day).toFixed(1)} ${y(d.mid).toFixed(1)}`).join(" ") : "";
    return { x, y, path, below: below.join(" "), floorY: y(floor), ticks, xTicks, bal, PAD, band, median };
  }, [f, W, H]);
  const PAD = geo.PAD;

  const fd = (v: bigint | string) => formatUnits(v, f.decimals, 0);
  const sel = day !== null ? f.daily[day] : null;
  const breach = f.firstBreach;
  const paydays = f.events.filter((e) => e.kind === "payroll");

  function pick(e: PointerEvent<SVGSVGElement>) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const d = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * f.horizonDays);
    setDay(Math.max(0, Math.min(f.horizonDays, d)));
  }
  function key(e: KeyboardEvent) {
    const cur = day ?? 0;
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? cur + 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? cur - 1 : e.key === "Home" ? 0 : e.key === "End" ? f.horizonDays : null;
    if (next === null) return;
    e.preventDefault();
    setDay(Math.max(0, Math.min(f.horizonDays, next)));
  }

  const valueText = (d: number) => {
    const row = f.daily[d];
    if (!row) return "";
    const ev = f.events.filter((e) => e.day === d && e.kind !== "supplier run-rate").map((e) => e.label);
    return `Day ${d}, ${formatDay(row.date)}: projected balance ${fd(row.balance)} ${f.symbol}${row.belowFloor ? ", below the reserve floor" : ""}${ev.length ? `; ${ev.join("; ")}` : ""}`;
  };

  return (
    <div className="grid gap-3">
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label={`Projected balance by day, ${f.horizonDays}-day horizon`}
        aria-valuemin={0}
        aria-valuemax={f.horizonDays}
        aria-valuenow={day ?? 0}
        aria-valuetext={valueText(day ?? 0)}
        aria-describedby={`${id}-sum`}
        onKeyDown={key}
        onFocus={() => setDay((d) => d ?? 0)}
        className="relative rounded-control outline-offset-4"
      >
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y select-none"
          aria-hidden="true"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setDay(null)}
        >
          {/* Under the floor: one solid step of elevation, no transparency. */}
          <rect x={PAD.l} y={geo.floorY} width={W - PAD.l - PAD.r} height={Math.max(0, H - PAD.b - geo.floorY)} fill="var(--bg-2)" />
          {geo.ticks.map((t) => (
            <g key={t.toString()}>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--line-1)" strokeWidth="1" />
              <text x={PAD.l - 8} y={geo.y(t) + 4} textAnchor="end" fontSize="11" fill="var(--fg-muted)" style={{ fontFamily: "var(--font-mono)" }}>
                {fd(t)}
              </text>
            </g>
          ))}
          {geo.xTicks.map((d) => (
            <text key={d} x={geo.x(d)} y={H - PAD.b + 18} textAnchor={d === 0 ? "start" : d === f.horizonDays ? "end" : "middle"} fontSize="11" fill="var(--fg-muted)" style={{ fontFamily: "var(--font-mono)" }}>
              {d === 0 ? "today" : `day ${d}`}
            </text>
          ))}
          {/* Reserve floor */}
          <line x1={PAD.l} x2={W - PAD.r} y1={geo.floorY} y2={geo.floorY} stroke="var(--fg-2)" strokeWidth="1" strokeDasharray="6 4" />
          <text
            x={breach && breach.day > f.horizonDays * 0.5 ? PAD.l + 6 : W - PAD.r}
            y={geo.floorY - 6}
            textAnchor={breach && breach.day > f.horizonDays * 0.5 ? "start" : "end"}
            fontSize="11"
            fill="var(--fg-2)"
          >
            reserve floor {fd(f.reserveFloor.value)}
          </text>
          {/* Payroll days */}
          {paydays.map((e) => (
            <g key={`${e.day}-${e.label}`}>
              <line x1={geo.x(e.day)} x2={geo.x(e.day)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-2)" strokeWidth="1" />
              <text x={geo.x(e.day) + (e.day > f.horizonDays * 0.8 ? -4 : 4)} y={PAD.t + 10} textAnchor={e.day > f.horizonDays * 0.8 ? "end" : "start"} fontSize="11" fill="var(--fg-muted)">
                payroll
              </text>
            </g>
          ))}
          {/* Advisory model band (M5, 5th to 95th percentile): drawn under the deterministic line, which decides */}
          {geo.band ? <path d={geo.band} fill="var(--brass)" fillOpacity="0.14" stroke="none" /> : null}
          {geo.median ? <path d={geo.median} fill="none" stroke="var(--brass)" strokeWidth="1.25" strokeDasharray="4 4" /> : null}
          {/* Projected balance */}
          <path d={geo.path} pathLength={1} className="yl-draw" fill="none" stroke="var(--steel)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {geo.below ? <path d={geo.below} fill="none" stroke="var(--bg-1)" strokeWidth="2.5" /> : null}
          {geo.below ? <path d={geo.below} fill="none" stroke="var(--steel)" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" /> : null}
          {/* Day 0: the posted balance, read from the ledger */}
          <circle cx={geo.x(0)} cy={geo.y(geo.bal[0]!)} r="4" fill="var(--steel)" />
          {/* First breach: the only brass mark */}
          {breach ? (
            <g>
              <line x1={geo.x(breach.day)} x2={geo.x(breach.day)} y1={geo.floorY} y2={geo.y(BigInt(breach.balance))} stroke="var(--brass)" strokeWidth="1.5" />
              <circle cx={geo.x(breach.day)} cy={geo.y(BigInt(breach.balance))} r="5" fill="var(--bg-1)" stroke="var(--brass)" strokeWidth="2" />
              <circle cx={geo.x(breach.day)} cy={geo.y(BigInt(breach.balance))} r="1.8" fill="var(--brass)" />
              <text
                x={geo.x(breach.day) + (breach.day > f.horizonDays * 0.7 ? -9 : 9)}
                y={geo.y(BigInt(breach.balance)) + 16}
                textAnchor={breach.day > f.horizonDays * 0.7 ? "end" : "start"}
                fontSize="11"
                fill="var(--brass)"
              >
                breach, day {breach.day}
              </text>
            </g>
          ) : null}
          {/* Reading */}
          {sel ? (
            <g>
              <line x1={geo.x(sel.day)} x2={geo.x(sel.day)} y1={PAD.t} y2={H - PAD.b} stroke="var(--fg-muted)" strokeWidth="1" />
              <circle cx={geo.x(sel.day)} cy={geo.y(BigInt(sel.balance))} r="3.5" fill="var(--fg-0)" />
            </g>
          ) : null}
        </svg>
      </div>
      <p className="m-0 min-h-10 font-mono text-12 text-fg-1 tabular" aria-hidden="true">
        {sel ? (
          <>
            {formatDay(sel.date)} <span className="text-fg-muted">day {sel.day}</span> {fd(sel.balance)} {f.symbol}
            {BigInt(sel.outflow) > 0n ? <span className="text-fg-muted"> (out {fd(sel.outflow)})</span> : null}
            {sel.belowFloor ? <span className="text-fg-0"> below the floor</span> : null}
          </>
        ) : (
          <span className="font-sans text-fg-muted">Point at the chart or focus it and use the arrow keys to read a day.</span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-11 text-fg-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" viewBox="0 0 18 8">
            <path d="M1 4h16" stroke="var(--steel)" strokeWidth="2" />
          </svg>
          projected balance
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" viewBox="0 0 18 8">
            <path d="M1 4h16" stroke="var(--steel)" strokeWidth="2" strokeDasharray="3 4" />
          </svg>
          under the floor
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" viewBox="0 0 18 8">
            <path d="M1 4h16" stroke="var(--fg-2)" strokeWidth="1" strokeDasharray="6 4" />
          </svg>
          reserve floor (sealed)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="var(--brass)" strokeWidth="1.6" />
          </svg>
          first breach
        </span>
      </div>
      <p id={`${id}-sum`} className="sr-only">
        Posted balance {fd(f.start.posted.value)} {f.symbol}; lowest projected balance {fd(f.minBalance)}; reserve floor {fd(f.reserveFloor.value)}.
        {breach ? ` The floor is breached on day ${breach.day}.` : " The floor holds over the horizon."}
      </p>
    </div>
  );
}
