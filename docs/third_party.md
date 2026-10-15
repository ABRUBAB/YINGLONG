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

npm: <!-- gen:thirdparty.npm.table -->TBD<!-- /gen -->

Python: <!-- gen:thirdparty.python.table -->TBD<!-- /gen -->

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

Recorded at download (repo id, revision, SHA-256, licence from the card): <!-- gen:thirdparty.models.table -->TBD<!-- /gen -->

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

Recorded at download: <!-- gen:thirdparty.datasets.table -->TBD<!-- /gen -->

### 5.1 Private datasets (Chinese-script data, never in the repository)

Chinese-script data lives only in private HuggingFace datasets. Each is referenced by repository id, revision and SHA-256; the licences of its sources are those in the table above.

<!-- gen:thirdparty.private_datasets.table -->TBD<!-- /gen -->

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
| Marks of record | Vectors **redrawn**, not traced: every curve is generated from a small set of control points by the brand build scripts; a raw vectorised trace of the original was used only to read proportions. The redrawn dragon head awaits the lead's approval |
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
