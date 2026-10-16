import { cn, StateRing, shortHash } from "@yinglong/ui";
import type { CityReceipt } from "@/lib/api/view";
import { explorerTxUrl } from "@/lib/chain";
import { formatAmount, formatTime, LEDGER_SHORT } from "@/lib/format";
import { LedgerChip, outcomeRing, outcomeWord, TierBadge } from "@/components/data/parts";
import { GLYPH_WORD, NodeGlyphIcon, STATE_WORD, StateCountsInline, StateGlyph } from "./glyphs";
import type { AgentNode, CityEdge, CityModel, CityNode } from "./model";

/** A receipt as one row: outcome ring + word, summary, amount, tier, time and the ledger link. */
export function ReceiptRow({ r, compact, className }: { r: CityReceipt; compact?: boolean; className?: string }) {
  const ring = outcomeRing(r.outcome);
  const href = explorerTxUrl(r.ledger, r.txHash, r.explorerUrl);
  return (
    <li className={cn("grid min-w-0 gap-1 border-t border-line-1 py-2 first:border-t-0", className)}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className={cn("min-w-0 text-13 text-fg-1", compact ? "truncate" : "line-clamp-2")} title={r.summary}>
          {r.summary}
        </span>
        {r.amount ? <span className="shrink-0 font-mono text-12 text-fg-1 tabular">{formatAmount(r.amount)}</span> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {ring === "refused" ? (
          <StateRing state="refused" size={16} label={outcomeWord(r.outcome)} error={r.revertError ?? undefined} />
        ) : (
          <StateRing state={ring} size={16} label={outcomeWord(r.outcome)} />
        )}
        {!compact ? <TierBadge tier={r.tier} /> : null}
        <span className="font-mono text-11 text-fg-muted">{formatTime(r.timestamp, { date: !compact })}</span>
        {r.txHash && href ? (
          <a
            href={href}
            target={href.startsWith("/") ? undefined : "_blank"}
            rel={href.startsWith("/") ? undefined : "noreferrer noopener"}
            className="inline-flex items-center gap-1 font-mono text-11 text-steel underline decoration-steel/50 underline-offset-2 hover:decoration-steel"
          >
            {shortHash(r.txHash)}
            <span className="font-sans text-fg-muted no-underline"> {LEDGER_SHORT[r.ledger]}</span>
          </a>
        ) : (
          <span className="text-11 text-fg-muted">No transaction</span>
        )}
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-2 text-12">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-fg-1">{children}</dd>
    </div>
  );
}

function Mono({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="font-mono text-12 break-all text-fg-2" title={title} translate="no">
      {children}
    </span>
  );
}

function Receipts({ list, compact, empty = "No receipts yet." }: { list: CityReceipt[]; compact?: boolean; empty?: string }) {
  const shown = list.slice(0, compact ? 3 : 8);
  if (!shown.length) return <p className="m-0 text-12 text-fg-muted">{empty}</p>;
  return (
    <div className="grid gap-1">
      <ul className="m-0 grid list-none p-0">
        {shown.map((r) => (
          <ReceiptRow key={r.receiptId} r={r} compact={compact} />
        ))}
      </ul>
      {list.length > shown.length ? <p className="m-0 text-11 text-fg-muted">{list.length - shown.length} earlier receipts in the table below.</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 gap-2">
      <h4 className="eyebrow m-0 text-fg-muted">{title}</h4>
      {children}
    </section>
  );
}

function Mandate({ node, compact }: { node: AgentNode | Extract<CityNode, { kind: "principal" }>; compact?: boolean }) {
  const ps = node.principals;
  if (ps.length > 1) {
    const live = ps.filter((p) => p.mandate?.status === "live").length;
    return (
      <p className="m-0 text-12 text-fg-2">
        {live} of {ps.length} visitor mandates live; each visitor sealed their own with a passkey.
      </p>
    );
  }
  const m = ps[0]?.mandate;
  if (!m) return <StateRing state="unknown" label="No mandate sealed yet" />;
  const href = m.publishTx ? explorerTxUrl(m.publishTx.ledger, m.publishTx.txHash, m.explorerUrl) : undefined;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {m.status === "live" ? <StateRing state="sealed" label="Mandate sealed" /> : <StateRing state="expired" label={m.status === "revoked" ? "Mandate revoked" : "Mandate superseded"} />}
        {m.publishTx && href ? (
          <a href={href} className="font-mono text-11 text-steel underline decoration-steel/50 underline-offset-2 hover:decoration-steel">
            {shortHash(m.publishTx.txHash)}
          </a>
        ) : null}
      </div>
      {m.sentences.length ? (
        <ul className="m-0 grid list-none gap-1 p-0">
          {m.sentences.slice(0, compact ? 2 : 6).map((s) => (
            <li key={s} className="text-12 text-fg-2 before:mr-2 before:text-fg-muted before:content-['\2013']">
              {s}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Passport({ node }: { node: AgentNode }) {
  const p = node.principals[0]!;
  return (
    <dl className="m-0 grid gap-1.5">
      <Field label="Passport">
        <span className="inline-flex items-center gap-1.5">
          <NodeGlyphIcon glyph={node.glyph} size={16} />
          {GLYPH_WORD[node.glyph]}
        </span>
      </Field>
      {node.principals.length === 1 ? (
        <>
          <Field label="Identity code">
            <Mono>{p.agent.identityCode ?? "none"}</Mono> <span className="text-11 text-fg-muted">(test placeholder)</span>
          </Field>
          <Field label="Agent wallet">
            <Mono title={p.agent.wallet}>{shortHash(p.agent.wallet)}</Mono>
          </Field>
          {p.agent.issuers.length ? <Field label="Issuers">{p.agent.issuers.join(", ")}</Field> : null}
          <Field label="Ledger">
            <LedgerChip ledger={p.ledger} badge={p.ledgerBadge} compact />
          </Field>
        </>
      ) : null}
    </dl>
  );
}

function title(model: CityModel, id: string): string {
  return model.nodes.get(id)?.title ?? id;
}

export function itemTitle(model: CityModel, id: string): string {
  const n = model.nodes.get(id);
  if (n) return n.kind === "agent" && n.principals.length === 1 ? `${n.title} (${n.principals[0]!.name})` : n.title;
  const e = model.edges.find((x) => x.id === id);
  if (!e) return id;
  if (e.kind === "mandate") return `Mandate of ${title(model, e.from)}`;
  if (e.kind === "identity") return "Same passport, two mandates";
  return `${title(model, e.from)} to ${title(model, e.to)}`;
}

/** The details of one map element. `compact` is the hover card; the inspector panel shows more. */
export function Details({ model, id, compact, merged }: { model: CityModel; id: string; compact?: boolean; merged?: boolean }) {
  const node = model.nodes.get(id);
  const edge = node ? undefined : model.edges.find((e) => e.id === id);
  if (node) return <NodeDetails model={model} node={node} compact={compact} merged={merged} />;
  if (edge) return <EdgeDetails model={model} edge={edge} compact={compact} />;
  return null;
}

function Head({ glyph, name, sub }: { glyph: React.ReactNode; name: string; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 inline-flex">{glyph}</span>
      <div className="min-w-0">
        <h3 className="m-0 truncate text-15 font-semibold text-fg-0" title={name}>
          {name}
        </h3>
        {sub ? <p className="m-0 text-12 text-fg-muted">{sub}</p> : null}
      </div>
    </div>
  );
}

function NodeDetails({ model, node, compact, merged }: { model: CityModel; node: CityNode; compact?: boolean; merged?: boolean }) {
  switch (node.kind) {
    case "principal":
    case "agent": {
      const group = model.groups.find((g) => g.id === node.group)!;
      const agent = model.nodes.get(group.agent) as AgentNode;
      const owner = model.nodes.get(group.principal)!;
      const household = merged || node.kind === "principal";
      const shared = agent.sharedWith.map((g) => model.nodes.get(`p:${g}`)?.title).filter(Boolean);
      return (
        <div className="grid gap-4">
          <Head
            glyph={<NodeGlyphIcon glyph={household ? owner.glyph : agent.glyph} />}
            name={household ? owner.title : agent.title}
            sub={household ? `${owner.subtitle} · agent ${agent.title}` : `Agent of ${owner.title}`}
          />
          {agent.principals.length > 1 ? (
            <Section title="Visitors">
              <ul className="m-0 grid list-none gap-1 p-0">
                {agent.principals.slice(0, compact ? 3 : 12).map((p) => (
                  <li key={p.id} className="flex min-w-0 items-center justify-between gap-2 text-12">
                    <span className="truncate text-fg-1">{p.name}</span>
                    <span className="inline-flex items-center gap-1.5 text-fg-muted">
                      <NodeGlyphIcon glyph={p.agent.passport} size={16} />
                      <span className="font-mono">{p.agent.identityCode ?? p.agent.agentId}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {model.visitorCount > agent.principals.length ? (
                <p className="m-0 text-11 text-fg-muted">{model.visitorCount - agent.principals.length} older visitors are in the supervisor registry.</p>
              ) : null}
            </Section>
          ) : null}
          <Section title="Passport">
            <Passport node={agent} />
            {shared.length ? <p className="m-0 text-12 text-fg-2">The same passport also acts for {shared.join(", ")} under a second mandate.</p> : null}
          </Section>
          <Section title="Mandate">
            <Mandate node={agent} compact={compact} />
          </Section>
          <Section title={`Receipts${agent.receipts.length ? ` (${agent.receipts.length})` : ""}`}>
            <StateCountsInline counts={agent.counts} />
            <Receipts list={agent.receipts} compact={compact} />
          </Section>
        </div>
      );
    }
    case "counterparty": {
      const listed = node.listedBy.map((pid) => model.groups.find((g) => (model.nodes.get(g.agent) as AgentNode).principals.some((p) => p.id === pid))).filter(Boolean);
      const names = [...new Set(listed.map((g) => model.nodes.get(g!.principal)!.title))];
      return (
        <div className="grid gap-4">
          <Head glyph={<NodeGlyphIcon glyph={node.glyph} />} name={node.title} sub={node.subtitle || undefined} />
          <dl className="m-0 grid gap-1.5">
            <Field label="Status">{GLYPH_WORD[node.glyph]}</Field>
            {node.address ? (
              <Field label="Address">
                <Mono title={node.address}>{compact ? shortHash(node.address) : node.address}</Mono>
              </Field>
            ) : null}
            {node.category ? <Field label="Category">{node.category}</Field> : null}
            <Field label="Payee book of">{names.length ? names.join(", ") : "Nobody: payments here are refused"}</Field>
            {node.registered ? (
              <Field label="Registry">
                {node.registered.identityCode ? <Mono>{node.registered.identityCode}</Mono> : "No identity code"}
                {node.registered.issuers.length ? <span className="text-fg-muted"> · {node.registered.issuers.join(", ")}</span> : null}
              </Field>
            ) : null}
          </dl>
          <Section title={`Receipts${node.receipts.length ? ` (${node.receipts.length})` : ""}`}>
            <StateCountsInline counts={node.counts} />
            <Receipts list={node.receipts} compact={compact} empty="Nobody has paid this address." />
          </Section>
        </div>
      );
    }
    case "regulator":
      return (
        <div className="grid gap-4">
          <Head glyph={<NodeGlyphIcon glyph="regulator" />} name="Regulator node" sub="Observer of the FISCO BCOS consortium" />
          <p className="m-0 text-12 text-fg-2">
            An observer node of the consortium ledger: it holds every block and every instruction, and the supervisor can pause an agent identity from it. It can never
            spend.
          </p>
          <dl className="m-0 grid gap-1.5">
            <Field label="Ledger">{node.ledger?.badge ?? "FISCO BCOS"}</Field>
            <Field label="Status">
              {node.ledger?.ok ? <StateRing state="onchain" label={node.ledger.block ? `Block ${node.ledger.block}` : "Reachable"} /> : <StateRing state="unknown" label="Not reachable" />}
            </Field>
          </dl>
        </div>
      );
    case "anchor":
      return (
        <div className="grid gap-4">
          <Head glyph={<NodeGlyphIcon glyph={node.glyph} />} name={node.title} sub={node.badge} />
          <p className="m-0 text-12 text-fg-2">
            AccountabilityLedger on {LEDGER_SHORT[node.ledger]}: each batch root commits to every receipt in it. Anchoring proves consistency between ledgers, not
            consensus.
          </p>
          <Section title={`Batches${node.batches.length ? ` (${node.batches.length})` : ""}`}>
            {node.batches.length ? (
              <ul className="m-0 grid list-none p-0">
                {node.batches.slice(0, compact ? 3 : 8).map((b) => {
                  const a = b.anchors.find((x) => x.ledger === node.ledger)!;
                  const href = explorerTxUrl(a.ledger, a.txHash);
                  return (
                    <li key={b.batchId} className="grid gap-1 border-t border-line-1 py-2 first:border-t-0">
                      <div className="flex min-w-0 items-baseline justify-between gap-3 text-13">
                        <span className="text-fg-1">Batch {b.batchId}</span>
                        <span className="font-mono text-12 text-fg-2">{b.count} receipts</span>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        <Mono title={b.root}>root {shortHash(b.root)}</Mono>
                        <span className="font-mono text-11 text-fg-muted">{formatTime(b.createdAt, { date: !compact })}</span>
                        {href ? <StateRing state="onchain" label="Anchor" hash={a.txHash} href={href} /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="m-0 text-12 text-fg-muted">
                {model.batchesReadable
                  ? `No batch has been anchored on ${LEDGER_SHORT[node.ledger]} yet.`
                  : "The anchoring relayer's batch list could not be read from this page; each receipt's proof page shows its anchor."}
              </p>
            )}
          </Section>
        </div>
      );
  }
}

function EdgeDetails({ model, edge, compact }: { model: CityModel; edge: CityEdge; compact?: boolean }) {
  const from = title(model, edge.from);
  const to = title(model, edge.to);
  if (edge.kind === "identity")
    return (
      <div className="grid gap-3">
        <Head glyph={<NodeGlyphIcon glyph="attested" />} name="Same passport, two mandates" sub={`${from} · ${to}`} />
        <p className="m-0 text-12 text-fg-2">
          One agent identity acts on both sides of the seam. Each side has its own sealed mandate, so the rail changes with no change of code.
        </p>
      </div>
    );
  if (edge.kind === "anchor" || edge.kind === "observe") return <Details model={model} id={edge.to} compact={compact} />;
  if (edge.kind === "mandate")
    return (
      <div className="grid gap-4">
        <Head glyph={<StateRing state={edge.mandate === "live" ? "sealed" : "expired"} glyphOnly size={20} />} name={`Mandate: ${from}`} sub={`Sealed for ${to}`} />
        <Mandate node={model.nodes.get(edge.to) as AgentNode} compact={compact} />
        <Section title="Seals, pauses and questions">
          <Receipts list={edge.receipts} compact={compact} empty="No control receipts." />
        </Section>
      </div>
    );
  return (
    <div className="grid gap-4">
      <Head
        glyph={<StateGlyph state={edge.state} size={20} />}
        name={`${from} to ${to}`}
        sub={`${STATE_WORD[edge.state]} · ${edge.receipts.length} receipt${edge.receipts.length === 1 ? "" : "s"}`}
      />
      <Receipts list={edge.receipts} compact={compact} />
    </div>
  );
}
