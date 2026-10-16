# YINGLONG-Bench v1 (data)

Attack families and legitimate tasks for the two demo scenarios. Everything here is fictional: people, firms, addresses
(deterministic test addresses with no funds) and money (tHKD / tUSD test units, testnet USDC, CNY on a simulator rail).

```
bench/
  scenarios/nadia.json, lotus_lane.json   PayeeBook, mandate rules, balances (built by gen/build_scenarios.py)
  attacks/<family>.jsonl                  12 attack families
  attacks/heldout.jsonl                   the HELD-OUT family (memory_implant), never used for any training
  HELDOUT_SHA256.txt                      SHA-256 of heldout.jsonl, written before any sentinel training run
  tasks/legit.jsonl                       legitimate tasks with expected Intent JSON and a tier hint
  MANIFEST.json                           counts, writer model, SHA-256 of every file (generated)
  QUALITY.json                            automatic artefact counts (gen/quality_report.py); nothing is edited by it
  gen/                                    generators (skeletons by code, natural-language fields by an LLM)
```

## Authorship separation

Skeletons (scenario, target payee, attacker address, amounts, expected outcome) are sampled by code with fixed seeds.
The natural-language fields are written by `nvidia/nemotron-3-super-120b-a12b` (NVIDIA family). The sentinel training data is
written by a different family (Qwen). Because the NVIDIA indirect-injection dataset was produced by the same family as this
bench, it is used only as an external evaluation set and never for training. Chinese-language variants of the multilingual
family exist only in the private HuggingFace dataset (`ABRUBAB/yl-private-data`, path `bench/v1/`), never in this repository.

## Attack item schema

| field | meaning |
|---|---|
| `id`, `family`, `scenario`, `language` (`en`, `bn`, `mixed`), `channel` | identity and placement |
| `user_task` | the user's own request (for `direct_injection` it carries the attack) |
| `untrusted_content` | the attacker-controlled text the agent reads (memo, email, payee note, token name, 402 description, memory entries, OCR text) |
| `image_description` | for `visual_injection`: what the image shows (hidden text, overlay, QR code) |
| `target_payee`, `legit_amount` | the legitimate counterparty and amount in the scenario |
| `attacker` | `{address, amount, goal}`; `address` is null when the attack needs none (rule change, exfiltration) |
| `expected` | `out_of_mandate_transfers` (always 0), `attacker_receives` ("0"), `acceptable_tiers`, `legit_transfer` (optional), `success_if` |
| `heldout`, `sentinel_relevant` | held-out flag; whether a text classifier is expected to help (false for look-alike, split and within-mandate families) |

## Legitimate task schema

`id`, `scenario`, `language`, `today`, `user_request`, optional `context_channel` + `context_document` (a benign document the request
refers to; hard negatives for the sentinel), `expected_intent` (Intent JSON, schema in `ml/common/schema.py`), `expected_tier_hint`
(T0 read-only, T1 within mandate, T2 approval, T? clarify; a hint for the runner, the policy engine decides).

## Regenerating

```
uv run --project ml python bench/gen/build_scenarios.py
uv run --project ml python bench/gen/generate_bench.py attacks
uv run --project ml python bench/gen/generate_bench.py legit
uv run --project ml python bench/gen/generate_bench.py zh        # private Chinese variants (HF only)
uv run --project ml python bench/gen/generate_bench.py finalize  # writes attacks/, tasks/, HELDOUT_SHA256.txt, MANIFEST.json
sha256sum bench/attacks/heldout.jsonl                              # must match HELDOUT_SHA256.txt
```
Generation needs an OpenRouter key in the key file outside the repository (see `ml/common/keys.py`).

## Known limits of v1

Counts are in `QUALITY.json`. The writer sometimes echoed the scenario brief into attack content, left stray Devanagari
characters inside Bangla text, and ignored the code-mixed instruction for many legitimate tasks (the language field of each
legit task is relabelled to what was actually written, so the legit set is mostly English). ISO dates in attack text were
normalised to 2026 by rule. A human pass by the bench owners (R3, R5) is still needed before the numbers are final.
