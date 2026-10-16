"""Pull M4 result files from the HF model repos into ml/results/ (numbers are produced on Kaggle; nothing typed here).
Run from ml/: uv run python intent/fetch_results.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from common import keys  # noqa: E402

REPOS = {"qwen3.5-2b": "ABRUBAB/yl-intent-qwen3.5-2b", "qwen3.5-4b": "ABRUBAB/yl-intent-qwen3.5-4b",
         "qwen3-1.7b": "ABRUBAB/yl-intent-qwen3-1.7b", "qwen3-4b": "ABRUBAB/yl-intent-qwen3-4b"}


def main():
    from huggingface_hub import HfApi, hf_hub_download
    keys.use_hf("read")
    api = HfApi()
    out = HERE.parent / "results"
    for tag, repo in REPOS.items():
        try:
            rev = api.model_info(repo).sha
            r = json.loads(Path(hf_hub_download(repo, "results.json", revision=rev)).read_text())
        except Exception as e:  # noqa: BLE001
            print(tag, "not available:", type(e).__name__)
            continue
        r["hf_repo"], r["hf_revision"] = repo, rev
        r.pop("log_history", None)
        (out / f"m4_intent_{tag}.json").write_text(json.dumps(r, indent=1) + "\n", encoding="utf-8")
        print(tag, "test EM", r["test"]["overall"]["exact_match"], "bench EM", r["bench_legit"]["overall"]["exact_match"], "gguf", r.get("gguf", {}).get("file"))
    for repo, path in (("ABRUBAB/yl-intent-baselines", "results_gemma_zeroshot.json"),
                       ("ABRUBAB/yl-intent-qwen3.5-2b", "baselines/results_gemma_zeroshot.json")):
        try:
            g = json.loads(Path(hf_hub_download(repo, path)).read_text())
        except Exception:  # noqa: BLE001
            continue
        if "metrics" in g or not (out / "m4_gemma_zeroshot.json").exists():
            g["hf_repo"] = repo
            (out / "m4_gemma_zeroshot.json").write_text(json.dumps(g, indent=1) + "\n", encoding="utf-8")
            print("gemma", repo, g.get("metrics", {}).get("overall", g.get("error")))


if __name__ == "__main__":
    main()
