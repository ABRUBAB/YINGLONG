"""Kaggle CPU job (no GPU quota): build and check int8 ONNX variants of the M1 sentinel with enough RAM.

Variants: dynamic int8 on all weight MatMuls; dynamic int8 excluding the MLP output projections (Wo); dynamic int8 on attention
projections only; weight-only int8 MatMul + 4-bit embedding gather. Each is compared with the fp32 PyTorch model on 600 held-out
rows (label agreement at 0.5 and mean absolute probability difference). Variants and a JSON report go to the model repo under
onnx/variants/. CPU latency is then measured on the target laptop with ml/sentinel/export_onnx.py-style timing.
"""
from __future__ import annotations

import gc
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from kjobs import kutil  # noqa: E402

REPO = f"{kutil.HF_USER}/yl-sentinel-mmbert-base"
DATA_REPO = f"{kutil.HF_USER}/yl-private-data"


def main():
    kutil.hf_login()
    kutil.pip("onnx", "onnxruntime", "onnx-ir", "onnxscript", check=False)
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from huggingface_hub import HfApi, hf_hub_download, snapshot_download
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    rev = HfApi().model_info(REPO).sha
    src = snapshot_download(REPO, revision=rev, allow_patterns=["*.json", "*.safetensors", "tokenizer*"], local_dir="/tmp/src")
    tok = AutoTokenizer.from_pretrained(src)
    model = AutoModelForSequenceClassification.from_pretrained(src, attn_implementation="eager", dtype=torch.float32).eval()
    rows = [json.loads(l) for l in open(hf_hub_download(DATA_REPO, "sentinel/v1/test.jsonl", repo_type="dataset"), encoding="utf-8")]
    rng = np.random.default_rng(1)
    rows = [rows[i] for i in rng.choice(len(rows), 600, replace=False)]
    feeds = []
    for r in rows:
        e = tok(r["text"], truncation=True, max_length=320, return_tensors="np")
        feeds.append({"input_ids": e["input_ids"].astype(np.int64), "attention_mask": e["attention_mask"].astype(np.int64)})

    def prob(lo):
        lo = np.asarray(lo, dtype=np.float64)
        return float(np.exp(lo[1] - lo.max()) / np.exp(lo - lo.max()).sum())

    with torch.no_grad():
        p_ref = [prob(model(input_ids=torch.tensor(f["input_ids"]), attention_mask=torch.tensor(f["attention_mask"])).logits[0].numpy()) for f in feeds]
    os.makedirs("/tmp/onnx", exist_ok=True)
    fp32 = "/tmp/onnx/model_fp32.onnx"
    enc = tok(["Please pay invoice INV-2201 by Friday."] * 2, return_tensors="pt", padding="max_length", max_length=32)
    with torch.no_grad():
        torch.onnx.export(model, (enc["input_ids"], enc["attention_mask"]), fp32, input_names=["input_ids", "attention_mask"], output_names=["logits"],
                          dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"}, "logits": {0: "batch"}},
                          opset_version=17, dynamo=False)
    del model
    gc.collect()
    names = [n.name for n in onnx.load(fp32, load_external_data=False).graph.node if n.op_type == "MatMul"]
    variants = {}

    def dyn(name, exclude_pat):
        out = f"/tmp/onnx/model_int8_{name}.onnx"
        excl = [n for n in names if exclude_pat and re.search(exclude_pat, n)]
        quantize_dynamic(fp32, out, weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=["MatMul"], nodes_to_exclude=excl,
                         extra_options={"MatMulConstBOnly": True})
        return out

    variants["dyn_all"] = dyn("dyn_all", None)
    variants["dyn_no_mlp_wo"] = dyn("dyn_no_mlp_wo", r"mlp/Wo")
    variants["dyn_attn_only"] = dyn("dyn_attn_only", r"mlp/")
    wo = "/tmp/onnx/model_int8_wo_g4.onnx"
    q = MatMulNBitsQuantizer(onnx.load(fp32), bits=8, block_size=32, is_symmetric=True, op_types_to_quantize=("MatMul",), accuracy_level=4,
                             algo_config=DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=8, op_types_to_quantize=("MatMul",), accuracy_level=4))
    q.process()
    q.model.save_model_to_file(wo, use_external_data_format=False)
    variants["weightonly8"] = wo
    variants["fp32"] = fp32
    report = {"source_revision": rev, "check_rows": len(rows), "variants": {}}
    for k, path in variants.items():
        so = ort.SessionOptions()
        so.intra_op_num_threads = 2
        s = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        pq = [prob(s.run(["logits"], f)[0][0]) for f in feeds]
        ids = np.full((1, 64), 5, dtype=np.int64)
        m = np.ones((1, 64), dtype=np.int64)
        for _ in range(5):
            s.run(["logits"], {"input_ids": ids, "attention_mask": m})
        ts = []
        for _ in range(30):
            t0 = time.perf_counter()
            s.run(["logits"], {"input_ids": ids, "attention_mask": m})
            ts.append(1000 * (time.perf_counter() - t0))
        del s
        gc.collect()
        report["variants"][k] = {"mb": round(os.path.getsize(path) / 2**20, 1),
                                 "label_agreement_vs_torch": round(sum((a >= 0.5) == (b >= 0.5) for a, b in zip(pq, p_ref)) / len(rows), 4),
                                 "mean_abs_prob_diff": round(float(np.mean(np.abs(np.array(pq) - np.array(p_ref)))), 5),
                                 "kaggle_cpu_p50_ms_seq64_2threads": round(sorted(ts)[15], 1)}
        kutil.log(k, report["variants"][k])
    json.dump(report, open("/kaggle/working/quant_report.json", "w"), indent=1)
    kutil.upload_file(REPO, "model", "/kaggle/working/quant_report.json", "onnx/variants/quant_report.json", "int8 variant report")
    for k in ("dyn_no_mlp_wo", "dyn_attn_only", "dyn_all"):
        if report["variants"][k]["label_agreement_vs_torch"] >= 0.99:
            kutil.upload_file(REPO, "model", variants[k], f"onnx/variants/model_int8_{k}.onnx", f"int8 variant {k}")


if __name__ == "__main__":
    main()
