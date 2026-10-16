"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LabelChip, shortHash, StateRing } from "@yinglong/ui";
import type { Receipt, TxView } from "@/lib/api/view";
import { getApi } from "@/lib/api";
import { ReceiptCertificate } from "@/components/data/receipt-certificate";
import { Loading } from "@/components/data/parts";
import { PageHeader, Panel } from "@/components/data/panel";

const LEDGER: Record<string, string> = {
  fisco: "FISCO BCOS (team-run consortium ledger)",
  anvil: "Anvil bench (simulated)",
  "base-sepolia": "Base Sepolia (testnet)",
};

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line-1 py-2.5 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-12 text-fg-muted">{k}</dt>
      <dd className="m-0 min-w-0 text-13 text-fg-1">{children}</dd>
    </div>
  );
}

/**
 * Our read-only explorer for ledgers without a public one (FISCO BCOS, the Anvil bench): the ledger's
 * own record of the transaction (GET /v1/tx/:ledger/:hash), its typed revert reason and where that
 * reason came from, and the receipt that accounts for it.
 */
export function TxLookup({ ledger, hash }: { ledger: string; hash: string }) {
  const [tx, setTx] = useState<TxView | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const valid = /^0x[0-9a-fA-F]{64}$/.test(hash);
  useEffect(() => {
    if (!valid) {
      setError("This is not a 32-byte transaction hash.");
      setLoading(false);
      return;
    }
    const api = getApi();
    Promise.allSettled([api.tx(ledger, hash), api.findReceiptByTx(hash)]).then(([t, r]) => {
      if (t.status === "fulfilled") setTx(t.value);
      if (r.status === "fulfilled") setReceipt(r.value);
      if (t.status === "rejected" && r.status === "rejected") setError((t.reason as Error).message);
      setLoading(false);
    });
  }, [ledger, hash, valid]);

  const exact = tx?.revertSource?.startsWith("native receipt");

  return (
    <article className="mx-auto w-full max-w-[880px] px-4 pt-10 pb-20 sm:px-6">
      <PageHeader
        eyebrow="Blockchain record"
        title={<span className="block font-mono text-15 font-medium break-all sm:text-18">{hash}</span>}
        lead="This ledger has no public explorer, so the agent service reads the transaction and its receipt, decodes the call and events against the YINGLONG contracts, and recovers the typed revert reason."
        chips={<LabelChip dotted={ledger === "anvil"}>{tx?.badge ?? LEDGER[ledger] ?? ledger}</LabelChip>}
      />
      <div className="mt-8 grid gap-6">
        {loading ? <Loading rows={4} label="Reading the ledger" /> : null}
        {error ? (
          <p role="alert" className="m-0 text-13 text-fg-1">
            {error}
          </p>
        ) : null}
        {tx ? (
          <Panel
            id="tx-ledger"
            eyebrow="On the ledger"
            title={tx.status === "success" ? "Succeeded" : tx.status === "reverted" ? "Reverted" : tx.status === "pending" ? "Pending" : "Status unknown"}
            actions={
              tx.status === "success" ? (
                <StateRing state="onchain" label="On chain" />
              ) : tx.status === "reverted" ? (
                <StateRing state="refused" label="Reverted" error={tx.revert?.name} />
              ) : (
                <StateRing state="pending" label={tx.status === "pending" ? "Pending" : "Unknown"} />
              )
            }
            footer={tx.note ?? undefined}
          >
            <dl className="m-0 grid">
              {tx.revert ? (
                <Row k="Revert reason">
                  <span className="grid gap-1.5">
                    <StateRing state="refused" label="Typed error" error={tx.revert.name} />
                    {tx.revert.message ? <span className="font-mono text-12 break-all text-fg-2">{tx.revert.message}</span> : null}
                    {tx.revertSource ? (
                      <span className="text-12 text-fg-muted">
                        Recovered from: <span className="text-fg-1">{tx.revertSource}</span>
                        {exact ? "" : ". A replay runs against the latest state and can differ if state changed since."}
                      </span>
                    ) : null}
                  </span>
                </Row>
              ) : null}
              <Row k="Block">{tx.blockNumber ? <span className="font-mono">#{tx.blockNumber}</span> : "Not in a block"}</Row>
              <Row k="Chain id">
                <span className="font-mono">{tx.chainId}</span>
              </Row>
              <Row k="From">
                {tx.from ? (
                  <span className="font-mono" title={tx.from}>
                    {shortHash(tx.from, 10, 8)}
                  </span>
                ) : (
                  "Unknown"
                )}
              </Row>
              <Row k="To">
                {tx.to ? (
                  <span>
                    {tx.toName ? `${tx.toName} ` : ""}
                    <span className="font-mono text-fg-muted" title={tx.to}>
                      {shortHash(tx.to, 8, 6)}
                    </span>
                  </span>
                ) : (
                  "Unknown"
                )}
              </Row>
              <Row k="Gas used">{tx.gasUsed ? <span className="font-mono">{tx.gasUsed}</span> : "Unknown"}</Row>
              <Row k="Call">
                {tx.call ? (
                  <span className="font-mono text-12 break-all">
                    {tx.call.contract}.{tx.call.fn}({tx.call.args.map((a) => (a.length > 24 && /^0x/.test(a) ? shortHash(a, 10, 6) : a)).join(", ")})
                  </span>
                ) : (
                  "Not decoded"
                )}
              </Row>
            </dl>
            {tx.events.length ? (
              <div className="mt-4 grid gap-2 border-t border-line-1 pt-4">
                <h3 className="m-0 text-12 font-medium text-fg-2">Events, {tx.events.length}</h3>
                <ol className="m-0 grid list-none gap-0 p-0">
                  {tx.events.map((e, i) => (
                    <li key={i} className="grid gap-1 border-t border-line-1 py-2.5 text-13 first:border-t-0">
                      <span className="text-fg-0">
                        <span className="mr-2 font-mono text-11 text-fg-muted">{String(i).padStart(2, "0")}</span>
                        {e.contract}.{e.event}
                      </span>
                      {Object.keys(e.args).length ? (
                        <span className="font-mono text-12 break-all text-fg-2">
                          {Object.entries(e.args)
                            .map(([k, v]) => `${k}: ${v.length > 24 && /^0x/.test(v) ? shortHash(v, 10, 6) : v}`)
                            .join("  ·  ")}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </Panel>
        ) : null}
        {receipt ? (
          <section aria-labelledby="tx-receipt" className="grid gap-3">
            <h2 id="tx-receipt" className="m-0 text-15 font-semibold text-fg-0">
              The receipt that accounts for it
            </h2>
            <ReceiptCertificate r={receipt} />
          </section>
        ) : !loading && !error ? (
          <p className="m-0 text-13 text-fg-2">
            <StateRing state="unknown" size={16} label="No receipt records this transaction" />
          </p>
        ) : null}
      </div>
      <p className="mt-8 text-12 text-fg-muted">
        Read-only: this page cannot send anything.{" "}
        <Link href="/proof" className="underline decoration-line-3 underline-offset-4 hover:text-fg-0">
          Back to the proof
        </Link>
      </p>
    </article>
  );
}
