"use client";

import { cn, StateRing } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";

/** Ledger badges with the latest block each ledger reported, and the models in use. */
export function HealthLine({ className }: { className?: string }) {
  const q = useAgent("health", (api) => api.health(), ["health"]);
  if (q.error) {
    return (
      <p className={cn("m-0 text-12 text-fg-muted", className)}>
        <StateRing state="unknown" size={16} label="Agent service unreachable" /> Nothing on this page is live until it answers.
      </p>
    );
  }
  if (!q.data) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line-1 pt-4 text-12 text-fg-muted", className)}>
      {q.data.ledgers.map((l) => (
        <span key={l.ledger} className="inline-flex items-center gap-1.5">
          <StateRing state={isSample ? "pending" : "onchain"} size={16} glyphOnly label={isSample ? "Sample" : "On chain"} />
          {l.badge}
          <span className="font-mono text-fg-2 tabular">#{l.block}</span>
        </span>
      ))}
      <span>Intent model: {q.data.models.intent}</span>
      <span>Sentinel: {q.data.models.sentinel}</span>
    </div>
  );
}
