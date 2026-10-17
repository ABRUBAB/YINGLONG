"use client";

import { useEffect } from "react";

/**
 * Ends the first-visit screen: after the page has loaded, the symbol has been on screen for at
 * least 1.1 s and (on the home page) the 3D scene has drawn its first frame, within 3.5 s at most, the screen fades and the visit is remembered for this session.
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
    // The home page's 3D scene starts behind this screen: leave only once it has drawn its first frame
    // (the 3.5 s cap below still applies), so everything is already moving when the screen fades.
    let t: number | undefined;
    const arm = () => {
      t = window.setTimeout(() => {
        if (root.dataset.heroWait === "1") window.addEventListener("yl:hero-ready", () => (t = window.setTimeout(finish, 350)), { once: true });
        else finish();
      }, Math.max(0, 1100 - (performance.now() - start)));
    };
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    const cap = window.setTimeout(finish, 3500);
    return () => {
      if (t) window.clearTimeout(t);
      window.clearTimeout(cap);
    };
  }, []);
  return null;
}
