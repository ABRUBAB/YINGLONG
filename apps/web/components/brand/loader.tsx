import { cn } from "@yinglong/ui";
import { Mark } from "./mark";

/**
 * The YINGLONG loader: the S mark held inside a ring of ticks that turns once every few seconds, with
 * a pearl that circles the ring. It is the only loading symbol on the site, so a wait always looks like
 * the product. CSS only (transform), still under reduced motion and the Pause motion control.
 * `size` is the whole symbol in px; use 20 to 28 inline (inside a button or a row) and 72 on a screen.
 */
export function BrandSpinner({ size = 40, label, className }: { size?: number; label?: string; className?: string }) {
  const ticks = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    const l = i % 4 === 0 ? 5 : 2.6;
    return `M${(Math.cos(a) * 44).toFixed(1)} ${(Math.sin(a) * 44).toFixed(1)}L${(Math.cos(a) * (44 + l)).toFixed(1)} ${(Math.sin(a) * (44 + l)).toFixed(1)}`;
  }).join("");
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-3 text-fg-0", className)}>
      <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
        <svg viewBox="-56 -56 112 112" className="yl-loader-ring absolute inset-0 size-full" aria-hidden="true">
          <path d={ticks} stroke="var(--accent-glow)" strokeOpacity="0.85" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="0" cy="-44" r="3.4" fill="var(--seal)" />
        </svg>
        <Mark size={Math.round(size * 0.52)} decorative />
      </span>
      {label ? <span className="text-13 text-fg-2">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

/** The first-visit screen: the same symbol, large, on the page colour. Shown once per session (see layout.tsx and fx.css). */
export function BootScreen() {
  return (
    <div className="yl-boot" aria-hidden="true">
      <div className="grid justify-items-center gap-6">
        <BrandSpinner size={96} />
        <span className="yl-boot-name type-display text-18 tracking-[0.42em] text-fg-1">YINGLONG</span>
        <span className="yl-boot-bar" />
      </div>
    </div>
  );
}
