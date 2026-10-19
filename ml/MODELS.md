# YINGLONG model registry

Generated from the HuggingFace Hub by `ml/scripts/registry.py` and rendered by `ml/scripts/render_readme.py`.
Revisions and SHA-256 values below are read from the Hub and from the files themselves, never typed by hand.
The repositories below are the private training originals. Clean public copies with model cards (lead approved 18 and 19 Oct 2026): `ABRUBAB/yinglong-sentinel-mmbert-base`, `-sentinel-mmbert-small`, `-intent-qwen3-4b`, `-intent-qwen3.5-2b`, `-intent-qwen3-1.7b`, `-behaviour-anomaly` (M3 in safe formats, no pickle; checked to score identically to `m3_models.pkl`) and `-cash-forecaster` (M5). The live service loads the hash-pinned private revisions. Weights are never committed to git.

<!-- BEGIN:models_registry -->
### `ABRUBAB/yl-sentinel-mmbert-base` (model, private)

M1 sentinel, primary arm (fine-tuned jhu-clsp/mmBERT-base) + ONNX int8. Revision `1062546bb103606fd85df8ea348d5d803304de26` (last modified 2026-10-16 00:55:24).

| file | bytes | SHA-256 |
|---|---|---|
| `model.safetensors` | 1230141424 | `cd5ed65a136988870f7e34327af705c3ba8001445129adad4168096a2bd8c983` |
| `onnx/model_int8.onnx` | 911923664 | `8775f388fc9eea0c0c310395668812fc2d5e4954959aa006e27ef7ebd5c95176` |
| `onnx/tokenizer.json` | 34363354 | `79154e60949631bff0fc5e22216cfcbf2a2e8246702b03de19b157ea65988998` |
| `tokenizer.json` | 34363286 | `6a897b9bde31210cc245f29000ea68b7f8401cd06a08c27893a75474f851f08e` |

### `ABRUBAB/yl-sentinel-mdeberta-v3-base` (model, private)

M1 sentinel, control arm (fine-tuned microsoft/mdeberta-v3-base). Revision `771d7aeaca3c1e3a342291845d5b34a89044593d` (last modified 2026-10-16 00:26:51).

| file | bytes | SHA-256 |
|---|---|---|
| `model.safetensors` | 1115268200 | `74706b5bf217dc4c1f4a7ddb2a8ed7cc43539b8bddcaf602c84af1d940fa5815` |
| `tokenizer.json` | 16034114 | `b41e6c1b54dfc92b7a2a483aafe32620c61cc92fc1be9e2194bd89494f3796fa` |

### `ABRUBAB/yl-sentinel-mmbert-small` (model, private)

M1 sentinel, low-latency arm (fine-tuned jhu-clsp/mmBERT-small) + ONNX. Revision `b3288a4b782b28f547a03ab8178d619bfb2f5090` (last modified 2026-10-16 01:12:17).

| file | bytes | SHA-256 |
|---|---|---|
| `model.safetensors` | 562583392 | `a3f341517f3d02863c96c5a1201c6225b4e2e646364501fa496d7b7626ad9ec0` |
| `onnx/model_int8.onnx` | 441425360 | `9078e8c69df7b9c0f30e2bd6e05478e03388e79d7caaf59a4df6c9171bbe7cb7` |
| `onnx/tokenizer.json` | 34363354 | `79154e60949631bff0fc5e22216cfcbf2a2e8246702b03de19b157ea65988998` |
| `tokenizer.json` | 34363286 | `6a897b9bde31210cc245f29000ea68b7f8401cd06a08c27893a75474f851f08e` |

### `ABRUBAB/yl-intent-qwen3.5-2b` (model, private)

M4 intent model, Qwen3.5-2B arm (LoRA adapter + GGUF Q4_K_M). Revision `1b6b1313b8fa11e721c94d9c119ee47a6e30c4ae` (last modified 2026-10-16 07:12:08).

| file | bytes | SHA-256 |
|---|---|---|
| `adapter/adapter_model.safetensors` | 67332688 | `4f6cfcced8b1b509d5aa397356fe449d0c7afc7732903d76f5c7ec5506e86400` |
| `adapter/tokenizer.json` | 19989325 | `06b9509352d2af50381ab2247e083b80d32d5c0aba91c272ca9ff729b6a0e523` |
| `yl-intent-qwen3.5-2b-Q4_K_M.gguf` | 1274396320 | `a685d7066c4d7898820ebdd523330022450cc737475a3669b02ccdfb2b6299de` |

### `ABRUBAB/yl-intent-qwen3-1.7b` (model, private)

M4 intent model, Qwen3-1.7B fallback-family arm (LoRA adapter + GGUF Q4_K_M). Revision `e4e8ba08021053832059c0bdd75fc502d95a6bb9` (last modified 2026-10-16 06:17:37).

| file | bytes | SHA-256 |
|---|---|---|
| `adapter/adapter_model.safetensors` | 69782384 | `2f2f7fbb1b41dcfa6cea2bac4e94cca59d64bab2ad031f9b3c3c7843f9a75757` |
| `adapter/tokenizer.json` | 11422924 | `476870a1f2fb6f6a2759a6ede2383bf9d5d738f17844563b65c91965b722ae09` |
| `yl-intent-qwen3-1.7b-Q4_K_M.gguf` | 1107409280 | `6e93e9ff9264468cb4dd9d0eee6f00a0c4c45b3d041817b0220e94e0f8e6a29b` |

### `ABRUBAB/yl-intent-qwen3-4b` (model, private)

M4 intent model, Qwen3-4B fallback-family arm (LoRA adapter + GGUF Q4_K_M). Revision `3bd7578d4d39918adf8376c2ed2322b94139b58e` (last modified 2026-10-16 07:07:27).

| file | bytes | SHA-256 |
|---|---|---|
| `adapter/adapter_model.safetensors` | 132187888 | `ee03084fe3872f94345f6061ad168225f137263c22c11a9a2782f66cf19ef2f9` |
| `adapter/tokenizer.json` | 11422924 | `476870a1f2fb6f6a2759a6ede2383bf9d5d738f17844563b65c91965b722ae09` |
| `yl-intent-qwen3-4b-Q4_K_M.gguf` | 2497280960 | `98bd75006c66e0d2548ec3a0b022601dd40d6eff38218427e7f83b23d99e08a9` |

### `ABRUBAB/yl-intent-baselines` (model, private)

M4 zero-shot google/gemma-4-E2B-it results. Revision `de8863c64f4f8bcc67b9bcb7f8217a777a7a23a1` (last modified 2026-10-16 05:09:20).


### `ABRUBAB/yl-cpu-models` (model, private)

M3 anomaly and M5 LightGBM quantile models. Revision `9499d5575e0816414495c2533528ecdd3c0d7590` (last modified 2026-10-15 23:42:49).

| file | bytes | SHA-256 |
|---|---|---|
| `m3/m3_models.pkl` | 30185406 | `7b8af61b9c7f4412bf84794a855f3d9eaa96a8f4877eca395d6fdbd0427483a6` |

### `ABRUBAB/yl-private-data` (dataset, private)

private data: generated shards, verified splits, Chinese-script rows, bench Chinese variants. Revision `67022bce4b04976413a2857e29cff1f972c11c98` (last modified 2026-10-15 23:41:47).


Serving pins (`ml/serving/models.lock.json`, startup fails closed on mismatch):

| key | repo | revision | file | SHA-256 |
|---|---|---|---|---|
| m3 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m3_lightgbm.txt | `1ed97c2a723ac4f848f0130cef4d1759535419f41c1c2af1f4aa7255b2de4fc0` |
| m3 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m3_models.pkl | `7b8af61b9c7f4412bf84794a855f3d9eaa96a8f4877eca395d6fdbd0427483a6` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.05.txt | `be1f6e4de1f685a8ee5ffa62d4c05152224c657fa732337160bd6726bdaa8a08` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.1.txt | `60444a43248e2630094a1f0c478d6a71a1cbd306b5e69b52c7a9ad6d61c5deb9` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.2.txt | `c6df9ea4398f5bd682fc1d370e4fceed830ae2a5e1a5f5beab27289d79a95041` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.3.txt | `8d0dcc600cec09e979811437f50b978b23a15c30f1129ae991ce6dedb5485181` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.4.txt | `86ac9b0cb25ee3e1e64949c786e8956b22cff8c88342907dbbcaa7c06a95fa7a` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.5.txt | `0940abba1f8503caebb25b9a54fe88f4fbead998b81a6d7c81526cffd61157a6` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.6.txt | `534c0e634d02b0212411ebe5841dbf77d87a7eaba431b0d2154ccf4e09a13b52` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.7.txt | `79a9463fcfc0a50c5020df50a5c026559f4d5658cde542eba6f1d1152d089bae` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.8.txt | `f1f9026781293ee0fff1503bf792d20ea1029eb73acc39367745037973fbb8c9` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.9.txt | `3bec617d40c964615c448edf839d19db86b12bb98768c06ab33f776190401f9d` |
| m5 | ABRUBAB/yl-cpu-models | `9499d5575e0816414495c2533528ecdd3c0d7590` | m5_lgbm_q0.95.txt | `e312618863067b834e9c991bbb91a879f84f23488498f7e44c648753e33b8afc` |
| m1 | ABRUBAB/yl-sentinel-mmbert-base | `1062546bb103606fd85df8ea348d5d803304de26` | model_int8.onnx | `8775f388fc9eea0c0c310395668812fc2d5e4954959aa006e27ef7ebd5c95176` |
| m1 | ABRUBAB/yl-sentinel-mmbert-base | `1062546bb103606fd85df8ea348d5d803304de26` | tokenizer.json | `79154e60949631bff0fc5e22216cfcbf2a2e8246702b03de19b157ea65988998` |
<!-- END:models_registry -->

## Kaggle notebooks (private)

| Notebook | Account | Purpose |
|---|---|---|
| `abdullahrubab1/yl-datagen-intent` | ac_1 | vLLM Qwen3-14B-AWQ writer, intent / mandate data (label-first) |
| `absanim/yl-datagen-sentinel` | ac_2 | vLLM writer, finance sentinel data |
| `abdullahrubab1/yl-datagen-verify` | ac_1 | intent top-up round + round-trip verification (intent and sentinel) |
| `absanim/yl-verify-sentinel` | ac_2 | sentinel judge verification (parallel copy) |
| `absanim/yl-sentinel-train` | ac_2 | M1: mmBERT-base arm (the parallel mDeBERTa arm hit two bugs, fixed below) + protectai v2 baseline |
| `absanim/yl-sentinel-train-mdeberta` | ac_2 | M1 control arm mDeBERTa-v3-base (fp32 master weights, batch 8 x 4 accumulation) |
| `absanim/yl-sentinel-train-small` | ac_2 | M1 low-latency arm mmBERT-small |
| `absanim/yl-sentinel-quantize` | ac_2 (CPU) | int8 ONNX variants checked against fp32 |
| `abdullahrubab1/yl-intent-train` | ac_1 | M4: 50-step fp16 smoke test, Qwen3.5-2B LoRA (Unsloth trains Qwen3.5 in fp32 on T4), GGUF, Gemma zero-shot; 4B arm skipped by the 6-hour guard |
| `absanim/yl-intent-train-qwen3` | ac_2 | M4 fallback family in fp16: Qwen3-1.7B and Qwen3-4B LoRA in parallel, GGUF, Gemma zero-shot |
| `absanim/yl-intent-eval-export` | ac_2 | M4 evaluation of the final adapters with a 2048-token context (the training jobs stopped at evaluation: 768-token context) |
| `absanim/yl-intent-gguf-cpu` | ac_2 (CPU) | M4 GGUF Q4_K_M export: PEFT merge on CPU + llama.cpp |

Notebook sources are built from this repository by `ml/kjobs/build_kernel.py` (the bundle embeds `ml/` and `bench/` files; no secrets).
