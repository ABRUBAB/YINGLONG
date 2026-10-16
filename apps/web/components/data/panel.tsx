import type { ReactNode } from "react";
import { cn, LabelChip, OutputChip } from "@yinglong/ui";
import type { Ledger, Narration } from "@/lib/api/view";
import { LedgerChip, SampleBadge } from "./parts";

/**
 * Page header pattern: where you are, the route title, one sentence on what
 * the page proves, then the honest-label chips. Actions sit to the right on wide screens.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  chips,
  actions,
  children,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("grid gap-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow m-0 text-fg-muted">{eyebrow}</p>
          <h1 className="m-0 mt-2 text-22 font-semibold text-balance text-fg-0 sm:text-26">{title}</h1>
          {lead ? <p className="m-0 mt-2 max-w-[60ch] text-15 text-fg-2">{lead}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SampleBadge />
        {chips}
      </div>
      {children}
    </header>
  );
}

/**
 * One panel: a `yl-card` with a hairline header (eyebrow, title, meta) and a body. Never nest panels;
 * inside a panel, records are rows or a table.
 */
export function Panel({
  id,
  eyebrow,
  title,
  meta,
  actions,
  children,
  footer,
  className,
  bodyClassName,
  tone,
}: {
  id: string;
  eyebrow?: string;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** "brass" outlines a panel that waits on a person. */
  tone?: "brass";
}) {
  return (
    <section aria-labelledby={id} className={cn("yl-card yl-enter min-w-0", tone === "brass" && "border-brass/50", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line-1 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow m-0 text-fg-muted">{eyebrow}</p> : null}
          <h2 id={id} className={cn("m-0 text-15 font-semibold text-fg-0", eyebrow && "mt-1")}>
            {title}
          </h2>
          {meta ? <div className="mt-1 text-12 text-fg-muted">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn("px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
      {footer ? <div className="border-t border-line-1 px-4 py-3 text-11 leading-relaxed text-fg-muted sm:px-5">{footer}</div> : null}
    </section>
  );
}

/** A paragraph a model may have written about computed facts: always labelled, with the model named. */
export function NarrationBlock({ n, className }: { n: Narration; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {n.aiGenerated ? <OutputChip kind="ai" detail={n.provider ? `${n.provider} ${n.model}` : n.model} /> : <OutputChip kind="rule" detail="template text (deterministic)" />}
      </div>
      <p className="m-0 max-w-[72ch] text-13 leading-relaxed text-fg-2">{n.text}</p>
      {n.aiGenerated ? (
        <p className="m-0 text-11 text-fg-muted">Accepted only because every number in it appears in the computed facts. It explains; it never decides.</p>
      ) : n.fallbackReason ? (
        <p className="m-0 text-11 text-fg-muted">No model paragraph this time: {n.fallbackReason}.</p>
      ) : null}
    </div>
  );
}

/** Ledger + block line under a panel: where the numbers were read. */
export function ReadFrom({ ledger, block, label }: { ledger: Ledger; block: string | null; label?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{label ?? "Read from"}</span>
      <LedgerChip ledger={ledger} compact />
      {block ? <span className="font-mono tabular">block #{block}</span> : null}
    </span>
  );
}

export function TestUnitsChip() {
  return <LabelChip>Test units</LabelChip>;
}

/** Small key/value stat used in panel bodies (mono value, muted label). */
export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1", className)}>
      <span className="text-12 text-fg-muted">{label}</span>
      <span className="font-mono text-18 leading-tight text-fg-0 tabular">{value}</span>
      {sub ? <span className="text-11 text-fg-muted">{sub}</span> : null}
    </div>
  );
}
