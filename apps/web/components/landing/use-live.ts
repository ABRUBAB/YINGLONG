"use client";

import { useEffect, useRef, useState } from "react";

/** True once the element has come within `margin` of the viewport (and, unless `once`, while it stays there). */
export function useInView<T extends Element>(ref: React.RefObject<T | null>, { once = true, margin = "0px 0px -12% 0px" } = {}): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        const on = Boolean(e?.isIntersecting);
        if (on && once) {
          setInView(true);
          io.disconnect();
        } else if (!once) setInView(on);
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, margin]);
  return inView;
}

/**
 * Calls `tick` every `ms` while `active` and the tab is visible (live reads only poll when someone
 * can see them; a hidden tab or an off-screen section costs nothing).
 */
export function useVisibleInterval(tick: () => void, ms: number, active: boolean) {
  const fn = useRef(tick);
  fn.current = tick;
  useEffect(() => {
    if (!active) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined && document.visibilityState === "visible") id = setInterval(() => fn.current(), ms);
    };
    const stop = () => {
      if (id !== undefined) clearInterval(id);
      id = undefined;
    };
    const vis = () => (document.visibilityState === "visible" ? (fn.current(), start()) : stop());
    start();
    document.addEventListener("visibilitychange", vis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [ms, active]);
}
