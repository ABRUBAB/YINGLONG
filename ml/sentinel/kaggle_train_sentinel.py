"""Kaggle job (2x T4): M1 Injection Sentinel, primary arm + control arm trained in parallel (one GPU each).

  arm mmbert  : jhu-clsp/mmBERT-base        (fp16)
  arm mdeberta: microsoft/mdeberta-v3-base  (fp16, automatic fp32 restart if the loss goes non-finite)
  baseline    : protectai/deberta-v3-base-prompt-injection-v2 (inference only, no training)

Data: private HF dataset ABRUBAB/yl-private-data, sentinel/v1/*.jsonl (built by ml/sentinel/build_data.py).
Bench evaluation sets (bench/attacks, bench/tasks) are bundled read-only; the held-out family is evaluation only.
Checkpoints: uploaded to the arm's private HF model repo (checkpoints/last) at least every 25 minutes; the job
resumes from there if restarted. Predictions are written WITHOUT text (ids and scores only).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from kjobs import kutil  # noqa: E402

DATA_REPO = f"{kutil.HF_USER}/yl-private-data"
ARMS = {
    "mmbert": {"base": "jhu-clsp/mmBERT-base", "repo": f"{kutil.HF_USER}/yl-sentinel-mmbert-base", "lr": 5e-5, "fp16": True},
    "mmbert_small": {"base": "jhu-clsp/mmBERT-small", "repo": f"{kutil.HF_USER}/yl-sentinel-mmbert-small", "lr": 8e-5, "fp16": True},
    "mdeberta": {"base": "microsoft/mdeberta-v3-base", "repo": f"{kutil.HF_USER}/yl-sentinel-mdeberta-v3-base", "lr": 2e-5, "fp16": True,
                 "bs": 8, "ga": 4},  # disentangled attention needs more memory: same effective batch (32) via accumulation
}
MAX_LEN, EPOCHS, BS = 320, 3, 32
CKPT_EVERY_S = 25 * 60
SRC = os.path.dirname(os.path.dirname(HERE))  # bundle root


def load_jsonl(p):
    with open(p, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def fetch_data(d="/tmp/sentinel_v1"):
    from huggingface_hub import snapshot_download
    p = snapshot_download(DATA_REPO, repo_type="dataset", allow_patterns=["sentinel/v1/*"], local_dir=d)
    return os.path.join(p, "sentinel", "v1")


def bench_eval_rows():
    rows = []
    adir = os.path.join(SRC, "bench", "attacks")
    for fn in sorted(os.listdir(adir)):
        for r in load_jsonl(os.path.join(adir, fn)):
            text = r["untrusted_content"] if r["family"] != "direct_injection" else r["user_task"]
            rows.append({"id": r["id"], "text": text, "label": 1, "split": "bench_heldout" if r.get("heldout") else "bench_attack",
                         "kind": r["family"], "language": r["language"], "source": "bench", "sentinel_relevant": r.get("sentinel_relevant", True)})
    for r in load_jsonl(os.path.join(SRC, "bench", "tasks", "legit.jsonl")):
        rows.append({"id": r["id"] + ":request", "text": r["user_request"], "label": 0, "split": "bench_legit", "kind": "user_request",
                     "language": r["language"], "source": "bench"})
        if r.get("context_document"):
            rows.append({"id": r["id"] + ":doc", "text": r["context_document"], "label": 0, "split": "bench_legit", "kind": f"doc_{r.get('context_channel')}",
                         "language": r["language"], "source": "bench"})
    return rows


class Uploader:
    def __init__(self, repo):
        self.repo, self.last = repo, time.time()

    def push(self, folder, remote, msg):
        kutil.upload_folder(self.repo, "model", folder, remote, msg=msg)
        self.last = time.time()


def predict(model, tok, rows, device, bs=64):
    import torch
    model.eval()
    out = []
    with torch.no_grad():
        for i in range(0, len(rows), bs):
            part = rows[i:i + bs]
            enc = tok([r["text"] for r in part], truncation=True, max_length=MAX_LEN, padding=True, return_tensors="pt").to(device)
            with torch.autocast("cuda", dtype=torch.float16):
                logits = model(**enc).logits.float()
            p = torch.softmax(logits, -1)[:, 1].cpu().tolist()
            for r, s in zip(part, p):
                out.append({k: r.get(k) for k in ("id", "split", "label", "kind", "language", "source", "channel", "sentinel_relevant")} | {"score": round(s, 6)})
    return out


def train_arm(arm: str, data_dir: str):
    import numpy as np
    import torch
    from datasets import Dataset
    from huggingface_hub import HfApi, snapshot_download
    from transformers import (AutoModelForSequenceClassification, AutoTokenizer, DataCollatorWithPadding, Trainer, TrainerCallback,
                              TrainingArguments)

    cfg = ARMS[arm]
    kutil.ensure_repo(cfg["repo"], "model")
    up = Uploader(cfg["repo"])
    tok = AutoTokenizer.from_pretrained(cfg["base"])
    train = load_jsonl(os.path.join(data_dir, "train.jsonl"))
    # domain upweighting: finance synthetic rows twice
    train = train + [r for r in train if r["source"] == "yl_finance_synth"]
    val = load_jsonl(os.path.join(data_dir, "validation.jsonl"))
    kutil.log(arm, "train rows", len(train), "val rows", len(val))

    def enc(batch):
        return tok(batch["text"], truncation=True, max_length=MAX_LEN)
    dtr = Dataset.from_list([{"text": r["text"], "label": r["label"]} for r in train]).map(enc, batched=True, remove_columns=["text"])
    dva = Dataset.from_list([{"text": r["text"], "label": r["label"]} for r in val]).map(enc, batched=True, remove_columns=["text"])
    out_dir = f"/tmp/run_{arm}"
    resume = None
    try:
        files = HfApi().list_repo_files(cfg["repo"])
        if any(f.startswith("checkpoints/last/") and f.endswith("trainer_state.json") for f in files):
            p = snapshot_download(cfg["repo"], allow_patterns=["checkpoints/last/*"], local_dir=f"/tmp/resume_{arm}")
            resume = os.path.join(p, "checkpoints", "last")
            kutil.log(arm, "resuming from hub checkpoint")
    except Exception as e:  # noqa: BLE001
        kutil.log(arm, "no resume:", type(e).__name__)

    class HubCkpt(TrainerCallback):
        def on_step_end(self, args, state, control, **kw):
            if time.time() - up.last > CKPT_EVERY_S:
                control.should_save = True

        def on_save(self, args, state, control, **kw):
            ck = os.path.join(args.output_dir, f"checkpoint-{state.global_step}")
            if os.path.isdir(ck):
                up.push(ck, "checkpoints/last", f"{arm} checkpoint step {state.global_step}")
                kutil.log(arm, "checkpoint uploaded at step", state.global_step)
            kutil.write_status({"arm": arm, "step": state.global_step, "max_steps": state.max_steps}, f"/kaggle/working/status_{arm}.json")

        def on_log(self, args, state, control, logs=None, **kw):
            if logs and "loss" in logs and not math.isfinite(logs["loss"]):
                kutil.log(arm, "non-finite loss; stopping for fp32 restart")
                control.should_training_stop = True
                state.nonfinite = True

    def compute_metrics(p):
        pred = p.predictions.argmax(-1)
        y = p.label_ids
        f1s = []
        for c in (0, 1):
            tp = ((pred == c) & (y == c)).sum(); fp = ((pred == c) & (y != c)).sum(); fn = ((pred != c) & (y == c)).sum()
            f1s.append(2 * tp / max(1, 2 * tp + fp + fn))
        return {"macro_f1": float(np.mean(f1s))}

    for fp16 in ([True, False] if cfg["fp16"] else [False]):
        # transformers 5 loads the checkpoint dtype by default; mixed precision needs fp32 master weights
        model = AutoModelForSequenceClassification.from_pretrained(cfg["base"], num_labels=2, dtype=torch.float32)
        args = TrainingArguments(output_dir=out_dir, per_device_train_batch_size=cfg.get("bs", BS), gradient_accumulation_steps=cfg.get("ga", 1),
                                 per_device_eval_batch_size=32, learning_rate=cfg["lr"],
                                 num_train_epochs=EPOCHS, warmup_steps=0.06, weight_decay=0.01, lr_scheduler_type="linear", fp16=fp16,
                                 eval_strategy="epoch", save_strategy="epoch", save_total_limit=2, logging_steps=50, report_to=[],
                                 load_best_model_at_end=True, metric_for_best_model="macro_f1", greater_is_better=True,
                                 dataloader_num_workers=2, seed=42, max_grad_norm=1.0)
        tr = Trainer(model=model, args=args, train_dataset=dtr, eval_dataset=dva, data_collator=DataCollatorWithPadding(tok),
                     compute_metrics=compute_metrics, callbacks=[HubCkpt()])
        t0 = time.time()
        tr.train(resume_from_checkpoint=resume)
        if getattr(tr.state, "nonfinite", False) and fp16:
            shutil.rmtree(out_dir, ignore_errors=True)
            resume = None
            cfg["fp16_used"] = False
            continue
        cfg["fp16_used"] = fp16
        break
    train_secs = time.time() - t0
    final = f"/tmp/final_{arm}"
    tr.save_model(final)
    tok.save_pretrained(final)
    device = "cuda"
    model = tr.model.to(device)
    rows = []
    for split in ("validation", "test", "ext_test"):
        rows += load_jsonl(os.path.join(data_dir, f"{split}.jsonl"))
    rows += bench_eval_rows()
    t0 = time.time()
    preds = predict(model, tok, rows, device)
    infer_secs = time.time() - t0
    meta = {"arm": arm, "base": cfg["base"], "fp16": cfg.get("fp16_used"), "max_len": MAX_LEN, "epochs": EPOCHS, "batch_size": BS, "lr": cfg["lr"],
            "train_rows": len(train), "train_secs": round(train_secs), "gpu_infer_secs": round(infer_secs, 1),
            "best_metric": tr.state.best_metric, "log_history": tr.state.log_history}
    with open(os.path.join(final, "yl_train_meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    with open(os.path.join(final, "predictions.jsonl"), "w") as f:
        for p in preds:
            f.write(json.dumps(p) + "\n")
    shutil.copy(os.path.join(final, "predictions.jsonl"), f"/kaggle/working/predictions_{arm}.jsonl")
    shutil.copy(os.path.join(final, "yl_train_meta.json"), f"/kaggle/working/meta_{arm}.json")
    up.push(final, ".", f"{arm} final model")
    kutil.log(arm, "final uploaded; best macro-F1 (val)", tr.state.best_metric)


def baseline(data_dir: str):
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    name = "protectai/deberta-v3-base-prompt-injection-v2"
    tok = AutoTokenizer.from_pretrained(name)
    model = AutoModelForSequenceClassification.from_pretrained(name).to("cuda")
    rows = []
    for split in ("test", "ext_test"):
        rows += load_jsonl(os.path.join(data_dir, f"{split}.jsonl"))
    rows += bench_eval_rows()
    preds = predict(model, tok, rows, "cuda")
    with open("/kaggle/working/predictions_protectai_v2.jsonl", "w") as f:
        for p in preds:
            f.write(json.dumps(p) + "\n")
    kutil.upload_file(ARMS["mdeberta"]["repo"], "model", "/kaggle/working/predictions_protectai_v2.jsonl", "baselines/predictions_protectai_v2.jsonl", "baseline preds")
    kutil.log("baseline done", len(preds))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker", choices=list(ARMS) + ["baseline"])
    ap.add_argument("--arms", default="mmbert,mdeberta")
    ap.add_argument("--skip-baseline", action="store_true")
    a = ap.parse_args()
    kutil.hf_login()
    if a.worker:
        d = fetch_data(f"/tmp/sentinel_v1_{a.worker}")
        train_arm(a.worker, d) if a.worker != "baseline" else baseline(d)
        return
    kutil.log("GPU:", kutil.gpu_info())
    subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchaudio"])
    procs = {}
    for i, arm in enumerate(a.arms.split(",")):
        env = dict(os.environ, CUDA_VISIBLE_DEVICES=str(i), TOKENIZERS_PARALLELISM="false")
        procs[arm] = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--worker", arm], env=env)
    rc = {arm: p.wait() for arm, p in procs.items()}
    kutil.log("arm exit codes", rc)
    if not a.skip_baseline:
        env = dict(os.environ, CUDA_VISIBLE_DEVICES="1")
        rc["baseline"] = subprocess.run([sys.executable, os.path.abspath(__file__), "--worker", "baseline"], env=env).returncode
    kutil.write_status({"exit_codes": rc, "finished": True})


if __name__ == "__main__":
    main()
