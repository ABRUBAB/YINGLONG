"use client";

import { useEffect, useMemo, useState } from "react";
import { cn, RingGlyph, shortHash } from "@yinglong/ui";
import type { Receipt } from "@/lib/api/view";
import { formatTime } from "@/lib/format";
import { useMotionOff } from "@/components/preferences";
import { receiptState } from "./receipt-state";

/**
 * Two quiet cards dock in the free corners of the orbit column (above and below the ring, never over
 * it): the latest payment that went through, and the latest attempt that was stopped. Each shows one
 * real receipt and swaps to the next every few seconds with a short fade. No parallax and no
 * per-frame work: the only motion is one opacity and transform change per swap, and the swap stops
 * under reduced motion and the Pause motion control. Desktop only; the ticker under the hero lists the
 * same receipts for everyone else.
 */
function Card({ label, receipt, tone, className }: { label: string; receipt: Receipt; tone: "paid" | "blocked"; className: string }) {
  const s = receiptState(receipt.outcome);
  return (
    <div className={cn("yl-chip yl-glass", className)}>
      <div key={receipt.receiptId} className="yl-chip__inner">
        <span className="flex items-center gap-2 text-11 tracking-wide text-fg-muted uppercase">
          <span className={cn("size-1.5 rounded-pill", tone === "paid" ? "bg-accent-glow" : "bg-seal")} />
          {label}
        </span>
        <span className="line-clamp-2 text-13 leading-snug font-medium text-fg-0">{receipt.summary}</span>
        <span className="flex items-center justify-between gap-3 text-11 text-fg-muted">
          <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5", tone === "blocked" ? "bg-refused-bg text-refused-fg" : "bg-bg-3 text-fg-1")}>
            <RingGlyph state={s.state} size={16} />
            {s.word}
          </span>
          <span className="font-mono">
            {shortHash(receipt.receiptId, 6, 4)} · {formatTime(receipt.timestamp, { date: false })}
          </span>
        </span>
      </div>
    </div>
  );
}

export function HeroChips({ receipts }: { receipts: Receipt[] }) {
  const off = useMotionOff();
  const [n, setN] = useState(0);
  const { paid, blocked } = useMemo(() => {
    const ok = receipts.filter((r) => r.summary && r.outcome === "confirmed").slice(0, 4);
    const no = receipts.filter((r) => r.summary && (r.outcome === "rejected_policy" || r.outcome === "reverted")).slice(0, 4);
    return { paid: ok, blocked: no };
  }, [receipts]);

  useEffect(() => {
    if (off || (paid.length < 2 && blocked.length < 2)) return;
    const id = window.setInterval(() => setN((v) => v + 1), 6500);
    return () => window.clearInterval(id);
  }, [off, paid.length, blocked.length]);

  const a = paid.length ? paid[n % paid.length] : undefined;
  const b = blocked.length ? blocked[(n + 1) % blocked.length] : undefined;
  if (!a && !b) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 hidden lg:block" aria-hidden="true">
      {a ? <Card label="Latest payment" receipt={a} tone="paid" className="top-[9%] left-0" /> : null}
      {b ? <Card label="Latest attack stopped" receipt={b} tone="blocked" className="right-0 bottom-[9%]" /> : null}
    </div>
  );
}
