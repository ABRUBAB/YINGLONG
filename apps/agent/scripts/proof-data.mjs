#!/usr/bin/env node
/**
 * Writes apps/agent/generated/proof-data.json: the ML and bench results the API serves at GET /v1/proof,
 * copied from the files the training and bench runs produced (ml/results/*.json, bench/reports/*.json).
 * Nothing is typed by hand. The agent image does not contain ml/ or bench/, so the copy is committed.
 * Usage: node apps/agent/scripts/proof-data.mjs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => (existsSync(resolve(root, p)) ? JSON.parse(readFileSync(resolve(root, p), "utf8")) : null);
const sources = [];
const src = (p) => {
  const v = read(p);
  if (v) sources.push(p);
  return v;
};

/** Counts from rates: recall x positives and specificity x negatives, rounded to whole items. */
function confusion(t) {
  if (!t?.positives || !t?.negatives) return null;
  const tp = Math.round(t.recall * t.positives);
  const tn = Math.round(t.specificity * t.negatives);
  return { tp, fn: t.positives - tp, tn, fp: t.negatives - tn, derivedFrom: "recall x positives and specificity x negatives, rounded" };
}

function sentinel() {
  const m = src("ml/results/m1_sentinel_mmbert.json");
  if (!m) return null;
  const at = m.at_selected_threshold ?? {};
  return {
    model: m.hf_repo,
    revision: m.hf_revision,
    arm: m.arm,
    threshold: at.threshold,
    test: at.test_overall,
    perLanguage: at.test_per_language,
    confusion: confusion(at.test_overall),
    training: m.training,
    served: src("ml/results/m1_onnx_yl-sentinel-mmbert-base.json"),
    arms: ["m1_sentinel_mdeberta.json", "m1_sentinel_mmbert_small.json", "m1_sentinel_protectai_v2.json"]
      .map((f) => [f, src(`ml/results/${f}`)])
      .filter(([, v]) => v)
      .map(([f, v]) => ({ file: f, arm: v.arm ?? v.model ?? f, test: v.at_selected_threshold?.test_overall ?? v.test_overall ?? null })),
    curves: null,
    curvesNote: "Per-step training curves were not saved with these results; only final metrics with 95% intervals.",
  };
}

function intent() {
  return readdirSync(resolve(root, "ml/results"))
    .filter((f) => /^m4_intent_.*\.json$/.test(f))
    .map((f) => {
      const m = src(`ml/results/${f}`);
      return { model: m.model, base: m.base, hfRepo: m.hf_repo, revision: m.hf_revision, trainRows: m.train_rows, trainSeconds: m.train_runtime_secs, finalTrainLoss: m.final_train_loss, epochs: m.epochs, test: m.test?.overall ?? null };
    });
}

function anomaly() {
  const m = src("ml/results/m3_anomaly.json");
  return m ? { model: m.model, escalatesOnly: m.escalates_only, heldoutFamily: m.heldout_family, test: m.test_overall, perFamily: m.test_per_family } : null;
}

function forecast() {
  const m = src("ml/results/m5_forecast.json");
  return m ? { model: m.model, horizonDays: m.horizon_days, breachWindowDays: m.breach_window_days, quantiles: m.quantiles, methods: m.methods, brierClimatology: m.brier_climatology } : null;
}

function bench() {
  const s = src("bench/reports/summary.json");
  if (!s) return null;
  return { generatedAt: s.generatedAt, commit: s.configuration?.commit, ledger: s.configuration?.ledger?.badge, understanding: s.configuration?.understanding, metrics: s.metrics, detail: s.detail };
}

const out = {
  schema: "yinglong.proof-data/1",
  generatedAt: new Date().toISOString(),
  ml: { sentinel: sentinel(), intent: intent(), anomaly: anomaly(), forecast: forecast() },
  bench: bench(),
  sources,
};
const file = resolve(root, "apps/agent/generated/proof-data.json");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`proof-data: wrote ${file} from ${sources.length} files`);
