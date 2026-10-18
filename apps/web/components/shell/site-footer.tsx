import Link from "next/link";
import { RingGlyph } from "@yinglong/ui";
import { Mark, TeamMark, Wordmark } from "@/components/brand/mark";
import { ExternalIcon } from "@/components/ui/button";
import { SIGN_UP } from "./pages";
import { ThemeCord } from "./theme-cord";

export const REPO_URL = "https://github.com/ABRUBAB/YINGLONG";

const RESOURCES = [
  { href: "/proof", label: "Proof and evidence", external: false },
  { href: `${REPO_URL}/blob/main/docs/JUDGES_GUIDE.md`, label: "Judge guide", external: true },
  { href: `${REPO_URL}/blob/main/docs/API.md`, label: "Agent API", external: true },
  { href: `${REPO_URL}`, label: "Source code", external: true },
] as const;

const PRODUCT_LINKS = [
  { href: "/judge", label: "3-minute walkthrough" },
  { href: "/city", label: "Live map" },
  { href: "/challenge", label: "Security challenge" },
  { href: "/start", label: "Create your agent" },
] as const;

const PROJECT_LINKS = [
  { href: "/about", label: "About YINGLONG" },
  { href: "/app", label: "Student demo" },
  { href: "/treasury", label: "Company demo" },
  { href: "/supervisor", label: "Regulator view" },
] as const;

function FooterLinks({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <nav aria-label={title} className="grid content-start gap-3">
      <p className="eyebrow m-0 text-fg-muted">{title}</p>
      <ul className="m-0 grid list-none gap-2 p-0 text-13">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-fg-2 transition-colors hover:text-fg-0">{link.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The global footer (on every route, from the root layout). It does not repeat the page list: every
 * page is in the top bar and in the menu, and the workspace has its own side menu. It holds what the
 * bar does not: what the product is, where the code and docs are, the honest labels, the team
 * signature, and the name set once at a size that always fits.
 */
export function SiteFooter() {
  return (
    <footer className="yl-sitefooter no-print border-t border-line-1 bg-bg-0 text-fg-1">
      <div className="yl-container grid gap-9 py-10 sm:grid-cols-2 lg:grid-cols-12 lg:gap-8 lg:py-12">
        <div className="grid content-start gap-4 sm:col-span-2 lg:col-span-3">
          <Link href="/" className="flex w-fit items-center gap-2.5 rounded-control" aria-label="YINGLONG home">
            <Mark size={30} decorative className="text-fg-0" />
            <Wordmark height={12} className="text-fg-0" />
          </Link>
          <p className="m-0 max-w-[38ch] text-14 leading-relaxed text-fg-2">A personal AI agent that makes payments within rules you control, with verifiable proof for every action.</p>
          <Link href={SIGN_UP.href} className="w-fit text-13 text-fg-0 underline decoration-line-3 underline-offset-4 hover:decoration-fg-1">
            {SIGN_UP.label}
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:col-span-2 lg:col-span-4 lg:grid-cols-2">
          <FooterLinks title="Product" links={PRODUCT_LINKS} />
          <FooterLinks title="Explore" links={PROJECT_LINKS} />
        </div>

        <nav aria-label="Resources" className="grid content-start gap-3 lg:col-span-2">
          <p className="eyebrow m-0 text-fg-muted">Resources</p>
          <ul className="m-0 grid list-none gap-2 p-0 text-13">
            {RESOURCES.map((r) => (
              <li key={r.href}>
                {r.external ? (
                  <a href={r.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-fg-2 transition-colors hover:text-fg-0">
                    {r.label} <ExternalIcon />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <Link href={r.href} className="text-fg-2 transition-colors hover:text-fg-0">{r.label}</Link>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid content-start gap-2 sm:col-span-2 lg:col-span-3 lg:justify-items-end">
          <ThemeCord className="w-40" />
        </div>

        <div className="grid content-start gap-3 border-t border-line-1 pt-6 text-12 text-fg-muted sm:col-span-2 lg:col-span-12 lg:grid-cols-[8rem_1fr] lg:items-start lg:pt-5">
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
        <div className="yl-container py-4 sm:py-5">
          <svg viewBox="0 0 1200 150" className="yl-megamark mx-auto block h-auto w-full max-w-[860px]" role="presentation">
            <text x="0" y="132" textLength="1200" lengthAdjust="spacingAndGlyphs" fontSize="150">
              YINGLONG
            </text>
          </svg>
        </div>
      </div>

      <div className="border-t border-line-1">
        <div className="yl-container flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-4 text-12 text-fg-muted">
          <Link href="/about" className="flex items-center gap-2.5 rounded-control text-signature hover:text-fg-1">
            <TeamMark size={20} decorative />
            <span>A Shadow Chaser innovation</span>
          </Link>
          <p className="m-0">© {new Date().getFullYear()} YINGLONG · All third-party marks belong to their respective owners. No partnership or endorsement is implied.</p>
        </div>
      </div>
    </footer>
  );
}
