import Link from "next/link";
import { ViewTransition } from "react";
import { RingGlyph } from "@yinglong/ui";
import { Mark, TeamMark, Wordmark } from "@/components/brand/mark";
import { ArrowIcon, ButtonLink, ExternalIcon } from "@/components/ui/button";
import { PillarGlyph } from "@/components/landing/pillar-glyph";
import { SectionHead } from "@/components/landing/sections";
import { PasskeyIcon } from "@/components/shell/site-nav";
import { REPO_URL } from "@/components/shell/site-footer";
import { PILLARS } from "@/content/pillars";
import { TEAM } from "@/content/team";
import { SITE } from "@/content/site-data";
import { BuildTimeline } from "./timeline";
import "./about.css";

/**
 * About, as one scannable sheet (about 2,500 px at 1440): the one-sentence summary with the team
 * and competition card, the five pillars as hairline rows, the build timeline from git (compact),
 * the stack as hairline rows, the honest-labels list, then the team and the links.
 */

const COMPETITION = [
  { term: "Competition", value: "2026 Shenzhen International FinTech Competition" },
  { term: "Track", value: "International Track" },
  { term: "Topic", value: "F: Agent Wallet" },
  { term: "Shown through", value: "A student in Hong Kong and a company in Shenzhen, one engine" },
] as const;

const HONESTY = [
  "Every amount is in test units. Nothing on this site moves real money.",
  "Public transactions run on a testnet (Base Sepolia). The consortium ledger is a FISCO BCOS chain the team runs itself.",
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
  { href: "/challenge", label: "Try to hack it", note: "Try to move money outside the rules", external: false },
  { href: "/start", label: "Your own agent", note: "Sign up with a passkey, test units only", external: false },
] as const;

const ON_PAGE = [
  ["#about-pillars-title", "How it works"],
  ["#build-title", "The build"],
  ["#stack-title", "Stack"],
  ["#honesty-title", "Honest labels"],
  ["#team-title", "Team and links"],
] as const;

export function AboutPage() {
  const twin = SITE.twin;
  const equal = twin ? twin.enforcers.filter((e) => e.base && e.fisco && e.base.codeHash.toLowerCase() === e.fisco.codeHash.toLowerCase()).length : null;
  const stack = SITE.stack ?? [];

  return (
    <ViewTransition>
      <main id="main">
        {/* Header: what it is, and who made it for which competition. */}
        <section aria-labelledby="about-title" className="relative overflow-hidden border-b border-line-1 bg-bg-0 text-fg-1">
          <div className="yl-container grid gap-10 pt-12 pb-12 lg:grid-cols-12 lg:gap-8 lg:pt-16 lg:pb-16">
            <div className="lg:col-span-7">
              <p className="yl-hero-in eyebrow m-0 flex items-center gap-3 text-fg-muted">
                <span aria-hidden="true" className="h-px w-8 bg-line-3" />
                About YINGLONG
              </p>
              <h1 id="about-title" className="type-hero m-0 mt-5 text-[2.25rem] text-fg-0 sm:text-[3rem] lg:text-[clamp(2.75rem,1rem+2.6vw,3.75rem)]">
                <span className="yl-hero-line block" style={{ ["--d" as string]: "60ms" }}>
                  An AI agent that pays for you
                </span>
                <span className="yl-hero-line block text-fg-2" style={{ ["--d" as string]: "140ms" }}>
                  and proves it kept to your rules.
                </span>
              </h1>
              <p className="yl-hero-in m-0 mt-5 max-w-[40rem] text-15 text-fg-2 sm:text-18 sm:leading-[1.6]" style={{ ["--d" as string]: "220ms" }}>
                YINGLONG gives an AI agent its own ID, spending rules that only its owner can set (locked with a fingerprint or a secret key),
                nine checks before any payment, and a receipt for every action that anyone can check on a blockchain. The same rule code runs
                on a public blockchain and on a consortium blockchain
                {twin && equal !== null ? (
                  <>
                    {" "}
                    (<span className="font-mono text-fg-1">{equal}/{twin.enforcers.length}</span> rule programs with identical bytecode, from the
                    deployment files)
                  </>
                ) : null}
                .
              </p>
              <nav aria-label="On this page" className="yl-hero-in mt-6 flex flex-wrap gap-x-5 gap-y-2 text-13" style={{ ["--d" as string]: "280ms" }}>
                {ON_PAGE.map(([href, label]) => (
                  <a key={href} href={href} className="text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-0 hover:decoration-fg-1">
                    {label}
                  </a>
                ))}
              </nav>
            </div>
            <div className="yl-hero-in flex items-start lg:col-span-5 lg:justify-end" style={{ ["--d" as string]: "300ms" }}>
              <div className="grid w-full max-w-[420px] gap-4 rounded-sheet border border-line-1 bg-bg-1 p-5">
                <div className="flex items-center gap-4">
                  <TeamMark size={48} className="text-fg-0" />
                  <div>
                    <p className="m-0 text-18 font-medium text-fg-0">Team {TEAM.name}</p>
                    <p className="m-0 text-13 text-fg-muted">{TEAM.country}. A Shadow Chaser innovation.</p>
                  </div>
                </div>
                <dl className="m-0 grid gap-2 border-t border-line-1 pt-4 text-13">
                  {COMPETITION.map((c) => (
                    <div key={c.term} className="grid grid-cols-[6.5rem_1fr] gap-3">
                      <dt className="text-fg-muted">{c.term}</dt>
                      <dd className="m-0 text-fg-1">{c.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* 01 How it works: the five pillars as hairline rows. */}
        <section aria-labelledby="about-pillars-title" className="yl-about-section">
          <div className="yl-container grid gap-8 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="01"
              eyebrow="How it works"
              id="about-pillars-title"
              title="Five pillars"
              lead="Each pillar answers one question a supervisor would ask of any agent that touches money."
              className="lg:col-span-4"
            />
            <ol className="m-0 grid list-none gap-0 border-t border-line-2 p-0 lg:col-span-8">
              {PILLARS.map((p, i) => (
                <li key={p.id} className="yl-reveal grid gap-3 border-b border-line-1 py-4 sm:grid-cols-[2.5rem_10rem_1fr] sm:gap-5">
                  <span className="kicker pt-1">{String(i + 1).padStart(2, "0")}</span>
                  <div className="flex items-center gap-3 sm:items-start">
                    <span className="shrink-0 text-fg-1">
                      <PillarGlyph id={p.id} size={24} />
                    </span>
                    <div>
                      <p className="type-display m-0 text-18 leading-tight text-fg-0">{p.name}</p>
                      <p className="eyebrow m-0 mt-0.5 text-fg-muted">{p.role}</p>
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <h3 className="m-0 text-15 font-medium text-fg-0">{p.question}</h3>
                    <p className="m-0 max-w-[64ch] text-13 leading-relaxed text-fg-2">{p.answer}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 02 The build, from git. */}
        <section aria-labelledby="build-title" className="yl-about-section border-y border-line-1 bg-bg-1">
          <div className="yl-container grid gap-8 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="02"
              eyebrow="The build"
              id="build-title"
              title="How it came together, from the git history"
              lead="Every row is a commit in the public repository. Milestones are the commits that took a capability live end to end."
              className="lg:col-span-4"
            />
            <div className="lg:col-span-8">
              <BuildTimeline />
            </div>
          </div>
        </section>

        {/* 03 Stack: one hairline row per layer. */}
        <section aria-labelledby="stack-title" className="yl-about-section">
          <div className="yl-container grid gap-8 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="03"
              eyebrow="Technology"
              id="stack-title"
              title="The stack"
              lead="Pinned versions, read from the manifests at build time. Nothing on this site loads from a third-party origin."
              className="lg:col-span-4"
            />
            <dl className="m-0 grid gap-0 border-t border-line-2 lg:col-span-8">
              {stack.map((layer) => (
                <div key={layer.layer} className="yl-reveal grid gap-2 border-b border-line-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-5">
                  <dt className="eyebrow pt-1 text-fg-muted">{layer.layer}</dt>
                  <dd className="m-0 flex flex-wrap gap-x-5 gap-y-1.5 text-13">
                    {layer.items.map((it) => (
                      <span key={it.name} className="inline-flex flex-wrap items-baseline gap-x-1.5">
                        <span className="font-medium text-fg-0">{it.name}</span>
                        {it.version ? <span className="font-mono text-12 text-fg-muted">{it.version}</span> : null}
                        <span className="text-fg-2">{it.note.trim()}</span>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* 04 Honest labels. */}
        <section aria-labelledby="honesty-title" className="yl-about-section border-y border-line-1 bg-bg-1">
          <div className="yl-container grid gap-8 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="04"
              eyebrow="Honest labels"
              id="honesty-title"
              title="What is real, and what is simulated"
              lead="The site labels every simulated thing where it appears. Here is the whole list in one place."
              className="lg:col-span-4"
            />
            <ul className="m-0 grid list-none gap-0 border-t border-line-2 p-0 lg:col-span-8">
              {HONESTY.map((h) => (
                <li key={h} className="yl-reveal flex items-start gap-3 border-b border-line-1 py-3 text-13 text-fg-1 sm:text-15">
                  <span className="mt-0.5 shrink-0 text-fg-2">
                    <RingGlyph state="unknown" size={18} />
                  </span>
                  {h}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 05 Team and links. */}
        <section aria-labelledby="team-title" className="yl-about-section">
          <div className="yl-container grid gap-8 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="05"
              eyebrow="Team and links"
              id="team-title"
              title={`Team ${TEAM.name}`}
              lead={`An independent team from ${TEAM.country}. The team takes questions and reports through the repository's issues.`}
              className="lg:col-span-4"
            >
              <div className="mt-2 flex items-center gap-3 text-fg-0">
                <Mark size={24} decorative />
                <Wordmark height={11} />
              </div>
            </SectionHead>
            <div className="grid gap-8 sm:grid-cols-2 lg:col-span-8">
              <ul className="m-0 grid list-none content-start gap-0 border-t border-line-2 p-0">
                {TEAM.members.map((m) => (
                  <li key={m.name} className="yl-reveal flex items-center gap-4 border-b border-line-1 py-3">
                    <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill border border-line-2 bg-bg-2 font-mono text-13 text-fg-0">
                      {m.name.slice(0, 2)}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-15 font-medium text-fg-0">
                        {m.name}
                        {m.lead ? <span className="eyebrow rounded-pill border border-line-2 px-2 py-0.5 text-fg-2">Lead</span> : null}
                      </span>
                      <span className="text-13 text-fg-muted">{m.role}</span>
                    </span>
                    {m.links?.length ? (
                      <span className="flex flex-wrap gap-3 text-13">
                        {m.links.map((l) => (
                          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-fg-1 hover:text-fg-0">
                            {l.label} <ExternalIcon />
                            <span className="sr-only">(opens in a new tab)</span>
                          </a>
                        ))}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <ul className="m-0 grid list-none content-start gap-0 border-t border-line-2 p-0">
                {LINKS.map((l) => {
                  const inner = (
                    <>
                      <span className="flex items-center justify-between gap-3 text-15 font-medium text-fg-0">
                        {l.label}
                        {l.external ? <ExternalIcon /> : <ArrowIcon />}
                      </span>
                      <span className="text-12 text-fg-muted">{l.note}</span>
                      {l.external ? <span className="sr-only">(opens in a new tab)</span> : null}
                    </>
                  );
                  return (
                    <li key={l.href} className="yl-reveal border-b border-line-1">
                      {l.external ? (
                        <a href={l.href} target="_blank" rel="noreferrer" className="grid gap-0.5 py-3 no-underline">
                          {inner}
                        </a>
                      ) : (
                        <Link href={l.href} className="grid gap-0.5 py-3 no-underline">
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex flex-wrap gap-3 lg:col-span-8 lg:col-start-5">
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
