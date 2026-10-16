"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@yinglong/ui";
import type { Decision, Receipt } from "@/lib/api/view";
import { ApiRequestError, getApi, isSample } from "@/lib/api";
import { invalidate } from "@/lib/api/hooks";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useVisitorSession } from "@/components/session";
import { ExecutionGraph } from "./execution-graph";
import { ExecutionResult, RawDrawer } from "./execution-result";
import { graphNodes, pendingNodes, resultKind, takeaway } from "./execution-state";

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

/**
 * Ask Ying: one request in, one live execution view out. The nine checks are drawn as a rail with
 * their real statuses and timings, and the result is one of three clearly different cards.
 */
export function AskBox() {
  const id = useId();
  const visitor = useVisitorSession();
  const examples = visitor ? VISITOR_EXAMPLES : EXAMPLES;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"asking" | "executing" | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [errorAt, setErrorAt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [resolveKey, setResolveKey] = useState(0);
  const lastText = useRef("");
  const ref = useRef<HTMLTextAreaElement>(null);

  async function submit(value = text) {
    const t = value.trim();
    if (!t || busy) return;
    lastText.current = t;
    setBusy("asking");
    setStartedAt(performance.now());
    setError(null);
    setErrorAt(null);
    setDecision(null);
    setReceipt(null);
    setNote(null);
    try {
      const api = getApi();
      const d = await api.ask({ text: t });
      setDecision(d);
      setResolveKey((k) => k + 1);
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
      setErrorAt(formatTime(new Date().toISOString(), { seconds: true }));
    } finally {
      setBusy(null);
    }
  }

  function prefill(value: string) {
    setText(value);
    ref.current?.focus();
    void submit(value);
  }

  const executing = busy === "executing";
  const nodes = useMemo(() => (decision ? graphNodes(decision, receipt, executing) : pendingNodes()), [decision, receipt, executing]);
  const kind = resultKind(decision, receipt, error, executing);
  const lines = kind ? takeaway(kind, decision, receipt, nodes, error) : [];

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
            onClick={() => prefill(ex)}
            className={cn(
              "h-7 max-w-full truncate rounded-pill border border-line-2 px-3 text-12 text-fg-2 transition-colors",
              "hover:border-line-3 hover:text-fg-0",
            )}
          >
            {ex}
          </button>
        ))}
      </div>

      {busy === "asking" ? (
        <div className="yl-card p-4 sm:p-5">
          <ExecutionGraph nodes={nodes} pending startedAt={startedAt} sample={isSample} />
        </div>
      ) : null}

      {kind ? (
        <div className="grid gap-4" aria-live="polite">
          {lines.length ? (
            <ul className="m-0 grid list-none gap-1 p-0" aria-label="Takeaway">
              {lines.map((line, i) => (
                <li key={i} className={i === 0 ? "text-18 font-semibold leading-7 text-fg-0" : "text-13 text-fg-2"}>
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          {decision ? (
            <div className="yl-card yl-enter p-4 sm:p-5">
              <ExecutionGraph nodes={nodes} resolveKey={resolveKey} sample={isSample} />
            </div>
          ) : null}
          <ExecutionResult
            kind={kind}
            decision={decision}
            receipt={receipt}
            nodes={nodes}
            error={error}
            errorAt={errorAt}
            onRetry={() => void submit(lastText.current || text)}
            onPrefill={prefill}
          />
          {note ? (
            <p role="status" className="m-0 rounded-control border border-line-1 px-3 py-2.5 text-12 text-fg-2">
              {note}
            </p>
          ) : null}
          {decision ? <RawDrawer decision={decision} receipt={receipt} /> : null}
        </div>
      ) : null}
    </section>
  );
}
