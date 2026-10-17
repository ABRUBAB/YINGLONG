"use client";

import { useEffect, useState } from "react";

/**
 * "Working" panel for the slow steps of sign-up. It shows what is really happening and a real elapsed
 * timer (measured here), never a made-up progress percentage: the server answers once, when it is done.
 */
export function Working({ title, doing, typical, onScreenHint }: { title: string; doing: string[]; typical: string; onScreenHint?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => setSeconds(Math.floor((performance.now() - t0) / 1000)), 250);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="grid gap-4 rounded-card border border-line-2 bg-bg-1 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="m-0 text-15 font-semibold text-fg-0">{title}</p>
        <p className="m-0 font-mono text-13 text-fg-muted tabular-nums" aria-label={`${seconds} seconds so far`}>
          {seconds} s
        </p>
      </div>
      <span aria-hidden="true" className="yl-working-bar" />
      <ul className="m-0 grid list-none gap-1.5 p-0 text-13 text-fg-2">
        {doing.map((d) => (
          <li key={d} className="flex items-baseline gap-2">
            <span aria-hidden="true" className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-accent" />
            {d}
          </li>
        ))}
      </ul>
      <p className="m-0 text-12 text-fg-muted">
        {typical}
        {seconds > 25 ? " It is taking longer than usual; the test blockchain can be slow. Please keep this page open." : ""}
        {onScreenHint ? ` ${onScreenHint}` : ""}
      </p>
      <style href="yl-working" precedence="default">{`
        .yl-working-bar{display:block;height:3px;border-radius:3px;background:var(--line-2);position:relative;overflow:hidden}
        .yl-working-bar::after{content:"";position:absolute;inset:0;width:38%;background:var(--accent);border-radius:3px;transform:translateX(-100%)}
        @media (prefers-reduced-motion:no-preference){:root:not([data-motion="off"]) .yl-working-bar::after{animation:yl-working 1.3s var(--ease-in-out) infinite}}
        @media (prefers-reduced-motion:reduce){.yl-working-bar::after{transform:none;width:100%;opacity:.5}}
        :root[data-motion="off"] .yl-working-bar::after{transform:none;width:100%;opacity:.5}
        @keyframes yl-working{0%{transform:translateX(-100%)}100%{transform:translateX(280%)}}
      `}</style>
    </div>
  );
}
