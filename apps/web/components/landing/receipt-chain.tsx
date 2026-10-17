"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn, LabelChip, RingGlyph, SampleDataChip, shortHash } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import { useMotionOff } from "@/components/preferences";
import { useCan3D } from "@/components/three/support";
import { Scramble } from "@/components/fx/scramble";
import { ThemedImg } from "@/components/fx/themed-img";
import { SectionHead } from "./sections";
import { receiptState } from "./receipt-state";
import { useInView } from "./use-live";

const LiquidMesh = dynamic(() => import("@/components/fx/water-backdrop").then((m) => m.LiquidMesh), { ssr: false, loading: () => null });

/**
 * The receipt chain. Every receipt carries the fingerprint of the one before it (prevReceiptHash), so
 * changing any old receipt breaks every link after it. The strip shows the newest blocks, and every
 * few seconds the next real receipt is sealed onto the end: its hash decodes, a bar fills, and a pulse
 * runs along the link. The blocks are real receipts from GET /v1/receipts (labelled sample data in
 * the fixtures build). `compact` is the version used at the top of the Proof page.
 */
export function ReceiptChain({ compact = false }: { compact?: boolean }) {
  const q = useAgent("hero-receipts", (api) => api.receipts({ limit: 200 }), ["receipts"]);
  const off = useMotionOff();
  const can3D = useCan3D(off);
  const root = useRef<HTMLElement>(null);
  const inView = useInView(root, { once: false, margin: "120px 0px 120px 0px" });
  const WINDOW = compact ? 3 : 5;
  // oldest to newest: the chain grows to the right
  const items = useMemo(() => (q.data?.items ?? []).slice(0, 30).reverse(), [q.data]);
  const [n, setN] = useState(WINDOW);

  useEffect(() => {
    if (off || !inView || items.length <= WINDOW) return;
    const id = window.setInterval(() => setN((v) => (v >= items.length ? WINDOW : v + 1)), 4200);
    return () => window.clearInterval(id);
  }, [off, inView, items.length, WINDOW]);

  const end = Math.min(Math.max(n, WINDOW), items.length);
  const shown = items.slice(Math.max(0, end - WINDOW), end).map((r, k) => ({ r, index: Math.max(0, end - WINDOW) + k }));
  if (items.length < 3) return null;

  const list = (
    <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_14%)]">
      <ol className="m-0 flex list-none items-stretch justify-end p-0 py-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {shown.map(({ r, index }, k) => {
            const s = receiptState(r.outcome);
            const newest = k === shown.length - 1;
            return (
              <motion.li
                key={r.receiptId}
                layout={!off}
                initial={off ? false : { opacity: 0, x: -48, scale: 0.94 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={off ? undefined : { opacity: 0, x: 56, scale: 0.94 }}
                transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
                className="flex items-stretch"
              >
                {k > 0 ? <span aria-hidden="true" className="yl-link" /> : null}
                <article className={cn("yl-card yl-card--glass grid w-[min(70vw,236px)] shrink-0 content-between gap-3 p-4", newest && "border-accent")}>
                  <header className="flex items-center justify-between gap-2">
                    <span className="font-mono text-11 text-fg-muted">Block {index + 1}</span>
                    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-11", s.state === "refused" ? "bg-refused-bg text-refused-fg" : "bg-bg-3 text-fg-1")}>
                      <RingGlyph state={s.state} size={16} />
                      {s.word}
                    </span>
                  </header>
                  <p className="m-0 line-clamp-2 min-h-[2.6em] text-13 leading-snug text-fg-0">{r.summary}</p>
                  <dl className="m-0 grid gap-1.5 font-mono text-11">
                    <div className="grid gap-0.5">
                      <dt className="text-fg-muted">Its fingerprint</dt>
                      <dd className="m-0 text-accent">{newest ? <Scramble text={shortHash(r.receiptHash ?? r.receiptId, 10, 6)} ms={900} /> : shortHash(r.receiptHash ?? r.receiptId, 10, 6)}</dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="text-fg-muted">Points back to</dt>
                      <dd className="m-0 text-fg-2">{shortHash(r.prevReceiptHash, 10, 6)}</dd>
                    </div>
                  </dl>
                  {newest ? (
                    <span aria-hidden="true" className="block h-0.5 overflow-hidden rounded-pill bg-bg-3">
                      <span key={r.receiptId} className="yl-sealing block h-full bg-accent" />
                    </span>
                  ) : (
                    <span aria-hidden="true" className="block h-0.5 rounded-pill bg-line-2" />
                  )}
                </article>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
  );

  if (compact) {
    return (
      <section ref={root} aria-label="The newest receipts, chained" className="relative">
        {list}
      </section>
    );
  }

  return (
    <section ref={root} aria-labelledby="chain-title" className="yl-defer relative isolate overflow-hidden border-t border-line-1 py-14 sm:py-20">
      {can3D && inView ? (
        <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-35 [mask-image:linear-gradient(to_bottom,transparent,#000_20%,#000_80%,transparent)]">
          <LiquidMesh moving={inView && !off} />
        </div>
      ) : null}
      <div className="yl-container grid gap-10 lg:gap-12">
        <div className="grid items-center gap-8 lg:grid-cols-12">
          <SectionHead
            index="04"
            eyebrow="A log that cannot be edited"
            id="chain-title"
            title="Every action is a link in a chain"
            lead="Each receipt holds the fingerprint of the one before it. Change one old receipt and every link after it breaks. Anyone can check the chain."
            className="lg:col-span-6"
          >
            <div className="mt-2 flex flex-wrap gap-2">
              {isSample ? <SampleDataChip /> : null}
              <LabelChip>Real receipts, newest at the right</LabelChip>
            </div>
          </SectionHead>
          <div className="relative lg:col-span-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <ThemedImg name="chain-glass" alt="Five glass blocks joined in a chain, each one linked to the one before." width={1440} height={720} lazy className="yl-float h-auto w-full" />
          </div>
        </div>
        {list}
      </div>
    </section>
  );
}
