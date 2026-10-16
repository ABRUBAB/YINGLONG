"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, ViewTransition } from "react";
import { cn, HashRing, LabelChip, OutputChip, shortHash, StateRing, type HashRingPhase } from "@yinglong/ui";
import type { Jurisdiction, Mandate, MandateDraft, Receipt } from "@/lib/api/view";
import { getApi, isSample } from "@/lib/api";
import { invalidate, useAgent } from "@/lib/api/hooks";
import { isPromise } from "@/lib/api/client";
import { NADIA_SOURCE } from "@/lib/api/fixtures/source";
import { JURISDICTION_LABEL, RAIL_LABEL, railLabel } from "@/lib/format";
import { availableSigner, describeSignError, signAndSubmit, SIGNER_LABEL, type SignerKind } from "@/lib/sign";
import { compareHashRing } from "@/lib/hash-ring-check";
import { Segmented } from "@/components/ui/controls";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/sheet";
import { ErrorLine, SampleBadge, TierBadge, TxLink } from "@/components/data/parts";
import { SealButton } from "./seal-button";

type Step = 1 | 2 | 3;

function Stepper({ step, sealed }: { step: Step; sealed: boolean }) {
  const steps = [
    { n: 1, label: "Say", hint: "in your words" },
    { n: 2, label: "See", hint: "as rules" },
    { n: 3, label: "Seal", hint: "with your passkey" },
  ] as const;
  return (
    <ol className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0" aria-label="Steps">
      {steps.map((s) => {
        const done = sealed || s.n < step;
        const current = !sealed && s.n === step;
        return (
          <li key={s.n} aria-current={current ? "step" : undefined} className="flex items-center gap-2.5">
            <span
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-pill border font-mono text-11",
                done ? "border-fg-1 bg-fg-1 text-bg-0" : current ? "border-fg-0 text-fg-0" : "border-line-3 text-fg-muted",
              )}
            >
              {s.n}
            </span>
            <span className={cn("text-13", current || done ? "text-fg-0" : "text-fg-muted")}>
              <span className="font-medium">{s.label}</span> <span className="text-fg-muted">{s.hint}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function MandateStudio() {
  const id = useId();
  const mandates = useAgent("mandates", (api) => api.mandates(), ["mandates"]);
  const live = mandates.data?.find((m) => m.status === "live");
  const me = useAgent("me", (api) => api.me(), ["me", "pause"]);
  const [text, setText] = useState<string>(isSample ? NADIA_SOURCE : "");
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>("hk");
  const [draft, setDraft] = useState<MandateDraft | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<Error | undefined>();
  const [reviewed, setReviewed] = useState(false);
  const [phase, setPhase] = useState<HashRingPhase>("draft");
  const [progress, setProgress] = useState(0);
  const [sealing, setSealing] = useState(false);
  const [sealError, setSealError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ mandate: Mandate | null; receipt: Receipt | null; signer: SignerKind } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [signer, setSigner] = useState<SignerKind>(isSample ? "sample" : "passkey");
  const seq = useRef(0);

  // Live mode: start from what the user said for the live mandate.
  useEffect(() => {
    if (!isSample && !text && live?.sourceText) setText(live.sourceText);
  }, [live?.sourceText]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    availableSigner().then(setSigner, () => undefined);
  }, []);

  // Recompile 600 ms after the last keystroke: one changed word, a new Hash Ring.
  useEffect(() => {
    if (!text.trim() || sealed) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setCompiling(true);
      setCompileError(undefined);
      try {
        const d = await getApi().compileMandate({ text, jurisdiction });
        if (n === seq.current) {
          setDraft(d);
          setReviewed(false);
          setPhase("draft");
          setProgress(0);
        }
      } catch (e) {
        if (n === seq.current) setCompileError(e as Error);
      } finally {
        if (n === seq.current) setCompiling(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [text, jurisdiction, sealed]);

  const allMatch = draft ? draft.roundTrip.every((l) => l.matches) && draft.checks.every((c) => c.passed) : false;
  // A preview of the already-sealed mandate (no drafting endpoint on the service) carries no document to seal.
  const sealable = Boolean(draft && draft.wire !== undefined);
  const canSeal = Boolean(draft && sealable && reviewed && allMatch && !compiling);
  const step: Step = !draft ? 1 : !reviewed ? 2 : 3;
  const ringCheck = draft ? compareHashRing(draft.delegationHash, draft.serviceHashRing) : "absent";

  async function seal() {
    if (!draft) return;
    setConfirm(false);
    setSealing(true);
    setSealError(null);
    setPhase("holding");
    setProgress(1);
    try {
      const api = getApi();
      const req = await api.requestSeal(draft);
      const { result, signer: used } = await signAndSubmit(req);
      let mandate: Mandate | null = null;
      try {
        const m = api.mandate(draft.mandateHash);
        mandate = isPromise(m) ? await m : m;
      } catch {
        mandate = null;
      }
      setSealed({ mandate, receipt: result.receipt, signer: used });
      setPhase("sealed");
      invalidate("mandates", "receipts", "budgets");
    } catch (e) {
      setSealError(describeSignError(e));
      setPhase("draft");
      setProgress(0);
    } finally {
      setSealing(false);
    }
  }

  const hasBangla = Array.from(text).some((c) => { const cp = c.codePointAt(0)!; return cp >= 0x0980 && cp <= 0x09ff; });

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-16 sm:px-6 lg:px-8 lg:pt-8">
      <header className="mb-8 grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow m-0 text-fg-muted">Mandate Studio</p>
            <h1 className="type-display m-0 mt-2 text-32 leading-none text-fg-0 sm:text-[2.5rem]">Say it. See it. Seal it.</h1>
            <p className="m-0 mt-3 max-w-[60ch] text-15 text-fg-2">
              Write the rules in your own words. Yinglong compiles them into on-chain caveats, decodes them back into sentences, and
              shows the seal before you give it.
            </p>
          </div>
          <SampleBadge />
        </div>
        <Stepper step={step} sealed={Boolean(sealed)} />
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
        <div className="grid content-start gap-10">
          {/* 1. Say */}
          <section aria-labelledby={`${id}-say`} className="grid gap-4">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-12 text-fg-muted">01</span>
              <h2 id={`${id}-say`} className="m-0 text-15 font-semibold text-fg-0">
                Say it
              </h2>
            </div>
            <label htmlFor={`${id}-text`} className="sr-only">
              Your mandate in your own words
            </label>
            <textarea
              id={`${id}-text`}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSealed(null);
              }}
              rows={5}
              lang={hasBangla ? "bn" : "en"}
              placeholder="Pay my rent, 9,500, to Harbour Homes on the 1st. Keep food under 3,000 a month."
              className="block w-full resize-y rounded-card border border-line-3 bg-bg-2 px-4 py-3.5 text-15 leading-relaxed text-fg-0 outline-none placeholder:text-fg-muted focus:border-fg-2"
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Segmented<Jurisdiction>
                label="Jurisdiction"
                value={jurisdiction}
                onChange={(j) => {
                  setJurisdiction(j);
                  setSealed(null);
                }}
                options={[
                  { value: "hk", label: JURISDICTION_LABEL.hk },
                  { value: "international", label: JURISDICTION_LABEL.international },
                  { value: "mainland", label: JURISDICTION_LABEL.mainland },
                ]}
              />
              <span className="text-12 text-fg-muted">
                {me.data && me.data.jurisdiction === jurisdiction ? railLabel(jurisdiction, me.data.ledgerBadge) : RAIL_LABEL[jurisdiction]}
              </span>
            </div>
            <p className="m-0 text-12 text-fg-muted">
              English, Bangla or Chinese input is fine; the compiled mandate and every rule are in English.
            </p>
          </section>

          {/* 2. See */}
          <section aria-labelledby={`${id}-see`} className="grid gap-4" aria-busy={compiling}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-12 text-fg-muted">02</span>
                <h2 id={`${id}-see`} className="m-0 text-15 font-semibold text-fg-0">
                  See it
                </h2>
              </div>
              <span role="status" className="text-12 text-fg-muted">
                {compiling ? "Compiling" : draft ? `${draft.rules.length} rules, compiled and decoded` : ""}
              </span>
            </div>
            <ErrorLine error={compileError} />
            {draft ? (
              <>
                {draft.warnings.map((w) => (
                  <p key={w} className="m-0 flex items-start gap-2 rounded-control border border-brass/50 bg-brass-tint px-3 py-2 text-13 text-fg-1">
                    <StateRing state="waiting" size={16} glyphOnly label="Note" />
                    {w}
                  </p>
                ))}
                <ol className={cn("m-0 grid list-none gap-0 p-0 transition-opacity", compiling && "opacity-60")}>
                  {draft.rules.map((r, i) => {
                    const rt = draft.roundTrip.find((l) => l.ruleId === r.id);
                    return (
                      <li key={r.id} className="grid grid-cols-[2rem_1fr] gap-x-3 border-t border-line-2 py-3.5">
                        <span className="pt-0.5 font-mono text-12 text-fg-muted tabular">{String(i + 1).padStart(2, "0")}</span>
                        <div className="grid min-w-0 gap-2">
                          <p className="m-0 text-15 text-fg-0">{r.sentence}</p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <OutputChip kind="rule" />
                            <span className="font-mono text-11 text-fg-muted">{r.enforcer}</span>
                            {r.tierCeiling ? <TierBadge tier={r.tierCeiling} withName /> : null}
                            {rt ? (
                              <StateRing
                                state={rt.matches ? "verified" : "refused"}
                                size={16}
                                label={rt.matches ? "Decodes to the same sentence" : "Decoded sentence differs"}
                              />
                            ) : null}
                          </div>
                          {rt && !rt.matches ? <p className="m-0 text-12 text-fg-2">Decoded: {rt.decoded || "nothing"}</p> : null}
                          <details className="group text-12">
                            <summary className="w-fit cursor-pointer list-none text-fg-muted underline decoration-line-3 underline-offset-4 hover:text-fg-1">
                              Parameters (base units)
                            </summary>
                            <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-control bg-bg-2 px-3 py-2">
                              {Object.entries(r.params).map(([k, v]) => (
                                <div key={k} className="contents">
                                  <dt className="font-mono text-fg-muted">{k}</dt>
                                  <dd className="m-0 font-mono break-all text-fg-2">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                                </div>
                              ))}
                              {r.enforcerAddress ? (
                                <div className="contents">
                                  <dt className="font-mono text-fg-muted">enforcer</dt>
                                  <dd className="m-0 font-mono break-all text-fg-2">{r.enforcerAddress}</dd>
                                </div>
                              ) : null}
                            </dl>
                          </details>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <div className="grid gap-2 rounded-card border border-line-2 bg-bg-1 px-4 py-3.5">
                  <p className="eyebrow m-0 text-fg-muted">Round trip</p>
                  <ul className="m-0 grid list-none gap-1.5 p-0">
                    {draft.checks.map((c) => (
                      <li key={c.id}>
                        <StateRing state={c.passed ? "verified" : "refused"} size={16} label={c.label} />
                      </li>
                    ))}
                    {ringCheck !== "absent" ? (
                      <li>
                        <StateRing
                          state={ringCheck === "match" ? "verified" : "refused"}
                          size={16}
                          label={ringCheck === "match" ? "The agent service computes the same Hash Ring" : "The agent service's Hash Ring differs"}
                        />
                      </li>
                    ) : null}
                  </ul>
                </div>
                <label className="flex items-start gap-3 text-13 text-fg-1">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                    disabled={!allMatch || Boolean(sealed)}
                    className="mt-0.5 size-4 accent-[var(--fg-1)]"
                  />
                  <span>
                    I have read every rule. These sentences say what I meant.
                    {!allMatch ? <span className="block text-12 text-fg-muted">Sealing is blocked until every check passes.</span> : null}
                  </span>
                </label>
              </>
            ) : !compiling && !compileError ? (
              <p className="m-0 text-13 text-fg-muted">Write a rule to see it compiled.</p>
            ) : null}
          </section>
        </div>

        {/* 3. Seal */}
        <aside aria-labelledby={`${id}-seal`} className="lg:sticky lg:top-8 lg:self-start">
          <div className="grid gap-5 rounded-sheet border border-line-2 bg-bg-1 p-5 sm:p-6">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-12 text-fg-muted">03</span>
              <h2 id={`${id}-seal`} className="m-0 text-15 font-semibold text-fg-0">
                Seal it
              </h2>
            </div>
            <div className="grid justify-items-center gap-3">
              {draft ? (
                <ViewTransition name="mandate-ring">
                  <HashRing hash={draft.delegationHash} size={264} phase={phase} progress={progress} drawIn={phase === "sealed"} bare />
                </ViewTransition>
              ) : (
                <div className="flex size-[264px] items-center justify-center rounded-pill border border-dashed border-line-3 text-13 text-fg-muted">
                  No draft yet
                </div>
              )}
              <p className="m-0 text-center text-12 text-fg-muted">
                {draft ? (
                  <>
                    Delegation hash <span className="font-mono text-fg-2">{shortHash(draft.delegationHash, 10, 8)}</span>
                    <br />
                    The ring proves hash identity, not mandate correctness.
                  </>
                ) : (
                  "64 ticks from the delegation hash appear here."
                )}
              </p>
            </div>
            {sealed ? (
              <div className="grid gap-3" role="status">
                <StateRing state="sealed" size={20} label={sealed.mandate ? `Sealed: mandate v${sealed.mandate.version}` : "Sealed"} />
                <p className="m-0 text-12 text-fg-muted">Signed with {SIGNER_LABEL[sealed.signer]}.</p>
                {sealed.receipt?.txHash ? (
                  <TxLink ledger={sealed.receipt.ledger} hash={sealed.receipt.txHash} href={sealed.receipt.explorerUrl} badge={sealed.receipt.ledgerBadge} label="Published" />
                ) : null}
                {sealed.mandate?.published.map((t) => (
                  <TxLink key={t.txHash} ledger={t.ledger} hash={t.txHash} href={t.explorerUrl} badge={t.badge} label="Published" />
                ))}
                <Link href="/app" className={buttonClass("secondary", "md")}>
                  Back to the console
                </Link>
              </div>
            ) : (
              <div className="grid gap-3">
                <SealButton
                  disabled={!canSeal}
                  busy={sealing}
                  label="Press and hold to seal"
                  onProgress={(p) => {
                    setProgress(p);
                    setPhase(p > 0 ? "holding" : "draft");
                  }}
                  onComplete={() => void seal()}
                  onConfirmPath={() => canSeal && setConfirm(true)}
                />
                <p id="seal-help" className="m-0 text-12 text-fg-muted">
                  {draft && !sealable
                    ? "Sealing needs a new mandate document from the agent service; this preview shows the mandate already sealed."
                    : `Hold for one second, or press Enter for a confirmation step. Seals with ${SIGNER_LABEL[signer]}.`}
                </p>
                {sealError ? (
                  <p role="alert" className="m-0 text-13 text-fg-1">
                    <StateRing state="refused" size={16} label="Not sealed" /> {sealError}
                  </p>
                ) : null}
                {live ? (
                  <p className="m-0 text-12 text-fg-muted">
                    Sealing supersedes mandate v{live.version} atomically. <LabelChip>Test units</LabelChip>
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Seal this mandate?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => void seal()}>Seal with {signer === "passkey" ? "passkey" : signer === "scripted" ? "scripted passkey" : "sample signature"}</Button>
          </>
        }
      >
        <p className="m-0">
          {draft ? `${draft.rules.length} rules, delegation hash ${shortHash(draft.delegationHash, 10, 8)}.` : null} Your signer signs exactly this
          delegation and nothing else. The ring on the right is its fingerprint.
        </p>
      </ConfirmDialog>
    </div>
  );
}
