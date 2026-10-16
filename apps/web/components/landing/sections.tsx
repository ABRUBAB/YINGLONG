import Link from "next/link";
import type { ReactNode } from "react";
import { cn, LabelChip, OutputChip } from "@yinglong/ui";
import { ArrowIcon } from "@/components/ui/button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { PILLARS } from "@/content/pillars";
import { PillarGlyph } from "./pillar-glyph";

/* ------------------------------------------------------------------ shared section head */

/** Section head: mono index, eyebrow, display h2 and an optional lead. Used on every marketing section. */
export function SectionHead({
  index,
  eyebrow,
  title,
  lead,
  id,
  className,
  children,
}: {
  index: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  id: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-4", className)}>
      <p className="m-0 flex items-center gap-3">
        <span className="kicker">{index}</span>
        <span aria-hidden="true" className="h-px w-6 bg-line-2" />
        <span className="eyebrow text-fg-muted">{eyebrow}</span>
      </p>
      <h2 id={id} className="type-display yl-reveal m-0 max-w-[20ch] text-h2 text-fg-0">
        {title}
      </h2>
      {lead ? <p className="yl-reveal m-0 max-w-[46ch] text-15 text-fg-2 sm:text-18 sm:leading-[1.6]">{lead}</p> : null}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ five pillars */

export function Pillars() {
  return (
    <section aria-labelledby="pillars-title" className="yl-section">
      <div className="yl-container grid gap-12 lg:grid-cols-12 lg:gap-8">
        <SectionHead
          index="01"
          eyebrow="Five pillars"
          id="pillars-title"
          title="Before an agent touches money"
          lead="A bank asks these questions of every person. YINGLONG answers them for every agent, on ledgers a supervisor can read."
          className="lg:sticky lg:top-[calc(var(--nav-h)+3rem)] lg:col-span-4 lg:self-start"
        />
        <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:col-span-8 lg:grid-cols-6">
          {PILLARS.map((p, i) => (
            <li key={p.id} className={cn("yl-reveal flex", i < 3 ? "lg:col-span-2" : "lg:col-span-3", i === 4 && "sm:col-span-2 lg:col-span-3")}>
              <SpotlightCard className="flex w-full flex-col gap-6 p-6 sm:p-7">
                <div className="flex items-center justify-between gap-4 text-fg-1">
                  <PillarGlyph id={p.id} />
                  <span className="kicker">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <div className="grid gap-1">
                  <p className="type-display m-0 text-26 leading-none text-fg-0">{p.name}</p>
                  <p className="eyebrow m-0 text-fg-muted">{p.role}</p>
                </div>
                <div className="mt-auto grid gap-2.5">
                  <h3 className="m-0 text-18 leading-snug font-medium text-fg-0">{p.question}</h3>
                  <p className="m-0 text-13 leading-relaxed text-fg-2">{p.answer}</p>
                </div>
              </SpotlightCard>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ one engine, two deep scenarios */

const SCENARIOS = [
  {
    key: "nadia",
    chips: ["HK test rail", "Base Sepolia (testnet)"],
    title: "Nadia, a student in Hong Kong",
    body: "Her agent Ying pays rent on the first, keeps food under a cap, buys FX quotes over x402 and puts the tuition deposit into escrow after she approves it on her phone.",
    rules: ["Pay rent of 9,500.00 tHKD to Harbour Homes on the 1st.", "Spend at most 3,000.00 tHKD on food each month.", "Ask me before any payment above 2,000.00 tHKD."],
    href: "/app",
    cta: "Nadia's console",
  },
  {
    key: "lotus",
    chips: ["Coin-free rail", "FISCO BCOS", "e-CNY-style simulator"],
    title: "Lotus Lane, an SME in Shenzhen",
    body: "A treasurer agent pays suppliers and payroll inside the board's mandate. Anything outside its lanes becomes a 2-of-3 director proposal. Its Hong Kong subsidiary uses the same agent identity under a second mandate.",
    rules: ["Payroll on the 10th, inside the board mandate.", "Supplier payments as conditional instructions.", "Capital purchases need two of three directors."],
    href: "/treasury",
    cta: "The treasury",
  },
] as const;

export function Scenarios() {
  return (
    <section aria-labelledby="scenarios-title" className="yl-section">
      <div className="yl-container">
        <SectionHead
          index="03"
          eyebrow="Topic F, agent wallet"
          id="scenarios-title"
          title="One engine, two deep scenarios"
          lead="Every money movement in both passes the same path: seal, scales, chain, receipt."
        />
        <div className="mt-14 grid gap-3 lg:grid-cols-2">
          {SCENARIOS.map((s) => (
            <article key={s.key} className="yl-card yl-reveal grid content-start gap-6 p-6 sm:p-8 lg:p-10">
              <div className="flex flex-wrap items-center gap-2">
                {s.chips.map((c) => (
                  <LabelChip key={c}>{c}</LabelChip>
                ))}
              </div>
              <h3 className="type-display m-0 text-h3 text-fg-0">{s.title}</h3>
              <p className="m-0 max-w-[52ch] text-15 text-fg-2">{s.body}</p>
              <ul className="m-0 grid list-none gap-0 border-t border-line-1 p-0 text-13 text-fg-1">
                {s.rules.map((r) => (
                  <li key={r} className="flex items-start gap-3 border-b border-line-1 py-3">
                    <span className="mt-0.5 text-fg-2">
                      <OutputChip kind="rule" />
                    </span>
                    {r}
                  </li>
                ))}
              </ul>
              <Link href={s.href} className="inline-flex w-fit items-center gap-2 text-15 text-fg-0 underline decoration-line-3 underline-offset-4 hover:decoration-fg-1">
                {s.cta} <ArrowIcon />
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
