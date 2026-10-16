"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn, HashRing, OutputChip, StateRing } from "@yinglong/ui";
import type { VisitorDraft } from "@/lib/api/view";
import { compareHashRing } from "@/lib/hash-ring-check";
import { Button } from "@/components/ui/button";
import { ErrorLine, LedgerChip } from "@/components/data/parts";
import { useMotionOff } from "@/components/preferences";

/** Three ways to start, each naming merchants from the fixed visitor catalogue. */
export const SAY_EXAMPLES = [
  "Only Arena Cafe and Kowloon Food Mart. Food at most 120 a day. Ask me above 25, never more than 300 in one payment. Keep 150 in the account.",
  "Coffee and lunch only: Arena Cafe and Kowloon Food Mart, at most 60 a day for food. Ask me above 10. 5 payments an hour at most.",
  "Course books at HBU Bookshop, and food at Kowloon Food Mart up to 80 a day. Never above 250 in one payment. Keep 200. For 7 days.",
];

/**
 * Say: the visitor writes their own rules. Nothing is compiled until they ask, and nothing is signed
 * until the next step shows what the code enforces.
 */
export function SayStep({
  text,
  onText,
  onSee,
  onStandard,
  busy,
  error,
  standardLabel,
  disabled,
}: {
  text: string;
  onText: (t: string) => void;
  onSee: () => void;
  onStandard: () => void;
  busy: boolean;
  error?: Error;
  standardLabel: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-h`} className="yl-card yl-card-raised grid gap-5 p-5 sm:p-7">
      <div className="grid gap-1.5">
        <p className="kicker m-0">Step 1: Write</p>
        <h2 id={`${id}-h`} className="m-0 text-22 font-semibold text-fg-0">
          Tell your agent what it may spend
        </h2>
        <p className="m-0 max-w-[60ch] text-13 text-fg-2">
          Write it like a message: which shops it may pay, how much per day, when it must ask you first, and how much to always keep.
          AI only turns your words into a form; it cannot add numbers you did not write.
        </p>
      </div>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !busy) onSee();
        }}
      >
        <label htmlFor={`${id}-say`} className="sr-only">
          Your rules, in plain English
        </label>
        <textarea
          id={`${id}-say`}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !busy) {
              e.preventDefault();
              onSee();
            }
          }}
          rows={4}
          maxLength={2000}
          placeholder={`For example: ${SAY_EXAMPLES[0]}`}
          className="block min-h-[132px] w-full resize-y rounded-card border border-line-3 bg-bg-1 px-4 py-3.5 text-18 leading-relaxed text-fg-0 outline-none placeholder:text-15 placeholder:text-fg-muted focus:border-fg-2"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-11 text-fg-muted">
          <span>Write in English. Test money only.</span>
          <span className="font-mono tabular">{text.length} / 2000</span>
        </div>
        <div className="grid gap-2" aria-label="Examples">
          <p className="m-0 text-12 text-fg-2">Or start from an example</p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {SAY_EXAMPLES.map((ex, i) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => onText(ex)}
                  className="yl-press grid w-full grid-cols-[1.5rem_minmax(0,1fr)] gap-2 rounded-control border border-line-2 px-3 py-2 text-left text-12 text-fg-2 hover:border-line-3 hover:text-fg-0"
                >
                  <span className="font-mono text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
                  <span>{ex}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={!text.trim() || busy || disabled}>
            {busy ? "Reading your rules..." : "Check my rules"}
          </Button>
          <Button type="button" variant="secondary" size="lg" disabled={busy || disabled} onClick={onStandard}>
            {standardLabel}
          </Button>
        </div>
      </form>
      <ErrorLine error={error} />
    </section>
  );
}

const STATUS_GLYPH: Record<VisitorDraft["diff"][number]["status"], { ring: "verified" | "pending" | "waiting" | "refused"; word: string }> = {
  "as you said": { ring: "verified", word: "As you said" },
  default: { ring: "pending", word: "Default" },
  clamped: { ring: "waiting", word: "Clamped" },
  adjusted: { ring: "waiting", word: "Adjusted" },
  "not enforced": { ring: "refused", word: "Not enforced" },
};

/** Lines arrive in caveat order: 180 ms apart; all at once when motion is off. */
function useReveal(count: number, key: string) {
  const motionOff = useMotionOff();
  const [n, setN] = useState(motionOff ? count : 0);
  useEffect(() => {
    if (motionOff) {
      setN(count);
      return;
    }
    setN(0);
    let k = 0;
    const t = setInterval(() => {
      k += 1;
      setN(k);
      if (k >= count) clearInterval(t);
    }, 180);
    return () => clearInterval(t);
  }, [count, key, motionOff]);
  return n;
}

/**
 * See: what the compiled caveats enforce, decoded back to English, beside what was said. Flagged rows
 * (clamped, adjusted, not enforced) are the only brass here: they wait on the visitor to read them.
 */
export function SeeStep({ d, onEdit, onSeal, busy, sealLabel }: { d: VisitorDraft; onEdit: () => void; onSeal: () => void; busy: boolean; sealLabel: string }) {
  const id = useId();
  const shown = useReveal(d.decodedSentences.length, d.compiled.delegationHash);
  const compiled = shown >= d.decodedSentences.length;
  const ring = compareHashRing(d.compiled.delegationHash, d.serviceHashRing);
  // The step replaces the form: move focus (and the reader) to its heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [d.compiled.delegationHash]);
  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-6">
      <div className="yl-card grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_220px] md:gap-8">
        <div className="grid content-start gap-4">
          <div className="grid gap-1.5">
            <p className="kicker m-0">Step 2: Check</p>
            <h2 id={`${id}-h`} ref={heading} tabIndex={-1} className="m-0 scroll-mt-[calc(var(--nav-h)+24px)] text-22 font-semibold text-fg-0">
              These are the exact rules your agent will follow
            </h2>
            <p className="m-0 text-13 text-fg-2">
              Read back from the final rule set (not from your message), so what you see is what will be enforced. Your agent can do
              nothing outside this list.
            </p>
          </div>
          <ol className="m-0 grid list-none gap-0 p-0" aria-label="Decoded caveats, in order">
            {d.decodedSentences.map((s, i) => (
              <li
                key={`${i}-${s}`}
                className={cn(
                  "grid grid-cols-[2rem_minmax(0,1fr)] gap-2 border-t border-line-1 py-2.5 transition-[opacity,transform] duration-200 ease-[var(--ease-out)] first:border-t-0",
                  i < shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                )}
                aria-hidden={i < shown ? undefined : true}
              >
                <span className="font-mono text-12 text-fg-muted tabular">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-15 text-fg-0">{s}</span>
              </li>
            ))}
          </ol>
          <p className="m-0 font-mono text-11 text-fg-muted tabular" aria-live="polite">
            {compiled ? `${d.decodedSentences.length} rules ready` : `reading rule ${shown + 1} of ${d.decodedSentences.length}`}
            {compiled ? (d.roundTrip.ok ? "; double-checked" : "; check failed") : ""}
          </p>
        </div>
        <div className="grid content-start justify-items-center gap-3 border-t border-line-1 pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-8">
          <HashRing key={d.compiled.delegationHash} hash={d.compiled.delegationHash} size={176} phase="draft" drawIn bare={false} />
          <p className="m-0 text-center text-11 leading-snug text-fg-muted">
            Your rules fingerprint (it changes if any rule changes)
          </p>
          {ring !== "absent" ? (
            <StateRing state={ring === "match" ? "verified" : "refused"} size={16} label={ring === "match" ? "Matches the server" : "Does not match the server"} />
          ) : null}
          <LedgerChip ledger={d.ledger} badge={d.ledgerBadge} compact />
        </div>
      </div>

      <div className="yl-card grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h3 className="m-0 text-15 font-semibold text-fg-0">What you wrote vs. what will be enforced</h3>
            <p className="m-0 text-12 text-fg-muted">
              {d.flagged === 0 ? "Everything is enforced as you wrote it, or uses a safe default." : `Please read ${d.flagged} highlighted row${d.flagged === 1 ? "" : "s"} before you continue.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* The service's own label, verbatim, with the model or parser named. */}
            <OutputChip kind={d.aigc.via === "llm" ? "ai" : "rule"} detail={`${d.aigc.provider} ${d.aigc.model}`} />
          </div>
        </div>
        <p className="m-0 text-11 text-fg-muted">{d.aigc.label}</p>
        <div className="-mx-1 overflow-x-auto px-1" tabIndex={0} role="region" aria-label="Said against enforced (scrolls sideways on small screens)">
          <table className="yl-table min-w-[620px]">
            <caption className="sr-only">Each rule as you said it and as the compiled caveats enforce it</caption>
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">You wrote</th>
                <th scope="col">Will be enforced</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.diff.map((r, i) => {
                const g = STATUS_GLYPH[r.status];
                return (
                  <tr key={`${r.rule}-${i}`} className={cn(r.flagged && "bg-brass-tint hover:bg-brass-tint")}>
                    <td className={cn("align-top", r.flagged && "border-l-2 border-l-brass !pl-3")}>
                      <span className="block text-13 text-fg-0">{r.rule}</span>
                      <span className="block text-11 text-fg-muted">{r.source}</span>
                    </td>
                    <td className="max-w-[220px] align-top text-13 text-fg-2">{r.said ?? <span className="text-fg-muted">not said</span>}</td>
                    <td className="align-top font-mono text-12 text-fg-0">{r.enforced}</td>
                    <td className="align-top">
                      {g.ring === "refused" ? <StateRing state="refused" size={16} label={g.word} /> : <StateRing state={g.ring} size={16} label={g.word} />}
                      {r.note ? <span className="mt-1 block max-w-[220px] text-11 text-fg-1">{r.note}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {d.adjustments.length ? (
          <div className="grid gap-1.5 border-t border-line-1 pt-3">
            <h4 className="m-0 text-12 font-medium text-fg-2">Changed to stay within the test limits</h4>
            <ul className="m-0 grid list-none gap-1 p-0 text-12">
              {d.adjustments.map((a, i) => (
                <li key={`${a.field}-${i}`} className="text-fg-2">
                  <span className="text-fg-0">{a.field}</span>: {a.said ?? "not said"} <span aria-hidden="true">to</span>
                  <span className="sr-only">becomes</span> <span className="font-mono text-fg-0">{a.enforced}</span>{" "}
                  <span className="text-fg-muted">({a.kind}) {a.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {d.payeeBook.length ? (
          <p className="m-0 border-t border-line-1 pt-3 text-12 text-fg-muted">
            Shops your agent may pay: <span className="text-fg-1">{d.payeeBook.map((p) => p.label).join(", ")}</span>.
          </p>
        ) : null}
        {d.note ? <p className="m-0 text-11 text-fg-muted">{d.note}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={onSeal} disabled={busy || !compiled}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
            <circle cx="12" cy="12" r="3.2" fill="currentColor" />
          </svg>
          {sealLabel}
        </Button>
        <Button variant="secondary" size="lg" onClick={onEdit} disabled={busy}>
          Edit
        </Button>
        <span className="text-12 text-fg-muted">Nothing is saved yet. Your fingerprint is asked on the next screen.</span>
      </div>
    </section>
  );
}
