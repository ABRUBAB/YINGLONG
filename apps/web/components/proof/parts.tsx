import type { CSSProperties, ReactNode } from "react";
import { cn } from "@yinglong/ui";
import type { ProofRate } from "@/lib/api/view";
import { ExternalIcon } from "@/components/ui/button";

/* ------------------------------------------------------------------ number words */

const NONE = "—";

/** 0.9672 -> "96.7%". */
export const pct = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined ? NONE : `${(v * 100).toFixed(digits)}%`);
export const fixed = (v: number | null | undefined, digits = 3): string => (v === null || v === undefined ? NONE : v.toFixed(digits));
export const intl = (n: number | null | undefined): string => (n === null || n === undefined ? NONE : new Intl.NumberFormat("en-GB").format(n));
/** [0.9599, 0.9745] -> "96.0 to 97.5%". */
export const intervalText = (iv: [number, number] | null | undefined, digits = 1): string => (iv ? `${(iv[0] * 100).toFixed(digits)} to ${(iv[1] * 100).toFixed(digits)}%` : NONE);
export const shortRev = (s: string | null | undefined): string => (s ? s.slice(0, 7) : "");

export function uptimeText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return NONE;
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${Math.round(seconds)} s`;
}

/* ------------------------------------------------------------------ layout */

/** One numbered section of the document: hairline on top, number in mono, a short plain lead. */
export function ProofSection({ n, id, title, lead, meta, children, className }: { n: number; id: string; title: string; lead?: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("grid min-w-0 scroll-mt-[calc(var(--nav-h)+24px)] grid-cols-[minmax(0,1fr)] gap-5 border-t border-line-2 pt-8 print:break-inside-avoid", className)}>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id={`${id}-title`} className="m-0 flex items-baseline gap-4 text-18 font-semibold text-fg-0">
            <span className="font-mono text-13 text-fg-muted tabular-nums">{String(n).padStart(2, "0")}</span>
            {title}
          </h2>
          {meta ? <div className="flex flex-wrap items-center gap-2 text-12 text-fg-muted">{meta}</div> : null}
        </div>
        {lead ? <p className="m-0 max-w-[64ch] text-13 text-fg-2">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SubHead({ title, note, as: H = "h3" }: { title: string; note?: ReactNode; as?: "h3" | "h4" }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <H className={cn("m-0 font-semibold text-fg-0", H === "h3" ? "text-15" : "text-13")}>{title}</H>
      {note ? <span className="text-12 text-fg-muted">{note}</span> : null}
    </div>
  );
}

export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("m-0 text-12 leading-relaxed text-fg-muted", className)}>{children}</p>;
}

/** A hairline data table inside its own horizontal scroll box (the page never scrolls sideways). */
export function ScrollTable({ label, minWidth = 640, children, className }: { label: string; minWidth?: number; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)} tabIndex={0} role="region" aria-label={label}>
      <table className="yl-table" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ numbers with their intervals */

/**
 * The interval as a thin bar under the number: the jade band is the 95% interval, the dark tick the
 * point estimate. `domain` is the bar's range (rates near 1 read best on 50% to 100%).
 */
export function RangeBar({ rate, domain = [0.5, 1], className }: { rate: ProofRate; domain?: [number, number]; className?: string }) {
  const [min, max] = domain;
  const x = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const [lo, hi] = rate.interval ?? [rate.value ?? min, rate.value ?? min];
  return (
    <div className={cn("relative mt-1 h-1.5 w-full max-w-[220px] rounded-pill bg-bg-3", className)} aria-hidden="true">
      <div className="absolute inset-y-0 rounded-pill bg-jade" style={{ left: `${x(lo)}%`, width: `${Math.max(0.5, x(hi) - x(lo))}%` }} />
      {rate.value !== null ? <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-fg-0" style={{ left: `calc(${x(rate.value)}% - 1px)` }} /> : null}
    </div>
  );
}

export function Tile({ label, value, rate, domain, sub, className }: { label: string; value: ReactNode; rate?: ProofRate | null; domain?: [number, number]; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5 border-l-2 border-line-2 pl-4", className)}>
      <span className="text-12 leading-snug text-fg-muted">{label}</span>
      <span className="font-mono text-26 leading-none text-fg-0 tabular-nums">{value}</span>
      {rate?.interval ? <RangeBar rate={rate} domain={domain} /> : null}
      {sub ? <span className="text-11 leading-snug text-fg-muted">{sub}</span> : null}
    </div>
  );
}

/** A solid bar to the value with the lighter band to the upper end of the interval (table cells). */
export function RateBar({ rate, domain = [0.5, 1], digits = 1 }: { rate: ProofRate; domain?: [number, number]; digits?: number }) {
  const [min, max] = domain;
  const p = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-1.5 w-24 shrink-0 overflow-hidden rounded-pill bg-bg-3" aria-hidden="true">
        {rate.interval ? (
          <span className="absolute inset-y-0 rounded-pill bg-jade/35" style={{ left: `${p(rate.interval[0]) * 100}%`, width: `${(p(rate.interval[1]) - p(rate.interval[0])) * 100}%` }} />
        ) : null}
        <span className="yl-bar absolute inset-y-0 left-0 w-full rounded-pill bg-jade" style={{ "--p": p(rate.value ?? min) } as CSSProperties} />
      </span>
      <span className="font-mono text-12 text-fg-0 tabular-nums">{pct(rate.value, digits)}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ chips and links */

export function MonoChip({ children, href, title, className }: { children: ReactNode; href?: string | null; title?: string; className?: string }) {
  const cls = cn(
    "inline-flex h-5 max-w-full items-center rounded-[4px] border border-line-3 px-1.5 font-mono text-11 leading-none text-fg-1 tabular-nums",
    href && "underline decoration-line-3 underline-offset-2 hover:border-fg-2 hover:text-fg-0",
    className,
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" title={title} className={cls}>
      {children}
    </a>
  ) : (
    <span title={title} className={cls}>
      {children}
    </span>
  );
}

export function ExtLink({ href, children, className, download }: { href: string; children: ReactNode; className?: string; download?: boolean }) {
  return (
    <a
      href={href}
      target={download ? undefined : "_blank"}
      rel="noreferrer noopener"
      download={download ? "" : undefined}
      className={cn("inline-flex items-center gap-1 text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-0 hover:decoration-fg-2", className)}
    >
      {children}
      {download ? null : <ExternalIcon />}
    </a>
  );
}
