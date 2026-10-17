import Link from "next/link";
import { RingGlyph } from "@yinglong/ui";
import { Mark, TeamMark, Wordmark } from "@/components/brand/mark";
import { ExternalIcon } from "@/components/ui/button";
import { SIGN_UP } from "./pages";

export const REPO_URL = "https://github.com/ABRUBAB/YINGLONG";

const RESOURCES = [
  { href: `${REPO_URL}`, label: "Source code (GitHub)", external: true },
  { href: `${REPO_URL}/tree/main/docs`, label: "Documentation", external: true },
  { href: `${REPO_URL}/blob/main/docs/API.md`, label: "Agent API", external: true },
  { href: "/proof", label: "Proof and evidence", external: false },
] as const;

/**
 * The global footer (on every route, from the root layout). It does not repeat the page list: every
 * page is in the top bar and in the menu, and the workspace has its own side menu. It holds what the
 * bar does not: what the product is, where the code and docs are, the honest labels, the team
 * signature, and the name set once at a size that always fits.
 */
export function SiteFooter() {
  return (
    <footer className="yl-sitefooter no-print border-t border-line-1 bg-bg-0 text-fg-1">
      <div className="yl-container grid gap-10 py-12 lg:grid-cols-12 lg:gap-8 lg:py-14">
        <div className="grid content-start gap-4 lg:col-span-5">
          <Link href="/" className="flex w-fit items-center gap-2.5 rounded-control" aria-label="YINGLONG home">
            <Mark size={30} decorative className="text-fg-0" />
            <Wordmark height={12} className="text-fg-0" />
          </Link>
          <p className="m-0 max-w-[36ch] text-15 text-fg-2">An AI agent that pays for you inside rules only you can change, with a receipt for every action.</p>
          <Link href={SIGN_UP.href} className="w-fit text-13 text-fg-0 underline decoration-line-3 underline-offset-4 hover:decoration-fg-1">
            {SIGN_UP.label}
          </Link>
        </div>

        <nav aria-label="Resources" className="grid content-start gap-3 lg:col-span-3 lg:col-start-6">
          <p className="eyebrow m-0 text-fg-muted">Resources</p>
          <ul className="m-0 grid list-none gap-2 p-0 text-13">
            {RESOURCES.map((r) => (
              <li key={r.href}>
                {r.external ? (
                  <a href={r.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-fg-2 hover:text-fg-0">
                    {r.label} <ExternalIcon />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <Link href={r.href} className="text-fg-2 hover:text-fg-0">
                    {r.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid content-start gap-3 text-12 text-fg-muted lg:col-span-4">
          <p className="eyebrow m-0 text-fg-muted">Honest labels</p>
          <p className="m-0 flex items-start gap-2">
            <span className="mt-0.5">
              <RingGlyph state="unknown" size={16} />
            </span>
            <span>
              Test units only, on testnets and a team-run FISCO BCOS chain. e-CNY-style simulator, not the PBoC sandbox. No bank partnership, no
              licence, no third-party audit. People and companies in the demo are fictional.
            </span>
          </p>
        </div>
      </div>

      <div className="border-t border-line-1" aria-hidden="true">
        <div className="yl-container py-6">
          <svg viewBox="0 0 1200 150" className="yl-megamark block h-auto w-full max-w-[860px]" role="presentation">
            <text x="0" y="132" textLength="1200" lengthAdjust="spacingAndGlyphs" fontSize="150">
              YINGLONG
            </text>
          </svg>
        </div>
      </div>

      <div className="border-t border-line-1">
        <div className="yl-container flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-5 text-12 text-fg-muted">
          <Link href="/about" className="flex items-center gap-2.5 rounded-control text-signature hover:text-fg-1">
            <TeamMark size={20} decorative />
            <span>A Shadow Chaser innovation</span>
          </Link>
          <p className="m-0">All third-party marks are the property of their respective owners. No partnership, sponsorship or endorsement is implied.</p>
        </div>
      </div>
    </footer>
  );
}
