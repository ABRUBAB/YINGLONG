"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Progress 0..1 of a tall section as it scrolls through the window: 0 when its top reaches the top
 * of the viewport, 1 when its bottom reaches the bottom. Held in a ref (read it inside a frame loop
 * or a rAF callback); `onChange` is called at most once per frame for DOM updates. No React state.
 */
export function useSectionProgress(
  ref: RefObject<HTMLElement | null>,
  onChange?: (p: number) => void,
  offset = 0,
): RefObject<number> {
  const p = useRef(0);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const total = r.height - (window.innerHeight - offset);
      const next = total <= 0 ? 0 : Math.min(1, Math.max(0, (-r.top + offset) / total));
      if (next !== p.current) {
        p.current = next;
        cb.current?.(next);
      }
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    calc();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, offset]);
  return p;
}
