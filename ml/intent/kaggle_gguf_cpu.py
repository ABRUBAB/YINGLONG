"""Kaggle CPU job (no GPU quota): merge each final M4 LoRA adapter into its base model and export GGUF Q4_K_M with llama.cpp.

Waits until the model repo's results.json reports a failed or missing GGUF (the evaluation job finished), merges on CPU in
fp32 with PEFT, converts with llama.cpp convert_hf_to_gguf.py (f16) and llama-quantize (Q4_K_M), uploads the file and records
its size and SHA-256 in results.json.   --tags qwen3-1.7b,qwen3-4b,qwen3.5-2b
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from kjobs import kutil  # noqa: E402

MODELS = {"qwen3-1.7b": ("Qwen/Qwen3-1.7B", f"{kutil.HF_USER}/yl-intent-qwen3-1.7b"),
          "qwen3-4b": ("Qwen/Qwen3-4B", f"{kutil.HF_USER}/yl-intent-qwen3-4b"),
          "qwen3.5-2b": ("Qwen/Qwen3.5-2B", f"{kutil.HF_USER}/yl-intent-qwen3.5-2b")}
LC = "/tmp/llama.cpp"


def build_llama():
    if os.path.exists(f"{LC}/build/bin/llama-quantize"):
        return
    subprocess.run(["git", "clone", "--depth", "1", "https://github.com/ggml-org/llama.cpp", LC], check=True)
    subprocess.run(["cmake", "-S", LC, "-B", f"{LC}/build", "-DGGML_CUDA=OFF", "-DLLAMA_CURL=OFF", "-DLLAMA_BUILD_TESTS=OFF"], check=True)
    subprocess.run(["cmake", "--build", f"{LC}/build", "--target", "llama-quantize", "-j", "4"], check=True)


def one(tag):
    import torch
    from huggingface_hub import hf_hub_download, snapshot_download
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer
    base, repo = MODELS[tag]
    while True:
        try:
            res = json.load(open(hf_hub_download(repo, "results.json", force_download=True)))
            if res.get("gguf", {}).get("file"):
                kutil.log(tag, "already has a GGUF")
                return
            if "gguf" in res:
                break
        except Exception:  # noqa: BLE001
            pass
        kutil.log(tag, "waiting for the evaluation job")
        time.sleep(180)
    ck = os.path.join(snapshot_download(repo, allow_patterns=["checkpoints/last/*"], local_dir=f"/tmp/ck_{tag}"), "checkpoints", "last")
    model = AutoModelForCausalLM.from_pretrained(base, dtype=torch.float32, low_cpu_mem_usage=True)
    model = PeftModel.from_pretrained(model, ck).merge_and_unload()
    merged = f"/tmp/merged_{tag}"
    model.save_pretrained(merged, safe_serialization=True)
    AutoTokenizer.from_pretrained(ck).save_pretrained(merged)
    del model
    gc.collect()
    f16 = f"/tmp/{tag}-f16.gguf"
    env = dict(os.environ, PYTHONPATH=os.path.join(LC, "gguf-py"))
    subprocess.run([sys.executable, os.path.join(LC, "convert_hf_to_gguf.py"), merged, "--outtype", "f16", "--outfile", f16], check=True, env=env)
    shutil.rmtree(merged, ignore_errors=True)
    q4 = f"/tmp/yl-intent-{tag}-Q4_K_M.gguf"
    subprocess.run([f"{LC}/build/bin/llama-quantize", f16, q4, "Q4_K_M"], check=True)
    os.remove(f16)
    h = hashlib.sha256()
    with open(q4, "rb") as f:
        for c in iter(lambda: f.read(1 << 24), b""):
            h.update(c)
    kutil.upload_file(repo, "model", q4, os.path.basename(q4), "GGUF Q4_K_M (CPU merge + llama.cpp)")
    res = json.load(open(hf_hub_download(repo, "results.json", force_download=True)))
    res["gguf"] = {"file": os.path.basename(q4), "bytes": os.path.getsize(q4), "sha256": h.hexdigest(), "path": "PEFT merge on CPU + llama.cpp"}
    json.dump(res, open(f"/kaggle/working/results_{tag}.json", "w"), indent=1)
    kutil.upload_file(repo, "model", f"/kaggle/working/results_{tag}.json", "results.json", "results + gguf")
    os.remove(q4)
    kutil.log(tag, "GGUF done", res["gguf"]["bytes"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tags", default="qwen3-1.7b,qwen3-4b,qwen3.5-2b")
    a = ap.parse_args()
    kutil.hf_login()
    kutil.pip("transformers>=5.16", "peft", "gguf", "sentencepiece", "safetensors", check=False)
    subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao"])  # the preinstalled torchao is too old for PEFT
    build_llama()
    for t in a.tags.split(","):
        try:
            one(t)
        except Exception as e:  # noqa: BLE001
            kutil.log(t, "failed:", type(e).__name__, str(e)[:300])


if __name__ == "__main__":
    main()
