import { cn, RingGlyph } from "@yinglong/ui";
import type { EdgeState, NodeGlyph, StateCounts } from "./model";

/** What each node glyph says, in words (the glyph is never the only signal). */
export const GLYPH_WORD: Record<NodeGlyph, string> = {
  attested: "Passport attested",
  "self-registered": "Self-registered, no trusted issuer",
  halted: "Passport halted",
  revoked: "Passport revoked",
  person: "Person (account owner)",
  company: "Company (account owner)",
  visitors: "Visitors",
  payee: "In a payee book",
  unverified: "Not in any payee book",
  regulator: "Regulator node",
  anchor: "Anchor on chain",
  "anchor-empty": "No anchor yet",
};

export const STATE_WORD: Record<EdgeState, string> = { settled: "Settled", awaiting: "Needs a person", refused: "Refused" };

/**
 * Node glyphs, 20 px on a 24-unit grid. Passport: solid ring with a check = attested, dashed ring =
 * self-registered. Owners carry no ring (a person is a dot, a company a square). Payees in a payee book
 * carry the "rule" ring (ring with a bar); addresses in no book a dotted ring. Ledger elements are steel.
 */
export function NodeGlyphIcon({ glyph, size = 20, className }: { glyph: NodeGlyph; size?: number; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;
  let body: React.ReactNode;
  let tone = "text-fg-1";
  switch (glyph) {
    case "attested":
      return <RingGlyph state="verified" size={size} className={cn("text-fg-1", className)} />;
    case "halted":
      return <RingGlyph state="paused" size={size} className={cn("text-fg-muted", className)} />;
    case "revoked":
      return <RingGlyph state="expired" size={size} className={cn("text-fg-muted", className)} />;
    case "self-registered":
      tone = "text-fg-muted";
      body = <circle cx="12" cy="12" r="9" {...common} strokeDasharray="3.2 2.6" />;
      break;
    case "person":
      tone = "text-fg-2";
      body = <circle cx="12" cy="12" r="4.2" fill="currentColor" />;
      break;
    case "company":
      tone = "text-fg-2";
      body = <rect x="7.5" y="7.5" width="9" height="9" rx="1.6" fill="currentColor" />;
      break;
    case "visitors":
      tone = "text-fg-2";
      body = (
        <>
          <circle cx="8" cy="9.5" r="2.6" fill="currentColor" />
          <circle cx="16" cy="9.5" r="2.6" fill="currentColor" />
          <circle cx="12" cy="16" r="2.6" fill="currentColor" />
        </>
      );
      break;
    case "payee":
      tone = "text-fg-2";
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <path d="M7.5 12h9" {...common} strokeLinecap="round" />
        </>
      );
      break;
    case "unverified":
      tone = "text-fg-muted";
      body = <circle cx="12" cy="12" r="9" {...common} strokeWidth={2} strokeDasharray="0.01 3.6" strokeLinecap="round" />;
      break;
    case "regulator":
      tone = "text-steel";
      body = (
        <>
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" {...common} />
          <circle cx="12" cy="12" r="3.4" fill="currentColor" />
        </>
      );
      break;
    case "anchor":
      return <RingGlyph state="onchain" size={size} className={cn("text-steel", className)} />;
    case "anchor-empty":
      return <RingGlyph state="unknown" size={size} className={cn("text-fg-muted", className)} />;
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className={cn("shrink-0", tone, className)}>
      {body}
    </svg>
  );
}

/** Edge-state glyph: check ring (settled), half-filled brass ring (needs a person), barred ring (refused). */
export function StateGlyph({ state, size = 12, className }: { state: EdgeState; size?: number; className?: string }) {
  const ring = state === "settled" ? "verified" : state === "awaiting" ? "waiting" : "refused";
  return <RingGlyph state={ring} size={size} className={cn(state === "awaiting" ? "text-brass" : state === "settled" ? "text-fg-1" : undefined, className)} />;
}

/** Inline counts: "[check] 3  [half] 1  [bar] 15", refusals on the inverted chip. */
export function StateCountsInline({ counts, className }: { counts: StateCounts; className?: string }) {
  const items = (["settled", "awaiting", "refused"] as const).filter((s) => counts[s] > 0);
  if (!items.length) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {items.map((s) => (
        <span
          key={s}
          className={cn(
            "inline-flex h-4 items-center gap-0.5 rounded-pill font-mono text-11 leading-none",
            s === "refused" ? "bg-refused-bg pr-1 pl-0.5 text-refused-fg" : s === "awaiting" ? "text-brass" : "text-fg-2",
          )}
        >
          <StateGlyph state={s} size={12} />
          {counts[s]}
          <span className="sr-only"> {STATE_WORD[s].toLowerCase()}</span>
        </span>
      ))}
    </span>
  );
}
