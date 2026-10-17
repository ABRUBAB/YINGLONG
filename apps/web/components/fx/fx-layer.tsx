"use client";

import { useEffect, useRef } from "react";
import { useMotionOff } from "@/components/preferences";
import "./fx.css";

/**
 * The site-wide effects layer, mounted once in the root layout.
 *  - Ambient backdrop: aurora, dot grid, a perspective floor that drifts toward you, film grain and a
 *    soft light that follows the mouse. Purely decorative (aria-hidden, no pointer events).
 *  - Scroll progress: a 2 px line at the top of the window.
 *  - Card light: while the mouse is over a `.yl-card`, its --mx and --my follow the pointer so the
 *    border and the surface glow under it (globals.css and fx.css own the look).
 * Pointer work is one rAF-throttled listener that writes to element styles, never React state.
 * Touch devices and reduced motion get the still backdrop and no pointer light.
 */
export function FxLayer() {
  const off = useMotionOff();
  const light = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.transform = `scaleX(${max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0})`;
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const glow = light.current;
    if (!glow) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!fine) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    let target: EventTarget | null = null;
    let cur = { x, y };
    const frame = () => {
      raf = 0;
      if (!off) {
        // ease the light toward the mouse so it trails a little
        cur = { x: cur.x + (x - cur.x) * 0.2, y: cur.y + (y - cur.y) * 0.2 };
        glow.style.transform = `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0)`;
        if (Math.abs(x - cur.x) > 0.5 || Math.abs(y - cur.y) > 0.5) raf = requestAnimationFrame(frame);
      }
      const card = target instanceof Element ? target.closest<HTMLElement>(".yl-card, .yl-liquid, .yl-glass") : null;
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${x - r.left}px`);
        card.style.setProperty("--my", `${y - r.top}px`);
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      target = e.target;
      glow.dataset.on = "true";
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const leave = () => {
      glow.dataset.on = "false";
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [off]);

  // Water drop: a ripple spreads from the press point of a main button or glass pane.
  useEffect(() => {
    if (off) return;
    const down = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(".yl-btn-primary, .yl-liquid") : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.max(r.width, r.height) * 2.2;
      const drop = document.createElement("span");
      drop.className = "yl-ripple";
      drop.setAttribute("aria-hidden", "true");
      drop.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
      el.appendChild(drop);
      drop.addEventListener("animationend", () => drop.remove(), { once: true });
    };
    document.addEventListener("pointerdown", down, { passive: true });
    return () => document.removeEventListener("pointerdown", down);
  }, [off]);

  return (
    <>
      <div className="yl-progress" aria-hidden="true">
        <span ref={bar} />
      </div>
      <div className="yl-ambient" aria-hidden="true">
        <div className="yl-ambient__aurora" />
        <div className="yl-ambient__dots" />
        <div className="yl-ambient__floor" />
        <div ref={light} className="yl-ambient__light" data-on="false" />
        <div className="yl-ambient__grain" />
      </div>
    </>
  );
}
