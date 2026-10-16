"use client";

import { useState } from "react";
import { cn, shortHash, StateRing } from "@yinglong/ui";
import type { Escrow, Obligation, Receipt } from "@/lib/api/view";
import { ApiRequestError, getApi, isSample } from "@/lib/api";
import { invalidate, useAgent } from "@/lib/api/hooks";
import { formatAmount, formatTime } from "@/lib/format";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog, DialogClose } from "@/components/ui/sheet";
import { ErrorLine, Loading, ReceiptOutcomeRing, TxLink } from "@/components/data/parts";
import { Panel, ReadFrom } from "@/components/data/panel";
import { useVisitorSession } from "@/components/session";

const PROTECTION: Record<Obligation["protection"], { ring: "onchain" | "verified" | "unknown"; word: string }> = {
  "escrow-protected": { ring: "onchain", word: "Escrow-protected" },
  "settled through escrow": { ring: "verified", word: "Settled through escrow" },
  "paid directly (no protection)": { ring: "unknown", word: "Paid directly, no protection" },
  unprotected: { ring: "unknown", word: "Unprotected" },
};

/** Coverage gap: which obligations named in the mandate are protected by an escrow, and which are not. */
export function CoveragePanel() {
  const q = useAgent("coverage", (api) => api.coverage(), ["coverage", "escrows", "receipts"]);
  const c = q.data;
  return (
    <Panel
      id="coverage-h"
      eyebrow="Coverage"
      title={c ? `${c.summary.protected} protected, ${c.summary.unprotected} unprotected` : "Protected and unprotected obligations"}
      meta={c ? <span>{c.summary.gaps === 0 ? "No gaps on record." : `${c.summary.gaps} gap${c.summary.gaps === 1 ? "" : "s"} to look at.`}</span> : null}
      footer={c ? c.label : null}
    >
      <ErrorLine error={q.error} />
      {q.loading && !c ? <Loading label="Loading coverage" rows={2} /> : null}
      {c ? (
        <div className="grid gap-4">
          <ul className="m-0 grid list-none p-0">
            {c.obligations.map((o) => {
              const p = PROTECTION[o.protection];
              return (
                <li key={o.payeeId} className="grid gap-1.5 border-t border-line-1 py-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-13 font-medium text-fg-0">
                      {o.payeeLabel} <span className="text-12 font-normal text-fg-muted">{o.category}, {o.cadence}</span>
                    </span>
                    <span className="font-mono text-12 text-fg-2 tabular">up to {formatAmount(o.upTo)}</span>
                  </div>
                  <StateRing state={p.ring} size={16} label={p.word} />
                  <p className="m-0 text-12 text-fg-muted">{o.refundableAfter ? o.why.replace(o.refundableAfter, formatTime(o.refundableAfter)) : o.why}</p>
                </li>
              );
            })}
          </ul>
          {c.coverItems.length ? (
            <div className="grid gap-2 border-t border-line-1 pt-4">
              <h3 className="m-0 text-12 font-medium text-fg-2">Not in YINGLONG&apos;s records</h3>
              <ul className="m-0 grid list-none gap-2 p-0">
                {c.coverItems.map((i) => (
                  <li key={i.item} className="grid gap-1">
                    <StateRing state={i.gap ? "unknown" : "verified"} size={16} label={`${i.item.charAt(0).toUpperCase()}${i.item.slice(1)}: ${i.status}`} />
                    <p className="m-0 text-12 text-fg-muted">{i.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="m-0 text-11 text-fg-muted">
            <ReadFrom ledger={c.ledger} block={c.block} label="Escrows read from" />
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

const STATE: Record<Escrow["state"], { ring: "waiting" | "onchain" | "verified"; word: string }> = {
  held: { ring: "onchain", word: "Held" },
  released: { ring: "verified", word: "Released" },
  refunded: { ring: "verified", word: "Refunded" },
};

function operatorNote(e: unknown, action: "release" | "refund"): string {
  const err = e as ApiRequestError;
  if (err?.status === 403)
    return action === "release"
      ? "Releases are signed by the release attester, a fictional institution's key held by the service, so in this demo only the operator can trigger one."
      : "Refunds on the demo account are sent by the operator; on your own passkey account you can refund your own escrows.";
  return err?.message ?? "The request failed.";
}

/** Escrows funded by this account (ProtectedPayment), with release and refund where the contract allows them. */
export function EscrowsPanel() {
  const q = useAgent("escrows", (api) => api.escrows(), ["escrows"]);
  const visitor = useVisitorSession();
  const [confirm, setConfirm] = useState<{ e: Escrow; action: "release" | "refund" } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<{ text: string; receipt: Receipt | null } | null>(null);
  const list = q.data?.escrows ?? [];

  async function run(e: Escrow, action: "release" | "refund") {
    setConfirm(null);
    setBusy(e.escrowId);
    setResult(null);
    try {
      const r = action === "release" ? await getApi().releaseEscrow(e.escrowId) : await getApi().refundEscrow(e.escrowId);
      setResult({ text: action === "release" ? `Escrow ${e.escrowId} released to ${r.escrow.payee.label}.` : `Escrow ${e.escrowId} returned to your account.`, receipt: r.receipt });
      invalidate("escrows", "coverage", "receipts", "budgets", "insights");
    } catch (err) {
      setResult({ text: operatorNote(err, action), receipt: null });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      id="escrows-h"
      eyebrow="Escrows"
      title={q.data ? `${list.filter((e) => e.state === "held").length} held for you` : "Escrows"}
      meta={<span>Money held by the ProtectedPayment contract until the payee&apos;s condition is attested, refundable after its date. The agent cannot move it.</span>}
      footer={
        q.data ? (
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            Test units. Release attesters are fictional institutions.
            {q.data.contract ? (
              <span>
                Contract <span className="font-mono">{shortHash(q.data.contract, 6, 4)}</span>
              </span>
            ) : null}
            {q.data.block ? <span className="font-mono">block #{q.data.block}</span> : null}
          </span>
        ) : null
      }
      bodyClassName="px-0 sm:px-0"
    >
      <div className="px-4 sm:px-5">
        <ErrorLine error={q.error} />
        {q.loading && !q.data ? <Loading label="Loading escrows" rows={2} /> : null}
        {q.data && list.length === 0 ? <p className="m-0 text-13 text-fg-muted">No escrow funded by this account yet.</p> : null}
      </div>
      {list.length ? (
        <div className="overflow-x-auto px-4 sm:px-5" tabIndex={0} role="region" aria-label="Escrows (scrolls sideways on small screens)">
          <table className="yl-table min-w-[600px]">
            <caption className="sr-only">Escrows funded by this account, with their release attester and refund time</caption>
            <thead>
              <tr>
                <th scope="col">Escrow</th>
                <th scope="col">Released by</th>
                <th scope="col" className="text-right">
                  Amount
                </th>
                <th scope="col">Refundable after</th>
                <th scope="col">State</th>
                <th scope="col" className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.escrowId}>
                  <td>
                    <span className="block text-13 text-fg-0">{e.payee.label}</span>
                    <span className="block font-mono text-11 text-fg-muted">#{e.escrowId}</span>
                  </td>
                  <td className="text-12 text-fg-2">{e.releaseAttester.label}</td>
                  <td className="num text-13 text-fg-1">
                    {formatAmount(e.amount, { symbol: false })}
                    <span className="block text-11 text-fg-muted">{e.amount.symbol}</span>
                  </td>
                  <td className="font-mono text-12 whitespace-nowrap text-fg-2 tabular">{formatTime(e.refundAfter)}</td>
                  <td>
                    <StateRing state={STATE[e.state].ring} size={16} label={STATE[e.state].word} />
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <span className="inline-flex gap-2">
                      {e.canRelease ? (
                        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setConfirm({ e, action: "release" })}>
                          {busy === e.escrowId ? "Working" : "Release"}
                        </Button>
                      ) : null}
                      {e.state === "held" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null || !e.canRefundNow}
                          title={e.canRefundNow ? undefined : `Refundable after ${formatTime(e.refundAfter)}`}
                          onClick={() => setConfirm({ e, action: "refund" })}
                        >
                          Refund
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {result ? (
        <div role="status" className="mx-4 mt-3 grid gap-2 rounded-control border border-line-2 bg-bg-2 px-3 py-2.5 text-12 text-fg-1 sm:mx-5">
          <span>{result.text}</span>
          {result.receipt ? (
            <span className="flex flex-wrap items-center gap-3">
              <ReceiptOutcomeRing r={result.receipt} />
              <TxLink ledger={result.receipt.ledger} hash={result.receipt.txHash} href={result.receipt.explorerUrl} badge={result.receipt.ledgerBadge} label="Receipt" />
            </span>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.action === "release" ? `Release escrow #${confirm.e.escrowId}?` : `Refund escrow #${confirm?.e.escrowId ?? ""}?`}
        actions={
          <>
            <DialogClose className={buttonClass("quiet", "md")}>Cancel</DialogClose>
            <Button onClick={() => confirm && void run(confirm.e, confirm.action)}>{confirm?.action === "release" ? "Release" : "Refund"}</Button>
          </>
        }
      >
        {confirm ? (
          <p className="m-0">
            {confirm.action === "release"
              ? `${confirm.e.releaseAttester.label} attests the condition and the contract pays ${formatAmount(confirm.e.amount)} to ${confirm.e.payee.label}. This cannot be undone.`
              : `The contract returns ${formatAmount(confirm.e.amount)} to your account. ${confirm.e.payee.label} can no longer be paid from this escrow.`}
            {isSample ? " Sample data: nothing is sent." : visitor ? "" : " On the demo account the operator sends it."}
          </p>
        ) : null}
      </ConfirmDialog>
    </Panel>
  );
}

/** The two panels side by side when there is room; they never nest. */
export function ProtectionSection({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-4", className)}>
      <CoveragePanel />
      <EscrowsPanel />
    </div>
  );
}
