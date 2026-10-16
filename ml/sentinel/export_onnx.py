"""Export the fine-tuned M1 sentinel to ONNX, quantise to int8 (dynamic), check agreement and measure CPU latency.

Usage (from ml/): uv run --group cpu-models python sentinel/export_onnx.py --repo ABRUBAB/yl-sentinel-mmbert-base [--revision <sha>]
Outputs: ml/artifacts/m1/<name>/{model_fp32.onnx, model_int8.onnx, tokenizer files}; ml/results/m1_onnx_<name>.json;
the int8 model and tokenizer are uploaded to the same HF repo under onnx/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ML = HERE.parent
sys.path.insert(0, str(ML))
from common import keys  # noqa: E402

DATA = keys.WORK_DIR / "private" / "sentinel_v1"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 22), b""):
            h.update(c)
    return h.hexdigest()


def cpu_name() -> str:
    try:
        import subprocess
        out = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor).Name"], capture_output=True, text=True).stdout.strip()
        return out or platform.processor()
    except Exception:  # noqa: BLE001
        return platform.processor()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--revision", default=None)
    ap.add_argument("--max-len", type=int, default=320)
    ap.add_argument("--n-check", type=int, default=600)
    ap.add_argument("--local", help="local model dir (testing); skips the Hub download")
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--with-dynamic", action="store_true", help="also build and check dynamic int8 (needs about 4 GB free RAM)")
    ap.add_argument("--hub-variant", help="name of an int8 variant under onnx/variants/ in the repo to check and ship if it agrees")
    ap.add_argument("--data", default=str(DATA))
    a = ap.parse_args()
    import onnxruntime as ort
    import torch
    from huggingface_hub import HfApi, snapshot_download
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    keys.use_hf("write")
    api = HfApi()
    name = a.repo.split("/")[-1]
    if a.local:
        rev, src = "local", a.local
    else:
        rev = a.revision or api.model_info(a.repo).sha
        src = snapshot_download(a.repo, revision=rev, allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model", "tokenizer*"],
                                local_dir=str(keys.WORK_DIR / "models" / name))
    out = ML / "artifacts" / "m1" / name
    out.mkdir(parents=True, exist_ok=True)
    tok = AutoTokenizer.from_pretrained(src)
    model = AutoModelForSequenceClassification.from_pretrained(src, attn_implementation="eager").eval()
    if hasattr(model.config, "reference_compile"):
        model.config.reference_compile = False
    import gc
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer

    def prob(lo):
        lo = np.asarray(lo, dtype=np.float64)
        return float(np.exp(lo[1] - lo.max()) / np.exp(lo - lo.max()).sum())

    # 1. reference probabilities from the torch model on held-out rows (text read locally from the private split; nothing printed)
    rows = [json.loads(l) for l in (Path(a.data) / "test.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    rng = np.random.default_rng(0)
    rows = [rows[i] for i in rng.choice(len(rows), min(a.n_check, len(rows)), replace=False)]
    feeds = []
    for r in rows:
        e = tok(r["text"], truncation=True, max_length=a.max_len, return_tensors="np")
        feeds.append({"input_ids": e["input_ids"].astype(np.int64), "attention_mask": e["attention_mask"].astype(np.int64)})
    with torch.no_grad():
        p_ref = [prob(model(input_ids=torch.tensor(f["input_ids"]), attention_mask=torch.tensor(f["attention_mask"])).logits[0].numpy()) for f in feeds]
    correct_torch = sum((p >= 0.5) == bool(r["label"]) for p, r in zip(p_ref, rows))
    # 2. export fp32 ONNX, then free the torch model (the laptop has little RAM: one model in memory at a time)
    enc = tok(["Please pay invoice INV-2201 by Friday."] * 2, return_tensors="pt", padding="max_length", max_length=32)
    fp32 = out / "model_fp32.onnx"
    with torch.no_grad():
        torch.onnx.export(model, (enc["input_ids"], enc["attention_mask"]), str(fp32), input_names=["input_ids", "attention_mask"], output_names=["logits"],
                          dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"}, "logits": {0: "batch"}},
                          opset_version=17, dynamo=False)
    del model
    gc.collect()
    tok.save_pretrained(out)
    # 3. int8 variants. Dynamic int8 (weights + per-tensor activations) breaks ModernBERT-style encoders (massive activations; see the
    # dry run noted in README); weight-only int8 (MatMulNBits, block 32, int8 compute) keeps accuracy and is shipped unless dynamic passes.
    wo = out / "model_int8_weightonly.onnx"
    cfg = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=8, op_types_to_quantize=("MatMul",), accuracy_level=4)
    q = MatMulNBitsQuantizer(onnx.load(str(fp32)), bits=8, block_size=32, is_symmetric=True, algo_config=cfg, op_types_to_quantize=("MatMul",), accuracy_level=4)
    q.process()
    q.model.save_model_to_file(str(wo), use_external_data_format=False)
    del q
    gc.collect()
    paths = [("weightonly", wo)]
    if a.hub_variant:  # a dynamic-int8 variant built with enough RAM by ml/sentinel/kaggle_quantize.py
        from huggingface_hub import hf_hub_download
        import shutil as _sh
        hv = out / f"model_int8_{a.hub_variant}.onnx"
        _sh.copy(hf_hub_download(a.repo, f"onnx/variants/model_int8_{a.hub_variant}.onnx"), hv)
        paths.append((a.hub_variant, hv))
    if a.with_dynamic:
        dyn = out / "model_int8_dynamic.onnx"
        quantize_dynamic(str(fp32), str(dyn), weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=["MatMul"],
                         extra_options={"MatMulConstBOnly": True})
        gc.collect()
        paths.append(("dynamic", dyn))
    variants = {}
    for k, path in paths:
        so = ort.SessionOptions()
        so.intra_op_num_threads = 2
        s_ = ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])
        pq = [prob(s_.run(["logits"], f)[0][0]) for f in feeds]
        del s_
        gc.collect()
        variants[k] = {"label_agreement_vs_fp32": round(sum((a_ >= 0.5) == (b_ >= 0.5) for a_, b_ in zip(pq, p_ref)) / len(rows), 4),
                       "mean_abs_prob_diff": round(float(np.mean(np.abs(np.array(pq) - np.array(p_ref)))), 5),
                       "accuracy_at_0.5": round(sum((p >= 0.5) == bool(r["label"]) for p, r in zip(pq, rows)) / len(rows), 4)}
    passing = [k for k in variants if k != "weightonly" and variants[k]["label_agreement_vs_fp32"] >= 0.99]
    chosen = passing[0] if passing else "weightonly"
    chosen_path = dict(paths)[chosen]
    int8 = out / "model_int8.onnx"
    import shutil
    shutil.copy(chosen_path, int8)
    # latency, batch 1, 2 threads (the 2 vCPU server) and all threads; int8 and fp32 for comparison
    lat, lat32 = {}, {}
    for model_path, threads, store in ((int8, 2, lat), (int8, os.cpu_count(), lat), (fp32, 2, lat32)):
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        s = ort.InferenceSession(str(model_path), so, providers=["CPUExecutionProvider"])
        for L in (64, 256):
            ids = np.full((1, L), tok.pad_token_id or 0, dtype=np.int64)
            ids[0, 0] = tok.cls_token_id or 1
            m = np.ones((1, L), dtype=np.int64)
            for _ in range(10):
                s.run(["logits"], {"input_ids": ids, "attention_mask": m})
            ts = []
            for _ in range(100):
                t0 = time.perf_counter()
                s.run(["logits"], {"input_ids": ids, "attention_mask": m})
                ts.append((time.perf_counter() - t0) * 1000)
            ts.sort()
            store[f"threads{threads}_seq{L}"] = {"p50_ms": round(statistics.median(ts), 2), "p95_ms": round(ts[94], 2)}
        del s
        gc.collect()
    info = None
    if not a.no_upload:
        api.upload_file(path_or_fileobj=str(out / "model_int8.onnx"), path_in_repo="onnx/model_int8.onnx", repo_id=a.repo, commit_message="ONNX int8 export")
        info = api.upload_folder(folder_path=str(out), path_in_repo="onnx", repo_id=a.repo,
                                 allow_patterns=["tokenizer*", "special_tokens_map.json", "*.model", "vocab*"], commit_message="ONNX tokenizer files")
    res = {"repo": a.repo, "source_revision": rev, "onnx_upload_commit": getattr(info, "oid", None),
           "fp32_onnx_mb": round(fp32.stat().st_size / 2**20, 1), "int8_onnx_mb": round(int8.stat().st_size / 2**20, 1),
           "int8_sha256": sha256(int8), "fp32_sha256": sha256(fp32), "check_rows": len(rows),
           "int8_variants": variants, "shipped_variant": chosen,
           "quantization": "weight-only int8 (ONNX Runtime MatMulNBits, 8 bits, block 32, symmetric, int8 compute)" if chosen == "weightonly"
           else f"dynamic int8 ({chosen}: QInt8 per-channel weights, dynamic uint8 activations)",
           "int8_vs_torch_label_agreement": variants[chosen]["label_agreement_vs_fp32"], "accuracy_at_0.5_torch_fp32": round(correct_torch / len(rows), 4),
           "cpu": cpu_name(), "onnxruntime": ort.__version__, "latency_batch1": lat, "fp32_latency_batch1": lat32}
    (ML / "results").mkdir(exist_ok=True)
    if a.no_upload:
        print(json.dumps(res, indent=1)); return
    (ML / "results" / f"m1_onnx_{name}.json").write_text(json.dumps(res, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
