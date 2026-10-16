import type { CSSProperties, ReactNode } from "react";
import { cn } from "@yinglong/ui";
import type { ProofAnomaly, ProofBundle, ProofForecast, ProofIntentModel, ProofSentinel } from "@/lib/api/view";
import { formatTime } from "@/lib/format";
import { Sparkline, TrainingCurve } from "./charts";
import { fixed, intervalText, intl, MonoChip, Note, pct, RateBar, ScrollTable, shortRev, SubHead, Tile } from "./parts";

const LANG: Record<string, string> = { en: "English", bn: "Bangla", zh: "Chinese", mixed: "Mixed" };
const METHOD: Record<string, string> = { chronos2: "Chronos-2", lgbm_quantile: "LightGBM quantile", seasonal_naive: "Seasonal naive" };
const METRIC: Record<string, string> = {
  pinball_loss_cny: "Pinball loss (CNY)",
  scaled_pinball: "Scaled pinball",
  pinball_h1_7_cny: "Days 1 to 7 (CNY)",
  pinball_h8_28_cny: "Days 8 to 28 (CNY)",
  coverage90_raw: "90% band coverage",
  coverage90_cqr: "Coverage, calibrated",
  brier_breach14_raw: "Brier, breach in 14 d",
  brier_breach14_isotonic: "Brier, calibrated",
};

/** "How good is the AI safety model?": every number copied from the result files the training runs wrote. */
export function MlSection({ ml, sources }: { ml: ProofBundle["ml"]; sources: ProofBundle["sources"] }) {
  if (!ml) return <Note>This server build does not carry the ML results yet.</Note>;
  return (
    <div className="grid gap-10">
      {ml.sentinel ? <SentinelBlock s={ml.sentinel} /> : <Note>No sentinel results in this build.</Note>}
      <CurvesBlock s={ml.sentinel} intent={ml.intent} />
      {ml.intent.length ? <IntentBlock models={ml.intent} /> : null}
      {ml.anomaly ? <AnomalyBlock a={ml.anomaly} /> : null}
      {ml.forecast ? <ForecastBlock f={ml.forecast} /> : null}
      {sources.results.length ? <SourcesBlock sources={sources} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ sentinel */

function SentinelBlock({ s }: { s: ProofSentinel }) {
  const t = s.test;
  return (
    <div className="grid gap-5">
      <SubHead title="Does it catch injected instructions?" note={t?.n ? `Held-out test set, n = ${intl(t.n)} (${intl(t.positives)} attacks, ${intl(t.negatives)} normal)` : undefined} />
      <p className="m-0 max-w-[64ch] text-13 text-fg-2">
        The sentinel reads every request before any rule runs and flags text that tries to change the agent&apos;s instructions. Bars run from 50% to 100%; the jade band is the 95% interval.
      </p>
      {t ? (
        <div className="grid gap-5 sm:grid-cols-3">
          <Tile label="Macro-F1" value={pct(t.macroF1.value)} rate={t.macroF1} sub={`95%: ${intervalText(t.macroF1.interval)}`} />
          <Tile label="Attacks caught (recall)" value={pct(t.recall.value)} rate={t.recall} sub={`95%: ${intervalText(t.recall.interval)}`} />
          <Tile label="Normal requests let through (specificity)" value={pct(t.specificity.value)} rate={t.specificity} sub={`95%: ${intervalText(t.specificity.interval)}`} />
        </div>
      ) : (
        <Note>No overall test numbers in the result file.</Note>
      )}
      <ModelLine s={s} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {s.confusion ? <Confusion s={s} /> : null}
        {s.perLanguage.length ? <PerLanguage rows={s.perLanguage} /> : null}
      </div>
    </div>
  );
}

function ModelLine({ s }: { s: ProofSentinel }) {
  const tr = s.training;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-12 text-fg-muted">
      {s.model ? (
        <span className="inline-flex items-center gap-1.5">
          Model <MonoChip title={s.revision ?? undefined}>{s.model}{s.revision ? `@${shortRev(s.revision)}` : ""}</MonoChip>
        </span>
      ) : null}
      {tr?.base ? (
        <span>
          fine-tuned from <span className="font-mono text-fg-2">{tr.base}</span>
        </span>
      ) : null}
      {tr?.trainRows ? <span>{intl(tr.trainRows)} training rows</span> : null}
      {tr?.epochs ? <span>{tr.epochs} epochs</span> : null}
      {tr?.trainSeconds ? <span>{Math.round(tr.trainSeconds / 60)} min of training</span> : null}
      {s.threshold !== null ? (
        <span>
          decision threshold <span className="font-mono text-fg-2">{s.threshold}</span>
        </span>
      ) : null}
      {s.served?.int8Sha256 ? (
        <span>
          served file{s.served.quantization ? ` (${s.served.quantization.split(" (")[0]}` : ""}
          {s.served.int8Mb ? `${s.served.quantization ? ", " : " ("}${Math.round(s.served.int8Mb)} MB` : ""}
          {s.served.quantization || s.served.int8Mb ? ")" : ""} SHA-256{" "}
          <span className="font-mono text-fg-2" title={s.served.int8Sha256}>
            {s.served.int8Sha256.slice(0, 12)}&hellip;
          </span>
        </span>
      ) : null}
    </div>
  );
}

function Confusion({ s }: { s: ProofSentinel }) {
  const c = s.confusion!;
  const pos = c.tp + c.fn;
  const neg = c.fp + c.tn;
  const cell = (n: number, of: number, good: boolean, what: string) => (
    <td className={cn("rounded-[4px] p-3 align-top", good ? "bg-jade-tint" : "bg-bg-2")}>
      <span className="block font-mono text-22 leading-none text-fg-0 tabular-nums">{intl(n)}</span>
      <span className="mt-1.5 flex items-center gap-1.5 text-11 text-fg-2">
        {good ? <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-pill bg-jade" aria-hidden="true" /> : null}
        {of ? pct(n / of) : "—"} {"·"} {what}
      </span>
    </td>
  );
  return (
    <div className="grid content-start gap-2">
      <SubHead as="h4" title="Where it was right and wrong" />
      <table className="w-full border-separate border-spacing-0.5 text-12">
        <thead>
          <tr>
            <td className="p-2" />
            <th scope="col" className="p-2 text-left font-medium text-fg-muted">
              Flagged
            </th>
            <th scope="col" className="p-2 text-left font-medium text-fg-muted">
              Not flagged
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="p-2 text-left align-top font-medium text-fg-2">
              Was an attack
            </th>
            {cell(c.tp, pos, true, "caught")}
            {cell(c.fn, pos, false, "missed")}
          </tr>
          <tr>
            <th scope="row" className="p-2 text-left align-top font-medium text-fg-2">
              Was normal
            </th>
            {cell(c.fp, neg, false, "wrongly flagged")}
            {cell(c.tn, neg, true, "let through")}
          </tr>
        </tbody>
      </table>
      <Note>{c.derivedFrom ? `Counts are derived from the published rates (${c.derivedFrom}).` : "Counts are derived from recall and specificity."}</Note>
    </div>
  );
}

function PerLanguage({ rows }: { rows: ProofSentinel["perLanguage"] }) {
  return (
    <div className="grid content-start gap-2">
      <SubHead as="h4" title="By language" />
      <ScrollTable label="Sentinel results by language (scrolls sideways on small screens)" minWidth={520}>
        <thead>
          <tr>
            <th scope="col">Language</th>
            <th scope="col" className="text-right">
              n
            </th>
            <th scope="col">Macro-F1</th>
            <th scope="col" className="text-right">
              Recall
            </th>
            <th scope="col" className="text-right">
              Specificity
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.language}>
              <td className="text-fg-1">
                {LANG[r.language] ?? r.language} <span className="font-mono text-11 text-fg-muted">{r.language}</span>
              </td>
              <td className="num text-fg-2">{intl(r.n)}</td>
              <td>
                <RateBar rate={r.macroF1} />
              </td>
              <td className="num text-fg-2">{pct(r.recall.value)}</td>
              <td className="num text-fg-2">{pct(r.specificity.value)}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  );
}

/* ------------------------------------------------------------------ training logs */

type Small = { key: string; name: string; kind: string; metric: number | null; metricLabel: string; curves: ProofSentinel["curves"]; loss: number | null };

const lastLoss = (c: ProofSentinel["curves"]): number | null => {
  const pts = c?.points.filter((p) => p.loss !== null) ?? [];
  return pts.length ? pts[pts.length - 1]!.loss : null;
};

function CurvesBlock({ s, intent }: { s: ProofSentinel | null; intent: ProofIntentModel[] }) {
  const main = s?.curves ?? null;
  const smalls: Small[] = [
    ...(s?.arms ?? []).map((a) => ({ key: `arm-${a.arm}`, name: a.curves?.repo ?? a.arm, kind: "sentinel, other size", metric: a.test?.macroF1.value ?? null, metricLabel: "macro-F1", curves: a.curves, loss: lastLoss(a.curves) })),
    ...intent.map((m) => ({ key: `intent-${m.model}`, name: m.hfRepo ?? m.model, kind: "intent model", metric: m.test?.exactMatch.value ?? null, metricLabel: "exact match", curves: m.curves, loss: m.finalTrainLoss ?? lastLoss(m.curves) })),
  ];
  if (!main && !smalls.length) return null;
  return (
    <div className="grid gap-4">
      <SubHead
        title="What training looked like"
        note={
          main?.repo ? (
            <>
              log from <span className="font-mono">{main.repo}{main.revision ? `@${shortRev(main.revision)}` : ""}</span>
              {main.file ? `, ${main.file}` : ""}
            </>
          ) : undefined
        }
      />
      <p className="m-0 max-w-[64ch] text-13 text-fg-2">These are the real training logs saved with each model, not a drawing: loss per step, and the evaluation score at the end of each epoch.</p>
      {main ? <TrainingCurve c={main} label={s?.model ?? "sentinel"} /> : <Note>No training log for the served sentinel.</Note>}
      {smalls.length ? (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {smalls.map((m, i) => (
            <li key={m.key} className="yl-enter grid min-w-0 content-start gap-2 rounded-control border border-line-1 p-3" style={{ "--d": `${i * 50}ms` } as CSSProperties}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-12 text-fg-1" title={m.name}>
                  {m.name}
                </span>
                <span className="shrink-0 text-11 text-fg-muted">{m.kind}</span>
              </div>
              {m.curves ? <Sparkline points={m.curves.points} /> : <div className="flex h-10 items-center text-11 text-fg-muted">no training log published</div>}
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-11 text-fg-muted">
                <span>
                  {m.metricLabel} <span className="font-mono text-fg-0 tabular-nums">{pct(m.metric)}</span>
                </span>
                {m.loss !== null ? (
                  <span>
                    final loss <span className="font-mono text-fg-2 tabular-nums">{fixed(m.loss, 4)}</span>
                  </span>
                ) : null}
                {m.curves ? <span>{m.curves.points.length} points</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ intent */

function IntentBlock({ models }: { models: ProofIntentModel[] }) {
  const n = models.find((m) => m.test?.n)?.test?.n ?? null;
  return (
    <div className="grid gap-4">
      <SubHead title="Does it read the request correctly?" note={n ? `Held-out test set, n = ${intl(n)}` : undefined} />
      <p className="m-0 max-w-[64ch] text-13 text-fg-2">The intent model turns the person&apos;s words into a structured payment request. The fine-tuned sizes below were measured the same way; the rules never trust its output without checking it.</p>
      <ScrollTable label="Intent model results (scrolls sideways on small screens)" minWidth={720}>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Base</th>
            <th scope="col" className="text-right">
              Valid JSON
            </th>
            <th scope="col" className="text-right">
              Exact match
            </th>
            <th scope="col" className="text-right">
              Slot F1
            </th>
            <th scope="col" className="text-right">
              Epochs
            </th>
            <th scope="col" className="text-right">
              Final loss
            </th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.model}>
              <td>
                <span className="font-mono text-12 text-fg-1">{m.model}</span>
                {m.hfRepo ? (
                  <span className="block font-mono text-11 text-fg-muted">
                    {m.hfRepo}
                    {m.revision ? `@${shortRev(m.revision)}` : ""}
                  </span>
                ) : null}
              </td>
              <td className="font-mono text-12 text-fg-2">{m.base ?? "—"}</td>
              <td className="num text-fg-0">
                {pct(m.test?.jsonValidity.value, 2)}
                <span className="block text-11 font-normal text-fg-muted">{intervalText(m.test?.jsonValidity.interval, 2)}</span>
              </td>
              <td className="num text-fg-0">
                {pct(m.test?.exactMatch.value)}
                <span className="block text-11 text-fg-muted">{intervalText(m.test?.exactMatch.interval)}</span>
              </td>
              <td className="num text-fg-2">{pct(m.test?.slotF1)}</td>
              <td className="num text-fg-2">{m.epochs ?? "—"}</td>
              <td className="num text-fg-2">{fixed(m.finalTrainLoss, 4)}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  );
}

/* ------------------------------------------------------------------ anomaly */

function AnomalyBlock({ a }: { a: ProofAnomaly }) {
  const t = a.test;
  return (
    <div className="grid gap-4">
      <SubHead title="Does it notice unusual behaviour?" note={a.model ?? undefined} />
      <p className="m-0 max-w-[64ch] text-13 text-fg-2">
        A separate model watches the pattern of payments rather than the words.{a.escalatesOnly ? " It can only ask the owner, never pay, so a false alarm costs one tap." : ""}
        {a.heldoutFamily ? ` One attack family (${a.heldoutFamily.replace(/_/g, " ")}) was kept out of training to test it on something new.` : ""}
      </p>
      {t ? (
        <div className="grid gap-5 sm:grid-cols-3">
          <Tile label="AUROC (combined model)" value={fixed(t.aurocCombined, 3)} sub={`isolation forest ${fixed(t.aurocIsoforest, 3)} · LightGBM ${fixed(t.aurocLightgbm, 3)}`} />
          <Tile
            label="False alarms on normal actions"
            value={pct(t.falseEscalation.value, 2)}
            rate={t.falseEscalation}
            domain={[0, 0.05]}
            sub={`95%: ${intervalText(t.falseEscalation.interval, 2)}${t.normalActions ? `, n = ${intl(t.normalActions)}` : ""}; bar runs 0 to 5%`}
          />
          <Tile label="Area under precision-recall" value={fixed(t.auprcCombined, 3)} />
        </div>
      ) : null}
      {a.perFamily.length ? (
        <ScrollTable label="Anomaly detection by attack family (scrolls sideways on small screens)" minWidth={600}>
          <thead>
            <tr>
              <th scope="col">Attack family</th>
              <th scope="col" className="text-right">
                n
              </th>
              <th scope="col" className="text-right">
                Caught
              </th>
              <th scope="col">95% interval</th>
              <th scope="col" className="text-right">
                AUROC
              </th>
            </tr>
          </thead>
          <tbody>
            {a.perFamily.map((f) => (
              <tr key={f.family}>
                <td className="text-fg-1">
                  {f.family.replace(/_/g, " ")}
                  {f.heldout ? <span className="ml-2 text-11 text-fg-muted">kept out of training</span> : null}
                </td>
                <td className="num text-fg-2">{intl(f.n)}</td>
                <td className="num text-fg-0">{pct(f.escalationRecall.value)}</td>
                <td className="font-mono text-12 text-fg-muted">{intervalText(f.escalationRecall.interval)}</td>
                <td className="num text-fg-2">{fixed(f.aurocCombined, 3)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ forecast */

function ForecastBlock({ f }: { f: ProofForecast }) {
  const keys = [...new Set(f.methods.flatMap((m) => m.metrics.map((x) => x.key)))];
  const fmt = (key: string, v: number | null): ReactNode => (v === null ? "—" : /cny$/.test(key) ? intl(Math.round(v)) : v.toFixed(3));
  return (
    <div className="grid gap-4">
      <SubHead title="How far off is the cash forecast?" note={f.horizonDays ? `${f.horizonDays}-day horizon${f.breachWindowDays ? `, breach window ${f.breachWindowDays} days` : ""}` : undefined} />
      <p className="m-0 max-w-[64ch] text-13 text-fg-2">Three methods were scored on the same company cash series. Lower pinball loss and Brier score are better; coverage of the 90% band should sit near 0.900.</p>
      <ScrollTable label="Forecast methods (scrolls sideways on small screens)" minWidth={820}>
        <thead>
          <tr>
            <th scope="col">Method</th>
            {keys.map((k) => (
              <th key={k} scope="col" className="text-right">
                {METRIC[k] ?? k.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {f.methods.map((m) => (
            <tr key={m.method}>
              <td className="text-fg-1">{METHOD[m.method] ?? m.method.replace(/_/g, " ")}</td>
              {keys.map((k) => (
                <td key={k} className="num text-fg-2">
                  {fmt(k, m.metrics.find((x) => x.key === k)?.value ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </ScrollTable>
      {f.brierClimatology !== null ? <Note>Brier score of always predicting the historical base rate: {fixed(f.brierClimatology, 4)} (the bar any method must beat).</Note> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ sources */

function SourcesBlock({ sources }: { sources: ProofBundle["sources"] }) {
  return (
    <div className="grid gap-2">
      <SubHead as="h4" title="Copied from these result files" note={sources.resultsGeneratedAt ? `copied ${formatTime(sources.resultsGeneratedAt)} HKT` : undefined} />
      <ul className="m-0 grid list-none gap-0.5 p-0 font-mono text-11 text-fg-muted sm:grid-cols-2">
        {sources.results.map((s) => (
          <li key={s} className="break-all">
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}
