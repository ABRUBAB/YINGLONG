import type { ReactNode } from "react";
import { cn, f3, shortHash } from "./cn.ts";

/**
 * One semantic encoding for every state in the product.
 * Every state is a glyph plus a word; colour is never the only signal.
 */
export type RingState =
  | "verified"
  | "waiting"
  | "asking"
  | "refused"
  | "onchain"
  | "sealed"
  | "pending"
  | "expired"
  | "unknown"
  | "paused"
  | "skipped";

export type RingSize = 16 | 20 | 24;

export const RING_WORD: Record<RingState, string> = {
  verified: "Verified",
  waiting: "Needs you",
  asking: "Not sure, your call",
  refused: "Refused",
  onchain: "On chain",
  sealed: "Sealed",
  pending: "Pending",
  expired: "Expired",
  unknown: "Unknown",
  paused: "Paused",
  skipped: "Not reached",
};

const TONE: Record<RingState, string> = {
  verified: "text-jade",
  waiting: "text-brass",
  asking: "text-brass",
  refused: "text-refused-fg",
  onchain: "text-steel",
  sealed: "text-seal",
  pending: "text-fg-muted",
  expired: "text-fg-muted",
  unknown: "text-fg-muted",
  paused: "text-fg-muted",
  skipped: "text-fg-muted",
};

const TEXT: Record<RingSize, string> = { 16: "text-12", 20: "text-13", 24: "text-15" };

/** The bare glyph (24-unit grid, scales to 16/20/24 px). */
export function RingGlyph({ state, size = 16, className }: { state: RingState; size?: number; className?: string }) {
  const sw = size <= 16 ? 2 : 1.75;
  const common = { fill: "none", stroke: "currentColor", strokeWidth: sw } as const;
  let body: ReactNode;
  switch (state) {
    case "verified":
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <path d="M8.2 12.4l2.6 2.6 5-5.4" {...common} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    case "waiting":
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
        </>
      );
      break;
    case "asking":
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </>
      );
      break;
    case "refused":
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <path d="M5.6 18.4L18.4 5.6" {...common} strokeLinecap="round" />
        </>
      );
      break;
    case "onchain":
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <circle cx="19.79" cy="7.5" r="3" fill="currentColor" />
        </>
      );
      break;
    case "sealed":
      body = (
        <>
          <circle cx="12" cy="12" r="6.6" {...common} strokeWidth={sw * 0.8} />
          {Array.from({ length: 16 }, (_, i) => {
            const a = ((-90 + i * 22.5) * Math.PI) / 180;
            const len = [2.4, 3.6, 1.6, 3, 2, 3.8, 1.8, 2.8][i % 8]!;
            const r0 = 8;
            return (
              <line
                key={i}
                x1={f3(12 + r0 * Math.cos(a))}
                y1={f3(12 + r0 * Math.sin(a))}
                x2={f3(12 + (r0 + len) * Math.cos(a))}
                y2={f3(12 + (r0 + len) * Math.sin(a))}
                stroke="currentColor"
                strokeWidth={1.3}
                strokeLinecap="round"
              />
            );
          })}
        </>
      );
      break;
    case "pending":
      body = <circle cx="12" cy="12" r="9" {...common} strokeDasharray="3.6 2.5" />;
      break;
    case "paused":
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...common} strokeDasharray="3.6 2.5" />
          <path d="M10 9v6M14 9v6" {...common} strokeLinecap="round" />
        </>
      );
      break;
    case "expired":
    case "unknown":
    case "skipped":
      body = <circle cx="12" cy="12" r="9" {...common} strokeDasharray="0.01 3.53" strokeLinecap="round" strokeWidth={sw + 0.4} />;
      break;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {body}
    </svg>
  );
}

export interface StateRingProps {
  state: RingState;
  size?: RingSize;
  /** Override the word (for example "Refused" plus a typed error is built from `error`). */
  label?: string;
  /** Typed error shown after the word for refused states, e.g. "PayeeNotVerified". */
  error?: string;
  /** Hash for on-chain states; rendered short in mono. */
  hash?: string;
  /** Explorer link for on-chain states. */
  href?: string;
  /** Hide the word visually (it stays available to assistive technology). */
  glyphOnly?: boolean;
  className?: string;
}

export function StateRing({ state, size = 16, label, error, hash, href, glyphOnly, className }: StateRingProps) {
  const word = label ?? RING_WORD[state];
  const text = TEXT[size];
  if (state === "refused") {
    return (
      <span
        className={cn(
          "inline-flex max-w-full min-w-0 gap-2 rounded-pill bg-refused-bg px-2.5 py-1.5 align-middle font-medium text-refused-fg",
          error ? "items-start whitespace-normal leading-snug" : "items-center whitespace-nowrap leading-none",
          text,
          className,
        )}
      >
        <RingGlyph state="refused" size={size} className={error ? "mt-0.5" : undefined} />
        <span className={cn("min-w-0", glyphOnly ? "sr-only" : error ? "[overflow-wrap:anywhere]" : undefined)}>
          {word}
          {error ? (
            <>
              <span aria-hidden="true"> &middot; </span>
              <span className="font-mono [overflow-wrap:anywhere]">{error}</span>
            </>
          ) : null}
        </span>
      </span>
    );
  }
  const hashNode = hash ? (
    <span className="font-mono tabular whitespace-nowrap text-fg-2" translate="no">
      {shortHash(hash)}
    </span>
  ) : null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 align-middle leading-none", text, TONE[state], className)}>
      <RingGlyph state={state} size={size} />
      <span className={glyphOnly ? "sr-only" : word.length <= 28 ? "whitespace-nowrap" : undefined}>{word}</span>
      {hashNode && href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-line-3 underline-offset-2 hover:decoration-steel"
        >
          {hashNode}
          <span className="sr-only"> (opens the block explorer)</span>
        </a>
      ) : (
        hashNode
      )}
    </span>
  );
}
