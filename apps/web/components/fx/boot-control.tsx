"use client";

import { useEffect } from "react";

/**
 * Ends the first-visit screen: after the page has loaded and the symbol has been on screen for at
 * least 1.1 s (and at most 3.5 s), the screen fades and the visit is remembered for this session.
 * The attribute is set by a script in the document head (layout.tsx) only when the screen should show.
 */
export function BootControl() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.boot !== "1") return;
    const start = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      root.dataset.boot = "done";
      try {
        sessionStorage.setItem("yl-boot", "1");
      } catch {
        /* storage blocked: the screen may show again on the next visit */
      }
    };
    const arm = () => window.setTimeout(finish, Math.max(0, 1100 - (performance.now() - start)));
    let t: number | undefined;
    if (document.readyState === "complete") t = arm();
    else window.addEventListener("load", () => (t = arm()), { once: true });
    const cap = window.setTimeout(finish, 3500);
    return () => {
      if (t) window.clearTimeout(t);
      window.clearTimeout(cap);
    };
  }, []);
  return null;
}
