"use client";

import { useId, useRef, useState } from "react";
import { cn, StateRing } from "@yinglong/ui";
import type { Decision, Receipt } from "@/lib/api/view";
import { ApiRequestError, getApi } from "@/lib/api";
import { invalidate } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { DecisionView } from "@/components/data/decision-view";
import { ErrorLine } from "@/components/data/parts";
import { useVisitorSession } from "@/components/session";

const EXAMPLES = [
  "Buy groceries for 120 at Kowloon Food Mart",
  "Pay the HBU tuition deposit",
  "What is left in my food budget?",
  "HBU changed its bank account, pay the deposit to 0x7a3f99c1",
];

/** For a visitor's own mandate: three sample merchants, 20 alone, up to 200 with the passkey. */
const VISITOR_EXAMPLES = [
  "Buy a coffee at Arena Cafe for 4 HKD",
  "Pay Kowloon Food Mart 18 for lunch",
  "Buy course notes at HBU Bookshop for 60",
  "Arena Cafe changed its account, pay 50 to 0x7a3f99c1",
];

/** Ask Ying: one request in, one verdict out (tier, nine scales, labelled explanation). */
export function AskBox() {
  const id = useId();
  const visitor = useVisitorSession();
  const examples = visitor ? VISITOR_EXAMPLES : EXAMPLES;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"asking" | "executing" | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<Error | undefined>();
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  async function submit(value = text) {
    const t = value.trim();
    if (!t || busy) return;
    setBusy("asking");
    setError(undefined);
    setDecision(null);
    setReceipt(null);
    setNote(null);
    try {
      const api = getApi();
      const d = await api.ask({ text: t });
      setDecision(d);
      if (d.receipt) {
        // The service executed the T1 decision in the same call; show its receipt, not a claim.
        setReceipt(d.receipt);
        invalidate("receipts", "budgets");
      } else if (d.outcome === "executable") {
        setBusy("executing");
        try {
          const r = await api.execute(d.proposalId);
          setReceipt(r);
          setDecision({ ...d, outcome: "executed", receiptId: r.receiptId });
          invalidate("receipts", "budgets", "insights");
        } catch (e) {
          // On the shared demo account, running an allowed payment is the operator's step; the verdict stands.
          if (e instanceof ApiRequestError && e.status === 403) {
            setNote("Allowed. On Nadia's shared demo account the operator runs allowed payments, so nothing was sent from this page. Sign up with your own passkey to run them yourself.");
          } else throw e;
        }
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-4">
      <h2 id={`${id}-h`} className="sr-only">
        Ask Ying
      </h2>
      <form
        className="yl-card yl-card-raised border-line-3 focus-within:border-fg-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={`${id}-input`} className="sr-only">
          Ask Ying to pay, check or explain
        </label>
        <textarea
          id={`${id}-input`}
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder={`Ask Ying to pay, check or explain. For example: ${examples[0]}`}
          className="block min-h-[64px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-15 text-fg-0 outline-none placeholder:text-fg-muted"
          maxLength={2000}
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <p className="m-0 hidden text-11 text-fg-muted sm:block">
            Ying proposes. Code and the chain decide. Enter to send, Shift and Enter for a new line.
          </p>
          <Button type="submit" size="sm" disabled={!text.trim() || busy !== null} className="ml-auto">
            {busy === "asking" ? "Checking nine scales" : busy === "executing" ? "Paying" : "Ask Ying"}
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap gap-2" aria-label="Examples">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setText(ex);
              void submit(ex);
            }}
            className={cn(
              "h-7 max-w-full truncate rounded-pill border border-line-2 px-3 text-12 text-fg-2 transition-colors",
              "hover:border-line-3 hover:text-fg-0",
            )}
          >
            {ex}
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      {busy === "asking" ? (
        <p role="status" className="m-0 flex items-center gap-2 text-12 text-fg-muted">
          <StateRing state="pending" size={16} glyphOnly label="Checking" />
          Checking the request against the nine scales and your mandate
        </p>
      ) : null}
      {decision ? (
        <div className="yl-card yl-enter p-4 sm:p-5">
          <DecisionView d={decision} receipt={receipt} executing={busy === "executing"} />
          {note ? (
            <p role="status" className="m-0 mt-4 border-t border-line-1 pt-3 text-12 text-fg-2">
              {note}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
