import Link from "next/link";
import { ViewTransition } from "react";
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
import { SITE } from "@/content/site-data";
import { BuildTimeline } from "./timeline";

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

/** Delegated authority as it is handed to software today, and what changes with a mandate. */
const PROBLEM = [
  {
    today: "A card number or an API key: whoever holds it can spend all of it.",
    mandate: "A mandate sealed with your passkey: caps, payees, categories and a reserve floor, enforced by the chain.",
  },
  {
    today: "A wallet address with no owner behind it: nobody can tell whose agent this is.",
    mandate: "A passport bound to a verified owner and attested by issuers the owner trusts.",
  },
  {
    today: "Logs the operator keeps: you trust whoever wrote them.",
    mandate: "A receipt for every action, hash-chained and anchored on two ledgers, verifiable in TypeScript or Python.",
  },
  {
    today: "Revoking means finding and rotating every copy of a key.",
    mandate: "One tap pauses every delegation in the next block.",
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
  { href: `${REPO_URL}/issues`, label: "Contact the team", note: "Questions and reports as GitHub issues", external: true },
  { href: "/proof", label: "Proof", note: "Every number with its source", external: false },
  { href: "/challenge", label: "Judge's Challenge", note: "Try to move funds outside a mandate", external: false },
  { href: "/start", label: "Your own agent", note: "Sign up with a passkey, test units only", external: false },
] as const;

/** Two rings joined by one seam: the same mandate on a public and on a consortium ledger. */
function TwinGlyph() {
  return (
    <svg viewBox="0 0 220 120" className="w-full max-w-[320px]" aria-hidden="true">
      <circle cx="62" cy="60" r="44" fill="none" stroke="var(--chrome-1)" strokeWidth="1.5" />
      <circle cx="158" cy="60" r="44" fill="none" stroke="var(--chrome-1)" strokeWidth="1.5" />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (-90 + i * 15) * (Math.PI / 180);
        const l = [7, 12, 5, 10, 8, 13][i % 6]!;
        return (
          <g key={i} stroke="var(--fg-2)" strokeWidth="1.2" strokeLinecap="round">
            <path d={`M${(62 + 48 * Math.cos(a)).toFixed(2)} ${(60 + 48 * Math.sin(a)).toFixed(2)}L${(62 + (48 + l) * Math.cos(a)).toFixed(2)} ${(60 + (48 + l) * Math.sin(a)).toFixed(2)}`} />
            <path d={`M${(158 + 48 * Math.cos(a)).toFixed(2)} ${(60 + 48 * Math.sin(a)).toFixed(2)}L${(158 + (48 + l) * Math.cos(a)).toFixed(2)} ${(60 + (48 + l) * Math.sin(a)).toFixed(2)}`} />
          </g>
        );
      })}
      <path d="M106 60h8" stroke="var(--steel)" strokeWidth="1.5" />
      <circle cx="62" cy="16" r="3.5" fill="var(--steel)" />
      <circle cx="158" cy="16" r="3.5" fill="var(--fg-1)" />
    </svg>
  );
}

export function AboutPage() {
  const novelty = SITE.novelty;
  const twin = SITE.twin;
  const equal = twin ? twin.enforcers.filter((e) => e.base && e.fisco && e.base.codeHash.toLowerCase() === e.fisco.codeHash.toLowerCase()).length : null;
  const stack = SITE.stack ?? [];

  return (
    <ViewTransition>
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
                  An AI agent that pays for you
                </span>
                <span className="yl-hero-line block text-fg-muted" style={{ ["--d" as string]: "140ms" }}>
                  and proves it kept to your rules.
                </span>
              </h1>
              <p className="yl-hero-in m-0 mt-7 max-w-[40rem] text-lead text-fg-2" style={{ ["--d" as string]: "220ms" }}>
                YINGLONG gives an AI agent its own ID, spending rules that only its owner can set (locked with a fingerprint or a secret key),
                nine safety checks before any payment, and a receipt for every action that anyone can check on a blockchain.
              </p>
              <nav aria-label="On this page" className="yl-hero-in mt-9 flex flex-wrap gap-x-5 gap-y-2 text-13" style={{ ["--d" as string]: "280ms" }}>
                {[
                  ["#problem-title", "The problem"],
                  ["#new-title", "What is new"],
                  ["#build-title", "The build"],
                  ["#stack-title", "Stack"],
                  ["#team-title", "Team"],
                  ["#links-title", "Contact"],
                ].map(([href, label]) => (
                  <a key={href} href={href} className="text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-0 hover:decoration-fg-1">
                    {label}
                  </a>
                ))}
              </nav>
            </div>
            <div className="yl-hero-in flex items-end lg:col-span-5 lg:justify-end" style={{ ["--d" as string]: "300ms" }}>
              <div className="grid w-full max-w-[380px] gap-5 rounded-sheet border border-line-1 bg-bg-1 p-6">
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

        {/* The problem */}
        <section aria-labelledby="problem-title" className="yl-section">
          <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="01"
              eyebrow="The problem"
              id="problem-title"
              title="AI agents need delegated authority, with limits"
              lead="Agents are starting to pay, convert, escrow and invest for people and companies. A bank would never let a stranger do that without asking who it is, what it may do, and whether anyone can check what it did."
              className="lg:sticky lg:top-[calc(var(--nav-h)+3rem)] lg:col-span-5 lg:self-start"
            />
            <div className="lg:col-span-7">
              <div className="hidden grid-cols-2 gap-x-6 border-b border-line-2 pb-3 sm:grid">
                <p className="eyebrow m-0 text-fg-muted">Authority handed to software today</p>
                <p className="eyebrow m-0 text-fg-muted">With a YINGLONG mandate</p>
              </div>
              <ol className="m-0 grid list-none p-0">
                {PROBLEM.map((p, i) => (
                  <li key={i} className="yl-reveal grid gap-x-6 gap-y-3 border-b border-line-1 py-6 sm:grid-cols-2">
                    <p className="m-0 flex gap-3 text-15 text-fg-2">
                      <span className="kicker shrink-0 pt-0.5">{String(i + 1).padStart(2, "0")}</span>
                      <span>
                        <span className="eyebrow mb-1 block text-fg-muted sm:hidden">Today</span>
                        {p.today}
                      </span>
                    </p>
                    <p className="m-0 flex gap-3 text-15 text-fg-0">
                      <span className="shrink-0 pt-0.5 text-fg-1">
                        <RingGlyph state="verified" size={16} />
                      </span>
                      <span>
                        <span className="eyebrow mb-1 block text-fg-muted sm:hidden">With a mandate</span>
                        {p.mandate}
                      </span>
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* What is new */}
        <section aria-labelledby="new-title" className="yl-section border-y border-line-1 bg-bg-1">
          <div className="yl-container">
            <SectionHead index="02" eyebrow="What is new" id="new-title" title="Identity and mandate, unchanged across two kinds of chain" />
            <div className="mt-12 grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
              <figure className="m-0 lg:col-span-8">
                {novelty ? (
                  <>
                    <blockquote className="type-display yl-reveal m-0 max-w-[30ch] text-[1.6rem] leading-[1.2] text-fg-0 sm:text-[2.1rem]">
                      {novelty.text}
                    </blockquote>
                    <figcaption className="mt-6 grid gap-1 text-12 text-fg-muted">
                      <span>
                        Claim {novelty.id}, wording {novelty.decision}: the lead&apos;s decision after the rival check (docs/evidence/rival-check.md).
                      </span>
                      <span>Identity plus an on-chain mandate alone is not new; the claim rests on the same enforcement code running on a public chain and a consortium chain.</span>
                    </figcaption>
                  </>
                ) : (
                  <p className="m-0 text-15 text-fg-2">The novelty wording is generated from docs/CLAIMS.md at build time; this build had none.</p>
                )}
              </figure>
              <div className="grid justify-items-start gap-4 lg:col-span-4 lg:justify-items-end">
                <TwinGlyph />
                {twin && equal !== null ? (
                  <p className="m-0 max-w-[30ch] text-13 text-fg-2 lg:text-right">
                    <span className="font-mono text-fg-0">
                      {equal}/{twin.enforcers.length}
                    </span>{" "}
                    YINGLONG enforcers with identical runtime bytecode on Base Sepolia and FISCO BCOS (deployment files).
                  </p>
                ) : null}
                <ButtonLink href="/#twin-title" variant="secondary">
                  Compare the code hashes <ArrowIcon />
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>

        {/* Pillars */}
        <section aria-labelledby="about-pillars-title" className="yl-section">
          <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="03"
              eyebrow="How it works"
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

        {/* The build */}
        <section aria-labelledby="build-title" className="yl-section border-y border-line-1 bg-bg-1">
          <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="04"
              eyebrow="The build"
              id="build-title"
              title="How it came together, from the git history"
              lead="Every row is a commit in the public repository. Milestones are the commits that took a capability live end to end."
              className="lg:sticky lg:top-[calc(var(--nav-h)+3rem)] lg:col-span-4 lg:self-start"
            />
            <div className="lg:col-span-8">
              <BuildTimeline />
            </div>
          </div>
        </section>

        {/* Stack */}
        <section aria-labelledby="stack-title" className="yl-section">
          <div className="yl-container">
            <SectionHead
              index="05"
              eyebrow="Technology"
              id="stack-title"
              title="The stack"
              lead="Pinned versions, read from the manifests at build time. Everything runs from the repository; nothing on this site loads from a third-party origin."
            />
            <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {stack.map((layer) => (
                <section key={layer.layer} aria-label={layer.layer} className="yl-card yl-reveal grid content-start gap-4 p-6">
                  <h3 className="eyebrow m-0 text-fg-muted">{layer.layer}</h3>
                  <ul className="m-0 grid list-none gap-3 p-0">
                    {layer.items.map((it) => (
                      <li key={it.name} className="grid gap-0.5">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-15 font-medium text-fg-0">{it.name}</span>
                          {it.version ? <span className="font-mono text-12 text-fg-muted">{it.version}</span> : null}
                        </span>
                        <span className="text-12 text-fg-2">{it.note.trim()}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </section>

        {/* Competition */}
        <section aria-labelledby="competition-title" className="yl-section border-y border-line-1 bg-bg-1">
          <div className="yl-container">
            <SectionHead
              index="06"
              eyebrow="The competition"
              id="competition-title"
              title="Topic F, Agent Wallet, proven through two deep scenarios"
              lead="One engine carries both scenarios: every money movement passes the seal, the nine scales, the chain and the receipt."
            />
            <div className="mt-14 grid gap-3 lg:grid-cols-12">
              <dl className="yl-card yl-card-raised yl-reveal m-0 grid content-start gap-0 p-6 sm:p-8 lg:col-span-4">
                {COMPETITION.map((c, i) => (
                  <div key={c.term} className={cn("grid gap-1 py-4", i > 0 && "border-t border-line-1")}>
                    <dt className="eyebrow text-fg-muted">{c.term}</dt>
                    <dd className="m-0 text-15 text-fg-0">{c.value}</dd>
                  </div>
                ))}
              </dl>
              {SCENARIOS.map((s, i) => (
                <article key={s.name} className="yl-card yl-card-raised yl-reveal grid content-start gap-4 p-6 sm:p-8 lg:col-span-4">
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

        {/* Team */}
        <section aria-labelledby="team-title" className="yl-section">
          <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="07"
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
        <section aria-labelledby="honesty-title" className="yl-section border-y border-line-1 bg-bg-1">
          <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="08"
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

        {/* Contact and links */}
        <section aria-labelledby="links-title" className="yl-section">
          <div className="yl-container">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHead
                index="09"
                eyebrow="Contact and links"
                id="links-title"
                title="Source, docs, proof, and how to reach us"
                lead="The team takes questions and reports through the repository's issues."
              />
              <div className="flex items-center gap-3 text-fg-0">
                <Mark size={28} decorative />
                <Wordmark height={12} />
              </div>
            </div>
            <ul className="m-0 mt-12 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="mt-12 flex flex-wrap gap-3">
              <ButtonLink href="/start" size="lg">
                <PasskeyIcon size={16} />
                Sign up with your passkey
              </ButtonLink>
              <ButtonLink href="/" variant="secondary" size="lg">
                See the Mandate Orbit <ArrowIcon />
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>
    </ViewTransition>
  );
}
