"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HashRing, LabelChip, shortHash, StateRing } from "@yinglong/ui";
import type { VisitorDraft, VisitorSealResult, VisitorSignUp } from "@/lib/api/view";
import { ApiRequestError, getApi, isSample } from "@/lib/api";
import { invalidate, useAgent } from "@/lib/api/hooks";
import { clearVisitorSession } from "@/lib/api/session";
import type { Hex } from "viem";
import { passkeysSupported, PasskeyCancelledError, PasskeyServiceError } from "@/lib/passkey";
import {
  completeSignUp,
  createVisitorPasskey,
  createVisitorSecretKey,
  logInAgain,
  reviewSignUp,
  signStep,
  SignUpRefusedError,
  type SignUpReview,
  type VisitorKey,
} from "@/lib/visitor";
import { useVisitorSession } from "@/components/session";
import { Button, buttonClass } from "@/components/ui/button";
import { SampleBadge, TxLink } from "@/components/data/parts";
import { SayStep, SeeStep } from "./say-see";

type Phase =
  | { at: "intro" }
  | { at: "drafting" }
  | { at: "see"; draft: VisitorDraft }
  | { at: "choose"; mandate: unknown }
  | { at: "showKey"; key: VisitorKey; mandate: unknown }
  | { at: "creating" }
  | { at: "registering"; key: VisitorKey }
  | { at: "review"; key: VisitorKey; signUp: VisitorSignUp; review: SignUpReview }
  | { at: "half"; key: VisitorKey; signUp: VisitorSignUp; review: SignUpReview; publishSig: Hex }
  | { at: "signing"; key: VisitorKey; signUp: VisitorSignUp; review: SignUpReview; step: "publish" | "delegation" | "sealing"; publishSig?: Hex }
  | { at: "done"; signUp: VisitorSignUp; sealed: VisitorSealResult }
  | { at: "error"; message: string; key?: VisitorKey };

function describe(e: unknown): string {
  if (e instanceof PasskeyCancelledError) return "The fingerprint prompt was closed, so nothing was saved. Tap the button again when you are ready.";
  if (e instanceof PasskeyServiceError)
    return "Your phone's passkey service did not answer. Tap Try again. If it keeps happening, check that a password manager with passkeys (for example Google Password Manager) is turned on in your phone's settings.";
  if (e instanceof SignUpRefusedError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong. Nothing was saved.";
}

const STEPS = [
  { n: 1, label: "Write", hint: "your rules in your own words" },
  { n: 2, label: "Check", hint: "exactly what will be enforced" },
  { n: 3, label: "Lock", hint: "with your fingerprint or face" },
];

function Stepper({ phase }: { phase: Phase["at"] }) {
  const current = phase === "intro" || phase === "drafting" || phase === "error" ? 1 : phase === "see" ? 2 : 3;
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
  // The ledger the visitor's account lives on, as the service labels it (never typed here).
  const health = useAgent("health", (api) => api.health(), ["health"]);
  const ledgers = health.data?.ledgers.length ? health.data.ledgers.map((l) => l.badge).join(" and ") : null;
  const router = useRouter();
  const params = useSearchParams();
  const session = useVisitorSession();
  const [phase, setPhase] = useState<Phase>({ at: "intro" });
  const [supported, setSupported] = useState(true);
  const again = params?.get("again") === "1";

  useEffect(() => setSupported(passkeysSupported()), []);

  const [text, setText] = useState("");
  const [draftError, setDraftError] = useState<Error | undefined>();
  // The mandate chosen for this sign-up: a draft the visitor saw, or undefined for the standard visitor mandate.
  const [chosen, setChosen] = useState<unknown>(undefined);
  const resealing = Boolean(session && again);

  async function register(key: VisitorKey, mandate: unknown = chosen) {
    setPhase({ at: "registering", key });
    try {
      const api = getApi();
      let signUp: VisitorSignUp;
      const sameKey = key.method === "key" ? session?.owner?.toLowerCase() === key.owner?.toLowerCase() : session?.credentialId === key.credentialId;
      const signUpReq = key.method === "key" ? { owner: key.owner, mandate } : { credentialId: key.credentialId, publicKey: key.publicKey, mandate };
      if (resealing && session && sameKey) {
        try {
          signUp = await api.visitorReseal(session.visitorId, session.token, mandate);
        } catch (e) {
          // An older session token: the same passkey signing up again reaches the same account.
          if (!(e instanceof ApiRequestError) || e.status !== 400 || !/token/i.test(e.message)) throw e;
          signUp = await api.visitorSignUp(signUpReq);
        }
      } else {
        signUp = await api.visitorSignUp(signUpReq);
      }
      const directory = await api.contractDirectory(signUp.ledger);
      setPhase({ at: "review", key, signUp, review: reviewSignUp(signUp, directory) });
    } catch (e) {
      setPhase({ at: "error", message: describe(e), key });
    }
  }

  async function create(mandate: unknown = chosen) {
    setPhase({ at: "creating" });
    try {
      const key = await createVisitorPasskey();
      await register(key, mandate);
    } catch (e) {
      setPhase({ at: "error", message: describe(e) });
    }
  }

  /** After a revoke: the same passkey seals a new mandate (same visitor id, new messages). */
  async function reseal(mandate: unknown = chosen) {
    if (session?.method === "key" && session.secretKey) {
      await register(
        { method: "key", credentialId: "", publicKey: { x: "0x", y: "0x" }, secretKey: session.secretKey as `0x${string}`, owner: session.owner as `0x${string}` },
        mandate,
      );
      return;
    }
    if (!session?.publicKey) {
      setPhase({ at: "error", message: "This device does not remember the passkey's public key. Create a new passkey instead." });
      return;
    }
    await register({ credentialId: session.credentialId, publicKey: { x: session.publicKey.x as `0x${string}`, y: session.publicKey.y as `0x${string}` } }, mandate);
  }

  /** Say -> see: compile the visitor's words; nothing is created or signed. */
  async function see() {
    setDraftError(undefined);
    setPhase({ at: "drafting" });
    try {
      const draft = await getApi().draftVisitorMandate(text.trim());
      setPhase({ at: "see", draft });
    } catch (e) {
      setDraftError(e as Error);
      setPhase({ at: "intro" });
    }
  }

  /** See -> seal (or skip straight to the standard mandate). */
  function sealWith(mandate: unknown) {
    setChosen(mandate);
    if (resealing) void reseal(mandate);
    else setPhase({ at: "choose", mandate });
  }

  /** The secret-key path: make the key here, show it once, continue only after the visitor saved it. */
  function startSecretKey(mandate: unknown) {
    setPhase({ at: "showKey", key: createVisitorSecretKey(), mandate });
  }

  /** Confirmation 1 of 2, on its own tap: save the rules (the publishing operation). */
  async function confirmFirst() {
    if (phase.at !== "review") return;
    const { key, signUp, review } = phase;
    if (key.method === "key") {
      try {
        setPhase({ at: "signing", key, signUp, review, step: "sealing" });
        const userOpSignature = await signStep(review, key, "publish");
        const delegationSignature = await signStep(review, key, "delegation");
        const sealed = await completeSignUp(getApi(), signUp, key, { userOpSignature, delegationSignature });
        invalidate("me", "pause", "mandates", "budgets", "receipts", "approvals", "session");
        setPhase({ at: "done", signUp, sealed });
      } catch (e) {
        setPhase({ at: "error", message: describe(e), key });
      }
      return;
    }
    try {
      setPhase({ at: "signing", key, signUp, review, step: "publish" });
      const publishSig = await signStep(review, key, "publish");
      setPhase({ at: "half", key, signUp, review, publishSig });
    } catch (e) {
      setPhase({ at: "error", message: describe(e), key });
    }
  }

  /** Confirmation 2 of 2, on a second tap: give the agent permission (the delegation), then lock it in. */
  async function confirmSecond() {
    if (phase.at !== "half") return;
    const { key, signUp, review, publishSig } = phase;
    try {
      setPhase({ at: "signing", key, signUp, review, step: "delegation", publishSig });
      const delegationSig = await signStep(review, key, "delegation");
      setPhase({ at: "signing", key, signUp, review, step: "sealing", publishSig });
      const sealed = await completeSignUp(getApi(), signUp, key, { userOpSignature: publishSig, delegationSignature: delegationSig });
      invalidate("me", "pause", "mandates", "budgets", "receipts", "approvals", "session");
      setPhase({ at: "done", signUp, sealed });
    } catch (e) {
      setPhase({ at: "error", message: describe(e), key });
    }
  }

  const flowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase.at === "intro") return;
    const el = flowRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 96;
    if (Math.abs(window.scrollY - top) > 40) window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [phase.at]);

  const busy = phase.at === "creating" || phase.at === "registering" || phase.at === "signing" || phase.at === "drafting";
  // The delegation's Hash Ring: draft while you read, holding while the passkey signs, sealed after.
  const ring =
    phase.at === "review" || phase.at === "half" || phase.at === "signing" || phase.at === "done"
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
            <p className="eyebrow m-0 text-fg-muted">Try it yourself</p>
            <h1 className="type-display m-0 mt-2 max-w-[20ch] text-[2.2rem] leading-[1.05] text-fg-0 sm:text-[2.8rem]">
              Get your own AI agent in three steps.
            </h1>
          </div>
          <SampleBadge />
        </div>
        <p className="measure m-0 text-lead text-fg-2">
          Tell your agent what it may spend, check the rules, then lock them with your phone&apos;s fingerprint or face unlock. After
          that, your agent can only spend inside those rules. Test money only.
        </p>
        <Stepper phase={phase.at} />
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14">
        <div ref={flowRef} className="grid min-h-[min(780px,85vh)] content-start gap-8 [overflow-anchor:none]" aria-live="polite" aria-busy={busy}>
          {phase.at === "intro" && session && !again ? (
            <section aria-labelledby="start-create" className="yl-card grid gap-4 p-5 sm:p-6">
              <h2 id="start-create" className="m-0 text-18 font-semibold text-fg-0">
                You already have an agent on this device
              </h2>
              <p className="m-0 text-13 text-fg-2">
                Your account <span className="font-mono">{session.visitorId}</span> is locked with this phone&apos;s passkey{" "}
                <span className="font-mono text-fg-muted">({shortHash(session.credentialId, 6, 4)})</span>.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/app" className={buttonClass("primary", "lg")}>
                  Open my agent
                </Link>
                <Button variant="secondary" size="lg" disabled={!supported} onClick={() => clearVisitorSession()}>
                  Start again with a new passkey
                </Button>
              </div>
            </section>
          ) : null}

          {(phase.at === "intro" || phase.at === "drafting") && !(session && !again) ? (
            <>
              {!supported ? (
                <p role="alert" className="m-0 text-13 text-fg-1">
                  This browser cannot use passkeys. Open this page in Chrome or Safari on your phone.
                </p>
              ) : null}
              {resealing ? (
                <p className="m-0 text-13 text-fg-2">
                  Your old rules were cancelled. Write new ones and lock them with the same fingerprint: same account, same agent.
                </p>
              ) : null}
              {!session ? <LogInAgain onDone={() => router.push("/app")} /> : null}
              <SayStep
                text={text}
                onText={setText}
                onSee={() => void see()}
                onStandard={() => sealWith(undefined)}
                busy={phase.at === "drafting"}
                error={draftError}
                standardLabel="Skip and use simple ready-made rules"
                disabled={!supported}
              />
            </>
          ) : null}

          {phase.at === "see" ? (
            <SeeStep
              d={phase.draft}
              busy={busy}
              onEdit={() => setPhase({ at: "intro" })}
              onSeal={() => sealWith(phase.draft.draft)}
              sealLabel="Looks right: lock it with my fingerprint"
            />
          ) : null}

          {phase.at === "choose" ? <ChooseMethod onPasskey={() => void create(phase.mandate)} onKey={() => startSecretKey(phase.mandate)} /> : null}

          {phase.at === "showKey" ? <ShowSecretKey secretKey={phase.key.secretKey!} onContinue={() => void register(phase.key, phase.mandate)} /> : null}

          {phase.at === "creating" ? (
            <p role="status" className="m-0 flex items-center gap-2 text-15 text-fg-1">
              <StateRing state="waiting" size={20} glyphOnly label="Waiting" /> Your phone will ask you to create a passkey. Confirm with your fingerprint or face.
            </p>
          ) : null}

          {phase.at === "registering" ? (
            <div role="status" className="grid gap-2">
              <p className="m-0 flex items-center gap-2 text-15 text-fg-1">
                <StateRing state="pending" size={20} glyphOnly label="Working" /> Creating your account. This takes about 10 seconds.
              </p>
              <p className="m-0 text-13 text-fg-muted">
                We are setting up an account that only your passkey can control, giving your agent an ID, and adding some test money to
                play with.
              </p>
            </div>
          ) : null}

          {phase.at === "review" || phase.at === "half" || phase.at === "signing" ? (
            <ReviewView phase={phase} onFirst={() => void confirmFirst()} onSecond={() => void confirmSecond()} />
          ) : null}

          {phase.at === "done" ? (
            <section aria-labelledby="start-done" className="grid gap-4" role="status">
              <h2 id="start-done" className="m-0 flex items-center gap-2 text-18 font-semibold text-fg-0">
                <StateRing state="sealed" size={24} glyphOnly label="Sealed" /> Done. Your agent is ready.
              </h2>
              <p className="m-0 text-13 text-fg-2">
                Your rules are now saved on the blockchain, and your agent can only spend inside them. Whenever something needs you
                (a bigger payment, a pause, cancelling the rules), your phone will ask for your fingerprint again.
              </p>
              <TxLink ledger={phase.sealed.ledger} hash={phase.sealed.publishTx} badge={phase.sealed.ledgerBadge} label="Published" />
              <div className="flex flex-wrap gap-3">
                <Button size="lg" onClick={() => router.push("/app")}>
                  Open my agent
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
                  <Button onClick={() => void register(phase.key!)}>Try again</Button>
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
          <p className="eyebrow m-0 text-fg-muted">Good to know</p>
          <ul className="m-0 grid list-none gap-3 p-0">
            <li>Your fingerprint never leaves your phone. We only receive a public key, never anything that could sign for you.</li>
            <li>Only your passkey controls your account. There is no password and no secret phrase to lose.</li>
            <li>This uses test money on {ledgers ?? "a test blockchain"}. Nothing here is real money or touches a bank.</li>
            <li>Your agent can pay a few sample shops: small amounts on its own, bigger ones only after you confirm. Anything else is blocked by the blockchain itself.</li>
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
  onFirst,
  onSecond,
}: {
  phase: Extract<Phase, { at: "review" | "half" | "signing" }>;
  onFirst: () => void;
  onSecond: () => void;
}) {
  const { signUp, review } = phase;
  const signing = phase.at === "signing" ? phase.step : null;
  const isKey = phase.key.method === "key";
  const firstDone = !isKey && (phase.at === "half" || (phase.at === "signing" && phase.step !== "publish"));
  const plain: Record<string, { title: string; body: string }> = {
    publish: { title: "Save your rules", body: "Writes your rules onto the blockchain, from your own account, so anyone can check them." },
    delegation: { title: "Give your agent permission", body: "Lets your agent act for you, but only inside the rules you just saved." },
  };
  return (
    <>
      <section aria-labelledby="start-mandate" className="grid gap-4">
        <h2 id="start-mandate" className="m-0 text-18 font-semibold text-fg-0">
          Your rules
        </h2>
        <ol className="m-0 grid list-none gap-0 p-0">
          {signUp.mandate.sentences.map((s, i) => (
            <li key={i} className="grid grid-cols-[2rem_1fr] gap-x-3 border-t border-line-2 py-3 text-15 text-fg-0">
              <span className="pt-0.5 font-mono text-12 text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
              {s}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="start-messages" className="grid gap-4">
        <h2 id="start-messages" className="m-0 text-18 font-semibold text-fg-0">
          {isKey ? "Confirm with your secret key" : "Confirm twice with your fingerprint"}
        </h2>
        <p className="m-0 text-13 text-fg-2">
          {isKey
            ? "Your secret key signs both steps in this browser. Nothing is saved until both are done."
            : "Your phone asks two times, one tap each. Nothing is saved until both are done."}
        </p>
        {review.steps.map((st, i) => {
          const t = plain[st.step] ?? { title: st.title, body: "" };
          const done = st.step === "publish" && firstDone;
          return (
            <article key={st.step} className="grid gap-2 rounded-card border border-line-2 bg-bg-1 p-4" aria-labelledby={`msg-${st.step}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id={`msg-${st.step}`} className="m-0 text-15 font-semibold text-fg-0">
                  <span className="font-mono text-12 text-fg-muted">Step {i + 1} of 2</span> {t.title}
                </h3>
                {done ? (
                  <StateRing state="verified" size={16} label="Confirmed" />
                ) : signing === st.step ? (
                  <StateRing state="waiting" size={16} label="Waiting for your fingerprint" />
                ) : null}
              </div>
              <p className="m-0 text-13 text-fg-1">{t.body}</p>
              <details className="text-12 text-fg-2">
                <summary className="cursor-pointer text-fg-muted">Technical details (for checking)</summary>
                <ul className="m-0 mt-2 grid list-disc gap-1 pl-5">
                  {st.review.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <ul className="m-0 mt-2 grid list-none gap-1.5 p-0">
                  <li>
                    <StateRing
                      state={st.guard.ok ? "verified" : "refused"}
                      size={16}
                      label={st.guard.ok ? `Checked on this device: a ${st.guard.primaryType} message, nothing else` : `Blocked on this device: ${st.guard.reason}`}
                    />
                  </li>
                  {st.review.checks.map((c) => (
                    <li key={c.label}>
                      <StateRing state={c.ok ? "verified" : "refused"} size={16} label={c.ok ? c.label : `${c.label}: no`} />
                    </li>
                  ))}
                </ul>
                <p className="m-0 mt-2 rounded-control bg-bg-2 px-3 py-2 font-mono text-11 break-all">Signs exactly {st.digest}</p>
                <dl className="m-0 mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
                  <dt className="text-fg-muted">Your account</dt>
                  <dd className="m-0 font-mono break-all">{signUp.account}</dd>
                  <dt className="text-fg-muted">Your agent</dt>
                  <dd className="m-0">
                    {signUp.agent.label} <span className="font-mono">#{signUp.agent.agentId}</span>
                  </dd>
                  <dt className="text-fg-muted">Blockchain</dt>
                  <dd className="m-0">{signUp.ledgerBadge ?? signUp.ledger}</dd>
                </dl>
              </details>
            </article>
          );
        })}
        {!review.ok ? (
          <p role="alert" className="m-0 text-13 text-fg-1">
            This was blocked for your safety: {review.problems.join("; ")}.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          {!firstDone ? (
            <Button size="lg" onClick={onFirst} disabled={!review.ok || signing !== null}>
              {isKey
                ? signing
                  ? "Saving..."
                  : "Save my rules and give my agent permission"
                : signing === "publish"
                  ? "Waiting for your fingerprint..."
                  : "Step 1 of 2: Save my rules"}
            </Button>
          ) : (
            <Button size="lg" onClick={onSecond} disabled={signing !== null}>
              {signing === "delegation" ? "Waiting for your fingerprint..." : signing === "sealing" ? "Finishing..." : "Step 2 of 2: Give my agent permission"}
            </Button>
          )}
        </div>
      </section>
    </>
  );
}

function ChooseMethod({ onPasskey, onKey }: { onPasskey: () => void; onKey: () => void }) {
  return (
    <section aria-labelledby="start-choose" className="grid gap-4">
      <h2 id="start-choose" className="m-0 text-18 font-semibold text-fg-0">
        How do you want to lock your account?
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={onPasskey} className="yl-card yl-press grid gap-2 p-5 text-left">
          <span className="text-15 font-semibold text-fg-0">Fingerprint or face (passkey)</span>
          <span className="text-13 text-fg-2">
            Your phone keeps the key and asks for your fingerprint each time. Easiest, but some phones (often without Google services)
            do not support it.
          </span>
        </button>
        <button type="button" onClick={onKey} className="yl-card yl-press grid gap-2 p-5 text-left">
          <span className="text-15 font-semibold text-fg-0">Secret key (works on every phone)</span>
          <span className="text-13 text-fg-2">
            Like a crypto wallet: we create a key in your browser, you copy and keep it, and you paste it to log in on any device.
          </span>
        </button>
      </div>
    </section>
  );
}

function ShowSecretKey({ secretKey, onContinue }: { secretKey: string; onContinue: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby="start-key" className="yl-card grid gap-4 p-5 sm:p-6">
      <h2 id="start-key" className="m-0 text-18 font-semibold text-fg-0">
        Your secret key
      </h2>
      <p className="m-0 text-13 text-fg-2">
        This key controls your account. It was made in this browser and is shown only now. Copy it and keep it somewhere safe: you need it
        to log in again. Anyone with this key can use your account (test money only).
      </p>
      <p className="m-0 rounded-control border border-line-3 bg-bg-2 px-3 py-3 font-mono text-13 break-all text-fg-0 select-all">{secretKey}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(secretKey)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy secret key"}
        </Button>
        <label className="flex items-center gap-2 text-13 text-fg-1">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved my secret key
        </label>
      </div>
      <div>
        <Button size="lg" disabled={!saved} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </section>
  );
}

function LogInAgain({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<null | "passkey" | "key">(null);
  const [error, setError] = useState<string | null>(null);
  async function go(how: "passkey" | "key") {
    setError(null);
    setBusy(how);
    try {
      if (how === "key") {
        const k = key.trim();
        if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("A secret key starts with 0x followed by 64 letters and numbers.");
        await logInAgain(getApi(), { method: "key", secretKey: k as `0x${string}` });
      } else {
        await logInAgain(getApi(), { method: "passkey" });
      }
      invalidate("me", "pause", "mandates", "budgets", "receipts", "approvals", "session");
      onDone();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-labelledby="start-login" className="rounded-card border border-line-2 bg-bg-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="start-login" className="m-0 text-15 font-semibold text-fg-0">
          Already have an agent?
        </h2>
        <Button variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Close" : "Log in"}
        </Button>
      </div>
      {open ? (
        <div className="mt-4 grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void go("passkey")} disabled={busy !== null}>
              {busy === "passkey" ? "Waiting for your fingerprint..." : "Log in with my passkey"}
            </Button>
          </div>
          <div className="grid gap-2">
            <label htmlFor="start-login-key" className="text-13 text-fg-1">
              Or paste your secret key
            </label>
            <input
              id="start-login-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="0x..."
              className="rounded-control border border-line-3 bg-bg-2 px-3 py-2 font-mono text-13 text-fg-0"
            />
            <div>
              <Button variant="secondary" onClick={() => void go("key")} disabled={busy !== null || !key.trim()}>
                {busy === "key" ? "Logging in..." : "Log in with my secret key"}
              </Button>
            </div>
          </div>
          {error ? (
            <p role="alert" className="m-0 text-13 text-fg-1">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
