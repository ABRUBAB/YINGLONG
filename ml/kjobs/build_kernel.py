"""Bundle repo files into a single Kaggle script kernel and (optionally) push it.

The generated kernel lives OUTSIDE the repo (YL_WORK_DIR/kernels/<slug>). It embeds the listed
repo files as a base64 zip, extracts them to /tmp/yl_src on Kaggle and runs the entry module.
Secrets are never embedded: notebooks read the HuggingFace token from a private Kaggle dataset.

Usage (repo root):
  uv run --project ml python ml/kjobs/build_kernel.py --slug yl-datagen --entry ml/datagen/kaggle_datagen.py \
      --files ml/common ml/datagen bench/scenarios --account ac_1 --push [--args "--stage all"]
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "ml"))
from common import keys  # noqa: E402

TEMPLATE = '''# Auto-generated bundle for YINGLONG ML ({slug}). Source of truth: the YINGLONG repository, {entry}.
import base64, io, os, runpy, sys, zipfile
BUNDLE = "{b64}"
SRC = "/tmp/yl_src"
zipfile.ZipFile(io.BytesIO(base64.b64decode(BUNDLE))).extractall(SRC)
sys.path.insert(0, os.path.join(SRC, "ml"))
sys.argv = [os.path.join(SRC, "{entry}")] + {args!r}
runpy.run_path(os.path.join(SRC, "{entry}"), run_name="__main__")
'''


def bundle(paths: list[str]) -> str:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        seen = set()
        for p in paths:
            pp = REPO / p
            files = [pp] if pp.is_file() else [f for f in pp.rglob("*") if f.is_file() and "__pycache__" not in f.parts]
            for f in files:
                rel = f.relative_to(REPO).as_posix()
                if rel not in seen:
                    seen.add(rel)
                    z.write(f, rel)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True)
    ap.add_argument("--entry", required=True)
    ap.add_argument("--files", nargs="+", required=True)
    ap.add_argument("--account", default="ac_1")
    ap.add_argument("--datasets", nargs="*", default=["yl-hf-cred"])
    ap.add_argument("--args", default="")
    ap.add_argument("--no-gpu", action="store_true")
    ap.add_argument("--push", action="store_true")
    a = ap.parse_args()

    keys.use_kaggle_account(a.account)
    username = keys.KAGGLE_USERS[a.account]
    out = keys.WORK_DIR / "kernels" / f"{a.account}-{a.slug}"
    out.mkdir(parents=True, exist_ok=True)
    src = TEMPLATE.format(slug=a.slug, entry=a.entry, b64=bundle(a.files + [a.entry]), args=a.args.split() if a.args else [])
    (out / "script.py").write_text(src, encoding="utf-8")
    meta = {
        "id": f"{username}/{a.slug}", "title": a.slug, "code_file": "script.py", "language": "python", "kernel_type": "script",
        "is_private": True, "enable_gpu": not a.no_gpu, "enable_tpu": False, "enable_internet": True,
        "dataset_sources": [f"{username}/{d}" for d in a.datasets], "competition_sources": [], "kernel_sources": [], "model_sources": [],
    }
    if not a.no_gpu:
        meta["machine_shape"] = "NvidiaTeslaT4"
    (out / "kernel-metadata.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print("kernel dir:", out, "size KB:", round(len(src) / 1024))
    if a.push:
        cmd = ["kaggle", "kernels", "push", "-p", str(out)]
        if not a.no_gpu:
            cmd += ["--accelerator", "NvidiaTeslaT4"]
        r = subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ))
        print(r.stdout.strip()[-800:], r.stderr.strip()[-800:])


if __name__ == "__main__":
    main()
