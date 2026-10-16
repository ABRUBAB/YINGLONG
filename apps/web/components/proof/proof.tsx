"use client";

import { useMemo, useState } from "react";
import { LabelChip, StateRing } from "@yinglong/ui";
import type { EvidenceSummary } from "@/lib/api/view";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ErrorLine, LedgerChip, Loading, SampleBadge, TxLink } from "@/components/data/parts";
import { ReceiptCertificate } from "@/components/data/receipt-certificate";
import { HealthLine } from "@/components/data/health-line";

const SOURCE: Record<string, string> = {
  "anvil-fork": "Anvil fork",
  "live-base": "Base Sepolia",
  "live-fisco": "FISCO BCOS",
  kaggle: "Kaggle run",
  "user-study": "User study",
  ci: "CI",
};

const SECTIONS = [
  "What a receipt proves, and what it does not",
  "Transactions, each on its ledger",
  "Generated numbers",
  "Same bytecode on two ledgers",
  "One receipt, as a certificate",
  "Verify it yourself",
  "Honest labels",
] as const;

/** On this page: a plain anchor list beside the document on wide screens (never printed, never animated). */
function Contents() {
  return (
    <nav aria-label="On this page" className="no-print sticky top-[calc(var(--nav-h)+40px)] hidden self-start xl:block">
      <p className="eyebrow m-0 text-fg-muted">On this page</p>
      <ol className="m-0 mt-3 grid list-none gap-0.5 border-l border-line-1 p-0">
        {SECTIONS.map((t, i) => (
          <li key={t}>
            <a href={`#s${i + 1}`} className="-ml-px flex gap-2 border-l border-transparent py-1.5 pl-3 text-12 text-fg-2 hover:border-fg-1 hover:text-fg-0">
              <span className="font-mono text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
              {t}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={`s${n}`.replace("s", "sec")} aria-labelledby={`s${n}`} className="grid min-w-0 scroll-mt-[calc(var(--nav-h)+24px)] grid-cols-[minmax(0,1fr)] gap-4 border-t border-line-2 pt-8 print:break-inside-avoid">
      <h2 id={`s${n}`} className="m-0 flex scroll-mt-[calc(var(--nav-h)+24px)] items-baseline gap-4 text-18 font-semibold text-fg-0">
        <span className="font-mono text-13 text-fg-muted">{String(n).padStart(2, "0")}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function codeHashGroups(e: EvidenceSummary) {
  const byName = new Map<string, EvidenceSummary["contracts"]>();
  for (const c of e.contracts) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  return [...byName.entries()].map(([name, list]) => ({
    name,
    list,
    identical: list.length > 1 && list.every((c) => c.codeHash.toLowerCase() === list[0]!.codeHash.toLowerCase()),
  }));
}

export function ProofDocument() {
  const q = useAgent("evidence", (api) => api.evidence(), ["evidence"]);
  const receipts = useAgent("receipts", (api) => api.receipts({ limit: 30 }), ["receipts"]);
  const [copied, setCopied] = useState(false);
  const [allContracts, setAllContracts] = useState(false);
  const e = q.data;
  const cert = e?.receipt ?? receipts.data?.items.find((r) => r.outcome === "confirmed" && r.anchor) ?? receipts.data?.items.find((r) => r.outcome === "confirmed") ?? null;
  const groups = useMemo(() => (e ? codeHashGroups(e) : []), [e]);
  const paired = groups.filter((g) => g.list.length > 1);
  const enforcers = paired.filter((g) => /Enforcer$/.test(g.name));
  const CONTRACTS_SHOWN = 6;
  const shownGroups = allContracts ? groups : groups.slice(0, CONTRACTS_SHOWN);

  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-12 px-4 pt-10 pb-20 sm:px-6 xl:grid-cols-[220px_minmax(0,880px)] xl:px-8">
    <Contents />
    <article className="min-w-0">
      <header className="grid gap-4">
        <p className="eyebrow m-0 text-fg-muted">Proof</p>
        <h1 className="type-display m-0 text-32 leading-tight text-fg-0 sm:text-[2.6rem]">Real blockchain records you can check yourself</h1>
        <p className="measure m-0 text-15 text-fg-2">
          Every claim we make is listed here with a link to the blockchain record behind it. Click any link to open the record. Nothing here
          is typed by hand: it is all generated from our code and the blockchains.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <LabelChip>Test units</LabelChip>
          <LabelChip>Base Sepolia (testnet)</LabelChip>
          <LabelChip>FISCO BCOS (team-run consortium ledger)</LabelChip>
          <LabelChip dotted>Anvil bench (simulated)</LabelChip>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-12 text-fg-muted">
          {e ? <span>Generated {formatTime(e.generatedAt, { seconds: true })} HKT</span> : null}
          {e ? <span className="font-mono">commit {e.commit}</span> : null}
          {e ? <span>{e.generator}</span> : null}
          <SampleBadge />
          <Button size="sm" variant="secondary" className="no-print" onClick={() => window.print()}>
            Print or save as PDF
          </Button>
        </div>
      </header>

      <ErrorLine error={q.error} className="mt-6" />
      {q.loading ? (
        <div className="mt-8">
          <Loading rows={6} />
        </div>
      ) : null}

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-12">
        <Section n={1} title="What a receipt proves, and what it does not">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
            <table className="yl-table min-w-[560px]">
              <thead>
                <tr>
                  <th scope="col">It proves</th>
                  <th scope="col">It does not prove</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["The user's passkey sealed mandate M", "That the user wanted this specific action, only that it was inside M"],
                  ["Agent A (passport P) executed X through delegation D bound to M", "That the model's reasoning was correct"],
                  ["The enforcers allowed X or reverted it with a typed error", "That off-chain components were uncompromised; it commits to what they reported"],
                  ["The decision record existed before submission", "That counterparties are honest beyond their attestations"],
                  ["The receipt is in a Merkle root anchored on the ledgers its proof lists", "Legal validity of the underlying contract"],
                ].map(([a, b]) => (
                  <tr key={a}>
                    <td className="text-fg-1">{a}</td>
                    <td className="text-fg-2">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section n={2} title="Transactions, each on its ledger">
          {e && e.hashes.length ? (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
              <table className="yl-table min-w-[640px]">
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
              </table>
            </div>
          ) : (
            <p className="m-0 text-13 text-fg-muted">No transactions reported yet.</p>
          )}
        </Section>

        <Section n={3} title="Generated numbers">
          {e && e.metrics.length ? (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
              <table className="yl-table min-w-[640px]">
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    <th scope="col" className="text-right">
                      Value
                    </th>
                    <th scope="col" className="text-right">
                      n
                    </th>
                    <th scope="col">95% interval</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {e.metrics.map((m) => (
                    <tr key={m.id}>
                      <td className="text-fg-1">
                        {m.label}
                        {m.note ? <span className="block text-11 text-fg-muted">{m.note}</span> : null}
                      </td>
                      <td className="num text-fg-0">{m.value}</td>
                      <td className="num text-fg-2">{m.n ?? "—"}</td>
                      <td className="font-mono text-12 text-fg-2">{m.interval ? `${m.interval[0]} to ${m.interval[1]}` : "—"}</td>
                      <td>
                        <LabelChip dotted={m.source === "anvil-fork"}>{SOURCE[m.source] ?? m.source}</LabelChip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="m-0 flex items-center gap-2 text-13 text-fg-2">
              <StateRing state="pending" size={16} label="No generated numbers yet" />
              Numbers appear here only after the generator publishes them.
            </p>
          )}
          {isSample ? <p className="m-0 text-12 text-fg-muted">Sample values for layout only. The real table is written by the evidence generator.</p> : null}
        </Section>

        <Section n={4} title="Same bytecode on two ledgers">
          {paired.length ? (
            <p className="m-0 text-15 text-fg-1">
              <span className="font-mono">{paired.filter((g) => g.identical).length}</span> of <span className="font-mono">{paired.length}</span> contracts deployed on both
              ledgers have identical code hashes
              {enforcers.length ? (
                <>
                  {"; "}
                  <span className="font-mono">{enforcers.filter((g) => g.identical).length}</span> of <span className="font-mono">{enforcers.length}</span> caveat enforcers
                </>
              ) : null}
              .
            </p>
          ) : null}
          {groups.length ? (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
              <table className="yl-table min-w-[640px]">
                <thead>
                  <tr>
                    <th scope="col">Contract</th>
                    <th scope="col">Ledger</th>
                    <th scope="col">Address</th>
                    <th scope="col">Code hash</th>
                  </tr>
                </thead>
                <tbody>
                  {shownGroups.flatMap((g) =>
                    g.list.map((c, i) => (
                      <tr key={`${g.name}-${c.ledger}`}>
                        <td className="text-fg-1">
                          {i === 0 ? g.name : ""}
                          {i === 0 && g.list.length > 1 ? (
                            <span className="mt-1 block">
                              <StateRing state={g.identical ? "verified" : "refused"} label={g.identical ? "Identical code hash" : "Code hashes differ"} />
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
              </table>
            </div>
          ) : (
            <p className="m-0 text-13 text-fg-muted">The code-hash table has not been published yet.</p>
          )}
          {groups.length > CONTRACTS_SHOWN ? (
            <div className="print:hidden">
              <Button variant="secondary" size="sm" aria-expanded={allContracts} onClick={() => setAllContracts((v) => !v)}>
                {allContracts ? `Show the first ${CONTRACTS_SHOWN} contracts` : `Show all ${groups.length} contracts`}
              </Button>
            </div>
          ) : null}
          <p className="m-0 text-12 text-fg-muted">Equality is computed on this page from the published code hashes, not asserted.</p>
        </Section>

        <Section n={5} title="One receipt, as a certificate">
          {cert ? <ReceiptCertificate r={cert} /> : <p className="m-0 text-13 text-fg-muted">No confirmed receipt yet.</p>}
        </Section>

        <Section n={6} title="Verify it yourself">
          <p className="measure m-0 text-15 text-fg-2">
            One command prints the mandate as English sentences, recomputes the delegation hash, checks its status and the enforcer code hashes on both
            ledgers, and draws the Hash Ring. It runs offline with a bundled snapshot.
          </p>
          <div className="relative rounded-card border border-line-2 bg-bg-2">
            <pre tabIndex={0} aria-label="Verify command" className="m-0 overflow-x-auto px-4 py-4 pr-24 font-mono text-12 leading-relaxed text-fg-1">
              <code>{e?.verifyCommand ?? "yinglong verify samples/nadia.delegation.json --chain base-sepolia"}</code>
            </pre>
            <Button
              size="sm"
              variant="secondary"
              className="no-print absolute top-3 right-3"
              onClick={() => {
                navigator.clipboard?.writeText(e?.verifyCommand ?? "").then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Section>

        <Section n={7} title="Honest labels">
          <ul className="m-0 grid list-none gap-2 p-0 text-13 text-fg-1">
            {[
              "Test units only: tHKD is a simulation of a regulated instrument, not issued by any licensee.",
              "The mainland rail is coin-free. Settlement is played by an e-CNY-style simulator; it is not the PBoC sandbox and has no connection to any bank.",
              "Base Sepolia is a public testnet. The FISCO BCOS chain is run by the team; anchoring proves consistency, not consensus.",
              "Explanations are AI-generated and labelled. They never decide; the facts come from code and the chain.",
              "No bank partnership, no licence, no issued identity code, no third-party audit, no production readiness.",
            ].map((s) => (
              <li key={s} className="flex items-start gap-2.5">
                <StateRing state="unknown" size={16} glyphOnly label="Label" className="mt-0.5" />
                {s}
              </li>
            ))}
          </ul>
        </Section>

        <section className="grid gap-3 border-t border-line-2 pt-8">
          <HealthLine />
          <p className="m-0 text-12 text-fg-muted">
            All third-party marks are the property of their respective owners. No partnership, sponsorship or endorsement is implied.
          </p>
        </section>
      </div>
    </article>
    </div>
  );
}
