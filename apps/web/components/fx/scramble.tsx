"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionOff } from "@/components/preferences";

const GLYPHS = "0123456789abcdef";

/**
 * Decrypt text: characters flip through random hex and settle left to right. Plays once when the
 * text first scrolls into view and again on hover or focus of the element that holds it (pass the
 * `trigger` flag from the parent). Under reduced motion or Pause motion the final text is shown at
 * once. The accessible text is always the final text.
 */
export function Scramble({ text, trigger = 0, className, ms = 700 }: { text: string; trigger?: number; className?: string; ms?: number }) {
  const off = useMotionOff();
  const [shown, setShown] = useState(text);
  const raf = useRef(0);
  const el = useRef<HTMLSpanElement>(null);

  const play = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (off) {
      setShown(text);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const settled = Math.floor(k * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        out += i < settled || !/[0-9a-f]/i.test(c) ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setShown(out);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [off, text, ms]);

  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          play();
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [play]);

  useEffect(() => {
    if (trigger > 0) play();
  }, [trigger, play]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <span ref={el} className={className}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
