"use client";

/**
 * /proof, "Check it yourself": one public response (GET /v1/proof) plus GET /v1/health, drawn so a
 * judge can confirm in a minute that the service, the two ledgers, the transactions and the ML
 * results are real. Every value on the page comes from the API; the page computes nothing but
 * equality of code hashes and the live round trip it measures itself.
 */
import { PageHero } from "@/components/fx/page-hero";
import { useState } from "react";
import { LabelChip, StateRing } from "@yinglong/ui";
import { ApiRequestError } from "@/lib/api";
import { useAgent } from "@/lib/api/hooks";
import type { EvidenceSummary, ProofBundle } from "@/lib/api/view";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ErrorLine, Loading, SampleBadge } from "@/components/data/parts";
import { ReceiptCertificate } from "@/components/data/receipt-certificate";
import { LiveStatusCard } from "./live-status";
import { ChainSection } from "./chain-section";
import { TransactionsSection } from "./transactions-section";
import { MlSection } from "./ml-section";
import { BenchSection } from "./bench-section";
import { EvidenceContracts, EvidenceTransactions } from "./evidence-fallback";
import { ExtLink, MonoChip, Note, ProofSection, shortRev } from "./parts";

type Sec = { id: string; title: string };

const FULL: Sec[] = [
  { id: "chain", title: "Same code on both blockchains" },
  { id: "transactions", title: "Every transaction, checkable" },
  { id: "ml", title: "How good is the AI safety model?" },
  { id: "bench", title: "Did any attack move money?" },
];
const FALLBACK: Sec[] = [
  { id: "transactions", title: "Every transaction, checkable" },
  { id: "chain", title: "Same code on both blockchains" },
];
const ALWAYS: Sec[] = [
  { id: "certificate", title: "One receipt, as a certificate" },
  { id: "verify", title: "Verify it yourself" },
  { id: "labels", title: "Honest labels" },
];

const DEFAULT_VERIFY = "yinglong verify samples/nadia.delegation.json --chain base-sepolia";

/** On this page: one row of jump chips under the header; it sticks under the top bar while you read (never printed). */
function Contents({ sections }: { sections: Sec[] }) {
  return (
    <nav aria-label="On this page" className="no-print sticky top-[var(--nav-h)] z-20 -mx-4 mt-8 border-y border-line-1 bg-bg-0/95 px-4 shadow-sm backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <ol className="m-0 flex list-none items-center gap-1 overflow-x-auto p-0 py-2.5 [scrollbar-width:none]">
        <li className="eyebrow mr-2 shrink-0 text-fg-muted">On this page</li>
        {sections.map((s, i) => (
          <li key={s.id} className="shrink-0">
            <a href={`#${s.id}`} className="inline-flex min-h-9 items-center gap-2 rounded-pill border border-transparent px-3 text-12 text-fg-2 transition-colors hover:border-line-2 hover:bg-bg-2 hover:text-fg-0 focus-visible:border-focus">
              <span className="font-mono text-fg-muted tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function BuildLine({ p }: { p: ProofBundle | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-12 text-fg-muted">
      {p?.build.repo ? (
        <span className="inline-flex items-center gap-1.5">
          Code <ExtLink href={p.build.repo}>{p.build.repo.replace(/^https?:\/\//, "")}</ExtLink>
        </span>
      ) : null}
      {p?.build.commit ? (
        <span className="inline-flex items-center gap-1.5">
          This server runs commit{" "}
          <MonoChip href={p.build.commitUrl} title={p.build.commit}>
            {shortRev(p.build.commit)}
          </MonoChip>
        </span>
      ) : null}
      {p?.generatedAt ? <span>Generated {formatTime(p.generatedAt, { seconds: true })} HKT</span> : null}
      <SampleBadge />
      <Button size="sm" variant="secondary" className="no-print" onClick={() => window.print()}>
        Print or save as PDF
      </Button>
    </div>
  );
}

function ProofSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-10">
      {FULL.map((s, i) => (
        <div key={s.id} className="grid gap-4 border-t border-line-2 pt-8">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-13 text-fg-muted tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-18 font-semibold text-fg-muted">{s.title}</span>
          </div>
          <Loading rows={i === 2 ? 6 : 3} label={`Loading: ${s.title}`} />
        </div>
      ))}
    </div>
  );
}

function FailedState({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="yl-card grid gap-3 p-5">
      <p className="m-0 flex items-center gap-2 text-15 font-semibold text-fg-0">
        <StateRing state="unknown" size={20} glyphOnly label="Unavailable" />
        The proof bundle could not be loaded.
      </p>
      <p className="m-0 font-mono text-12 text-fg-2">{error.message}</p>
      <p className="m-0 max-w-[60ch] text-13 text-fg-2">Nothing below is live until the service answers. The status card above keeps checking every 30 seconds.</p>
      <div>
        <Button variant="secondary" size="md" onClick={retry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

function NotYet({ e, error, loading }: { e: EvidenceSummary | undefined; error: Error | undefined; loading: boolean }) {
  const body = (render: (e: EvidenceSummary) => React.ReactNode) => (e ? render(e) : error ? <ErrorLine error={error} /> : loading ? <Loading rows={4} /> : <Note>Nothing published yet.</Note>);
  return (
    <>
      <p className="m-0 flex items-start gap-2 rounded-control border border-line-2 bg-bg-2 px-3 py-2 text-13 text-fg-1">
        <StateRing state="pending" size={16} glyphOnly label="Pending" className="mt-0.5" />
        <span>
          This server does not publish the full proof bundle yet (GET /v1/proof answered 404). It arrives with the next server update. Until then, here is the evidence the service already publishes.
        </span>
      </p>
      <ProofSection n={1} id="transactions" title="Every transaction, checkable" lead="The transactions of the demo script, each on its ledger, with the typed error where the chain refused.">
        {body((ev) => (
          <EvidenceTransactions e={ev} />
        ))}
      </ProofSection>
      <ProofSection n={2} id="chain" title="Same code on both blockchains" lead="The same contracts, deployed on both ledgers, compared by the hash of their runtime bytecode.">
        {body((ev) => (
          <EvidenceContracts e={ev} />
        ))}
      </ProofSection>
    </>
  );
}

export function ProofDocument() {
  const proof = useAgent("proof", (api) => api.proof(), ["proof"]);
  const evidence = useAgent("evidence", (api) => api.evidence(), ["evidence"]);
  const receipts = useAgent("receipts", (api) => api.receipts({ limit: 30 }), ["receipts"]);
  const [copied, setCopied] = useState(false);

  const p = proof.data;
  const e = evidence.data;
  const notYet = !p && proof.error instanceof ApiRequestError && proof.error.status === 404;
  const failed = !p && !!proof.error && !notYet;
  const cert = e?.receipt ?? receipts.data?.items.find((r) => r.outcome === "confirmed" && r.anchor) ?? receipts.data?.items.find((r) => r.outcome === "confirmed") ?? null;
  const verify = e?.verifyCommand ?? DEFAULT_VERIFY;
  const sections: Sec[] = [...(p ? FULL : notYet ? FALLBACK : []), ...ALWAYS];
  const num = (id: string) => sections.findIndex((s) => s.id === id) + 1;

  return (
    <>
      <PageHero
        eyebrow="Proof"
        title="Real blockchain records you can check yourself"
        lead="Everything here comes from the running service and the two blockchains, through one public address. Nothing is typed by hand."
        art="receipts-glass"
        chips={
          <>
            <LabelChip>Test units</LabelChip>
            <LabelChip>Base Sepolia (testnet)</LabelChip>
            <LabelChip>FISCO BCOS (team-run)</LabelChip>
          </>
        }
      >
        <LiveStatusCard service={p?.service ?? null} />
      </PageHero>
      <div className="yl-container pb-20">
      <article className="min-w-0">
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <BuildLine p={p} />
          <LabelChip dotted>Anvil bench (simulated)</LabelChip>
        </div>

        <Contents sections={sections} />

        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
          {proof.loading && !p ? <ProofSkeleton /> : null}
          {failed ? <FailedState error={proof.error!} retry={proof.refetch} /> : null}
          {notYet ? <NotYet e={e} error={evidence.error} loading={evidence.loading} /> : null}

          {p ? (
            <>
              <ProofSection n={num("chain")} id="chain" title="Same code on both blockchains" lead="The rule contracts that decide what the agent may do are deployed on a public testnet and on a consortium ledger. Their runtime bytecode is compared by hash.">
                <ChainSection chain={p.chain} />
              </ProofSection>
              <ProofSection n={num("transactions")} id="transactions" title="Every transaction, checkable" lead="The newest records the service wrote, each with its transaction on the blockchain and a downloadable audit file of the decision behind it.">
                <TransactionsSection tx={p.transactions} />
              </ProofSection>
              <ProofSection fold n={num("ml")} id="ml" title="How good is the AI safety model?" lead="Test results copied from the files the training runs produced, with 95% intervals. The models explain and flag; the rules decide.">
                <MlSection ml={p.ml} sources={p.sources} />
              </ProofSection>
              <ProofSection fold n={num("bench")} id="bench" title="Did any attack move money?" lead="A bench of scripted attacks ran against the full service on a simulated ledger. These are its numbers, as the bench wrote them.">
                <BenchSection bench={p.bench} />
              </ProofSection>
            </>
          ) : null}

          <ProofSection n={num("certificate")} id="certificate" title="One receipt, as a certificate">
            {cert ? <ReceiptCertificate r={cert} /> : receipts.loading || evidence.loading ? <Loading rows={4} /> : <Note>No confirmed receipt yet.</Note>}
          </ProofSection>

          <ProofSection n={num("verify")} id="verify" title="Verify it yourself" lead="One command prints the mandate as English sentences, recomputes the delegation hash, checks its status and the enforcer code hashes on both ledgers, and draws the Hash Ring. It runs offline with a bundled snapshot.">
            <div className="relative rounded-card border border-line-2 bg-bg-2">
              <pre tabIndex={0} aria-label="Verify command" className="m-0 overflow-x-auto px-4 py-4 pr-24 font-mono text-12 leading-relaxed text-fg-1">
                <code>{verify}</code>
              </pre>
              <Button
                size="sm"
                variant="secondary"
                className="no-print absolute top-3 right-3"
                onClick={() => {
                  navigator.clipboard?.writeText(verify).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </ProofSection>

          <ProofSection n={num("labels")} id="labels" title="Honest labels">
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
            <div className="grid gap-3 border-t border-line-1 pt-4 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <p className="m-0 text-12 font-medium text-fg-muted">A receipt proves</p>
                <ul className="m-0 grid list-none gap-1 p-0 text-13 text-fg-1">
                  <li>The owner&apos;s passkey sealed the mandate.</li>
                  <li>The agent acted through a delegation bound to that mandate.</li>
                  <li>The rule contracts allowed the action or reverted it with a typed error.</li>
                  <li>The decision record existed before the transaction was sent.</li>
                  <li>The receipt sits in a Merkle root anchored on the ledgers its proof lists.</li>
                </ul>
              </div>
              <div className="grid content-start gap-1.5">
                <p className="m-0 text-12 font-medium text-fg-muted">It does not prove</p>
                <ul className="m-0 grid list-none gap-1 p-0 text-13 text-fg-2">
                  <li>That the owner wanted this exact action, only that it was inside the rules.</li>
                  <li>That the model&apos;s reasoning was correct.</li>
                  <li>That off-chain parts were uncompromised; it commits to what they reported.</li>
                  <li>That counterparties are honest beyond their attestations.</li>
                  <li>Legal validity of the underlying contract.</li>
                </ul>
              </div>
            </div>
            <Note>All third-party marks are the property of their respective owners. No partnership, sponsorship or endorsement is implied.</Note>
          </ProofSection>
        </div>
      </article>
      </div>
    </>
  );
}
