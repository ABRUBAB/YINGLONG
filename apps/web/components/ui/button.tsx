import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@yinglong/ui";

/**
 * Buttons (shadcn API shape, ORBIT geometry): 6 px radius, never pill-shaped, never a hue.
 * primary = inverted monochrome; secondary = outlined with a 3:1 boundary; ghost = text only.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap select-none " +
  "yl-press transition-[background-color,border-color,color,opacity] duration-150 ease-out " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
  "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-fg-1 text-bg-0 hover:bg-fg-0 active:bg-fg-2",
  secondary: "border border-line-3 text-fg-1 hover:border-fg-2 hover:bg-bg-2 active:bg-bg-3",
  ghost: "text-fg-1 hover:bg-bg-2 active:bg-bg-3",
  quiet: "text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-0 hover:decoration-fg-2",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-13",
  md: "h-10 px-4 text-13",
  lg: "h-12 px-5 text-15",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], variant === "quiet" ? "h-auto px-0" : sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string; variant?: ButtonVariant; size?: ButtonSize; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

export function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className={cn("shrink-0", className)}>
      <path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className={cn("shrink-0", className)}>
      <path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5L7 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
