"use client";

import { useEffect, useState } from "react";
import { useMotionOff } from "@/components/preferences";

/**
 * Types each line in turn, holds it, then moves to the next. `typed` is the text so far, `index` the
 * line being shown and `done` is true while a finished line is held. With reduced motion or Pause
 * motion it shows the first line complete and stays still.
 */
export function useTypewriter(lines: readonly string[], { speed = 26, hold = 2200, active = true } = {}) {
  const off = useMotionOff();
  const [state, setState] = useState({ index: 0, count: 0 });
  const line = lines[state.index] ?? "";
  const done = state.count >= line.length;

  useEffect(() => {
    if (off || !active || lines.length === 0) return;
    const id = window.setTimeout(
      () => {
        if (!done) setState((s) => ({ ...s, count: s.count + 1 }));
        else setState((s) => ({ index: (s.index + 1) % lines.length, count: 0 }));
      },
      done ? hold : speed,
    );
    return () => window.clearTimeout(id);
  }, [state, done, off, active, lines.length, speed, hold]);

  if (off) return { typed: lines[0] ?? "", index: 0, done: true };
  return { typed: line.slice(0, state.count), index: state.index, done };
}
