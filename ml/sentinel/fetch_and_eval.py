"""Download M1 prediction files (ids + scores, no text) from the HF model repos and run sentinel/evaluate.py for each arm.
Run from ml/: uv run python sentinel/fetch_and_eval.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from common import keys  # noqa: E402

ARMS = {"mmbert": "ABRUBAB/yl-sentinel-mmbert-base", "mdeberta": "ABRUBAB/yl-sentinel-mdeberta-v3-base", "mmbert_small": "ABRUBAB/yl-sentinel-mmbert-small"}


def main():
    from huggingface_hub import HfApi, hf_hub_download
    keys.use_hf("read")
    api = HfApi()
    for arm, repo in ARMS.items():
        try:
            rev = api.model_info(repo).sha
            preds = hf_hub_download(repo, "predictions.jsonl", revision=rev)
            meta = hf_hub_download(repo, "yl_train_meta.json", revision=rev)
        except Exception as e:  # noqa: BLE001
            print(arm, "not available:", type(e).__name__)
            continue
        extra = json.dumps({"hf_repo": repo, "hf_revision": rev})
        subprocess.run([sys.executable, str(HERE / "evaluate.py"), "--arm", arm, "--preds", preds, "--meta", meta, "--extra", extra], check=True)
    try:
        repo = ARMS["mdeberta"]
        preds = hf_hub_download(repo, "baselines/predictions_protectai_v2.jsonl")
        extra = json.dumps({"model": "protectai/deberta-v3-base-prompt-injection-v2", "note": "off-the-shelf baseline, fixed threshold 0.5, no training"})
        subprocess.run([sys.executable, str(HERE / "evaluate.py"), "--arm", "protectai_v2", "--preds", preds, "--extra", extra], check=True)
    except Exception as e:  # noqa: BLE001
        print("baseline not available:", type(e).__name__)


if __name__ == "__main__":
    main()
