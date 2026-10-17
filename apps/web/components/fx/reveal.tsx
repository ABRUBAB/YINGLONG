"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useMotionOff } from "@/components/preferences";

/**
 * Scroll reveal: the block rises 18 px and fades in once, when about 15% of it is in view. Stagger a
 * group by giving each child a growing `delay` (30 to 80 ms apart, at most about eight). With
 * reduced motion or Pause motion the content is simply there.
 */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "li" | "section" | "p" | "span";
}) {
  const reduce = useReducedMotion();
  const off = useMotionOff();
  const Tag = motion[as];
  if (reduce || off) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag
      className={className}
      data-reveal
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.7, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </Tag>
  );
}
