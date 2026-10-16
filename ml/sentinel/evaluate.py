"""M1 sentinel evaluation from prediction files (ids, labels, scores; no text).

Threshold: chosen on the validation split to maximise macro-F1 (reported together with results at 0.5).
Rates (recall, specificity) carry Wilson 95% intervals; macro-F1 carries a 1,000-resample bootstrap 95% interval.
Usage (from ml/): uv run python sentinel/evaluate.py --arm mmbert --preds <predictions.jsonl> [--baseline <preds>]
Writes ml/results/m1_sentinel_<arm>.json
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from intent.metrics import wilson  # noqa: E402

ML = HERE.parent


def load(p):
    return [json.loads(l) for l in Path(p).read_text(encoding="utf-8").splitlines() if l.strip()]


def macro_f1(y, yhat):
    f = []
    for c in (0, 1):
        tp = np.sum((yhat == c) & (y == c)); fp = np.sum((yhat == c) & (y != c)); fn = np.sum((yhat != c) & (y == c))
        f.append(2 * tp / max(1, 2 * tp + fp + fn))
    return float(np.mean(f))


def boot_f1(y, yhat, n=1000, seed=0):
    rng = np.random.default_rng(seed)
    if len(y) == 0:
        return [0.0, 0.0]
    vals = [macro_f1(y[idx], yhat[idx]) for idx in (rng.integers(0, len(y), len(y)) for _ in range(n))]
    return [round(float(np.percentile(vals, 2.5)), 4), round(float(np.percentile(vals, 97.5)), 4)]


def block(rows, thr):
    y = np.array([r["label"] for r in rows]); s = np.array([r["score"] for r in rows]); yhat = (s >= thr).astype(int)
    pos, neg = y == 1, y == 0
    tp, tn = int(np.sum(yhat[pos] == 1)), int(np.sum(yhat[neg] == 0))
    out = {"n": len(rows), "positives": int(pos.sum()), "negatives": int(neg.sum())}
    if pos.any() and neg.any():
        out["macro_f1"] = round(macro_f1(y, yhat), 4)
        out["macro_f1_ci95_bootstrap"] = boot_f1(y, yhat)
    if pos.any():
        out["recall"] = round(tp / pos.sum(), 4); out["recall_ci95"] = wilson(tp, int(pos.sum()))
    if neg.any():
        out["specificity"] = round(tn / neg.sum(), 4); out["specificity_ci95"] = wilson(tn, int(neg.sum()))
    return out


def best_threshold(rows):
    y = np.array([r["label"] for r in rows]); s = np.array([r["score"] for r in rows])
    grid = np.linspace(0.05, 0.95, 91)
    f = [macro_f1(y, (s >= t).astype(int)) for t in grid]
    return float(grid[int(np.argmax(f))])


def report(preds, thr):
    by = collections.defaultdict(list)
    for r in preds:
        by[r["split"]].append(r)
    test = by["test"]
    rep = {"threshold": round(thr, 3)}
    rep["test_overall"] = block(test, thr)
    rep["test_per_language"] = {l: block([r for r in test if r["language"] == l], thr) for l in sorted({r["language"] for r in test})}
    rep["test_per_source"] = {s: block([r for r in test if r["source"] == s], thr) for s in sorted({r["source"] for r in test})}
    fin = [r for r in test if r["source"] == "yl_finance_synth"]
    rep["finance_synth_per_channel"] = {c: block([r for r in fin if r.get("channel") == c], thr) for c in sorted({r.get("channel") for r in fin})}
    rep["finance_synth_per_language"] = {l: block([r for r in fin if r["language"] == l], thr) for l in sorted({r["language"] for r in fin})}
    rep["test_per_kind"] = {k: block([r for r in test if r["kind"] == k], thr) for k in sorted({r["kind"] for r in test}) if sum(r["kind"] == k for r in test) >= 10}
    benign_fin = [r for r in fin if r["label"] == 0] + [r for r in by["bench_legit"]]
    rep["specificity_benign_finance"] = {"synthetic_test": block([r for r in fin if r["label"] == 0], thr), "bench_legit_texts": block(by["bench_legit"], thr),
                                         "combined": block(benign_fin, thr)}
    rep["external_nvidia_ipi"] = block(by["ext_test"], thr)
    bench = by["bench_attack"]
    rel = [r for r in bench if r.get("sentinel_relevant", True)]
    rep["bench_attacks_sentinel_relevant"] = block(rel, thr)
    rep["bench_attacks_per_family"] = {f: block([r for r in bench if r["kind"] == f], thr) for f in sorted({r["kind"] for r in bench})}
    rep["bench_attacks_per_language"] = {l: block([r for r in rel if r["language"] == l], thr) for l in sorted({r["language"] for r in rel})}
    rep["bench_heldout_family"] = block(by["bench_heldout"], thr)
    rep["bench_heldout_plus_bench_legit"] = block(by["bench_heldout"] + by["bench_legit"], thr)
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", required=True)
    ap.add_argument("--preds", required=True)
    ap.add_argument("--meta")
    ap.add_argument("--extra", default="{}")
    a = ap.parse_args()
    preds = load(a.preds)
    val = [r for r in preds if r["split"] == "validation"]
    thr = best_threshold(val) if val else 0.5
    out = {"arm": a.arm, "threshold_selection": "max macro-F1 on validation split" if val else "fixed 0.5",
           "at_selected_threshold": report(preds, thr), "at_0.5": report(preds, 0.5)}
    if a.meta:
        m = json.loads(Path(a.meta).read_text())
        out["training"] = {k: m.get(k) for k in ("base", "fp16", "max_len", "epochs", "batch_size", "lr", "train_rows", "train_secs", "gpu_infer_secs", "best_metric")}
    out.update(json.loads(a.extra))
    (ML / "results").mkdir(exist_ok=True)
    (ML / "results" / f"m1_sentinel_{a.arm}.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    s = out["at_selected_threshold"]
    print(a.arm, "thr", s["threshold"], "test macroF1", s["test_overall"].get("macro_f1"), "spec fin", s["specificity_benign_finance"]["combined"].get("specificity"),
          "heldout recall", s["bench_heldout_family"].get("recall"), "nvidia", s["external_nvidia_ipi"].get("macro_f1"))


if __name__ == "__main__":
    main()
