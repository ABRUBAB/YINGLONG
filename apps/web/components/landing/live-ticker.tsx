"use client";

import { useMemo } from "react";
import { cn, RingGlyph, shortHash } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import type { Receipt } from "@/lib/api/view";
import { receiptState } from "./receipt-state";

const SHOWN = 14;

/**
 * A slow strip of real receipts under the hero: each chip is one action the agent took or was
 * stopped from taking, with its outcome word and glyph (never colour alone) and a short hash. The
 * list is read from GET /v1/receipts; the loop pauses on hover and focus, under reduced motion and
 * with the page's Pause motion control (the control sits in the strip just above).
 */
export function LiveTicker() {
  const q = useAgent("hero-receipts", (api) => api.receipts({ limit: 200 }), ["receipts"]);
  const items = useMemo<Receipt[]>(() => (q.data?.items ?? []).filter((r) => r.summary).slice(0, SHOWN), [q.data]);
  if (items.length < 4) return null;

  const chip = (r: Receipt, key: string, hidden: boolean) => {
    const s = receiptState(r.outcome);
    return (
      <li
        key={key}
        aria-hidden={hidden || undefined}
        className="flex shrink-0 items-center gap-2.5 rounded-pill border border-line-1 bg-bg-1/70 py-1.5 pr-4 pl-2.5 text-12 text-fg-2"
      >
        <span className={cn("inline-flex size-6 items-center justify-center rounded-pill", s.state === "refused" ? "bg-refused-bg text-refused-fg" : "bg-bg-3")}>
          <RingGlyph state={s.state} size={16} />
        </span>
        <span className="max-w-[26ch] truncate text-fg-1">{r.summary}</span>
        <span className="text-fg-muted">{s.word}</span>
        <span className="font-mono text-11 text-fg-muted">{shortHash(r.receiptId, 6, 4)}</span>
      </li>
    );
  };

  return (
    <section aria-label="Latest receipts" className="yl-ticker no-print">
      <div className="yl-marquee" style={{ ["--duration" as string]: "70s" }}>
        <ul className="yl-marquee-track m-0 list-none p-0">{items.map((r) => chip(r, r.receiptId, false))}</ul>
        <ul className="yl-marquee-track m-0 list-none p-0" aria-hidden="true">
          {items.map((r) => chip(r, `${r.receiptId}-2`, true))}
        </ul>
      </div>
    </section>
  );
}
