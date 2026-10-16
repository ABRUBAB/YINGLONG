"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn, OutputChip, RingGlyph, StateRing } from "@yinglong/ui";
import type { Decision, Receipt } from "@/lib/api/view";
import { AGENT_API_URL, isSample } from "@/lib/api";
import { formatAmount, formatTime } from "@/lib/format";
import { Button, buttonClass } from "@/components/ui/button";
import { ReceiptOutcomeRing, SampleBadge, TierBadge, TxLink } from "@/components/data/parts";
import { blockReason, decidingNode, safeAlternative, type GraphNode, type ResultKind } from "./execution-state";

/**
 * The result of one request, as one of three clearly different cards: a receipt (verified), a block
 * (the rules refused it, with the reason as proof the guard works), or a service error with Retry.
 * "Needs your approval" and "Needs your answer" keep the existing approve flow as their own states.
 */
export function ExecutionResult({
  kind,
  decision,
  receipt,
  nodes,
  error,
  errorAt,
  onRetry,
  onPrefill,
}: {
  kind: ResultKind;
  decision: Decision | null;
  receipt: Receipt | null;
  nodes: GraphNode[];
  error: Error | null;
  /** Wall-clock time of the failure, for the error line. */
  errorAt: string | null;
  onRetry: () => void;
  /** Puts a safe alternative request in the ask box and sends it. */
  onPrefill: (text: string) => void;
}) {
  if (kind === "error") return <ServiceError error={error} at={errorAt} onRetry={onRetry} />;
  if (!decision) return null;
  switch (kind) {
    case "verified":
      return receipt ? <Verified receipt={receipt} /> : <Sending decision={decision} label="Allowed: inside your rules" />;
    case "sending":
      return <Sending decision={decision} label="Sending to the chain" />;
    case "blocked":
      return <Blocked decision={decision} receipt={receipt} onPrefill={onPrefill} />;
    case "reserved":
      return <Reserved decision={decision} nodes={nodes} />;
    case "approval":
      return <Approval decision={decision} nodes={nodes} />;
    case "question":
      return <Question decision={decision} />;
    case "answer":
      return <Answer decision={decision} />;
  }
}

function Card({ className, label, children }: { className?: string; label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn("yl-card yl-enter grid gap-3 p-4 sm:p-5", className)}>
      {children}
    </section>
  );
}

function AmountLine({ decision, receipt }: { decision?: Decision | null; receipt?: Receipt | null }) {
  const parsed = receipt?.amount ?? decision?.intent.amount ?? null;
  // A zero amount is "no amount stated", not a payment of nothing.
  const amount = parsed && /[1-9]/.test(parsed.value) ? parsed : null;
  const payee = receipt?.payeeName ?? decision?.intent.payeeName ?? null;
  if (!amount && !payee) return null;
  return (
    <div className="grid gap-1">
      {amount ? (
        <p className="m-0 font-mono text-32 leading-none text-fg-0 tabular">
          {formatAmount(amount, { symbol: false })} <span className="text-15 text-fg-2">{amount.symbol}</span>
        </p>
      ) : null}
      {payee ? (
        <p className="m-0 text-13 text-fg-2">
          to <span className="text-fg-1">{payee}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Verified execution: the receipt, the hash, the audit file. */
function Verified({ receipt }: { receipt: Receipt }) {
  const audit = isSample ? null : `${AGENT_API_URL.replace(/\/+$/, "")}/v1/receipts/${encodeURIComponent(receipt.receiptId)}/audit`;
  const settled = receipt.outcome === "confirmed";
  return (
    <Card label="Receipt" className={settled ? "border-jade/50" : "border-line-2"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow text-fg-muted">Receipt</span>
        <ReceiptOutcomeRing r={receipt} size={20} />
        <TierBadge tier={receipt.tier} withName />
        <SampleBadge />
      </div>
      <AmountLine receipt={receipt} />
      <p className="m-0 text-13 text-fg-2">{settled ? "Verified execution. The chain confirmed it and the receipt is written." : "Submitted. The receipt is written; the chain has not confirmed the block yet."}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-1 pt-3 text-13">
        <TxLink ledger={receipt.ledger} hash={receipt.txHash} href={receipt.explorerUrl} label={settled ? "On chain" : "Transaction"} badge={receipt.ledgerBadge} />
        <span className="font-mono text-12 text-fg-muted tabular">{formatTime(receipt.timestamp, { seconds: true })}</span>
        {audit ? (
          <a href={audit} download className={buttonClass("secondary", "sm", "ml-auto")}>
            Download audit proof
          </a>
        ) : (
          <span className="ml-auto text-12 text-fg-muted">Audit proof: live service only</span>
        )}
      </div>
    </Card>
  );
}

/** The payment is allowed and on its way: the chain decides last. */
function Sending({ decision, label }: { decision: Decision; label: string }) {
  return (
    <Card label={label} className="border-line-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StateRing state="pending" size={20} label={label} />
        <TierBadge tier={decision.tier} withName />
      </div>
      <AmountLine decision={decision} />
    </Card>
  );
}

/** Blocked by the rules: the reason as proof, and one safe alternative. */
function Blocked({ decision, receipt, onPrefill }: { decision: Decision; receipt: Receipt | null; onPrefill: (text: string) => void }) {
  const reason = blockReason(decision, receipt);
  const alt = safeAlternative(decision, reason);
  const source =
    reason?.source === "policy"
      ? `Policy rule${reason.rule ? ` ${reason.rule}` : ""}, checked in code before anything was signed.`
      : reason?.source === "simulation"
        ? "The simulation reverted before anything was signed."
        : reason?.source === "chain"
          ? "The chain's own enforcers reverted it."
          : "A deterministic check stopped it before anything was signed.";
  return (
    <Card label="Blocked by the rules" className="border-seal/50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-2 text-13 font-medium text-seal">
          <RingGlyph state="refused" size={20} />
          Blocked by the rules
        </span>
        <TierBadge tier={receipt?.tier ?? decision.tier} withName />
        {reason?.typedError ? <span className="rounded-pill bg-refused-bg px-2 py-0.5 font-mono text-11 leading-4 text-refused-fg">{reason.typedError}</span> : null}
      </div>
      <p className="m-0 rounded-control bg-seal-tint px-3 py-2 text-13 text-fg-1">
        <span className="font-medium">{reason?.title ?? "Refused"}.</span>
        {reason?.detail ? <span className="text-fg-2"> {reason.detail}</span> : null}
      </p>
      <AmountLine decision={decision} receipt={receipt} />
      <p className="m-0 text-12 text-fg-muted">{source} Nothing moved. The rule is code, so it cannot be talked round.</p>
      {alt ? (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => onPrefill(alt.request)}>
            {alt.label}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** T3: only the owner can do this on their own account. */
function Reserved({ decision, nodes }: { decision: Decision; nodes: GraphNode[] }) {
  const deciding = decidingNode(nodes);
  return (
    <Card label="Reserved for you" className="border-brass/50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StateRing state="waiting" size={20} label="Reserved for you" error={deciding?.error ?? undefined} />
        <TierBadge tier={decision.tier} withName />
      </div>
      {deciding?.reason ? <p className="m-0 rounded-control bg-brass-tint px-3 py-2 text-13 text-fg-1">{deciding.reason}</p> : null}
      <AmountLine decision={decision} />
      <p className="m-0 text-12 text-fg-muted">The agent cannot do this for you. Nothing was signed.</p>
    </Card>
  );
}

/** T2 or ASK with an approval request: the existing approve flow, as its own state. */
function Approval({ decision, nodes }: { decision: Decision; nodes: GraphNode[] }) {
  const deciding = decidingNode(nodes);
  return (
    <Card label="Needs your approval" className="border-brass/50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StateRing state="waiting" size={20} label="Needs your approval" />
        <TierBadge tier={decision.tier} withName />
      </div>
      <p className="m-0 rounded-control bg-brass-tint px-3 py-2 text-13 text-fg-1">{deciding?.reason ?? decision.explanation}</p>
      <AmountLine decision={decision} />
      <div className="flex flex-wrap items-center gap-3">
        {decision.approvalId ? (
          <Link href={`/approve/${decision.approvalId}`} className={buttonClass("primary", "md")}>
            Review and approve
          </Link>
        ) : null}
        <span className="text-12 text-fg-muted">Nothing moves until your passkey signs.</span>
      </div>
    </Card>
  );
}

/** ASK without an approval: the agent did not guess. */
function Question({ decision }: { decision: Decision }) {
  return (
    <Card label="Needs your answer" className="border-brass/50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StateRing state="asking" size={20} label="Needs your answer" />
        <TierBadge tier={decision.tier} withName />
      </div>
      <p className="m-0 rounded-control bg-brass-tint px-3 py-2 text-13 text-fg-1">{decision.question ?? decision.explanation}</p>
      <p className="m-0 text-12 text-fg-muted">Ask again with the payee and the amount. Nothing was signed.</p>
    </Card>
  );
}

/** T0: a read-only answer. */
function Answer({ decision }: { decision: Decision }) {
  return (
    <Card label="Answer" className="border-line-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StateRing state="verified" size={20} label="Read only" />
        <TierBadge tier={decision.tier} withName />
        {decision.aigc ? <OutputChip kind="ai" detail={decision.aigc.model} /> : <OutputChip kind="rule" />}
      </div>
      <p className="m-0 max-w-[68ch] text-15 text-fg-1">{decision.explanation}</p>
    </Card>
  );
}

/** Network or service error: a distinct look from a refusal, with Retry. */
function ServiceError({ error, at, onRetry }: { error: Error | null; at: string | null; onRetry: () => void }) {
  return (
    <section role="alert" aria-label="Service error" className="yl-enter grid gap-3 rounded-card border border-line-2 bg-bg-3 p-4 sm:p-5">
      <StateRing state="unknown" size={20} label="The agent service did not answer" />
      <p className="m-0 text-13 text-fg-1">
        {error?.message ?? "No response."}
        {at ? <span className="text-fg-muted"> (failed at {at})</span> : null}
      </p>
      <p className="m-0 text-12 text-fg-muted">Nothing here is live until it answers. No request was signed.</p>
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </section>
  );
}

/** Raw JSON, folded away: the proposal as the service returned it, and the receipt. */
export function RawDrawer({ decision, receipt }: { decision: Decision; receipt: Receipt | null }) {
  const { raw, ...rest } = decision;
  const body = JSON.stringify({ proposal: raw ?? rest, receipt }, null, 2);
  return (
    <details className="group rounded-control border border-line-1 bg-bg-1">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-12 text-fg-2 hover:text-fg-0 [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" className="transition-transform group-open:rotate-90">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Inspect the raw response
      </summary>
      <div className="grid gap-3 border-t border-line-1 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2 text-12 text-fg-2">
          <span className="font-medium">Explanation</span>
          {decision.aigc ? <OutputChip kind="ai" detail={decision.aigc.model} /> : <OutputChip kind="rule" />}
          <span className="basis-full text-fg-2">{decision.explanation}</span>
          <span className="basis-full text-11 text-fg-muted">The facts come from code and the chain. The explanation is labelled; it never decides.</span>
        </div>
        <pre className="m-0 max-h-80 overflow-auto rounded-control bg-bg-0 p-3 font-mono text-11 leading-4 text-fg-2">{body}</pre>
      </div>
    </details>
  );
}
