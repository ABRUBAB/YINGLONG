"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn, HashRing, LabelChip, RingGlyph, shortHash } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { ArrowIcon, ButtonLink } from "@/components/ui/button";
import { PasskeyIcon } from "@/components/shell/site-nav";
import { Reveal } from "@/components/fx/reveal";
import { Magnetic } from "@/components/fx/magnetic";
import { useTypewriter } from "@/components/fx/use-typewriter";
import { useMotionOff } from "@/components/preferences";
import { SectionHead } from "./sections";
import { useInView } from "./use-live";

/**
 * Your own agent, as something you can do: a phone you can use. Three steps, Say, See, Seal, run on the
 * phone itself.
 *  - Say: a sentence is typed in plain English (pick another example with the chips).
 *  - See: the sentence comes back as the exact rules the code will enforce, line by line.
 *  - Seal: press and hold the key. A ring fills; when it completes the rules are sealed (practice).
 * The step advances on its own once the phone is on screen, and the numbered steps (or the arrows on
 * the phone) move it by hand. Hold works with the mouse, a finger, or the Space and Enter keys.
 * Honest label: this is a practice run in the page. The real sign-up creates a passkey on your device
 * or gives you a secret key (/start). The ring on the phone is the Hash Ring of the live demo mandate.
 */

const STEPS = [
  { n: "01", verb: "Say", text: "Write what your agent may do, in your own words. Every rule comes back as a sentence decoded from the compiled rules." },
  { n: "02", verb: "See", text: "Compare what you said with what the code will enforce, side by side, before anything is signed." },
  { n: "03", verb: "Seal", text: "Press and hold to lock the rules with your fingerprint or a secret key. Only you can change them after." },
] as const;

const EXAMPLES = [
  {
    label: "Student",
    say: "Pay my rent and food. Ask me before anything over 50.",
    rules: [
      ["Daily limit", "120 units"],
      ["Pays without asking", "Landlord, campus shop"],
      ["Asks you first", "Anything over 50 units"],
      ["Everyone else", "Refused"],
    ],
  },
  {
    label: "Freelancer",
    say: "Pay my software bills each month. Never more than 200 a day.",
    rules: [
      ["Daily limit", "200 units"],
      ["Pays without asking", "Your listed software shops"],
      ["Asks you first", "A new shop"],
      ["Everyone else", "Refused"],
    ],
  },
  {
    label: "Company",
    say: "Pay suppliers on the list. Two directors approve above 5,000.",
    rules: [
      ["Daily limit", "20,000 units"],
      ["Pays without asking", "Suppliers on the list, up to 5,000"],
      ["Asks you first", "Two of three directors, above 5,000"],
      ["Everyone else", "Refused"],
    ],
  },
] as const;

const HOLD_MS = 900;
const R = 56;
const C = 2 * Math.PI * R;

export function OwnAgent() {
  const phone = useRef<HTMLDivElement>(null);
  const inView = useInView(phone);
  const motionOff = useMotionOff();
  const mandatesQ = useAgent("mandates", (api) => api.mandates(), ["mandates"]);
  const hash = mandatesQ.data?.find((m) => m.status === "live")?.delegationHash ?? null;
  const [step, setStep] = useState(0);
  const [ex, setEx] = useState(0);
  const [touched, setTouched] = useState(false);
  const example = EXAMPLES[ex]!;

  // Say -> See -> Seal on its own while the phone is on screen, until the visitor takes over.
  useEffect(() => {
    if (!inView || touched || motionOff) return;
    const id = window.setTimeout(() => setStep((s) => (s < 2 ? s + 1 : s)), step === 0 ? 4600 : 3200);
    return () => window.clearTimeout(id);
  }, [inView, touched, motionOff, step]);

  const go = (s: number) => {
    setTouched(true);
    setStep(s);
  };

  return (
    <section aria-labelledby="own-title" className="yl-landing-section yl-defer border-t border-line-1">
      <div className="yl-container grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
        <div className="grid content-start gap-8 lg:col-span-7">
          <SectionHead
            index="03"
            eyebrow="Your own agent"
            id="own-title"
            title="Get your own agent in about a minute"
            lead="Write your rules, lock them with your fingerprint or a secret key, and your agent gets its own ID and wallet. Only you can change its rules."
          />
          <ol className="m-0 grid list-none gap-0 border-t border-line-2 p-0 sm:grid-cols-3 sm:gap-x-4">
            {STEPS.map((s, i) => (
              <li key={s.n} className="border-b border-line-1">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={step === i ? "step" : undefined}
                  className={cn(
                    "yl-press grid w-full grid-cols-[2.5rem_1fr] gap-3 rounded-control py-4 text-left transition-colors duration-200 sm:grid-cols-1 sm:gap-2 sm:px-3",
                    step === i ? "bg-bg-2 text-fg-0" : "text-fg-2 hover:bg-bg-2/60",
                  )}
                >
                  <span className="kicker pt-1">{s.n}</span>
                  <span className="grid gap-1.5">
                    <span className="type-display text-22 text-fg-0">{s.verb}</span>
                    <span className="max-w-[52ch] text-13 text-fg-2">{s.text}</span>
                    <span aria-hidden="true" className="mt-1 hidden h-px w-full overflow-hidden bg-line-1 sm:block">
                      <span className={cn("block h-full origin-left bg-fg-1 transition-transform duration-500 ease-[var(--ease-out)]", step >= i ? "scale-x-100" : "scale-x-0")} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <Reveal className="flex flex-wrap items-center gap-3">
            <Magnetic>
              <ButtonLink href="/start" size="lg">
                <PasskeyIcon size={16} />
                Create your real agent
              </ButtonLink>
            </Magnetic>
            <ButtonLink href="/app" variant="quiet" size="lg">
              Or watch Nadia&apos;s agent first <ArrowIcon />
            </ButtonLink>
          </Reveal>
          <div className="flex flex-wrap gap-2">
            <LabelChip>Practice on the phone: nothing is saved</LabelChip>
            <LabelChip>Test units only</LabelChip>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 lg:col-span-5" ref={phone}>
          <Phone hash={hash} step={step} ex={ex} example={example} onStep={go} onSealed={() => setTouched(true)} />
          <div role="group" aria-label="Choose an example" className="flex flex-wrap justify-center gap-1.5">
            {EXAMPLES.map((e, i) => (
              <button
                key={e.label}
                type="button"
                aria-pressed={ex === i}
                onClick={() => {
                  setTouched(true);
                  setEx(i);
                  setStep(0);
                }}
                className={cn(
                  "yl-press rounded-pill border px-3 py-1.5 text-12 transition-colors duration-150",
                  ex === i ? "border-fg-1 bg-fg-1 text-bg-0" : "border-line-2 text-fg-2 hover:border-line-3 hover:text-fg-0",
                )}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Phone({
  hash,
  step,
  ex,
  example,
  onStep,
  onSealed,
}: {
  hash: string | null;
  step: number;
  ex: number;
  example: (typeof EXAMPLES)[number];
  onStep: (s: number) => void;
  onSealed: () => void;
}) {
  return (
    <div className="yl-phone relative w-[min(78vw,292px)] p-2.5" role="group" aria-label="Practice phone">
      <div className="yl-phone-screen relative flex h-full flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 font-mono text-[10px] text-fg-muted">
          <span>app.yinglong-agent.tech</span>
          <span className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                type="button"
                aria-label={`Show step ${i + 1}, ${STEPS[i]!.verb}`}
                aria-current={step === i ? "step" : undefined}
                onClick={() => onStep(i)}
                className={cn("size-2 rounded-pill transition-all duration-300", step === i ? "w-5 bg-fg-1" : "bg-line-3 hover:bg-fg-muted")}
              />
            ))}
          </span>
        </div>

        <div className="relative min-h-0 flex-1">
          <StepSay key={`say-${ex}`} active={step === 0} text={example.say} />
          <StepSee key={`see-${ex}`} active={step === 1} rules={example.rules} said={example.say} />
          <StepSeal active={step === 2} hash={hash} example={example} onSealed={onSealed} />
        </div>
      </div>
    </div>
  );
}

const pane = "absolute inset-0 flex flex-col px-5 pt-6 pb-5 transition-[opacity,transform] duration-500 ease-[var(--ease-out)]";
const paneState = (active: boolean) => (active ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-4 opacity-0");

function StepSay({ active, text }: { active: boolean; text: string }) {
  const { typed, done } = useTypewriter([text], { speed: 30, hold: 600000, active });
  return (
    <div className={cn(pane, paneState(active))} aria-hidden={!active}>
      <span className="eyebrow text-[9px] text-fg-muted">Say</span>
      <p className="m-0 mt-3 text-15 leading-snug text-fg-0">Tell your agent the rules</p>
      <div className="mt-4 min-h-[112px] rounded-card border border-line-2 bg-bg-0 p-3.5 text-13 leading-relaxed text-fg-1">
        {active ? typed : text}
        <span className={cn("yl-caret", done && "opacity-0")} />
      </div>
      <p className="m-0 mt-auto text-11 text-fg-muted">Plain English. No forms, no codes.</p>
    </div>
  );
}

function StepSee({ active, rules, said }: { active: boolean; rules: (typeof EXAMPLES)[number]["rules"]; said: string }) {
  return (
    <div className={cn(pane, paneState(active))} aria-hidden={!active}>
      <span className="eyebrow text-[9px] text-fg-muted">See</span>
      <p className="m-0 mt-3 text-15 leading-snug text-fg-0">What the code will enforce</p>
      <p className="m-0 mt-2 line-clamp-2 text-11 italic text-fg-muted">&ldquo;{said}&rdquo;</p>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0">
        {rules.map(([k, v], i) => (
          <li
            key={k}
            className="grid gap-0.5 rounded-control border border-line-1 bg-bg-0 px-3 py-2 text-[12px]"
            style={{
              opacity: active ? 1 : 0,
              transform: active ? "none" : "translateY(8px)",
              transition: `opacity 420ms var(--ease-out) ${active ? 160 + i * 110 : 0}ms, transform 420ms var(--ease-out) ${active ? 160 + i * 110 : 0}ms`,
            }}
          >
            <span className="text-[10px] tracking-wide text-fg-muted uppercase">{k}</span>
            <span className="text-fg-0">{v}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-auto flex items-center gap-1.5 text-11 text-fg-muted">
        <RingGlyph state="verified" size={16} /> Matches what you said
      </p>
    </div>
  );
}

function StepSeal({ active, hash, example, onSealed }: { active: boolean; hash: string | null; example: (typeof EXAMPLES)[number]; onSealed: () => void }) {
  const motionOff = useMotionOff();
  const [p, setP] = useState(0);
  const [sealed, setSealed] = useState(false);
  const raf = useRef(0);
  const t0 = useRef(0);
  const holding = useRef(false);

  const stop = useCallback(() => {
    holding.current = false;
    cancelAnimationFrame(raf.current);
    setP((v) => (v >= 1 ? v : 0));
  }, []);

  const tick = useCallback(
    (now: number) => {
      if (!holding.current) return;
      const k = Math.min(1, (now - t0.current) / HOLD_MS);
      setP(k);
      if (k >= 1) {
        holding.current = false;
        setSealed(true);
        onSealed();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    },
    [onSealed],
  );

  const start = useCallback(() => {
    if (sealed || holding.current) return;
    holding.current = true;
    if (motionOff) {
      setP(1);
      setSealed(true);
      holding.current = false;
      onSealed();
      return;
    }
    t0.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  }, [sealed, motionOff, tick, onSealed]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // leaving the step or changing the example starts over
  useEffect(() => {
    if (!active) {
      cancelAnimationFrame(raf.current);
      holding.current = false;
    }
  }, [active]);
  useEffect(() => {
    setSealed(false);
    setP(0);
  }, [example]);

  return (
    <div className={cn(pane, paneState(active), "items-center text-center")} aria-hidden={!active}>
      <span className="eyebrow self-start text-[9px] text-fg-muted">Seal</span>
      <div className="relative mt-3 grid size-[150px] place-items-center">
        {hash ? (
          <span className={cn("block transition-transform duration-500", sealed && "yl-sealed")} style={{ transform: sealed ? undefined : `rotate(${p * 40}deg) scale(${1 - p * 0.04})` }}>
            <HashRing hash={hash} size={150} phase={sealed ? "sealed" : "draft"} bare />
          </span>
        ) : (
          <svg viewBox="0 0 150 150" width="150" height="150" aria-hidden="true">
            <circle cx="75" cy="75" r="54" fill="none" stroke="var(--chrome-1)" strokeWidth="1.5" />
          </svg>
        )}
        <svg viewBox="0 0 132 132" width="132" height="132" className="pointer-events-none absolute -rotate-90" aria-hidden="true">
          <circle cx="66" cy="66" r={R} fill="none" stroke="var(--line-2)" strokeWidth="2" opacity={sealed ? 0 : 1} />
          <circle
            cx="66"
            cy="66"
            r={R}
            fill="none"
            stroke={sealed ? "var(--jade)" : "var(--fg-0)"}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - p)}
          />
        </svg>
        {!sealed && active && !motionOff ? <span aria-hidden="true" className="yl-pulse-ring absolute size-[62px] rounded-pill border border-fg-2" /> : null}
        <button
          type="button"
          tabIndex={active ? 0 : -1}
          aria-label={sealed ? "Rules sealed (practice)" : "Press and hold to seal the rules (practice)"}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            start();
          }}
          onPointerUp={stop}
          onPointerCancel={stop}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
              e.preventDefault();
              start();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") stop();
          }}
          className={cn(
            "yl-press absolute inline-flex size-[62px] touch-none items-center justify-center rounded-pill border bg-bg-2 transition-colors duration-300 select-none",
            sealed ? "border-jade text-jade" : "border-line-3 text-fg-0 hover:border-fg-2",
          )}
        >
          {sealed ? (
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
              <circle cx="16" cy="24" r="8" fill="none" stroke="currentColor" strokeWidth="2.6" />
              <path d="M24 24h17M35.5 24v6.5M41 24v5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
      <p className="m-0 mt-3 text-13 font-medium text-fg-0" aria-live="polite">
        {sealed ? "Sealed. Your agent is ready." : p > 0 ? "Keep holding…" : "Press and hold the key"}
      </p>
      <p className="m-0 mt-1 font-mono text-[10px] text-fg-muted">{hash ? `delegation ${shortHash(hash, 8, 6)}` : "delegation hash appears here"}</p>
      <div className="mt-auto grid w-full gap-2 pt-3">
        {sealed ? (
          <ButtonLink href="/start" size="sm" tabIndex={active ? 0 : -1} className="w-full">
            Do it for real <ArrowIcon />
          </ButtonLink>
        ) : (
          <span className="inline-flex h-8 w-full items-center justify-center rounded-control border border-line-2 text-12 text-fg-muted">
            {example.rules[0]![0]}: {example.rules[0]![1]}
          </span>
        )}
      </div>
    </div>
  );
}
