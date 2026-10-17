"use client";

import { useState } from "react";
import { cn } from "@yinglong/ui";
import { TEAM } from "@/content/team";
import { ExternalIcon } from "@/components/ui/button";

/**
 * The team as five tall portrait panels side by side. The one you point at, focus or tap opens wide and
 * shows the person's name, role and one sentence; the others stay narrow with their role set sideways. Each
 * portrait sits on the same dark plate with a glow in the person's own colour. Only flex-grow changes (five
 * elements); under reduced motion the panels still switch, without the slide. From 768 px up; phones get
 * the card grid instead (team-grid.tsx).
 */
const TONE: Record<string, string> = {
  accent: "var(--accent-glow)",
  lime: "var(--lime)",
  violet: "var(--violet)",
  cyan: "var(--steel)",
  amber: "var(--brass)",
};

export function TeamPanels() {
  const [active, setActive] = useState(0);
  return (
    <ul className="m-0 hidden h-[min(540px,64vh)] min-h-[420px] list-none gap-2 p-0 md:flex" aria-label="The team">
      {TEAM.members.map((m, i) => {
        const open = active === i;
        return (
          <li key={m.name} className="min-w-0 transition-[flex-grow] duration-500 ease-[var(--ease-out)] motion-reduce:transition-none" style={{ flexGrow: open ? 5 : 1, flexBasis: 0 }}>
            <div
              className={cn("relative size-full overflow-hidden rounded-sheet border transition-colors duration-300", open ? "border-[color:var(--tone)]" : "border-line-2")}
              style={{
                ["--tone" as string]: TONE[m.tone],
                background: "radial-gradient(80% 50% at 50% 34%, color-mix(in oklab, var(--tone) 30%, transparent), transparent 70%), linear-gradient(180deg, #171a1f 0%, #0b0c0f 100%)",
              }}
              onPointerEnter={() => setActive(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.photo}
                alt={`Portrait of ${m.name}`}
                width={640}
                height={800}
                loading="lazy"
                decoding="async"
                className={cn("absolute inset-0 size-full object-cover object-top transition-[filter,opacity] duration-500", open ? "opacity-100" : "opacity-60 grayscale")}
              />
              <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-[#0b0c0f] via-[#0b0c0f]/70 to-transparent" />
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${m.name}, ${m.role}`}
                onClick={() => setActive(i)}
                onFocus={() => setActive(i)}
                className="absolute inset-0 z-10 cursor-pointer rounded-sheet outline-offset-[-4px]"
              />
              <span className="pointer-events-none absolute top-3 left-3 font-mono text-11 text-[color:var(--tone)]">{`0${i + 1}`}</span>
              {m.lead ? <span className="eyebrow pointer-events-none absolute top-3 right-3 rounded-pill border border-[color:var(--tone)] bg-[rgb(0_0_0/0.4)] px-2 py-0.5 text-[color:var(--tone)]">Lead</span> : null}

              {/* collapsed: the role, set sideways */}
              <span
                aria-hidden="true"
                className={cn("pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 text-12 whitespace-nowrap text-[rgb(255_255_255/0.8)] transition-opacity duration-300 [writing-mode:vertical-rl] rotate-180", open ? "opacity-0" : "opacity-100")}
              >
                {m.role}
              </span>

              {/* open: name, role, one sentence */}
              <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-20 grid gap-2 p-5 transition-[opacity,transform] duration-500", open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}>
                <span className="inline-flex w-fit items-center rounded-pill border border-[rgb(255_255_255/0.15)] bg-[rgb(0_0_0/0.45)] px-3 py-1 text-12 text-[#fff] backdrop-blur-md">{m.role}</span>
                <h3 className="type-display m-0 text-22 leading-tight text-[#fff]">{m.name}</h3>
                <p className="m-0 max-w-[40ch] text-13 leading-snug text-[rgb(255_255_255/0.75)]">{m.bio}</p>
                {m.links?.length ? (
                  <p className="pointer-events-auto m-0 flex gap-3 text-13">
                    {m.links.map((l) => (
                      <a key={l.href} href={l.href} target="_blank" rel="noreferrer" tabIndex={open ? 0 : -1} className="relative z-30 inline-flex items-center gap-1.5 text-[#fff] underline decoration-[rgb(255_255_255/0.4)] underline-offset-4 hover:decoration-[#fff]">
                        {l.label} <ExternalIcon />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ))}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
