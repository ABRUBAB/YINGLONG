"use client";

/**
 * @author @dorianbaffier
 * @license MIT
 * @source https://kokonutui.com/docs/buttons/switch-button
 */

import { useId, useRef } from "react";
import { flushSync } from "react-dom";
import { cn } from "@yinglong/ui";

type Theme = "light" | "dark";

interface SwitchButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "default" | "lg";
  showLabel?: boolean;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  reveal?: boolean;
  motionOff?: boolean;
}

const SIZES = {
  sm: { button: "h-8 gap-1.5 px-2.5 text-12", square: "w-8", icon: 14 },
  default: { button: "h-9 gap-2 px-3 text-13", square: "w-9", icon: 16 },
  lg: { button: "h-10 gap-2 px-3.5 text-15", square: "w-10", icon: 18 },
};

const RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const RAYS = RAY_ANGLES.map((deg) => {
  const rad = (deg * Math.PI) / 180;
  const at = (radius: number) => ({
    x: Number((12 + radius * Math.cos(rad)).toFixed(2)),
    y: Number((12 + radius * Math.sin(rad)).toFixed(2)),
  });
  return { deg, from: at(7.5), to: at(10) };
});

const REVEAL_ATTR = "data-theme-reveal";
const REVEAL_STYLE_ID = "kokonut-theme-reveal";
const REVEAL_CSS = `html[${REVEAL_ATTR}]::view-transition-old(root),html[${REVEAL_ATTR}]::view-transition-new(root){animation:none;mix-blend-mode:normal}`;
const ANIMATED_PROPS = ["opacity", "scale", "translate", "filter"] as const;
type Snapshot = Map<Element, Keyframe>;

function snapshot(elements: Element[]): Snapshot {
  const frames: Snapshot = new Map();
  for (const element of elements) {
    const style = getComputedStyle(element);
    const frame: Keyframe = { offset: 0 };
    for (const property of ANIMATED_PROPS) frame[property] = style.getPropertyValue(property);
    frames.set(element, frame);
    for (const animation of element.getAnimations()) animation.cancel();
  }
  return frames;
}

function timing(element: Element, toDark: boolean): KeyframeAnimationOptions {
  const { part, index = "0" } = (element as HTMLElement | SVGElement).dataset;
  const i = Number(index);
  if (part === "ray") return { delay: toDark ? i * 18 : 140 + i * 22, duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
  if (part === "bite") return { delay: toDark ? 60 : 0, duration: 380, easing: "cubic-bezier(0.65, 0, 0.35, 1)" };
  if (part === "disc") return { delay: toDark ? 40 : 0, duration: 380, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
  return { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
}

function morph(frames: Snapshot, toDark: boolean) {
  if (document.documentElement.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const [element, frame] of frames) element.animate([frame, {}], { ...timing(element, toDark), fill: "backwards" });
}

let revealRunning = false;

function revealFrom(button: HTMLElement, apply: () => void) {
  const doc = document as Document & { activeViewTransition?: unknown };
  if (
    typeof doc.startViewTransition !== "function" ||
    document.documentElement.dataset.motion === "off" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    revealRunning ||
    doc.activeViewTransition
  ) {
    apply();
    return;
  }

  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const root = document.documentElement;
  if (!document.getElementById(REVEAL_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = REVEAL_STYLE_ID;
    style.textContent = REVEAL_CSS;
    document.head.appendChild(style);
  }

  root.setAttribute(REVEAL_ATTR, "");
  revealRunning = true;
  let transition: ViewTransition;
  try {
    transition = doc.startViewTransition(() => flushSync(apply));
  } catch {
    root.removeAttribute(REVEAL_ATTR);
    revealRunning = false;
    apply();
    return;
  }

  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 500, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {
      // A navigation can skip the reveal after the theme has already changed.
    });
  transition.finished
    .catch(() => {
      // A skipped transition still needs the temporary reveal state cleaned up.
    })
    .finally(() => {
      root.removeAttribute(REVEAL_ATTR);
      revealRunning = false;
    });
}

export function SwitchButton({
  className,
  size = "default",
  showLabel = true,
  theme,
  onThemeChange,
  reveal = true,
  motionOff = false,
  onClick,
  ...props
}: SwitchButtonProps) {
  const maskId = `${useId()}-moon`;
  const iconRef = useRef<SVGSVGElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const sizing = SIZES[size];

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;

    const next: Theme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const apply = () => {
      const parts = [
        ...(iconRef.current?.querySelectorAll("[data-part]") ?? []),
        ...(labelRef.current?.querySelectorAll("[data-part]") ?? []),
      ];
      const before = snapshot(parts);
      root.classList.toggle("dark", next === "dark");
      root.style.colorScheme = next;
      onThemeChange(next);
      morph(before, next === "dark");
    };

    if (reveal) revealFrom(event.currentTarget, apply);
    else apply();
  };

  return (
    <button
      aria-label="Dark theme"
      aria-pressed={theme === "dark"}
      className={cn(
        "group/switch relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center rounded-control font-medium",
        "border border-line-3 bg-bg-1 text-fg-1 hover:bg-bg-2 active:bg-bg-3",
        motionOff ? "transition-none" : "transition-[background-color,border-color] duration-150 ease-out",
        "outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50",
        sizing.button,
        !showLabel && cn(sizing.square, "px-0"),
        className,
      )}
      type="button"
      {...props}
      onClick={handleClick}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none shrink-0 overflow-visible"
        fill="none"
        height={sizing.icon}
        ref={iconRef}
        viewBox="0 0 24 24"
        width={sizing.icon}
      >
        <mask id={maskId}>
          <rect fill="white" height="32" width="32" x="-4" y="-4" />
          <circle
            className="translate-x-[10px] -translate-y-[10px] dark:translate-x-0 dark:translate-y-0"
            cx="17"
            cy="7"
            data-part="bite"
            fill="black"
            r="7.5"
          />
        </mask>
        <g mask={`url(#${maskId})`}>
          <circle
            className="origin-[12px_12px] [transform-box:view-box] dark:scale-[1.8]"
            cx="12"
            cy="12"
            data-part="disc"
            fill="currentColor"
            r="4.75"
          />
        </g>
        <g stroke="currentColor" strokeLinecap="round" strokeWidth="2">
          {RAYS.map((ray, index) => (
            <line
              className="origin-[12px_12px] [transform-box:view-box] dark:scale-50 dark:opacity-0"
              data-index={index}
              data-part="ray"
              key={ray.deg}
              x1={ray.from.x}
              x2={ray.to.x}
              y1={ray.from.y}
              y2={ray.to.y}
            />
          ))}
        </g>
      </svg>
      {showLabel ? (
        <span aria-hidden="true" className="grid leading-none" ref={labelRef}>
          <span className="col-start-1 row-start-1 dark:opacity-0 dark:blur-[3px]" data-part="label">
            Light
          </span>
          <span className="col-start-1 row-start-1 opacity-0 blur-[3px] dark:opacity-100 dark:blur-none" data-part="label">
            Dark
          </span>
        </span>
      ) : null}
    </button>
  );
}
