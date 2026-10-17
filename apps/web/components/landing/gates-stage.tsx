"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@yinglong/ui";
import { useMotionOff } from "@/components/preferences";
import { useSectionProgress } from "@/components/fx/use-section-progress";
import { gatesPassed, GATES, progressAtGate, RUN } from "@/components/three/gates-math";
import { GATES_COPY } from "./gates-copy";

const GatesTunnel = dynamic(() => import("@/components/three/gates-tunnel"), { ssr: false, loading: () => null });

function webgl2(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

function canRender3D(motionOff: boolean): boolean {
  if (motionOff) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) return false;
  return webgl2();
}

/**
 * The nine checks as a place you travel through. A tall section holds a sticky 3D stage: scrolling
 * moves one payment request through nine gates; the text beside it names the gate it is at, what that
 * check does in plain words, and how many of the listed attacks were stopped there. The real last
 * stopped attack decides where the coin ends (see components/three/gates-math.ts). Click a number to
 * jump to that gate. Browsers without WebGL2, with Save-Data or low memory, and visitors who
 * reduced motion get `fallback`, the flat rail, which carries the same facts. Screen readers get the
 * full list of the nine checks below.
 */
export function GatesStage({ stop, counts, total, fallback }: { stop: number; counts: number[]; total: number; fallback: ReactNode }) {
  const motionOff = useMotionOff();
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(canRender3D(motionOff)), [motionOff]);
  if (!ok) return <>{fallback}</>;
  return <Tunnel stop={stop} counts={counts} total={total} />;
}

function Tunnel({ stop, counts, total }: { stop: number; counts: number[]; total: number }) {
  const root = useRef<HTMLDivElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [passed, setPassed] = useState(0);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [onScreen, setOnScreen] = useState(false);

  const progress = useSectionProgress(root, (p) => {
    setPassed((prev) => {
      const g = gatesPassed(p, stop);
      return prev === g ? prev : g;
    });
    setDone(p >= RUN);
    if (p > 0.015) setStarted(true);
  });

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(Boolean(e?.isIntersecting)), { rootMargin: "200px 0px 200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = sticky.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      pointer.current.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, []);

  const last = stop >= 0 ? stop : GATES - 1;
  const cur = Math.min(passed, last);
  const g = GATES_COPY[cur]!;
  const stoppedHere = done && stop >= 0;
  const allPassed = done && stop < 0;

  const jump = (i: number) => {
    const el = root.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const span = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + progressAtGate(i, stop) * span + 4, behavior: "smooth" });
  };

  return (
    <div ref={root} className="yl-gates-stage" data-gates-stage>
      <div ref={sticky} className="yl-gates-sticky">
        <div className={cn("yl-gates-fade absolute inset-0 transition-opacity duration-700 ease-[var(--ease-out)]", drawn ? "opacity-100" : "opacity-0")}>
          <GatesTunnel progress={progress} stop={stop} active={onScreen} motion pointer={pointer} onFirstFrame={() => setDrawn(true)} />
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3 sm:p-6 lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:p-0">
          <div>
            <div className="yl-glass pointer-events-auto grid w-full max-w-[25rem] gap-3 rounded-sheet p-5 sm:p-6">
              <p className="eyebrow m-0 flex items-center gap-2 text-fg-muted">
                <span className="font-mono tracking-normal text-fg-1">
                  {stoppedHere ? `Stopped at check ${stop + 1}` : allPassed ? "Passed all nine" : `Check ${cur + 1} of 9`}
                </span>
              </p>
              <h3 className="type-display m-0 text-h3 text-fg-0">{g.name}</h3>
              <p className="m-0 text-13 leading-[1.55] text-fg-2 sm:text-15">{g.plain}</p>
              <p className="m-0 text-12 text-fg-muted" aria-live="polite">
                {total > 0 ? `${counts[cur] ?? 0} of ${total} listed attacks were stopped here.` : "No stopped attacks are listed yet."}
                {stoppedHere ? " The last real attack ended here." : ""}
                {allPassed ? " Nothing stopped this payment: it followed every rule." : ""}
              </p>
              <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Jump to a check">
                {GATES_COPY.map((c, i) => (
                  <li key={c.name}>
                    <button
                      type="button"
                      onClick={() => jump(i)}
                      aria-label={`Check ${i + 1}, ${c.name}`}
                      aria-current={i === cur ? "step" : undefined}
                      className={cn(
                        "yl-press inline-flex size-8 items-center justify-center rounded-pill border font-mono text-12 transition-colors duration-150",
                        i === cur ? "border-fg-0 bg-fg-1 text-bg-0" : i < passed ? "border-line-3 text-fg-1 hover:border-fg-2" : "border-line-2 text-fg-muted hover:border-line-3",
                        i === stop && done && "border-refused-bg bg-refused-bg text-refused-fg",
                      )}
                    >
                      {i + 1}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-3 z-10 hidden justify-center transition-opacity duration-500 lg:flex",
            started ? "opacity-0" : "opacity-100",
          )}
        >
          <span className="yl-glass inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-12 text-fg-2">
            <svg viewBox="0 0 16 16" width="14" height="14">
              <rect x="5" y="1.5" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="8" cy="5.4" r="1" fill="currentColor" />
            </svg>
            Scroll to send a payment through
          </span>
        </div>
      </div>

      <ol className="sr-only">
        {GATES_COPY.map((c, i) => (
          <li key={c.name}>
            Check {i + 1}, {c.name}. {c.plain} {counts[i] ?? 0} listed attacks stopped here.
          </li>
        ))}
      </ol>
    </div>
  );
}
