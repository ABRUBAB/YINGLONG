import type { ReactNode } from "react";
import { cn, LabelChip, SampleDataChip, StateRing, type RingState, type TraceScale } from "@yinglong/ui";
import type { Decision, Ledger, Receipt, ReceiptOutcome, Tier } from "@/lib/api/view";
import { SCALE_NAMES } from "@/lib/api/view";
import { explorerTxUrl } from "@/lib/chain";
import { LEDGER_SHORT, TIER_LABEL } from "@/lib/format";
import { isSample } from "@/lib/api";

export function outcomeRing(o: ReceiptOutcome): RingState {
  switch (o) {
    case "confirmed":
      return "onchain";
    case "reverted":
    case "rejected_policy":
      return "refused";
    case "pending":
      return "pending";
    case "awaiting_approval":
      return "waiting";
    case "asked":
      return "asking";
    case "expired":
      return "expired";
    default:
      return "unknown";
  }
}

export function outcomeWord(o: ReceiptOutcome): string {
  return { confirmed: "On chain", reverted: "Reverted", rejected_policy: "Refused", pending: "Pending", awaiting_approval: "Needs you", asked: "Asked you", expired: "Expired", unknown: "Unknown" }[o];
}

export function ReceiptOutcomeRing({ r, size = 16 }: { r: Receipt; size?: 16 | 20 | 24 }) {
  const state = outcomeRing(r.outcome);
  if (state === "refused") return <StateRing state="refused" size={size} label={outcomeWord(r.outcome)} error={r.revertError ?? undefined} />;
  if (state === "onchain") return <StateRing state="onchain" size={size} label="On chain" />;
  return <StateRing state={state} size={size} label={outcomeWord(r.outcome)} />;
}

export function TierBadge({ tier, withName = false, className }: { tier: Tier; withName?: boolean; className?: string }) {
  const tone =
    tier === "T4"
      ? "border-fg-1 text-fg-0"
      : tier === "T2" || tier === "T3" || tier === "ASK"
        ? "border-brass/60 text-brass"
        : "border-line-3 text-fg-2";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span className={cn("inline-flex h-5 min-w-7 items-center justify-center rounded-[4px] border px-1 font-mono text-11 leading-none", tone)}>
        {tier === "ASK" ? "T?" : tier}
      </span>
      {withName ? <span className="text-12 text-fg-2">{TIER_LABEL[tier]}</span> : null}
    </span>
  );
}

export function LedgerChip({ ledger, badge, compact }: { ledger: Ledger; badge?: string | null; compact?: boolean }) {
  const full = badge ?? (ledger === "anvil-bench" ? "Anvil bench (simulated)" : LEDGER_SHORT[ledger]);
  // In tables, show the ledger's name and keep the qualifier for screen readers and the tooltip.
  const cut = compact ? full.indexOf(" (") : -1;
  return (
    <LabelChip dotted={ledger === "anvil-bench"} className="max-w-[14rem] truncate" title={full}>
      {cut > 0 ? (
        <>
          {full.slice(0, cut)}
          <span className="sr-only">{full.slice(cut)}</span>
        </>
      ) : (
        full
      )}
    </LabelChip>
  );
}

export function TxLink({
  ledger,
  hash,
  label = "On chain",
  href,
  badge,
}: {
  ledger: Ledger;
  hash: string | null | undefined;
  label?: string;
  href?: string | null;
  /** Ledger badge shown next to every hash (service-provided when available). */
  badge?: string | null;
}) {
  if (!hash) return <span className="text-12 text-fg-muted">No transaction</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <StateRing state="onchain" size={16} label={label} hash={hash} href={explorerTxUrl(ledger, hash, href)} />
      <span className="text-11 text-fg-muted">{badge ?? (ledger === "anvil-bench" ? "Anvil bench (simulated)" : LEDGER_SHORT[ledger])}</span>
    </span>
  );
}

export function toTrace(d: Decision): TraceScale[] {
  return d.scales.map((s) => ({
    id: s.scale,
    name: SCALE_NAMES[s.scale],
    status: s.status,
    reason: s.reason ?? undefined,
    error: s.error ?? undefined,
    revertHash: s.revert?.txHash,
    revertHref: s.revert ? explorerTxUrl(s.revert.ledger, s.revert.txHash, s.revert.explorerUrl) : undefined,
    durationMs: s.durationMs ?? undefined,
  }));
}

/** Section heading used across the app: eyebrow + title + optional actions; never a card. */
export function SectionHead({
  eyebrow,
  title,
  id,
  actions,
  className,
  as: H = "h2",
}: {
  eyebrow?: string;
  title: ReactNode;
  id?: string;
  actions?: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow m-0 text-fg-muted">{eyebrow}</p> : null}
        <H id={id} className={cn("m-0 font-semibold text-fg-0", H === "h1" ? "mt-1 text-22 sm:text-26" : "mt-0.5 text-15")}>
          {title}
        </H>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SampleBadge({ className }: { className?: string }) {
  return isSample ? <SampleDataChip className={className} /> : null;
}

export function ErrorLine({ error, className }: { error: Error | undefined; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={cn("m-0 flex items-start gap-2 rounded-control border border-line-3 bg-bg-2 px-3 py-2 text-13 text-fg-1", className)}>
      <StateRing state="unknown" size={16} glyphOnly label="Unavailable" />
      <span>{error.message}</span>
    </p>
  );
}

export function Loading({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="grid gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 rounded-control bg-bg-2" />
      ))}
    </div>
  );
}
