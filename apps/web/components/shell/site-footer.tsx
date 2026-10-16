import Link from "next/link";
import { RingGlyph } from "@yinglong/ui";
import { Mark, TeamMark, Wordmark } from "@/components/brand/mark";
import { ExternalIcon } from "@/components/ui/button";
import { SITE_PAGES, SIGN_UP } from "./pages";

export const REPO_URL = "https://github.com/ABRUBAB/YINGLONG";

const RESOURCES = [
  { href: `${REPO_URL}`, label: "Source code (GitHub)", external: true },
  { href: `${REPO_URL}/tree/main/docs`, label: "Documentation", external: true },
  { href: `${REPO_URL}/blob/main/docs/API.md`, label: "Agent API", external: true },
  { href: "/proof", label: "Proof and evidence", external: false },
] as const;

/**
 * The global footer (on every route, from the root layout): the S mark and wordmark, every page,
 * resources, the honesty statement, and the team signature "A Shadow Chaser innovation".
 */
export function SiteFooter() {
  return (
    <footer className="yl-sitefooter no-print border-t border-line-1 bg-bg-0 text-fg-1">
      <div className="yl-container grid gap-12 py-14 lg:grid-cols-12 lg:gap-8 lg:py-16">
        <div className="grid content-start gap-5 lg:col-span-4">
          <Link href="/" className="flex w-fit items-center gap-2.5 rounded-control" aria-label="YINGLONG home">
            <Mark size={28} decorative className="text-fg-0" />
            <Wordmark height={12} className="text-fg-0" />
          </Link>
          <p className="m-0 max-w-[34ch] text-15 text-fg-2">
            Personal Agent Identity &amp; Mandated Finance. Always with you. Never beyond your mandate.
          </p>
          <Link
            href={SIGN_UP.href}
            className="w-fit text-13 text-fg-0 underline decoration-line-3 underline-offset-4 hover:decoration-fg-1"
          >
            {SIGN_UP.label}
          </Link>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-5">
          <div className="grid content-start gap-3">
            <p className="eyebrow m-0 text-fg-muted">Pages</p>
            <ul className="m-0 grid list-none gap-2 p-0 text-13">
              {SITE_PAGES.slice(0, 4).map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="text-fg-2 hover:text-fg-0">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid content-start gap-3">
            <p className="eyebrow m-0 text-fg-muted" aria-hidden="true">
              &nbsp;
            </p>
            <ul className="m-0 grid list-none gap-2 p-0 text-13">
              {SITE_PAGES.slice(4).map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="text-fg-2 hover:text-fg-0">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="col-span-2 grid content-start gap-3 sm:col-span-1">
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
          </div>
        </nav>

        <div className="grid content-start gap-3 text-12 text-fg-muted lg:col-span-3">
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
