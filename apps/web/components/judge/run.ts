"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MaybePromise } from "@/lib/api/client";

/**
 * One step of the 3-minute walkthrough: idle until it is shown, then running (with the real elapsed time and
 * whatever the task has reported so far), then done or stopped with the service's own error. The
 * result lives in the page, so going Back and forward again never re-runs a step.
 */
export type Run<T> =
  | { at: "idle" }
  | { at: "running"; since: number; note: string | null; partial: Partial<T> }
  | { at: "done"; value: T; ms: number }
  | { at: "error"; error: Error; when: string; ms: number; partial: Partial<T> };

export interface Reporter<T> {
  /** One line about what is happening now, shown next to the timer. */
  note(text: string): void;
  /** Fields that are already known while the rest is still loading. */
  partial(p: Partial<T>): void;
}

export const idle = <T,>(): Run<T> => ({ at: "idle" });

/** Reads may be synchronous (fixtures); this makes every call awaitable and catchable alike. */
export const maybe = async <T,>(f: () => MaybePromise<T>): Promise<T> => f();

/** Runs `task` once, the first time the step is shown. Returns the function Retry calls. */
export function useStepRun<T>(run: Run<T>, setRun: (r: Run<T>) => void, task: (report: Reporter<T>) => Promise<T>): () => void {
  const taskRef = useRef(task);
  taskRef.current = task;
  const setRef = useRef(setRun);
  setRef.current = setRun;
  // Keyed on the idle run object itself: a second idle run (another step rendered in the same place,
  // or Retry) starts again, while a repeated effect for the same run (strict mode) does not.
  const startedFor = useRef<Run<T> | null>(null);

  const start = useCallback(() => {
    const since = performance.now();
    let partial: Partial<T> = {};
    let note: string | null = null;
    const set = (r: Run<T>) => setRef.current(r);
    set({ at: "running", since, note, partial });
    const report: Reporter<T> = {
      note: (t) => {
        note = t;
        set({ at: "running", since, note, partial });
      },
      partial: (p) => {
        partial = { ...partial, ...p };
        set({ at: "running", since, note, partial });
      },
    };
    void taskRef
      .current(report)
      .then((value) => set({ at: "done", value, ms: performance.now() - since }))
      .catch((e: unknown) => set({ at: "error", error: e instanceof Error ? e : new Error(String(e)), when: new Date().toISOString(), ms: performance.now() - since, partial }));
  }, []);

  useEffect(() => {
    if (run.at === "idle" && startedFor.current !== run) {
      startedFor.current = run;
      start();
    }
  }, [run, start]);

  return start;
}

/** Milliseconds since `since` (a performance.now() value), ticking while it is set. */
export function useElapsed(since: number | null): number {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (since === null) {
      setNow(null);
      return;
    }
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [since]);
  return since === null || now === null ? 0 : Math.max(0, now - since);
}

/** "1:42" for a whole-demo clock. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "4.2 s" or "830 ms" for one step. */
export function seconds(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function describeError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "No answer.";
}
