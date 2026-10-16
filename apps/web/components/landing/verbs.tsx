"use client";

import { useEffect, useRef, useState } from "react";
import { cn, f3 } from "@yinglong/ui";
import { useMotionOff } from "@/components/preferences";
import { SectionHead } from "./sections";

/**
 * The seven verbs as scroll storytelling (docs/MOTION.md, moment 2b). The ring on the left is the
 * mandate's life cycle: one station per verb, the arc fills with scroll (GSAP ScrollTrigger, scrub),
 * the verb in view lights its station and draws its diagram in the ring (CSS, on the state change),
 * and each verb's name rises letter by letter as it enters (GSAP SplitText). GSAP is imported after
 * hydration so it never blocks the first paint. Under reduced motion or
 * the Pause motion control the ring is full, nothing moves, and the active station still follows
 * the reader.
 */
const VERBS = [
  { v: "Say", d: "You state the rules in English, Bangla or Chinese. Every rule you will be held to is written back in English.", fact: "Plain-language input" },
  { v: "See", d: "The rules come back as sentences decoded from the typed on-chain terms, side by side with what you said.", fact: "Round-trip verifier" },
  { v: "Seal", d: "Your passkey signs the delegation. Sixty-four ticks of its hash appear as the Hash Ring.", fact: "EIP-712 delegation hash" },
  { v: "Enforce", d: "Caveat enforcers are the rules. The same bytecode runs on Base Sepolia and on FISCO BCOS.", fact: "Identical enforcer code hash" },
  { v: "Verify", d: "Anyone recomputes the delegation hash and decodes the caveats back, in TypeScript or in Python.", fact: "Two independent verifiers" },
  { v: "Prove", d: "Each action writes an accountability receipt, chained and anchored on both ledgers.", fact: "Receipts anchored both ways" },
  { v: "Revoke", d: "One tap pauses every delegation in the next block. Revocation leaves a gap at twelve o'clock.", fact: "Next block" },
] as const;

const R = 0.8;
const station = (i: number, r = R) => {
  const a = ((-90 + (i * 360) / 7) * Math.PI) / 180;
  return [f3(r * Math.cos(a)), f3(r * Math.sin(a))] as const;
};

const S = { fill: "none", stroke: "currentColor", strokeWidth: 0.018, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The diagram drawn inside the ring for each verb (unit box, r <= 0.42). */
function VerbDiagram({ i }: { i: number }) {
  switch (i) {
    case 0:
      return (
        <g {...S}>
          <path d="M-0.3 -0.16h0.6M-0.3 0h0.48M-0.3 0.16h0.36" />
          <path d="M-0.36 -0.3q-0.08 0 -0.08 0.08" />
        </g>
      );
    case 1:
      return (
        <g {...S}>
          <path d="M-0.36 -0.16h0.26M-0.36 0h0.26M-0.36 0.16h0.2" />
          <path d="M0.1 -0.16h0.26M0.1 0h0.26M0.1 0.16h0.2" />
          <path d="M-0.04 -0.22v0.44" strokeDasharray="0.02 0.04" />
        </g>
      );
    case 2:
      return (
        <g {...S} strokeWidth={0.014}>
          <circle r="0.2" />
          {Array.from({ length: 32 }, (_, k) => {
            const a = ((-90 + k * 11.25) * Math.PI) / 180;
            const l = [0.05, 0.11, 0.03, 0.08, 0.06, 0.12, 0.04, 0.09][k % 8]!;
            return <path key={k} d={`M${f3(0.26 * Math.cos(a))} ${f3(0.26 * Math.sin(a))}L${f3((0.26 + l) * Math.cos(a))} ${f3((0.26 + l) * Math.sin(a))}`} />;
          })}
        </g>
      );
    case 3:
      return (
        <g {...S}>
          <circle r="0.3" />
          <path d="M-0.21 0.21L0.21 -0.21" />
        </g>
      );
    case 4:
      return (
        <g {...S}>
          <circle r="0.3" />
          <path d="M-0.13 0.01l0.09 0.09l0.18 -0.2" />
        </g>
      );
    case 5:
      return (
        <g {...S}>
          <path d="M-0.22 -0.3h0.32l0.12 0.12v0.48h-0.44z" />
          <path d="M-0.12 -0.06h0.24M-0.12 0.06h0.24M-0.12 0.18h0.14" />
          <circle cx="0.3" cy="0.3" r="0.05" fill="var(--steel)" stroke="none" />
        </g>
      );
    default:
      return (
        <g {...S}>
          <path d="M0.08 -0.29A0.3 0.3 0 1 1 -0.08 -0.29" strokeDasharray="0.05 0.035" />
        </g>
      );
  }
}

export function Verbs() {
  const root = useRef<HTMLElement>(null);
  const progress = useRef<SVGCircleElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  const motionOff = useMotionOff();

  useEffect(() => {
    let cancelled = false;
    let revert: (() => void) | undefined;
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger"), import("gsap/SplitText")]).then(([{ gsap }, { ScrollTrigger }, { SplitText }]) => {
      if (cancelled || !root.current) return;
      gsap.registerPlugin(ScrollTrigger, SplitText);
      const ctx = gsap.context(() => {
        const items = gsap.utils.toArray<HTMLElement>("[data-verb]", root.current);
        // The active station follows the reader in every mode (it is state, not decoration).
        items.forEach((el, i) =>
          ScrollTrigger.create({ trigger: el, start: "top 60%", end: "bottom 60%", onToggle: (self) => self.isActive && setActive(i) }),
        );
        const ring = progress.current;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (motionOff || reduce) {
          if (ring) gsap.set(ring, { attr: { "stroke-dasharray": "1 0" } });
          return;
        }
        if (ring) {
          gsap.fromTo(
            ring,
            { attr: { "stroke-dasharray": "0 2" } },
            { attr: { "stroke-dasharray": "1 2" }, ease: "none", scrollTrigger: { trigger: list.current, start: "top 60%", end: "bottom 60%", scrub: 0.5 } },
          );
        }
        items.forEach((el) => {
          const h = el.querySelector("h3");
          if (!h) return;
          const split = SplitText.create(h, { type: "chars", mask: "chars" });
          gsap.from(split.chars, {
            yPercent: 105,
            duration: 0.7,
            ease: "power3.out",
            stagger: 0.028,
            scrollTrigger: { trigger: el, start: "top 82%", once: true },
          });
        });
      }, root);
      revert = () => ctx.revert();
    });
    return () => {
      cancelled = true;
      revert?.();
    };
  }, [motionOff]);

  return (
    <section ref={root} aria-labelledby="verbs-title" className="yl-section relative border-y border-line-1 bg-bg-1">
      <div className="yl-container">
        <SectionHead
          index="02"
          eyebrow="Seven verbs"
          id="verbs-title"
          title="A power of attorney, enforced by code"
          lead="Say it, see it, seal it. Then the chain enforces it, anyone can verify it, every action proves itself, and one tap revokes it."
        />
        <div className="mt-14 grid gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="hidden lg:col-span-5 lg:block">
            <div className="sticky top-[calc(var(--nav-h)+8vh)]">
              <svg viewBox="-1.15 -1.15 2.3 2.3" className="w-full max-w-[460px] overflow-visible" role="img" aria-label={`The mandate life cycle, at ${VERBS[active]!.v}`}>
                <circle r={R} fill="none" stroke="var(--line-2)" strokeWidth="0.006" />
                <circle
                  ref={progress}
                  r={R}
                  fill="none"
                  stroke="var(--chrome-1)"
                  strokeWidth="0.012"
                  pathLength={1}
                  strokeDasharray="1 0"
                  transform="rotate(-90)"
                />
                {VERBS.map(({ v }, i) => {
                  const [x, y] = station(i);
                  const [lx, ly] = station(i, 1.0);
                  const on = i === active;
                  return (
                    <g key={v}>
                      <circle cx={x} cy={y} r={on ? 0.045 : 0.03} fill={on ? "var(--fg-0)" : "var(--bg-1)"} stroke={on ? "var(--fg-0)" : "var(--line-3)"} strokeWidth="0.01" className="transition-[fill,stroke] duration-200 ease-[var(--ease-out)]" />
                      <text
                        x={lx}
                        y={ly}
                        fontSize="0.07"
                        textAnchor={Math.abs(lx) < 0.2 ? "middle" : lx > 0 ? "start" : "end"}
                        dominantBaseline="middle"
                        fill={on ? "var(--fg-0)" : "var(--fg-muted)"}
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        {v}
                      </text>
                    </g>
                  );
                })}
                <g key={active} className={cn("text-fg-1", !motionOff && "yl-verb-diagram")}>
                  <VerbDiagram i={active} />
                  <text y="0.56" fontSize="0.06" textAnchor="middle" fill="var(--fg-muted)" style={{ fontFamily: "var(--font-mono)" }}>
                    {String(active + 1).padStart(2, "0")} / 07
                  </text>
                </g>
              </svg>
            </div>
          </div>
          <ol ref={list} className="m-0 grid list-none gap-0 p-0 lg:col-span-7">
            {VERBS.map(({ v, d, fact }, i) => (
              <li
                key={v}
                data-verb
                className={cn(
                  "grid grid-cols-[3rem_1fr] gap-4 border-t border-line-2 py-9 transition-colors duration-300 lg:min-h-[44vh] lg:py-14",
                  i === active ? "text-fg-0" : "text-fg-2",
                )}
              >
                <span className="kicker pt-2">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="type-display m-0 text-[2.5rem] leading-[1.02] sm:text-[3.25rem]">{v}</h3>
                  <p className="m-0 mt-4 max-w-[48ch] text-15 text-fg-2 sm:text-18 sm:leading-[1.6]">{d}</p>
                  <p className="m-0 mt-5 inline-flex items-center gap-2 text-12 text-fg-muted">
                    <span aria-hidden="true" className="size-1.5 rounded-pill bg-fg-muted" />
                    {fact}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
