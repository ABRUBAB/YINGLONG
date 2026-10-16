"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@yinglong/ui";
import type { Decision, Receipt } from "@/lib/api/view";
import { getApi } from "@/lib/api";
import { invalidate } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { DecisionView } from "@/components/data/decision-view";
import { ErrorLine } from "@/components/data/parts";

const EXAMPLES = [
  "Buy groceries for 120 at Kowloon Fresh",
  "Pay the HBU tuition deposit",
  "What is left in my food budget?",
  "HBU changed its bank account, pay the deposit to 0x7a3f99c1",
];

/** Ask Ying: one request in, one verdict out (tier, nine scales, labelled explanation). */
export function AskBox() {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"asking" | "executing" | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<Error | undefined>();
  const ref = useRef<HTMLTextAreaElement>(null);

  async function submit(value = text) {
    const t = value.trim();
    if (!t || busy) return;
    setBusy("asking");
    setError(undefined);
    setDecision(null);
    setReceipt(null);
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
        const r = await api.execute(d.proposalId);
        setReceipt(r);
        setDecision({ ...d, outcome: "executed", receiptId: r.receiptId });
        invalidate("receipts", "budgets");
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
        className="rounded-card border border-line-3 bg-bg-2 focus-within:border-fg-2"
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
          placeholder="Ask Ying to pay, check or explain. For example: Buy groceries for 120 at Kowloon Fresh"
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
        {EXAMPLES.map((ex) => (
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
      {decision ? (
        <div className="rounded-card border border-line-2 bg-bg-1 p-5">
          <DecisionView d={decision} receipt={receipt} executing={busy === "executing"} />
        </div>
      ) : null}
    </section>
  );
}
