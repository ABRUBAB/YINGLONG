"use client";

import { useEffect, useState } from "react";
import { cn } from "@yinglong/ui";

type Encode = (typeof import("uqr"))["encode"];
let encoder: Encode | null = null;
let loading: Promise<Encode> | null = null;

/** The QR encoder (uqr) loads on first use, so pages that never show a code do not ship it. */
function loadEncoder(): Promise<Encode> {
  loading ??= import("uqr").then((m) => (encoder = m.encode));
  return loading;
}

/**
 * QR code rendered as one SVG path (generated locally, no network). Error correction H so the orbit
 * glyph can sit in the centre (it covers well under 20 percent of the modules).
 * Until the encoder has loaded, a blank tile of the same size holds the place (same label).
 */
export function Qr({ value, size = 160, label, glyph = true, className }: { value: string; size?: number; label: string; glyph?: boolean; className?: string }) {
  const [encode, setEncode] = useState<Encode | null>(() => encoder);
  useEffect(() => {
    if (encode) return;
    let alive = true;
    loadEncoder().then((e) => alive && setEncode(() => e));
    return () => {
      alive = false;
    };
  }, [encode]);

  const tile = cn("shrink-0 rounded-control bg-[#FAFAF7] text-[#0B0B0A]", className);
  if (!encode) return <svg viewBox="0 0 10 10" width={size} height={size} role="img" aria-label={label} className={tile} />;

  const { data, size: n } = encode(value, { ecc: "H", border: 0 });
  let d = "";
  const c = (n - 1) / 2;
  const hole = glyph ? Math.ceil(n * 0.11) : -1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!data[y]![x]) continue;
      if (glyph && Math.abs(x - c) <= hole && Math.abs(y - c) <= hole) continue;
      d += `M${x} ${y}h1v1h-1z`;
    }
  }
  const g = hole * 2 + 1;
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} width={size} height={size} role="img" aria-label={label} className={tile} shapeRendering="crispEdges">
      <path d={d} fill="currentColor" />
      {glyph ? (
        <g transform={`translate(${c - hole} ${c - hole}) scale(${g / 24})`} shapeRendering="geometricPrecision">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.25" />
          <circle cx="20.7" cy="7" r="2.4" fill="currentColor" />
          <path d="M14.9 8.6 A2.9 2.9 0 1 0 12 12 A2.9 2.9 0 1 1 9.1 15.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      ) : null}
    </svg>
  );
}
