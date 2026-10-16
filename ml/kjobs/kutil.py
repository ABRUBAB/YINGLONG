"""Helpers shared by the Kaggle notebooks (runs on Kaggle, not locally).

The HuggingFace write token is read from a private Kaggle dataset attached to the kernel
(file hf_token.txt). It is placed into os.environ only and never printed.
"""
from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
import time

HF_USER = "ABRUBAB"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def hf_login() -> str:
    hits = glob.glob("/kaggle/input/**/hf_token.txt", recursive=True)
    if not hits:
        raise SystemExit("hf_token.txt not found in attached datasets")
    tok = open(hits[0], encoding="utf-8").read().strip()
    os.environ["HF_TOKEN"] = tok
    os.environ["HUGGING_FACE_HUB_TOKEN"] = tok
    return tok


def pip(*pkgs: str, check: bool = True) -> int:
    log("pip install", " ".join(pkgs))
    r = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--progress-bar", "off", "--no-warn-conflicts", *pkgs])
    if check and r.returncode != 0:
        raise SystemExit(f"pip failed: {pkgs}")
    return r.returncode


def gpu_info() -> str:
    try:
        return subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                              capture_output=True, text=True).stdout.strip()
    except Exception as e:  # noqa: BLE001
        return f"no nvidia-smi: {e}"


def ensure_repo(repo_id: str, repo_type: str):
    from huggingface_hub import HfApi
    api = HfApi()
    api.create_repo(repo_id, repo_type=repo_type, private=True, exist_ok=True)
    return api


def upload_file(repo_id: str, repo_type: str, local: str, remote: str, msg: str = "checkpoint"):
    from huggingface_hub import HfApi
    for attempt in range(5):
        try:
            return HfApi().upload_file(path_or_fileobj=local, path_in_repo=remote, repo_id=repo_id, repo_type=repo_type, commit_message=msg)
        except Exception as e:  # noqa: BLE001
            log("upload retry", attempt, type(e).__name__)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("upload failed")


def upload_folder(repo_id: str, repo_type: str, local: str, remote: str, msg: str = "checkpoint", revision: str | None = None):
    from huggingface_hub import HfApi
    for attempt in range(5):
        try:
            return HfApi().upload_folder(folder_path=local, path_in_repo=remote, repo_id=repo_id, repo_type=repo_type,
                                         commit_message=msg, revision=revision)
        except Exception as e:  # noqa: BLE001
            log("upload retry", attempt, type(e).__name__)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("upload failed")


def write_status(d: dict, path: str = "/kaggle/working/status.json"):
    d = dict(d, ts=time.strftime("%Y-%m-%dT%H:%M:%S"))
    with open(path, "w") as f:
        json.dump(d, f, indent=1)
