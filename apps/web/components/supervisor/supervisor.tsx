"use client";

import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { cn, LabelChip, shortHash, StateRing } from "@yinglong/ui";
import type { MerkleProof, PrivateMandate, Receipt, RegistryAgent } from "@/lib/api/view";
import { getApi } from "@/lib/api";
import { ApiRequestError, isPromise } from "@/lib/api/client";
import { invalidate, useAgent } from "@/lib/api/hooks";
import { verifyMerklePath, type MerkleStep } from "@/lib/chain";
import { formatTime, JURISDICTION_LABEL } from "@/lib/format";
import { Sheet, ConfirmDialog } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useMotionOff } from "@/components/preferences";
import { ErrorLine, LedgerChip, Loading, ReceiptOutcomeRing, TxLink } from "@/components/data/parts";
import { PageHeader, Panel } from "@/components/data/panel";

const STATUS: Record<RegistryAgent["status"], { ring: Parameters<typeof StateRing>[0]["state"]; word: string }> = {
  active: { ring: "verified", word: "Active" },
  paused: { ring: "paused", word: "Paused" },
  revoked: { ring: "refused", word: "Revoked" },
  "self-registered": { ring: "refused", word: "Self-registered" },
};

async function resolve<T>(v: T | Promise<T>): Promise<T> {
  return isPromise(v) ? await v : v;
}

/** Merkle path leaf -> root -> anchors as a stepped list; stamps turn steel only when roots match. */
function MerklePath({ proof, steps, revealed, matches }: { proof: MerkleProof; steps: MerkleStep[]; revealed: number; matches: boolean }) {
  const rows: Array<{ label: string; hash: string; note?: string; kind: "leaf" | "node" | "root" | "anchor"; ok?: boolean; ledger?: MerkleProof["anchors"][number] }> = [
    { label: "Leaf", hash: proof.leaf, note: "receipt hash", kind: "leaf" },
    ...steps.map((s) => ({
      label: `Level ${s.level}`,
      hash: s.result,
      note: `sibling ${shortHash(s.sibling, 8, 6)}${s.position ? ` on the ${s.position}` : " (sorted pair)"}`,
      kind: "node" as const,
    })),
    { label: "Root", hash: verifyMerklePath(proof).root, note: matches ? "recomputed root equals the anchored root" : "recomputed root differs", kind: "root", ok: matches },
    ...proof.anchors.map((a) => ({
      label: a.ledger === "fisco" ? "FISCO anchor" : a.ledger === "base-sepolia" ? "Base anchor" : "Bench anchor",
      hash: a.txHash,
      note: a.root ? (a.root.toLowerCase() === proof.root.toLowerCase() ? "root read on chain matches" : "root on chain differs") : "root as reported by the service; open the transaction to read it",
      kind: "anchor" as const,
      ok: a.root ? a.root.toLowerCase() === proof.root.toLowerCase() && matches : matches,
      ledger: a,
    })),
  ];
  return (
    <ol className="m-0 grid list-none gap-0 p-0" aria-label="Merkle path from the receipt to the anchors">
      {rows.map((r, i) => {
        const shown = i < revealed;
        const steel = shown && (r.kind === "root" || r.kind === "anchor") && r.ok;
        return (
          <li key={`${r.label}-${i}`} className="relative grid grid-cols-[20px_1fr] gap-x-3 pb-4 last:pb-0">
            {i < rows.length - 1 ? <span aria-hidden="true" className="absolute top-5 bottom-0 left-[9.5px] w-px bg-line-2" /> : null}
            <span className={cn("relative z-[1] mt-0.5 transition-colors duration-300", steel ? "text-steel" : shown ? "text-fg-1" : "text-fg-faint")}>
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <circle cx="10" cy="10" r="7.5" fill="var(--bg-1)" stroke="currentColor" strokeWidth="1.5" strokeDasharray={shown ? undefined : "2 2.4"} />
                {steel ? <circle cx="16.5" cy="6.3" r="2.6" fill="currentColor" /> : null}
                {shown && !steel && r.kind !== "anchor" && r.kind !== "root" ? <circle cx="10" cy="10" r="2.4" fill="currentColor" /> : null}
              </svg>
            </span>
            <div className="min-w-0">
              <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-13">
                <span className={cn("font-medium", shown ? "text-fg-0" : "text-fg-muted")}>{r.label}</span>
                {r.note ? <span className="text-12 text-fg-muted">{r.note}</span> : null}
              </p>
              {r.kind === "anchor" && r.ledger ? (
                <div className="mt-1">
                  <TxLink ledger={r.ledger.ledger} hash={r.hash} href={r.ledger.explorerUrl} label={steel ? "Anchored" : "Anchor tx"} />
                </div>
              ) : (
                <p className={cn("m-0 mt-0.5 font-mono text-12 break-all", steel ? "text-steel" : "text-fg-2")}>{r.hash}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PrivateMandateCard({ agentId }: { agentId: string }) {
  const q = useAgent(`zk:${agentId}`, (api) => api.privateMandate(agentId), ["zk"]);
  const [checked, setChecked] = useState(false);
  const pm: PrivateMandate | undefined = q.data;
  return (
    <section aria-labelledby="pm-h" className="grid gap-3 rounded-card border border-line-2 bg-bg-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="pm-h" className="m-0 text-13 font-semibold text-fg-0">
          Private mandate
        </h3>
        <LabelChip>Noir proof, ERC-8262-style router</LabelChip>
      </div>
      {q.error ? <p className="m-0 text-12 text-fg-muted">{q.error.message}</p> : null}
      {pm ? (
        <>
          <p className="m-0 text-12 text-fg-muted">
            Terms are hidden behind a commitment <span className="font-mono text-fg-2">{shortHash(pm.commitment, 8, 6)}</span>. The supervisor sees what the proof establishes, never the cap or the allowlist.
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {pm.statements.map((s, i) => (
              <li key={i} className="grid grid-cols-[16px_1fr] items-start gap-2 text-12">
                {checked ? (
                  <StateRing state={pm.proofStatus === "verified" ? "verified" : "refused"} size={16} glyphOnly label={pm.proofStatus} />
                ) : (
                  <span aria-hidden="true" className="mt-1 block h-2 w-2 rounded-pill border border-line-3" />
                )}
                {checked ? (
                  <span className="text-fg-1">{s}</span>
                ) : (
                  <span aria-label="Hidden until the proof is checked" className="block h-3.5 rounded-[3px] bg-line-2" style={{ width: `${62 + ((i * 17) % 30)}%` }} />
                )}
              </li>
            ))}
          </ul>
          {checked ? (
            pm.verifierTx ? (
              <TxLink ledger={pm.verifierTx.ledger} hash={pm.verifierTx.txHash} href={pm.verifierTx.explorerUrl} badge={pm.verifierTx.badge} label={pm.proofStatus === "verified" ? "Proof verified" : "Proof"} />
            ) : (
              <StateRing state="pending" size={16} label="No verifier transaction yet" />
            )
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setChecked(true)} className="justify-self-start">
              Check the proof
            </Button>
          )}
        </>
      ) : null}
    </section>
  );
}

function VerifyDrawer({ agent, onClose }: { agent: RegistryAgent | null; onClose: () => void }) {
  const motionOff = useMotionOff();
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [pick, setPick] = useState<Receipt | null>(null);
  const [proof, setProof] = useState<MerkleProof | null>(null);
  const [error, setError] = useState<Error | undefined>();
  const [revealed, setRevealed] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReceipts(null);
    setPick(null);
    setProof(null);
    setRevealed(0);
    setError(undefined);
    if (!agent) return;
    resolve(getApi().agentReceipts(agent.agentId)).then(
      (list) => {
        setReceipts(list);
        setPick(list.find((r) => r.anchor) ?? list[0] ?? null);
      },
      (e: Error) => setError(e),
    );
  }, [agent]);

  async function verify() {
    if (!pick) return;
    setBusy(true);
    setError(undefined);
    setRevealed(0);
    try {
      const p = await resolve(getApi().receiptProof(pick.receiptId));
      setProof(p);
      const total = 2 + p.path.length + p.anchors.length;
      if (motionOff) setRevealed(total);
      else for (let i = 1; i <= total; i++) setTimeout(() => setRevealed(i), i * 140);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  const v = proof ? verifyMerklePath(proof) : null;
  return (
    <Sheet
      open={agent !== null}
      onOpenChange={(o) => !o && onClose()}
      title={agent ? `Verify ${agent.agentName}` : "Verify"}
      description="Pick a receipt, recompute its Merkle path here, and compare the root with the anchors on chain."
      width={520}
    >
      <div className="grid gap-6">
        <ErrorLine error={error} />
        {receipts === null && !error ? <Loading rows={3} /> : null}
        {receipts && receipts.length === 0 ? <p className="m-0 text-13 text-fg-muted">This agent has no receipts yet.</p> : null}
        {receipts && receipts.length > 0 ? (
          <fieldset className="m-0 grid gap-1.5 border-0 p-0">
            <legend className="eyebrow mb-2 text-fg-muted">Receipt</legend>
            {receipts.slice(0, 6).map((r) => (
              <label
                key={r.receiptId}
                className={cn(
                  "grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-control border px-3 py-2 text-13",
                  pick?.receiptId === r.receiptId ? "border-fg-2 bg-bg-2" : "border-line-2 hover:border-line-3",
                )}
              >
                <input
                  type="radio"
                  name="receipt"
                  checked={pick?.receiptId === r.receiptId}
                  onChange={() => {
                    setPick(r);
                    setProof(null);
                    setRevealed(0);
                  }}
                  className="accent-[var(--fg-1)]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-fg-1">{r.summary}</span>
                  <span className="block text-11 text-fg-muted">
                    {formatTime(r.timestamp)} {r.anchor ? "· anchored" : "· not anchored yet"}
                  </span>
                </span>
                <ReceiptOutcomeRing r={r} />
              </label>
            ))}
          </fieldset>
        ) : null}
        {pick ? (
          <Button onClick={() => void verify()} disabled={busy || !pick.anchor} className="justify-self-start">
            {busy ? "Fetching" : pick.anchor ? "Fetch roots and verify" : "Not anchored yet"}
          </Button>
        ) : null}
        {proof && v ? (
          <div className="grid gap-4">
            <MerklePath proof={proof} steps={v.steps} revealed={revealed} matches={v.matches} />
            {revealed >= 2 + proof.path.length + proof.anchors.length ? (
              <p role="status" className="m-0">
                <StateRing
                  state={v.matches ? "verified" : "refused"}
                  size={20}
                  label={v.matches ? "Receipt is in the anchored batch" : "Root mismatch: this receipt is not in the anchored batch"}
                />
              </p>
            ) : null}
          </div>
        ) : null}
        {agent ? <PrivateMandateCard agentId={agent.agentId} /> : null}
      </div>
    </Sheet>
  );
}

/** One registry table (demo agents, or the visitors' own agents). */
function RegistryTable({
  agents,
  caption,
  onVerify,
  onHalt,
}: {
  agents: RegistryAgent[];
  caption: string;
  onVerify: (a: RegistryAgent) => void;
  onHalt: (a: RegistryAgent) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1" tabIndex={0} role="region" aria-label={`${caption} (scrolls sideways on small screens)`}>
      <table className="yl-table min-w-[900px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Acts for</th>
              <th scope="col">Passport</th>
              <th scope="col" className="text-right">
                Reputation
              </th>
              <th scope="col" className="text-right">
                Receipts
              </th>
              <th scope="col">Ledger</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={`${a.ledger}:${a.agentId}:${a.wallet}`}>
                <td>
                  <span className="block text-13 font-medium text-fg-0">{a.agentName}</span>
                  <span className="block font-mono text-11 whitespace-nowrap text-fg-muted">
                    #{a.agentId} {shortHash(a.wallet, 6, 4)}
                  </span>
                </td>
                <td>
                  <span className="block text-13 text-fg-1">{a.ownerName}</span>
                  <span className="block text-11 text-fg-muted">{a.jurisdiction ? JURISDICTION_LABEL[a.jurisdiction] : "Unknown jurisdiction"}</span>
                </td>
                <td>
                  {a.trustedAttestations === null ? (
                    <span className="block text-13 text-fg-1">Passport {a.status === "active" ? "active" : a.status}</span>
                  ) : a.trustedAttestations > 0 ? (
                    <span className="block text-13 text-fg-1">
                      {a.trustedAttestations} trusted attestation{a.trustedAttestations === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="block text-13 text-fg-1">No trusted issuer</span>
                  )}
                  <span className="block max-w-[220px] truncate text-11 text-fg-muted" title={a.issuers.join(", ")}>
                    {a.issuers.join(", ") || (a.identityCode ? `Identity code ${a.identityCode} (placeholder)` : a.trustedAttestations === 0 ? "Self-issued credential only" : "Attestations not reported")}
                  </span>
                </td>
                <td className="num text-13 text-fg-1">{a.reputation ?? "—"}</td>
                <td className="num text-13 text-fg-1">{a.receipts ?? "—"}</td>
                <td>
                  <LedgerChip ledger={a.ledger} />
                </td>
                <td>
                  <StateRing state={STATUS[a.status].ring} label={STATUS[a.status].word} />
                </td>
                <td className="whitespace-nowrap">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onVerify(a)}>
                      Verify
                    </Button>
                    <Button size="sm" variant="ghost" disabled={a.status === "paused" || a.status === "revoked"} onClick={() => onHalt(a)}>
                      Pause agent
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
    </div>
  );
}

export function Supervisor() {
  const q = useAgent("registry", (api) => api.registry(), ["registry"]);
  // Demo agents first; visitors' own agents (sign-up with a passkey) grouped below, collapsed.
  const demo = (q.data ?? []).filter((a) => a.kind !== "visitor");
  const visitors = (q.data ?? []).filter((a) => a.kind === "visitor");
  const [verify, setVerify] = useState<RegistryAgent | null>(null);
  const [halt, setHalt] = useState<RegistryAgent | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function confirmHalt() {
    if (!halt) return;
    setBusy(true);
    try {
      await getApi().setHalted(halt.agentId, true);
      setMsg(`${halt.agentName} is paused. The supervisor cannot spend, unpause by itself, or change any mandate.`);
      invalidate("registry");
      setHalt(null);
      setReason("");
    } catch (e) {
      setMsg(
        e instanceof ApiRequestError && e.status === 403
          ? "Supervisory halts on the demo deployment are sent by the operator, so nothing was paused from this browser."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-6 pb-16 sm:px-6 lg:px-8 lg:pt-8">
      <PageHeader
        eyebrow="Supervisor"
        title="Agent registry"
        lead="The regulator node's view of every registered agent: who it acts for, who attests it, and whether its receipts are in the anchored batches. A supervisor can pause an agent identity. It can never spend."
        chips={
          <>
            <LabelChip dotted>Supervisor role played by the team</LabelChip>
            <LabelChip>Pause only, never spend</LabelChip>
          </>
        }
      />
      <ErrorLine error={q.error} className="mt-6" />
      {q.loading && !q.data ? (
        <div className="mt-8">
          <Loading rows={5} />
        </div>
      ) : null}
      {q.data ? (
        <div className="mt-8 grid gap-6">
          <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "Registered agents", value: q.data.length },
              { label: "Active passports", value: q.data.filter((a) => a.status === "active").length },
              { label: "Paused or revoked", value: q.data.filter((a) => a.status === "paused" || a.status === "revoked").length },
              { label: "Self-registered, no trusted issuer", value: q.data.filter((a) => a.status === "self-registered").length },
            ].map((x) => (
              <div key={x.label} className="yl-card grid gap-1 px-4 py-3">
                <dt className="text-12 text-fg-muted">{x.label}</dt>
                <dd className="m-0 font-mono text-22 text-fg-0 tabular">{x.value}</dd>
              </div>
            ))}
          </dl>
          <Panel
            id="registry-h"
            eyebrow="Passport registry"
            title="Scenario agents"
            meta={<span>Verify opens the Merkle path of an agent&apos;s latest receipt and checks it against the anchored roots.</span>}
          >
            <RegistryTable agents={demo} caption="Registered demo agents" onVerify={setVerify} onHalt={setHalt} />
          </Panel>
          {visitors.length ? (
            <details className="yl-card group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-13 text-fg-1">
                <span>
                  <span className="font-semibold text-fg-0">Visitor agents</span>{" "}
                  <span className="font-mono text-fg-muted">{visitors.length}</span>
                  <span className="ml-2 text-fg-muted">signed up with their own passkeys (test units only)</span>
                </span>
                <span className="text-12 text-fg-muted group-open:hidden">Show</span>
                <span className="hidden text-12 text-fg-muted group-open:inline">Hide</span>
              </summary>
              <div className="border-t border-line-2 px-4 pt-2 pb-4">
                <RegistryTable agents={visitors} caption="Visitor agents" onVerify={setVerify} onHalt={setHalt} />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
      {msg ? (
        <p role="status" className="mt-4 text-13 text-fg-1">
          {msg}
        </p>
      ) : null}
      <VerifyDrawer agent={verify} onClose={() => setVerify(null)} />
      <ConfirmDialog
        open={halt !== null}
        onOpenChange={(o) => !o && setHalt(null)}
        title={halt ? `Pause ${halt.agentName}?` : "Pause agent"}
        actions={
          <>
            <Button variant="ghost" onClick={() => setHalt(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmHalt()} disabled={busy || reason.trim().length < 3}>
              {busy ? "Pausing" : "Pause agent identity"}
            </Button>
          </>
        }
      >
        <p className="m-0">
          Every delegation to this agent stops in the next block. The supervisor cannot spend, unpause by itself, or change a mandate.
        </p>
        <label className="mt-4 grid gap-1.5 text-12 text-fg-muted" htmlFor="halt-reason">
          Reason, recorded with the pause
          <textarea
            id="halt-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="rounded-control border border-line-3 bg-bg-2 px-3 py-2 text-13 text-fg-0 outline-none focus:border-fg-2"
            placeholder="Self-issued passport presented to counterparties"
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}

export type { Hex };
