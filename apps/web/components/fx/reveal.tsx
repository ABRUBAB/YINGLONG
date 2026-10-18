import { createElement, type ReactNode } from "react";
import { cn } from "@yinglong/ui";

/**
 * Scroll reveal: the block rises a little and fades in as it enters the screen. It is pure CSS (`.yl-reveal`,
 * a scroll-driven animation in globals.css), so the content is already in the page the moment the HTML
 * arrives: nothing waits for scripts to start and then pops in. Browsers without scroll-driven animations,
 * reduced motion and Pause motion simply show the content. `delay` and `y` are kept so existing callers
 * still compile; the CSS timeline follows the scroll, so a delay has nothing to wait for.
 */
export function Reveal({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "li" | "section" | "p" | "span";
}) {
  return createElement(as, { className: cn("yl-reveal", className) }, children);
}
