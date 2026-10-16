"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@yinglong/ui";
import { Mark, Wordmark } from "@/components/brand/mark";
import { ButtonLink } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/preferences";

const LINKS = [
  { href: "/app", label: "Console" },
  { href: "/treasury", label: "Treasury" },
  { href: "/supervisor", label: "Supervisor" },
  { href: "/city", label: "Agent City" },
  { href: "/proof", label: "Proof" },
];

export function SiteHeader({ obsidian = true, className }: { obsidian?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header
      data-surface={obsidian ? "obsidian" : undefined}
      className={cn("sticky top-0 z-30 border-b border-line-1 bg-bg-0 text-fg-1", className)}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3 rounded-control" aria-label="YINGLONG home">
          <Mark size={28} decorative className="text-fg-0" />
          <Wordmark height={12} className="text-fg-0" />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-control px-3 py-2 text-13 text-fg-2 transition-colors hover:text-fg-0">
              {l.label}
            </Link>
          ))}
          <ButtonLink href="/challenge" variant="secondary" size="sm" className="ml-2">
            Judge&apos;s Challenge
          </ButtonLink>
        </nav>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex h-9 items-center rounded-control border border-line-3 px-3 text-13 text-fg-1 md:hidden"
        >
          Menu
        </button>
      </div>
      <Sheet open={open} onOpenChange={setOpen} title="YINGLONG" side="bottom">
        <ul className="m-0 grid list-none gap-1 p-0">
          {[...LINKS, { href: "/challenge", label: "Judge's Challenge" }].map((l) => (
            <li key={l.href}>
              <Link href={l.href} onClick={() => setOpen(false)} className="flex h-11 items-center rounded-control px-3 text-15 text-fg-1 hover:bg-bg-3">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-line-1 pt-4">
          <ThemeToggle />
        </div>
      </Sheet>
    </header>
  );
}
