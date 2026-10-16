"use client";

import { useEffect, useState } from "react";
import { cn, LabelChip, shortHash, StateRing } from "@yinglong/ui";
import type { Credential, CredentialVerification } from "@/lib/api/view";
import { ApiRequestError, getApi } from "@/lib/api";
import { invalidate, useAgent } from "@/lib/api/hooks";
import { formatDay, formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ErrorLine, LedgerChip, Loading } from "@/components/data/parts";
import { Panel } from "@/components/data/panel";
import { useMotionOff } from "@/components/preferences";

type Check = { id: string; label: string; ok: boolean; detail?: string };

function checksOf(v: CredentialVerification): Check[] {
  return [
    {
      id: "sig",
      label: "The signature recovers to the issuer",
      ok: v.signatureValid,
      detail: v.recovered ? `recovered ${shortHash(v.recovered, 6, 4)}${v.issuer ? `, issuer ${shortHash(v.issuer, 6, 4)}` : ""}` : "no address recovered",
    },
    { id: "trust", label: `${v.issuerLabel} is a trusted issuer of this mandate`, ok: v.trustedIssuer },
    ...v.receipts.map((r, i) => ({
      id: `r-${r.receiptId}`,
      label: `Cited receipt ${i + 1}: ${!r.found ? "not found" : [r.intact ? "hash intact" : "hash differs", r.confirmed ? "confirmed" : "not confirmed", r.toRentPayee ? "paid the sealed rent payee" : "not to the rent payee", r.ownReceipt ? "this account's own" : "another account's"].join(", ")}`,
      ok: r.ok,
      detail: shortHash(r.receiptId, 8, 6),
    })),
    {
      id: "anchor",
      label: "An anchored receipt commits this credential's hash",
      ok: v.anchorCommitsCredential,
      detail: v.anchorReceiptId ? `receipt ${shortHash(v.anchorReceiptId, 8, 6)}` : undefined,
    },
  ];
}

/** Checks revealed in order, 140 ms apart (docs/MOTION.md, moment 14); all at once when motion is off. */
function VerifyResult({ v }: { v: CredentialVerification }) {
  const checks = checksOf(v);
  const motionOff = useMotionOff();
  const [shown, setShown] = useState(motionOff ? checks.length : 0);
  useEffect(() => {
    if (motionOff) {
      setShown(checks.length);
      return;
    }
    setShown(0);
    const t = setInterval(() => setShown((n) => (n >= checks.length ? n : n + 1)), 140);
    return () => clearInterval(t);
  }, [v.credentialHash, checks.length, motionOff]);
  const done = shown >= checks.length;
  return (
    <div className="grid gap-3" aria-live="polite">
      <ol className="m-0 grid list-none gap-1.5 p-0">
        {checks.map((c, i) => (
          <li key={c.id} className={cn("flex items-start gap-2 text-12 transition-opacity duration-150", i < shown ? "opacity-100" : "opacity-0")} aria-hidden={i < shown ? undefined : true}>
            <StateRing state={c.ok ? "verified" : "refused"} size={16} glyphOnly label={c.ok ? "Passed" : "Failed"} className="mt-px" />
            <span className="min-w-0 text-fg-1">
              {c.label}
              {c.detail ? <span className="block font-mono text-11 text-fg-muted">{c.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {done ? (
        v.valid ? (
          <StateRing state="verified" size={20} label="Valid: every check passed" />
        ) : (
          <StateRing state="refused" size={20} label="Not valid" error={checks.find((c) => !c.ok)?.label} />
        )
      ) : null}
    </div>
  );
}

function CredentialCard({ c }: { c: Credential }) {
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<CredentialVerification | null>(null);
  const [error, setError] = useState<Error | undefined>();
  async function verify() {
    setBusy(true);
    setError(undefined);
    setV(null);
    try {
      setV(await getApi().verifyCredential(c.id));
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="@container" aria-label="Payment-reliability credential">
      <div className="grid gap-4 @[34rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @[34rem]:gap-6">
      <div className="grid content-start gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-13 font-medium text-fg-0">Payment reliability</span>
          <LedgerChip ledger={c.ledger} compact />
        </div>
        <p className="m-0 rounded-control border border-line-3 px-3 py-2 text-12 font-medium text-fg-0">{c.statement}</p>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-12">
          <dt className="text-fg-muted">On-time rent payments</dt>
          <dd className="m-0 font-mono text-fg-0 tabular">{c.onTimePayments}</dd>
          <dt className="text-fg-muted">Period</dt>
          <dd className="m-0 font-mono text-fg-2 tabular">
            {formatDay(c.periodStart)} to {formatDay(c.periodEnd)}
          </dd>
          <dt className="text-fg-muted">Issuer</dt>
          <dd className="m-0 text-fg-2">{c.issuerLabel}</dd>
          <dt className="text-fg-muted">Subject</dt>
          <dd className="m-0 truncate font-mono text-fg-2" title={c.subject}>
            {c.subject.length > 30 ? `${c.subject.slice(0, 18)}...${c.subject.slice(-6)}` : c.subject}
          </dd>
          <dt className="text-fg-muted">Credential hash</dt>
          <dd className="m-0 font-mono text-fg-2" title={c.id}>
            {shortHash(c.id, 8, 6)}
          </dd>
          <dt className="text-fg-muted">Issued</dt>
          <dd className="m-0 font-mono text-fg-2 tabular">{formatTime(c.issuedAt)}</dd>
        </dl>
        <p className="m-0 text-11 leading-relaxed text-fg-muted">Rule: {c.rule}</p>
      </div>
      <div className="grid content-start gap-3 border-t border-line-1 pt-4 @[34rem]:border-t-0 @[34rem]:border-l @[34rem]:pt-0 @[34rem]:pl-6">
        <p className="m-0 text-12 text-fg-2">
          Verification recomputes the EIP-712 hash, recovers the signer and re-checks every cited receipt against the receipt log.
        </p>
        <Button size="sm" variant="secondary" className="justify-self-start" disabled={busy} onClick={() => void verify()}>
          {busy ? "Verifying" : v ? "Verify again" : "Verify credential"}
        </Button>
        <ErrorLine error={error} />
        {v ? <VerifyResult v={v} /> : null}
      </div>
      </div>
    </article>
  );
}

/** Credit building: the payment-reliability credential, labelled as a test credential of a fictional bank. */
export function CredentialsPanel() {
  const q = useAgent("credentials", (api) => api.credentials(), ["credentials"]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const list = q.data ?? [];

  async function request() {
    setBusy(true);
    setNote(null);
    try {
      const r = await getApi().issueCredential();
      setNote(r.verification.valid ? "Issued and verified." : "Issued; verification did not pass.");
      invalidate("credentials", "receipts");
    } catch (e) {
      const err = e as ApiRequestError;
      setNote(
        err?.status === 403
          ? "The fictional bank's issuing key is held by the service: on the demo account the operator asks for the credential. On your own passkey account you can ask yourself."
          : (err?.message ?? "The request failed."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      id="credentials-h"
      eyebrow="Credentials"
      title="Payment-reliability credential"
      meta={<span>Signed by a fictional bank from on-time rent receipts, so a landlord or lender could check the record without seeing your account.</span>}
      footer={<span>Test credential issued by a fictional bank; not a credit score. No real bank, bureau or lender is involved.</span>}
      actions={
        q.data && list.length === 0 ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void request()}>
            {busy ? "Asking" : "Ask for the credential"}
          </Button>
        ) : null
      }
    >
      <ErrorLine error={q.error} />
      {q.loading && !q.data ? <Loading label="Loading credentials" rows={2} /> : null}
      {q.data && list.length === 0 ? (
        <p className="m-0 text-13 text-fg-muted">No credential yet. It needs at least one on-time rent payment on record.</p>
      ) : null}
      <div className="grid gap-6">
        {list.map((c) => (
          <CredentialCard key={c.id} c={c} />
        ))}
      </div>
      {note ? (
        <p role="status" className="m-0 mt-3 text-12 text-fg-2">
          {note}
        </p>
      ) : null}
    </Panel>
  );
}
