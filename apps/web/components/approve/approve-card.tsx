"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { cn, LabelChip, LiveStatusO, OutputChip, shortHash, StateRing } from "@yinglong/ui";
import type { ApprovalRequest, Receipt } from "@/lib/api/view";
import { getApi } from "@/lib/api";
import { invalidate, useAgent } from "@/lib/api/hooks";
import { decodePayment, executionHash, UndecodableExecution, type DecodedPayment } from "@/lib/chain";
import { formatAmount, formatTime, formatUnits } from "@/lib/format";
import { guardSigningRequest } from "@/lib/signing-guard";
import { reviewRevoke, type RevokeContext } from "@/lib/account-ops";
import { availableSigner, describeSignError, signAndSubmit, SIGNER_LABEL, type SignerKind } from "@/lib/sign";
import { buttonClass } from "@/components/ui/button";

/** Which signer this device will use, said before anything is signed. */
const SIGNER_CHIP: Record<SignerKind, string> = { passkey: "Your passkey", key: "Your secret key", scripted: "Demo signature (scripted)", sample: "Sample signature" };
import { ErrorLine, ReceiptOutcomeRing, SampleBadge, TierBadge, TxLink } from "@/components/data/parts";

const eq = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

interface LocalCheck {
  decoded: DecodedPayment | null;
  error: string | null;
  checks: Array<{ label: string; ok: boolean }>;
}

/** The phone's own reading of the call: PaymentDecoder port, executionHash, and the description match. */
function checkLocally(a: ApprovalRequest): LocalCheck {
  if (a.kind === "pause" || a.kind === "resume") {
    // A kill-switch signature moves no funds: the relayer calls tripWithSig/untripWithSig with it.
    // Check that nothing else rides along and that the message is for the kill-switch contract.
    const msg = a.typedData.message as Record<string, unknown>;
    const expected = a.kind === "pause" ? "Trip" : "Untrip";
    const checks: LocalCheck["checks"] = [
      { label: `Signed message is a ${expected} for the kill switch`, ok: a.typedData.primaryType === expected },
      { label: "No funds move with this signature", ok: !a.execution || (BigInt(a.execution.value) === 0n && a.execution.callData === "0x") },
    ];
    if (a.execution) checks.push({ label: "Kill-switch contract matches", ok: eq(String(a.typedData.domain.verifyingContract ?? ""), a.execution.target) });
    if (a.decoded?.payee?.address && typeof msg.account === "string") checks.push({ label: "It names your account", ok: eq(msg.account, a.decoded.payee.address) });
    return { decoded: null, error: null, checks };
  }
  if (!a.execution) return { decoded: null, error: "The agent service did not send the raw call, so this phone could not decode it itself.", checks: [] };
  let pay: DecodedPayment;
  try {
    pay = decodePayment(a.execution.target as Hex, BigInt(a.execution.value), a.execution.callData as Hex);
  } catch (e) {
    return { decoded: null, error: e instanceof UndecodableExecution ? e.message : "This call cannot be decoded; the page will not sign it.", checks: [] };
  }
  const checks: LocalCheck["checks"] = [];
  const d = a.decoded;
  if (d?.amount) checks.push({ label: "Amount matches the agent's description", ok: pay.amount.toString() === d.amount.value });
  if (d?.payee?.address) checks.push({ label: "Payee matches the agent's description", ok: eq(pay.beneficiary, d.payee.address) });
  if (d?.target && pay.method.startsWith("transferAndCall")) checks.push({ label: "Rail contract matches", ok: eq(pay.recipient, d.target) });
  const msgHash = a.typedData.message.executionHash ?? a.typedData.message.executionCallDataHash;
  if (typeof msgHash === "string") {
    checks.push({
      label: "Signed message commits to exactly this call",
      ok: eq(msgHash, executionHash(a.execution.target as Hex, BigInt(a.execution.value), a.execution.callData as Hex)),
    });
  }
  return { decoded: pay, error: null, checks };
}

export function ApproveCard({ id }: { id: string }) {
  const q = useAgent(`approval:${id}`, (api) => api.approval(id), ["approvals"]);
  const [signer, setSigner] = useState<SignerKind | null>(null);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ kind: "approved" | "declined"; receipt: Receipt | null; signer?: SignerKind } | null>(null);

  useEffect(() => {
    availableSigner().then(setSigner, () => setSigner("passkey"));
  }, []);

  const a = q.data;
  // A revoke is checked against the principal's own account, its live mandate and the deployment's
  // MandateRegistry / DelegationManager (read from the service's directory), never against `decoded`.
  const [revoke, setRevoke] = useState<{ ctx: RevokeContext | null; error: string | null } | null>(null);
  useEffect(() => {
    if (a?.kind !== "revoke") return;
    let cancelled = false;
    getApi()
      .revokeContext(a.principal ?? undefined)
      .then(
        (ctx) => !cancelled && setRevoke({ ctx, error: null }),
        (e: Error) => !cancelled && setRevoke({ ctx: null, error: `What a revoke must look like could not be read: ${e.message}` }),
      );
    return () => {
      cancelled = true;
    };
  }, [a?.kind, a?.principal, a?.id]);
  const revokeReview = useMemo(() => (a?.kind === "revoke" && revoke?.ctx ? reviewRevoke(a.typedData, revoke.ctx) : null), [a, revoke]);
  const guard = useMemo(() => (a ? guardSigningRequest(a) : null), [a]);
  const local = useMemo((): LocalCheck | null => {
    if (!a) return null;
    if (a.kind !== "revoke") return checkLocally(a);
    if (revokeReview) return { decoded: null, error: null, checks: revokeReview.checks };
    return { decoded: null, error: revoke?.error ?? "Reading your account and live mandate to check the operation.", checks: [] };
  }, [a, revoke, revokeReview]);
  const expired = a ? a.status === "expired" || Date.parse(a.expiresAt) < Date.now() : false;
  const localOk = local ? !local.error && local.checks.every((c) => c.ok) : false;
  const canApprove = Boolean(a && a.status === "pending" && !expired && guard?.ok && localOk && !done);

  async function approve() {
    if (!a) return;
    setBusy("approve");
    setError(null);
    try {
      const { result, signer: used } = await signAndSubmit(a);
      setDone({ kind: "approved", receipt: result.receipt, signer: used });
      invalidate("approvals", "receipts", "budgets");
    } catch (e) {
      setError(describeSignError(e));
    } finally {
      setBusy(null);
    }
  }
  async function decline() {
    if (!a) return;
    setBusy("decline");
    setError(null);
    try {
      await getApi().declineApproval(a.id);
      setDone({ kind: "declined", receipt: null });
      invalidate("approvals");
    } catch (e) {
      setError(describeSignError(e));
    } finally {
      setBusy(null);
    }
  }

  const amount = a?.decoded?.amount ?? (local?.decoded && a?.decoded?.amount ? a.decoded.amount : null);
  const payeeName = a?.decoded?.payee?.name ?? a?.decoded?.targetName ?? "the payee";

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--nav-h))] w-full max-w-[420px] flex-col px-4 pt-5 pb-10">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <LiveStatusO state={done ? "active" : "waiting"} size={20} className="text-fg-1" />
          <span className="eyebrow text-fg-1">One approval</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <SampleBadge />
          {signer ? <LabelChip dotted={signer !== "passkey"}>{SIGNER_CHIP[signer]}</LabelChip> : null}
        </div>
      </header>

      <main id="main" className="flex-1">
        <ErrorLine error={q.error} />
        {q.loading ? <div role="status" aria-label="Loading approval" className="h-96 rounded-sheet bg-bg-1" /> : null}
        {a ? (
          <article className={cn("grid gap-5 rounded-sheet border bg-bg-1 p-5", !done && a.status === "pending" && !expired ? "border-brass/50" : "border-line-2")} aria-labelledby="apr-title">
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {done?.kind === "approved" ? (
                  <StateRing state="verified" size={16} label="Approved" />
                ) : done?.kind === "declined" || a.status === "declined" ? (
                  <StateRing state="expired" size={16} label="Declined" />
                ) : a.status === "approved" ? (
                  <StateRing state="verified" size={16} label="Already signed" />
                ) : expired ? (
                  <StateRing state="expired" size={16} label="Expired" />
                ) : (
                  <StateRing state="waiting" size={16} label="Needs you" />
                )}
                {a.tier ? <TierBadge tier={a.tier} withName /> : null}
              </div>
              <h1 id="apr-title" className="m-0 text-22 leading-tight font-semibold text-balance text-fg-0">
                {a.kind === "pause" ? (
                  "Pause your agent"
                ) : a.kind === "resume" ? (
                  "Resume your agent"
                ) : a.kind === "revoke" ? (
                  "Revoke your mandate"
                ) : (
                  <>
                    {a.kind === "cosign" ? "Approve " : a.kind === "seal" ? "Seal " : "Sign "}
                    {amount ? <span className="block font-mono text-26 tracking-tight tabular">{formatAmount(amount)}</span> : null}
                    {amount ? <span className="block">to {payeeName}</span> : payeeName}
                  </>
                )}
              </h1>
              {a.reason ? <p className="m-0 text-13 text-fg-2">{a.reason}</p> : null}
            </div>

            <section aria-labelledby="apr-decoded" className="grid gap-2">
              <h2 id="apr-decoded" className="eyebrow m-0 text-fg-muted">
                Decoded on this device
              </h2>
              <dl className="m-0 grid grid-cols-[7.5rem_1fr] gap-x-3 border-t border-line-2 text-13">
                {a.decoded ? (
                  <>
                    <dt className="border-b border-line-1 py-2 text-fg-muted">Contract</dt>
                    <dd className="m-0 border-b border-line-1 py-2 text-fg-1">
                      {a.decoded.targetName}
                      <span className="block font-mono text-11 text-fg-muted">{shortHash(a.decoded.target, 8, 6)}</span>
                    </dd>
                  </>
                ) : null}
                <dt className="border-b border-line-1 py-2 text-fg-muted">Method</dt>
                <dd className="m-0 border-b border-line-1 py-2 font-mono text-12 [overflow-wrap:anywhere] text-fg-1">{(local?.decoded?.method ?? a.decoded?.method ?? "unknown").replace(/,/g, ", ")}</dd>
                {revokeReview ? (
                  <>
                    <dt className="border-b border-line-1 py-2 text-fg-muted">Calls</dt>
                    <dd className="m-0 border-b border-line-1 py-2 text-fg-1">
                      <ol className="m-0 grid list-decimal gap-1 pl-4">
                        {revokeReview.lines.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ol>
                    </dd>
                  </>
                ) : null}
                {a.decoded?.payee ? (
                  <>
                    <dt className="border-b border-line-1 py-2 text-fg-muted">Payee</dt>
                    <dd className="m-0 border-b border-line-1 py-2 text-fg-1">
                      {a.decoded.payee.name}
                      <span className="block text-11 text-fg-muted">
                        {a.decoded.payee.verified ? "In your PayeeBook, verified" : "Not in your PayeeBook"}
                        {a.decoded.payee.address ? <span className="font-mono"> {shortHash(a.decoded.payee.address, 8, 6)}</span> : null}
                      </span>
                    </dd>
                  </>
                ) : null}
                {local?.decoded ? (
                  <>
                    <dt className="border-b border-line-1 py-2 text-fg-muted">Amount</dt>
                    <dd className="m-0 border-b border-line-1 py-2 font-mono text-fg-0 tabular">
                      {a.decoded?.amount ? `${formatUnits(local.decoded.amount, a.decoded.amount.decimals)} ${a.decoded.amount.symbol}` : local.decoded.amount.toString()}
                    </dd>
                  </>
                ) : null}
                <dt className="border-b border-line-1 py-2 text-fg-muted">Ledger</dt>
                <dd className="m-0 border-b border-line-1 py-2 text-fg-1">
                  {a.ledger === "anvil-bench" ? "Anvil bench (simulated)" : a.ledger === "fisco" ? "FISCO BCOS (consortium)" : "Base Sepolia (testnet)"}
                  <span className="block font-mono text-11 text-fg-muted">chain {a.chainId}</span>
                </dd>
                <dt className="py-2 text-fg-muted">Expires</dt>
                <dd className="m-0 py-2 text-fg-1">{formatTime(a.expiresAt)} HKT</dd>
              </dl>
              <p className="m-0 mt-2 text-12 font-medium text-fg-2">Checked on this device before your signer is asked</p>
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {local?.error ? (
                  <li>
                    <StateRing state="refused" size={16} label="Not decodable here" />
                    <span className="mt-1 block text-12 text-fg-muted">{local.error}</span>
                  </li>
                ) : null}
                {local?.checks.map((c) => (
                  <li key={c.label}>
                    <StateRing state={c.ok ? "verified" : "refused"} size={16} label={c.ok ? c.label : `${c.label}: no`} />
                  </li>
                ))}
                {guard ? (
                  <li>
                    <StateRing
                      state={guard.ok ? "verified" : "refused"}
                      size={16}
                      label={guard.ok ? `Signing guard: ${guard.primaryType} message, digest recomputed` : `Signing guard refused: ${guard.reason}`}
                    />
                  </li>
                ) : null}
              </ul>
            </section>

            <section className="grid gap-1.5">
              <p className="eyebrow m-0 text-fg-muted">Your signer signs exactly</p>
              <p className="m-0 rounded-control bg-bg-2 px-3 py-2 font-mono text-12 leading-relaxed break-all text-fg-1">{a.digest}</p>
            </section>

            {a.explanation ? (
              <section className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium text-fg-2">Why</span>
                  {a.aigc ? <OutputChip kind="ai" detail={a.aigc.model} /> : <OutputChip kind="rule" />}
                </div>
                <p className="m-0 text-13 leading-relaxed text-fg-2">{a.explanation}</p>
              </section>
            ) : null}

            {done ? (
              <div className="grid gap-3 border-t border-line-2 pt-4" role="status">
                {done.kind === "approved" ? (
                  <>
                    <p className="m-0 text-13 text-fg-1">Approved with {done.signer ? SIGNER_LABEL[done.signer] : "your signer"}.</p>
                    {done.receipt ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <ReceiptOutcomeRing r={done.receipt} />
                        <TxLink ledger={done.receipt.ledger} hash={done.receipt.txHash} href={done.receipt.explorerUrl} badge={done.receipt.ledgerBadge} label="Transaction" />
                      </div>
                    ) : (
                      <p className="m-0 text-12 text-fg-muted">The agent will submit it; the receipt appears in your console.</p>
                    )}
                  </>
                ) : (
                  <p className="m-0 text-13 text-fg-1">Declined. Nothing was signed and nothing moved.</p>
                )}
                <Link href="/app" className={buttonClass("secondary", "md")}>
                  Back to the console
                </Link>
              </div>
            ) : (
              <div className="grid gap-2 border-t border-line-2 pt-4">
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={!canApprove || busy !== null}
                  className={buttonClass("primary", "lg", "w-full")}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
                    <circle cx="12" cy="12" r="3.2" fill="currentColor" />
                  </svg>
                  {busy === "approve" ? "Waiting for your signer" : signer === "scripted" ? "Approve with the scripted passkey" : signer === "sample" ? "Approve (sample signature)" : "Approve with passkey"}
                </button>
                <p className="m-0 text-center text-11 text-fg-muted">
                  {signer ? `Signs with ${SIGNER_LABEL[signer]}.` : ""} {!canApprove && a.status === "pending" && !expired
                    ? "Approval is blocked until every check above passes."
                    : a.status === "approved"
                      ? "This request has already been signed."
                      : expired
                        ? "This request has expired; ask Ying again for a fresh one."
                        : ""}
                </p>
                <button
                  type="button"
                  onClick={() => void decline()}
                  disabled={busy !== null || a.status !== "pending" || expired}
                  className={buttonClass("quiet", "md", "justify-self-center")}
                >
                  {busy === "decline" ? "Declining" : "Decline"}
                </button>
                {error ? (
                  <p role="alert" className="m-0 text-13 text-fg-1">
                    {error}
                  </p>
                ) : null}
              </div>
            )}
          </article>
        ) : null}
        <p className="mt-5 flex flex-wrap items-center justify-center gap-2 text-11 text-fg-muted">
          <LabelChip>Test units</LabelChip> Numbers on this page never animate.
        </p>
      </main>
    </div>
  );
}
