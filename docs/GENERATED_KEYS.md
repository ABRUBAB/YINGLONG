# Generated-Number Keys

*Every key used in a generated-number marker in the security and compliance documents, what it means, and which component produces it.*

**Summary (5 lines)**
1. No number, hash, time, count or status about the running system is typed by hand in these documents; each sits inside a generated-number marker that `scripts/finalize` fills.
2. A marker is an HTML comment pair: an opening comment `gen:` followed by the key, the value (`TBD` until filled), and a closing `/gen` comment; it is invisible when the Markdown is rendered.
3. This file lists every key with a one-line definition, the producing component and the documents that use it; finalize should fail if a document uses a key not listed here.
4. If the producing data does not exist at release time, finalize writes an explicit word ("not measured", "not drilled", "not run"), never a guess and never a target.
5. Rates carry a Wilson 95% interval and their n; times carry their n and the block time at measurement.

Producer abbreviations: **FIN** `scripts/finalize`; **EVG** evidence generator over Base Sepolia and FISCO (R2); **BENCH** `bench/run.ts` and its report shards (R4); **DRILL** drill scripts writing `docs/evidence/drills/pbN.json` (planned); **CI** CI jobs and their JSON reports. Document abbreviations: SA self-assessment, TM threat model, PIA, IR incident response, CM compliance matrix, CL claims, JG judge's guide, TP third-party register, SR security review.

## meta

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `meta.release_tag` | Git tag of the release the documents were generated for | FIN (git) | SA, PIA, SR |
| `meta.commit` | Full commit SHA the evidence was generated from | FIN (git) | SA, PIA |
| `meta.generated_at` | UTC timestamp of the finalize run | FIN | SA |

## tests, invariants, proofs, static analysis

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `tests.total` | Automated tests passing across all suites at the commit | CI (forge, vitest, pytest, Playwright JSON) | SA, CL, SR |
| `tests.failed` | Automated tests failing at the commit | CI | SA, SR |
| `tests.contracts` | Foundry tests passing (unit and fuzz, excluding invariants) | CI (`forge test --json`) | SA |
| `tests.ts` | vitest tests passing | CI | SA |
| `tests.py` | pytest tests passing | CI | SA |
| `tests.e2e` | Playwright tests passing | CI | SA |
| `tests.monotonic.status` | Result and case count of the property test that no AI signal lowers a tier or produces T3/T4 | CI (`apps/agent` property test) | SA |
| `tests.vectors.shared` | Number of JSON policy vectors run in both vitest and Foundry | CI | SA |
| `tests.vectors.agreement` | Whether the TypeScript mirror and the Solidity enforcers agree on every shared vector (and the count of disagreements) | CI | SA |
| `invariants.passing` | Plan invariants (1 to 10) that pass every fuzz campaign, as "k/10" | CI (Foundry, Medusa, Echidna) | SA, CL |
| `invariants.table` | Per-invariant status for Foundry, Medusa, Echidna, Halmos and Kontrol | CI, proof logs | SA, SR |
| `fuzz.calls` | Total calls executed across invariant and fuzz campaigns | CI | SR |
| `fuzz.differential.split` | Differential-fuzz outcomes split into policy-rejected / reverted attack / reverted divergence | CI | SA, SR |
| `proofs.symbolic.status` | Bounded symbolic-execution status of invariants 1 to 5 (Halmos and Kontrol), with bounds | Proof logs | SA, CL, SR |
| `static.slither.high` | Slither high-severity findings open after triage | CI (Slither JSON) | SA, SR |
| `static.slither.medium` | Slither medium-severity findings open after triage | CI | SR |
| `static.aderyn.high` | Aderyn high-severity findings open after triage | CI (Aderyn JSON) | SR |
| `coverage.contracts` | Line and branch coverage of `contracts/src` | CI (`forge coverage`) | SR |
| `gas.overhead.median` | Median gas overhead of a redemption with YINGLONG caveats vs the same payment with stock enforcers only | CI (gas report) | SR |
| `sbom.sha256` | SHA-256 of the release SBOM | CI | SA |

## bench and models

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `bench.attacks.n` | Attack runs executed against the full system (static suites) | BENCH | SA, CL |
| `bench.oom.count` | Attack runs in which any value left the user's account outside the sealed mandate, judged by on-chain or fork post-conditions | BENCH | SA, CL |
| `bench.oom.upper95` | 95% upper bound on the out-of-mandate rate: 3/N (rule of three) if the count is 0, otherwise the Wilson upper bound | BENCH | CL |
| `bench.oom.adaptive.count` | Out-of-mandate movements against the adaptive attacker | BENCH | CL |
| `bench.oom.adaptive.n` | Adaptive-attacker runs executed | BENCH | CL |
| `bench.wmm.rate` | Share of within-mandate manipulation attempts that reached the attacker's goal, with Wilson 95% interval and n | BENCH | SA, TM, CL |
| `bench.max_at_risk` | Largest amount any attack could still have moved when it ran (remaining period caps read on-chain), in test units | BENCH | SA, TM, CL |
| `bench.ungrounded.rate` | Share of explanations with a claim the validator could not ground, with interval and n | BENCH | SA |
| `bench.heldout.sha256` | SHA-256 of the held-out attack family's items, as committed before M1 training | `bench/gen/generate_bench.py finalize` (`HELDOUT_SHA256.txt`) | SA, TM |
| `bench.family_table` | Per bench family (the 13 in `bench/gen/generate_bench.py`) plus external suites: n, stopping scale, outcome, intervals | BENCH | TM |
| `bench.baselines.table` | YINGLONG full vs B0 to B3 and ablations, static and adaptive columns, with per-cell n and source label | BENCH | CL |
| `bench.live.n` | Bench items executed live on Base Sepolia or FISCO (not on a fork) | BENCH | SA |
| `sentinel.fnr` | M1 false-negative rate on the held-out injection set at the deployed threshold, with interval | ML evaluation (R4) | SA |
| `pia.scrubber.recall` | Recall of the PII scrubber on a labelled set of synthetic identifiers, keys and seed phrases, with n | CI (`apps/agent` scrubber test) | SA, PIA |
| `study.n` | User-study participants with consent recorded | Study tool export (R5) | CL |

## chain, deployment and evidence

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `bytecode.equal` | YINGLONG enforcers whose runtime code hash is identical on Base Sepolia and FISCO BCOS | EVG (`extcodehash` on both ledgers) | SA, CL, JG |
| `bytecode.total` | YINGLONG enforcers deployed | EVG | SA, CL, JG |
| `bytecode.table` | Per enforcer: Base address, FISCO address, code hashes, equal yes/no | EVG | SA |
| `bytecode.ledgers` | Ledgers on which every YINGLONG enforcer has the same code hash | EVG | CL |
| `deploy.deployer_roles` | Result of the post-deployment scan for any role or ownership still held by deployer keys ("none" or a list) | EVG | SA, TM |
| `fisco.dm.status` | Whether the DelegationManager runs on FISCO ("deployed") or the PolicyVault fallback is used | EVG | CL |
| `fisco.nodes` | FISCO chain layout read from the chain (consensus nodes, observer or regulator nodes) | EVG | JG |
| `fisco.regulator_node` | Status of the separate regulator node ("running", "not deployed") | EVG | CL |
| `guard.allowlist.count` | Number of message kinds in the signing-domain allowlist | `apps/signer` allowlist file via FIN | SA, CL |
| `verify.golden.n` | Golden files on which the TypeScript and Python verifiers agree | CI (`packages/mandate`, `tools/verify-py`) | SA, CL |
| `verify.property.n` | Property-test cases run against both verifiers | CI | SA, CL |
| `verify.agreement` | Whether both verifiers agree on every golden and property case, per ledger profile | CI | CL |
| `passkey.mode` | How the recorded seals were signed: "passkey", "virtual authenticator" or "ECDSA stand-in" | EVG (seal signature type) | CL |
| `x402.mode` | How x402 payments settled: "facilitator", "seller-settled" or "custodial budget account" | EVG | CL |
| `zk.mode` | `ZKMandateEnforcer` mode: "stateful", "stateless" or "public caps fallback" | EVG | CL |
| `evidence.tx_count` | Transaction hashes in the evidence bundle across both ledgers | EVG | CL |
| `tx.seal.base` | Hash of the mandate-seal transaction on Base Sepolia | EVG | CL |
| `tx.x402.base` | Hash of an x402 settlement through ERC-7710 on Base Sepolia | EVG | CL |
| `tx.zk.base` | Hash of a redemption enforced by `ZKMandateEnforcer` | EVG | CL |
| `tx.revert_payee.base` | Hash of a redemption reverted with `PayeeNotVerified` on Base Sepolia | EVG | CM, CL |
| `tx.refused.fisco` | Hash of the refused attempt on FISCO BCOS | EVG | CL |
| `tx.supervisor_pause.fisco` | Hash of a supervisor pause on FISCO BCOS | EVG | CM, CL |
| `tx.anchor.base` | Hash of an anchoring transaction on Base Sepolia | EVG | CM |
| `tx.anchor.fisco` | Hash of an anchoring transaction on FISCO BCOS | EVG | CM |
| `tx.reseal_hk.base` | Hash of the Hong Kong re-seal of the same agent | EVG | CL |
| `challenge.gas_budget` | Daily gas budget of the Judge's Challenge, computed from measured gas per attack | `apps/services` config via FIN | SA, TM |
| `links.video_60s` | URL of the 60-second video cut | Release manifest via FIN | JG |

## times

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `time.pause.p50` | Median seconds from passkey assertion to inclusion of `tripWithSig` on Base Sepolia | DRILL / measurement runs | SA, CL |
| `time.pause.p95` | 95th percentile of the same | DRILL | CL |
| `time.pause.n` | Number of pause measurements | DRILL | SA, CL |
| `time.pause.blocks_p50` | Median blocks from submission to inclusion of the pause transaction | DRILL | CL |
| `time.block.base` | Median Base Sepolia block time during the measurements | DRILL | CL |
| `time.revoke.p50` | Median seconds from passkey assertion to inclusion of the revoke user operation | DRILL | SA, CL |
| `time.revoke.n` | Number of revoke measurements | DRILL | CL |
| `time.rotate.p50` | Median seconds to complete key rotation (new key registered and mandate re-sealed) | DRILL | SA |

## incident-response drills

For N = 1 to 5 (playbooks: 1 agent key leak, 2 device theft or passkey loss, 3 issuer key compromise, 4 facilitator compromise, 5 RPC or bundler outage). Times are elapsed from t0 (fault injected) to completion of the step in the most recent drill, or "not drilled". Producer: DRILL. Used in: IR (and CL for `ir.pb1.pause`, `ir.pb1.revoke`).

| Key | Definition |
|---|---|
| `ir.pb1.drill` | Identifier and date of the most recent drill of playbook 1, or "not drilled" |
| `ir.pb1.detect` | Playbook 1: time to detection |
| `ir.pb1.pause` | Playbook 1: time to pause included on-chain |
| `ir.pb1.revoke` | Playbook 1: time to revoke included on-chain |
| `ir.pb1.rotate` | Playbook 1: time to rotation complete |
| `ir.pb1.notify` | Playbook 1: time to notifications delivered |
| `ir.pb1.evidence` | Playbook 1: time to evidence bundle hash written |
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

## claims, controls and documents

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `claims.HL.decision` | Wording used for the headline primitive ("A" or "B") | FIN (claim conditions) | CL |
| `claims.CL-01.decision` | Wording used for CL-01 ("A", "B1" or "B2") | FIN | CL |
| `claims.CL-02.decision` | Wording used for CL-02 | FIN | CL |
| `claims.CL-03.decision` | Wording used for CL-03 | FIN | CL |
| `claims.CL-04.decision` | Wording used for CL-04 | FIN | CL |
| `claims.CL-05.decision` | Wording used for CL-05 | FIN | CL |
| `claims.CL-06.decision` | Wording used for CL-06 | FIN | CL |
| `claims.CL-07.decision` | Wording used for CL-07 | FIN | CL |
| `claims.CL-08.decision` | Wording used for CL-08 | FIN | CL |
| `claims.CL-09.decision` | Wording used for CL-09 | FIN | CL |
| `claims.CL-10.decision` | Wording used for CL-10 | FIN | CL |
| `claims.CL-11.decision` | Wording used for CL-11 | FIN | CL |
| `claims.CL-12.decision` | Wording used for CL-12 | FIN | CL |
| `claims.CL-13.decision` | Wording used for CL-13 | FIN | CL |
| `claims.CL-14.decision` | Wording used for CL-14 | FIN | CL |
| `claims.CL-15.decision` | Wording used for CL-15 | FIN | CL |
| `claims.CL-16.decision` | Wording used for CL-16 | FIN | CL |
| `claims.CL-17.decision` | Wording used for CL-17 (decided by the lead after the rival check, recorded in the claims input file) | FIN | CL |
| `claims.CL-18.decision` | Wording used for CL-18 | FIN | CL |
| `claims.CL-19.decision` | Wording used for CL-19 | FIN | CL |
| `controls.status_table` | Per control ID (C-xx-nn, DC-nn): status ("tested", "implemented", "designed", "not started") and test or evidence path | FIN (controls map, planned `docs/evidence/controls.json`) | SA |
| `controls.implemented` | Controls with status "implemented" or "tested" | FIN | SA |
| `controls.total` | Controls listed in the self-assessment | FIN | SA |
| `compliance.paths_missing` | Evidence paths named in the compliance matrix that do not exist at release | FIN (path check) | CM |

## security review

| Key | Definition | Producer | Used in |
|---|---|---|---|
| `review.commit` | Commit SHA the internal review covers | Review record (planned `docs/evidence/review.json`) via FIN | SR |
| `review.date` | Date the internal review was completed | Review record | SR |
| `review.tools.versions` | Versions actually run for every analysis tool | CI (`--version` outputs) | SR |
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
| `thirdparty.npm.table` | npm packages with version and licence from the SBOM | CI (SBOM) | TP |
| `thirdparty.python.table` | Python packages with version and licence from the SBOM | CI (SBOM) | TP |
| `thirdparty.models.table` | Models used: repo id, revision, SHA-256, licence read from the card at download | ML download manifest (R4) | TP |
| `thirdparty.datasets.table` | Datasets used: id, revision, SHA-256, licence | ML download manifest (R4) | TP |
| `thirdparty.private_datasets.table` | Private HuggingFace datasets holding Chinese-script data: repo id, revision, SHA-256, source licences | ML manifest (R4) | TP |
