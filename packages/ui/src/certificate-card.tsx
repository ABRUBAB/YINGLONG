import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { HashRing } from "./hash-ring/hash-ring.tsx";
import { OutputChip, LabelChip } from "./chips.tsx";
import { StateRing, type RingState } from "./state-ring.tsx";

export interface CertificateRow {
  label: string;
  value: ReactNode;
  /** Render the value in Geist Mono (hashes, amounts, ids). */
  mono?: boolean;
  /** Full value for copy / title (e.g. a full hash when the value is shortened). */
  full?: string;
}

export interface CertificateCardProps {
  receiptId: string;
  /** Short heading, e.g. "Rent to Harbour Homes". */
  title: string;
  /** Hash that seeds the Hash Ring (the delegation hash the receipt was executed under). */
  delegationHash: string;
  outcome: RingState;
  outcomeLabel?: string;
  outcomeError?: string;
  /** Statement rows in reading order. */
  rows: CertificateRow[];
  explanation?: string;
  aigcModel?: string;
  /** Explorer QR (bottom-right), rendered by the app. */
  qr?: ReactNode;
  /** Honest labels for the footer: "Test units", "Base Sepolia (testnet)". */
  labels?: string[];
  className?: string;
}

/**
 * Certificate layout for receipts: a bank-statement grid, the Hash Ring
 * top-right, explorer QR bottom-right, "Test units" and "AI-generated explanation" in the footer.
 * Prints from /proof on A4 in the light theme.
 */
export function CertificateCard({
  receiptId,
  title,
  delegationHash,
  outcome,
  outcomeLabel,
  outcomeError,
  rows,
  explanation,
  aigcModel,
  qr,
  labels = [],
  className,
}: CertificateCardProps) {
  return (
    <article
      className={cn(
        "yl-certificate relative grid gap-5 rounded-card border border-line-2 bg-bg-1 p-5 sm:p-6",
        className,
      )}
      aria-label={`Accountability receipt ${receiptId}`}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 font-display text-11 tracking-[0.14em] text-fg-muted uppercase">Accountability receipt</p>
          <h3 className="mt-1.5 mb-0 text-18 font-semibold text-fg-0">{title}</h3>
          <p className="mt-1 mb-0 font-mono text-12 text-fg-2 break-all">{receiptId}</p>
          <div className="mt-3">
            <StateRing state={outcome} size={20} label={outcomeLabel} error={outcomeError} />
          </div>
        </div>
        <HashRing hash={delegationHash} size={92} phase="sealed" className="shrink-0" />
      </header>
      <dl className="m-0 grid grid-cols-1 border-t border-line-2 sm:grid-cols-[minmax(9rem,auto)_1fr]">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="border-b border-line-1 pt-2 pb-0 text-12 text-fg-muted sm:py-2">{r.label}</dt>
            <dd
              className={cn(
                "m-0 border-b border-line-1 pt-0.5 pb-2 text-13 text-fg-1 sm:py-2 sm:text-right",
                r.mono && "font-mono tabular break-all",
              )}
              title={r.full}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      {explanation ? (
        <section className="grid gap-2">
          <div className="flex items-center gap-2">
            <span className="text-12 font-medium text-fg-2">Explanation</span>
            <OutputChip kind="ai" detail={aigcModel} />
          </div>
          <p className="m-0 max-w-[68ch] text-13 leading-relaxed text-fg-2">{explanation}</p>
        </section>
      ) : null}
      <footer className="flex items-end justify-between gap-4 border-t border-line-2 pt-4">
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l) => (
            <LabelChip key={l}>{l}</LabelChip>
          ))}
          {explanation ? <LabelChip>AI-generated explanation</LabelChip> : null}
        </div>
        {qr ? <div className="shrink-0">{qr}</div> : null}
      </footer>
    </article>
  );
}
