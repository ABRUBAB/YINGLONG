"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@yinglong/ui";
import { SwitchButton } from "@/components/ui/switch-button";

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
  const motionOff = useMotionOff();
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <SwitchButton
      theme={theme}
      showLabel={!compact}
      size={compact ? "sm" : "default"}
      reveal={!motionOff}
      motionOff={motionOff}
      className={className}
      onThemeChange={(next) => {
        const root = document.documentElement;
        root.dataset.theme = next;
        root.style.colorScheme = next;
        write("yl-theme", next);
      }}
    />
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
