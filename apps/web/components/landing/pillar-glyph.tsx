import { f3 } from "@yinglong/ui";
import type { Pillar } from "@/content/pillars";

/** One monoline glyph per pillar, on the ring grammar (24-unit box, currentColor, 1.4 stroke). */
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function PillarGlyph({ id, size = 28 }: { id: Pillar["id"]; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="shrink-0">
      {id === "pearl" ? (
        <>
          <circle cx="12" cy="12" r="8.5" {...S} />
          <circle cx="19.4" cy="7.75" r="2.2" fill="var(--steel)" />
        </>
      ) : null}
      {id === "seal" ? (
        <>
          <circle cx="12" cy="12" r="5.5" {...S} />
          {Array.from({ length: 16 }, (_, i) => {
            const a = ((-90 + i * 22.5) * Math.PI) / 180;
            const l = [1.6, 2.6, 1.2, 2.2][i % 4]!;
            return <path key={i} d={`M${f3(12 + 7.3 * Math.cos(a))} ${f3(12 + 7.3 * Math.sin(a))}L${f3(12 + (7.3 + l) * Math.cos(a))} ${f3(12 + (7.3 + l) * Math.sin(a))}`} {...S} strokeWidth={1.1} />;
          })}
        </>
      ) : null}
      {id === "scales" ? (
        <>
          <circle cx="12" cy="12" r="8.5" {...S} />
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M${f3(7 + i * 1.25)} 9.5v5`} {...S} strokeWidth={1} opacity={i === 6 ? 1 : 0.55} />
          ))}
        </>
      ) : null}
      {id === "vein" ? (
        <>
          <circle cx="7" cy="12" r="3.6" {...S} />
          <circle cx="17" cy="12" r="3.6" {...S} />
          <path d="M10.6 12h2.8" {...S} />
          <circle cx="19.6" cy="9.4" r="1.2" fill="var(--steel)" />
        </>
      ) : null}
      {id === "gate" ? (
        <>
          <path d="M11 3.6a8.5 8.5 0 0 0 0 16.8" {...S} />
          <path d="M13 3.6a8.5 8.5 0 0 1 0 16.8" {...S} />
          <path d="M12 2v20" {...S} strokeDasharray="1.4 1.8" />
        </>
      ) : null}
    </svg>
  );
}
