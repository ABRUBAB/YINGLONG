"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { cn } from "@yinglong/ui";

/**
 * Press-and-hold seal (master plan 14.6.1, docs/MOTION.md moment 7). Holding fills the thin ring
 * around the Hash Ring; releasing early drains it with GSAP's easeReverse. Every path has an
 * alternative: a short click or Enter opens a confirmation dialog, holding Space works like the pointer.
 */
export function SealButton({
  disabled,
  busy,
  label,
  onProgress,
  onComplete,
  onConfirmPath,
  holdMs = 1200,
}: {
  disabled?: boolean;
  busy?: boolean;
  label: string;
  onProgress: (p: number) => void;
  onComplete: () => void;
  /** Click or Enter: open the confirmation dialog instead of holding. */
  onConfirmPath: () => void;
  holdMs?: number;
}) {
  const state = useRef({ p: 0 });
  const tween = useRef<gsap.core.Tween | null>(null);
  const downAt = useRef(0);
  const holding = useRef(false);

  useEffect(() => () => void tween.current?.kill(), []);

  function start() {
    if (disabled || busy || holding.current) return;
    holding.current = true;
    downAt.current = performance.now();
    tween.current?.kill();
    tween.current = gsap.to(state.current, {
      p: 1,
      duration: (holdMs / 1000) * (1 - state.current.p),
      ease: "power1.in",
      easeReverse: "power2.out",
      onUpdate: () => onProgress(state.current.p),
      onComplete: () => {
        holding.current = false;
        onComplete();
      },
      onReverseComplete: () => onProgress(0),
    });
  }

  function release(viaClick: boolean) {
    if (!holding.current) return;
    holding.current = false;
    const short = performance.now() - downAt.current < 260;
    if (state.current.p < 1) {
      // Drain the ring back to empty with the reverse ease.
      tween.current?.reverse();
    }
    if (viaClick && short) onConfirmPath();
  }

  // Reset the fill when the button is re-enabled for a new draft.
  useEffect(() => {
    if (!busy && !disabled) return;
    tween.current?.kill();
    state.current.p = 0;
  }, [busy, disabled]);

  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-describedby="seal-help"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={() => release(true)}
      onPointerCancel={() => release(false)}
      onKeyDown={(e) => {
        if (e.key === " " && !e.repeat) {
          e.preventDefault();
          start();
        } else if (e.key === "Enter") {
          e.preventDefault();
          onConfirmPath();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          release(false);
        }
      }}
      onClick={(e) => {
        e.preventDefault();
        // Assistive technology activates with a synthetic click (detail 0): give it the dialog path.
        if (e.detail === 0 && !holding.current) onConfirmPath();
      }}
      className={cn(
        "relative inline-flex h-12 w-full touch-none items-center justify-center gap-2 rounded-control bg-fg-1 px-5 text-15 font-medium text-bg-0 select-none",
        "transition-colors duration-150 hover:bg-fg-0 active:bg-fg-2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "disabled:pointer-events-none disabled:opacity-45",
      )}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      </svg>
      {busy ? "Sealing" : label}
    </button>
  );
}
