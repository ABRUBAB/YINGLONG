"""Download the pinned model files listed in models.lock.json and verify their SHA-256 (fails on any mismatch).

M1 comes from its HF model repo at the pinned revision. M3 and M5 are small CPU models; they come from the HF repo named in
the lock file, or are copied from ../artifacts when YL_LOCAL_ARTIFACTS=1 (after running the training scripts locally).
Only the models named in YL_MODELS (default m1,m3,m5) are fetched. A file already present with the pinned hash is kept, so a
container restart with a populated volume needs no network and no token.
Private repos need a READ token: HF_TOKEN in the environment, or HF_TOKEN_FILE naming a file that holds it (bare value,
"KEY=value" or a line containing an hf_ token). The token is never printed or written anywhere.
Run: uv run python fetch_models.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
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


def read_token() -> str | None:
    tok = os.environ.get("HF_TOKEN", "").strip()
    if tok:
        return tok
    path = os.environ.get("HF_TOKEN_FILE")
    if not path or not Path(path).is_file():
        return None
    raw = Path(path).read_text(encoding="utf-8-sig").strip()
    m = re.search(r"hf_[A-Za-z0-9]{20,}", raw)
    if m:
        return m.group(0)
    if raw and not re.search(r"\s", raw):
        return raw.rsplit("=", 1)[-1].strip("\"'")
    return None


def main() -> int:
    enabled = [k.strip() for k in os.environ.get("YL_MODELS", "m1,m3,m5").split(",") if k.strip()]
    token = read_token()
    bad = 0
    for key, spec in LOCK.items():
        if key not in enabled:
            continue
        d = OUT / key
        d.mkdir(parents=True, exist_ok=True)
        for fname, want in spec["files"].items():
            dst = d / fname
            if dst.exists() and sha256(dst) == want:
                print(f"{key}/{fname}: ok (already present)")
                continue
            if os.environ.get("YL_LOCAL_ARTIFACTS") == "1" and spec.get("local_dir"):
                shutil.copy(HERE.parent / spec["local_dir"] / fname, dst)
            else:
                from huggingface_hub import hf_hub_download
                sub = spec.get("subfolder", "").strip("/")
                stage = OUT / ".download"
                try:
                    src = hf_hub_download(spec["repo"], f"{sub}/{fname}" if sub else fname, revision=spec["revision"],
                                          token=token, local_dir=str(stage))
                    shutil.move(src, dst)
                finally:
                    shutil.rmtree(stage, ignore_errors=True)
            ok = sha256(dst) == want
            if not ok:
                dst.unlink(missing_ok=True)  # never leave an unverified file where the service would look
            bad += not ok
            print(f"{key}/{fname}: {'ok' if ok else 'HASH MISMATCH'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
