# Generated-Number Keys

*Every key used in a generated-number marker in the documents, what it means, and which component produces it.*

**Summary (5 lines)**
1. No number, hash, time, count or status about the running system is typed by hand in these documents; each sits inside a generated-number marker that `scripts/finalize` (`apps/agent/scripts/finalize.ts`) fills.
2. A marker is an HTML comment pair: an opening comment `gen:` followed by the key, the value, and a closing `/gen` comment; it is invisible when the Markdown is rendered.
3. This file lists every key with a one-line definition, the producing component and the documents that use it; finalize warns about any key used in a document but not listed here, and `finalize --final` stops on one.
4. If the producing data does not exist, finalize writes "not yet measured" (or, with `--final`, "not measured in this release"), or an explicit word such as "not drilled" or "not run: reason"; never a guess and never a target.
5. Rates carry a Wilson 95% interval and their n; times carry their n, the ledger and the method of measurement.

Producer abbreviations: **FIN** `apps/agent/scripts/finalize.ts` (helpers in `apps/agent/scripts/evidence/`); **EVG** the evidence readers inside FIN over the deployment files, the live agent API (`GET /v1/receipts`, `/v1/principals/:id/state`, `/batches`) and the read-only FISCO RPC (`/rpc/fisco`); **BENCH** `bench/` run reports (`bench/reports/*.json`); **DRILL** drill scripts (`apps/agent/scripts/drills.ts` writes `docs/evidence/drills/timing-<ledger>.json`; `ir-drill.ts` writes `docs/evidence/drills/pb1.json` and `pb1.sha256`; `supervisor-pause.ts` writes `docs/evidence/drills/supervisor-pause-<ledger>.json`); **TESTS** the suites run by `finalize --tests` (forge `--json`, vitest JSON per workspace package, pytest JUnit XML, the node test runner's TAP output, Playwright JSON); **CR** the contract analysis reports in `contracts/reports/` (`slither.json`, `aderyn.json` or `aderyn.attempts.json`, `coverage.json`, `gas.json`, `symbolic.json`, `fuzz.json`, each with `tool`, `version`, `command`, `generatedAt`, `commit`). Document abbreviations: SA self-assessment, TM threat model, PIA, IR incident response, CM compliance matrix, CL claims, JG judge's guide, TP third-party register, SR security review, TE technical, EN enforcers, RM README.

Run modes: without `--tests`, the previous bundle's `tests.*`, `invariants.*` and `verify.*` metrics and its per-suite results (`testRuns` in `docs/evidence/bundle.json`) are carried over; `--reach` adds the mainland reachability measurement; `--final` switches the placeholder to "not measured in this release" and enforces this key list.

## meta

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `meta.release_tag` | `git describe --tags --always` at generation | FIN (git) | SA, PIA, SR |
| `meta.commit` | Full commit SHA the evidence was generated from, with a note when the working tree had uncommitted changes | FIN (git) | SA, PIA |
| `meta.generated_at` | UTC timestamp of the finalize run | FIN | SA |

## tests, invariants, proofs, static analysis

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `tests.total` | Tests passing across every suite that ran (Foundry, vitest per package, pytest, circuits prover, nargo, Playwright) | TESTS | SA, CL, SR, TE |
| `tests.failed` | Tests failing across those suites, with the failing suites named; "0" when none | TESTS | SA, SR |
| `tests.contracts` | Foundry tests passing (`forge test --json` in `contracts/`, unit, fuzz and invariant entries) | TESTS | SA, EN, TE, RM |
| `tests.contracts.failed` | Foundry tests failing | TESTS | bundle |
| `tests.forge.nadia` | Passing tests in `NadiaMandateTest` | TESTS | EN, TE |
| `tests.ts` | vitest tests passing, summed over every workspace package whose test script is vitest | TESTS | SA, EN, TE |
| `tests.vitest.mandate` | vitest result for `packages/mandate` ("N", or "N passed, F failed", with skipped tests counted) | TESTS | TE |
| `tests.vitest.ui` | vitest result for `packages/ui` | TESTS | bundle |
| `tests.vitest.agent` | vitest result for `apps/agent` (tier property test, PII-scrubber recall test) | TESTS | bundle |
| `tests.vitest.services` | vitest result for `apps/services` (needs the local Anvil deployment) | TESTS | TE |
| `tests.vitest.indexer` | vitest result for `apps/indexer` (needs the local Anvil deployment) | TESTS | TE |
| `tests.vitest.ecny_sim` | vitest result for `apps/ecny-sim` (needs the local Anvil deployment) | TESTS | TE |
| `tests.vitest.web` | vitest result for `apps/web` (`lib/**/*.test.ts`; the live integration test is skipped unless `AGENT_API_IT` is set) | TESTS | bundle |
| `tests.py` | pytest tests passing in `tools/verify-py` | TESTS | SA, EN, TE, RM |
| `tests.pytest.verify_py` | pytest result for `tools/verify-py` | TESTS | TE |
| `tests.node.prover` | `circuits/prover` tests passing (node test runner through tsx, TAP summary) | TESTS | TE |
| `tests.nargo.circuit` | `nargo test` result in `circuits/mandate_compliance`, or "not run: nargo is not installed on the evidence host" | TESTS | TE |
| `tests.e2e` | Playwright tests passing against the fixtures build of `apps/web` (`pnpm --dir apps/web build:e2e`, system Chrome) | TESTS | SA |
| `tests.guard` | Signing-domain guard tests (`describe("signing-domain guard")` in `apps/web/lib/api/contract.test.ts`): passed and failed | TESTS | CL (decision), bundle |
| `tests.suites` | One line per suite with its result | TESTS | bundle |
| `tests.run_at` | When the test results in the bundle were produced | FIN | bundle |
| `tests.monotonic.status` | Result of the property tests that no AI signal lowers a tier or produces T3/T4, with the case counts read from `apps/agent/test/tiers.test.ts` | TESTS | SA, TE |
| `tests.vectors.shared` | Number of JSON policy vectors run in both vitest and Foundry | not produced in this release | none |
| `tests.vectors.agreement` | Whether the TypeScript mirror and the Solidity enforcers agree on every shared vector | not produced in this release | none |
| `invariants.passing` | Plan invariants (1 to 10) that held in the Foundry stateful-fuzz campaign, as "k/10", with the numbering read from the `/// Invariant N:` comments in `contracts/test/invariants/MandateInvariants.t.sol`, runs x depth from `contracts/foundry.toml`, and the source run (this finalize run, or `contracts/reports/fuzz.json`) | TESTS, CR | SA, CL, EN, TE |
| `invariants.table` | Per invariant 1 to 10: Foundry campaign status, Halmos status from `contracts/reports/symbolic.json`, Medusa, Echidna and Kontrol ("not run" where no run exists) | TESTS, CR | SA, SR |
| `fuzz.calls` | Total calls executed: invariant handler calls (runs x depth) plus fuzz-test runs | CR (`fuzz.json`) | SR |
| `fuzz.differential.split` | Differential-fuzz outcomes split into policy-rejected / reverted attack / reverted divergence | not produced in this release (no differential fuzzing in the repository) | SA, SR |
| `proofs.symbolic.status` | Bounded symbolic-execution status of invariants 1 to 5 (properties proved within bounds, tool version, loop bound, solver timeout, what is and is not executed symbolically, Kontrol status) | CR (`symbolic.json`) | SA, CL, SR, TE |
| `static.slither.high` | Slither high-severity findings open after triage, with the raw count, version and detector count | CR (`slither.json`) | SA, SR, TE |
| `static.slither.medium` | Slither medium-severity findings open after triage, with the raw count and how many were triaged as false positives | CR | SR |
| `static.aderyn.high` | Aderyn high-severity findings open after triage, or "not run" with the recorded attempts | CR | SR |
| `coverage.contracts` | Line, statement, branch and function coverage of `contracts/src` (`forge coverage`) | CR (`coverage.json`) | SR, TE |
| `gas.overhead.median` | Median (p95, n) gas overhead per payment of the sealed YINGLONG mandate vs the same payment with stock enforcers only | CR (`gas.json`) | SR |
| `sbom.sha256` | SHA-256 of `docs/evidence/sbom.cdx.json`: pnpm's built-in CycloneDX generator (version pinned by `packageManager`) for the npm workspace merged with `uv export --format cyclonedx1.5` for `tools/verify-py`, `ml` and `ml/serving`; timestamp dropped and serial number derived from the content, so the same tree gives the same hash | FIN | SA |

## bench and models

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `bench.attacks.n` | Attack runs executed against the full system (static suites) | BENCH | SA, CL, TE |
| `bench.oom.count` | Attack runs in which any value left the user's account outside the sealed mandate, judged by on-chain or fork post-conditions | BENCH | SA, CL, TE |
| `bench.oom.upper95` | 95% upper bound on the out-of-mandate rate: 3/N (rule of three) if the count is 0, otherwise the Wilson upper bound | BENCH | CL |
| `bench.oom.adaptive.count` | Out-of-mandate movements against the adaptive attacker | BENCH | CL |
| `bench.oom.adaptive.n` | Adaptive-attacker runs executed | BENCH | CL |
| `bench.wmm.rate` | Share of within-mandate manipulation attempts that reached the attacker's goal, with Wilson 95% interval and n | BENCH | SA, TM, CL |
| `bench.max_at_risk` | Largest amount any attack could still have moved when it ran (remaining period caps read on-chain), in test units | BENCH | SA, TM, CL |
| `bench.ungrounded.rate` | Share of explanations with a claim the validator could not ground, with interval and n | BENCH | SA, TE |
| `bench.heldout.sha256` | SHA-256 of the held-out attack family's items as committed in `bench/HELDOUT_SHA256.txt`, with the family and item count from `bench/MANIFEST.json` and a recomputation of the file's hash at generation | FIN | SA, TM |
| `bench.family_table` | Per bench family: items generated (`bench/MANIFEST.json`), held-out flag and, once `bench/reports/*.json` exist, n, stopping scale, outcome and intervals; "not run" until then | FIN, BENCH | TM |
| `bench.baselines.table` | YINGLONG full vs B0 to B3 and ablations, static and adaptive columns, with per-cell n and source label | BENCH | CL |
| `bench.live.n` | Bench items executed live on Base Sepolia or FISCO (not on a fork) | BENCH | SA |
| `sentinel.fnr` | M1 false-negative rate on the held-out injection family (misses / positives, Wilson 95% interval) at the threshold the evaluation selected, read from `ml/results/m1_sentinel_mmbert.json`, with the model revision and whether the live agent reports a sentinel configured (an offline evaluation is labelled as such) | FIN (ML results) | SA |
| `pia.scrubber.recall` | Recall of the PII scrubber (`apps/agent/src/scales/normalise.ts`) on the labelled synthetic set in `apps/agent/test/scrubber-set.ts` (mainland mobile numbers, 18-digit ID numbers, UnionPay card numbers, private keys, seed phrases, several formats each), with Wilson interval, n, per-kind counts, missed formats and false positives on benign strings; written by `apps/agent/test/scrubber.test.ts` to `docs/evidence/scrubber-recall.json` during `finalize --tests` | TESTS | SA, PIA |
| `study.n` | User-study participants with consent recorded | Study tool export (none in this release) | CL |

## chain, deployment and evidence

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `bytecode.equal` | YINGLONG custom enforcers (`contracts/src/enforcers`, abstract base excluded) whose runtime code hash is identical on the two ledgers compared (`bytecode.pair`) | EVG (deployment files; FISCO hashes re-read with `eth_getCode`) | SA, CL, TE |
| `bytecode.total` | YINGLONG custom enforcers compared | EVG | SA, CL, TE |
| `bytecode.pair` | The two ledgers compared: Base Sepolia vs FISCO BCOS once Base is deployed, otherwise the local Anvil chain vs FISCO BCOS | EVG | CL, TE |
| `bytecode.table` | Per custom enforcer: address on each ledger compared, code hashes, equal yes/no, and whether the FISCO hashes were re-read live | EVG | SA |
| `bytecode.ledgers` | Number and names of the ledgers on which every YINGLONG custom enforcer has the same code hash | EVG | CL, TE |
| `bytecode.framework.masked_equal` | Framework contracts identical once deployment-time immutables are zeroed, from the latest `contracts-fisco/reports/codehash-compare-*.json`, with its scope | EVG | TE |
| `deploy.deployer_roles` | Post-deployment scan on FISCO BCOS: every zero-argument role getter (`owner`, `pendingOwner`, `admin`, `pendingAdmin`, `supervisor`, `pendingSupervisor`, `minter`, `operator`, `registrar`, `guardian`) and `AccountabilityLedger.isAnchorer` called on every deployed contract; "none" or the list of roles still held by a deployer key (the file's `deployer` plus the senders of recorded deployment transactions) | EVG (read-only RPC) | SA, TM, TE |
| `fisco.dm.status` | Whether the DelegationManager runs on FISCO ("deployed", from `contracts/deployments/fisco.json`) or the PolicyVault fallback is used | EVG | CL |
| `fisco.dm.owner` | `DelegationManager.owner()` on FISCO and the other roles the same key holds | EVG (read-only RPC) | bundle |
| `fisco.nodes` | FISCO chain layout from `infra/fisco/chain-facts.json` (consensus nodes, observer nodes, build) | EVG | JG |
| `fisco.regulator_node` | Status of the separate regulator (observer) node | EVG | CL, TE |
| `guard.allowlist.count` | Number of message kinds in `ALLOWED_PRIMARY_TYPES` in `apps/web/lib/signing-guard.ts` | FIN | SA, CL, TE |
| `guard.allowlist.names` | The same kinds by name | FIN | bundle |
| `verify.golden.n` | Golden files (`packages/mandate/golden/*.json`) on which the TypeScript (`packages/mandate` vitest) and Python (`tools/verify-py` `test_golden.py`) verifiers both pass in the most recent test run | TESTS | SA, CL, TE |
| `verify.property.n` | Cross-implementation vector cases generated by the TypeScript reference (`tools/verify-py/scripts/ts-vectors.ts`) and checked by the Python verifier (`test_ts_vectors.py`) in the most recent test run | TESTS | SA, CL, TE |
| `verify.agreement` | Whether both verifiers agree on every golden and vector case, with the ledger profiles the vectors cover | TESTS | CL, TE |
| `passkey.mode` | How the recorded seals were signed: counts of WebAuthn and scripted-passkey (software P-256) seals in the live receipts, and the scripted e2e runs | EVG | CL, TE |
| `x402.mode` | How x402 payments settle: "facilitator", "seller-settled" or "custodial budget account" | EVG | CL |
| `zk.mode` | `ZKMandateEnforcer` mode and where real proofs are recorded | EVG | CL |
| `zk.verify.gas` | Gas of `HonkVerifier.verify` from `circuits/MANIFEST.json` | EVG | bundle |
| `evidence.tx_count` | Distinct live-ledger transaction hashes in the evidence bundle (live receipts, scripted runs, ZK runs, anchors, drills; Anvil excluded) | FIN | CL, TE, RM |
| `evidence.receipts` | Receipts returned by the live API at generation time (on-chain and refused) | FIN (`GET /v1/receipts`) | RM |
| `evidence.reverts` | Of those, receipts whose transaction reverted on chain with a typed error | FIN | RM, TE |
| `evidence.refused_offchain` | Of those, actions refused by the deterministic mirror before anything was signed | FIN | RM, TE |
| `evidence.anchored_receipts` | Receipts included in Merkle batches anchored by the indexer | FIN (`GET /batches`) | RM |
| `deploy.base.status` | "deployed (n contracts)" when `contracts/deployments/base-sepolia.json` exists, otherwise the fork-rehearsal status | FIN (deployment files) | JG, TE, RM |
| `chain.bytecode.equal` | Contracts (all deployed, framework included) whose runtime code hash is identical on the two ledgers compared | FIN (deployment files) | JG, TE, RM |
| `chain.bytecode.total` | Contracts compared | FIN | JG, TE, RM |
| `chain.bytecode.pair` | Which two ledgers were compared (Base Sepolia vs FISCO BCOS when Base is deployed, otherwise Anvil vs FISCO BCOS) | FIN | JG, TE, RM |
| `chain.bytecode.differ` | Names of the contracts whose code hashes differ | FIN | TE |
| `chain.ledgers` | Live ledgers with a deployment file | FIN | RM |
| `proof.table` | The one-page proof table (also written to `PROOF.md`) | FIN | TE, RM |
| `tx.seal.base` | Mandate-seal transaction on Base Sepolia, or "not deployed on Base Sepolia yet" | EVG | CL, TE |
| `tx.seal.fisco` | Mandate-seal transaction on FISCO BCOS: the most recent WebAuthn seal in the live receipts, else the most recent scripted-passkey seal, else the scripted e2e seal | EVG | bundle |
| `tx.seal.live` | The same on the live ledger (Base Sepolia once deployed, otherwise FISCO BCOS), naming the ledger | EVG | CL |
| `tx.x402.base` | x402 settlement through ERC-7710 on Base Sepolia, or "not deployed on Base Sepolia yet" | EVG | CL |
| `tx.x402.fisco` | Most recent confirmed receipt on FISCO with payment method `x402/erc7710` | EVG | bundle |
| `tx.x402.live` | The same on the live ledger, naming the ledger | EVG | CL |
| `tx.zk.base` | Redemption enforced by `ZKMandateEnforcer` on Base Sepolia, or "not deployed on Base Sepolia yet" | EVG | CL, TE |
| `tx.zk.fisco` | First successful private-mandate payment in `apps/agent/data/zk-fisco.json`, with its gas and proving time | EVG | TE |
| `tx.zk.live` | The same on the live ledger, naming the ledger | EVG | CL |
| `tx.revert_payee.base` | Redemption reverted with `PayeeNotVerified` on Base Sepolia, or "not deployed on Base Sepolia yet" | EVG | CM, CL, TE |
| `tx.revert_payee.fisco` | Most recent receipt on FISCO reverted with `PayeeNotVerified` | EVG | bundle |
| `tx.revert_payee.live` | The same on the live ledger, naming the ledger | EVG | CM, CL |
| `tx.refused.fisco` | Most recent typed on-chain revert on FISCO BCOS other than `PayeeNotVerified` (with the error name) | EVG | CL |
| `tx.supervisor_pause.fisco` | Supervisor halt of a fresh visitor's agent identity on FISCO BCOS (`POST /v1/supervisor/agents/:agentId/halt`), with the passport status before and during, the outcome of a payment request while halted and the lift transaction | DRILL (`supervisor-pause.ts`) | CM, CL |
| `tx.anchor.base` | Anchoring transaction on Base Sepolia, or "not deployed on Base Sepolia yet" | EVG | CM, TE |
| `tx.anchor.fisco` | Anchoring transaction on FISCO BCOS with the batch size | EVG | CM, TE |
| `tx.anchor.live` | The same on the live ledger, naming the ledger | EVG | bundle |
| `tx.reseal_hk.base` | Hong Kong re-seal of the same agent on Base Sepolia, or "not deployed on Base Sepolia yet" | EVG | CL |
| `tx.reseal_hk.fisco` | `lotus-hk` mandate publish transaction (`GET /v1/principals/lotus-hk/state`) | EVG | bundle |
| `tx.reseal_hk.live` | The same on the live ledger, naming the ledger | EVG | CL |
| `challenge.gas_budget` | Daily gas budget of the Judge's Challenge: the daily on-chain attack allowance (`CHALLENGE_BYPASS_PER_DAY` default read from `apps/agent/src/challenge.ts`) times the largest gas measured for a guest attack (`eth_getTransactionReceipt` of the guest's reverted receipts), with the per-IP quota and the ledger's gas price | EVG | SA, TM |
| `links.video_60s` | URL of the 60-second video cut from `docs/evidence/release.json` (`video60s`) | FIN | JG |
| `reach.mainland` | HTTPS reachability of the API from mainland China probes (Globalping), measured only with `--reach` | FIN | TE |

## times

Times come from `docs/evidence/drills/timing-<ledger>.json` (Base Sepolia once it exists, otherwise FISCO BCOS), written by `apps/agent/scripts/drills.ts`.

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `time.ledger` | The ledger the times were measured on | DRILL | CL, SA, TE |
| `time.method` | How the times were measured: server-side, from submitting the passkey-signed message to its transaction receipt, by the agent API next to the ledger; the signer (scripted passkey); the drill client's own medians | DRILL | CL |
| `time.pause.p50` | Median seconds from submitting the signed `Trip` to the receipt of `tripWithSig` (server-side) | DRILL | SA, CL, TE |
| `time.pause.p95` | 95th percentile of the same | DRILL | CL |
| `time.pause.n` | Number of pause measurements (with the confirmed count when they differ) | DRILL | SA, CL, TE |
| `time.pause.blocks_p50` | Median blocks from the head read before submission to inclusion of the pause transaction | DRILL | CL |
| `time.block.base` | Median Base Sepolia block time during the measurements, or "not applicable: Base Sepolia not deployed" | DRILL | CL |
| `time.block.ledger` | Block time of the measured ledger; for FISCO BCOS "no fixed block time" with the minimum seal time from `infra/fisco/chain-facts.json` | DRILL, FIN | CL |
| `time.revoke.p50` | Median seconds from submitting the signed revoke user operation (`MandateRegistry.revoke` + `disableDelegation`) to its receipt (server-side) | DRILL | SA, CL, TE |
| `time.revoke.n` | Number of revoke measurements | DRILL | CL, TE |
| `time.rotate.p50` | Median seconds to re-seal the mandate with the same agent key (operator re-seal, measured at the drill client); no agent-key rotation is drilled, and the value says so | DRILL | SA |

## incident-response drills

For N = 1 to 5 (playbooks: 1 agent key leak, 2 device theft or passkey loss, 3 issuer key compromise, 4 facilitator compromise, 5 RPC or bundler outage). Times are elapsed from t0 (fault injected) to completion of the step in the most recent drill, read from `docs/evidence/drills/pbN.json`, or "not drilled". Playbook 1 is drilled by `apps/agent/scripts/ir-drill.ts` on a fresh visitor principal with a scripted passkey: t0 is the leaked-key attack (a raw redemption to a fresh attacker address that must revert on-chain); detection is a client watcher polling the public receipts route; rotation is a re-seal with the same passkey plus resume (the agent key itself is not rotated). Producer: DRILL. Used in: IR (and CL for `ir.pb1.pause`, `ir.pb1.revoke`).

| Key | Definition |
|---|---|
| `ir.pb1.drill` | Identifier, ledger and principal of the most recent drill of playbook 1, or "not drilled" |
| `ir.pb1.detect` | Playbook 1: time to detection, with the revert transaction |
| `ir.pb1.pause` | Playbook 1: time to pause included on-chain, with the transaction |
| `ir.pb1.revoke` | Playbook 1: time to revoke included on-chain, with the user-operation transaction |
| `ir.pb1.rotate` | Playbook 1: time to re-seal and resume complete (agent key not rotated), with both transactions |
| `ir.pb1.notify` | Playbook 1: time to notifications delivered, or "not automated" |
| `ir.pb1.evidence` | Playbook 1: time to `pb1.json` written and hashed, with its SHA-256 (recorded in `pb1.sha256`) and whether it still matches at generation |
| `ir.pb1.exposure` | Playbook 1: actual loss (account balance before the attack minus after the pause) vs the maximum at risk (remaining period caps at t0), in base units |
| `ir.pb2.drill` | Most recent drill of playbook 2, or "not drilled" |
| `ir.pb2.detect` | Playbook 2: time to detection |
| `ir.pb2.pause` | Playbook 2: time to pause included on-chain |
| `ir.pb2.revoke` | Playbook 2: time to stolen key removed on-chain |
| `ir.pb2.rotate` | Playbook 2: time to new key added (or recovery started) |
| `ir.pb2.notify` | Playbook 2: time to notifications delivered |
| `ir.pb2.evidence` | Playbook 2: time to evidence bundle hash written |
| `ir.pb3.drill` | Most recent drill of playbook 3, or "not drilled" |
| `ir.pb3.detect` | Playbook 3: time to detection |
| `ir.pb3.pause` | Playbook 3: time to supervisor pauses included |
| `ir.pb3.revoke` | Playbook 3: time to attestations marked revoked |
| `ir.pb3.rotate` | Playbook 3: time to new issuer key and re-seals |
| `ir.pb3.notify` | Playbook 3: time to notifications delivered |
| `ir.pb3.evidence` | Playbook 3: time to evidence bundle hash written |
| `ir.pb4.drill` | Most recent drill of playbook 4, or "not drilled" |
| `ir.pb4.detect` | Playbook 4: time to detection |
| `ir.pb4.pause` | Playbook 4: time to x402 issuance stopped |
| `ir.pb4.revoke` | Playbook 4: time to outstanding children disabled |
| `ir.pb4.rotate` | Playbook 4: time to new facilitator pinned |
| `ir.pb4.notify` | Playbook 4: time to notifications delivered |
| `ir.pb4.evidence` | Playbook 4: time to evidence bundle hash written |
| `ir.pb5.drill` | Most recent drill of playbook 5, or "not drilled" |
| `ir.pb5.detect` | Playbook 5: time to detection |
| `ir.pb5.pause` | Playbook 5: time to agent in T? (and pause, if used) |
| `ir.pb5.revoke` | Playbook 5: time to revoke without a bundler, if used |
| `ir.pb5.rotate` | Playbook 5: time to providers switched |
| `ir.pb5.notify` | Playbook 5: time to status banner shown |
| `ir.pb5.evidence` | Playbook 5: time to evidence bundle hash written |

## controls and documents


| Key | Definition | Producer | Used in |
|---|---|---|---|
| `controls.status_table` | Per control ID (C-xx-nn) in the self-assessment: status, evidence paths, tests and notes. The map from control to paths and tests is hand-written in `docs/evidence/controls.json`; the status is derived: `tested` (every path exists and a listed test passed in the most recent test run), `implemented` (paths exist, no passing listed test), `designed` (no path, or a path missing). DC-nn rows are open design checks and are not counted | FIN | SA |
| `controls.implemented` | Controls with status "implemented" or "tested", and how many of them are tested | FIN | SA |
| `controls.total` | C-xx-nn controls listed in the self-assessment | FIN | SA |
| `compliance.paths_missing` | Repository paths (backticked, with a directory part) and contract names cited in the compliance matrix that do not exist, with where a file of the same name was found | FIN (path check) | CM |

## security review

Producer: the internal review record `docs/evidence/review.json` read by FIN, with schema `{ "schema": "yinglong.review/1", "commit": "<sha>", "date": "YYYY-MM-DD", "reviewers": ["..."], "tools": [{"name": "...", "version": "..."}], "findings": [{"id": "R-01", "title": "...", "severity": "critical|high|medium|low|info", "component": "...", "status": "fixed|open|wontfix", "fixCommit": "<sha>", "description": "...", "impact": "...", "recommendation": "...", "resolution": "...", "wontfixReason": "..."}] }`. Until it exists, only `review.tools.versions` is filled (from the versions recorded in `contracts/reports/*.json`).

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `review.commit` | Commit SHA the internal review covers | Review record | SR |
| `review.date` | Date the internal review was completed | Review record | SR |
| `review.tools.versions` | Versions actually run for every analysis tool (review record, else `contracts/reports/*.json`) | Review record, CR | SR |
| `review.count.critical` | Findings rated critical | Review record | SR |
| `review.count.high` | Findings rated high | Review record | SR |
| `review.count.medium` | Findings rated medium | Review record | SR |
| `review.count.low` | Findings rated low | Review record | SR |
| `review.count.info` | Findings rated informational | Review record | SR |
| `review.fixed` | Findings fixed, with fix commit | Review record | SR |
| `review.open` | Findings still open | Review record | SR |
| `review.wontfix` | Findings accepted (not fixed) | Review record | SR |
| `review.findings.table` | Table: ID, title, severity, component, status, fix commit | Review record | SR |
| `review.findings.details` | Description, impact, recommendation and resolution per finding | Review record | SR |
| `review.wontfix.table` | Findings from the review that were accepted, with reason | Review record | SR |

## third-party register

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `thirdparty.npm.table` | Direct dependencies (runtime and dev) of every workspace package (root, `apps/*`, `packages/*`, `circuits`), with the installed version and the licence read from each installed `package.json`, and the packages that use them | FIN | TP |
| `thirdparty.python.table` | Direct dependencies of `tools/verify-py`, `ml` and `ml/serving` (pyproject dependencies and dependency groups), with the version from each `uv.lock` and the licence from the installed package metadata | FIN | TP |
| `thirdparty.models.table` | Models: third-party models as recorded in `ml/THIRD_PARTY.md` (repo, revision, licence, role) and our own models with the revisions and file hashes in `ml/results/m1_*.json` and `ml/serving/models.lock.json` | FIN (ML register and manifests) | TP |
| `thirdparty.datasets.table` | Datasets as recorded in `ml/THIRD_PARTY.md`, the derived sentinel splits (`ml/results/sentinel_data_manifest.json`) and the bench (`bench/MANIFEST.json`) | FIN (ML register and manifests) | TP |
| `thirdparty.private_datasets.table` | Private HuggingFace datasets holding Chinese-script data: repo id, revision and file SHA-256 from `ml/results/*_data_manifest.json` | FIN (ML manifests) | TP |
