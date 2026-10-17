import type { CSSProperties } from "react";
import { StateRing } from "@yinglong/ui";
import type { ProofBundle, ProofTransaction, ReceiptOutcome } from "@/lib/api/view";
import { explorerTxUrl } from "@/lib/chain";
import { formatTime } from "@/lib/format";
import { LedgerChip, outcomeRing, outcomeWord, TierBadge } from "@/components/data/parts";
import { ExtLink, Note, ScrollTable } from "./parts";

const OUTCOMES = new Set<string>(["confirmed", "reverted", "rejected_policy", "pending", "awaiting_approval", "asked", "expired", "unknown"]);
const word = (o: string) => (OUTCOMES.has(o) ? outcomeWord(o as ReceiptOutcome) : o.replace(/_/g, " "));

function Outcome({ t }: { t: ProofTransaction }) {
  const state = OUTCOMES.has(t.outcome) ? outcomeRing(t.outcome as ReceiptOutcome) : "unknown";
  if (state === "refused") return <StateRing state="refused" label={word(t.outcome)} error={t.revertError ?? undefined} />;
  return <StateRing state={state} label={word(t.outcome)} />;
}

function Hash({ t }: { t: ProofTransaction }) {
  if (!t.txHash) return <span className="text-12 text-fg-muted">No transaction</span>;
  const href = explorerTxUrl(t.ledger, t.txHash, t.explorerUrl);
  return <StateRing state="onchain" hash={t.txHash} href={href} label={t.ledger === "base-sepolia" ? "Explorer" : "Decoder"} />;
}

function Audit({ t }: { t: ProofTransaction }) {
  if (!t.auditUrl) return <span className="text-12 text-fg-muted">Audit proof: live service only</span>;
  return (
    <ExtLink href={t.auditUrl} download className="text-12">
      Download audit proof
    </ExtLink>
  );
}

/** "Every transaction, checkable": counts per ledger, the newest three as cards, the rest as a table. */
export function TransactionsSection({ tx }: { tx: ProofBundle["transactions"] }) {
  const cards = tx.latest.slice(0, 3);
  const rest = tx.latest.slice(3);
  return (
    <div className="grid gap-6">
      {tx.counts.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {tx.counts.map((c) => (
            <div key={c.ledger} className="grid gap-1 border-l-2 border-line-2 pl-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-22 leading-none text-fg-0 tabular-nums">{c.total}</span>
                <LedgerChip ledger={c.ledger} compact />
              </div>
              <span className="text-12 text-fg-muted">{c.outcomes.map((o) => `${o.n} ${word(o.outcome).toLowerCase()}`).join(" · ")}</span>
            </div>
          ))}
        </div>
      ) : null}

      {cards.length ? (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((t, i) => (
            <li key={`${t.txHash ?? t.receiptId ?? i}`} className="yl-card yl-enter grid min-w-0 content-start gap-3 p-4" style={{ "--d": `${i * 60}ms` } as CSSProperties}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <LedgerChip ledger={t.ledger} compact />
                {t.tier ? <TierBadge tier={t.tier} /> : null}
              </div>
              <p className="m-0 min-w-0 line-clamp-3 text-13 text-fg-1 [overflow-wrap:anywhere]">{t.title || "Untitled record"}</p>
              <div>
                <Outcome t={t} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Hash t={t} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-1 pt-3 text-12 text-fg-muted">
                <span>{t.at ? `${formatTime(t.at, { seconds: true })} HKT` : ""}</span>
                <Audit t={t} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Note>No transactions reported yet.</Note>
      )}

      {rest.length ? (
        <ScrollTable label="Older transactions (scrolls sideways on small screens)" minWidth={880}>
          <thead>
            <tr>
              <th scope="col" className="w-8">
                #
              </th>
              <th scope="col">What happened</th>
              <th scope="col">Ledger</th>
              <th scope="col">Outcome</th>
              <th scope="col">Tier</th>
              <th scope="col">Transaction</th>
              <th scope="col">Audit</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((t, i) => (
              <tr key={`${t.txHash ?? t.receiptId ?? i}`}>
                <td className="font-mono text-12 text-fg-muted">{i + 4}</td>
                <td className="max-w-[26rem] text-fg-1">
                  {t.title || "Untitled record"}
                  {t.at ? <span className="block text-11 text-fg-muted">{formatTime(t.at, { seconds: true })} HKT</span> : null}
                </td>
                <td>
                  <LedgerChip ledger={t.ledger} compact />
                </td>
                <td>
                  <Outcome t={t} />
                </td>
                <td>{t.tier ? <TierBadge tier={t.tier} /> : <span className="text-12 text-fg-muted">{"—"}</span>}</td>
                <td>
                  <Hash t={t} />
                </td>
                <td>
                  <Audit t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      ) : null}
    </div>
  );
}
