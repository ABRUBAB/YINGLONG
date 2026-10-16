"use client";

import { useId, useState } from "react";
import { StateRing } from "@yinglong/ui";
import type { Decision, TreasuryView } from "@/lib/api/view";
import { ApiRequestError, getApi, isSample } from "@/lib/api";
import { invalidate } from "@/lib/api/hooks";
import { formatAmount, formatUnits, parseUnits } from "@/lib/format";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog, DialogClose } from "@/components/ui/sheet";
import { DecisionView } from "@/components/data/decision-view";
import { ErrorLine } from "@/components/data/parts";
import { Panel } from "@/components/data/panel";
import { SuitabilityCard } from "./suitability";

/**
 * Ask the treasurer agent: one request in, one verdict out, never executed from this page. A sweep
 * into a product carries the suitability card (ProductRegistry risk class against the sealed maximum).
 * Examples come from the mandate's own payee book.
 */
export function TreasurerRequests({ view }: { view: TreasuryView }) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<Decision | null>(null);
  const [error, setError] = useState<Error | undefined>();
  const unit = view.asset?.unit ?? "";
  const products = (view.payees ?? []).filter((p) => p.category === "treasury");
  const suppliers = (view.payees ?? []).filter((p) => p.category === "supplier");
  const examples = [
    ...products.map((p) => `Sweep 10,000 ${unit} into the ${p.label}`),
    ...suppliers.slice(0, products.length ? 1 : 2).map((p) => `Pay ${p.label} 5,000 ${unit} for the next invoice`),
  ].map((s) => s.replace(/\s+/g, " ").trim());

  async function submit(value = text) {
    const t = value.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(undefined);
    setD(null);
    try {
      setD(await getApi().askAs(view.entity.id, { text: t }));
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      id="requests-h"
      eyebrow="Treasurer agent"
      title={products.length ? "Propose a sweep or a payment" : "Propose a payment"}
      meta={<span>Checked against the nine scales and the board&apos;s mandate. Nothing is executed from this page.</span>}
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={`${id}-q`} className="text-12 text-fg-2">
          Request to the treasurer agent of {view.entity.name}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={`${id}-q`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            placeholder={examples[0] ? `For example: ${examples[0]}` : "Describe the payment"}
            className="h-10 min-w-0 flex-1 rounded-control border border-line-3 bg-bg-2 px-3 text-13 text-fg-0 placeholder:text-fg-muted focus:border-fg-2 focus:outline-none"
          />
          <Button type="submit" size="md" variant="secondary" disabled={!text.trim() || busy}>
            {busy ? "Checking" : "Check"}
          </Button>
        </div>
        {examples.length ? (
          <div className="flex flex-wrap gap-2" aria-label="Examples">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setText(ex);
                  void submit(ex);
                }}
                className="yl-press h-7 max-w-full truncate rounded-pill border border-line-2 px-3 text-12 text-fg-2 hover:border-line-3 hover:text-fg-0"
              >
                {ex}
              </button>
            ))}
          </div>
        ) : null}
      </form>
      <ErrorLine error={error} className="mt-3" />
      {d ? (
        <div className="yl-enter mt-5 grid gap-5 border-t border-line-1 pt-5">
          {d.suitability ? <SuitabilityCard s={d.suitability} /> : null}
          <DecisionView d={d} headingLevel="h3" />
        </div>
      ) : null}
    </Panel>
  );
}

/** Payroll: the run goes through the same nine scales, lane and receipt as any payment. */
export function PayrollPanel({ view, next }: { view: TreasuryView; next: { day: number; amount: string } | null }) {
  const id = useId();
  const asset = view.asset;
  const lane = view.lanes.find((l) => l.category === "payroll");
  const payee = (view.payees ?? []).find((p) => p.category === "payroll");
  const last = view.instructions.find((i) => i.kind === "payroll" && i.status === "executed");
  const suggested = next?.amount ?? last?.amount?.value ?? null;
  const [amount, setAmount] = useState(suggested && asset ? formatUnits(suggested, asset.decimals).replace(/,/g, "") : "");
  const [memo, setMemo] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<Decision | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const base = asset ? parseUnits(amount, asset.decimals) : null;
  const memoOk = /^[A-Za-z ._-]{0,60}$/.test(memo);

  async function run() {
    if (!base || !asset) return;
    setConfirm(false);
    setBusy(true);
    setNote(null);
    setD(null);
    try {
      const r = await getApi().runPayroll(view.entity.id, { amount: base.toString(), memo: memo.trim() || undefined });
      setD(r);
      invalidate("treasury", "forecast");
    } catch (e) {
      const err = e as ApiRequestError;
      setNote(
        err?.status === 403
          ? "Payroll runs are sent by the operator in this demo: the treasurer agent's signer is held by the service, not by this browser."
          : (err?.message ?? "The payroll run failed."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!payee || !asset) {
    return (
      <Panel id={`${id}-h`} eyebrow="Payroll" title="No payroll payee sealed">
        <p className="m-0 text-13 text-fg-muted">This entity&apos;s mandate names no payroll account, so the agent cannot run payroll.</p>
      </Panel>
    );
  }

  return (
    <Panel
      id={`${id}-h`}
      eyebrow="Payroll"
      title={`To ${payee.label}`}
      meta={<span>A payroll run is a request through the same nine scales and the payroll lane; above the lane it becomes a board proposal.</span>}
    >
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-12">
        {lane ? (
          <>
            <dt className="text-fg-muted">Payroll lane this month</dt>
            <dd className="m-0 text-right font-mono text-fg-1 tabular">
              {formatUnits(lane.spent.value, lane.spent.decimals, 0)} of {formatUnits(lane.cap.value, lane.cap.decimals, 0)}
            </dd>
          </>
        ) : null}
        {last?.amount ? (
          <>
            <dt className="text-fg-muted">Last run</dt>
            <dd className="m-0 text-right font-mono text-fg-1 tabular">{formatAmount(last.amount)}</dd>
          </>
        ) : null}
        {next ? (
          <>
            <dt className="text-fg-muted">Next in the forecast</dt>
            <dd className="m-0 text-right font-mono text-fg-1 tabular">{next.day === 0 ? "today" : `day ${next.day}`}</dd>
          </>
        ) : null}
      </dl>
      <form
        className="mt-4 grid gap-3 border-t border-line-1 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (base && memoOk) setConfirm(true);
        }}
      >
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-amt`} className="text-12 text-fg-2">
            Amount ({asset.symbol})
          </label>
          <input
            id={`${id}-amt`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amount !== "" && !base}
            className="h-10 rounded-control border border-line-3 bg-bg-2 px-3 font-mono text-13 text-fg-0 tabular focus:border-fg-2 focus:outline-none"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-memo`} className="text-12 text-fg-2">
            Memo (letters, spaces, . _ -)
          </label>
          <input
            id={`${id}-memo`}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={60}
            aria-invalid={!memoOk}
            placeholder="November payroll"
            className="h-10 rounded-control border border-line-3 bg-bg-2 px-3 text-13 text-fg-0 placeholder:text-fg-muted focus:border-fg-2 focus:outline-none"
          />
        </div>
        <Button type="submit" variant="secondary" className="justify-self-start" disabled={busy || !base || !memoOk}>
          {busy ? "Running" : "Run payroll"}
        </Button>
      </form>
      {note ? (
        <p role="status" className="m-0 mt-3 flex items-start gap-2 text-12 text-fg-2">
          <StateRing state="unknown" size={16} glyphOnly label="Note" className="mt-px" />
          {note}
        </p>
      ) : null}
      {d ? (
        <div className="yl-enter mt-5 border-t border-line-1 pt-5">
          <DecisionView d={d} headingLevel="h3" />
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Run this payroll?"
        actions={
          <>
            <DialogClose className={buttonClass("quiet", "md")}>Cancel</DialogClose>
            <Button onClick={() => void run()}>Run payroll</Button>
          </>
        }
      >
        <p className="m-0">
          {base ? formatUnits(base, asset.decimals) : ""} {asset.symbol} to {payee.label}
          {memo.trim() ? ` (${memo.trim()})` : ""}. The request goes through the nine scales; inside the payroll lane the agent sends one instruction, otherwise it is refused.
          {isSample ? " Sample data: nothing is sent." : ""}
        </p>
      </ConfirmDialog>
    </Panel>
  );
}
