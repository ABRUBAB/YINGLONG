import Link from "next/link";
import { f3, LabelChip, OutputChip, RingGlyph } from "@yinglong/ui";
import { ArrowIcon, ButtonLink } from "@/components/ui/button";

/* ------------------------------------------------------------------ 2. Three questions */

const QUESTIONS = [
  {
    q: "Who is this agent, and who does it act for?",
    pillar: "Pearl",
    a: "An ERC-8004 passport bound to a verified owner and attested by issuers the owner trusts. A self-issued passport is refused at the counterparty scale.",
  },
  {
    q: "What may it do, and who decides?",
    pillar: "Seal",
    a: "Rules in plain words, compiled into caveat enforcers and sealed with a passkey. Tiers decide who acts: the agent alone, you on your phone, or only your own account.",
  },
  {
    q: "Can anyone check what it did, and why?",
    pillar: "Vein",
    a: "Every action writes a receipt that is chained, anchored on a public and a consortium ledger, and verifiable with one command.",
  },
];

export function Questions() {
  return (
    <section aria-labelledby="questions-title" className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="eyebrow m-0 text-fg-muted">Three questions</p>
          <h2 id="questions-title" className="type-display m-0 mt-3 text-h2 text-fg-0">
            Before an agent touches money
          </h2>
          <p className="m-0 mt-4 max-w-[32ch] text-15 text-fg-2">
            A bank asks them of every person. YINGLONG answers them for every agent, on a ledger a supervisor can read.
          </p>
        </div>
        <ol className="m-0 grid list-none gap-0 p-0 lg:col-span-8">
          {QUESTIONS.map((x, i) => (
            <li key={x.pillar} className="yl-reveal grid gap-3 border-t border-line-2 py-7 sm:grid-cols-[3rem_1fr_7rem] sm:gap-6">
              <span className="font-mono text-13 text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
              <div className="grid gap-2">
                <h3 className="m-0 text-22 leading-tight font-medium text-fg-0 sm:text-26">{x.q}</h3>
                <p className="m-0 max-w-[60ch] text-15 text-fg-2">{x.a}</p>
              </div>
              <p className="eyebrow m-0 text-fg-muted sm:text-right">{x.pillar}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 3. Seven verbs, as a scroll-driven ring */

const VERBS = [
  ["Say", "You state the rules in English, Bangla or Chinese. Every rule you will be held to is English."],
  ["See", "The rules come back as sentences decoded from the typed terms, side by side with what you said."],
  ["Seal", "Your passkey signs the delegation. Sixty-four ticks of its hash appear as the Hash Ring."],
  ["Enforce", "Caveat enforcers are the rules. The same bytecode runs on Base Sepolia and on FISCO BCOS."],
  ["Verify", "Anyone recomputes the delegation hash and decodes the caveats back, in TypeScript or Python."],
  ["Prove", "Each action writes an accountability receipt, anchored both ways."],
  ["Revoke", "One tap pauses every delegation in the next block. Revocation leaves a gap at twelve o'clock."],
] as const;

export function Verbs() {
  const r = 0.86;
  return (
    <section aria-labelledby="verbs-title" className="yl-verbs-scope relative border-y border-line-1 bg-bg-1">
      <div className="mx-auto grid w-full max-w-[1320px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-28">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-[calc(50vh-220px)]">
            <p className="eyebrow m-0 text-fg-muted">Seven verbs</p>
            <h2 id="verbs-title" className="type-display m-0 mt-3 text-h2 text-fg-0">
              A power of attorney, enforced by code
            </h2>
            <svg viewBox="-1 -1 2 2" className="mx-auto mt-10 w-[min(100%-6rem,380px)] overflow-visible lg:mx-0" role="img" aria-label="A ring with seven stations: say, see, seal, enforce, verify, prove, revoke">
              <circle r={r} fill="none" stroke="var(--line-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <circle
                r={r}
                fill="none"
                stroke="var(--chrome-1)"
                strokeWidth="0.011"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset="0"
                transform="rotate(-90)"
                className="yl-verbs-ring-progress"
              />
              {VERBS.map(([v], i) => {
                const a = ((-90 + (i * 360) / 7) * Math.PI) / 180;
                const x = f3(r * Math.cos(a));
                const y = f3(r * Math.sin(a));
                const lx = f3(1.12 * Math.cos(a));
                const ly = f3(1.12 * Math.sin(a));
                return (
                  <g key={v}>
                    <circle cx={x} cy={y} r={0.035} fill="var(--bg-1)" stroke="var(--fg-1)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
                    <text
                      x={lx}
                      y={ly}
                      fontSize="0.085"
                      textAnchor={Math.abs(lx) < 0.2 ? "middle" : lx > 0 ? "start" : "end"}
                      dominantBaseline="middle"
                      fill="var(--fg-2)"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {v}
                    </text>
                  </g>
                );
              })}
              <circle cx={f3(r * Math.cos(-Math.PI / 6))} cy={f3(r * Math.sin(-Math.PI / 6))} r={0.05} fill="var(--steel)" />
            </svg>
          </div>
        </div>
        <ol className="m-0 grid list-none gap-0 p-0 lg:col-span-7 lg:pt-24">
          {VERBS.map(([v, d], i) => (
            <li key={v} className="yl-verb grid grid-cols-[3rem_1fr] gap-4 border-t border-line-2 py-8 text-fg-1 lg:py-12">
              <span className="font-mono text-13 text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="type-display m-0 text-26 leading-none sm:text-32">{v}</h3>
                <p className="m-0 mt-3 max-w-[52ch] text-15 text-fg-2">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 4. One engine, two deep scenarios */

export function Scenarios() {
  return (
    <section aria-labelledby="scenarios-title" className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
      <p className="eyebrow m-0 text-fg-muted">Topic F, agent wallet</p>
      <h2 id="scenarios-title" className="type-display m-0 mt-3 max-w-[22ch] text-h2 text-fg-0">
        One engine, two deep scenarios
      </h2>
      <div className="mt-12 grid gap-0 border-t border-line-2 lg:grid-cols-2">
        <article className="grid content-start gap-5 border-b border-line-2 py-10 lg:border-r lg:border-b-0 lg:pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <LabelChip>HK test rail</LabelChip>
            <LabelChip>Base Sepolia (testnet)</LabelChip>
          </div>
          <h3 className="m-0 text-26 font-medium text-fg-0">Nadia, a student in Hong Kong</h3>
          <p className="m-0 max-w-[48ch] text-15 text-fg-2">
            Her agent Ying pays rent on the first, keeps food under a cap, buys FX quotes over x402 and puts the tuition deposit into escrow after she
            approves it on her phone.
          </p>
          <ul className="m-0 grid list-none gap-2.5 p-0 text-13 text-fg-1">
            {["Pay rent of 9,500.00 tHKD to Harbour Homes on the 1st.", "Spend at most 3,000.00 tHKD on food each month.", "Ask me before any payment above 2,000.00 tHKD."].map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-0.5 text-fg-2">
                  <OutputChip kind="rule" />
                </span>
                {s}
              </li>
            ))}
          </ul>
          <Link href="/app" className="inline-flex w-fit items-center gap-2 text-15 text-fg-0 underline decoration-line-3 underline-offset-4 hover:decoration-fg-1">
            Nadia&apos;s console <ArrowIcon />
          </Link>
        </article>
        <article className="grid content-start gap-5 py-10 lg:pl-12">
          <div className="flex flex-wrap items-center gap-2">
            <LabelChip>Coin-free rail</LabelChip>
            <LabelChip>FISCO BCOS</LabelChip>
            <LabelChip>e-CNY-style simulator</LabelChip>
          </div>
          <h3 className="m-0 text-26 font-medium text-fg-0">Lotus Lane, an SME in Shenzhen</h3>
          <p className="m-0 max-w-[48ch] text-15 text-fg-2">
            A treasurer agent pays suppliers and payroll inside the board&apos;s mandate. Anything outside its lanes becomes a 2-of-3 director proposal.
            Its Hong Kong subsidiary uses the same agent identity under a second mandate.
          </p>
          <ul className="m-0 grid list-none gap-2.5 p-0 text-13 text-fg-1">
            {["Payroll on the 10th, inside the board mandate.", "Supplier payments as conditional instructions.", "Capital purchases need two of three directors."].map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-0.5 text-fg-2">
                  <OutputChip kind="rule" />
                </span>
                {s}
              </li>
            ))}
          </ul>
          <Link href="/treasury" className="inline-flex w-fit items-center gap-2 text-15 text-fg-0 underline decoration-line-3 underline-offset-4 hover:decoration-fg-1">
            The treasury <ArrowIcon />
          </Link>
        </article>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ header and footer */

export function SiteFooter() {
  return (
    <footer className="border-t border-line-1 bg-bg-0">
      <div className="mx-auto grid w-full max-w-[1320px] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-12 lg:px-8">
        <div className="grid content-start gap-3 lg:col-span-5">
          <p className="m-0 text-13 text-fg-1">YINGLONG: Personal Agent Identity &amp; Mandated Finance</p>
          <p className="m-0 text-12 text-fg-muted">Your Identity. Your Agent. Your Authority.</p>
        </div>
        <div className="grid gap-2 text-12 text-fg-muted lg:col-span-7">
          <p className="m-0 flex flex-wrap items-center gap-2">
            <RingGlyph state="unknown" size={16} /> Test units only. e-CNY-style simulator, not the PBoC sandbox. No bank partnership, no licence, no
            third-party audit.
          </p>
          <p className="m-0">All third-party marks are the property of their respective owners. No partnership, sponsorship or endorsement is implied.</p>
          <nav aria-label="Footer" className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-13 text-fg-2">
            <Link href="/app" className="hover:text-fg-0">Console</Link>
            <Link href="/treasury" className="hover:text-fg-0">Treasury</Link>
            <Link href="/supervisor" className="hover:text-fg-0">Supervisor</Link>
            <Link href="/proof" className="hover:text-fg-0">Proof</Link>
            <Link href="/city" className="hover:text-fg-0">Agent City</Link>
            <Link href="/challenge" className="hover:text-fg-0">Judge&apos;s Challenge</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

export function EvidenceCta() {
  return (
    <ButtonLink href="/proof" variant="secondary">
      Every number with its source <ArrowIcon />
    </ButtonLink>
  );
}
