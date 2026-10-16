"""Download the pinned model files listed in models.lock.json and verify their SHA-256 (fails on any mismatch).

M1 comes from its HF model repo at the pinned revision. M3 and M5 are small CPU models; they come from the HF repo named in
the lock file, or are copied from ../artifacts when YL_LOCAL_ARTIFACTS=1 (after running the training scripts locally).
Private repos need HF_TOKEN in the environment.  Run: uv run python fetch_models.py
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCK = json.loads((HERE / "models.lock.json").read_text(encoding="utf-8"))
OUT = Path(os.environ.get("YL_MODELS_DIR", HERE / "models"))


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 22), b""):
            h.update(c)
    return h.hexdigest()


def main() -> int:
    from huggingface_hub import hf_hub_download
    bad = 0
    for key, spec in LOCK.items():
        d = OUT / key
        d.mkdir(parents=True, exist_ok=True)
        for fname, want in spec["files"].items():
            dst = d / fname
            if os.environ.get("YL_LOCAL_ARTIFACTS") == "1" and spec.get("local_dir"):
                shutil.copy(HERE.parent / spec["local_dir"] / fname, dst)
            else:
                src = hf_hub_download(spec["repo"], f"{spec.get('subfolder', '').strip('/') + '/' if spec.get('subfolder') else ''}{fname}",
                                      revision=spec["revision"])
                shutil.copy(src, dst)
            ok = sha256(dst) == want
            bad += not ok
            print(f"{key}/{fname}: {'ok' if ok else 'HASH MISMATCH'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
