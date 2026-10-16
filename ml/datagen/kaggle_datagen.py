"""Kaggle job: label-first synthetic data generation with vLLM on 2x T4.

Writer model family: Qwen (Qwen/Qwen3-14B-AWQ, non-thinking mode). This family is used for the
sentinel training data and the intent data; the YINGLONG-Bench attacks are written by a
different family (see bench/README.md).

Outputs go ONLY to the private HuggingFace dataset repo (it contains Chinese-script rows).
Nothing with generated text is written to /kaggle/working; logs print counts only.
Resumable: shards already on the Hub are skipped by spec id. Shards are uploaded every chunk
(well under 30 minutes apart).

  --kind intent|sentinel   which spec set to generate
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # ml/

from common import intent_sampler as S  # noqa: E402
from datagen import intent_specs, sentinel_specs  # noqa: E402
from kjobs import kutil  # noqa: E402

REPO_ID = f"{kutil.HF_USER}/yl-private-data"
GEN_VER = "v1"
WRITER = "Qwen/Qwen3-14B-AWQ"
N_INTENT, N_MANDATE, N_SENTINEL = 8800, 2600, 6400
SEED_INTENT, SEED_SENTINEL = 20261016, 20261017
VLLM_VERSIONS = ["vllm==0.31.0", "vllm==0.30.0"]


def all_specs(kind: str):
    scen = S.load_scenarios()
    if kind == "intent":
        return scen, intent_specs.build_specs(N_INTENT, N_MANDATE, SEED_INTENT, scen)
    if kind == "intent2":  # top-up round with a new seed (ids differ), same output folder as "intent"
        return scen, intent_specs.build_specs(4400, 1600, SEED_INTENT + 2, scen)
    return scen, sentinel_specs.sample_specs(N_SENTINEL, SEED_SENTINEL, scen)


def done_ids(kind: str) -> set[str]:
    from huggingface_hub import HfApi, hf_hub_download
    kind = "intent" if kind == "intent2" else kind
    api = HfApi()
    ids: set[str] = set()
    try:
        files = [f for f in api.list_repo_files(REPO_ID, repo_type="dataset") if f.startswith(f"gen/{GEN_VER}/{kind}/")]
    except Exception:  # noqa: BLE001
        return ids
    for f in files:
        p = hf_hub_download(REPO_ID, f, repo_type="dataset")
        with open(p, encoding="utf-8") as fh:
            ids.update(json.loads(l)["id"] for l in fh if l.strip())
    return ids


def worker(kind: str):
    from vllm import LLM, SamplingParams
    scen, specs = all_specs(kind)
    done = done_ids(kind)
    todo = [s for s in specs if s["id"] not in done]
    kutil.log(f"{kind}: total {len(specs)} done {len(done)} todo {len(todo)}")
    if not todo:
        return
    llm = LLM(model=WRITER, tensor_parallel_size=2, dtype="half", max_model_len=3072, gpu_memory_utilization=0.90,
              enable_prefix_caching=True, max_num_seqs=192, disable_custom_all_reduce=True, seed=0)
    sp = SamplingParams(temperature=0.9, top_p=0.95, max_tokens=420 if kind.startswith("intent") else 520, repetition_penalty=1.05, seed=None)
    is_intent = kind.startswith("intent")
    folder = "intent" if is_intent else kind
    build = (lambda s: intent_specs.writer_prompt(s, scen)) if is_intent else (lambda s: sentinel_specs.writer_prompt(s, S.LANG_STYLE))
    chunk = 1200
    for k in range(0, len(todo), chunk):
        part = todo[k:k + chunk]
        t0 = time.time()
        outs = llm.chat([build(s) for s in part], sp, chat_template_kwargs={"enable_thinking": False}, use_tqdm=False)
        path = f"/tmp/{folder}-{int(time.time())}.jsonl"
        ntok = 0
        with open(path, "w", encoding="utf-8") as f:
            for s, o in zip(part, outs):
                c = o.outputs[0]
                ntok += len(c.token_ids)
                f.write(json.dumps(dict(s, text=c.text, finish=c.finish_reason, writer=WRITER), ensure_ascii=False) + "\n")
        kutil.upload_file(REPO_ID, "dataset", path, f"gen/{GEN_VER}/{folder}/{os.path.basename(path)}", msg=f"{kind} shard")
        dt = time.time() - t0
        kutil.log(f"{kind}: shard {k // chunk} rows {len(part)} out_tokens {ntok} secs {dt:.0f} tok/s {ntok / dt:.0f}")
        kutil.write_status({"kind": kind, "done": k + len(part), "todo": len(todo)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["intent", "intent2", "sentinel"], required=True)
    ap.add_argument("--worker", action="store_true")
    a = ap.parse_args()
    kutil.hf_login()
    if a.worker:
        worker(a.kind)
        return
    kutil.log("GPU:", kutil.gpu_info(), "python", sys.version.split()[0])
    kutil.ensure_repo(REPO_ID, "dataset")
    env = dict(os.environ, VLLM_WORKER_MULTIPROC_METHOD="spawn", TOKENIZERS_PARALLELISM="false")
    for ver in VLLM_VERSIONS:
        if kutil.pip(ver, check=False) != 0:
            continue
        # the vLLM torch wheel targets CUDA 13; Kaggle's preinstalled torchaudio does not, and transformers imports it
        subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchaudio"])
        r = subprocess.run([sys.executable, os.path.abspath(__file__), "--kind", a.kind, "--worker"], env=env)
        kutil.log(f"worker with {ver} exit {r.returncode}")
        if r.returncode == 0:
            break
    kutil.write_status({"kind": a.kind, "finished": True})


if __name__ == "__main__":
    main()
