"""Publish the CPU models (M3, M5) to a private HF repo and write ml/serving/models.lock.json from the actual files.

M1 entries come from ml/results/m1_onnx_<name>.json and m1_sentinel_<arm>.json (repo, revision of the ONNX upload, threshold).
Every hash written here is computed from the file, never typed. Run (repo root): uv run --project ml python ml/scripts/publish_models.py
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))
from common import keys  # noqa: E402

CPU_REPO = "ABRUBAB/yl-cpu-models"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    from huggingface_hub import HfApi
    keys.use_hf("write")
    api = HfApi()
    api.create_repo(CPU_REPO, repo_type="model", private=True, exist_ok=True)
    lock = {}
    for key, sub in (("m3", "m3"), ("m5", "m5")):
        d = ML / "artifacts" / sub
        files = sorted(p for p in d.iterdir() if p.is_file())
        info = api.upload_folder(folder_path=str(d), path_in_repo=sub, repo_id=CPU_REPO, commit_message=f"{sub} CPU models")
        lock[key] = {"repo": CPU_REPO, "revision": info.oid, "subfolder": sub, "local_dir": f"artifacts/{sub}", "files": {p.name: sha(p) for p in files}}
    onnx = sorted((ML / "results").glob("m1_onnx_*.json"))
    sent = ML / "results" / "m1_sentinel_mmbert.json"
    if onnx and sent.exists():
        o = json.loads(onnx[0].read_text())
        s = json.loads(sent.read_text())
        name = o["repo"].split("/")[-1]
        art = ML / "artifacts" / "m1" / name
        files = {"model_int8.onnx": o["int8_sha256"], "tokenizer.json": sha(art / "tokenizer.json")}
        lock["m1"] = {"repo": o["repo"], "revision": o["onnx_upload_commit"], "subfolder": "onnx", "local_dir": f"artifacts/m1/{name}",
                      "files": files, "threshold": s["at_selected_threshold"]["threshold"], "max_len": 320}
    (ML / "serving" / "models.lock.json").write_text(json.dumps(lock, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: {"repo": v["repo"], "revision": v["revision"]} for k, v in lock.items()}, indent=1))


if __name__ == "__main__":
    main()
