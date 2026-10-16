"use client";

import { useMemo, useRef, useState } from "react";
import { cn, f3, RingGlyph, SampleDataChip, shortHash } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import { SITE } from "@/content/site-data";
import { SectionHead } from "./sections";
import { useInView } from "./use-live";

/**
 * Same rules, two chains. The 13 YINGLONG caveat enforcers are deployed on Base Sepolia (public
 * testnet) and on FISCO BCOS (the team-run consortium ledger). Each ring draws one sector per
 * enforcer and eight ticks per sector, one per nibble of that enforcer's runtime code hash (the
 * Hash Ring grammar, docs/HASH_RING.md): identical bytecode draws identical rings. Each ring turns
 * into place once when the section enters the viewport (transform and opacity of the whole SVG, on
 * the compositor; animating 208 tick strokes repainted every frame and dropped frames).
 *
 * Sources: both deployment files, copied at build time (scripts/site-data.mjs). FISCO hashes are
 * re-checked in the browser against GET /v1/evidence, whose contracts the service re-reads from
 * the ledger (keccak256 of eth_getCode); Base Sepolia hashes are re-checked the same way when the
 * service lists them.
 */

const SECTORS = 13;
const PER = 8;
const R0 = 0.66;

type Row = {
  name: string;
  base: string | null;
  fisco: string | null;
  equal: boolean;
  liveBase: boolean;
  liveFisco: boolean;
};

function tickLengths(hash: string | null): number[] {
  if (!hash) return Array.from({ length: PER }, () => 0);
  const hex = hash.replace(/^0x/, "");
  return Array.from({ length: PER }, (_, k) => 0.05 + (parseInt(hex[k] ?? "0", 16) / 15) * 0.2);
}

function Ring({ rows, ledger, active, onHover, label }: { rows: Row[]; ledger: "base" | "fisco"; active: number | null; onHover: (i: number | null) => void; label: string }) {
  const gap = 0.12; // radians left empty between sectors
  const span = (Math.PI * 2) / SECTORS;
  return (
    <svg viewBox="-1.05 -1.05 2.1 2.1" className="w-full max-w-[420px] overflow-visible" role="img" aria-label={label}>
      <circle r={R0 - 0.035} fill="none" stroke="var(--line-2)" strokeWidth="0.006" />
      {rows.map((row, i) => {
        const lens = tickLengths(ledger === "base" ? row.base : row.fisco);
        const on = active === null || active === i;
        return (
          <g
            key={row.name}
            style={{ ["--i" as string]: i }}
            className={cn("transition-opacity duration-200", on ? "opacity-100" : "opacity-30")}
            onPointerEnter={() => onHover(i)}
            onPointerLeave={() => onHover(null)}
          >
            {lens.map((l, k) => {
              const a = -Math.PI / 2 + i * span + gap / 2 + (k / (PER - 1)) * (span - gap);
              const c = Math.cos(a);
              const s = Math.sin(a);
              return (
                <path
                  key={k}
                  d={`M${f3(R0 * c)} ${f3(R0 * s)}L${f3((R0 + l) * c)} ${f3((R0 + l) * s)}`}
                  stroke={active === i ? "var(--fg-0)" : "var(--chrome-1)"}
                  strokeWidth="0.014"
                  strokeLinecap="round"
                />
              );
            })}
            {/* sector index on the inside */}
            {(() => {
              const a = -Math.PI / 2 + i * span + span / 2;
              return (
                <text x={f3((R0 - 0.11) * Math.cos(a))} y={f3((R0 - 0.11) * Math.sin(a))} fontSize="0.05" textAnchor="middle" dominantBaseline="middle" fill={active === i ? "var(--fg-0)" : "var(--fg-muted)"} style={{ fontFamily: "var(--font-mono)" }}>
                  {String(i + 1).padStart(2, "0")}
                </text>
              );
            })()}
          </g>
        );
      })}
      {/* the pearl: the ledger itself (steel on the public chain) */}
      <circle cx="0" cy={f3(-R0 + 0.035)} r="0.026" fill={ledger === "base" ? "var(--steel)" : "var(--fg-1)"} />
    </svg>
  );
}

export function TwinChains() {
  const root = useRef<HTMLDivElement>(null);
  const drawn = useInView(root);
  const [active, setActive] = useState<number | null>(null);
  const ev = useAgent("evidence", (api) => api.evidence(), ["evidence"]);

  const rows: Row[] = useMemo(() => {
    const live = ev.data?.contracts ?? [];
    const liveHash = (ledger: string, name: string) => live.find((c) => c.ledger === ledger && c.name === name)?.codeHash?.toLowerCase() ?? null;
    return (SITE.twin?.enforcers ?? []).map((e) => {
      const lb = liveHash("base-sepolia", e.name);
      const lf = liveHash("fisco", e.name);
      const base = (lb ?? e.base?.codeHash ?? null)?.toLowerCase() ?? null;
      const fisco = (lf ?? e.fisco?.codeHash ?? null)?.toLowerCase() ?? null;
      return { name: e.name, base, fisco, equal: Boolean(base && fisco && base === fisco), liveBase: Boolean(lb), liveFisco: Boolean(lf) };
    });
  }, [ev.data]);

  if (!rows.length) return null;
  const equal = rows.filter((r) => r.equal).length;
  const liveFisco = rows.filter((r) => r.liveFisco).length;
  const liveBase = rows.filter((r) => r.liveBase).length;
  const enforcerDocs = SITE.enforcerDocs?.enforcers ?? {};
  const shown = active === null ? null : rows[active];

  return (
    <section aria-labelledby="twin-title" className="yl-section yl-defer">
      <div className="yl-container">
        <SectionHead
          index="05"
          eyebrow="Same rules, two chains"
          id="twin-title"
          title="One mandate, enforced by the same bytecode on a public chain and a consortium chain"
          lead="Each ring draws the runtime code hash of the thirteen YINGLONG enforcers, eight ticks per enforcer. The rings match because the code does."
        >
          {isSample ? (
            <div className="mt-2">
              <SampleDataChip />
            </div>
          ) : null}
        </SectionHead>

        <div ref={root} data-drawn={drawn ? "true" : "false"} className="mt-12 grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
          <figure className="m-0 grid grid-cols-2 items-center gap-3 sm:gap-8 lg:col-span-7">
            <div className="grid justify-items-center gap-4">
              <div className="yl-ring-in w-full max-w-[420px]" style={{ ["--d" as string]: "0ms" }}>
                <Ring rows={rows} ledger="base" active={active} onHover={setActive} label={`Base Sepolia: code hashes of ${rows.length} enforcers`} />
              </div>
              <figcaption className="grid justify-items-center gap-0.5 text-center">
                <span className="text-13 font-medium text-fg-0">Base Sepolia</span>
                <span className="text-11 text-fg-muted">public testnet, chain 84532</span>
              </figcaption>
            </div>
            <div className="grid justify-items-center gap-4">
              <div className="yl-ring-in w-full max-w-[420px]" style={{ ["--d" as string]: "140ms" }}>
                <Ring rows={rows} ledger="fisco" active={active} onHover={setActive} label={`FISCO BCOS: code hashes of ${rows.length} enforcers`} />
              </div>
              <figcaption className="grid justify-items-center gap-0.5 text-center">
                <span className="text-13 font-medium text-fg-0">FISCO BCOS</span>
                <span className="text-11 text-fg-muted">team-run consortium ledger</span>
              </figcaption>
            </div>
          </figure>

          <div className="grid content-start gap-6 lg:col-span-5">
            <p className="m-0 flex items-baseline gap-3">
              <span className="font-mono text-[3.5rem] leading-none text-fg-0">
                {equal}
                <span className="text-fg-muted">/{rows.length}</span>
              </span>
              <span className="text-15 text-fg-2">enforcers with identical runtime bytecode</span>
            </p>
            <div className="min-h-[4.5rem] border-l border-line-2 pl-4 text-13" aria-live="polite">
              {shown ? (
                <>
                  <p className="m-0 font-mono text-fg-0">{shown.name}</p>
                  <p className="m-0 mt-1 text-fg-2">{enforcerDocs[shown.name]?.rule ?? ""}</p>
                  <p className="m-0 mt-1 font-mono text-11 text-fg-muted">{shortHash(shown.base ?? "", 10, 8)}</p>
                </>
              ) : (
                <p className="m-0 text-fg-muted">Point at a sector or a row to compare one enforcer on both ledgers.</p>
              )}
            </div>
            <ol className="m-0 grid list-none grid-cols-1 gap-0 border-t border-line-1 p-0 sm:grid-cols-2">
              {rows.map((r, i) => (
                <li key={r.name} className="border-b border-line-1">
                  <button
                    type="button"
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className={cn("flex w-full min-w-0 items-center gap-2.5 py-2 pr-2 text-left text-12", active === i ? "text-fg-0" : "text-fg-2")}
                    aria-label={`${r.name}: ${r.equal ? "identical code hash on both ledgers" : "code hashes differ"}`}
                  >
                    <span className="kicker w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 truncate">{r.name.replace(/Enforcer$/, "")}</span>
                    <RingGlyph state={r.equal ? "verified" : "unknown"} size={16} />
                  </button>
                </li>
              ))}
            </ol>
            <p className="m-0 text-12 leading-relaxed text-fg-muted">
              Code hashes from the deployment files at build time
              {liveFisco ? `; ${liveFisco} FISCO BCOS hashes re-read live from the ledger by GET /v1/evidence` : ""}
              {liveBase ? `, ${liveBase} Base Sepolia hashes too` : ""}. Across every contract both deployments list, {SITE.twin?.allContracts.equal} of{" "}
              {SITE.twin?.allContracts.compared} are identical; the ones that differ are framework and verifier contracts (
              {SITE.twin?.allContracts.differ.join(", ")}).
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
