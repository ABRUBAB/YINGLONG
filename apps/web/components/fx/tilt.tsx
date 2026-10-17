"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@yinglong/ui";

/**
 * 3D tilt: the surface leans up to `max` degrees toward the mouse, with a little lift. Pointer only
 * (mouse); touch, keyboard and reduced motion get the flat card. Transform only; the position is
 * written straight to the element.
 */
export function Tilt({ children, max = 5, className }: { children: ReactNode; max?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    if (document.documentElement.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.dataset.active = "true";
    el.style.transform = `perspective(900px) rotateX(${(-py * max * 2).toFixed(2)}deg) rotateY(${(px * max * 2).toFixed(2)}deg) translate3d(0,-2px,0)`;
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.dataset.active = "false";
    el.style.transform = "";
  };
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={cn("yl-tilt", className)}>
      {children}
    </div>
  );
}
