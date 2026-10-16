"""Kaggle job (2x T4): evaluate and export trained M4 LoRA adapters from their HF checkpoints.

The training jobs stopped at the evaluation step because generation ran past the 768-token training context
(prompt + new tokens). This job loads each final checkpoint (checkpoints/last, waiting until it reaches max_steps),
evaluates with a 2048-token context, then uploads results.json, predictions, the adapter and a GGUF Q4_K_M.
  --targets "qwen3-1.7b,qwen3-4b:0;qwen3.5-2b:1"   comma-separated models per GPU, ';' between GPUs
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from kjobs import kutil  # noqa: E402

MODELS = {"qwen3-1.7b": ("Qwen/Qwen3-1.7B", f"{kutil.HF_USER}/yl-intent-qwen3-1.7b"),
          "qwen3-4b": ("Qwen/Qwen3-4B", f"{kutil.HF_USER}/yl-intent-qwen3-4b"),
          "qwen3.5-2b": ("Qwen/Qwen3.5-2B", f"{kutil.HF_USER}/yl-intent-qwen3.5-2b")}


def wait_final(repo: str):
    from huggingface_hub import hf_hub_download
    while True:
        try:
            st = json.load(open(hf_hub_download(repo, "checkpoints/last/trainer_state.json", force_download=True)))
            if st["global_step"] >= st["max_steps"]:
                return st
            kutil.log(repo, "at step", st["global_step"], "of", st["max_steps"])
        except Exception as e:  # noqa: BLE001
            kutil.log(repo, "waiting:", type(e).__name__)
        time.sleep(180)


def run_one(tag: str, gguf_only: bool = False):
    import unsloth  # noqa: F401
    import torch
    from huggingface_hub import snapshot_download
    from intent import kaggle_train_intent as T
    from common import intent_sampler as S
    base, repo = MODELS[tag]
    st = wait_final(repo)
    ck = snapshot_download(repo, allow_patterns=["checkpoints/last/*"], local_dir=f"/tmp/ck_{tag}")
    ck = os.path.join(ck, "checkpoints", "last")
    from unsloth import FastLanguageModel
    t0 = time.time()
    model, tok = FastLanguageModel.from_pretrained(ck, max_seq_length=2048, dtype=torch.float16, load_in_4bit=False)
    FastLanguageModel.for_inference(model)
    scen = S.load_scenarios()
    d = T.fetch_data()
    test = T.load_jsonl(os.path.join(d, "test.jsonl"))
    res = {"model": tag, "base": base, "adapter_step": st["global_step"], "train_runtime_secs": next((h.get("train_runtime") for h in st["log_history"] if "train_runtime" in h), None),
           "final_train_loss": next((h.get("loss") for h in reversed(st["log_history"]) if "loss" in h), None), "eval_context": 2048,
           "lora": {"r": 16, "alpha": 16, "dropout": 0}, "epochs": 2, "lr": 2e-4, "effective_batch": 16, "train_rows": None}
    if gguf_only:
        from huggingface_hub import hf_hub_download
        while True:
            try:
                res = json.load(open(hf_hub_download(repo, "results.json", force_download=True)))
                if "gguf" in res and "file" not in res["gguf"]:  # the evaluation job has finished and its GGUF step failed
                    break
            except Exception:  # noqa: BLE001
                kutil.log(tag, "waiting for results.json before the GGUF export")
                time.sleep(180)
        return export_gguf(model, tok, T, tag, repo, res)
    res["test"] = T.evaluate(model, tok, scen, test, f"{tag}_test")
    res["bench_legit"] = T.evaluate(model, tok, scen, T.bench_rows(), f"{tag}_bench")
    res["eval_secs"] = round(time.time() - t0)
    kutil.log(tag, "test EM", res["test"]["overall"]["exact_match"], "bench EM", res["bench_legit"]["overall"]["exact_match"])
    json.dump(res, open(f"/kaggle/working/results_{tag}.json", "w"), indent=1)
    kutil.upload_file(repo, "model", f"/kaggle/working/results_{tag}.json", "results.json", "results")
    for split in ("test", "bench"):
        kutil.upload_file(repo, "model", f"/kaggle/working/preds_{tag}_{split}.jsonl", f"preds_{split}.jsonl", "predictions")
    kutil.upload_folder(repo, "model", ck, "adapter", msg="final LoRA adapter")
    export_gguf(model, tok, T, tag, repo, res)


def export_gguf(model, tok, T, tag, repo, res):
    try:
        try:
            gd = f"/tmp/gguf_{tag}"
            model.save_pretrained_gguf(gd, T.text_tok(tok), quantization_method="q4_k_m")
            ggufs = [os.path.join(dp, f) for root in (gd, gd + "_gguf", ".") if os.path.isdir(root)
                     for dp, _, fs in os.walk(root) for f in fs if f.endswith(".gguf")]  # Unsloth writes to <dir>_gguf
            res["gguf_path"] = "unsloth"
        except Exception as e:  # noqa: BLE001
            kutil.log(tag, "unsloth GGUF failed:", type(e).__name__, str(e)[:200])
            ggufs = [T.manual_gguf(model, tok, tag)]
            res["gguf_path"] = "manual llama.cpp"
        q4 = [g for g in ggufs if "q4_k_m" in g.lower()] or ggufs
        import hashlib
        h = hashlib.sha256()
        with open(q4[0], "rb") as f:
            for chunk in iter(lambda: f.read(1 << 24), b""):
                h.update(chunk)
        fname = f"yl-intent-{tag}-Q4_K_M.gguf"
        kutil.upload_file(repo, "model", q4[0], fname, "GGUF Q4_K_M")
        res["gguf"] = {"file": fname, "bytes": os.path.getsize(q4[0]), "sha256": h.hexdigest()}
    except Exception as e:  # noqa: BLE001
        res["gguf"] = {"error": f"{type(e).__name__}: {str(e)[:300]}"}
    json.dump(res, open(f"/kaggle/working/results_{tag}.json", "w"), indent=1)
    kutil.upload_file(repo, "model", f"/kaggle/working/results_{tag}.json", "results.json", "results + gguf")
    kutil.log(tag, "done", res.get("gguf"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", default="qwen3-1.7b,qwen3-4b:0;qwen3.5-2b:1")
    ap.add_argument("--one")
    ap.add_argument("--gguf-only", action="store_true")
    a = ap.parse_args()
    kutil.hf_login()
    if a.one:
        return run_one(a.one, a.gguf_only)
    kutil.log("GPU:", kutil.gpu_info())
    kutil.pip("unsloth==2026.10.6", "unsloth_zoo==2026.10.6")
    subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchaudio"])
    me = os.path.abspath(__file__)
    lanes = []
    for lane in a.targets.split(";"):
        tags, gpu = lane.split(":")
        script = "; ".join(f"{sys.executable} {me} --one {t}" + (" --gguf-only" if a.gguf_only else "") for t in tags.split(","))
        lanes.append(subprocess.Popen(["bash", "-c", script], env=dict(os.environ, CUDA_VISIBLE_DEVICES=gpu, TOKENIZERS_PARALLELISM="false")))
    kutil.log("lane exit codes", [p.wait() for p in lanes])


if __name__ == "__main__":
    main()
