"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@yinglong/ui";

/**
 * Magnetic wrapper: the child leans a few pixels toward the mouse while it is near, then settles.
 * Mouse only; touch, keyboard and reduced-motion users get the plain child. Transform only.
 */
export function Magnetic({ children, strength = 0.28, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (e: React.PointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    if (document.documentElement.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) * strength;
    const dy = (e.clientY - (r.top + r.height / 2)) * strength;
    el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
    el.style.transition = "transform 80ms linear";
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "translate3d(0,0,0)";
    el.style.transition = "transform 420ms var(--ease-out)";
  };
  return (
    <span ref={ref} onPointerMove={move} onPointerLeave={leave} className={cn("inline-flex will-change-transform", className)}>
      {children}
    </span>
  );
}
