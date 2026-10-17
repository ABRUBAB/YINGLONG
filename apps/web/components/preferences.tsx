"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@yinglong/ui";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the preference lasts for this page only */
  }
}

const subscribe = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cs = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", cb);
  cs.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
    cs.removeEventListener("change", cb);
  };
};

/** True when motion should be off: OS reduced-motion or the page's "Pause motion" control. */
export function useMotionOff(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function useTheme(): "dark" | "light" {
  return useSyncExternalStore(
    subscribe,
    () => {
      // A chosen theme wins; otherwise the device setting (the same rule as tokens.css).
      const t = document.documentElement.dataset.theme;
      if (t === "light" || t === "dark") return t;
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    },
    () => "dark",
  );
}

/**
 * Light and dark. The two themes are separate designs (tokens.mjs), not an inversion. Where the browser
 * supports view transitions the new theme spreads from the button as a circle; otherwise, and under
 * reduced motion or Pause motion, it switches at once.
 */
export function ThemeToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={cn(
        "yl-press inline-flex h-8 items-center gap-2 rounded-control text-12 text-fg-2 hover:bg-bg-3 hover:text-fg-0",
        compact ? "w-8 justify-center border border-line-2" : "px-2",
        className,
      )}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      onClick={(e) => {
        const apply = () => {
          document.documentElement.dataset.theme = next;
          write("yl-theme", next);
        };
        const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<unknown> } };
        const root = document.documentElement;
        if (!doc.startViewTransition || root.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          apply();
          return;
        }
        const r = e.currentTarget.getBoundingClientRect();
        root.style.setProperty("--tx", `${Math.round(r.left + r.width / 2)}px`);
        root.style.setProperty("--ty", `${Math.round(r.top + r.height / 2)}px`);
        root.classList.add("yl-theme-switch");
        doc.startViewTransition(apply).finished.finally(() => root.classList.remove("yl-theme-switch"));
      }}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        {theme === "dark" ? (
          <>
            <circle cx="8" cy="8" r="3" fill="currentColor" />
            <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </>
        ) : (
          <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" fill="currentColor" />
        )}
      </svg>
      {compact ? null : theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}

export function MotionToggle({ className }: { className?: string }) {
  const [off, setOff] = useState(false);
  useEffect(() => setOff(document.documentElement.dataset.motion === "off"), []);
  return (
    <button
      type="button"
      aria-pressed={off}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-control px-2 text-12 text-fg-2 hover:bg-bg-3 hover:text-fg-0",
        className,
      )}
      onClick={() => {
        const v = !off;
        setOff(v);
        if (v) document.documentElement.dataset.motion = "off";
        else delete document.documentElement.dataset.motion;
        write("yl-motion", v ? "off" : "on");
      }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        {off ? (
          <path d="M5.5 4.5l6 3.5-6 3.5z" fill="currentColor" />
        ) : (
          <path d="M5.75 4.5v7M10.25 4.5v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )}
      </svg>
      {off ? "Resume motion" : "Pause motion"}
    </button>
  );
}

export { read as readPref, write as writePref };
