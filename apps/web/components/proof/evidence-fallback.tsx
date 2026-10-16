"use client";

/**
 * Until the deployed service publishes GET /v1/proof, the page shows what GET /v1/evidence already
 * carries: the transactions of the demo script and the cross-ledger code-hash table.
 */
import { useMemo, useState } from "react";
import { StateRing } from "@yinglong/ui";
import type { EvidenceSummary } from "@/lib/api/view";
import { Button } from "@/components/ui/button";
import { LedgerChip, TxLink } from "@/components/data/parts";
import { Note, ScrollTable } from "./parts";

export function EvidenceTransactions({ e }: { e: EvidenceSummary }) {
  if (!e.hashes.length) return <Note>No transactions reported yet.</Note>;
  return (
    <ScrollTable label="Transactions (scrolls sideways on small screens)" minWidth={640}>
      <thead>
        <tr>
          <th scope="col" className="w-8">
            #
          </th>
          <th scope="col">What happened</th>
          <th scope="col">Ledger</th>
          <th scope="col">Transaction</th>
        </tr>
      </thead>
      <tbody>
        {e.hashes.map((h, i) => (
          <tr key={h.id}>
            <td className="font-mono text-12 text-fg-muted">{i + 1}</td>
            <td className="text-fg-1">
              {h.label}
              {h.typedError ? (
                <span className="mt-1 block">
                  <StateRing state="refused" label="Reverted" error={h.typedError} />
                </span>
              ) : null}
            </td>
            <td>
              <LedgerChip ledger={h.tx.ledger} badge={h.tx.badge} compact />
            </td>
            <td>
              <TxLink ledger={h.tx.ledger} hash={h.tx.txHash} href={h.tx.explorerUrl} badge={h.tx.badge} label="Open" />
            </td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

function groups(e: EvidenceSummary) {
  const byName = new Map<string, EvidenceSummary["contracts"]>();
  for (const c of e.contracts) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  return [...byName.entries()]
    .map(([name, list]) => ({ name, list, enforcer: /Enforcer$/.test(name), identical: list.length > 1 && list.every((c) => c.codeHash.toLowerCase() === list[0]!.codeHash.toLowerCase()) }))
    .sort((a, b) => Number(b.enforcer) - Number(a.enforcer) || a.name.localeCompare(b.name));
}

export function EvidenceContracts({ e }: { e: EvidenceSummary }) {
  const [all, setAll] = useState(false);
  const gs = useMemo(() => groups(e), [e]);
  const paired = gs.filter((g) => g.list.length > 1);
  const enforcers = paired.filter((g) => g.enforcer);
  const SHOWN = 6;
  const shown = all ? gs : gs.slice(0, SHOWN);
  if (!gs.length) return <Note>The code-hash table has not been published yet.</Note>;
  return (
    <div className="grid gap-4">
      {paired.length ? (
        <p className="m-0 text-15 text-fg-1">
          <span className="font-mono tabular-nums">{paired.filter((g) => g.identical).length}</span> of <span className="font-mono tabular-nums">{paired.length}</span> contracts deployed on both ledgers have identical code hashes
          {enforcers.length ? (
            <>
              ; <span className="font-mono tabular-nums">{enforcers.filter((g) => g.identical).length}</span> of <span className="font-mono tabular-nums">{enforcers.length}</span> rule enforcers
            </>
          ) : null}
          .
        </p>
      ) : null}
      <ScrollTable label="Contract code hashes (scrolls sideways on small screens)" minWidth={640}>
        <thead>
          <tr>
            <th scope="col">Contract</th>
            <th scope="col">Ledger</th>
            <th scope="col">Address</th>
            <th scope="col">Code hash</th>
          </tr>
        </thead>
        <tbody>
          {shown.flatMap((g) =>
            g.list.map((c, i) => (
              <tr key={`${g.name}-${c.ledger}`}>
                <td className="text-fg-1">
                  {i === 0 ? <span className="font-mono text-12">{g.name}</span> : ""}
                  {i === 0 && g.list.length > 1 ? (
                    <span className="mt-1 block">
                      <StateRing state={g.identical ? "verified" : "unknown"} label={g.identical ? "Same code" : "Differs"} />
                    </span>
                  ) : null}
                </td>
                <td>
                  <LedgerChip ledger={c.ledger} />
                </td>
                <td className="font-mono text-12 break-all text-fg-2">{c.address}</td>
                <td className="font-mono text-12 break-all text-fg-2">{c.codeHash}</td>
              </tr>
            )),
          )}
        </tbody>
      </ScrollTable>
      {gs.length > SHOWN ? (
        <div className="no-print">
          <Button variant="secondary" size="sm" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? `Show the first ${SHOWN} contracts` : `Show all ${gs.length} contracts`}
          </Button>
        </div>
      ) : null}
      <Note>Equality is computed on this page from the published code hashes, not asserted.</Note>
    </div>
  );
}
