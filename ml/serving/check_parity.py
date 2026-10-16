"""Parity check: the deployed /sentinel path (ONNX int8 + tokenizers) vs the evaluation predictions made on Kaggle (PyTorch fp16).
Reads private held-out texts locally (nothing printed) and writes counts only to ml/results/serving_parity.json.
Run from ml/serving after fetch_models.py:  uv run python check_parity.py <private test.jsonl> <predictions.jsonl>
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import app as service


def main():
    test = {}
    for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        test[r["id"]] = r
    preds = [json.loads(l) for l in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if l.strip()]
    preds = [p for p in preds if p["split"] == "test" and p["id"] in test][:500]
    s = service.Sentinel()
    agree, diffs, t0 = 0, [], time.time()
    for p in preds:
        sc = s.score(test[p["id"]]["text"])
        agree += (sc >= s.threshold) == (p["score"] >= s.threshold)
        diffs.append(abs(sc - p["score"]))
    out = {"rows": len(preds), "threshold": s.threshold, "label_agreement": round(agree / len(preds), 4),
           "mean_abs_score_diff": round(sum(diffs) / len(diffs), 5), "mean_ms_per_call": round(1000 * (time.time() - t0) / len(preds), 1),
           "model": s.model_id, "model_sha": s.sha}
    Path(__file__).resolve().parents[1].joinpath("results", "serving_parity.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
