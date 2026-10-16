# YINGLONG Third-Party Register: licences, data, models and marks

*What we reuse, under which licence, and the rules we follow for other people's marks.*

**Summary (5 lines)**
1. YINGLONG is licensed Apache-2.0; the MetaMask Delegation Framework v1.3.0 is a pinned submodule under MIT and Apache-2.0, and one of its dependencies (ERC-4337 interfaces) is GPL-3.0, which needs a licence review (DC-11).
2. Every model and dataset is listed with its licence before use; entries we have not yet confirmed at the source are marked unverified, and the generated tables record revision and SHA-256 at download time.
3. Chinese-script data never enters the repository; it lives in private HuggingFace datasets referenced here by id, revision and SHA-256.
4. Both brand originals were team-supplied AI-generated rasters; they were redrawn as vectors, the vectors are the marks of record, and no trademark symbol is used.
5. Third-party logos appear only as official files, unmodified, where their owners' rules allow; WeBank's and Circle's logos are never shown, and no partnership or endorsement is implied.

Status labels: [V] verified in this repository or at the source; [S] secondary source (our plan's record), confirm at the source before release; [U] unverified, must be recorded before use. Plan sections cited: 11 (models and data), 15.3 (third-party marks), Appendix A (versions).

---

## 1. This repository

| Item | Licence | Status |
|---|---|---|
| YINGLONG source, docs and contracts | Apache-2.0 (`LICENSE`) | [V, repo] |

## 2. Contract dependencies (git submodule)

| Component | Version | Licence | Status | Used for |
|---|---|---|---|---|
| MetaMask Delegation Framework | v1.3.0 (`contracts/lib/delegation-framework`) | MIT AND Apache-2.0 (SPDX headers; both licence files present) | [V, repo] | DelegationManager, HybridDeleGator, MultiSigDeleGator, stock caveat enforcers |
| Framework third-party audit reports (Cyfrin, Consensys Diligence) | as shipped in `audits/` | Owners' terms | [V, repo] | Reference only; they cover the framework, not YINGLONG |
| eth-infinitism `account-abstraction` (via framework) | v0.7.0 | **GPL-3.0** | [V, repo] | ERC-4337 interfaces (`IEntryPoint`, `PackedUserOperation`) imported by the framework. Compatibility with our Apache-2.0 licence needs review (DC-11) |
| OpenZeppelin Contracts (via framework) | as pinned by the framework | MIT | [V, repo] | ECDSA, EIP-712, Ownable, Pausable |
| erc7579-implementation, Rhinestone (via framework) | as pinned | MIT-style permissive licence | [V, repo] | Execution encoding (`ExecutionLib`) |
| FreshCryptoLib and FCL, Renaud Dubois (via framework) | as pinned | MIT | [V, repo] | P-256 verification fallback |
| SCL (via framework) | as pinned | MIT (per README and SPDX headers; no licence file in the checkout) | [V, repo] | P-256 / WebAuthn verification |
| forge-std (via framework) | as pinned | MIT and Apache-2.0 | [V, repo] | Tests |
| solidity-bytes-utils (via framework) | as pinned | Unlicense (public-domain dedication) | [V, repo] | Byte utilities |
| solidity-stringutils (via framework) | as pinned | Apache-2.0 | [V, repo] | String utilities |

## 3. Package dependencies (generated from the SBOM)

Versions are pinned in the workspace catalog (plan Appendix A); licences are read from the installed packages at release, never typed.

npm: <!-- gen:thirdparty.npm.table -->37 direct dependencies of 12 workspace packages (version and licence read from each installed package.json):

| Package | Version | Licence | Kind | Used by |
|---|---|---|---|---|
| `@axe-core/playwright` | 4.13.0 | MPL-2.0 | dev | apps/web |
| `@aztec/bb.js` | 5.2.1 | MIT | runtime | circuits |
| `@base-ui/react` | 1.9.0 | MIT | runtime | apps/web |
| `@gsap/react` | 2.1.2 | SEE LICENSE AT https://gsap.com/standard-license | runtime | apps/web |
| `@hono/node-server` | 2.1.5 | MIT | runtime | apps/agent, apps/ecny-sim, apps/indexer, apps/services, apps/signer |
| `@noble/curves` | 2.4.0 | MIT | dev | apps/web |
| `@noble/hashes` | 2.4.0 | MIT | dev, runtime | apps/web, packages/ui |
| `@noir-lang/noir_js` | 1.0.0-rc.5 | (MIT OR Apache-2.0) | runtime | circuits |
| `@number-flow/react` | 0.6.2 | MIT | runtime | apps/web |
| `@paper-design/shaders-react` | 0.0.81 | Apache-2.0 | runtime | apps/web |
| `@playwright/test` | 1.64.1 | Apache-2.0 | dev | apps/web |
| `@react-three/drei` | 10.7.9 | MIT | runtime | apps/web |
| `@react-three/fiber` | 9.8.2 | MIT | runtime | apps/web |
| `@react-three/postprocessing` | 3.2.0 | MIT | runtime | apps/web |
| `@tailwindcss/postcss` | 4.3.3 | MIT | dev | apps/web |
| `@types/node` | 24.19.2 | MIT | dev | apps/agent, apps/ecny-sim, apps/indexer, apps/services, apps/signer, apps/web, packages/mandate, packages/provenance, packages/sdk, packages/ui, circuits |
| `@types/react` | 19.3.0 | MIT | dev | apps/web, packages/ui |
| `@types/react-dom` | 19.3.0 | MIT | dev | apps/web |
| `@types/three` | 0.186.0 | MIT | dev | apps/web |
| `gsap` | 3.15.0 | Standard 'no charge' license: https://gsap.com/standard-license. | runtime | apps/web |
| `hono` | 4.13.13 | MIT | runtime | apps/agent, apps/ecny-sim, apps/indexer, apps/services, apps/signer |
| `motion` | 14.2.0 | MIT | runtime | apps/web |
| `next` | 16.4.1 | MIT | runtime | apps/web |
| `ox` | 0.14.56 | MIT | runtime | packages/sdk |
| `postprocessing` | 6.39.5 | Zlib | runtime | apps/web |
| `react` | 19.3.1 | MIT | runtime, dev | apps/web, packages/ui |
| `react-dom` | 19.3.1 | MIT | runtime | apps/web |
| `sharp` | 0.35.5 | Apache-2.0 | dev | apps/web |
| `tailwindcss` | 4.3.3 | MIT | dev | apps/web |
| `three` | 0.186.1 | MIT | runtime | apps/web |
| `tsx` | 4.23.15 | MIT | dev | (root), apps/agent, apps/ecny-sim, apps/indexer, apps/services, apps/signer, packages/ui, circuits |
| `turbo` | 2.11.8 | MIT | dev | (root) |
| `typescript` | 5.9.3 | Apache-2.0 | dev | (root), apps/agent, apps/ecny-sim, apps/indexer, apps/services, apps/signer, apps/web, packages/mandate, packages/provenance, packages/sdk, packages/ui, circuits |
| `uqr` | 0.1.3 | MIT | runtime | apps/web |
| `viem` | 2.57.7 | MIT | runtime | apps/agent, apps/ecny-sim, apps/indexer, apps/services, apps/signer, apps/web, packages/mandate, packages/sdk, circuits |
| `vitest` | 5.0.5 | MIT | dev | apps/agent, apps/ecny-sim, apps/indexer, apps/services, apps/signer, apps/web, packages/mandate, packages/provenance, packages/ui |
| `zod` | 4.6.7 | MIT | runtime | apps/agent, apps/ecny-sim, apps/indexer, apps/services, apps/signer, apps/web, packages/mandate |
<!-- /gen -->

Python: <!-- gen:thirdparty.python.table -->35 direct dependencies of 3 Python projects (version from each uv.lock, licence from the installed package metadata):

| Package | Version | Licence | Group | Project |
|---|---|---|---|---|
| `eth-abi` | 5.2.0 | MIT | runtime | tools/verify-py |
| `pycryptodome` | 3.24.1 | BSD, Public Domain | runtime | tools/verify-py |
| `pytest` | 9.1.1 | MIT | dev | tools/verify-py |
| `huggingface-hub` | 2.2.0 | Apache-2.0 | runtime | ml |
| `datasets` | 5.1.0 | Apache 2.0 | runtime | ml |
| `kaggle` | 2.2.4 | Apache License | runtime | ml |
| `openai` | 3.31.0 | Apache-2.0 | runtime | ml |
| `jsonschema` | 4.26.0 | MIT | runtime | ml |
| `numpy` | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | runtime | ml |
| `pandas` | 3.0.6 | BSD 3-Clause License | runtime | ml |
| `scikit-learn` | 1.9.1 | BSD-3-Clause | runtime | ml |
| `lightgbm` | 4.7.0 | MIT | runtime | ml |
| `pyarrow` | 26.0.0 | Apache-2.0 | runtime | ml |
| `tqdm` | 4.70.1 | MPL-2.0 AND MIT | runtime | ml |
| `torch` | 2.14.1+cpu | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT | cpu-models | ml |
| `transformers` | 5.20.0 | Apache 2.0 License | cpu-models | ml |
| `onnx` | 1.23.2 | Apache-2.0 | cpu-models | ml |
| `onnxruntime` | 1.31.0 | MIT License | cpu-models | ml |
| `chronos-forecasting` | 2.3.2 | Apache License | cpu-models | ml |
| `tokenizers` | 0.23.3 | Apache Software License | cpu-models | ml |
| `sentencepiece` | 0.2.2 | Apache-2.0 | cpu-models | ml |
| `protobuf` | 7.36.2 | 3-Clause BSD License | cpu-models | ml |
| `onnx-ir` | 1.0.0 | Apache-2.0 | cpu-models | ml |
| `peft` | 0.21.2 | Apache | cpu-models | ml |
| `fastapi` | 0.143.2 | MIT | runtime | ml/serving |
| `uvicorn` | 0.54.0 | BSD-3-Clause | runtime | ml/serving |
| `onnxruntime` | 1.31.0 | MIT License | runtime | ml/serving |
| `tokenizers` | 0.23.3 | Apache Software License | runtime | ml/serving |
| `numpy` | 2.5.4 | not read (the locked version is not installed in the project environment) | runtime | ml/serving |
| `scikit-learn` | 1.9.1 | BSD-3-Clause | runtime | ml/serving |
| `lightgbm` | 4.7.0 | MIT | runtime | ml/serving |
| `huggingface-hub` | 2.2.0 | Apache-2.0 | runtime | ml/serving |
| `pydantic` | 2.14.1 | MIT | runtime | ml/serving |
| `httpx` | 0.28.1 | BSD-3-Clause | dev | ml/serving |
| `pytest` | 9.1.1 | MIT | dev | ml/serving |
<!-- /gen -->

### Front end

Libraries and copied component patterns used by `apps/web` (the generated table above lists installed versions; this table records why each front-end piece is there and what was copied). Checked 16 Oct 2026: every version is older than two weeks, pinned exactly, and fetches nothing from a third-party origin at runtime (Playwright `tests/network.spec.ts`).

| Piece | Version | Licence | Kind | Used for |
|---|---|---|---|---|
| `@paper-design/shaders-react` (+ `@paper-design/shaders`) | 0.0.81 (released 17 Sep 2026) | Apache-2.0 | installed, exact pin | `Dithering` atmosphere behind the landing hero, two greys of the obsidian ramp; lazy-loaded, paused off-screen and under reduced motion |
| `three`, `@react-three/fiber`, `@react-three/drei` | 0.186.1, 9.8.2, 10.7.9 | MIT | installed (existing) | Mandate Orbit hero scene: InstancedMesh receipts and refusals, procedural `Environment` with `Lightformer`s only (no preset, no CDN) |
| `@react-three/postprocessing`, `postprocessing` | 3.2.0, 6.39.5 | MIT, Zlib | installed (existing) | Bloom on specular highlights only (threshold 0.92), desktop pointers only |
| `gsap`, `@gsap/react` (ScrollTrigger, SplitText) | 3.15.0, 2.1.2 | GSAP Standard "no charge" licence (not MIT) | installed (existing) | Seven-verbs scroll story (imported after hydration): scrubbed ring progress, letter reveals; seal press-and-hold |
| `motion` | 14.2.0 | MIT | installed (existing) | Available for in-component state in the app routes; kept off the landing page, where CSS does the same job without the bundle |
| `@number-flow/react` | 0.6.2 | MIT | installed (existing) | Hero counters (receipts inside, refusals, budget left) |
| Magic UI `Marquee` (magicui.design) | pattern, 2026 | MIT | **adapted, not copied verbatim**: CSS track duplication and linear loop re-implemented in `app/globals.css` (`.yl-marquee`) | Evidence ribbon of real hashes; own pause button, pauses on hover, focus, Pause motion and reduced motion |
| Magic UI `MagicCard` (magicui.design) | pattern, 2026 | MIT | **adapted, not copied verbatim**: pointer-following radial light restyled to a monochrome 1 px border (`components/ui/spotlight-card.tsx`, `.yl-spotlight`) | Pillar and team cards |

No Aceternity or React Bits code is used.

## 4. Models

| Model | Use | Licence | Status |
|---|---|---|---|
| `jhu-clsp/mmBERT-base` | M1 injection sentinel (primary) | MIT | [S] per plan; confirm on the model card |
| `microsoft/mdeberta-v3-base` | M1 control arm | Not yet recorded | [U] |
| `Qwen/Qwen3.5-2B`, `Qwen/Qwen3.5-4B`, `Qwen/Qwen3.5-9B` | M4 intent model (LoRA), M7 vision reader, local development | Not yet recorded | [U] |
| `google/gemma-4-E2B-it` | M4 zero-shot comparison; international-profile endpoints | Not yet recorded | [U] |
| `Qwen/Qwen3-8B-AWQ`, `Qwen/Qwen3.8-27B` | Bench executor arms | Not yet recorded | [U] |
| `Qwen/Qwen3Guard-Stream-0.6B`, `Qwen/Qwen3Guard-Gen-0.6B` | Content safety (mainland profile); sentinel baseline | Not yet recorded | [U] |
| `amazon/chronos-2` | M5 cash-flow forecaster | Not yet recorded | [U] |
| Llama Prompt Guard 2 86M, Horizon-Labs prompt-injection guard, Wolf Defender, protectai v2 | Sentinel baselines only | Not yet recorded | [U] |
| A Bangla/Banglish injection detector and an mmBERT-based v5 guard (both published on HuggingFace) | Evaluation reference only; never in training or the held-out set | Not yet recorded | [U] per plan |
| Hosted models via OpenRouter, DashScope, DeepSeek | Inference | Providers' terms; free endpoints may log prompts (KR-14) | [S] |

Recorded at download (repo id, revision, SHA-256, licence from the card): <!-- gen:thirdparty.models.table -->Read from the ML register and manifests at generation (third-party revisions as recorded by the ML workstream; our own models with the hashes in their manifests):

| Model | Revision | SHA-256 | Licence | Role | Recorded in |
|---|---|---|---|---|---|
| `jhu-clsp/mmBERT-base` | `c5955035435e` | not recorded | MIT | M1 sentinel backbone (primary arm) | `ml/THIRD_PARTY.md` |
| `jhu-clsp/mmBERT-small` | `abc32620dd4f` | not recorded | MIT | M1 low-latency arm (fine-tuned as `ABRUBAB/yl-sentinel-mmbert-small`) | `ml/THIRD_PARTY.md` |
| `microsoft/mdeberta-v3-base` | `a0484667b223` | not recorded | MIT | M1 control arm | `ml/THIRD_PARTY.md` |
| `protectai/deberta-v3-base-prompt-injection-v2` | `90c9989b1a34` | not recorded | Apache-2.0 | M1 off-the-shelf baseline, inference only | `ml/THIRD_PARTY.md` |
| `Qwen/Qwen3.5-2B` | `15852e8c1636` | not recorded | Apache-2.0 | M4 intent model (LoRA) | `ml/THIRD_PARTY.md` |
| `Qwen/Qwen3.5-4B` | `851bf6e806ef` | not recorded | Apache-2.0 | M4 intent model (LoRA, long run) | `ml/THIRD_PARTY.md` |
| `Qwen/Qwen3-1.7B` | `70d244cc86cc` | not recorded | Apache-2.0 | M4 fallback if Qwen3.5 fails in fp16 on T4 | `ml/THIRD_PARTY.md` |
| `Qwen/Qwen3-4B` | `1cfa9a720891` | not recorded | Apache-2.0 | M4 fallback for the 4B arm | `ml/THIRD_PARTY.md` |
| `google/gemma-4-E2B-it` | `3e22461f65e8` | not recorded | Apache-2.0 | M4 zero-shot comparison only | `ml/THIRD_PARTY.md` |
| `Qwen/Qwen3-14B-AWQ` | `31c69efc2946` | not recorded | Apache-2.0 | Synthetic-data writer and verifier (sentinel finance set, intent set) on Kaggle | `ml/THIRD_PARTY.md` |
| `amazon/chronos-2` | `29ec3766d36d` | not recorded | Apache-2.0 | M5 forecaster (zero-shot, known future covariates) | `ml/THIRD_PARTY.md` |
| `nvidia/nemotron-3-super-120b-a12b` (OpenRouter free endpoint) | API, 15-16 Oct 2026 | not recorded | NVIDIA Open Model License (endpoint terms of OpenRouter) | Writer of the natural-language fields of YINGLONG-Bench (different family from the sentinel data writer) | `ml/THIRD_PARTY.md` |
| `ABRUBAB/yl-sentinel-mmbert-base` (ours) | `1062546bb103` | int8 ONNX `8775f388fc9eea0c0c310395668812fc2d5e4954959aa006e27ef7ebd5c95176` | ours (see the model card) | M1 sentinel ONNX export | `ml/results/m1_onnx_yl-sentinel-mmbert-base.json` |
| `ABRUBAB/yl-sentinel-mmbert-small` (ours) | `778035345e13` | int8 ONNX `9078e8c69df7b9c0f30e2bd6e05478e03388e79d7caaf59a4df6c9171bbe7cb7` | ours (see the model card) | M1 sentinel ONNX export | `ml/results/m1_onnx_yl-sentinel-mmbert-small.json` |
| `ABRUBAB/yl-sentinel-mdeberta-v3-base` (ours) | `771d7aeaca3c` | not recorded | ours (see the model card) | M1 sentinel arm mdeberta | `ml/results/m1_sentinel_mdeberta.json` |
| `ABRUBAB/yl-sentinel-mmbert-base` (ours) | `1062546bb103` | not recorded | ours (see the model card) | M1 sentinel arm mmbert | `ml/results/m1_sentinel_mmbert.json` |
| `ABRUBAB/yl-sentinel-mmbert-small` (ours) | `778035345e13` | not recorded | ours (see the model card) | M1 sentinel arm mmbert_small | `ml/results/m1_sentinel_mmbert_small.json` |
| `ABRUBAB/yl-cpu-models` m3 (ours) | `9499d5575e08` | m3_lightgbm.txt `1ed97c2a723ac4f8...`; m3_models.pkl `7b8af61b9c7f4412...` | ours (see the model card) | M3 served by ml/serving | `ml/serving/models.lock.json` |
| `ABRUBAB/yl-cpu-models` m5 (ours) | `9499d5575e08` | m5_lgbm_q0.05.txt `be1f6e4de1f685a8...`; m5_lgbm_q0.1.txt `60444a43248e2630...`; m5_lgbm_q0.2.txt `c6df9ea4398f5bd6...`; m5_lgbm_q0.3.txt `8d0dcc600cec09e9...`; m5_lgbm_q0.4.txt `86ac9b0cb25ee3e1...`; m5_lgbm_q0.5.txt `0940abba1f8503ca...`; m5_lgbm_q0.6.txt `534c0e634d02b021...`; m5_lgbm_q0.7.txt `79a9463fcfc0a50c...`; m5_lgbm_q0.8.txt `f1f9026781293ee0...`; m5_lgbm_q0.9.txt `3bec617d40c96461...`; m5_lgbm_q0.95.txt `e312618863067b83...` | ours (see the model card) | M5 served by ml/serving | `ml/serving/models.lock.json` |
| `ABRUBAB/yl-sentinel-mmbert-base` onnx (ours) | `1062546bb103` | model_int8.onnx `8775f388fc9eea0c...`; tokenizer.json `79154e60949631bf...` | ours (see the model card) | M1 served by ml/serving | `ml/serving/models.lock.json` |
<!-- /gen -->

Our own weights are published in GitHub Releases and a HuggingFace mirror, never in Git LFS.

## 5. Datasets and benchmarks

| Dataset | Use | Licence | Status |
|---|---|---|---|
| `neuralchemy/Prompt-injection-dataset` | M1 training | Apache-2.0 | [S] per plan |
| deepset prompt-injection dataset | M1 training | Apache-2.0 | [S] per plan |
| NVIDIA Nemotron indirect-injection set | M1 training | CC-BY-4.0 (attribution required) | [S] per plan |
| MultiJail (includes Bengali and Chinese) | M1 training | MIT | [S] per plan |
| FineWeb-2 | Benign Chinese and Bangla negatives | Not yet recorded | [U] |
| Horizon-Labs eval suite (updated 7 Oct 2026) | Held-out headline evaluation | Not yet recorded | [U] |
| AgentDojo v0.1.35 (banking suite) | External bench | MIT | [S] per plan |
| InjecAgent | External bench | MIT | [S] per plan |
| CrAIBench | External bench | MIT | [S] per plan |
| `xTRam1/safe-guard-prompt-injection` | **Excluded**: no licence tag | — | [S] per plan |
| Public scam-address graph for M2(b) | Used only after its licence is recorded | Not yet recorded | [U] |
| OFAC SDN list, UN consolidated sanctions list | Local mirror for counterparty screening | Publishers' terms | [U] |
| Our synthetic data (requests, attacks, ledgers, personas) | Training, bench | Apache-2.0 with this repository | [I] |

Recorded at download: <!-- gen:thirdparty.datasets.table -->Read from the ML register and manifests at generation:

| Dataset | Revision | Licence | Use | Recorded in |
|---|---|---|---|---|
| `neuralchemy/Prompt-injection-dataset` (config `full`) | `7d70432dfcf47a821612cbf9d34e9d9e3ad20e75` | Apache-2.0 | M1 train / validation / test as published | `ml/THIRD_PARTY.md` |
| `deepset/prompt-injections` | `4f61ecb038e9c3fb77e21034b22511b523772cdd` | Apache-2.0 | M1 train / test as published | `ml/THIRD_PARTY.md` |
| `DAMO-NLP-SG/MultiJail` | `93d65c778925d55973b9ff30c7bccc8545494eb6` | MIT | M1 positives (kind `jailbreak`), English and Bangla rows in all splits; Chinese rows only inside the private HF dataset | `ml/THIRD_PARTY.md` |
| `nvidia/Nemotron-RL-Agentic-Indirect-Prompt-Injection-v1` | `d738d4f361cc38bb4d7a42b9066776dade5332f5` | CC-BY-4.0 | **Evaluation only** (external indirect-injection test). Not used for training, because the bench writer belongs to the same model family (authorship separation). Attribution: NVIDIA Corporation, CC-BY-4.0 | `ml/THIRD_PARTY.md` |
| `xTRam1/safe-guard-prompt-injection` | - | none tagged | **Excluded** (no licence tag) | `ml/THIRD_PARTY.md` |
| Derived sentinel splits (neuralchemy, deepset, multijail, yl_finance_synth, nvidia_ipi) | see private datasets | per source | rows: train 15224, validation 1592, test 2099, ext_test 1812 | `ml/results/sentinel_data_manifest.json` |
| YINGLONG-Bench v1 (ours, synthetic) | this repository | Apache-2.0 with this repository | 300 attacks, 239 legitimate tasks; SHA-256 per file in the manifest | `bench/MANIFEST.json` |
<!-- /gen -->

### 5.1 Private datasets (Chinese-script data, never in the repository)

Chinese-script data lives only in private HuggingFace datasets. Each is referenced by repository id, revision and SHA-256; the licences of its sources are those in the table above.

<!-- gen:thirdparty.private_datasets.table -->Private HuggingFace datasets (Chinese-script rows live only there), as recorded in the ML manifests; the Chinese variants of the bench (`bench/v1/` in the same dataset) have no revision or hash recorded in this repository:

| Dataset | Revision | File | SHA-256 | Recorded in |
|---|---|---|---|---|
| `ABRUBAB/yl-private-data` (sentinel v1) | `5e701ed8d111` | ext_test.jsonl | `06028d0e2a9e426de9ec0316c356d22f57fa8f0ae3cf0858ea9debd8f7e18335` | `ml/results/sentinel_data_manifest.json` |
| `ABRUBAB/yl-private-data` (sentinel v1) | `5e701ed8d111` | test.jsonl | `557fb77a2ef4f0221f6da8f86ed244ef7ed0c91fcaab378971653a6f82e6ec3a` | `ml/results/sentinel_data_manifest.json` |
| `ABRUBAB/yl-private-data` (sentinel v1) | `5e701ed8d111` | train.jsonl | `c811b639977b62940f18f575af414ec078e6f700d2b10c6162bbcc91ce14f538` | `ml/results/sentinel_data_manifest.json` |
| `ABRUBAB/yl-private-data` (sentinel v1) | `5e701ed8d111` | validation.jsonl | `ac0986bae6cd18cbe2474191bf8c4677c0e828861236b780b16e5f8e1a8c4618` | `ml/results/sentinel_data_manifest.json` |
| `ABRUBAB/yl-private-data` (intent v1) | `67022bce4b04` | train.jsonl | `1a4016a252d390429eab758d542c1966fe36e8962e6e797b5a722f142d638cff` | `ml/results/intent_data_manifest.json` |
| `ABRUBAB/yl-private-data` (intent v1) | `67022bce4b04` | val.jsonl | `be9b07aeafb1f52d55b37d2fb75672e98cb77dab4e5753ac784c6f40c36e737c` | `ml/results/intent_data_manifest.json` |
| `ABRUBAB/yl-private-data` (intent v1) | `67022bce4b04` | test.jsonl | `89528a559d3e86062a5f3fa80b8468557d24126f6f807d3f4e80dcc3f1349120` | `ml/results/intent_data_manifest.json` |
<!-- /gen -->

## 6. Fonts

| Font | Licence | Status | Note |
|---|---|---|---|
| Hubot Sans (GitHub) | SIL OFL 1.1 | [V, licence text in the brand kit] | Wordmark outlines instanced in memory; Reserved Font Names not reused |
| Geist and Geist Mono (Vercel) | SIL OFL 1.1 | [V, licence text in the brand kit] | UI, numbers, hashes |
| Anek Bangla | SIL OFL 1.1 | [S] per plan | Only to echo Bangla user input |

Fonts are self-hosted; no request goes to a third-party font host.

## 7. Our brand assets

| Item | Fact |
|---|---|
| Originals | `YINGLONG_logo.png` (1254 px RGB, no alpha) and the team logo (640 px JPEG) are **team-supplied AI-generated rasters** |
| Generator, date and terms of the originals | **Not recorded yet** [U]. The lead records them here before submission: generator: ______; date: ______; terms of use: ______ |
| Marks of record | Vectors **redrawn**, not traced: every curve is generated from a small set of control points by the brand build scripts; a raw vectorised trace of the original was used only to read proportions. The dragon mark is retired from the web app (16 Oct 2026): the site uses only the S glyph (ring, pearl and S stroke) |
| Trademarks | No trademark symbols; none of these marks is registered |
| Optional 3D lighting | If an HDR environment is used: a self-hosted 1k file from Poly Haven, CC0 [S] |

## 8. Third-party marks (plan section 15.3)

Official files only, as-is, at nominal size, never recoloured, never in our icons or favicons, never in a co-branded lockup.

| Brand | Source | Rule we follow |
|---|---|---|
| Base | brand.base.org; github.com/base/brand-kit | Blue, white or black only; no effects; never a co-branded lockup (we are not a partner) |
| Ethereum | ethereum.org/en/assets | Grey glyph unmodified; licence statement not found [U] |
| MetaMask | metamask.io/assets | Fox icon only beside "Connect with MetaMask (ERC-7715)"; read the pack's guideline first |
| Circle / USDC / Arc | Circle press kit and Brand Use Policy | **No Circle logo** (needs written authorisation); USDC and Arc marks only in the `/proof` chain matrix and the exhibit slide, unmodified, never recoloured, never in our icons or on adoption slides; minimum sizes [U]; elsewhere the text chip "USDC (testnet)" |
| Conflux | Official brand-assets page | No crop, rotation, recolour or effects |
| FISCO BCOS | Logo SVG in the FISCO-BCOS repository | Apache-2.0 grants no trademark rights: nominal size with "runs on FISCO BCOS (open source)" |
| WeBank | — | **Never show its logo**; prose only, as the originator of the stack, never as a partner |
| HashKey Chain, Tempo, x402, ERC-8004, Coinbase | No usable public kit found | Text labels only: "HashKey Chain testnet (chain ID 133)", "Tempo Moderato (42431)", "x402 v2", "ERC-8004 (Draft)" |

Footer line on `/proof`, `/city` and the deck: **"All third-party marks are the property of their respective owners. No partnership, sponsorship or endorsement is implied."**

## 9. Standards and specifications cited

Cited for interoperability, never as endorsement: ERC-8004 (Draft), ERC-7710, ERC-7715, ERC-4337, ERC-1271, EIP-712, EIP-3009, ERC-2612, x402 v2, W3C Verifiable Credentials 2.0, A2A 1.0, MCP specification 2026-07-28, RFC 8785, ERC-8226 (Draft), ERC-8196 (Final), ERC-8262 (Draft) [S, as read on the EIP pages per plan].

## 10. Services

| Service | Use | Terms note |
|---|---|---|
| Kaggle | Training and bench compute | One account per person; each teammate runs their own notebooks [S] |
| HuggingFace | Model and private dataset hosting | Tokens kept outside the repository |
| OpenRouter, DashScope, DeepSeek | Model inference | Free endpoints may log prompts (KR-14); mainland profile uses domestic endpoints (see DC-07) |
| Microsoft Azure | VPS (East Asia) | Student credit |
| MetaMask x402 facilitator (development host) | x402 settlement on Base Sepolia | Third-party service; fallback seller-settled |
| Coinbase CDP and Circle faucets, Pimlico, Etherscan API | Testnet funds, bundler, contract verification | Free tiers |
| YouTube, Bilibili, GitHub Releases | Video and weights hosting | Platform terms |
