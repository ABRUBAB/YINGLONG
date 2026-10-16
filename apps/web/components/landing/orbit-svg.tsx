import { f3 } from "@yinglong/ui";
import { TRACKS, type OrbitSlot } from "@/lib/orbit-layout";

/**
 * The Mandate Orbit as a flat drawing: the same slots as the 3D scene, projected at the same
 * elevation. Used when the WebP poster cannot load and WebGL is unavailable, so the hero always
 * shows the real receipts.
 */
const K = 0.49; // sin(29.5 degrees): the camera's elevation over the disc

export function OrbitSvg({ slots, remaining, ticks }: { slots: OrbitSlot[]; remaining: number; ticks: number[] | null }) {
  const p = (r: number, a: number) => [f3(r * Math.cos(a)), f3(-r * Math.sin(a) * K)] as const;
  const arcEnd = Math.PI / 2 - remaining * Math.PI * 2;
  const [ex, ey] = p(1, arcEnd);
  const large = remaining > 0.5 ? 1 : 0;
  return (
    <svg viewBox="-1.8 -1.05 3.6 2.1" className="size-full" aria-hidden="true">
      <g>
        {(["t1", "t2", "t3"] as const).map((t) => {
          const r = (TRACKS[t][0] + TRACKS[t][1]) / 2;
          return <ellipse key={t} rx={r} ry={r * K} fill="none" stroke="var(--line-2)" strokeWidth="0.004" />;
        })}
        <ellipse rx={1} ry={K} fill="none" stroke="var(--line-2)" strokeWidth="0.018" />
        {remaining >= 0.999 ? <ellipse rx={1} ry={K} fill="none" stroke="var(--fg-1)" strokeWidth="0.018" /> : remaining > 0 ? (
          <path d={`M0 ${f3(-K)} A1 ${K} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke="var(--fg-1)" strokeWidth="0.018" strokeLinecap="round" />
        ) : null}
        {(ticks ?? []).map((len, i) => {
          const a = Math.PI / 2 - (i * 5.625 * Math.PI) / 180;
          const [x0, y0] = p(1.045, a);
          const [x1, y1] = p(1.045 + len * 0.85, a);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--fg-2)" strokeWidth="0.006" />;
        })}
        {slots.map((s) => {
          const [x, y] = p(s.r, s.a);
          if (s.kind === "refused") {
            const d = 0.026;
            return <path key={s.index} d={`M${x} ${f3(Number(y) - d)}L${f3(Number(x) + d)} ${y}L${x} ${f3(Number(y) + d)}L${f3(Number(x) - d)} ${y}z`} fill="var(--fg-faint)" />;
          }
          const size = s.kind === "waiting" ? 0.04 : s.kind === "asked" ? 0.026 : 0.03;
          return <ellipse key={s.index} cx={x} cy={y} rx={size} ry={f3(size * K)} fill={s.kind === "inside" ? "var(--jade)" : "var(--brass)"} />;
        })}
        <circle cx={p(1, Math.PI / 6)[0]} cy={p(1, Math.PI / 6)[1]} r="0.046" fill="var(--seal)" />
        <circle r="0.05" fill="var(--chrome-1)" />
      </g>
    </svg>
  );
}
