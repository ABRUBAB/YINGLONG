import { LabelChip } from "@yinglong/ui";
import type { ProofBench, ProofBundle } from "@/lib/api/view";
import { formatTime } from "@/lib/format";
import { MonoChip, Note, ScrollTable, shortRev, SubHead, Tile } from "./parts";

const get = (b: ProofBench, key: string): string | null => b.metrics.find((m) => m.key === key)?.value ?? null;

/** "9/44 = 20.5% (Wilson ...)" -> the number first, the explanation after. */
function split(s: string | null): { head: string; rest: string } {
  if (!s) return { head: "—", rest: "" };
  const i = s.indexOf(" (");
  return i > 0 ? { head: s.slice(0, i), rest: s.slice(i + 1) } : { head: s, rest: "" };
}

const USED = new Set(["bench.attacks.n", "bench.oom.count", "bench.oom.upper95", "bench.wmm.rate", "bench.max_at_risk"]);
const numeric = (c: string) => /^[-\d]/.test(c);

/** "Did any attack move money?": the bench report's own strings, the family table as a real table. */
export function BenchSection({ bench }: { bench: ProofBundle["bench"] }) {
  if (!bench) return <Note>This server build does not carry the bench report yet.</Note>;
  const n = get(bench, "bench.attacks.n");
  const oom = get(bench, "bench.oom.count");
  const upper = get(bench, "bench.oom.upper95");
  const wmm = split(get(bench, "bench.wmm.rate"));
  const risk = split(get(bench, "bench.max_at_risk"));
  const others = bench.metrics.filter((m) => !USED.has(m.key));
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-12 text-fg-muted">
        {bench.ledger ? <LabelChip dotted>{bench.ledger}</LabelChip> : null}
        {bench.understanding ? <span>requests read by {bench.understanding}</span> : null}
        {bench.commit ? (
          <span className="inline-flex items-center gap-1.5">
            commit <MonoChip title={bench.commit}>{shortRev(bench.commit)}</MonoChip>
          </span>
        ) : null}
        {bench.generatedAt ? <span>run {formatTime(bench.generatedAt)} HKT</span> : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Tile
          label="Attacks that moved money outside the rules"
          value={
            oom !== null && n !== null ? (
              <>
                {oom} <span className="text-15 text-fg-muted">of {n}</span>
              </>
            ) : (
              "—"
            )
          }
          sub={upper ? `upper bound ${upper}` : undefined}
        />
        <Tile label="Within-mandate manipulation" value={<span className="text-18">{wmm.head}</span>} sub={wmm.rest} />
        <Tile label="Most money at risk in any run" value={<span className="text-15 leading-snug">{risk.head}</span>} sub={risk.rest} />
      </div>

      {bench.familyTable ? (
        <div className="grid gap-2">
          <SubHead title="By attack family" note={`${bench.familyTable.rows.length} families, as written by the bench`} />
          <ScrollTable label="Bench results by attack family (scrolls sideways on small screens)" minWidth={960}>
            <thead>
              <tr>
                {bench.familyTable.head.map((h, i) => (
                  <th key={i} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bench.familyTable.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j === 0 ? "font-mono text-12 text-fg-1" : numeric(c) ? "num text-fg-2" : "text-12 text-fg-2"}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </div>
      ) : null}

      {others.length ? (
        <dl className="m-0 grid gap-3 text-13">
          {others.map((m) => (
            <div key={m.key} className="grid gap-1 border-t border-line-1 pt-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-mono text-12 text-fg-muted">{m.key}</dt>
              <dd className="m-0 min-w-0 text-fg-2">{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
