"use client";

import { useState } from "react";
import { cn } from "@yinglong/ui";
import type { Receipt } from "@/lib/api/view";
import { useAgent } from "@/lib/api/hooks";
import { formatAmount, formatDay, formatTime } from "@/lib/format";
import { Sheet } from "@/components/ui/sheet";
import { ErrorLine, LedgerChip, Loading, ReceiptOutcomeRing, TierBadge } from "@/components/data/parts";
import { ReceiptCertificate } from "@/components/data/receipt-certificate";

/** Activity as a hairline table (never cards): one action per row, amounts right-aligned in mono. */
export function ActivityTable() {
  const q = useAgent("receipts", (api) => api.receipts({ limit: 30 }), ["receipts"]);
  const [open, setOpen] = useState<Receipt | null>(null);
  if (q.loading) return <Loading label="Loading activity" rows={5} />;
  const items = q.data?.items ?? [];
  return (
    <div className="grid gap-3">
      <ErrorLine error={q.error} />
      {items.length === 0 && !q.error ? <p className="m-0 text-13 text-fg-muted">No receipts yet.</p> : null}
      {items.length ? (
        <div className="-mx-1 overflow-x-auto px-1" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="yl-table min-w-[620px]">
            <caption className="sr-only">Receipts, newest first. Select a row to open the certificate.</caption>
            <thead>
              <tr>
                <th scope="col">Time (HKT)</th>
                <th scope="col">What</th>
                <th scope="col">Tier</th>
                <th scope="col" className="text-right">
                  Amount
                </th>
                <th scope="col">Outcome and ledger</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.receiptId} className={cn(r.ledger === "anvil-bench" && "text-fg-2")}>
                  <td className="font-mono text-12 whitespace-nowrap text-fg-muted tabular">
                    <span className="block text-fg-2">{formatTime(r.timestamp, { date: false })}</span>
                    {formatDay(r.timestamp)}
                  </td>
                  <td className="max-w-[240px]">
                    <button
                      type="button"
                      onClick={() => setOpen(r)}
                      className="block max-w-full truncate text-left text-13 text-fg-0 underline decoration-transparent underline-offset-4 hover:decoration-line-3 focus-visible:decoration-fg-1"
                    >
                      {r.summary}
                    </button>
                    {r.payeeName ? <span className="block truncate text-12 text-fg-muted">{r.payeeName}</span> : null}
                  </td>
                  <td>
                    <TierBadge tier={r.tier} />
                  </td>
                  <td className="num text-13 text-fg-1">{r.amount ? formatAmount(r.amount, { symbol: false }) : "—"}
                    {r.amount ? <span className="block text-11 text-fg-muted">{r.amount.symbol}</span> : null}
                  </td>
                  <td>
                    <ReceiptOutcomeRing r={r} />
                    <span className="mt-1 block">
                      <LedgerChip ledger={r.ledger} badge={r.ledgerBadge} compact />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Sheet
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title="Receipt"
        description="Accountability receipt: what Ying did, under which mandate, and where it is anchored."
        width={560}
      >
        {open ? <ReceiptCertificate r={open} /> : null}
      </Sheet>
    </div>
  );
}
