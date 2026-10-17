import Link from "next/link";
import { ViewTransition } from "react";
import { RingGlyph } from "@yinglong/ui";
import { TeamMark } from "@/components/brand/mark";
import { ArrowIcon, ButtonLink, ExternalIcon } from "@/components/ui/button";
import { PillarGlyph } from "@/components/landing/pillar-glyph";
import { SectionHead } from "@/components/landing/sections";
import { PasskeyIcon } from "@/components/shell/site-nav";
import { REPO_URL } from "@/components/shell/site-footer";
import { PILLARS } from "@/content/pillars";
import { TEAM } from "@/content/team";
import { TeamGrid } from "./team-grid";
import { TeamPanels } from "./team-panels";
import { ThemedImg } from "@/components/fx/themed-img";
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

const STORY = [
  {
    art: "phone-key",
    h: "The problem",
    p: "People now let AI agents pay for things. But a language model can be tricked by a fake invoice or one sneaky sentence, and a payment sent to the wrong place cannot be taken back.",
  },
  {
    art: "gates-glass",
    h: "The idea",
    p: "So the AI never gets the last word. It can read, plan and ask. Plain rules that the owner wrote and locked decide what is allowed, and the blockchain checks them again.",
  },
  {
    art: "receipts-glass",
    h: "The proof",
    p: "Every action leaves a receipt anyone can check, including the ones that were refused. You do not have to take our word for it.",
  },
] as const;

const SCENARIOS = [
  { tag: "Shown through, one", who: "A student in Hong Kong", what: "Nadia's agent pays rent and food on its own and asks before anything bigger. Fictional." },
  { tag: "Shown through, two", who: "A company in Shenzhen", what: "A treasurer agent pays suppliers; big payments need two of three directors. Fictional." },
] as const;

export function AboutPage() {
  const twin = SITE.twin;
  const equal = twin ? twin.enforcers.filter((e) => e.base && e.fisco && e.base.codeHash.toLowerCase() === e.fisco.codeHash.toLowerCase()).length : null;
  const stack = SITE.stack ?? [];

  return (
    <ViewTransition>
      <main id="main">
        {/* Opening: one statement, set large. Then why we built it, the people, and the numbers: the order modern About pages share. */}
        <section aria-labelledby="about-title" className="relative isolate overflow-hidden border-b border-line-1">
          <div aria-hidden="true" className="yl-hero-glow" />
          <div className="yl-container grid items-stretch gap-8 py-10 lg:grid-cols-12 lg:gap-10 lg:py-14">
            <div className="grid content-between gap-8 lg:col-span-4">
              <div className="grid content-start gap-5">
                <p className="eyebrow m-0 flex items-center gap-3 text-fg-muted">
                  <span aria-hidden="true" className="h-px w-8 bg-line-3" />
                  About YINGLONG
                </p>
                <h1 id="about-title" className="type-display m-0 text-[clamp(2rem,1.2rem+2.2vw,3rem)] leading-[1.05] text-fg-0">
                  An AI wallet you can <span className="text-fg-2">check, not just trust.</span>
                </h1>
                <p className="m-0 max-w-[40ch] text-15 text-fg-2 sm:text-18 sm:leading-[1.6]">
                  YINGLONG lets an AI agent pay for you inside rules only you can change, and leaves a receipt for everything it does.
                </p>
              </div>
              <dl className="m-0 grid gap-2.5 border-t border-line-1 pt-5 text-13">
                {COMPETITION.map((c) => (
                  <div key={c.term} className="grid grid-cols-[6.5rem_1fr] gap-3">
                    <dt className="text-fg-muted">{c.term}</dt>
                    <dd className="m-0 text-fg-1">{c.value}</dd>
                  </div>
                ))}
                <div className="grid grid-cols-[6.5rem_1fr] gap-3">
                  <dt className="text-fg-muted">Made by</dt>
                  <dd className="m-0 flex items-center gap-2 text-fg-1">
                    <TeamMark size={18} decorative />
                    Team {TEAM.name}, {TEAM.country}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="lg:col-span-8">
              <TeamPanels />
              <div className="md:hidden">
                <TeamGrid />
              </div>
            </div>
          </div>
        </section>

        {/* 01 Why we built it. */}
        <section aria-labelledby="why-title" className="yl-about-section border-t border-line-1">
          <div className="yl-container grid gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-4 lg:self-start">
              <SectionHead index="01" eyebrow="Why we built it" id="why-title" title="Money is where a trick hurts." />
            </div>
            <div className="grid gap-12 lg:col-span-8">
              <ol className="m-0 grid list-none gap-4 p-0">
                {STORY.map((b, i) => (
                  <li key={b.h} className="yl-card yl-card--glass yl-reveal grid items-center gap-4 overflow-hidden p-4 sm:grid-cols-[220px_1fr] sm:gap-6 sm:p-5">
                    <div className="hidden sm:block" aria-hidden="true">
                      <ThemedImg name={b.art} alt="" width={640} height={440} className="h-auto w-full" />
                    </div>
                    <div className="grid gap-2">
                      <p className="kicker m-0">{String(i + 1).padStart(2, "0")}</p>
                      <h3 className="type-display m-0 text-h3 text-fg-0">{b.h}</h3>
                      <p className="m-0 max-w-[52ch] text-15 text-fg-2">{b.p}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="grid gap-3 sm:grid-cols-2">
                {SCENARIOS.map((c) => (
                  <div key={c.who} className="yl-card yl-card--glass grid content-start gap-2 p-5">
                    <p className="eyebrow m-0 text-fg-muted">{c.tag}</p>
                    <p className="type-display m-0 text-22 text-fg-0">{c.who}</p>
                    <p className="m-0 text-13 text-fg-2">{c.what}</p>
                  </div>
                ))}
              </div>
              <p className="m-0 text-12 text-fg-muted">{COMPETITION.map((c) => `${c.term}: ${c.value}`).join(". ")}.</p>
            </div>
          </div>
        </section>

        {/* The work in five numbers. */}
        <section aria-label="The work in numbers" className="yl-about-section">
          <div className="yl-container">
            <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line-1 bg-line-1 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { k: "Commits in the open", v: SITE.timeline ? String(SITE.timeline.count) : "95", tone: "var(--steel)" },
                { k: "Pillars", v: String(PILLARS.length), tone: "var(--lime)" },
                { k: "Checks before a payment", v: "9", tone: "var(--brass)" },
                { k: "Blockchains", v: "2", tone: "var(--violet)" },
                { k: "Rule programs identical on both", v: twin && equal !== null ? `${equal}/${twin.enforcers.length}` : "13/13", tone: "var(--seal)" },
              ].map((f) => (
                <div key={f.k} className="grid content-start gap-1.5 bg-bg-1 px-5 py-5">
                  <dd className="m-0 font-mono text-[2.25rem] leading-none tabular" style={{ color: f.tone }}>
                    {f.v}
                  </dd>
                  <dt className="text-12 text-fg-muted">{f.k}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* 01 How it works: the five pillars as hairline rows. */}
        <section aria-labelledby="about-pillars-title" className="yl-about-section">
          <div className="yl-container grid gap-8 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="03"
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
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
                      <h3 className="m-0 text-15 font-medium text-fg-0">{p.question}</h3>
                      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="mt-0.5 shrink-0 text-fg-muted transition-transform duration-200 group-open:rotate-180">
                        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </summary>
                    <p className="m-0 mt-2 max-w-[64ch] text-13 leading-relaxed text-fg-2">{p.answer}</p>
                  </details>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 02 The build, from git. */}
        <section aria-labelledby="build-title" className="yl-about-section border-y border-line-1 bg-bg-1">
          <div className="yl-container grid gap-8 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="04"
              eyebrow="The build"
              id="build-title"
              title="How it came together, from the git history"
              lead="Every row is a commit in the public repository. Milestones are the commits that took a capability live end to end."
              className="lg:col-span-4"
            />
            <details className="yl-card yl-card--glass group lg:col-span-8">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 text-15 font-medium text-fg-0 [&::-webkit-details-marker]:hidden">
                Show the history, commit by commit
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="shrink-0 text-fg-muted transition-transform duration-200 group-open:rotate-180">
                  <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <div className="px-5 pb-5">
                <BuildTimeline />
              </div>
            </details>
          </div>
        </section>

        {/* 03 Stack: one hairline row per layer. */}
        <section aria-labelledby="stack-title" className="yl-about-section">
          <div className="yl-container grid gap-8 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="05"
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
              index="06"
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

        {/* 07 Contact and links. */}
        <section aria-labelledby="links-title" className="yl-about-section border-t border-line-1">
          <div className="yl-container grid gap-8 lg:grid-cols-12 lg:gap-8">
            <SectionHead
              index="07"
              eyebrow="Contact and links"
              id="links-title"
              title="Read it, run it, break it."
              lead="The code, the documents and the proof are public. Questions and reports go through the repository issues."
              className="lg:col-span-4"
            />
            <div className="grid gap-8 lg:col-span-8">
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
              <div className="flex flex-wrap gap-3">
                <ButtonLink href="/start" size="lg">
                  <PasskeyIcon size={16} />
                  Create your agent
                </ButtonLink>
                <ButtonLink href="/challenge" variant="secondary" size="lg">
                  Try to hack it <ArrowIcon />
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>
      </main>
    </ViewTransition>
  );
}
