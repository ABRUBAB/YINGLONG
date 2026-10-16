# YINGLONG ML

Models that give the YINGLONG agent wallet **advisory signals**. Deterministic policy code and the on-chain enforcers decide;
an ML signal may only raise a tier (T1 to T2, T2 to ask). It never lowers a tier and never refuses on its own.

| ID | Model | Role in the nine scales | Where it runs |
|---|---|---|---|
| M1 | Injection Sentinel: `jhu-clsp/mmBERT-base` fine-tune (control: `microsoft/mdeberta-v3-base`), ONNX int8 | scale 2 (sentinel) | CPU, `ml/serving` |
| M3 | Behaviour anomaly: IsolationForest + LightGBM + Mondrian conformal | scale 8 (anomaly, escalates only) | CPU, `ml/serving` |
| M4 | Intent model: `Qwen/Qwen3.5-2B` and `Qwen/Qwen3.5-4B` LoRA (non-thinking), GGUF Q4_K_M | intent understanding (proposes JSON; never an address) | laptop / llama-server |
| M5 | Cash-flow forecaster: Chronos-2 with known future covariates vs LightGBM quantile vs seasonal naive | forecast queries, reserve-breach warnings | CPU |

Every number below is generated from `ml/results/*.json` by `ml/scripts/render_readme.py`. Model ids, revisions and
SHA-256 are in [`MODELS.md`](MODELS.md); licences in [`THIRD_PARTY.md`](THIRD_PARTY.md).
All data is synthetic or from the licensed public sets listed there. Chinese-script rows exist only in the private HuggingFace
dataset `ABRUBAB/yl-private-data` and are never committed.

## Exact commands

Environment (Windows, Git Bash; keep every cache on D:):

```
export UV_CACHE_DIR='D:\tools\uv-cache' HF_HOME='D:\tools\hf-home' TMP='D:\tools\tmp' TEMP='D:\tools\tmp' KAGGLE_CONFIG_DIR='D:\yl-ml-work\kaggle'
cd ml && uv sync && uv sync --group cpu-models
```
Credentials are read at run time from files outside the repository by `ml/common/keys.py` (never printed, never committed).
Kaggle notebooks read the HuggingFace token from a private Kaggle dataset `<user>/yl-hf-cred`.

| Step | Command (repo root unless noted) |
|---|---|
| Bench scenarios and data | see [`bench/README.md`](../bench/README.md) |
| Synthetic data on Kaggle (2x T4, vLLM, Qwen3-14B-AWQ) | `uv run --project ml python ml/kjobs/build_kernel.py --slug yl-datagen-intent --entry ml/datagen/kaggle_datagen.py --files ml/common ml/datagen ml/kjobs bench/scenarios --account ac_1 --args "--kind intent" --push` (and `--kind sentinel` on the second account) |
| Top-up + round-trip verification | `... --slug yl-datagen-verify --entry ml/datagen/kaggle_pipeline2.py ...` |
| Build sentinel splits | `uv run --project ml python ml/sentinel/build_data.py` |
| Train M1 (both arms + baseline, Kaggle) | `... --slug yl-sentinel-train --entry ml/sentinel/kaggle_train_sentinel.py --files ml/common ml/kjobs ml/sentinel bench/attacks bench/tasks ...` |
| Evaluate M1 | `cd ml && uv run python sentinel/evaluate.py --arm mmbert --preds <predictions.jsonl> --meta <yl_train_meta.json>` |
| Export M1 to ONNX int8 + CPU latency | `cd ml && uv run --group cpu-models python sentinel/export_onnx.py --repo ABRUBAB/yl-sentinel-mmbert-base` |
| Build intent splits | `uv run --project ml python ml/intent/build_data.py` |
| Train M4 (smoke test, 2B and 4B in parallel, GGUF, Gemma zero-shot; Kaggle) | `... --slug yl-intent-train --entry ml/intent/kaggle_train_intent.py --files ml/common ml/kjobs ml/intent bench/scenarios bench/tasks ...` |
| M3 anomaly (CPU) | `cd ml && uv run python anomaly/train_eval.py` |
| M5 forecaster (CPU) | `cd ml && uv run --group cpu-models python forecast/train_eval.py` |
| Fill README / MODELS tables | `uv run --project ml python ml/scripts/render_readme.py` |
| Rule scan of ml/ and bench/ | `uv run --project ml python ml/scripts/scan_rules.py && node scripts/check-rules.mjs` |
| Serving | `cd ml/serving && uv sync && uv run python fetch_models.py && uv run uvicorn app:app --host 0.0.0.0 --port 8090` |

## Serving on the VPS (2 vCPU, 8 GiB, no GPU)

Contract used by the agent runtime: `POST $SENTINEL_URL/sentinel` with `{"text": "..."}` returns
`{"score": float 0-1, "label": "injection"|"benign", "threshold", "model_sha", "model": "<repo>@<revision>"}`.
`POST /anomaly` and `POST /forecast` are described in `ml/serving/app.py`; `GET /health` lists the loaded model hashes.

```
cd ml/serving
docker build -t yinglong-ml .          # no weights, no token in the image
docker run -d --name yinglong-ml --restart unless-stopped --memory 3g --cpus 2 -p 127.0.0.1:8090:8090 \
  -e YL_MODELS=m1 -e HF_TOKEN_FILE=/run/secrets/hf-token.txt -v <path to the READ token file>:/run/secrets/hf-token.txt:ro \
  -v yl-ml-models:/models yinglong-ml
# agent: SENTINEL_URL=http://127.0.0.1:8090 (or the compose service name)
```
At container start `fetch_models.py` downloads the pinned files into the `/models` volume and verifies every SHA-256 (it
stops on a mismatch; a populated volume needs no network or token). On the VPS this is the `ml` service in
`infra/app/compose.yaml` (host network, 127.0.0.1:8090, `mem_limit: 3g`, only M1 loaded); `node scripts/vps-deploy.mjs --secrets`
copies the token file to `/opt/yinglong/secrets/hf-token.txt`. The agent calls `/sentinel` with a 4 s timeout; the shipped
mmBERT-base file takes about 0.34 s (64 tokens) to 1.3 s (256 tokens) per call on two cores (table above).
Without Docker: `uv sync && uv run python fetch_models.py && uv run uvicorn app:app --host 127.0.0.1 --port 8090`.
`models.lock.json` pins every file by revision and SHA-256; the service refuses to start on a mismatch. The weight-only int8
mmBERT-base file size is listed in MODELS.md and the resident memory with all three models loaded is in `ml/results/serving_memory.json`; per-call time on two
cores (`ml/results/serving_parity.json`). `YL_MODELS=m1` loads only the sentinel; `YL_ORT_THREADS` sets ONNX Runtime threads.

## Results

### M1 Injection Sentinel
Dynamic int8 quantisation (int8 activations) breaks the ModernBERT-style mmBERT encoder (label agreement with fp32 falls well
below 99%, table below), so the shipped ONNX "int8" model uses weight-only int8 (MatMulNBits) with exact agreement; on this
laptop it is smaller but not faster than fp32 ONNX. `ml/serving` can load either file; mmBERT-small is the low-latency option.

Threshold chosen on the validation split (max macro-F1); rates with Wilson 95% intervals, macro-F1 with bootstrap 95% intervals.
"HELD-OUT family" is the YINGLONG-Bench `memory_implant` family, whose SHA-256 was committed before training and which no model saw.
<!-- BEGIN:results_m1 -->
| arm | threshold | test macro-F1 [95% CI] | finance en | finance bn | finance mixed | specificity benign finance | external NVIDIA IPI macro-F1 | bench attack recall (sentinel-relevant) | HELD-OUT family recall |
|---|---|---|---|---|---|---|---|---|---|
| mmbert | 0.2 | 0.967 [0.960, 0.975] | 0.989 [0.978, 0.997] | 0.983 [0.965, 0.996] | 1.000 [1.000, 1.000] | 93.8% [91.9, 95.3] | 0.956 [0.946, 0.967] | 91.9% [87.3, 95.0] | 91.7% [78.2, 97.1] |
| mmbert_small | 0.87 | 0.961 [0.953, 0.969] | 1.000 [1.000, 1.000] | 0.991 [0.978, 1.000] | 1.000 [1.000, 1.000] | 91.2% [89.0, 93.0] | 0.918 [0.904, 0.931] | 95.5% [91.6, 97.6] | 80.6% [65.0, 90.2] |
| mdeberta | 0.05 | 0.973 [0.966, 0.980] | 1.000 [1.000, 1.000] | 0.996 [0.987, 1.000] | 1.000 [1.000, 1.000] | 90.9% [88.7, 92.7] | 0.967 [0.958, 0.976] | 96.0% [92.2, 97.9] | 63.9% [47.6, 77.5] |
| protectai_v2 | 0.5 | 0.745 [0.726, 0.763] | 0.752 [0.706, 0.794] | 0.354 [0.305, 0.405] | 0.735 [0.554, 0.871] | 71.2% [67.9, 74.2] | 0.540 [0.515, 0.563] | 21.7% [16.5, 28.0] | 33.3% [20.2, 49.7] |

Per language, whole test split (mmbert):

| language | n | macro-F1 | recall | specificity |
|---|---|---|---|---|
| bn | 310 | 0.984 [0.968, 0.997] | 98.2% [94.8, 99.4] | 98.6% [95.1, 99.6] |
| en | 1480 | 0.959 [0.949, 0.969] | 95.3% [93.6, 96.5] | 96.8% [95.2, 97.9] |
| mixed | 31 | 1.000 [1.000, 1.000] | 100.0% [79.6, 100.0] | 100.0% [80.6, 100.0] |
| zh | 278 | 0.989 [0.974, 1.000] | 98.8% [95.8, 99.7] | 99.1% [95.0, 99.8] |

Per channel, finance synthetic test (mmbert):

| channel | n | macro-F1 | recall | specificity |
|---|---|---|---|---|
| chat_message | 107 | 0.991 [0.971, 1.000] | 100.0% [92.7, 100.0] | 98.3% [90.9, 99.7] |
| email | 141 | 0.972 [0.936, 0.993] | 98.5% [91.8, 99.7] | 96.0% [89.0, 98.7] |
| invoice_memo | 158 | 0.987 [0.968, 1.000] | 97.1% [90.0, 99.2] | 100.0% [95.9, 100.0] |
| ocr_text | 96 | 1.000 [1.000, 1.000] | 100.0% [92.0, 100.0] | 100.0% [93.1, 100.0] |
| payee_note | 87 | 1.000 [1.000, 1.000] | 100.0% [89.8, 100.0] | 100.0% [93.2, 100.0] |
| token_name | 54 | 1.000 [1.000, 1.000] | 100.0% [86.7, 100.0] | 100.0% [88.3, 100.0] |
| web_snippet | 101 | 1.000 [1.000, 1.000] | 100.0% [90.1, 100.0] | 100.0% [94.5, 100.0] |
| x402_description | 99 | 0.979 [0.944, 1.000] | 97.4% [86.5, 99.5] | 98.4% [91.3, 99.7] |

Per kind, whole test split (mmbert; kinds with n >= 10):

| kind | n | recall | specificity |
|---|---|---|---|
| adversarial | 79 | 100.0% [95.4, 100.0] | - |
| benign | 446 | - | 95.7% [93.4, 97.3] |
| direct_injection | 374 | 97.6% [95.5, 98.7] | - |
| encoding | 30 | 100.0% [88.6, 100.0] | - |
| finance_benign_chat_message | 58 | - | 98.3% [90.9, 99.7] |
| finance_benign_email | 76 | - | 96.0% [89.0, 98.7] |
| finance_benign_invoice_memo | 89 | - | 100.0% [95.9, 100.0] |
| finance_benign_ocr_text | 52 | - | 100.0% [93.1, 100.0] |
| finance_benign_payee_note | 53 | - | 100.0% [93.2, 100.0] |
| finance_benign_token_name | 29 | - | 100.0% [88.3, 100.0] |
| finance_benign_web_snippet | 66 | - | 100.0% [94.5, 100.0] |
| finance_benign_x402_description | 61 | - | 98.4% [91.3, 99.7] |
| finance_chat_message | 49 | 100.0% [92.7, 100.0] | - |
| finance_email | 65 | 98.5% [91.8, 99.7] | - |
| finance_invoice_memo | 69 | 97.1% [90.0, 99.2] | - |
| finance_ocr_text | 44 | 100.0% [92.0, 100.0] | - |
| finance_payee_note | 34 | 100.0% [89.8, 100.0] | - |
| finance_token_name | 25 | 100.0% [86.7, 100.0] | - |
| finance_web_snippet | 35 | 100.0% [90.1, 100.0] | - |
| finance_x402_description | 38 | 97.4% [86.5, 99.5] | - |
| jailbreak | 248 | 87.9% [83.3, 91.4] | - |
| training_extraction | 10 | 100.0% [72.2, 100.0] | - |

YINGLONG-Bench attack families (mmbert; recall = share flagged):

| family | n | recall |
|---|---|---|
| direct_injection | 22 | 81.8% [61.5, 92.7] |
| email_injection | 22 | 100.0% [85.1, 100.0] |
| invoice_memo_injection | 22 | 81.8% [61.5, 92.7] |
| lookalike_address | 22 | 95.5% [78.2, 99.2] |
| multilingual | 22 | 100.0% [85.1, 100.0] |
| payee_note_injection | 22 | 81.8% [61.5, 92.7] |
| split_payment | 22 | 100.0% [85.1, 100.0] |
| token_name_injection | 22 | 100.0% [85.1, 100.0] |
| urgency_authority | 22 | 95.5% [78.2, 99.2] |
| visual_injection | 22 | 90.9% [72.2, 97.5] |
| within_mandate | 22 | 0.0% [0.0, 14.9] |
| x402_description_injection | 22 | 95.5% [78.2, 99.2] |
| memory_implant (HELD-OUT) | 36 | 91.7% [78.2, 97.1] |

ONNX int8 export and CPU latency (batch 1):

| model | quantization | MB | setting | p50 ms | p95 ms | label agreement vs fp32 PyTorch | CPU |
|---|---|---|---|---|---|---|---|
| yl-sentinel-mmbert-base | weight-only int8 (ONNX Runtime MatMulNBits, 8 bits, block 32, symmetric, int8 compute) | 869.7 | threads2_seq64 | 342.98 | 485.87 | 100.0% | AMD Ryzen 5 5600H with Radeon Graphics |
| yl-sentinel-mmbert-base | weight-only int8 (ONNX Runtime MatMulNBits, 8 bits, block 32, symmetric, int8 compute) | 869.7 | threads2_seq256 | 1300.32 | 1603.67 | 100.0% | AMD Ryzen 5 5600H with Radeon Graphics |
| yl-sentinel-mmbert-base | weight-only int8 (ONNX Runtime MatMulNBits, 8 bits, block 32, symmetric, int8 compute) | 869.7 | threads12_seq64 | 418.26 | 609.62 | 100.0% | AMD Ryzen 5 5600H with Radeon Graphics |
| yl-sentinel-mmbert-base | weight-only int8 (ONNX Runtime MatMulNBits, 8 bits, block 32, symmetric, int8 compute) | 869.7 | threads12_seq256 | 1065.15 | 1444.3 | 100.0% | AMD Ryzen 5 5600H with Radeon Graphics |
| yl-sentinel-mmbert-small | weight-only int8 (ONNX Runtime MatMulNBits, 8 bits, block 32, symmetric, int8 compute) | 421.0 | threads2_seq64 | 132.74 | 143.81 | 100.0% | AMD Ryzen 5 5600H with Radeon Graphics |
| yl-sentinel-mmbert-small | weight-only int8 (ONNX Runtime MatMulNBits, 8 bits, block 32, symmetric, int8 compute) | 421.0 | threads2_seq256 | 552.01 | 597.72 | 100.0% | AMD Ryzen 5 5600H with Radeon Graphics |
| yl-sentinel-mmbert-small | weight-only int8 (ONNX Runtime MatMulNBits, 8 bits, block 32, symmetric, int8 compute) | 421.0 | threads12_seq64 | 141.45 | 273.84 | 100.0% | AMD Ryzen 5 5600H with Radeon Graphics |
| yl-sentinel-mmbert-small | weight-only int8 (ONNX Runtime MatMulNBits, 8 bits, block 32, symmetric, int8 compute) | 421.0 | threads12_seq256 | 694.59 | 1333.76 | 100.0% | AMD Ryzen 5 5600H with Radeon Graphics |

| model | fp32 ONNX setting | p50 ms | p95 ms |
|---|---|---|---|
| yl-sentinel-mmbert-base | threads2_seq64 | 220.37 | 506.45 |
| yl-sentinel-mmbert-base | threads2_seq256 | 782.76 | 1518.93 |

| model | fp32 ONNX setting | p50 ms | p95 ms |
|---|---|---|---|
| yl-sentinel-mmbert-small | threads2_seq64 | 106.42 | 196.2 |
| yl-sentinel-mmbert-small | threads2_seq256 | 338.66 | 445.33 |

Int8 variants of the mmBERT-base sentinel checked against the fp32 PyTorch model (Kaggle CPU job absanim/yl-sentinel-quantize (ml/sentinel/kaggle_quantize.py); 600 held-out rows; latency on the Kaggle CPU, 2 threads):

| variant | MB | label agreement | mean abs prob diff | p50 ms (seq 64) |
|---|---|---|---|---|
| dyn_all | 857.4 | 74.0% | 0.26763 | 92.3 |
| dyn_no_mlp_wo | 913.0 | 96.7% | 0.0272 | 100.2 |
| dyn_attn_only | 1024.1 | 97.8% | 0.01862 | 109.7 |
| weightonly8 | 869.7 | 100.0% | 0.00061 | 217.0 |
| fp32 | 1173.7 | 100.0% | 0.0 | 123.7 |
<!-- END:results_m1 -->

### M4 Intent model
On a T4, Unsloth 2026.10.6 refuses fp16 for the Qwen3.5 architecture and trains it in fp32, which makes Qwen3.5 roughly
4x slower than planned. The Qwen3.5-2B arm therefore ran in fp32 (2 epochs), the Qwen3.5-4B arm was not started because its
estimated duration exceeded the 6-hour job limit, and the planned fallback family (Qwen3-1.7B and Qwen3-4B, fp16) was trained
as well. Each row below names its base model.

Canonical exact match compares canonicalised JSON (ASCII amounts without separators or trailing zeros, sorted tag lists).
Slot F1 is micro-averaged over (field, value) pairs. `bench_legit` = the 240 YINGLONG-Bench legitimate tasks, written by a
different model family from the training data. The plan's human-authored test set (teammates) is still to be collected.
<!-- BEGIN:results_m4 -->
| arm | base model | eval set | n | JSON validity [95% CI] | canonical exact match [95% CI] | slot F1 |
|---|---|---|---|---|---|---|
| qwen3-1.7b | Qwen/Qwen3-1.7B | test | 1255 | 99.9% [99.6, 100.0] | 85.7% [83.7, 87.6] | 0.972 |
| qwen3-1.7b | Qwen/Qwen3-1.7B | bench_legit | 239 | 99.6% [97.7, 99.9] | 82.4% [77.1, 86.7] | 0.964 |
| qwen3-4b | Qwen/Qwen3-4B | test | 1255 | 99.9% [99.6, 100.0] | 88.8% [86.9, 90.4] | 0.981 |
| qwen3-4b | Qwen/Qwen3-4B | bench_legit | 239 | 100.0% [98.4, 100.0] | 82.4% [77.1, 86.7] | 0.964 |
| qwen3.5-2b | Qwen/Qwen3.5-2B | test | 1255 | 99.9% [99.6, 100.0] | 88.7% [86.8, 90.3] | 0.979 |
| qwen3.5-2b | Qwen/Qwen3.5-2B | bench_legit | 239 | 99.6% [97.7, 99.9] | 79.9% [74.4, 84.5] | 0.961 |
| zero-shot | google/gemma-4-E2B-it | test sample | 300 | 10.3% [7.4, 14.3] | 0.7% [0.2, 2.4] | 0.494 |

Breakdown, test split, arm qwen3-1.7b (Chinese rows are scored here but stored only in the private dataset):

| slice | n | JSON validity | exact match | slot F1 |
|---|---|---|---|---|
| intent | 917 | 100.0% | 83.6% [81.1, 85.9] | 0.964 |
| mandate | 338 | 99.7% | 91.4% [87.9, 94.0] | 0.982 |
| bn | 318 | 100.0% | 84.3% [79.9, 87.9] | 0.962 |
| en | 468 | 100.0% | 92.5% [89.8, 94.6] | 0.987 |
| mixed | 283 | 99.7% | 69.6% [64.0, 74.7] | 0.949 |
| zh | 186 | 100.0% | 95.7% [91.7, 97.8] | 0.984 |

GGUF: `yl-intent-qwen3-1.7b-Q4_K_M.gguf` (1.03 GiB), SHA-256 `6e93e9ff9264468cb4dd9d0eee6f00a0c4c45b3d041817b0220e94e0f8e6a29b`

Breakdown, test split, arm qwen3-4b (Chinese rows are scored here but stored only in the private dataset):

| slice | n | JSON validity | exact match | slot F1 |
|---|---|---|---|---|
| intent | 917 | 100.0% | 86.7% [84.3, 88.7] | 0.974 |
| mandate | 338 | 99.7% | 94.4% [91.4, 96.4] | 0.991 |
| bn | 318 | 100.0% | 85.9% [81.6, 89.2] | 0.972 |
| en | 468 | 100.0% | 93.4% [90.8, 95.3] | 0.991 |
| mixed | 283 | 99.7% | 79.5% [74.4, 83.8] | 0.968 |
| zh | 186 | 100.0% | 96.2% [92.4, 98.2] | 0.992 |

GGUF: `yl-intent-qwen3-4b-Q4_K_M.gguf` (2.33 GiB), SHA-256 `98bd75006c66e0d2548ec3a0b022601dd40d6eff38218427e7f83b23d99e08a9`

Breakdown, test split, arm qwen3.5-2b (Chinese rows are scored here but stored only in the private dataset):

| slice | n | JSON validity | exact match | slot F1 |
|---|---|---|---|---|
| intent | 917 | 100.0% | 86.7% [84.3, 88.7] | 0.973 |
| mandate | 338 | 99.7% | 94.1% [91.0, 96.1] | 0.989 |
| bn | 318 | 100.0% | 80.8% [76.1, 84.8] | 0.961 |
| en | 468 | 100.0% | 95.1% [92.7, 96.7] | 0.990 |
| mixed | 283 | 99.7% | 82.3% [77.5, 86.3] | 0.970 |
| zh | 186 | 100.0% | 95.7% [91.7, 97.8] | 0.995 |

GGUF: `yl-intent-qwen3.5-2b-Q4_K_M.gguf` (1.19 GiB), SHA-256 `a685d7066c4d7898820ebdd523330022450cc737475a3669b02ccdfb2b6299de`
<!-- END:results_m4 -->

### M3 Behaviour anomaly (escalates only)
<!-- BEGIN:results_m3 -->
| metric | IsolationForest | LightGBM | combined (conformal) |
|---|---|---|---|
| AUROC | 0.979 | 0.994 | 0.994 |
| AUPRC | 0.874 | 0.987 | 0.986 |

False escalation rate on normal test actions (n = 38907): 2.1% [2.0, 2.3] (target 2.0%).

| family | n (test) | escalation recall [95% CI] | AUROC combined | AUROC IsolationForest | AUROC LightGBM |
|---|---|---|---|---|---|
| duplicate_payment | 60 | 45.0% [33.1, 57.5] | 0.761 | 0.658 | 0.787 |
| split_payment | 261 | 100.0% [98.6, 100.0] | 1.000 | 1.000 | 1.000 |
| lookalike_address | 66 | 100.0% [94.5, 100.0] | 1.000 | 0.999 | 1.000 |
| velocity_burst | 664 | 100.0% [99.4, 100.0] | 1.000 | 0.961 | 1.000 |
| inflated_invoice | 67 | 98.5% [92.0, 99.7] | 0.999 | 0.943 | 1.000 |
| x402_drain | 1358 | 100.0% [99.7, 100.0] | 1.000 | 0.998 | 1.000 |
| new_payee_large | 55 | 100.0% [93.5, 100.0] | 1.000 | 0.999 | 1.000 |
| dormant_reactivation | 62 | 100.0% [94.2, 100.0] | 1.000 | 0.995 | 1.000 |
| address_swap (HELD-OUT) | 67 | 86.6% [76.4, 92.8] | 0.994 | 0.990 | 0.964 |

Data: 177209 synthetic actions from 90 wallets, 11043 anomalous.
<!-- END:results_m3 -->

### M5 Cash-flow forecaster
<!-- BEGIN:results_m5 -->
| method | mean pinball (CNY) | scaled pinball | pinball h1-7 | pinball h8-28 | 90% coverage raw | 90% coverage CQR | Brier breach-14d raw | Brier breach-14d isotonic |
|---|---|---|---|---|---|---|---|---|
| chronos2 | 135,216 | 0.0934 | 78,053 | 154,270 | 89.7% | 88.7% | 0.0843 | 0.0837 |
| lgbm_quantile | 111,483 | 0.0770 | 52,239 | 131,231 | 74.3% | 86.7% | 0.0636 | 0.0608 |
| seasonal_naive | 210,351 | 0.1452 | 114,428 | 242,325 | 88.7% | 89.3% | 0.1345 | 0.1013 |

Test origins: 312 (calibration 208), horizon 28 days, breach base rate 13.1%, climatology Brier 0.1152. Chronos-2 CPU inference: 396.1 s for all origins. synthetic ledgers (fictional SMEs, CNY on a simulator rail).
<!-- END:results_m5 -->

## Data cards

<!-- BEGIN:data_summary -->
| bench family | attacks |
|---|---|
| direct_injection | 22 |
| invoice_memo_injection | 22 |
| email_injection | 22 |
| payee_note_injection | 22 |
| token_name_injection | 22 |
| x402_description_injection | 22 |
| lookalike_address | 22 |
| urgency_authority | 22 |
| split_payment | 22 |
| within_mandate | 22 |
| memory_implant (HELD-OUT) | 36 |
| visual_injection | 22 |
| multilingual | 22 |

Attacks total 300, legitimate tasks 239. Held-out SHA-256 `e23a3fcd99fc68f889884bc7cf2748ff665e9c3597a7ce2fc30b64586de0deea`.

M1 sentinel data (private full set; rows):

| split | rows | positives | by language | by source |
|---|---|---|---|---|
| train | 15224 | 8707 | en:12368, zh:1283, bn:1432, mixed:141 | neuralchemy:9853, deepset:546, multijail:678, yl_finance_synth:4147 |
| validation | 1592 | 849 | en:1193, zh:180, bn:197, mixed:22 | neuralchemy:941, multijail:69, yl_finance_synth:582 |
| test | 2099 | 1169 | en:1480, zh:278, bn:310, mixed:31 | neuralchemy:942, deepset:116, multijail:198, yl_finance_synth:843 |
| ext_test | 1812 | 1271 | en:1812 | nvidia_ipi:1812 |

M4 intent data: generated 17400, kept 12398 after schema, language, amount and round-trip checks.

| split | rows | repo rows (no zh) | by language | by task |
|---|---|---|---|---|
| train | 10643 | 9041 | bn:2638, mixed:2500, en:3903, zh:1602 | intent:7796, mandate:2847 |
| val | 500 | 434 | bn:125, mixed:128, zh:66, en:181 | intent:354, mandate:146 |
| test | 1255 | 1069 | mixed:283, bn:318, zh:186, en:468 | intent:917, mandate:338 |

Drop reasons: language_mismatch 1890, verify_amount_mismatch 1372, verify_date_mismatch 651, truncated_or_empty 619, duplicate_text 353, amount_not_in_text 49, verify_date_should_be_missing 37, verify_mandate_amount_missing 20, refusal 6, verify_amount_should_be_missing 4, verify_recurrence_mismatch 1

OpenRouter usage: 34 calls, USD 0.0000.
<!-- END:data_summary -->

**YINGLONG-Bench v1** (`bench/`). 13 attack families over two fictional scenarios (Nadia, a student in Hong Kong; Lotus Lane
Trading, a Shenzhen SME with a Hong Kong subsidiary) plus legitimate tasks with expected Intent JSON. Skeletons by code, text by the
NVIDIA Nemotron family. Languages: English, Bangla, code-mixed Bangla-English; Chinese variants private. Intended use: evaluating
the YINGLONG pipeline and its ablations. Not for training any YINGLONG model (the held-out family is hash-pinned).

**Sentinel data v1.** Binary labels (1 = injection, jailbreak or payment manipulation aimed at the agent; 0 = benign). Public parts keep
their published splits; MultiJail is split by question id; our finance set is split by spec id. The finance set is label-first: a spec
(channel, language, attack or benign type, counterparty) is sampled by code, Qwen3-14B-AWQ writes the text, and a second judge pass
must agree with the intended label. Hard negatives are benign finance texts that look imperative (reminders, payment terms, overdue
notices, x402 price descriptions). The memory channel is excluded on purpose (bench held-out family). Known limits: synthetic text,
one writer family, Bangla and code-mixed text not yet reviewed by a native speaker (the plan's 200-sample review is pending).

**Intent data v1.** Labels (Intent or MandateDraft JSON) are sampled by code from the scenario PayeeBooks and validated against the
JSON schema (payee is an enum; any 0x-hex string is rejected), then a writer turns hints into a user message. Kept only if the
script checks (language, amount digits, no address) and an independent extraction pass (amount, date, recurrence) agree with the
label. Amount values are canonicalised; when no unit is stated the label uses the payee's unit, else the scenario default.

**M3 world.** Simulated wallets (student and SME archetypes), one year of payments, nine anomaly families injected with labels;
wallet-level train / calibration / test split; the `address_swap` family (a known payee whose address silently changes, the effect
of a memory implant) is never shown to the supervised model.

**M5 ledgers.** Eight fictional SMEs, three years of daily balances in fen. Scheduled outflows (payroll, supplier invoices with due
dates, utilities, forwarders, cloud, mid-month sweeps) are known future covariates; receipts, ad-hoc spend and credit-line draws are not.

## Model cards (short)

**M1.** Input: one untrusted text (memo, email, payee note, token name, 402 description, OCR text, chat message), max 320 tokens.
Output: P(injection). Use: raise the tier and quarantine the field; never the only control (KR-06 false negatives). Out of scope:
detecting look-alike addresses, split payments or within-mandate manipulation (deterministic rules, M2 and M3 cover those).

**M3.** Input: action features (amount vs payee history, velocity windows, sub-threshold counts, new payee, address change and age,
look-alike score, untrusted origin, x402 rate). Output: conformal p-value and an escalate flag at a calibrated false-escalation rate.
Escalates only.

**M4.** Input: system prompt with today's date, default unit and the PayeeBook, plus the user message. Output: Intent JSON (or
MandateDraft JSON). Grammar-constrained decoding and the schema validator run after it; the planner never receives an address from it.

**M5.** Input: balance history and known scheduled flows. Output: balance quantiles per day for 28 days and P(reserve breach within
14 days). Advisory; reserve-floor enforcement stays deterministic.

## Honest limits
Synthetic data and synthetic worlds overstate real-world performance; the bench is written by one model family; Bangla and
code-mixed data still need native review; M3 and M5 results are on simulated data only.
