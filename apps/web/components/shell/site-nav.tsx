"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@yinglong/ui";
import { Mark, Wordmark } from "@/components/brand/mark";
import { ButtonLink } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { MotionToggle, ThemeToggle } from "@/components/preferences";
import { pageActive, SIGN_UP, SITE_PAGES } from "./pages";

/** Routes whose first screen is an always-obsidian surface: the nav joins that surface there. */
const OBSIDIAN = new Set(["/", "/city"]);
const WORKSPACE = ["/app", "/treasury", "/supervisor"];


function MenuIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 5.5h11M2.5 10.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The global navigation bar (on every route, from the root layout). Wide screens list every page
 * with an underline for the current one; below 1280 px the list moves into a sheet. Navigation is a
 * high-frequency action, so nothing in the bar animates except the sheet itself.
 */
export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const obsidian = OBSIDIAN.has(pathname);
  // Workspace routes (the in-app rail spans the full width) get a full-width bar to match.
  const workspace = WORKSPACE.some((w) => pageActive(pathname, w));
  return (
    <header
      data-surface={obsidian ? "obsidian" : undefined}
      className="yl-sitenav no-print sticky top-0 z-40 border-b border-line-1 bg-bg-0 text-fg-1"
    >
      <div className={cn("yl-container flex h-[var(--nav-h)] items-center justify-between gap-4", workspace && "max-w-none")}>
        <Link href="/" className="-ml-1 flex items-center gap-2.5 rounded-control p-1" aria-label="YINGLONG home">
          <Mark size={26} decorative className="text-fg-0" />
          <Wordmark height={11} className="text-fg-0" />
        </Link>

        <nav aria-label="Site" className="hidden h-full items-stretch xl:flex">
          <ul className="m-0 flex list-none items-stretch gap-0.5 p-0">
            {SITE_PAGES.map((p) => {
              const active = pageActive(pathname, p.href);
              return (
                <li key={p.href} className="flex">
                  <Link
                    href={p.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center rounded-control px-2.5 text-13 transition-colors duration-150",
                      active ? "font-medium text-fg-0" : "text-fg-2 hover:text-fg-0",
                    )}
                  >
                    {p.label}
                    {active ? <span aria-hidden="true" className="absolute inset-x-2.5 -bottom-px h-px bg-fg-0" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden xl:contents">
            <ThemeToggle compact />
          </span>
          <ButtonLink href={SIGN_UP.href} size="sm" aria-label={SIGN_UP.label}>
            <PasskeyIcon />
            <span className="sm:hidden">Sign up</span>
            <span className="hidden sm:inline">{SIGN_UP.label}</span>
          </ButtonLink>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="yl-press inline-flex h-9 items-center gap-2 rounded-control border border-line-3 px-3 text-13 text-fg-1 hover:bg-bg-2 xl:hidden"
          >
            <MenuIcon />
            Menu
          </button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen} title="YINGLONG" description="Every page of the demo" side="right" width={400}>
        <nav aria-label="Site">
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {SITE_PAGES.map((p) => {
              const active = pageActive(pathname, p.href);
              return (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className="grid gap-0.5 rounded-control px-3 py-2.5 hover:bg-bg-3 aria-[current=page]:bg-bg-3"
                  >
                    <span className="text-15 font-medium text-fg-0">{p.label}</span>
                    <span className="text-12 text-fg-muted">{p.hint}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-5 grid gap-4 border-t border-line-1 pt-5">
          <ButtonLink href={SIGN_UP.href} size="lg" onClick={() => setOpen(false)} className="w-full">
            <PasskeyIcon />
            {SIGN_UP.label}
          </ButtonLink>
          <div className="flex flex-wrap items-center gap-1">
            <ThemeToggle />
            <MotionToggle />
          </div>
        </div>
      </Sheet>
    </header>
  );
}

/** A key in a ring: the passkey call to action. */
export function PasskeyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className="shrink-0">
      <circle cx="5.5" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 8h6M12.5 8v2.5M14.5 8v1.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
