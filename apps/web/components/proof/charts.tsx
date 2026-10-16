"use client";

/**
 * The small inline SVG drawings of the proof page. Every colour is a theme token read at paint time
 * (both themes, print); lines grow once on arrival through the page's `yl-draw` class, which is
 * still under reduced motion and "Pause motion".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@yinglong/ui";
import type { ProofContractPair, ProofCurvePoint, ProofCurves, ProofLedger } from "@/lib/api/view";
import { LEDGER_SHORT } from "@/lib/format";
import { intl } from "./parts";

const MONO = { fontFamily: "var(--font-mono)" } as const;

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

/** Round tick values from 0 to about `max` (1, 2, 2.5 or 5 times a power of ten). */
function ticks(max: number, n = 3): number[] {
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((k) => raw <= k * mag) ?? 10) * mag;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

type TrainPoint = ProofCurvePoint & { loss: number };
type EvalPoint = ProofCurvePoint & { evalMacroF1: number };

/**
 * The real training log of one model: loss per step on the left axis (main line), the evaluation
 * macro-F1 at the end of each epoch on the right axis (jade points). Nothing is smoothed.
 */
export function TrainingCurve({ c, label }: { c: ProofCurves; label: string }) {
  const [box, W] = useWidth<HTMLDivElement>(680);
  const H = W < 520 ? 200 : 240;
  const geo = useMemo(() => {
    const train = c.points.filter((p): p is TrainPoint => p.loss !== null);
    const evals = c.points.filter((p): p is EvalPoint => p.evalMacroF1 !== null);
    const steps = c.points.map((p) => p.step);
    const x0 = Math.min(...steps);
    const x1 = Math.max(...steps);
    const lmax = Math.max(0.001, ...train.map((p) => p.loss));
    const lt = ticks(lmax, 3);
    const top = Math.max(lt[lt.length - 1] ?? lmax, lmax);
    const PAD = { l: 46, r: evals.length ? 52 : 16, t: 20, b: 32 };
    const x = (s: number) => PAD.l + ((s - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
    const fmin = evals.length ? Math.min(...evals.map((p) => p.evalMacroF1)) : 0;
    const f0 = Math.max(0, Math.floor((fmin - 0.005) * 100) / 100);
    const yf = (v: number) => PAD.t + (1 - (v - f0) / Math.max(1e-6, 1 - f0)) * (H - PAD.t - PAD.b);
    const lossPath = train.map((p, i) => `${i ? "L" : "M"}${x(p.step).toFixed(1)} ${y(p.loss).toFixed(1)}`).join(" ");
    const f1Path = evals.map((p, i) => `${i ? "L" : "M"}${x(p.step).toFixed(1)} ${yf(p.evalMacroF1).toFixed(1)}`).join(" ");
    const xt = x1 > x0 ? [x0, Math.round((x0 + x1) / 2), x1] : [x0];
    return { train, evals, x, y, yf, lossPath, f1Path, lt, f0, xt, PAD, x1 };
  }, [c, W, H]);
  const { PAD } = geo;
  const first = geo.train[0];
  const last = geo.train[geo.train.length - 1];
  const summary =
    `${label}: training loss ${first ? first.loss.toFixed(3) : "unknown"} at step ${first?.step ?? 0}, ${last ? last.loss.toFixed(3) : "unknown"} at step ${last?.step ?? 0}` +
    (geo.evals.length ? `; evaluation macro-F1 ${geo.evals.map((p) => `${p.evalMacroF1.toFixed(4)} at epoch ${p.epoch ?? "?"}`).join(", ")}` : "") +
    ".";
  return (
    <figure className="m-0 grid min-w-0 gap-2">
      <div ref={box} role="img" aria-label={summary} className="min-w-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full select-none" aria-hidden="true">
          <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="var(--canvas, var(--bg-2))" />
          {geo.lt.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--grid, var(--line-1))" strokeWidth="1" />
              <text x={PAD.l - 8} y={geo.y(t) + 4} textAnchor="end" fontSize="11" fill="var(--fg-muted)" style={MONO}>
                {t}
              </text>
            </g>
          ))}
          {geo.xt.map((s, i) => (
            <text key={s} x={geo.x(s)} y={H - PAD.b + 18} textAnchor={i === 0 ? "start" : i === geo.xt.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--fg-muted)" style={MONO}>
              step {intl(s)}
            </text>
          ))}
          {geo.evals.map((p) => (
            <g key={`e${p.step}`}>
              <line x1={geo.x(p.step)} x2={geo.x(p.step)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-2)" strokeWidth="1" strokeDasharray="2 3" />
              {p.epoch !== null ? (
                <text x={geo.x(p.step) - 4} y={PAD.t + 12} textAnchor="end" fontSize="11" fill="var(--fg-muted)" style={MONO}>
                  epoch {p.epoch}
                </text>
              ) : null}
            </g>
          ))}
          <path d={geo.lossPath} pathLength={1} className="yl-draw" fill="none" stroke="var(--fg-1)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
          {geo.evals.length ? (
            <g>
              <path d={geo.f1Path} fill="none" stroke="var(--jade, var(--fg-2))" strokeWidth="1.25" strokeDasharray="4 3" />
              {geo.evals.map((p) => (
                <g key={`f${p.step}`}>
                  <circle cx={geo.x(p.step)} cy={geo.yf(p.evalMacroF1)} r="3.5" fill="var(--bg-1)" stroke="var(--jade, var(--fg-2))" strokeWidth="2" />
                  <text x={geo.x(p.step) + (p.step === geo.x1 ? -6 : 0)} y={geo.yf(p.evalMacroF1) - 9} textAnchor={p.step === geo.x1 ? "end" : "middle"} fontSize="11" fill="var(--jade, var(--fg-2))" style={MONO}>
                    {p.evalMacroF1.toFixed(4)}
                  </text>
                </g>
              ))}
              <text x={W - PAD.r + 8} y={geo.yf(1) + 4} fontSize="11" fill="var(--fg-muted)" style={MONO}>
                1.00
              </text>
              <text x={W - PAD.r + 8} y={geo.yf(geo.f0) + 4} fontSize="11" fill="var(--fg-muted)" style={MONO}>
                {geo.f0.toFixed(2)}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-11 text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true">
            <path d="M1 4h16" stroke="var(--fg-1)" strokeWidth="1.75" />
          </svg>
          training loss, left axis
        </span>
        {geo.evals.length ? (
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true">
              <path d="M1 4h16" stroke="var(--jade, var(--fg-2))" strokeWidth="1.25" strokeDasharray="4 3" />
              <circle cx="9" cy="4" r="2.5" fill="var(--bg-1)" stroke="var(--jade, var(--fg-2))" strokeWidth="1.5" />
            </svg>
            evaluation macro-F1 at the end of each epoch, right axis
          </span>
        ) : null}
        <span>{c.points.length} logged points</span>
      </figcaption>
    </figure>
  );
}

/** Loss over step, as a thumbnail (the small multiples of the other models). */
export function Sparkline({ points, className }: { points: ProofCurvePoint[]; className?: string }) {
  const pts = points.filter((p): p is TrainPoint => p.loss !== null);
  if (pts.length < 2) return null;
  const W = 160;
  const H = 40;
  const P = 3;
  const x0 = pts[0]!.step;
  const x1 = pts[pts.length - 1]!.step;
  const lmax = Math.max(0.001, ...pts.map((p) => p.loss));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(P + ((p.step - x0) / Math.max(1, x1 - x0)) * (W - 2 * P)).toFixed(1)} ${(P + (1 - p.loss / lmax) * (H - 2 * P)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("block h-10 w-full", className)} aria-hidden="true">
      <rect x="0" y="0" width={W} height={H} fill="var(--canvas, var(--bg-2))" />
      <line x1="0" x2={W} y1={H - P} y2={H - P} stroke="var(--grid, var(--line-1))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d={d} pathLength={1} className="yl-draw" fill="none" stroke="var(--fg-1)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Twin rings: one ring per ledger, one tick per contract deployed on both (rule enforcers first and
 * thicker), jade where the runtime bytecode is identical, muted where it differs.
 */
export function TwinRings({ pairs, ledgers }: { pairs: ProofContractPair[]; ledgers: ProofLedger[] }) {
  const both = pairs.filter((p) => p.identical !== null);
  const n = both.length;
  const same = both.filter((p) => p.identical).length;
  const enf = both.filter((p) => p.enforcer);
  const enfSame = enf.filter((p) => p.identical).length;
  const W = 400;
  const H = 184;
  const R = 60;
  const cy = 80;
  const centers = [90, 310];
  const tick = (cx: number, i: number) => {
    const ang = ((-90 + (i * 360) / Math.max(1, n)) * Math.PI) / 180;
    const r0 = R + 2;
    const r1 = R + 9;
    return { x1: (cx + r0 * Math.cos(ang)).toFixed(1), y1: (cy + r0 * Math.sin(ang)).toFixed(1), x2: (cx + r1 * Math.cos(ang)).toFixed(1), y2: (cy + r1 * Math.sin(ang)).toFixed(1) };
  };
  const label = `${same} of ${n} contracts deployed on both ledgers have identical code${enf.length ? `; ${enfSame} of ${enf.length} rule enforcers` : ""}.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="mx-auto block h-auto w-full max-w-[420px] select-none">
      {centers.map((cx, k) => {
        const l = ledgers[k];
        return (
          <g key={k}>
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--line-2)" strokeWidth="1" />
            {both.map((p, i) => {
              const t = tick(cx, i);
              return <line key={p.name} {...t} stroke={p.identical ? "var(--jade, var(--fg-1))" : "var(--fg-muted)"} strokeWidth={p.enforcer ? 2.25 : 1.25} strokeLinecap="round" />;
            })}
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fill="var(--fg-1)" style={MONO}>
              {l ? LEDGER_SHORT[l.ledger] : ""}
            </text>
            <text x={cx} y={cy + R + 26} textAnchor="middle" fontSize="11" fill="var(--fg-muted)" style={MONO}>
              {l && l.chainId !== null ? `chain id ${l.chainId}` : ""}
            </text>
          </g>
        );
      })}
      <text x={W / 2} y={cy - 2} textAnchor="middle" fontSize="18" fill="var(--fg-0)" style={MONO}>
        {same} / {n}
      </text>
      <text x={W / 2} y={cy + 15} textAnchor="middle" fontSize="11" fill="var(--fg-muted)">
        same code
      </text>
    </svg>
  );
}
