import Link from "next/link";
import type { ReactNode } from "react";
import { cn, OutputChip, StateRing, Trace } from "@yinglong/ui";
import type { Decision, Receipt } from "@/lib/api/view";
import { formatAmount } from "@/lib/format";
import { buttonClass } from "@/components/ui/button";
import { ReceiptOutcomeRing, TierBadge, toTrace, TxLink } from "./parts";

const OUTCOME: Record<Decision["outcome"], { ring: Parameters<typeof StateRing>[0]["state"]; word: string }> = {
  executable: { ring: "pending", word: "Allowed: Ying acts alone" },
  executed: { ring: "pending", word: "Submitted, waiting for the receipt" },
  awaiting_approval: { ring: "waiting", word: "Needs you" },
  asking: { ring: "asking", word: "Not sure, your call" },
  refused: { ring: "refused", word: "Refused" },
  reserved: { ring: "waiting", word: "Reserved for you" },
  observed: { ring: "verified", word: "Read only" },
};

/** The verdict for one request: tier, outcome, the nine scales and the labelled explanation. */
export function DecisionView({
  d,
  receipt,
  executing,
  actions,
  className,
  headingLevel = "h3",
}: {
  d: Decision;
  receipt?: Receipt | null;
  executing?: boolean;
  actions?: ReactNode;
  className?: string;
  headingLevel?: "h2" | "h3";
}) {
  const H = headingLevel;
  const stop = d.scales.find((s) => s.status === "stopped") ?? d.scales.find((s) => s.status === "escalated");
  const o = OUTCOME[d.outcome];
  return (
    <section className={cn("grid gap-5", className)} aria-live="polite">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <TierBadge tier={d.tier} withName />
          {receipt ? (
            <ReceiptOutcomeRing r={receipt} size={20} />
          ) : o.ring === "refused" ? (
            <StateRing state="refused" size={20} label={o.word} error={stop?.error ?? undefined} />
          ) : (
            <StateRing state={o.ring} size={20} label={executing ? "Submitting to the ledger" : o.word} />
          )}
        </div>
        <H className="m-0 text-18 font-semibold text-fg-0">{d.intent.summary}</H>
        {d.intent.amount || d.intent.payeeName ? (
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-13 text-fg-2">
            {d.intent.payeeName ? (
              <span>
                Payee <span className="text-fg-1">{d.intent.payeeName}</span>
              </span>
            ) : null}
            {d.intent.amount ? (
              <span>
                Amount <span className="font-mono text-fg-1">{formatAmount(d.intent.amount)}</span>
              </span>
            ) : null}
          </p>
        ) : null}
        <p className="m-0 text-12 text-fg-muted">
          You asked: <q lang={d.input.language === "bn" ? "bn" : d.input.language === "zh" ? "zh" : undefined} className="text-fg-2">{d.input.text}</q>
        </p>
      </header>

      {d.question ? (
        <p className="m-0 flex items-start gap-2 rounded-control border border-brass/50 bg-brass-tint px-3 py-2.5 text-13 text-fg-1">
          <StateRing state="asking" size={16} glyphOnly label="Question" />
          <span>{d.question}</span>
        </p>
      ) : null}

      <div className="grid gap-2">
        <p className="eyebrow m-0 text-fg-muted">Nine scales</p>
        <Trace scales={toTrace(d)} caption="Nine scales, in order" />
      </div>

      {d.plan.length ? (
        <div className="grid gap-1.5">
          <p className="eyebrow m-0 text-fg-muted">Plan</p>
          <ol className="m-0 grid gap-1 pl-5 text-13 text-fg-2">
            {d.plan.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="grid gap-2 border-t border-line-1 pt-4">
        <div className="flex items-center gap-2">
          <span className="text-12 font-medium text-fg-2">Why</span>
          {d.aigc ? <OutputChip kind="ai" detail={d.aigc.model} /> : <OutputChip kind="rule" />}
        </div>
        <p className="m-0 max-w-[68ch] text-13 leading-relaxed text-fg-2">{d.explanation}</p>
        <p className="m-0 text-11 text-fg-muted">
          The facts above come from code and the chain. The explanation is labelled; it never decides.
        </p>
      </div>

      {receipt ? (
        <div className="flex flex-wrap items-center gap-3 text-13">
          <span className="text-fg-2">Receipt</span>
          <TxLink ledger={receipt.ledger} hash={receipt.txHash} href={receipt.explorerUrl} label={receipt.outcome === "confirmed" ? "On chain" : "Transaction"} badge={receipt.ledgerBadge} />
        </div>
      ) : null}

      {d.outcome === "awaiting_approval" && d.approvalId ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`/approve/${d.approvalId}`} className={buttonClass("primary", "md")}>
            Review and approve
          </Link>
          {actions}
        </div>
      ) : actions ? (
        <div className="flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </section>
  );
}
