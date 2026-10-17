"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import { cn } from "@yinglong/ui";
import { useMotionOff } from "@/components/preferences";
import { useCan3D } from "@/components/three/support";
import { useInView } from "./use-live";
import { ArrowIcon, ButtonLink } from "@/components/ui/button";
import { PasskeyIcon } from "@/components/shell/site-nav";
import { Magnetic } from "@/components/fx/magnetic";
import { Reveal } from "@/components/fx/reveal";
import { GATES_COPY } from "./gates-copy";

/**
 * The closing call to action: three rings turn slowly behind one sentence and two actions, over a
 * strip of the nine checks. The rings are drawn in SVG, turn on the compositor, stop under reduced
 * motion and the Pause motion control, and carry no information beyond the mood. Plain words.
 */
function Rings() {
  const ticks = (r: number, n: number, len: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const l = len * (0.5 + 0.5 * Math.abs(Math.sin(i * 2.399)));
      return `M${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}L${(Math.cos(a) * (r + l)).toFixed(1)} ${(Math.sin(a) * (r + l)).toFixed(1)}`;
    }).join("");
  return (
    <svg viewBox="-260 -260 520 520" className="size-full" aria-hidden="true">
      <g className="yl-orbit-spin" style={{ ["--spin" as string]: "120s" }}>
        <circle r="238" fill="none" stroke="var(--line-2)" strokeWidth="1" strokeDasharray="2 7" />
        <path d={ticks(226, 96, 12)} stroke="var(--line-3)" strokeWidth="1.2" strokeLinecap="round" />
      </g>
      <g className="yl-orbit-spin" data-reverse="true" style={{ ["--spin" as string]: "80s" }}>
        <circle r="184" fill="none" stroke="var(--chrome-2)" strokeWidth="1.2" opacity="0.6" />
        <path d={ticks(190, 64, 9)} stroke="var(--chrome-1)" strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
        <circle cx="0" cy="-184" r="4" fill="var(--steel)" />
      </g>
      <g className="yl-orbit-spin" style={{ ["--spin" as string]: "50s" }}>
        <circle r="128" fill="none" stroke="var(--chrome-0)" strokeWidth="1.6" strokeDasharray="1 0" opacity="0.9" />
        <circle r="128" fill="none" stroke="var(--bg-0)" strokeWidth="3" strokeDasharray="60 340" strokeDashoffset="20" />
        <circle cx="128" cy="0" r="3.4" fill="var(--seal)" />
      </g>
      <circle r="6" fill="var(--fg-0)" />
    </svg>
  );
}

const WaterArt = dynamic(() => import("@/components/fx/water-backdrop").then((m) => m.WaterArt), { ssr: false, loading: () => null });

export function FinalCta() {
  const off = useMotionOff();
  const can3D = useCan3D(off);
  const root = useRef<HTMLElement>(null);
  const inView = useInView(root, { once: false, margin: "160px 0px 160px 0px" });
  return (
    <section ref={root} aria-labelledby="cta-title" className="yl-defer relative isolate overflow-hidden border-t border-line-1 py-20 sm:py-28 lg:py-36">
      <div aria-hidden="true" className="yl-hero-glow" />
      {can3D && inView ? (
        <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-50 [mask-image:radial-gradient(90%_80%_at_50%_50%,#000_40%,transparent_100%)]">
          <WaterArt moving={inView} />
        </div>
      ) : (
        <div aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2 -z-10 aspect-square w-[min(150vw,1100px)] -translate-x-1/2 -translate-y-1/2 opacity-70 [mask-image:radial-gradient(closest-side,#000_55%,transparent)]">
          <Rings />
        </div>
      )}

      <div className="yl-container grid justify-items-center gap-7 text-center">
        <Reveal>
          <p className="eyebrow m-0 inline-flex items-center gap-3 text-fg-muted">
            <span aria-hidden="true" className="h-px w-8 bg-line-3" />
            Always with you. Never beyond your rules.
            <span aria-hidden="true" className="h-px w-8 bg-line-3" />
          </p>
        </Reveal>
        <Reveal delay={0.05}>
          <h2 id="cta-title" className="type-hero m-0 max-w-[16ch] text-[clamp(2.5rem,1.2rem+5.2vw,6rem)] text-fg-0">
            Let an agent pay. <span className="text-fg-2">Keep the last word.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="m-0 max-w-[46ch] text-15 text-fg-2 sm:text-18 sm:leading-[1.6]">
            Create an agent in about a minute, or try to break one first. Everything here uses test money, and every result can be checked on a blockchain.
          </p>
        </Reveal>
        <Reveal delay={0.15} className="flex flex-wrap items-center justify-center gap-3">
          <Magnetic>
            <ButtonLink href="/start" size="lg">
              <PasskeyIcon size={16} />
              Create your agent
            </ButtonLink>
          </Magnetic>
          <Magnetic>
            <ButtonLink href="/challenge" variant="secondary" size="lg">
              Try to hack it <ArrowIcon />
            </ButtonLink>
          </Magnetic>
        </Reveal>

        <Reveal delay={0.2} className="mt-6 w-full">
          <ol className="m-0 flex list-none flex-wrap justify-center gap-x-2 gap-y-2 p-0" aria-label="The nine checks">
            {GATES_COPY.map((g, i) => (
              <li key={g.name} className={cn("flex items-center gap-2 rounded-pill border border-line-2 bg-bg-1/60 py-1 pr-3 pl-1 text-12 text-fg-2")}>
                <span className="inline-flex size-6 items-center justify-center rounded-pill bg-bg-3 font-mono text-11 text-fg-1">{i + 1}</span>
                {g.name}
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
