/**
 * GET /v1/proof on the wire (./types WireProofBundle) to the view model (./view ProofBundle). Pure functions,
 * shared by the live adapter and the sample-data adapter. Nothing here invents a value: a field the
 * server did not send stays null and the page says so.
 */
import type { WireProofBundle, WireSentinelTest } from "./types";
import { Tier, type Ledger, type ProofBundle, type ProofClassifierTest, type ProofContractPair, type ProofCurves, type ProofRate } from "./view";

const LEDGER_OF: Record<string, Ledger> = { fisco: "fisco", "base-sepolia": "base-sepolia", anvil: "anvil-bench", "anvil-bench": "anvil-bench" };

export const toLedger = (s: string | null | undefined): Ledger | null => (s ? (LEDGER_OF[s] ?? null) : null);

/** The custom YINGLONG rule contracts (caveat enforcers) are the ones named *Enforcer. */
export const isEnforcer = (name: string): boolean => /Enforcer$/.test(name);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const iso = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const rate = (value: number | null | undefined, interval: [number, number] | null | undefined): ProofRate => ({ value: value ?? null, interval: interval ?? null });

function classifierTest(t: WireSentinelTest | null | undefined): ProofClassifierTest | null {
  if (!t) return null;
  return {
    n: t.n ?? null,
    positives: t.positives ?? null,
    negatives: t.negatives ?? null,
    macroF1: rate(t.macro_f1, t.macro_f1_ci95_bootstrap),
    recall: rate(t.recall, t.recall_ci95),
    specificity: rate(t.specificity, t.specificity_ci95),
  };
}

type WireCurves = NonNullable<NonNullable<WireProofBundle["ml"]>["sentinel"]>["curves"];

function curves(c: WireCurves): ProofCurves | null {
  if (!c) return null;
  const points = (c.points ?? [])
    .filter((p): p is typeof p & { step: number } => typeof p.step === "number")
    .map((p) => ({ step: p.step, epoch: p.epoch ?? null, loss: p.loss ?? null, evalLoss: p.eval_loss ?? null, evalMacroF1: p.eval_macro_f1 ?? null }))
    .sort((a, b) => a.step - b.step);
  if (!points.length) return null;
  return { repo: c.repo ?? null, revision: c.revision ?? null, file: c.file ?? null, points };
}

/**
 * A GitHub-flavoured Markdown table (the bench writes one) as head and rows. Backticks are dropped;
 * the separator row (|---|) is skipped. Null when the text holds no table.
 */
export function parseMarkdownTable(md: string | null | undefined): { head: string[]; rows: string[][] } | null {
  if (!md) return null;
  const lines = md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  if (lines.length < 2) return null;
  const cells = (l: string) =>
    l
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim().replace(/`/g, ""));
  const head = cells(lines[0]!);
  const rows = lines
    .slice(1)
    .filter((l) => !/^\|\s*:?-{2,}/.test(l))
    .map(cells)
    .filter((r) => r.some((c) => c.length > 0));
  return head.length ? { head, rows } : null;
}

function pairs(ledgers: ProofBundle["chain"]["ledgers"]): ProofContractPair[] {
  const byName = new Map<string, ProofContractPair["on"]>();
  for (const l of ledgers) {
    for (const c of l.contracts) byName.set(c.name, [...(byName.get(c.name) ?? []), { ledger: l.ledger, address: c.address, codeHash: c.codeHash, explorerUrl: c.explorerUrl }]);
  }
  return [...byName.entries()]
    .map(([name, on]) => ({
      name,
      enforcer: isEnforcer(name),
      identical: on.length > 1 ? on.every((x) => x.codeHash.toLowerCase() === on[0]!.codeHash.toLowerCase()) : null,
      on,
    }))
    .sort((a, b) => Number(b.enforcer) - Number(a.enforcer) || a.name.localeCompare(b.name));
}

/** `root` is the API origin (audit links become absolute) or "fixtures" (no audit links: sample data). */
export function mapProof(w: WireProofBundle, root: string): ProofBundle {
  const absolute = (path: string | null | undefined): string | null => (path && /^https?:\/\//.test(root) ? `${root}${path}` : null);

  const ledgers = (w.chain?.ledgers ?? []).flatMap((l) => {
    const ledger = toLedger(l.ledger);
    if (!ledger) return [];
    const contracts = (l.contracts ?? [])
      .flatMap((c) => (c.name && c.address && c.codeHash ? [{ name: c.name, address: c.address, codeHash: c.codeHash, explorerUrl: c.explorerUrl ?? null, enforcer: isEnforcer(c.name) }] : []))
      .sort((a, b) => Number(b.enforcer) - Number(a.enforcer) || a.name.localeCompare(b.name));
    return [{ ledger, label: l.label ?? l.ledger ?? ledger, chainId: l.chainId ?? null, deployed: l.deployed ?? contracts.length > 0, contracts }];
  });

  const bytecode = w.chain?.bytecode
    ? { compared: w.chain.bytecode.compared ?? 0, identical: w.chain.bytecode.identical ?? 0, differ: [...(w.chain.bytecode.differ ?? [])].sort() }
    : null;

  const counts = Object.entries(w.transactions?.counts ?? {}).flatMap(([l, byOutcome]) => {
    const ledger = toLedger(l);
    if (!ledger || !byOutcome) return [];
    const outcomes = Object.entries(byOutcome)
      .map(([outcome, n]) => ({ outcome, n }))
      .sort((a, b) => b.n - a.n || a.outcome.localeCompare(b.outcome));
    return [{ ledger, total: outcomes.reduce((s, o) => s + o.n, 0), outcomes }];
  });

  const latest = (w.transactions?.latest ?? []).flatMap((t) => {
    const ledger = toLedger(t.ledger);
    if (!ledger) return [];
    const tier = Tier.safeParse(t.tier);
    return [
      {
        receiptId: t.receiptId ?? null,
        ledger,
        outcome: t.outcome ?? "unknown",
        tier: tier.success ? tier.data : null,
        title: t.title ?? "",
        txHash: t.txHash ?? null,
        explorerUrl: t.explorerUrl ?? null,
        revertError: t.revertError ?? null,
        at: iso(t.at),
        auditUrl: absolute(t.auditUrl),
      },
    ];
  });

  const s = w.ml?.sentinel;
  const sentinel = s
    ? {
        model: s.model ?? null,
        revision: s.revision ?? null,
        arm: s.arm ?? null,
        threshold: s.threshold ?? null,
        test: classifierTest(s.test),
        perLanguage: Object.entries(s.perLanguage ?? {})
          .flatMap(([language, t]) => {
            const m = classifierTest(t);
            return m ? [{ language, ...m }] : [];
          })
          .sort((a, b) => (b.n ?? 0) - (a.n ?? 0)),
        confusion:
          s.confusion && [s.confusion.tp, s.confusion.fn, s.confusion.tn, s.confusion.fp].every((v) => typeof v === "number")
            ? { tp: s.confusion.tp!, fn: s.confusion.fn!, tn: s.confusion.tn!, fp: s.confusion.fp!, derivedFrom: s.confusion.derivedFrom ?? null }
            : null,
        training: s.training
          ? { base: str(s.training.base), epochs: num(s.training.epochs), trainRows: num(s.training.train_rows), trainSeconds: num(s.training.train_secs), bestMetric: num(s.training.best_metric) }
          : null,
        served: s.served
          ? {
              quantization: str(s.served.quantization),
              int8Sha256: str(s.served.int8_sha256),
              int8Mb: num(s.served.int8_onnx_mb),
              fp32Sha256: str(s.served.fp32_sha256),
              fp32Mb: num(s.served.fp32_onnx_mb),
            }
          : null,
        arms: (s.arms ?? []).map((a) => ({ arm: a.arm ?? a.file ?? "arm", test: classifierTest(a.test), curves: curves(a.curves) })),
        curves: curves(s.curves),
      }
    : null;

  const intent = (w.ml?.intent ?? []).map((m) => ({
    model: m.model ?? m.hfRepo ?? "model",
    base: m.base ?? null,
    hfRepo: m.hfRepo ?? null,
    revision: m.revision ?? null,
    epochs: m.epochs ?? null,
    finalTrainLoss: m.finalTrainLoss ?? null,
    trainRows: m.trainRows ?? null,
    trainSeconds: m.trainSeconds ?? null,
    test: m.test
      ? {
          n: m.test.n ?? null,
          jsonValidity: rate(m.test.json_validity, m.test.json_validity_ci95),
          exactMatch: rate(m.test.exact_match, m.test.exact_match_ci95),
          slotF1: m.test.slot_f1 ?? null,
          slotPrecision: m.test.slot_precision ?? null,
          slotRecall: m.test.slot_recall ?? null,
        }
      : null,
    curves: curves(m.curves),
  }));

  const a = w.ml?.anomaly;
  const anomaly = a
    ? {
        model: a.model ?? null,
        escalatesOnly: a.escalatesOnly ?? null,
        heldoutFamily: a.heldoutFamily ?? null,
        test: a.test
          ? {
              aurocCombined: a.test.auroc_combined ?? null,
              aurocIsoforest: a.test.auroc_isoforest ?? null,
              aurocLightgbm: a.test.auroc_lightgbm ?? null,
              auprcCombined: a.test.auprc_combined ?? null,
              falseEscalation: rate(a.test.false_escalation_rate, a.test.false_escalation_ci95),
              normalActions: a.test.normal_actions ?? null,
            }
          : null,
        perFamily: Object.entries(a.perFamily ?? {})
          .flatMap(([family, f]) => (f ? [{ family, n: f.n ?? null, escalationRecall: rate(f.escalation_recall, f.recall_ci95), aurocCombined: f.auroc_combined ?? null, heldout: f.heldout ?? false }] : []))
          .sort((x, y) => (y.n ?? 0) - (x.n ?? 0)),
      }
    : null;

  const f = w.ml?.forecast;
  const forecast = f
    ? {
        model: f.model ?? null,
        horizonDays: f.horizonDays ?? null,
        breachWindowDays: f.breachWindowDays ?? null,
        methods: Object.entries(f.methods ?? {}).map(([method, m]) => ({ method, metrics: Object.entries(m ?? {}).map(([key, value]) => ({ key, value: value ?? null })) })),
        brierClimatology: f.brierClimatology ?? null,
      }
    : null;

  const b = w.bench;
  const bench = b
    ? {
        generatedAt: iso(b.generatedAt),
        commit: b.commit ?? null,
        ledger: b.ledger ?? null,
        understanding: b.understanding ?? null,
        metrics: Object.entries(b.metrics ?? {}).flatMap(([key, v]) => (v === null || v === undefined || key === "bench.family_table" ? [] : [{ key, value: String(v) }])),
        familyTable: parseMarkdownTable(typeof b.metrics?.["bench.family_table"] === "string" ? b.metrics["bench.family_table"] : null),
      }
    : null;

  return {
    generatedAt: iso(w.generatedAt),
    build: { repo: w.build?.repo ?? null, commit: w.build?.commit ?? null, commitUrl: w.build?.commitUrl ?? null },
    service: { startedAt: iso(w.service?.startedAt), uptimeSeconds: w.service?.uptimeSeconds ?? null },
    chain: { ledgers, bytecode, pairs: pairs(ledgers) },
    transactions: { counts, latest },
    ml: w.ml ? { sentinel, intent, anomaly, forecast } : null,
    bench,
    sources: { results: w.sources?.results ?? [], resultsGeneratedAt: iso(w.sources?.resultsGeneratedAt) },
  };
}
