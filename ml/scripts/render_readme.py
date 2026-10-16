"""Fill the generated blocks of ml/README.md and ml/MODELS.md from ml/results/*.json (no hand-typed numbers).

Blocks look like  <!-- BEGIN:name --> ... <!-- END:name -->  and are replaced in place.
Run (repo root): uv run --project ml python ml/scripts/render_readme.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
RES = ML / "results"
REPO = ML.parent


def load(name):
    p = RES / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def pct(x):
    return "-" if x is None else f"{100 * x:.1f}%"


def ci(c):
    return "" if not c else f" [{100 * c[0]:.1f}, {100 * c[1]:.1f}]"


def f3(x):
    return "-" if x is None else f"{x:.3f}"


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def blk(b, key="macro_f1"):
    if not b:
        return "-"
    if key == "macro_f1":
        return f"{f3(b.get('macro_f1'))}{'' if not b.get('macro_f1_ci95_bootstrap') else ' [' + f3(b['macro_f1_ci95_bootstrap'][0]) + ', ' + f3(b['macro_f1_ci95_bootstrap'][1]) + ']'}"
    return pct(b.get(key)) + ci(b.get(key + "_ci95"))


def m1_block():
    arms = [(a, load(f"m1_sentinel_{a}.json")) for a in ("mmbert", "mmbert_small", "mdeberta", "protectai_v2")]
    arms = [(a, r) for a, r in arms if r]
    if not arms:
        return "_M1 results not yet available._"
    rows = []
    for a, r in arms:
        s = r["at_selected_threshold"]
        rows.append([a, s["threshold"], blk(s["test_overall"]), blk(s["finance_synth_per_language"].get("en")), blk(s["finance_synth_per_language"].get("bn")),
                     blk(s["finance_synth_per_language"].get("mixed")), blk(s["specificity_benign_finance"]["combined"], "specificity"),
                     blk(s["external_nvidia_ipi"]), blk(s["bench_attacks_sentinel_relevant"], "recall"), blk(s["bench_heldout_family"], "recall")])
    out = [table(["arm", "threshold", "test macro-F1 [95% CI]", "finance en", "finance bn", "finance mixed", "specificity benign finance",
                  "external NVIDIA IPI macro-F1", "bench attack recall (sentinel-relevant)", "HELD-OUT family recall"], rows)]
    # per language (whole test split) and per kind for the primary arm
    a, r = arms[0]
    s = r["at_selected_threshold"]
    out.append(f"\nPer language, whole test split ({a}):\n")
    out.append(table(["language", "n", "macro-F1", "recall", "specificity"],
                     [[l, b["n"], blk(b), blk(b, "recall"), blk(b, "specificity")] for l, b in s["test_per_language"].items()]))
    out.append(f"\nPer channel, finance synthetic test ({a}):\n")
    out.append(table(["channel", "n", "macro-F1", "recall", "specificity"],
                     [[c, b["n"], blk(b), blk(b, "recall"), blk(b, "specificity")] for c, b in s["finance_synth_per_channel"].items()]))
    out.append(f"\nPer kind, whole test split ({a}; kinds with n >= 10):\n")
    out.append(table(["kind", "n", "recall", "specificity"], [[k, b["n"], blk(b, "recall"), blk(b, "specificity")] for k, b in s["test_per_kind"].items()]))
    out.append(f"\nYINGLONG-Bench attack families ({a}; recall = share flagged):\n")
    out.append(table(["family", "n", "recall"], [[k, b["n"], blk(b, "recall")] for k, b in s["bench_attacks_per_family"].items()] +
                     [["memory_implant (HELD-OUT)", s["bench_heldout_family"]["n"], blk(s["bench_heldout_family"], "recall")]]))
    onnx = [load(f"m1_onnx_{n}.json") for n in ("yl-sentinel-mmbert-base", "yl-sentinel-mmbert-small")]
    onnx = [o for o in onnx if o]
    if onnx:
        out.append("\nONNX int8 export and CPU latency (batch 1):\n")
        rows = []
        for o in onnx:
            for k, v in o["latency_batch1"].items():
                rows.append([o["repo"].split("/")[-1], o.get("quantization", "int8"), o["int8_onnx_mb"], k, v["p50_ms"], v["p95_ms"],
                             pct(o["int8_vs_torch_label_agreement"]), o["cpu"]])
        out.append(table(["model", "quantization", "MB", "setting", "p50 ms", "p95 ms", "label agreement vs fp32 PyTorch", "CPU"], rows))
        for o in onnx:
            if o.get("fp32_latency_batch1"):
                out.append("")
                out.append(table(["model", "fp32 ONNX setting", "p50 ms", "p95 ms"],
                                 [[o["repo"].split("/")[-1], k, v["p50_ms"], v["p95_ms"]] for k, v in o["fp32_latency_batch1"].items()]))
    qv = load("m1_int8_variants.json")
    if qv:
        out.append("")
        out.append("Int8 variants of the mmBERT-base sentinel checked against the fp32 PyTorch model (" + qv["source"] + "):")
        out.append("")
        out.append(table(["variant", "MB", "label agreement", "mean abs prob diff", "p50 ms (seq 64)"],
                         [[k, v["mb"], pct(v["label_agreement_vs_torch"]), v["mean_abs_prob_diff"], v["kaggle_cpu_p50_ms_seq64_2threads"]]
                          for k, v in qv["variants"].items()]))
    return "\n".join(out)


def m4_block():
    rows = []
    arms = [p.stem.replace("m4_intent_", "") for p in sorted(RES.glob("m4_intent_*.json"))]
    for arm in arms:
        r = load(f"m4_intent_{arm}.json")
        if not r:
            continue
        for split in ("test", "bench_legit"):
            m = r[split]["overall"]
            rows.append([arm, r["base"], split, m["n"], pct(m["json_validity"]) + ci(m["json_validity_ci95"]), pct(m["exact_match"]) + ci(m["exact_match_ci95"]),
                         f3(m["slot_f1"])])
    g = load("m4_gemma_zeroshot.json")
    if g and "metrics" in g:
        m = g["metrics"]["overall"]
        rows.append(["zero-shot", g["model"], f"test sample", m["n"], pct(m["json_validity"]) + ci(m["json_validity_ci95"]), pct(m["exact_match"]) + ci(m["exact_match_ci95"]), f3(m["slot_f1"])])
    if not rows:
        return "_M4 results not yet available._"
    out = [table(["arm", "base model", "eval set", "n", "JSON validity [95% CI]", "canonical exact match [95% CI]", "slot F1"], rows)]
    for arm in arms:
        r = load(f"m4_intent_{arm}.json")
        if not r:
            continue
        sub = [[k.split("=", 1)[1], v["n"], pct(v["json_validity"]), pct(v["exact_match"]) + ci(v["exact_match_ci95"]), f3(v["slot_f1"])]
               for k, v in r["test"].items() if k.startswith(("language=", "task="))]
        out.append(f"\nBreakdown, test split, arm {arm} (Chinese rows are scored here but stored only in the private dataset):\n")
        out.append(table(["slice", "n", "JSON validity", "exact match", "slot F1"], sub))
        if r.get("gguf", {}).get("file"):
            out.append(f"\nGGUF: `{r['gguf']['file']}` ({r['gguf']['bytes'] / 2**30:.2f} GiB), SHA-256 `{r['gguf']['sha256']}`")
    return "\n".join(out)


def m3_block():
    r = load("m3_anomaly.json")
    if not r:
        return "_M3 results not yet available._"
    o = r["test_overall"]
    out = [table(["metric", "IsolationForest", "LightGBM", "combined (conformal)"],
                 [["AUROC", f3(o["auroc_isoforest"]), f3(o["auroc_lightgbm"]), f3(o["auroc_combined"])],
                  ["AUPRC", f3(o["auprc_isoforest"]), f3(o["auprc_lightgbm"]), f3(o["auprc_combined"])]])]
    out.append(f"\nFalse escalation rate on normal test actions (n = {o['normal_actions']}): {pct(o['false_escalation_rate'])}{ci(o['false_escalation_ci95'])} "
               f"(target {pct(r['target_false_escalation_rate'])}).\n")
    out.append(table(["family", "n (test)", "escalation recall [95% CI]", "AUROC combined", "AUROC IsolationForest", "AUROC LightGBM"],
                     [[f + (" (HELD-OUT)" if v["heldout"] else ""), v["n"], pct(v["escalation_recall"]) + ci(v["recall_ci95"]), f3(v["auroc_combined"]),
                       f3(v["auroc_isoforest"]), f3(v["auroc_lightgbm"])] for f, v in r["test_per_family"].items()]))
    d = r["data"]
    out.append(f"\nData: {d['actions']} synthetic actions from {d['wallets']} wallets, {d['anomalous_actions']} anomalous.")
    return "\n".join(out)


def m5_block():
    r = load("m5_forecast.json")
    if not r:
        return "_M5 results not yet available._"
    rows = [[m, f"{v['pinball_loss_cny']:,.0f}", f"{v['scaled_pinball']:.4f}", f"{v['pinball_h1_7_cny']:,.0f}", f"{v['pinball_h8_28_cny']:,.0f}",
             pct(v["coverage90_raw"]), pct(v["coverage90_cqr"]), f"{v['brier_breach14_raw']:.4f}", f"{v['brier_breach14_isotonic']:.4f}"]
            for m, v in r["methods"].items()]
    out = [table(["method", "mean pinball (CNY)", "scaled pinball", "pinball h1-7", "pinball h8-28", "90% coverage raw", "90% coverage CQR",
                  "Brier breach-14d raw", "Brier breach-14d isotonic"], rows)]
    out.append(f"\nTest origins: {r['origins']['test']} (calibration {r['origins']['calib']}), horizon {r['horizon_days']} days, breach base rate "
               f"{pct(r['breach_base_rate_test'])}, climatology Brier {r['brier_climatology']:.4f}. Chronos-2 CPU inference: "
               f"{r['runtime_secs']['chronos2_inference_cpu']} s for all origins. {r['label']}.")
    return "\n".join(out)


def data_block():
    out = []
    b = json.loads((REPO / "bench" / "MANIFEST.json").read_text()) if (REPO / "bench" / "MANIFEST.json").exists() else None
    if b:
        out.append(table(["bench family", "attacks"], [[k + (" (HELD-OUT)" if k == b["heldout_family"] else ""), v] for k, v in b["attack_counts"].items()]))
        out.append(f"\nAttacks total {b['attacks_total']}, legitimate tasks {b['legit_total']}. Held-out SHA-256 `{b['heldout_sha256']}`.")
    s = load("sentinel_data_manifest.json")
    if s:
        out.append("\nM1 sentinel data (private full set; rows):\n")
        out.append(table(["split", "rows", "positives", "by language", "by source"],
                         [[k, v["n"], v["pos"], ", ".join(f"{a}:{n}" for a, n in v["by_lang"].items()), ", ".join(f"{a}:{n}" for a, n in v["by_source"].items())]
                          for k, v in s["stats"].items()]))
    i = load("intent_data_manifest.json")
    if i:
        out.append(f"\nM4 intent data: generated {i['generated']}, kept {i['kept']} after schema, language, amount and round-trip checks.\n")
        out.append(table(["split", "rows", "repo rows (no zh)", "by language", "by task"],
                         [[k, v["n"], v["repo_rows"], ", ".join(f"{a}:{n}" for a, n in v["by_language"].items()), ", ".join(f"{a}:{n}" for a, n in v["by_task"].items())]
                          for k, v in i["stats"].items()]))
        out.append("\nDrop reasons: " + ", ".join(f"{k} {v}" for k, v in sorted(i["drops"].items(), key=lambda kv: -kv[1])))
    sp = load("llm_spend.json")
    if sp:
        out.append(f"\nOpenRouter usage: {sp['calls']} calls, USD {sp['cost_usd']:.4f}.")
    return "\n".join(out) if out else "_not yet available_"


def registry_block():
    nl = chr(10)
    r = load("models_registry.json")
    if not r:
        return "_registry not yet generated (run ml/scripts/registry.py)_"
    out = []
    for e in r:
        if e.get("error"):
            out.append(f"### `{e['repo']}`" + nl + nl + f"{e['role']}. Not available: {e['error']}." + nl)
            continue
        vis = "private" if e["private"] else "public"
        out.append(f"### `{e['repo']}` ({e['type']}, {vis})" + nl + nl + f"{e['role']}. Revision `{e['revision']}` (last modified {e['last_modified'][:19]})." + nl)
        big = [f for f in e["files"] if f["sha256"]]
        if big:
            out.append(table(["file", "bytes", "SHA-256"], [[f"`{f['path']}`", f["bytes"], f"`{f['sha256']}`"] for f in big]))
        out.append("")
    lock = ML / "serving" / "models.lock.json"
    if lock.exists():
        lk = json.loads(lock.read_text())
        out.append("Serving pins (`ml/serving/models.lock.json`, startup fails closed on mismatch):" + nl)
        out.append(table(["key", "repo", "revision", "file", "SHA-256"],
                         [[k, v["repo"], f"`{v['revision']}`", f, f"`{h}`"] for k, v in lk.items() for f, h in v["files"].items()]))
    return nl.join(out)


BLOCKS = {"results_m1": m1_block, "results_m4": m4_block, "results_m3": m3_block, "results_m5": m5_block, "data_summary": data_block, "models_registry": registry_block}


def render(path: Path):
    if not path.exists():
        return
    s = path.read_text(encoding="utf-8")
    for name, fn in BLOCKS.items():
        pat = re.compile(rf"(<!-- BEGIN:{name} -->)(.*?)(<!-- END:{name} -->)", re.S)
        if pat.search(s):
            s = pat.sub(lambda m: m.group(1) + "\n" + fn() + "\n" + m.group(3), s)
    path.write_text(s, encoding="utf-8", newline="\n")
    print("rendered", path.relative_to(REPO))


if __name__ == "__main__":
    render(ML / "README.md")
    render(ML / "MODELS.md")
