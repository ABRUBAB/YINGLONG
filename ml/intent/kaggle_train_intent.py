"""Kaggle job (2x T4): M4 intent model, LoRA with Unsloth in fp16 (T4 has no bf16), non-thinking mode.

Stages
  1. smoke : 50-step fp16 smoke test of Qwen/Qwen3.5-2B on GPU 0. If the loss is non-finite or does not fall,
             both arms switch to the fallback family (Qwen/Qwen3-1.7B and Qwen/Qwen3-4B).
  2. train : arm 2b on GPU 0 and arm 4b on GPU 1 in parallel (r 16, alpha 16, dropout 0, all linear projections
             of the language model, adamw_8bit, lr 2e-4 cosine, 2 epochs).
  3. eval  : greedy decoding on the held-out test split and on the 240 YINGLONG-Bench legit tasks (written by a
             different model family); JSON validity, canonical exact match, slot F1 with Wilson intervals.
  4. export: LoRA adapter + GGUF Q4_K_M uploaded to the arm's private HF model repo.
  5. gemma : zero-shot google/gemma-4-E2B-it on a test sample (GPU 0 after arm 2b finishes; best effort).
Checkpoints go to HF (checkpoints/last) at least every 25 minutes; a restarted job resumes from them.
Saved predictions have any CJK characters masked; Chinese rows exist only in the private HF dataset.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import intent_sampler as S  # noqa: E402
from common import prompts, schema  # noqa: E402
from intent import metrics  # noqa: E402
from kjobs import kutil  # noqa: E402

DATA_REPO = f"{kutil.HF_USER}/yl-private-data"
ARMS = {
    "2b": {"base": "Qwen/Qwen3.5-2B", "fallback": "Qwen/Qwen3-1.7B", "repo": f"{kutil.HF_USER}/yl-intent-qwen3.5-2b", "bs": 4, "ga": 4},
    "4b": {"base": "Qwen/Qwen3.5-4B", "fallback": "Qwen/Qwen3-4B", "repo": f"{kutil.HF_USER}/yl-intent-qwen3.5-4b", "bs": 2, "ga": 8},
}
MAX_LEN = 768
CKPT_EVERY_S = 25 * 60
SRC = os.path.dirname(os.path.dirname(HERE))
UNSLOTH = ["unsloth==2026.10.6", "unsloth_zoo==2026.10.6"]


def load_jsonl(p):
    with open(p, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def fetch_data():
    from huggingface_hub import snapshot_download
    p = snapshot_download(DATA_REPO, repo_type="dataset", allow_patterns=["intent/v1/*"], local_dir=f"/tmp/intent_v1_{os.getpid()}")
    return os.path.join(p, "intent", "v1")


def bench_rows():
    rows = []
    for r in load_jsonl(os.path.join(SRC, "bench", "tasks", "legit.jsonl")):
        rows.append({"id": r["id"], "task": "intent", "scenario": r["scenario"], "today": r["today"], "language": r["language"],
                     "text": r["user_request"], "label": r["expected_intent"], "split": "bench_legit"})
    return rows


def mask_cjk(s: str) -> str:
    return schema.CJK_RE.sub("?", s)


def load_model(name: str, fp16=True):
    import torch
    from unsloth import FastLanguageModel
    try:
        model, tok = FastLanguageModel.from_pretrained(name, max_seq_length=MAX_LEN, dtype=torch.float16, load_in_4bit=False)
        loader = "FastLanguageModel"
    except Exception as e:  # noqa: BLE001
        kutil.log("FastLanguageModel failed:", type(e).__name__, str(e)[:300])
        from unsloth import FastModel
        model, tok = FastModel.from_pretrained(name, max_seq_length=MAX_LEN, dtype=torch.float16, load_in_4bit=False)
        loader = "FastModel"
    return model, tok, loader


def text_tok(tok):
    return getattr(tok, "tokenizer", tok)


def render_prompt(tok, msgs):
    t = text_tok(tok)
    try:
        return t.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    except Exception:  # noqa: BLE001
        m2 = [{"role": m["role"], "content": [{"type": "text", "text": m["content"]}]} for m in msgs]
        return tok.apply_chat_template(m2, tokenize=False, add_generation_prompt=True, enable_thinking=False)


def lora_targets(model) -> list[str]:
    import torch.nn as nn
    names = set()
    for n, m in model.named_modules():
        if isinstance(m, nn.Linear) and not re.search(r"vision|visual|merger|lm_head|embed|audio", n):
            names.add(n.split(".")[-1])
    return sorted(names)


def encode(rows, tok, scen):
    t = text_tok(tok)
    out = []
    for r in rows:
        sc = scen[r["scenario"]]
        prompt = render_prompt(tok, prompts.messages(r["task"], sc, r["today"], r["text"]))
        target = schema.dumps(r["label"]) + "<|im_end|>"
        p_ids = t(prompt, add_special_tokens=False)["input_ids"]
        t_ids = t(target, add_special_tokens=False)["input_ids"]
        ids = (p_ids + t_ids)[:MAX_LEN]
        labels = ([-100] * len(p_ids) + t_ids)[:MAX_LEN]
        out.append({"input_ids": ids, "attention_mask": [1] * len(ids), "labels": labels})
    return out


def generate(model, tok, rows, scen, bs=16, max_new=256):
    import torch
    t = text_tok(tok)
    t.padding_side = "left"
    if t.pad_token is None:
        t.pad_token = t.eos_token
    outs = []
    order = sorted(range(len(rows)), key=lambda i: len(rows[i]["text"]))
    res = [None] * len(rows)
    for k in range(0, len(order), bs):
        idx = order[k:k + bs]
        ps = [render_prompt(tok, prompts.messages(rows[i]["task"], scen[rows[i]["scenario"]], rows[i]["today"], rows[i]["text"])) for i in idx]
        enc = t(ps, return_tensors="pt", padding=True, add_special_tokens=False).to("cuda")
        with torch.no_grad():
            g = model.generate(**enc, max_new_tokens=max_new, do_sample=False, temperature=None, top_p=None, top_k=None,
                               pad_token_id=t.pad_token_id)
        for j, i in enumerate(idx):
            res[i] = t.decode(g[j][enc["input_ids"].shape[1]:], skip_special_tokens=True)
    return res


def evaluate(model, tok, scen, test_rows, tag):
    t0 = time.time()
    preds = generate(model, tok, test_rows, scen)
    secs = time.time() - t0
    scored = [{"task": r["task"], "language": r["language"], "gold": r["label"], "pred_text": p,
               "payee_ids": [x["id"] for x in scen[r["scenario"]]["payees"]]} for r, p in zip(test_rows, preds)]
    m = metrics.score(scored)
    m["gen_secs"] = round(secs, 1)
    with open(f"/kaggle/working/preds_{tag}.jsonl", "w", encoding="utf-8") as f:
        for r, p in zip(test_rows, preds):
            f.write(json.dumps({"id": r["id"], "split": r["split"], "task": r["task"], "language": r["language"], "pred": mask_cjk(p)}, ensure_ascii=True) + "\n")
    return m


def train_worker(arm: str, fallback: bool, smoke: bool):
    import unsloth  # noqa: F401  (must be imported before transformers so its patches apply)
    import torch
    from huggingface_hub import HfApi, snapshot_download
    from transformers import DataCollatorForSeq2Seq, Trainer, TrainerCallback, TrainingArguments
    from datasets import Dataset

    cfg = ARMS[arm]
    name = cfg["fallback"] if fallback else cfg["base"]
    scen = S.load_scenarios()
    d = fetch_data()
    train = load_jsonl(os.path.join(d, "train.jsonl"))
    val = load_jsonl(os.path.join(d, "val.jsonl"))
    test = load_jsonl(os.path.join(d, "test.jsonl"))
    t0 = time.time()
    model, tok, loader = load_model(name)
    targets = lora_targets(model)
    kutil.log(arm, "loaded", name, "via", loader, "lora targets", targets, "secs", round(time.time() - t0))
    from unsloth import FastLanguageModel, FastModel
    FM = FastLanguageModel if loader == "FastLanguageModel" else FastModel
    peft_kw = dict(r=16, lora_alpha=16, lora_dropout=0, bias="none", target_modules=targets, use_gradient_checkpointing="unsloth", random_state=3407)
    if FM is FastModel:
        peft_kw.update(finetune_vision_layers=False, finetune_language_layers=True, finetune_attention_modules=True, finetune_mlp_modules=True)
    model = FM.get_peft_model(model, **peft_kw)
    rng = random.Random(3407)
    if smoke:
        train = rng.sample(train, min(len(train), 50 * cfg["bs"] * cfg["ga"]))
    dtr = Dataset.from_list(encode(train, tok, scen))
    dva = Dataset.from_list(encode(val[:100], tok, scen))
    out_dir = f"/tmp/run_{arm}{'_smoke' if smoke else ''}"
    repo = cfg["repo"] if not fallback else f"{kutil.HF_USER}/yl-intent-{name.split('/')[-1].lower()}"
    resume = None
    if not smoke:
        kutil.ensure_repo(repo, "model")
        try:
            files = HfApi().list_repo_files(repo)
            if any(f.startswith("checkpoints/last/") and f.endswith("trainer_state.json") for f in files):
                p = snapshot_download(repo, allow_patterns=["checkpoints/last/*"], local_dir=f"/tmp/resume_{arm}")
                st = json.load(open(os.path.join(p, "checkpoints", "last", "yl_ckpt_meta.json")))
                if st.get("base") == name:
                    resume = os.path.join(p, "checkpoints", "last")
                    kutil.log(arm, "resuming from hub checkpoint")
        except Exception as e:  # noqa: BLE001
            kutil.log(arm, "no resume:", type(e).__name__)
    last_up = [time.time()]
    losses = []
    step_times: dict[int, float] = {}

    class CB(TrainerCallback):
        def on_step_end(self, args, state, control, **kw):
            step_times[state.global_step] = time.time()
            if not smoke and time.time() - last_up[0] > CKPT_EVERY_S:
                control.should_save = True

        def on_save(self, args, state, control, **kw):
            if smoke:
                return
            ck = os.path.join(args.output_dir, f"checkpoint-{state.global_step}")
            if os.path.isdir(ck):
                json.dump({"base": name, "step": state.global_step}, open(os.path.join(ck, "yl_ckpt_meta.json"), "w"))
                kutil.upload_folder(repo, "model", ck, "checkpoints/last", msg=f"{arm} checkpoint step {state.global_step}")
                last_up[0] = time.time()
                kutil.log(arm, "checkpoint uploaded step", state.global_step)
            kutil.write_status({"arm": arm, "step": state.global_step, "max_steps": state.max_steps}, f"/kaggle/working/status_{arm}.json")

        def on_log(self, args, state, control, logs=None, **kw):
            if logs and "loss" in logs:
                losses.append(logs["loss"])

    args = TrainingArguments(
        output_dir=out_dir, per_device_train_batch_size=cfg["bs"], gradient_accumulation_steps=cfg["ga"], per_device_eval_batch_size=1,
        num_train_epochs=2 if not smoke else 1, max_steps=50 if smoke else -1, learning_rate=2e-4, lr_scheduler_type="cosine",
        warmup_steps=0.03, weight_decay=0.0, optim="adamw_8bit", fp16=True, bf16=False, logging_steps=5 if smoke else 20,
        save_strategy="no" if smoke else "steps", save_steps=300, save_total_limit=2, eval_strategy="no", report_to=[],
        seed=3407, max_grad_norm=1.0, dataloader_num_workers=1, train_sampling_strategy="group_by_length")
    tr = Trainer(model=model, args=args, train_dataset=dtr, data_collator=DataCollatorForSeq2Seq(text_tok(tok), padding=True, label_pad_token_id=-100),
                 callbacks=[CB()])
    t0 = time.time()
    tr.train(resume_from_checkpoint=resume)
    train_secs = time.time() - t0
    if smoke:
        import math
        ok = len(losses) >= 4 and all(math.isfinite(x) for x in losses) and (sum(losses[-3:]) / 3) < (sum(losses[:3]) / 3)
        sec_per_step = (step_times[50] - step_times[10]) / 40 if 50 in step_times and 10 in step_times else train_secs / 50
        full_steps = (len(load_jsonl(os.path.join(d, "train.jsonl"))) * 2) // (cfg["bs"] * cfg["ga"])
        json.dump({"model": name, "loader": loader, "steps": 50, "losses": losses, "ok": ok, "secs": round(train_secs),
                   "sec_per_step": round(sec_per_step, 2), "full_steps": full_steps, "est_full_hours": round(sec_per_step * full_steps / 3600, 2),
                   "peak_mem_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2)}, open(f"/kaggle/working/smoke_{arm}.json", "w"), indent=1)
        kutil.log("smoke", arm, "ok" if ok else "FAILED", losses[:3], losses[-3:])
        return
    # eval loss on val
    ev = tr.evaluate(dva) if len(dva) else {}
    FM.for_inference(model)
    res = {"arm": arm, "base": name, "loader": loader, "lora": {"r": 16, "alpha": 16, "dropout": 0, "targets": targets},
           "train_rows": len(train), "epochs": 2, "lr": 2e-4, "effective_batch": cfg["bs"] * cfg["ga"], "fp16": True,
           "train_secs": round(train_secs), "val_loss": ev.get("eval_loss"), "peak_mem_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2),
           "log_history": tr.state.log_history}
    res["test"] = evaluate(model, tok, scen, test, f"{arm}_test")
    res["bench_legit"] = evaluate(model, tok, scen, bench_rows(), f"{arm}_bench")
    kutil.log(arm, "test EM", res["test"]["overall"]["exact_match"], "bench EM", res["bench_legit"]["overall"]["exact_match"])
    json.dump(res, open(f"/kaggle/working/results_{arm}.json", "w"), indent=1)
    kutil.upload_file(repo, "model", f"/kaggle/working/results_{arm}.json", "results.json", "results")
    for tag in ("test", "bench"):
        kutil.upload_file(repo, "model", f"/kaggle/working/preds_{arm}_{tag}.jsonl", f"preds_{tag}.jsonl", "predictions")
    ad = f"/tmp/adapter_{arm}"
    model.save_pretrained(ad)
    text_tok(tok).save_pretrained(ad)
    kutil.upload_folder(repo, "model", ad, "adapter", msg=f"{arm} LoRA adapter")
    # GGUF export (Unsloth first, then a manual llama.cpp conversion as fallback)
    try:
        gd = f"/tmp/gguf_{arm}"
        try:
            model.save_pretrained_gguf(gd, text_tok(tok), quantization_method="q4_k_m")
            ggufs = [os.path.join(dp, f) for dp, _, fs in os.walk(gd) for f in fs if f.endswith(".gguf")]
            ggufs += [f for f in os.listdir(".") if f.endswith(".gguf")]
            res["gguf_path"] = "unsloth"
        except Exception as e:  # noqa: BLE001
            kutil.log(arm, "unsloth GGUF failed, manual llama.cpp path:", type(e).__name__, str(e)[:200])
            ggufs = [manual_gguf(model, tok, arm)]
            res["gguf_path"] = "manual llama.cpp"
        q4 = [g for g in ggufs if "q4_k_m" in g.lower()] or ggufs
        import hashlib
        h = hashlib.sha256()
        with open(q4[0], "rb") as f:
            for chunk in iter(lambda: f.read(1 << 24), b""):
                h.update(chunk)
        fname = f"yl-intent-{arm}-{os.path.basename(name).lower()}-Q4_K_M.gguf"
        kutil.upload_file(repo, "model", q4[0], fname, "GGUF Q4_K_M")
        res["gguf"] = {"file": fname, "bytes": os.path.getsize(q4[0]), "sha256": h.hexdigest()}
    except Exception as e:  # noqa: BLE001
        res["gguf"] = {"error": f"{type(e).__name__}: {str(e)[:300]}"}
        kutil.log(arm, "GGUF export failed", res["gguf"]["error"])
    json.dump(res, open(f"/kaggle/working/results_{arm}.json", "w"), indent=1)
    kutil.upload_file(repo, "model", f"/kaggle/working/results_{arm}.json", "results.json", "results + gguf")
    kutil.log(arm, "done")


def manual_gguf(model, tok, arm: str) -> str:
    merged = f"/tmp/merged_{arm}"
    try:
        model.save_pretrained_merged(merged, text_tok(tok), save_method="merged_16bit")
    except Exception:  # noqa: BLE001
        m = model.merge_and_unload()
        m.save_pretrained(merged)
        text_tok(tok).save_pretrained(merged)
    lc = "/tmp/llama.cpp"
    if not os.path.isdir(lc):
        subprocess.run(["git", "clone", "--depth", "1", "https://github.com/ggml-org/llama.cpp", lc], check=True)
    kutil.pip("gguf", "sentencepiece", check=False)
    env = dict(os.environ, PYTHONPATH=os.path.join(lc, "gguf-py"))
    f16 = f"/tmp/{arm}-f16.gguf"
    subprocess.run([sys.executable, os.path.join(lc, "convert_hf_to_gguf.py"), merged, "--outtype", "f16", "--outfile", f16], check=True, env=env)
    subprocess.run(["cmake", "-S", lc, "-B", f"{lc}/build", "-DGGML_CUDA=OFF", "-DLLAMA_CURL=OFF", "-DLLAMA_BUILD_TESTS=OFF"], check=True)
    subprocess.run(["cmake", "--build", f"{lc}/build", "--target", "llama-quantize", "-j", "4"], check=True)
    q4 = f"/tmp/{arm}-q4_k_m.gguf"
    subprocess.run([f"{lc}/build/bin/llama-quantize", f16, q4, "Q4_K_M"], check=True)
    return q4


def gemma_worker():
    import torch
    scen = S.load_scenarios()
    d = fetch_data()
    test = load_jsonl(os.path.join(d, "test.jsonl"))
    rng = random.Random(1)
    sample = rng.sample(test, min(300, len(test)))
    try:
        from unsloth import FastModel
        model, tok = FastModel.from_pretrained("google/gemma-4-E2B-it", max_seq_length=MAX_LEN, dtype=torch.float16, load_in_4bit=False)
        FastModel.for_inference(model)
        t = text_tok(tok)
        res_rows = []
        for r in sample:
            msgs = prompts.messages(r["task"], scen[r["scenario"]], r["today"], r["text"])
            msgs = [{"role": "user", "content": [{"type": "text", "text": msgs[0]["content"] + "\n\nMessage:\n" + msgs[1]["content"]}]}]
            enc = tok.apply_chat_template(msgs, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt").to("cuda")
            with torch.no_grad():
                g = model.generate(**enc, max_new_tokens=256, do_sample=False)
            res_rows.append(t.decode(g[0][enc["input_ids"].shape[1]:], skip_special_tokens=True))
        scored = [{"task": r["task"], "language": r["language"], "gold": r["label"], "pred_text": p,
                   "payee_ids": [x["id"] for x in scen[r["scenario"]]["payees"]]} for r, p in zip(sample, res_rows)]
        out = {"model": "google/gemma-4-E2B-it", "mode": "zero-shot, same system prompt, fp16", "test_sample": len(sample), "metrics": metrics.score(scored)}
    except Exception as e:  # noqa: BLE001
        out = {"model": "google/gemma-4-E2B-it", "error": f"{type(e).__name__}: {str(e)[:400]}"}
    json.dump(out, open("/kaggle/working/results_gemma_zeroshot.json", "w"), indent=1)
    kutil.ensure_repo(f"{kutil.HF_USER}/yl-intent-baselines", "model")
    kutil.upload_file(f"{kutil.HF_USER}/yl-intent-baselines", "model", "/kaggle/working/results_gemma_zeroshot.json", "results_gemma_zeroshot.json", "gemma zero-shot")
    kutil.log("gemma done", "error" in out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker", choices=["smoke", "train", "gemma"])
    ap.add_argument("--arm", choices=list(ARMS))
    ap.add_argument("--fallback", action="store_true")
    ap.add_argument("--skip-smoke", action="store_true")
    ap.add_argument("--force-fallback", action="store_true", help="use the Qwen3 fallback family for both arms (Qwen3.5 runs only in fp32 on T4)")
    a = ap.parse_args()
    kutil.hf_login()
    if a.worker == "smoke":
        return train_worker(a.arm, a.fallback, smoke=True)
    if a.worker == "train":
        return train_worker(a.arm, a.fallback, smoke=False)
    if a.worker == "gemma":
        return gemma_worker()
    kutil.log("GPU:", kutil.gpu_info())
    kutil.pip(*UNSLOTH)
    subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchaudio"])
    # fast kernels for the Qwen3.5 linear-attention layers (fall back to the reference implementation if they fail)
    if not a.force_fallback:  # only the Qwen3.5 linear-attention layers need these
        kutil.pip("flash-linear-attention", check=False)
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--no-build-isolation", "causal-conv1d"], timeout=900)
        except subprocess.TimeoutExpired:
            kutil.log("causal-conv1d build timed out; using the reference implementation")
    me = os.path.abspath(__file__)
    env0 = dict(os.environ, CUDA_VISIBLE_DEVICES="0", TOKENIZERS_PARALLELISM="false")
    env1 = dict(os.environ, CUDA_VISIBLE_DEVICES="1", TOKENIZERS_PARALLELISM="false")
    fallback = a.force_fallback
    if not a.skip_smoke:
        r = subprocess.run([sys.executable, me, "--worker", "smoke", "--arm", "2b"] + (["--fallback"] if fallback else []), env=env0)
        ok = False
        try:
            ok = json.load(open("/kaggle/working/smoke_2b.json"))["ok"]
        except Exception:  # noqa: BLE001
            pass
        kutil.log("smoke exit", r.returncode, "ok", ok)
        if not ok and not fallback:
            fallback = True
            r = subprocess.run([sys.executable, me, "--worker", "smoke", "--arm", "2b", "--fallback"], env=env0)
            kutil.log("fallback smoke exit", r.returncode)
    fb = ["--fallback"] if fallback else []
    est4 = None
    try:
        sm = json.load(open("/kaggle/working/smoke_2b.json"))
        est4 = sm["est_full_hours"] * 2.2  # the 4B arm is roughly 2.2x slower per sample than the 2B arm
    except Exception:  # noqa: BLE001
        pass
    kutil.log("estimated 4B training hours:", est4)
    p0 = subprocess.Popen([sys.executable, me, "--worker", "train", "--arm", "2b", *fb], env=env0)
    run4 = est4 is None or est4 <= 5.0
    if not run4:
        kutil.log("4B arm skipped: estimated run longer than 5 h (report to the lead instead)")
    p1 = subprocess.Popen([sys.executable, me, "--worker", "train", "--arm", "4b", *fb], env=env1) if run4 else None
    rc0 = p0.wait()
    kutil.log("arm 2b exit", rc0)
    rg = subprocess.run([sys.executable, me, "--worker", "gemma"], env=env0).returncode
    rc1 = p1.wait() if p1 else "skipped"
    kutil.log("arm 4b exit", rc1, "gemma exit", rg)
    kutil.write_status({"fallback": fallback, "exit": {"2b": rc0, "4b": rc1, "gemma": rg}, "finished": True})


if __name__ == "__main__":
    main()
