"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@yinglong/ui";
import { Mark, Wordmark } from "@/components/brand/mark";
import { ButtonLink, CloseIcon } from "@/components/ui/button";
import { MotionToggle, ThemeToggle } from "@/components/preferences";
import { pageActive, SIGN_UP, SITE_PAGES } from "./pages";
import "./site.css";

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
 *
 * The sheet (Base UI Dialog, modal): never wider than the viewport (`min(100vw, 22rem)` from the
 * right edge), respects the safe-area insets, locks the page scroll, traps focus, closes on Escape,
 * on the backdrop and on navigation, and gives focus back to the Menu button.
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
      <div className={cn("yl-container flex h-[var(--nav-h)] items-center justify-between gap-3", workspace && "max-w-none")}>
        <Link href="/" className="-ml-1 flex shrink-0 items-center gap-2.5 rounded-control p-1" aria-label="YINGLONG home">
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

        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden xl:contents">
            <ThemeToggle compact />
          </span>
          <ButtonLink href={SIGN_UP.href} size="sm" aria-label={SIGN_UP.label}>
            <PasskeyIcon />
            <span className="sm:hidden">Sign up</span>
            <span className="hidden sm:inline">{SIGN_UP.label}</span>
          </ButtonLink>
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger className="yl-press inline-flex h-9 items-center gap-2 rounded-control border border-line-3 px-3 text-13 text-fg-1 hover:bg-bg-2 xl:hidden">
              <MenuIcon />
              Menu
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="yl-navsheet-backdrop" />
              <Dialog.Popup className="yl-navsheet">
                <div className="flex items-start justify-between gap-4 border-b border-line-1 px-5 pt-5 pb-4">
                  <div className="min-w-0">
                    <Dialog.Title className="m-0 flex items-center gap-2.5 text-18 font-semibold text-fg-0">
                      <Mark size={22} decorative />
                      <span>YINGLONG</span>
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 mb-0 text-13 text-fg-muted">Every page of the demo</Dialog.Description>
                  </div>
                  <Dialog.Close
                    className="-mt-1 -mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-control text-fg-2 hover:bg-bg-3 hover:text-fg-0"
                    aria-label="Close the menu"
                  >
                    <CloseIcon />
                  </Dialog.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
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
                              className="grid min-w-0 gap-0.5 rounded-control px-3 py-2.5 hover:bg-bg-3 aria-[current=page]:bg-bg-3"
                            >
                              <span className="text-15 font-medium text-fg-0">{p.label}</span>
                              <span className="text-12 text-fg-muted">{p.hint}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </nav>
                </div>
                <div className="grid gap-4 border-t border-line-1 px-5 pt-4 pb-5">
                  <ButtonLink href={SIGN_UP.href} size="lg" onClick={() => setOpen(false)} className="w-full min-w-0">
                    <PasskeyIcon />
                    <span className="truncate">{SIGN_UP.label}</span>
                  </ButtonLink>
                  <div className="flex flex-wrap items-center gap-1">
                    <ThemeToggle />
                    <MotionToggle />
                  </div>
                </div>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
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
