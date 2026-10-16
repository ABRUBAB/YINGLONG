"""Query the HF Hub for every YINGLONG model / dataset repo and write ml/results/models_registry.json
(revision, files, sizes, LFS SHA-256 as reported by the Hub). ml/scripts/render_readme.py turns it into MODELS.md tables.
Run (repo root): uv run --project ml python ml/scripts/registry.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))
from common import keys  # noqa: E402

REPOS = [
    ("ABRUBAB/yl-sentinel-mmbert-base", "model", "M1 sentinel, primary arm (fine-tuned jhu-clsp/mmBERT-base) + ONNX int8"),
    ("ABRUBAB/yl-sentinel-mdeberta-v3-base", "model", "M1 sentinel, control arm (fine-tuned microsoft/mdeberta-v3-base)"),
    ("ABRUBAB/yl-sentinel-mmbert-small", "model", "M1 sentinel, low-latency arm (fine-tuned jhu-clsp/mmBERT-small) + ONNX"),
    ("ABRUBAB/yl-intent-qwen3.5-2b", "model", "M4 intent model, Qwen3.5-2B arm (LoRA adapter + GGUF Q4_K_M)"),
    ("ABRUBAB/yl-intent-qwen3-1.7b", "model", "M4 intent model, Qwen3-1.7B fallback-family arm (LoRA adapter + GGUF Q4_K_M)"),
    ("ABRUBAB/yl-intent-qwen3-4b", "model", "M4 intent model, Qwen3-4B fallback-family arm (LoRA adapter + GGUF Q4_K_M)"),
    ("ABRUBAB/yl-intent-baselines", "model", "M4 zero-shot google/gemma-4-E2B-it results"),
    ("ABRUBAB/yl-cpu-models", "model", "M3 anomaly and M5 LightGBM quantile models"),
    ("ABRUBAB/yl-private-data", "dataset", "private data: generated shards, verified splits, Chinese-script rows, bench Chinese variants"),
]
KEEP = (".onnx", ".gguf", ".safetensors", ".json", ".jsonl", ".txt", ".pkl")


def main():
    from huggingface_hub import HfApi
    api = HfApi(token=keys.hf_tokens()["read"])
    out = []
    for repo, rtype, role in REPOS:
        try:
            info = api.repo_info(repo, repo_type=rtype, files_metadata=True)
        except Exception as e:  # noqa: BLE001
            out.append({"repo": repo, "type": rtype, "role": role, "error": type(e).__name__})
            continue
        files = []
        for s in info.siblings:
            if not s.rfilename.endswith(KEEP) or s.rfilename.startswith("checkpoints/"):
                continue
            if rtype == "dataset" and not s.rfilename.startswith(("sentinel/v1/", "intent/v1/", "bench/v1/")):
                continue
            files.append({"path": s.rfilename, "bytes": s.size, "sha256": (s.lfs.sha256 if s.lfs else None)})
        out.append({"repo": repo, "type": rtype, "role": role, "private": info.private, "revision": info.sha,
                    "last_modified": str(info.last_modified), "files": files})
    (ML / "results" / "models_registry.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    for r in out:
        print(r["repo"], r.get("revision", r.get("error")), len(r.get("files", [])), "files")


if __name__ == "__main__":
    main()
