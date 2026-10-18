"use client";

import { useRef } from "react";
import { cn } from "@yinglong/ui";
import PullCord from "@/components/kokonutui/pull-cord";
import { useTheme, writePref } from "@/components/preferences";
import { revealFrom } from "@/components/ui/switch-button";

/**
 * Day and night on a pull cord. Lamp on is the light theme, lamp off the dark one. It does exactly what
 * the top-bar switch does (same saved choice, same circle that spreads from the lamp), so the two always
 * agree; the top bar is still the main control and this one is the playful second way.
 */
export function ThemeCord({ className }: { className?: string }) {
  const theme = useTheme();
  const box = useRef<HTMLDivElement>(null);

  return (
    <div ref={box} className={cn(className ?? "w-full")}>
      <PullCord
        checked={theme === "light"}
        label="Daylight"
        hint="pull to switch day and night"
        onCheckedChange={(on) => {
          const next = on ? "light" : "dark";
          const root = document.documentElement;
          const apply = () => {
            root.classList.toggle("dark", next === "dark");
            root.dataset.theme = next;
            root.style.colorScheme = next;
            writePref("yl-theme", next);
          };
          if (box.current) revealFrom(box.current, apply);
          else apply();
        }}
      />
    </div>
  );
}
