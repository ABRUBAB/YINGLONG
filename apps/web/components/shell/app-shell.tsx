"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, ViewTransition, type ReactNode } from "react";
import { cn, LiveStatusO, PauseButton, SampleDataChip, StateRing, type LiveState } from "@yinglong/ui";
import { MarkBadge } from "@/components/brand/mark";
import { MotionToggle, ThemeToggle } from "@/components/preferences";
import { Sheet } from "@/components/ui/sheet";
import { isSample } from "@/lib/api";
import { useAgent } from "@/lib/api/hooks";
import { explorerTxUrl } from "@/lib/chain";
import { useVisitorSession } from "@/components/session";
import { isActive, NAV, NavGlyph } from "./nav";
import { usePause } from "./use-pause";

export type Persona = "nadia" | "lotus" | "supervisor";

const PERSONA: Record<Persona, { name: string; sub: string }> = {
  nadia: { name: "Nadia Rahman", sub: "Agent Ying" },
  lotus: { name: "Lotus Lane", sub: "Treasurer agent" },
  supervisor: { name: "Supervisor", sub: "Regulator node view" },
};

/**
 * App shell (master plan 14.5), the secondary in-app navigation under the global site nav: a 240 px
 * rail (72 px icon rail from 1024 to 1279 px) with the persona at the top and, for Nadia, the
 * inverted Pause always visible at the bottom. Below 1024 px the rail becomes a persona bar and a
 * bottom tab bar that still carries Pause.
 */
export function AppShell({ persona, children, live = "active" }: { persona: Persona; children: ReactNode; live?: LiveState }) {
  const pathname = usePathname() ?? "";
  const pause = usePause();
  const [menu, setMenu] = useState(false);
  const visitor = useVisitorSession();
  const me = useAgent("me", (api) => api.me(), ["me", "pause"]);
  // The console persona is whoever signed up on this device with their own passkey, else Nadia's demo.
  const p =
    persona === "nadia" && visitor
      ? { name: me.data?.displayName ?? "Your account", sub: me.data ? `Agent ${me.data.agentName} · passport ${me.data.agentId}` : "Your passkey account" }
      : persona === "nadia" && me.data
        ? { name: me.data.displayName, sub: `Agent ${me.data.agentName} · passport ${me.data.agentId}` }
        : PERSONA[persona];
  const liveState: LiveState = persona === "nadia" && pause.paused ? "paused" : live;
  const showPause = persona === "nadia";

  const pauseNote = pause.message ? (
    <p role="status" className="m-0 text-11 leading-snug text-fg-2">
      {pause.message}{" "}
      {pause.paused && pause.txs[0] ? (
        <StateRing state="onchain" size={16} hash={pause.txs[0].txHash} href={explorerTxUrl(pause.txs[0].ledger, pause.txs[0].txHash)} />
      ) : null}
    </p>
  ) : null;

  return (
    <div className="yl-appshell min-h-[calc(100dvh-var(--nav-h))] lg:grid lg:grid-cols-[72px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
      {/* Rail */}
      <aside className="hidden border-r border-line-1 bg-bg-1 lg:block" aria-label="Workspace">
        <div className="sticky top-[var(--nav-h)] flex h-[calc(100dvh-var(--nav-h))] flex-col">
        <div className="flex items-center justify-center gap-3 border-b border-line-1 px-3 py-4 xl:justify-between xl:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <MarkBadge size={36} />
            <div className="hidden min-w-0 xl:block">
              <p className="m-0 truncate text-13 font-medium text-fg-0">{p.name}</p>
              <p className="m-0 truncate text-11 text-fg-muted">{p.sub}</p>
            </div>
          </div>
          <LiveStatusO state={liveState} size={20} className="hidden text-fg-1 xl:inline-flex" />
        </div>
        <nav className="mt-3 flex-1 overflow-y-auto px-2 xl:px-3" aria-label="Sections">
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={item.label}
                    className={cn(
                      "relative flex h-9 items-center gap-3 rounded-control px-3 text-13 transition-colors",
                      "justify-center xl:justify-start",
                      active ? "bg-bg-3 font-medium text-fg-0" : "text-fg-2 hover:bg-bg-2 hover:text-fg-0",
                    )}
                  >
                    {active ? <span aria-hidden="true" className="absolute top-2 bottom-2 left-0 w-0.5 rounded-pill bg-fg-1" /> : null}
                    <NavGlyph name={item.glyph} />
                    <span className="sr-only xl:not-sr-only">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="grid gap-3 border-t border-line-1 px-3 pt-3 pb-4 xl:px-4">
          <div className="hidden flex-wrap items-center gap-1.5 xl:flex">
            {isSample ? <SampleDataChip /> : null}
            <span className="text-11 text-fg-muted">Test units only</span>
          </div>
          <div className="hidden items-center gap-1 xl:flex">
            <ThemeToggle />
            <MotionToggle />
          </div>
          {showPause ? (
            <>
              <div className="hidden xl:block">
                <PauseButton state={pause.state} onClick={pause.toggle} />
              </div>
              <div className="xl:hidden">
                <button
                  type="button"
                  onClick={pause.toggle}
                  aria-label={pause.paused ? "Resume Ying (owner passkey)" : "Pause Ying: every delegation, next block"}
                  className={cn(
                    "flex h-11 w-full items-center justify-center rounded-control",
                    pause.paused ? "border border-line-3 text-fg-1" : "bg-fg-1 text-bg-0",
                  )}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeDasharray={pause.paused ? "3.6 2.6" : undefined} />
                    {pause.paused ? <path d="M10 8.5l5.5 3.5-5.5 3.5z" fill="currentColor" /> : <path d="M9.75 8.25v7.5M14.25 8.25v7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
                  </svg>
                </button>
              </div>
              <div className="hidden xl:block">{pauseNote}</div>
            </>
          ) : (
            <p className="m-0 hidden text-11 leading-snug text-fg-muted xl:block">
              {persona === "lotus"
                ? "Treasury halts need 2 of 3 directors. The agent cannot change its own mandate."
                : "Supervisors can pause an agent identity. They can never spend."}
            </p>
          )}
        </div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Mobile persona bar (the global site nav sits above it) */}
        <div className="flex h-14 items-center justify-between gap-3 border-b border-line-1 bg-bg-1 px-4 lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <LiveStatusO state={liveState} size={20} className="text-fg-1" />
            <div className="min-w-0">
              <p className="m-0 truncate text-13 font-medium text-fg-0">{p.name}</p>
              <p className="m-0 truncate text-11 text-fg-muted">{p.sub}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMenu(true)}
            className="yl-press inline-flex h-9 shrink-0 items-center gap-2 rounded-control border border-line-3 px-3 text-13 text-fg-1"
            aria-haspopup="dialog"
          >
            Sections
          </button>
        </div>

        <main id="main" className="min-w-0 pb-24 lg:pb-0">
          <ViewTransition>{children}</ViewTransition>
        </main>

        {/* Mobile tab bar */}
        <nav
          aria-label="Sections"
          className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-5 border-t border-line-2 bg-bg-1 px-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {NAV.filter((n) => n.mobile).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-control text-11",
                  active ? "font-medium text-fg-0" : "text-fg-muted",
                )}
              >
                <NavGlyph name={item.glyph} size={18} />
                <span className="max-w-full truncate px-0.5">{item.label === "Mandate Studio" ? "Studio" : item.label}</span>
              </Link>
            );
          })}
          {showPause ? (
            <div className="flex items-center justify-center p-1.5">
              <button
                type="button"
                onClick={pause.toggle}
                className={cn(
                  "flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-control text-11 font-medium",
                  pause.paused ? "border border-line-3 text-fg-1" : "bg-fg-1 text-bg-0",
                )}
                aria-label={pause.paused ? "Resume Ying (owner passkey)" : "Pause Ying: every delegation, next block"}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  {pause.paused ? <path d="M9 7l8 5-8 5z" fill="currentColor" /> : <path d="M9.5 7v10M14.5 7v10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
                </svg>
                {pause.state === "pausing" ? "Pausing" : pause.state === "resuming" ? "Resuming" : pause.paused ? "Resume" : "Pause"}
              </button>
            </div>
          ) : (
            <Link href="/proof" className="flex flex-col items-center justify-center gap-1 text-11 text-fg-muted">
              <NavGlyph name="proof" size={18} />
              Proof
            </Link>
          )}
        </nav>
        {showPause && pause.message ? (
          <div className="fixed inset-x-3 bottom-[76px] z-30 rounded-card border border-line-2 bg-bg-2 px-4 py-3 lg:hidden">{pauseNote}</div>
        ) : null}
      </div>

      <Sheet open={menu} onOpenChange={setMenu} title="Sections" description={`${p.name} · ${p.sub}`} side="bottom">
        <ul className="m-0 grid list-none gap-1 p-0">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setMenu(false)}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className="flex h-11 items-center gap-3 rounded-control px-3 text-15 text-fg-1 hover:bg-bg-3 aria-[current=page]:bg-bg-3"
              >
                <NavGlyph name={item.glyph} />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center gap-1 border-t border-line-1 pt-4">
          <ThemeToggle />
          <MotionToggle />
        </div>
      </Sheet>
    </div>
  );
}
