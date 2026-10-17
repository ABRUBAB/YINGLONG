"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@yinglong/ui";
import { Mark, Wordmark } from "@/components/brand/mark";
import { ButtonLink, CloseIcon } from "@/components/ui/button";
import { MotionToggle, ThemeToggle } from "@/components/preferences";
import { DESKTOP_PAGES, EXPLORE_PAGES, MY_AGENT, pageActive, SIGN_UP, SITE_PAGES, TRY_PAGES } from "./pages";
import { useVisitorSession } from "@/components/session";
import { clearVisitorSession } from "@/lib/api/session";
import "./site.css";

const WORKSPACE = ["/app", "/treasury", "/supervisor"];

function MenuIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 5.5h11M2.5 10.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The global navigation bar (on every route, from the root layout). Wide screens show direct links
 * to every destination; below 1280 px the same pages move into a categorized sheet. Navigation is a
 * high-frequency action, so nothing in the bar animates except the sheet itself.
 *
 * The sheet (Base UI Dialog, modal): never wider than the viewport (`min(100vw, 22rem)` from the
 * right edge), respects the safe-area insets, locks the page scroll, traps focus, closes on Escape,
 * on the backdrop and on navigation, and gives focus back to the Menu button.
 */
export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const session = useVisitorSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // Workspace routes (the in-app rail spans the full width) get a full-width bar to match.
  const workspace = WORKSPACE.some((w) => pageActive(pathname, w));
  const activeHref = DESKTOP_PAGES.find((p) => pageActive(pathname, p.href))?.href ?? null;
  const pillAt = hover ?? activeHref;
  return (
    <header
      data-scrolled={scrolled}
      className="yl-sitenav no-print sticky top-0 z-40 border-b border-line-1 bg-bg-0 text-fg-1"
    >
      <div className={cn("yl-container flex h-[var(--nav-h)] items-center justify-between gap-3", workspace && "max-w-none")}>
        <Link href="/" className="-ml-1 flex shrink-0 items-center gap-2.5 rounded-control p-1" aria-label="YINGLONG home">
          <Mark size={26} decorative className="text-fg-0" />
          <Wordmark height={11} className="text-fg-0" />
        </Link>

        <nav aria-label="Site" className="yl-nav-dock hidden h-10 items-center xl:flex">
          <ul className="m-0 flex list-none items-center gap-1 p-1" onPointerLeave={() => setHover(null)}>
            {DESKTOP_PAGES.map((p) => {
              const active = pageActive(pathname, p.href);
              return (
                <li key={p.href} className="flex" onPointerEnter={() => setHover(p.href)}>
                  <Link
                    href={p.href}
                    aria-current={active ? "page" : undefined}
                    onFocus={() => setHover(p.href)}
                    onBlur={() => setHover(null)}
                    className={cn(
                      "yl-nav-link relative isolate inline-flex h-8 items-center rounded-pill px-2 text-11 transition-colors 2xl:px-2.5 2xl:text-12",
                      active ? "is-active" : "text-fg-2 hover:text-fg-0",
                    )}
                  >
                    {pillAt === p.href ? (
                      <motion.span
                        layoutId="yl-navpill"
                        aria-hidden="true"
                        className="yl-navpill"
                        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40, mass: 0.7 }}
                      />
                    ) : null}
                    {p.label}
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
          {session ? (
            <ButtonLink href={MY_AGENT.href} size="sm" aria-label={MY_AGENT.label}>
              <PasskeyIcon />
              <span>{MY_AGENT.label}</span>
            </ButtonLink>
          ) : (
            <ButtonLink href={SIGN_UP.href} size="sm" aria-label={SIGN_UP.label}>
              <PasskeyIcon />
              <span className="sm:hidden">Create agent</span>
              <span className="hidden sm:inline">{SIGN_UP.label}</span>
            </ButtonLink>
          )}
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger className="yl-press yl-mobile-menu-trigger inline-flex h-9 items-center gap-2 rounded-pill border border-line-2 px-3 text-12 font-medium text-fg-1 hover:bg-bg-2 xl:hidden">
              <MenuIcon />
              Explore
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
                    <Dialog.Description className="mt-1 mb-0 text-13 text-fg-muted">Choose what you want to explore</Dialog.Description>
                  </div>
                  <Dialog.Close
                    className="-mt-1 -mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-control text-fg-2 hover:bg-bg-3 hover:text-fg-0"
                    aria-label="Close the menu"
                  >
                    <CloseIcon />
                  </Dialog.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
                  <nav aria-label="Site" className="grid gap-5">
                    <section aria-labelledby="menu-primary">
                      <h2 id="menu-primary" className="eyebrow m-0 px-3 pb-2 text-fg-muted">Explore YINGLONG</h2>
                      <ul className="m-0 grid list-none gap-0.5 p-0">
                        {SITE_PAGES.map((p) => <MenuItem key={p.href} page={p} active={pageActive(pathname, p.href)} onNavigate={() => setOpen(false)} />)}
                      </ul>
                    </section>
                    <section aria-labelledby="menu-try">
                      <h2 id="menu-try" className="eyebrow m-0 px-3 pb-2 text-fg-muted">Demos</h2>
                      <ul className="m-0 grid list-none gap-0.5 p-0">{TRY_PAGES.map((p) => <MenuItem key={p.href} page={p} active={pageActive(pathname, p.href)} onNavigate={() => setOpen(false)} />)}</ul>
                    </section>
                    <section aria-labelledby="menu-explore">
                      <h2 id="menu-explore" className="eyebrow m-0 px-3 pb-2 text-fg-muted">Explore</h2>
                      <ul className="m-0 grid list-none gap-0.5 p-0">{EXPLORE_PAGES.map((p) => <MenuItem key={p.href} page={p} active={pageActive(pathname, p.href)} onNavigate={() => setOpen(false)} />)}</ul>
                    </section>
                  </nav>
                </div>
                <div className="grid gap-4 border-t border-line-1 px-5 pt-4 pb-5">
                  {session ? (
                    <div className="grid gap-2">
                      <ButtonLink href={MY_AGENT.href} size="lg" onClick={() => setOpen(false)} className="w-full min-w-0">
                        <PasskeyIcon />
                        <span className="truncate">{MY_AGENT.label}</span>
                      </ButtonLink>
                      <button
                        type="button"
                        className="yl-press h-10 rounded-control border border-line-3 text-13 text-fg-1 hover:bg-bg-2"
                        onClick={() => {
                          clearVisitorSession();
                          setOpen(false);
                          router.push("/");
                        }}
                      >
                        Log out
                      </button>
                    </div>
                  ) : (
                    <ButtonLink href={SIGN_UP.href} size="lg" onClick={() => setOpen(false)} className="w-full min-w-0">
                      <PasskeyIcon />
                      <span className="truncate">{SIGN_UP.label}</span>
                    </ButtonLink>
                  )}
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

function MenuItem({ page, active, onNavigate }: { page: { href: string; label: string; hint: string }; active: boolean; onNavigate: () => void }) {
  return (
    <li>
      <Link href={page.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className="yl-nav-mobile-link">
        <span>{page.label}</span>
        <small>{page.hint}</small>
      </Link>
    </li>
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
