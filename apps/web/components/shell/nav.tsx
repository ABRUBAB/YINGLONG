import type { ReactNode } from "react";
import { f3 } from "@yinglong/ui";

/** Monoline 16 px glyphs on the ring grammar (no icon library; no sparkle, no emoji). */
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const NAV_GLYPHS: Record<string, ReactNode> = {
  console: (
    <>
      <circle cx="8" cy="8" r="5.6" {...S} />
      <circle cx="12.85" cy="5.2" r="1.6" fill="currentColor" />
    </>
  ),
  studio: (
    <>
      <circle cx="8" cy="8" r="3.6" {...S} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = ((-90 + i * 30) * Math.PI) / 180;
        const l = [1.6, 2.4, 1.2, 2, 1.4, 2.6][i % 6]!;
        return <path key={i} d={`M${f3(8 + 4.8 * Math.cos(a))} ${f3(8 + 4.8 * Math.sin(a))}L${f3(8 + (4.8 + l) * Math.cos(a))} ${f3(8 + (4.8 + l) * Math.sin(a))}`} {...S} strokeWidth={1.1} />;
      })}
    </>
  ),
  treasury: (
    <>
      <circle cx="8" cy="8" r="6" {...S} />
      <circle cx="8" cy="8" r="3" {...S} />
    </>
  ),
  supervisor: (
    <>
      <circle cx="7" cy="7" r="4.6" {...S} />
      <path d="M10.4 10.4L14 14" {...S} />
    </>
  ),
  proof: (
    <>
      <path d="M3.5 2.5h6l3 3v8h-9z" {...S} />
      <path d="M5.5 7.5h5M5.5 10h5" {...S} />
    </>
  ),
  city: (
    <>
      <path d="M1.5 10.5l3-5h4l-3 5z" {...S} />
      <path d="M7.5 10.5l3-5h4l-3 5z" {...S} />
    </>
  ),
  challenge: (
    <>
      <circle cx="8" cy="8" r="5.6" {...S} />
      <path d="M4 12L12 4" {...S} />
    </>
  ),
};

export interface NavItem {
  href: string;
  label: string;
  glyph: keyof typeof NAV_GLYPHS;
  mobile?: boolean;
}

export const NAV: NavItem[] = [
  { href: "/app", label: "Console", glyph: "console", mobile: true },
  { href: "/app/mandates/new", label: "Mandate Studio", glyph: "studio", mobile: true },
  { href: "/treasury", label: "Treasury", glyph: "treasury", mobile: true },
  { href: "/supervisor", label: "Supervisor", glyph: "supervisor", mobile: true },
  { href: "/proof", label: "Proof", glyph: "proof" },
  { href: "/city", label: "Agent City", glyph: "city" },
  { href: "/challenge", label: "Judge's Challenge", glyph: "challenge" },
];

export function NavGlyph({ name, size = 16 }: { name: keyof typeof NAV_GLYPHS; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className="shrink-0">
      {NAV_GLYPHS[name]}
    </svg>
  );
}

export function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
