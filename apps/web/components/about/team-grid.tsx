"use client";

import { cn } from "@yinglong/ui";
import { TEAM } from "@/content/team";
import { Reveal } from "@/components/fx/reveal";
import { Tilt } from "@/components/fx/tilt";
import { ExternalIcon } from "@/components/ui/button";

/**
 * The team as five portraits. Each sits on the same dark plate (so photos taken on different
 * backgrounds look like one set) with a glow in the member's own colour and a ring of ticks that turns
 * slowly. Pointer: the card leans toward the mouse and the portrait rises. The role is on the portrait,
 * a plain sentence about what they build is below it. Colour is a small accent per person, never a
 * background. The turning ring stops under reduced motion and the Pause motion control.
 */
const TONE: Record<string, string> = {
  accent: "var(--accent-glow)",
  lime: "var(--lime)",
  violet: "var(--violet)",
  cyan: "var(--steel)",
  amber: "var(--brass)",
};

function Ring() {
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2;
    const l = i % 6 === 0 ? 7 : 3.5;
    return `M${(Math.cos(a) * 92).toFixed(1)} ${(Math.sin(a) * 92).toFixed(1)}L${(Math.cos(a) * (92 + l)).toFixed(1)} ${(Math.sin(a) * (92 + l)).toFixed(1)}`;
  }).join("");
  return (
    <svg viewBox="-110 -110 220 220" className="yl-orbit-spin absolute top-[3%] left-1/2 w-[86%] -translate-x-1/2" style={{ ["--spin" as string]: "90s" }} aria-hidden="true">
      <circle r="84" fill="none" stroke="var(--tone)" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 6" />
      <path d={ticks} stroke="var(--tone)" strokeOpacity="0.75" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="0" cy="-84" r="3" fill="var(--tone)" />
    </svg>
  );
}

export function TeamGrid() {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
      {TEAM.members.map((m, i) => (
        <Reveal as="li" key={m.name} delay={i * 0.06} className={cn("min-w-0", i === 0 && "col-span-2 md:col-span-1")}>
          <Tilt max={3} className="h-full">
            <article
              className="yl-card yl-card--glass group grid h-full content-start overflow-hidden"
              style={{ ["--tone" as string]: TONE[m.tone] }}
            >
              <div
                className="relative aspect-[4/5] overflow-hidden"
                style={{
                  background:
                    "radial-gradient(70% 55% at 50% 38%, color-mix(in oklab, var(--tone) 34%, transparent), transparent 70%), linear-gradient(180deg, #171a1f 0%, #0b0c0f 100%)",
                }}
              >
                <Ring />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.photo}
                  alt={`Portrait of ${m.name}`}
                  width={640}
                  height={800}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 size-full object-cover object-top transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.04]"
                />
                <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#0b0c0f] to-transparent" />
                <span className="absolute top-3 left-3 font-mono text-11 text-[color:var(--tone)]">{`0${i + 1}`}</span>
                {m.lead ? (
                  <span className="eyebrow absolute top-3 right-3 rounded-pill border border-[color:var(--tone)] bg-[rgb(0_0_0/0.4)] px-2 py-0.5 text-[color:var(--tone)] backdrop-blur-sm">Lead</span>
                ) : null}
                <span className="absolute inset-x-3 bottom-3 inline-flex w-fit max-w-full items-center rounded-pill border border-[rgb(255_255_255/0.15)] bg-[rgb(0_0_0/0.45)] px-3 py-1 text-12 text-[#fff] backdrop-blur-md">
                  <span className="truncate">{m.role}</span>
                </span>
              </div>
              <div className="grid gap-2 p-4">
                <h3 className="type-display m-0 text-18 leading-tight text-fg-0">{m.name}</h3>
                <p className="m-0 text-13 leading-snug text-fg-2">{m.bio}</p>
                {m.links?.length ? (
                  <p className="m-0 flex flex-wrap gap-3 text-13">
                    {m.links.map((l) => (
                      <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-fg-1 underline decoration-line-3 underline-offset-4 hover:text-fg-0">
                        {l.label} <ExternalIcon />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ))}
                  </p>
                ) : null}
              </div>
            </article>
          </Tilt>
        </Reveal>
      ))}
    </ul>
  );
}
