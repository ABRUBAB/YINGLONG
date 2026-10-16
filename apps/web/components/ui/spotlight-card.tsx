"use client";

import { useRef, type ComponentProps, type PointerEvent } from "react";
import { cn } from "@yinglong/ui";

/**
 * Spotlight card (after Magic UI MagicCard, MIT; restyled to ORBIT): a soft monochrome light follows
 * the pointer along the card's 1 px border (globals.css `.yl-spotlight`). Pointer-only and decorative:
 * touch, keyboard and reduced-motion users get the plain card, which carries the same content.
 * The position is written straight to the element (no React state, no re-render per move).
 */
export function SpotlightCard({ className, children, ...rest }: ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div ref={ref} onPointerMove={move} className={cn("yl-card yl-spotlight", className)} {...rest}>
      {children}
    </div>
  );
}
