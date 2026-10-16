"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { HashRing, LabelChip, shortHash, StateRing } from "@yinglong/ui";
import type { VisitorSealResult, VisitorSignUp } from "@/lib/api/view";
import { getApi, isSample } from "@/lib/api";
import { invalidate } from "@/lib/api/hooks";
import { clearVisitorSession } from "@/lib/api/session";
import { passkeysSupported, PasskeyCancelledError } from "@/lib/passkey";
import { completeSignUp, createVisitorPasskey, reviewSignUp, signSignUp, SignUpRefusedError, type SignUpReview, type VisitorKey } from "@/lib/visitor";
import { useVisitorSession } from "@/components/session";
import { Button, buttonClass } from "@/components/ui/button";
import { SampleBadge, TxLink } from "@/components/data/parts";

type Phase =
  | { at: "intro" }
  | { at: "creating" }
  | { at: "registering"; key: VisitorKey }
  | { at: "review"; key: VisitorKey; signUp: VisitorSignUp; review: SignUpReview }
  | { at: "signing"; key: VisitorKey; signUp: VisitorSignUp; review: SignUpReview; step: "publish" | "delegation" | "sealing" }
  | { at: "done"; signUp: VisitorSignUp; sealed: VisitorSealResult }
  | { at: "error"; message: string; key?: VisitorKey };

function describe(e: unknown): string {
  if (e instanceof PasskeyCancelledError) return "The passkey prompt was dismissed. Nothing was created or signed.";
  if (e instanceof SignUpRefusedError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong. Nothing was signed.";
}

const STEPS = [
  { n: 1, label: "Create a passkey", hint: "on this device" },
  { n: 2, label: "Read what you sign", hint: "decoded here" },
  { n: 3, label: "Seal", hint: "two passkey prompts" },
];

function Stepper({ phase }: { phase: Phase["at"] }) {
  const current = phase === "intro" || phase === "creating" || phase === "error" ? 1 : phase === "registering" || phase === "review" ? 2 : 3;
  return (
    <ol className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0" aria-label="Steps">
      {STEPS.map((s) => (
        <li key={s.n} aria-current={s.n === current ? "step" : undefined} className="flex items-center gap-2.5 text-13">
          <span className={s.n <= current ? "font-mono text-fg-0" : "font-mono text-fg-muted"}>{String(s.n).padStart(2, "0")}</span>
          <span className={s.n === current ? "font-medium text-fg-0" : "text-fg-muted"}>
            {s.label} <span className="font-normal text-fg-muted">{s.hint}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** /start: try YINGLONG with your own passkey. Test units only; the passkey never leaves this device. */
export function Start() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useVisitorSession();
  const [phase, setPhase] = useState<Phase>({ at: "intro" });
  const [supported, setSupported] = useState(true);
  const again = params?.get("again") === "1";

  useEffect(() => setSupported(passkeysSupported()), []);

  async function register(key: VisitorKey) {
    setPhase({ at: "registering", key });
    try {
      const api = getApi();
      const signUp = await api.visitorSignUp({ credentialId: key.credentialId, publicKey: key.publicKey });
      const directory = await api.contractDirectory(signUp.ledger);
      setPhase({ at: "review", key, signUp, review: reviewSignUp(signUp, directory) });
    } catch (e) {
      setPhase({ at: "error", message: describe(e), key });
    }
  }

  async function create() {
    setPhase({ at: "creating" });
    try {
      const key = await createVisitorPasskey();
      await register(key);
    } catch (e) {
      setPhase({ at: "error", message: describe(e) });
    }
  }

  /** After a revoke: the same passkey seals a new mandate (same visitor id, new messages). */
  async function reseal() {
    if (!session?.publicKey) {
      setPhase({ at: "error", message: "This device does not remember the passkey's public key. Create a new passkey instead." });
      return;
    }
    await register({ credentialId: session.credentialId, publicKey: { x: session.publicKey.x as `0x${string}`, y: session.publicKey.y as `0x${string}` } });
  }

  async function seal() {
    if (phase.at !== "review") return;
    const { key, signUp, review } = phase;
    try {
      setPhase({ at: "signing", key, signUp, review, step: "publish" });
      const sigs = await signSignUp(review, key.credentialId, (step) => setPhase({ at: "signing", key, signUp, review, step }));
      setPhase({ at: "signing", key, signUp, review, step: "sealing" });
      const sealed = await completeSignUp(getApi(), signUp, key, sigs);
      invalidate("me", "pause", "mandates", "budgets", "receipts", "approvals", "session");
      setPhase({ at: "done", signUp, sealed });
    } catch (e) {
      setPhase({ at: "error", message: describe(e), key });
    }
  }

  const busy = phase.at === "creating" || phase.at === "registering" || phase.at === "signing";
  // The delegation's Hash Ring: draft while you read, holding while the passkey signs, sealed after.
  const ring =
    phase.at === "review" || phase.at === "signing" || phase.at === "done"
      ? {
          hash: phase.signUp.mandate.delegationHash,
          phase: (phase.at === "done" ? "sealed" : phase.at === "signing" ? "holding" : "draft") as "sealed" | "holding" | "draft",
        }
      : null;

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-10 pb-20 sm:px-6 lg:px-8">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow m-0 text-fg-muted">Try it with your own passkey</p>
            <h1 className="type-display m-0 mt-2 max-w-[20ch] text-[2.2rem] leading-[1.05] text-fg-0 sm:text-[2.8rem]">
              Your agent, your mandate, your key.
            </h1>
          </div>
          <SampleBadge />
        </div>
        <p className="measure m-0 text-15 text-fg-2">
          Create a passkey on this device. YINGLONG deploys an account whose only signer is that passkey, gives you an agent with a small
          mandate, and asks your passkey to seal it. You read every message before you sign it.
        </p>
        <Stepper phase={phase.at} />
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14">
        <div className="grid content-start gap-8" aria-live="polite">
          {phase.at === "intro" ? (
            <section aria-labelledby="start-create" className="grid gap-4">
              <h2 id="start-create" className="m-0 text-18 font-semibold text-fg-0">
                {session && !again ? "This device already has your account" : again ? "Seal a new mandate with your passkey" : "Create your passkey"}
              </h2>
              {!supported ? (
                <p role="alert" className="m-0 text-13 text-fg-1">
                  This browser cannot create passkeys. Open this page on a phone or a browser with passkey support.
                </p>
              ) : null}
              {session && !again ? (
                <>
                  <p className="m-0 text-13 text-fg-2">
                    Visitor <span className="font-mono">{session.visitorId}</span>, sealed with passkey{" "}
                    <span className="font-mono">{shortHash(session.credentialId, 6, 4)}</span>.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Link href="/app" className={buttonClass("primary", "lg")}>
                      Open your console
                    </Link>
                    <Button
                      variant="secondary"
                      size="lg"
                      disabled={!supported}
                      onClick={() => {
                        clearVisitorSession();
                        void create();
                      }}
                    >
                      Start over with a new passkey
                    </Button>
                  </div>
                </>
              ) : session && again ? (
                <>
                  <p className="m-0 text-13 text-fg-2">
                    Your previous mandate is revoked. The same passkey seals a new one: same account, same agent, new rules on chain.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button size="lg" disabled={!supported} onClick={() => void reseal()}>
                      Prepare a new mandate
                    </Button>
                    <Link href="/app" className={buttonClass("secondary", "lg")}>
                      Back to the console
                    </Link>
                  </div>
                </>
              ) : (
                <div>
                  <Button size="lg" disabled={!supported} onClick={() => void create()}>
                    Create a passkey
                  </Button>
                </div>
              )}
            </section>
          ) : null}

          {phase.at === "creating" ? (
            <p role="status" className="m-0 flex items-center gap-2 text-15 text-fg-1">
              <StateRing state="waiting" size={20} glyphOnly label="Waiting" /> Waiting for your passkey prompt.
            </p>
          ) : null}

          {phase.at === "registering" ? (
            <div role="status" className="grid gap-2">
              <p className="m-0 flex items-center gap-2 text-15 text-fg-1">
                <StateRing state="pending" size={20} glyphOnly label="Working" /> Deploying your account on the ledger.
              </p>
              <p className="m-0 text-13 text-fg-muted">
                The service deploys an account whose only signer is your passkey, registers your agent&apos;s passport and mints test units. On
                the team-run FISCO BCOS chain this takes 5 to 15 seconds.
              </p>
            </div>
          ) : null}

          {phase.at === "review" || phase.at === "signing" ? <ReviewView phase={phase} onSeal={() => void seal()} /> : null}

          {phase.at === "done" ? (
            <section aria-labelledby="start-done" className="grid gap-4" role="status">
              <h2 id="start-done" className="m-0 flex items-center gap-2 text-18 font-semibold text-fg-0">
                <StateRing state="sealed" size={24} glyphOnly label="Sealed" /> Sealed with your passkey
              </h2>
              <p className="m-0 text-13 text-fg-2">
                Your mandate is published and your agent may act only inside it. Every signature from now on (approvals, pause, resume,
                revoke) is your passkey on this device.
              </p>
              <TxLink ledger={phase.sealed.ledger} hash={phase.sealed.publishTx} badge={phase.sealed.ledgerBadge} label="Published" />
              <div className="flex flex-wrap gap-3">
                <Button size="lg" onClick={() => router.push("/app")}>
                  Open your console
                </Button>
              </div>
            </section>
          ) : null}

          {phase.at === "error" ? (
            <section className="grid gap-3">
              <p role="alert" className="m-0 flex items-start gap-2 text-15 text-fg-1">
                <StateRing state="refused" size={20} glyphOnly label="Stopped" /> {phase.message}
              </p>
              <div className="flex flex-wrap gap-3">
                {phase.key ? (
                  <Button onClick={() => void register(phase.key!)}>Try again with the same passkey</Button>
                ) : (
                  <Button onClick={() => void create()} disabled={!supported}>
                    Create a passkey
                  </Button>
                )}
                <Button variant="quiet" onClick={() => setPhase({ at: "intro" })}>
                  Back
                </Button>
              </div>
            </section>
          ) : null}
          {busy ? <span className="sr-only">Working</span> : null}
        </div>

        <aside
          className="grid content-start gap-4 self-start rounded-sheet border border-line-2 bg-bg-1 p-5 text-13 text-fg-2 lg:sticky lg:top-24"
          aria-label="What this is"
        >
          {ring ? (
            <div className="grid justify-items-center gap-2 border-b border-line-2 pb-4">
              <HashRing hash={ring.hash} size={184} phase={ring.phase} progress={ring.phase === "holding" ? 1 : 0} drawIn={ring.phase === "sealed"} bare={false} />
            </div>
          ) : null}
          <p className="eyebrow m-0 text-fg-muted">What this is</p>
          <ul className="m-0 grid list-none gap-3 p-0">
            <li>Your passkey never leaves this device. YINGLONG receives only its public key; the service never holds a key for you.</li>
            <li>Your account is a smart account whose only signer is this passkey: no seed phrase, no operator key.</li>
            <li>Test units only, on a team-run FISCO BCOS chain. Nothing here has monetary value or reaches a bank.</li>
            <li>Your agent can pay three sample merchants, small amounts alone and up to 200 with your passkey. Everything else is refused on chain.</li>
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <LabelChip>Test units only</LabelChip>
            {isSample ? <LabelChip dotted>Simulated service, real passkey</LabelChip> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ReviewView({
  phase,
  onSeal,
}: {
  phase: Extract<Phase, { at: "review" | "signing" }>;
  onSeal: () => void;
}) {
  const { signUp, review } = phase;
  const signing = phase.at === "signing" ? phase.step : null;
  return (
    <>
      <section aria-labelledby="start-mandate" className="grid gap-4">
        <h2 id="start-mandate" className="m-0 text-18 font-semibold text-fg-0">
          {signUp.mandate.title}
        </h2>
        <ol className="m-0 grid list-none gap-0 p-0">
          {signUp.mandate.sentences.map((s, i) => (
            <li key={i} className="grid grid-cols-[2rem_1fr] gap-x-3 border-t border-line-2 py-3 text-15 text-fg-0">
              <span className="pt-0.5 font-mono text-12 text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
              {s}
            </li>
          ))}
        </ol>
        <dl className="m-0 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-12">
          <dt className="text-fg-muted">Your account</dt>
          <dd className="m-0 font-mono break-all text-fg-1">{signUp.account}</dd>
          <dt className="text-fg-muted">Your agent</dt>
          <dd className="m-0 text-fg-1">
            {signUp.agent.label} <span className="font-mono text-fg-muted">#{signUp.agent.agentId}</span>{" "}
            <span className="font-mono text-fg-muted">{shortHash(signUp.agent.wallet, 8, 6)}</span>
          </dd>
          <dt className="text-fg-muted">Ledger</dt>
          <dd className="m-0 text-fg-1">{signUp.ledgerBadge ?? signUp.ledger}</dd>
        </dl>
      </section>

      <section aria-labelledby="start-messages" className="grid gap-5">
        <h2 id="start-messages" className="m-0 text-18 font-semibold text-fg-0">
          The two messages your passkey signs
        </h2>
        {review.steps.map((st, i) => (
          <article key={st.step} className="grid gap-3 rounded-card border border-line-2 bg-bg-1 p-4" aria-labelledby={`msg-${st.step}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`msg-${st.step}`} className="m-0 text-15 font-semibold text-fg-0">
                <span className="font-mono text-12 text-fg-muted">{i + 1} of 2</span> {st.title}
              </h3>
              {signing === st.step ? <StateRing state="waiting" size={16} label="Waiting for your passkey" /> : null}
            </div>
            <ul className="m-0 grid list-disc gap-1 pl-5 text-13 text-fg-1">
              {st.review.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <ul className="m-0 grid list-none gap-1.5 p-0">
              <li>
                <StateRing
                  state={st.guard.ok ? "verified" : "refused"}
                  size={16}
                  label={st.guard.ok ? `Signing guard: ${st.guard.primaryType} message, digest recomputed` : `Signing guard refused: ${st.guard.reason}`}
                />
              </li>
              {st.review.checks.map((c) => (
                <li key={c.label}>
                  <StateRing state={c.ok ? "verified" : "refused"} size={16} label={c.ok ? c.label : `${c.label}: no`} />
                </li>
              ))}
            </ul>
            <p className="m-0 rounded-control bg-bg-2 px-3 py-2 font-mono text-11 break-all text-fg-2">Signs exactly {st.digest}</p>
          </article>
        ))}
        {!review.ok ? (
          <p role="alert" className="m-0 text-13 text-fg-1">
            Signing is blocked: {review.problems.join("; ")}.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={onSeal} disabled={!review.ok || signing !== null}>
            {signing === "publish"
              ? "Passkey prompt 1 of 2"
              : signing === "delegation"
                ? "Passkey prompt 2 of 2"
                : signing === "sealing"
                  ? "Sealing on the ledger"
                  : "Sign both with your passkey"}
          </Button>
          <span className="text-12 text-fg-muted">Two prompts: one per message. Nothing is sealed until both verify on chain.</span>
        </div>
      </section>
    </>
  );
}
