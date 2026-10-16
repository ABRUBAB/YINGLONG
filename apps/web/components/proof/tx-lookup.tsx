"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LabelChip, shortHash, StateRing } from "@yinglong/ui";
import type { Receipt, TxView } from "@/lib/api/view";
import { getApi } from "@/lib/api";
import { ReceiptCertificate } from "@/components/data/receipt-certificate";
import { Loading, SampleBadge } from "@/components/data/parts";

const LEDGER: Record<string, string> = {
  fisco: "FISCO BCOS (team-run consortium ledger)",
  anvil: "Anvil bench (simulated)",
  "base-sepolia": "Base Sepolia (testnet)",
};

/**
 * Our read-only explorer for ledgers without a public one (FISCO BCOS, the Anvil bench): the ledger's
 * own record of the transaction (GET /v1/tx/:ledger/:hash) and the receipt that accounts for it.
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

  return (
    <article className="mx-auto w-full max-w-[760px] px-4 pt-10 pb-20 sm:px-6">
      <p className="eyebrow m-0 text-fg-muted">Transaction</p>
      <h1 className="m-0 mt-2 font-mono text-15 break-all text-fg-0">{hash}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LabelChip dotted={ledger === "anvil"}>{tx?.badge ?? LEDGER[ledger] ?? ledger}</LabelChip>
        <SampleBadge />
      </div>
      <div className="mt-8 grid gap-8">
        {loading ? <Loading rows={4} label="Reading the ledger" /> : null}
        {error ? <p className="m-0 text-13 text-fg-1">{error}</p> : null}
        {tx ? (
          <section aria-labelledby="tx-ledger" className="grid gap-3">
            <h2 id="tx-ledger" className="m-0 text-15 font-semibold text-fg-0">
              On the ledger
            </h2>
            <dl className="m-0 grid grid-cols-1 border-t border-line-2 text-13 sm:grid-cols-[10rem_1fr]">
              {[
                ["Status", tx.status === "success" ? <StateRing key="s" state="onchain" label="Succeeded" /> : tx.status === "reverted" ? <StateRing key="s" state="refused" label="Reverted" /> : <StateRing key="s" state="pending" label={tx.status === "pending" ? "Pending" : "Unknown"} />],
                ["Block", tx.blockNumber ? <span className="font-mono">{tx.blockNumber}</span> : "Not in a block"],
                ["Chain", <span key="c" className="font-mono">{tx.chainId}</span>],
                ["From", tx.from ? <span className="font-mono" title={tx.from}>{shortHash(tx.from, 10, 8)}</span> : "Unknown"],
                ["To", tx.to ? <span>{tx.toName ? `${tx.toName} ` : ""}<span className="font-mono text-fg-muted" title={tx.to}>{shortHash(tx.to, 8, 6)}</span></span> : "Unknown"],
                ["Gas used", tx.gasUsed ? <span className="font-mono">{tx.gasUsed}</span> : "Unknown"],
                ["Call", tx.call ? <span className="font-mono break-all">{tx.call.contract}.{tx.call.fn}({tx.call.args.map((a) => (a.length > 24 ? shortHash(a, 10, 6) : a)).join(", ")})</span> : "Not decoded"],
              ].map(([k, v]) => (
                <div key={String(k)} className="contents">
                  <dt className="border-b border-line-1 pt-2 text-fg-muted sm:py-2">{k}</dt>
                  <dd className="m-0 border-b border-line-1 pb-2 text-fg-1 sm:py-2">{v}</dd>
                </div>
              ))}
            </dl>
            {tx.events.length ? (
              <div className="grid gap-2">
                <p className="eyebrow m-0 text-fg-muted">Events</p>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {tx.events.map((e, i) => (
                    <li key={i} className="rounded-control border border-line-2 px-3 py-2 text-13">
                      <span className="text-fg-0">
                        {e.contract}.{e.event}
                      </span>
                      <span className="mt-1 block font-mono text-12 break-all text-fg-2">
                        {Object.entries(e.args)
                          .map(([k, v]) => `${k}: ${v.length > 24 ? shortHash(v, 10, 6) : v}`)
                          .join("  ·  ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {tx.note ? <p className="m-0 text-12 text-fg-muted">{tx.note}</p> : null}
          </section>
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
        This ledger has no public explorer, so its transactions are read here through the agent service.{" "}
        <Link href="/proof" className="underline decoration-line-3 underline-offset-4 hover:text-fg-0">
          Back to the proof
        </Link>
      </p>
    </article>
  );
}
