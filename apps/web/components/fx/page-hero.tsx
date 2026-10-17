import type { ReactNode } from "react";
import { cn } from "@yinglong/ui";
import { ThemedImg } from "./themed-img";

/**
 * The opening of an inner page: the title and one short lead on the left, a glass illustration on the
 * right in its own column (never laid over text), a soft colour wash behind. The illustration is a
 * static SVG with a slow float, so it costs nothing to draw; it hides below 768 px to keep phones short.
 * `children` is an optional floating card that overlaps the illustration's lower edge (live status).
 */
export type HeroArt = "chain-glass" | "vault-glass" | "ledgers-twin" | "receipts-glass" | "city-glass" | "gates-glass" | "phone-key" | "treasury-glass";

const ART_ALT: Record<HeroArt, string> = {
  "chain-glass": "Glass blocks joined in a chain.",
  "vault-glass": "A glass vault with a ring lock and a stack of coins.",
  "ledgers-twin": "Two blockchains joined by an equals sign.",
  "receipts-glass": "Three glass receipts stacked, the top one checked.",
  "city-glass": "A small city of glass blocks joined by light.",
  "gates-glass": "Nine rings in a row with a coin that stopped at one.",
  "phone-key": "A phone sealing rules with a passkey.",
  "treasury-glass": "A vault opened by two of three directors.",
};

export function PageHero({
  id,
  eyebrow,
  title,
  lead,
  chips,
  actions,
  art,
  children,
  className,
}: {
  id?: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  art: HeroArt;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("relative isolate overflow-hidden border-b border-line-1", className)}>
      <div aria-hidden="true" className="yl-hero-glow" />
      <div className="yl-container grid items-center gap-8 py-10 md:grid-cols-12 lg:py-14">
        <div className="grid content-start gap-5 md:col-span-7">
          <p className="eyebrow m-0 flex items-center gap-3 text-fg-muted">
            <span aria-hidden="true" className="h-px w-8 bg-line-3" />
            {eyebrow}
          </p>
          <h1 id={id} className="type-hero m-0 text-[clamp(2.1rem,1.1rem+3.2vw,3.75rem)] text-fg-0">
            {title}
          </h1>
          {lead ? <p className="m-0 max-w-[52ch] text-15 text-fg-2 sm:text-18 sm:leading-[1.6]">{lead}</p> : null}
          {chips ? <div className="flex flex-wrap items-center gap-2">{chips}</div> : null}
          {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
        </div>
        <div className="relative md:col-span-5">
          <div className="hidden md:block">
            <ThemedImg name={art} alt={ART_ALT[art]} width={640} height={440} className="yl-float h-auto w-full" />
          </div>
          {children ? <div className="relative ml-auto w-full max-w-[380px] md:-mt-6">{children}</div> : null}
        </div>
      </div>
    </header>
  );
}
