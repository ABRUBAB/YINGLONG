import Link from "next/link";
import { cn, RingGlyph } from "@yinglong/ui";
import { Mark, TeamMark, Wordmark } from "@/components/brand/mark";
import { ArrowIcon, ButtonLink, ExternalIcon } from "@/components/ui/button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { PillarGlyph } from "@/components/landing/pillar-glyph";
import { SectionHead } from "@/components/landing/sections";
import { PasskeyIcon } from "@/components/shell/site-nav";
import { REPO_URL } from "@/components/shell/site-footer";
import { PILLARS } from "@/content/pillars";
import { TEAM } from "@/content/team";

const COMPETITION = [
  { term: "Competition", value: "2026 Shenzhen International FinTech Competition" },
  { term: "Track", value: "International Track" },
  { term: "Topic", value: "F: Agent Wallet" },
  { term: "Proven through", value: "Two deep scenarios on one engine" },
] as const;

const SCENARIOS = [
  {
    name: "Cross-border student",
    where: "Hong Kong",
    text: "Nadia, an MSc student from Dhaka, and her agent Ying: rent, food budgets, FX quotes bought over x402 and a tuition deposit in escrow, on a Hong Kong test rail.",
  },
  {
    name: "SME programmable treasury",
    where: "Shenzhen and Hong Kong",
    text: "Lotus Lane's treasurer agent pays suppliers and payroll inside a board mandate on a coin-free FISCO BCOS rail; anything outside its lanes needs two of three directors.",
  },
] as const;

const HONESTY = [
  "Every amount is in test units. Nothing on this site moves real money.",
  "Public transactions run on testnets (Base Sepolia). The consortium ledger is a FISCO BCOS chain the team runs itself.",
  "Settlement on the mainland rail is an e-CNY-style simulator, not the PBoC sandbox and not an e-CNY integration.",
  "There is no bank partnership, no licence and no third-party audit. Nothing here is production-ready.",
  "Nadia Rahman, Lotus Lane, Harbour Homes, Harbour Bay University and every other person or company in the demo is fictional.",
  "Explanations written by a language model carry an \"AI-generated\" label. Deterministic code decides; the AI only proposes, explains or escalates.",
] as const;

const LINKS = [
  { href: REPO_URL, label: "Source code", note: "github.com/ABRUBAB/YINGLONG", external: true },
  { href: `${REPO_URL}/tree/main/docs`, label: "Documentation", note: "Architecture, design system and API", external: true },
  { href: "/proof", label: "Proof", note: "Every number with its source", external: false },
  { href: "/challenge", label: "Judge's Challenge", note: "Try to move funds outside a mandate", external: false },
] as const;

export function AboutPage() {
  return (
    <main id="main">
      {/* Header */}
      <section data-surface="obsidian" aria-labelledby="about-title" className="relative overflow-hidden border-b border-line-1 bg-bg-0 text-fg-1">
        <div className="yl-container grid gap-12 pt-16 pb-16 sm:pt-24 lg:grid-cols-12 lg:gap-8 lg:pt-28 lg:pb-24">
          <div className="lg:col-span-7">
            <p className="yl-hero-in eyebrow m-0 flex items-center gap-3 text-fg-muted">
              <span aria-hidden="true" className="h-px w-8 bg-line-3" />
              About YINGLONG
            </p>
            <h1 id="about-title" className="type-hero m-0 mt-6 text-[2.5rem] text-fg-0 sm:text-[3.5rem] lg:text-[clamp(3.25rem,1rem+3.4vw,4.75rem)]">
              <span className="yl-hero-line block" style={{ ["--d" as string]: "60ms" }}>
                An agent wallet
              </span>
              <span className="yl-hero-line block text-fg-muted" style={{ ["--d" as string]: "140ms" }}>
                that proves it stayed inside its mandate.
              </span>
            </h1>
            <p className="yl-hero-in m-0 mt-7 max-w-[40rem] text-lead text-fg-2" style={{ ["--d" as string]: "220ms" }}>
              YINGLONG gives a personal AI agent an identity, a mandate its owner seals with a passkey, nine defences between any request and the
              chain, and a receipt for every action that anyone can verify.
            </p>
          </div>
          <div className="yl-hero-in flex items-end lg:col-span-5 lg:justify-end" style={{ ["--d" as string]: "300ms" }}>
            <div className="grid w-full max-w-[360px] gap-5 rounded-sheet border border-line-1 bg-bg-1 p-6">
              <div className="flex items-center gap-4">
                <TeamMark size={56} className="text-fg-0" />
                <div>
                  <p className="m-0 text-18 font-medium text-fg-0">Team {TEAM.name}</p>
                  <p className="m-0 text-13 text-fg-muted">{TEAM.country}</p>
                </div>
              </div>
              <dl className="m-0 grid gap-2 border-t border-line-1 pt-4 text-13">
                {COMPETITION.slice(0, 3).map((c) => (
                  <div key={c.term} className="flex justify-between gap-4">
                    <dt className="text-fg-muted">{c.term}</dt>
                    <dd className="m-0 text-right text-fg-1">{c.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* What it is */}
      <section aria-labelledby="what-title" className="yl-section">
        <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
          <SectionHead index="01" eyebrow="What it is" id="what-title" title="Personal Agent Identity & Mandated Finance" className="lg:col-span-5" />
          <div className="grid content-start gap-6 text-15 text-fg-2 sm:text-18 sm:leading-[1.65] lg:col-span-7">
            <p className="yl-reveal m-0">
              AI agents are starting to pay, convert, escrow and invest on behalf of people and companies. A bank would never let a stranger do
              that without asking three questions: who is this, what may it do, and can anyone check what it did. YINGLONG answers them for agents,
              in code, on ledgers a supervisor can read.
            </p>
            <p className="yl-reveal m-0">
              You state your rules in plain words. They are compiled into on-chain caveat enforcers, decoded back into sentences for you to compare,
              and sealed with your passkey. From then on the agent can act alone only inside that mandate; anything near its edge waits for your
              approval, and anything outside it is refused by deterministic rules and reverts on chain.
            </p>
            <p className="yl-reveal m-0">
              The same enforcer bytecode runs on a public testnet and on a FISCO BCOS consortium ledger, so one mandate is enforced identically in
              Hong Kong and on the mainland, and every receipt is anchored on both.
            </p>
            <div className="yl-reveal mt-2 flex flex-wrap gap-3">
              <ButtonLink href="/start" size="lg">
                <PasskeyIcon size={16} />
                Sign up with your passkey
              </ButtonLink>
              <ButtonLink href="/" variant="secondary" size="lg">
                See the Mandate Orbit <ArrowIcon />
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      {/* Competition */}
      <section aria-labelledby="competition-title" className="yl-section border-y border-line-1 bg-bg-1">
        <div className="yl-container">
          <SectionHead
            index="02"
            eyebrow="The competition"
            id="competition-title"
            title="Topic F, Agent Wallet, proven through two deep scenarios"
            lead="One engine carries both scenarios: every money movement passes the seal, the nine scales, the chain and the receipt."
          />
          <div className="mt-14 grid gap-3 lg:grid-cols-12">
            <dl className="yl-card yl-reveal m-0 grid content-start gap-0 p-6 sm:p-8 lg:col-span-4">
              {COMPETITION.map((c, i) => (
                <div key={c.term} className={cn("grid gap-1 py-4", i > 0 && "border-t border-line-1")}>
                  <dt className="eyebrow text-fg-muted">{c.term}</dt>
                  <dd className="m-0 text-15 text-fg-0">{c.value}</dd>
                </div>
              ))}
            </dl>
            {SCENARIOS.map((s, i) => (
              <article key={s.name} className="yl-card yl-reveal grid content-start gap-4 p-6 sm:p-8 lg:col-span-4">
                <p className="m-0 flex items-center justify-between gap-4">
                  <span className="kicker">Scenario {i + 1}</span>
                  <span className="text-12 text-fg-muted">{s.where}</span>
                </p>
                <h3 className="type-display m-0 text-h3 text-fg-0">{s.name}</h3>
                <p className="m-0 text-15 text-fg-2">{s.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section aria-labelledby="about-pillars-title" className="yl-section">
        <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
          <SectionHead
            index="03"
            eyebrow="Architecture"
            id="about-pillars-title"
            title="Five pillars"
            lead="Each pillar answers one question a supervisor would ask of any agent that touches money."
            className="lg:sticky lg:top-[calc(var(--nav-h)+3rem)] lg:col-span-4 lg:self-start"
          />
          <ol className="m-0 grid list-none gap-0 border-t border-line-2 p-0 lg:col-span-8">
            {PILLARS.map((p, i) => (
              <li key={p.id} className="yl-reveal grid gap-4 border-b border-line-2 py-8 sm:grid-cols-[3rem_9rem_1fr] sm:gap-6">
                <span className="kicker pt-1.5">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex items-center gap-3 sm:block">
                  <span className="text-fg-1 sm:mb-3 sm:block">
                    <PillarGlyph id={p.id} size={32} />
                  </span>
                  <div>
                    <p className="type-display m-0 text-22 text-fg-0">{p.name}</p>
                    <p className="eyebrow m-0 mt-1 text-fg-muted">{p.role}</p>
                  </div>
                </div>
                <div className="grid gap-2">
                  <h3 className="m-0 text-18 font-medium text-fg-0 sm:text-22 sm:leading-snug">{p.question}</h3>
                  <p className="m-0 max-w-[60ch] text-15 text-fg-2">{p.answer}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Team */}
      <section aria-labelledby="team-title" className="yl-section border-y border-line-1 bg-bg-1">
        <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
          <SectionHead
            index="04"
            eyebrow="The team"
            id="team-title"
            title={`Team ${TEAM.name}`}
            lead={`An independent team from ${TEAM.country}. YINGLONG is a Shadow Chaser innovation.`}
            className="lg:col-span-5"
          >
            <div className="mt-4 flex items-center gap-3 text-signature">
              <TeamMark size={28} decorative />
              <span className="text-13">A Shadow Chaser innovation</span>
            </div>
          </SectionHead>
          <ul className="m-0 grid list-none content-start gap-3 p-0 sm:grid-cols-2 lg:col-span-7">
            {TEAM.members.map((m) => (
              <li key={m.name} className="yl-reveal flex">
                <SpotlightCard className="flex w-full flex-col gap-6 p-6 sm:p-7">
                  <div className="flex items-center justify-between gap-4">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-12 items-center justify-center rounded-pill border border-line-2 bg-bg-2 font-mono text-15 text-fg-0"
                    >
                      {m.name.slice(0, 2)}
                    </span>
                    {m.lead ? <span className="eyebrow rounded-pill border border-line-2 px-2.5 py-1 text-fg-2">Lead</span> : null}
                  </div>
                  <div className="grid gap-1">
                    <p className="m-0 text-22 font-medium text-fg-0">{m.name}</p>
                    <p className="m-0 text-13 text-fg-muted">{m.role}</p>
                  </div>
                  {m.links?.length ? (
                    <div className="mt-auto flex flex-wrap gap-4 border-t border-line-1 pt-4 text-13">
                      {m.links.map((l) => (
                        <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-fg-1 hover:text-fg-0">
                          {l.label} <ExternalIcon />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </SpotlightCard>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Honesty */}
      <section aria-labelledby="honesty-title" className="yl-section">
        <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
          <SectionHead
            index="05"
            eyebrow="Honest labels"
            id="honesty-title"
            title="What is real, and what is simulated"
            lead="The site labels every simulated thing where it appears. Here is the whole list in one place."
            className="lg:col-span-5"
          />
          <ul className="m-0 grid list-none gap-0 border-t border-line-2 p-0 lg:col-span-7">
            {HONESTY.map((h) => (
              <li key={h} className="yl-reveal flex items-start gap-4 border-b border-line-1 py-5 text-15 text-fg-1">
                <span className="mt-0.5 text-fg-2">
                  <RingGlyph state="unknown" size={20} />
                </span>
                {h}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Links */}
      <section aria-labelledby="links-title" className="yl-section border-t border-line-1 bg-bg-1">
        <div className="yl-container">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHead index="06" eyebrow="Read further" id="links-title" title="Source, docs and proof" />
            <div className="flex items-center gap-3 text-fg-0">
              <Mark size={28} decorative />
              <Wordmark height={12} />
            </div>
          </div>
          <ul className="m-0 mt-12 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {LINKS.map((l) => {
              const inner = (
                <>
                  <span className="flex items-center justify-between gap-3 text-18 font-medium text-fg-0">
                    {l.label}
                    {l.external ? <ExternalIcon /> : <ArrowIcon />}
                  </span>
                  <span className="text-13 text-fg-muted">{l.note}</span>
                  {l.external ? <span className="sr-only">(opens in a new tab)</span> : null}
                </>
              );
              return (
                <li key={l.href} className="yl-reveal flex">
                  {l.external ? (
                    <a href={l.href} target="_blank" rel="noreferrer" className="yl-card grid w-full content-start gap-2 p-6" data-interactive>
                      {inner}
                    </a>
                  ) : (
                    <Link href={l.href} className="yl-card grid w-full content-start gap-2 p-6" data-interactive>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </main>
  );
}
