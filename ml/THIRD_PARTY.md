# Third-party models and datasets used by `ml/` and `bench/`

Every entry was checked on the HuggingFace Hub (licence tag and revision) **before** use on 15-16 Oct 2026.
Datasets without a licence tag are excluded. Revisions are the exact commits we downloaded.

## Models

| Model | Licence | Revision used | Role |
|---|---|---|---|
| `jhu-clsp/mmBERT-base` | MIT | `c5955035435e` | M1 sentinel backbone (primary arm) |
| `jhu-clsp/mmBERT-small` | MIT | `abc32620dd4f` | M1 low-latency arm (fine-tuned as `ABRUBAB/yl-sentinel-mmbert-small`) |
| `microsoft/mdeberta-v3-base` | MIT | `a0484667b223` | M1 control arm |
| `protectai/deberta-v3-base-prompt-injection-v2` | Apache-2.0 | `90c9989b1a34` | M1 off-the-shelf baseline, inference only |
| `Qwen/Qwen3.5-2B` | Apache-2.0 | `15852e8c1636` | M4 intent model (LoRA) |
| `Qwen/Qwen3.5-4B` | Apache-2.0 | `851bf6e806ef` | M4 intent model (LoRA, long run) |
| `Qwen/Qwen3-1.7B` | Apache-2.0 | `70d244cc86cc` | M4 fallback if Qwen3.5 fails in fp16 on T4 |
| `Qwen/Qwen3-4B` | Apache-2.0 | `1cfa9a720891` | M4 fallback for the 4B arm |
| `google/gemma-4-E2B-it` | Apache-2.0 | `3e22461f65e8` | M4 zero-shot comparison only |
| `Qwen/Qwen3-14B-AWQ` | Apache-2.0 | `31c69efc2946` | Synthetic-data writer and verifier (sentinel finance set, intent set) on Kaggle |
| `amazon/chronos-2` | Apache-2.0 | `29ec3766d36d` | M5 forecaster (zero-shot, known future covariates) |
| `nvidia/nemotron-3-super-120b-a12b` (OpenRouter free endpoint) | NVIDIA Open Model License (endpoint terms of OpenRouter) | API, 15-16 Oct 2026 | Writer of the natural-language fields of YINGLONG-Bench (different family from the sentinel data writer) |

## Datasets

| Dataset | Licence | Revision used | How it is used |
|---|---|---|---|
| `neuralchemy/Prompt-injection-dataset` (config `full`) | Apache-2.0 | `7d70432dfcf47a821612cbf9d34e9d9e3ad20e75` | M1 train / validation / test as published |
| `deepset/prompt-injections` | Apache-2.0 | `4f61ecb038e9c3fb77e21034b22511b523772cdd` | M1 train / test as published |
| `DAMO-NLP-SG/MultiJail` | MIT | `93d65c778925d55973b9ff30c7bccc8545494eb6` | M1 positives (kind `jailbreak`), English and Bangla rows in all splits; Chinese rows only inside the private HF dataset |
| `nvidia/Nemotron-RL-Agentic-Indirect-Prompt-Injection-v1` | CC-BY-4.0 | `d738d4f361cc38bb4d7a42b9066776dade5332f5` | **Evaluation only** (external indirect-injection test). Not used for training, because the bench writer belongs to the same model family (authorship separation). Attribution: NVIDIA Corporation, CC-BY-4.0 |
| `xTRam1/safe-guard-prompt-injection` | none tagged | - | **Excluded** (no licence tag) |

## Generated data (ours)

| Set | Writer | Where | Notes |
|---|---|---|---|
| Finance sentinel set v1 | `Qwen/Qwen3-14B-AWQ` (Qwen family) | private HF dataset `ABRUBAB/yl-private-data` (`gen/v1/sentinel`, `sentinel/v1`); repo copy without Chinese rows in `ml/data/sentinel/` | Label-first specs, judge-verified; excludes the memory channel (bench held-out family) |
| Intent / mandate set v1 | `Qwen/Qwen3-14B-AWQ` | private HF dataset (`gen/v1/intent`, `intent/v1`); repo copy without Chinese rows in `ml/data/intent/` | Labels sampled by code, validated against the JSON schema, round-trip verified |
| YINGLONG-Bench v1 | skeletons by code, text by `nvidia/nemotron-3-super-120b-a12b` | `bench/` (en, bn, code-mixed); Chinese variants only in the private HF dataset | Held-out family SHA-256 in `bench/HELDOUT_SHA256.txt` |

## Python packages (main ones)

vLLM 0.31.0 (Apache-2.0), Unsloth 2026.10.6 (Apache-2.0), transformers 5.x (Apache-2.0), PEFT (Apache-2.0), TRL (Apache-2.0),
flash-linear-attention (MIT), causal-conv1d (BSD-3-Clause, build attempted on Kaggle), llama.cpp (MIT, GGUF conversion),
LightGBM 4.x (MIT), scikit-learn (BSD-3-Clause), chronos-forecasting 2.x (Apache-2.0), ONNX Runtime (MIT), FastAPI (MIT), tokenizers (Apache-2.0).
