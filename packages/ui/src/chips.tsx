import type { ReactNode } from "react";
import { cn } from "./cn.ts";

/** Output-type chips: what kind of statement is the user reading? */
export type OutputKind = "ai" | "rule" | "onchain" | "estimate";

const OUTPUT_LABEL: Record<OutputKind, string> = {
  ai: "AI-generated",
  rule: "Rule",
  onchain: "On-chain fact",
  estimate: "Estimate",
};

function OutputGlyph({ kind }: { kind: OutputKind }) {
  const ring = <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />;
  let inner: ReactNode = null;
  if (kind === "ai") {
    inner = (
      <text
        x="8"
        y="10.6"
        textAnchor="middle"
        fontSize="6.8"
        fontWeight="650"
        fill="currentColor"
        style={{ fontFamily: "var(--font-sans)", letterSpacing: "-0.02em" }}
      >
        AI
      </text>
    );
  } else if (kind === "rule") {
    inner = <path d="M4.6 8h6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />;
  } else if (kind === "onchain") {
    inner = <circle cx="13.7" cy="4.7" r="2.2" fill="currentColor" />;
  } else {
    inner = (
      <path
        d="M4.6 8.6c1.1-1.5 2.1-1.5 3.2-.5s2.1 1 3.4-.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" className="shrink-0">
      {ring}
      {inner}
    </svg>
  );
}

export function OutputChip({ kind, detail, className }: { kind: OutputKind; detail?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-pill border px-1.5 text-11 font-medium leading-none whitespace-nowrap",
        kind === "onchain" ? "border-steel/50 bg-steel-tint text-steel" : "border-line-2 text-fg-2",
        className,
      )}
    >
      <OutputGlyph kind={kind} />
      {OUTPUT_LABEL[kind]}
      {detail ? <span className="min-w-0 truncate font-mono text-fg-muted">{detail}</span> : null}
    </span>
  );
}

/** Neutral label chip, used for honest labels: "Sample data", "Test units", "Simulator". */
export function LabelChip({
  children,
  tone = "neutral",
  dotted,
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "steel" | "brass";
  dotted?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-pill border px-2 text-11 font-medium leading-none whitespace-nowrap",
        tone === "steel" && "border-steel/50 bg-steel-tint text-steel",
        tone === "brass" && "border-brass/50 bg-brass-tint text-brass",
        tone === "neutral" && "border-line-3 text-fg-2",
        dotted && "border-dashed",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** "Sample data": every fixture-backed surface carries it (NEXT_PUBLIC_DATA_MODE=fixtures). */
export function SampleDataChip({ className }: { className?: string }) {
  return (
    <LabelChip dotted className={className}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="0.01 3" strokeLinecap="round" />
      </svg>
      Sample data
    </LabelChip>
  );
}
