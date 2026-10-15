# YINGLONG Security Self-Assessment

*Permission tiers, controls and known risks. Mandatory deliverable of the 2026 Shenzhen International FinTech Competition, International Track, Topic F (Agent Wallet).*

**Summary (5 lines)**
1. YINGLONG is a research prototype on a public testnet (Base Sepolia) and a team-run FISCO BCOS test chain; it moves test units only, has had no third-party audit, holds no licence and is not production-ready.
2. An agent can move value only by redeeming an ERC-7710 delegation whose caveat enforcers are the user's sealed rules; out-of-mandate movement is measured on every bench run: <!-- gen:bench.oom.count -->not yet measured<!-- /gen --> of <!-- gen:bench.attacks.n -->not yet measured<!-- /gen --> attack runs.
3. Six permission states (T0 Observe, T1 Act, T2 Confirm, T3 Reserved, T4 Refuse, T? Ask) implement the three decision classes of the 2026 CAC/NDRC/MIIT agent Opinions, item 6; an AI signal can only raise a tier, never lower it and never refuse.
4. Chapters 3 to 7 follow the five areas of the Beijing FinTech Industry Alliance agent security standard (secondary source); every control names the contract or module that implements it and the test that checks it.
5. Known risks KR-01 to KR-19 and open design checks DC-01 to DC-11 are listed with mitigation and residual risk; chapter 10 contrasts what exists now with what production would require.

| Field | Value |
|---|---|
| Release | <!-- gen:meta.release_tag -->eb5695d<!-- /gen --> |
| Commit assessed | <!-- gen:meta.commit -->eb5695d<!-- /gen --> |
| Numbers generated at | <!-- gen:meta.generated_at -->2026-10-15T22:14:24.649Z<!-- /gen --> |
| Owners | R4 (AI security) and R2 (contracts), per plan section 17 |
| Companion documents | `docs/THREAT_MODEL.md`, `docs/PIA.md`, `docs/INCIDENT_RESPONSE.md`, `docs/COMPLIANCE_MATRIX.md`, `docs/SECURITY_REVIEW.md`, `docs/CLAIMS.md` |

---

## 0. How to read this document

| Convention | Meaning |
|---|---|
| **[V]** | Verified at an official or primary source, by a live chain call, or by reading the code in this repository |
| **[S]** | Secondary source; re-check before quoting. Text says "secondary source" |
| **[U]** | Unverified. Text says "unverified" |
| **[I]** | Our own inference or design decision |
| `TBD` | A number, hash or status inside a generated-number marker (an invisible HTML comment pair naming a key), filled by `scripts/finalize` from JSON produced by code. Keys are defined in `docs/GENERATED_KEYS.md`. A `TBD` that survives into a release is a defect, not a claim |
| `C-IN-01` and similar | Control IDs. Prefix = BFIA area: IN initialisation and input, MD model inference and decision, ID identity and operation, DP data and privacy, RC risk control and compliance. `DC-xx` = open design check |
| "Implemented by" | The contract or module that carries the control. Paths under `contracts/src/` and `apps/` are the planned locations; the generated status table (chapter 11) says what exists and passes its test at the assessed commit |

The standard this document follows: *Security Requirements for Financial Applications of Agent Technology* (Beijing FinTech Industry Alliance group standard, 27 Aug 2026; our translation of the title) [S, secondary source; the number T/BFIA 070-2026 is unverified]. Its five areas are reported as: (1) initialisation and input security; (2) model inference and decision security; (3) identity authentication and operation security; (4) data security and privacy protection; (5) risk prevention, control and compliance.

---

## 1. System under assessment

| Item | In scope | Out of scope |
|---|---|---|
| Ledgers | Base Sepolia (chain ID 84532); team-run FISCO BCOS 3.17.1 chain (standard, non-SM build) with a separate regulator node | Mainnets; exhibit chains (HashKey, Conflux, Arc, Tempo) are covered only for bytecode equality |
| Contracts | YINGLONG enforcers and registries (`MandateRegistry`, `PayeeBook`, `KillSwitchRegistry`, `YinglongPassportRegistry`, `AccountabilityLedger`), rails and scenario contracts, Noir verifiers | MetaMask Delegation Framework v1.3.0 internals (pinned submodule; its own third-party audit reports ship in `contracts/lib/delegation-framework/audits/` [V, repo]); ERC-8004 reference registries; USDC |
| Off-chain | `apps/agent` (orchestrator, policy mirror, readers, explainer, simulator, counterparty verifier, x402 client, MCP server), `apps/signer`, relayer and breaker watcher (`apps/indexer`), `apps/web` approval page, `packages/mandate`, `tools/verify-py` | Model quality as such (measured in the bench report, not here) |
| Assets protected | Funds in the user's smart account; integrity of the sealed mandate; the agent key; the user's passkeys; the agent's identity; the evidence trail; personal information; availability of pause and revoke | Value of test units (none) |
| Users | Fictional personas (Nadia; Lotus Lane Trading), judges, Judge's Challenge visitors, user-study participants | Real customers (none) |

---

## 2. Permission tiers (core of the assessment)

### 2.1 Tier table

| Tier | Name | Examples | Who decides | Where enforced | Decision class (2026 agent Opinions [V]) | Implementing contract or module |
|---|---|---|---|---|---|---|
| **T0** | Observe | Balances, receipts, forecasts, insights, coverage-gap analysis | Agent | Read-only tools; no signing path exists | None (information only) | `apps/agent` read tools; MCP server is proposal-only (no sign or submit tool); `apps/indexer` |
| **T1** | Act | Rent to a verified payee within budget; recurring bills; x402 purchases up to the cap; payroll inside the board mandate; repeat sweeps into a product approved once | Agent alone; user notified | On-chain at delegation redemption: the DelegationManager runs every caveat | Autonomous agent decision, inside the user's mandate (item 6) | DelegationManager v1.3.0 with stock `AllowedTargets`, `AllowedMethods`, `ValueLte`; custom `MandateBindingEnforcer`, `ForbiddenTargetsEnforcer`, `AgentLineageEnforcer`, `VerifiedPayeeEnforcer`, `CategoryBudgetEnforcer`, `ReserveFloorEnforcer`, `VelocityEnforcer`, `SuitabilityEnforcer`, `JurisdictionEnforcer`, `GlobalPauseEnforcer`, `ZKMandateEnforcer` (private mandates; `ReputationGateEnforcer` is built and tested but not emitted by the compiler yet); per-execution child delegation signed by `apps/signer` with `Timestamp(now - 1, now + 120 s)` + `LimitedCalls(1)`; x402 leaf with `ERC20TransferAmount` + `LimitedCalls(1)` + `Timestamp`; reads `MandateRegistry`, `PayeeBook`, `KillSwitchRegistry`, `YinglongPassportRegistry`; receipt to `AccountabilityLedger`. Off-chain: `apps/agent` policy mirror, `apps/signer`, the nine scales |
| **T2** | Confirm | Above the T1 cap and under the T2 ceiling; first payment to a verified new counterparty; first sweep into any product; anything an AI signal flagged | User approves on the phone with a passkey; optional veto window | `CoSignEnforcer` checks the account's own ERC-1271 signature over the approval hash; `VetoTimelockEnforcer` for scheduled items | Decision needing user authorisation (item 6) | `CoSignEnforcer`, `VetoTimelockEnforcer`, plus every T1 caveat; approval page `/approve/[id]` in `apps/web` behind the signing-domain guard; orchestrator state `awaiting_approval` |
| **T3** | Reserved | Change the mandate, add a payee, raise limits, withdraw to a new address, change the guardian; treasury: 2-of-3 directors | Only the user's own account (passkey user operation); the directors for the treasury | No delegation can reach it: allowlist first, `ForbiddenTargetsEnforcer`, invariant 5, symbolic proofs | Decision only the user makes (item 6) | `MandateRegistry.publish` / `supersede`, `PayeeBook` writes, `KillSwitchRegistry.untripWithSig`, HybridDeleGator `addKey` / `removeKey`, guardian change; MultiSigDeleGator for the treasury; all listed in `ForbiddenTargetsEnforcer` |
| **T4** | Refuse | Token approvals, arbitrary calls, unlisted contracts, sanctioned counterparties, a rail the jurisdiction forbids | Nobody through the agent. The user may change the mandate at T3 so a future action is no longer T4; a jurisdiction-forbidden rail cannot be enabled by any mandate | Deterministic rules only: refused off-chain and reverted on-chain with a typed error | Behaviour fence (item 7), consistent with item 6's "never exceed the authorised scope" | Typed errors in `contracts/src/utils/Errors.sol` [V, repo]; stock `AllowedTargets` / `AllowedMethods` / `ValueLte`; `ForbiddenTargetsEnforcer`, `JurisdictionEnforcer`, `VerifiedPayeeEnforcer`; off-chain policy mirror, counterparty scale (sanctions), simulator |
| **T?** | Ask | Missing data, conflicting intent, stale state, RPC disagreement, AI-flagged suspicion | Agent stops and explains; the user decides | Off-chain; nothing is signed while in T? | Right to know and final say (item 6) | `apps/agent` orchestrator; MCP `resultType: input_required`; A2A `input-required`. Override = explicit passkey confirmation through the T2 path (`CoSignEnforcer`); an override can never reach T3 or T4 |

Item 6 of the *Implementation Opinions on the Standardized Application and Innovative Development of Intelligent Agents* (CAC with NDRC and MIIT, 8 May 2026; our translation of the title) [V, cac.gov.cn] names three classes: decisions only the user makes, decisions needing user authorisation, and autonomous agent decisions, plus the user's right to know and final say. T0 and T4 are not decision classes: T0 has no decision and T4 implements item 7's "built-in rules and behaviour fences".

### 2.2 Monotonic-safety rule

> **Rule.** Let `det(a)` be the tier deterministic code assigns to action `a` from the sealed mandate and verified chain state. AI signals (sentinel, readers' disagreement, counterparty-risk model, anomaly model, content-safety guard) may move `a` only up the chain **T1 → T2 → T?**. They can never lower a tier, never assign T3 and never produce T4. Only the user widens authority, by sealing a new mandate at T3.

| Deterministic tier | An AI signal may move it to | An AI signal may never |
|---|---|---|
| T0 | nothing (no action exists) | create an action |
| T1 | T2 or T? | lower it; refuse it |
| T2 | T? | lower it to T1; refuse it |
| T3 | nothing (user only) | execute it |
| T4 | nothing (fixed) | lift it |
| T? | nothing until the user answers | resolve it on the user's behalf |

| Where it holds | How |
|---|---|
| `apps/agent` tier function | The AI signal type is an enum `{none, confirm, ask}`; final tier = maximum of `det(a)` and the AI tier in the order T1 < T2 < T?; T3 and T4 are outside the AI type by construction. Property test: <!-- gen:tests.monotonic.status -->not yet measured<!-- /gen --> |
| `apps/signer` | Re-runs the deterministic policy check; AI signals can only stop it from signing, never cause it to sign |
| On-chain | Enforcers never read AI output; they read signed `terms`, calldata and chain state only |

This keeps two promises at once: "the AI can only lower its own authority" and the user's final say on automated decisions (PIPL Art. 24; see `docs/PIA.md`).

### 2.3 Enforcer catalogue

Trust rule for every custom enforcer [I]: `terms` are signed by the user (trusted); `args` come from the redeemer (the agent) and are untrusted, used only for things verified on-chain (signatures, proofs) or merely logged. Every custom enforcer checks the framework's default execution mode and the `args` length; state keys are written with `msg.sender` = the DelegationManager. Money enforcers read the payment from the execution calldata through `PaymentDecoder` [V, repo: `contracts/src/libraries/PaymentDecoder.sol`], which accepts only ERC-20 `transfer`, ERC-1363 `transferAndCall` and `ConditionalPaymentInstructions.instruct`, and reverts on native value or any other shape.

| Enforcer | Kind | Checks | Typed errors (`Errors.sol` [V]) | Tier role | BFIA area |
|---|---|---|---|---|---|
| `AllowedTargets`, `AllowedMethods` | Stock v1.3.0 | Target and selector allowlists; always the first caveats the compiler emits | Framework reverts | T1 boundary, T3/T4 fence | 3 |
| `ValueLte` | Stock | Native value cap (compiled as 0) | Framework revert | T4 fence | 3 |
| `Timestamp` | Stock | `(now - 1, now + 120 s)` on the per-execution child delegation the signer adds to every redemption; the mandate's own validity window is enforced by `MandateBindingEnforcer` through `MandateRegistry.isLive` | Framework revert | T1 | 3 |
| `LimitedCalls` | Stock | `1` on per-execution children and x402 leaves | Framework revert | T1, x402 | 3 |
| `Nonce` | Stock | Deployed; not emitted by the compiler today. Revocation is `MandateRegistry.revoke`/`supersede` plus `DelegationManager.disableDelegation` in one user operation (any revoked mandate also fails `MandateBindingEnforcer`) | Framework revert | Revoke | 5 |
| `Redeemer` | Stock | Deployed; redeemer restriction is done by `AgentLineageEnforcer` (passport-bound agent or the pinned facilitator) | Framework revert | x402 | 3 |
| `ERC20TransferAmount` | Stock | Exact price on x402 leaves (cumulative cap, hence `LimitedCalls(1)`) | Framework revert | x402 | 5 |
| `MandateBindingEnforcer` | Custom | `MandateRegistry.delegationOf(mandateHash) == delegationHash` and status Live; logs mandate hash, intent hash, receipt nonce | `MandateNotLive`, `MandateDelegationMismatch` | All | 3 |
| `ForbiddenTargetsEnforcer` | Custom | Reverts on the delegator itself, DelegationManager, all EntryPoints, paymasters, ERC-8004 registries, `PayeeBook`, `MandateRegistry`, `KillSwitchRegistry`, `ProductRegistry`, `YinglongPassportRegistry`, `AccountabilityLedger`; re-checks execution mode | `ForbiddenTarget`, `InvalidExecutionMode` | T3 unreachable | 3 |
| `AgentLineageEnforcer` | Custom | Redeemer is the `agentWallet` of an active agentId with the same owner DID, or the facilitator pinned in the mandate (single-use x402 children only) | `LineageViolation` | All | 3 |
| `VerifiedPayeeEnforcer` | Custom | Recipient in `PayeeBook`, or the `agentWallet` of an agentId attested by a sealed trusted issuer with reputation over the sealed client list at or above threshold | `PayeeNotVerified` | T1/T2, T4 | 3 |
| `CategoryBudgetEnforcer` | Custom | Per-period cap per category; category comes from the recipient's `PayeeBook` entry, never from `args` | `CategoryBudgetExceeded` | T1 | 5 |
| `ReserveFloorEnforcer` | Custom | ERC-20 balance at or above the floor after execution (`afterAllHook`) | `ReserveFloorBreached` | T1 | 5 |
| `VelocityEnforcer` | Custom | Count and rolling outflow per window | `VelocityExceeded` | T1 | 5 |
| `SuitabilityEnforcer` | Custom | Product risk class at or below the sealed class | `UnsuitableProduct` | T1/T2 | 5 |
| `JurisdictionEnforcer` | Custom | Asset and rail allowed for the mandate's jurisdiction profile | `RailNotPermitted` | T4 | 5 |
| `GlobalPauseEnforcer` | Custom | Kill switch not tripped for the account or agent | `Paused` | Pause | 5 |
| `ReputationGateEnforcer` | Custom | ERC-8004 `getSummary` over the sealed client list at or above threshold | `ReputationTooLow` | T1/T2 | 3 |
| `CoSignEnforcer` | Custom | `IERC1271(delegator).isValidSignature(approvalHash, sig)`, call success and magic value both checked; `approvalHash` binds chain ID, delegation hash, `keccak(executionCallData)`, nonce, expiry (10 minutes at most); nonce consumed in `beforeHook` | `CoSignRequired`, `AboveTierCeiling`, `InvalidSignature`, `SignatureExpired`, `NonceAlreadyUsed` | T2 | 3 |
| `VetoTimelockEnforcer` | Custom | `schedule` only by the leaf delegate; user (relayed signature) or guardian may `veto`; redemption only after the window and if not vetoed | `VetoWindowOpen`, `Vetoed`, `NotScheduled` | T2 | 3 |
| `ZKMandateEnforcer` | Custom | Private mandate: Noir proof against a Poseidon2 commitment (cap, allowlist root, expiry, salt) and a running commitment; recipient and amount decoded from calldata; nonce and running commitment updated in `beforeHook` | `InvalidMandateProof`, `NonceAlreadyUsed` | T1 | 4, 5 |
| All money enforcers | via `PaymentDecoder` | Payment read from calldata only | `UndecodableExecution`, `NativeValueNotAllowed` | T4 | 3 |

`Errors.sol` is the source of truth for error names; the error-to-enforcer mapping above is the design and is checked by the enforcer test suites.

### 2.4 Off-chain controls

**`apps/agent` policy mirror.** A TypeScript mirror of every enforcer (`apps/agent/src/scales/policy.ts`), evaluated on the same decoded caveat bytes and the same on-chain counters. Every proposal is also simulated on the ledger itself (scale 7); if the mirror and the ledger disagree, the agent stops and asks instead of signing (a live differential check on every action). Each decision record carries `blockNumber`, `blockTimestamp` and `stateReadsHash`. The mirror refuses early (T4) so the chain rarely has to; the chain is still the final word.

**`apps/signer` signing-domain guard.** One allowlist of message types with two enforcement points [I]:

| Enforcement point | Key | Signs | Refuses |
|---|---|---|---|
| Agent signer vault (`apps/signer`) | Agent EOA | `redeemDelegations` calldata, child delegations (narrowing only), receipts; only after re-running the policy check and re-simulating if the head moved more than 2 blocks past the simulated block | Everything else |
| Approval page (`/approve/[id]`), the only code path that creates a WebAuthn challenge for the user's passkey | User passkeys | (1) DelegationManager `Delegation`, (2) `CoSignEnforcer` approval, (3) `AccountabilityLedger` receipt, (4) `KillSwitchRegistry` trip and untrip, (5) `VetoTimelockEnforcer` veto, (6) ERC-4337 `userOpHash` (EntryPoint v0.7 domain) with calldata decoded field by field | EIP-3009 transfers, ERC-2612 Permit, Permit2, raw `personal_sign`, unknown EIP-712 domains (typed error) |

Message kinds allowed at the assessed commit: <!-- gen:guard.allowlist.count -->not yet measured<!-- /gen --> (printed from the allowlist, never typed).

**The nine scales** (plan section 12.2), in order. Only deterministic scales can refuse.

| # | Scale | Kind | Can refuse (T4) | Can escalate (T2/T?) | Implemented by | Tested by (bench family or suite) |
|---|---|---|---|---|---|---|
| 1 | Normalise (homoglyph, bidi, invisible characters; PII scrubber) | Deterministic | No (transforms and flags) | Flags feed scale 2 | `apps/agent` normaliser | `direct_injection`, `multilingual`, TXT |
| 2 | Sentinel (M1, mmBERT-base, ONNX int8) | AI | No | Yes | ML serving (ONNX) | `direct_injection`, `multilingual`, TXT, `memory_implant` |
| 3 | Quarantine and taint (two readers for financial fields) | AI readers + deterministic taint | Only by the deterministic taint rule | Reader disagreement → T? | `apps/agent` readers, `packages/provenance` | TXT, `visual_injection` |
| 4 | Ground | Deterministic | Ungrounded value → not signed | Missing data → T? | `apps/agent` | TXT, `memory_implant`, `within_mandate` |
| 5 | Policy (mirror) | Deterministic | Yes | Above T1 cap → T2 | `apps/agent` policy engine | `split_payment`, S-PRIV, S-RAIL, `within_mandate` |
| 6 | Counterparty (passport, trusted issuer, reputation, sanctions mirror, M2) | Deterministic + AI (M2) | Yes (deterministic parts) | M2 → T2/T? | `apps/agent` counterparty verifier | S-ID, `lookalike_address`, S-RAIL |
| 7 | Simulate (`eth_simulateV1`; FISCO `eth_call`) | Deterministic | Asset diff not equal to intent → not signed | Simulation unavailable → T? | `apps/agent` simulator | S-PRIV, S-X402, `within_mandate` |
| 8 | Anomaly (M3) | AI | No | Yes | ML serving | `urgency_authority`, `split_payment`, `within_mandate` |
| 9 | Chain (enforcers) | Deterministic | Typed revert | No | `contracts/` | All (bypass toggle) |

Vocabulary used in the UI and the Judge's Challenge [I]: **"Refused"** only for scales 4, 5, 6 (deterministic part), 7 and 9; **"Held for you"** when an AI scale (2, 3, 6-M2, 8) escalated to T2 or T?. Bench families (named as in `bench/gen/generate_bench.py`; TXT = the five text-injection families) and the non-bench security suites (S-ID, S-PRIV, S-RAIL, S-SIG, S-X402, FI) are defined in `docs/THREAT_MODEL.md` section 5.

---

## 3. BFIA area 1: Initialisation and input security

| ID | Control | Implemented by | Verified by | Bench family or suite |
|---|---|---|---|---|
| C-IN-01 | Fail-closed startup: models, prompts, schemas, policy and the enforcer table are SHA-256 pinned; any mismatch stops the runtime; the hashes go into the passport and every `planHash` | `apps/agent` provenance registry, `packages/provenance` | Tampered-prompt startup test | CI |
| C-IN-02 | Deterministic deployment: own CREATE2 factory from a fresh deployer at nonce 0; solc 0.8.23, `evm_version = london`, `bytecode_hash = "none"`, `cbor_metadata = false` [V, `contracts/foundry.toml`]; deployer keeps no admin role (result: <!-- gen:deploy.deployer_roles -->not yet measured<!-- /gen -->) | Deployment scripts, `deployments/*/v2.json` | Post-deploy role scan | CI |
| C-IN-03 | Signed enforcer table (addresses + code hashes); its hash sits in the passport; `yinglong verify` compares `extcodehash` on both ledgers | `packages/mandate`, `tools/verify-py`, `YinglongPassportRegistry` | Bytecode equality: <!-- gen:bytecode.equal -->not yet measured<!-- /gen --> of <!-- gen:bytecode.total -->not yet measured<!-- /gen --> enforcers | CI |
| C-IN-04 | Account initialisation: HybridDeleGator with owner `address(0)` and two passkeys (phone + laptop), deployed in the first sponsored user operation; passkey RP ID fixed to `yinglong-agent.tech` | `apps/web` onboarding, framework HybridDeleGator | Onboarding e2e test | — |
| C-IN-05 | FISCO initialisation: standard (non-SM) build only (an SM build replaces KECCAK256 with SM3 and breaks every EIP-712 check [S, secondary source]); chain ID 0 ledger profile; YINGLONG domains add a salt; feature flags verified on the chain | `contracts-fisco/`, `infra/` | Ledger-profile golden tests | — |
| C-IN-06 | Mandate compilation: `AllowedTargets` + `AllowedMethods` first; allowlist and forbidden set asserted disjoint; `ValueLte(0)`, `GlobalPauseEnforcer` and `MandateBindingEnforcer` always present; the root delegate is never `ANY_DELEGATE` | `packages/mandate` compiler | Compiler property tests | S-PRIV |
| C-IN-07 | Round-trip verification: caveat array published in `MandateRegistry`; delegation hash recomputed; enforcer code hashes checked; terms decoded back to sentences; two independent implementations (TypeScript, Python) agree on <!-- gen:verify.golden.n -->not yet measured<!-- /gen --> golden files and <!-- gen:verify.property.n -->not yet measured<!-- /gen --> property cases | `packages/mandate`, `tools/verify-py` | Golden and property tests | — |
| C-IN-08 | Input normaliser: homoglyphs, bidi controls, invisible characters; PII scrubber (mainland mobile numbers, 18-digit ID numbers, UnionPay card numbers, private keys, seed phrases) | `apps/agent` normaliser | Scrubber recall on a labelled set: <!-- gen:pia.scrubber.recall -->not yet measured<!-- /gen --> | `direct_injection` |
| C-IN-09 | Injection sentinel M1; escalates only | ML serving | Bench per family; FNR <!-- gen:sentinel.fnr -->not yet measured<!-- /gen --> | `direct_injection`, `multilingual`, TXT, `memory_implant` |
| C-IN-10 | Quarantine: readers return a closed schema of enums, numbers, verified IDs and opaque handles, each a `Tagged<T>` with source, reader model hash and taint; a snapshot test proves no quarantined bytes reach any planner prompt | `apps/agent`, `packages/provenance` | Snapshot test | TXT, `visual_injection` |
| C-IN-11 | `PayeeBook` enum: the intent's recipient is a `PayeeBook` id or `NEW_PAYEE_REQUEST`; the model cannot emit an address; a new payee is always a T3 request | `packages/mandate` intent schema | Schema tests | TXT, `lookalike_address` |
| C-IN-12 | Two-reader agreement on tainted financial fields (amount, payee), including the vision reader; readers of different model families; disagreement → T? | `apps/agent` readers | Bench | `visual_injection` |
| C-IN-13 | Untrusted protocol input: x402 `description`, A2A card fields, token names, invoice memos are untrusted; A2A cards canonicalised (RFC 8785) and JWS ES256-signed; `kid` and JWKS hash in the passport | `apps/agent`, `apps/services`, `YinglongPassportRegistry` | Card-verification tests | TXT, S-ID, S-X402 |
| C-IN-14 | Supply chain: pinned lockfiles, `--ignore-scripts`, SBOM (hash <!-- gen:sbom.sha256 -->not yet measured<!-- /gen -->), framework submodule pinned at v1.3.0 [V, repo], no third-party skills or MCP servers in the signing path, CI rules gate for Chinese characters, AI attribution and secrets [V, `scripts/check-rules.mjs`] | CI, `scripts/` | CI jobs | CI |
| C-IN-15 | Device capture: the quarantined readers never use screen or microphone capture; they read only files the user supplies (BFIA device-capture requirement [S, secondary source]) | `apps/agent` readers | Code review | — |

---

## 4. BFIA area 2: Model inference and decision security

| AI (proposes, explains) | Code and chain (authorise, settle) |
|---|---|
| Understand intent; plan multi-step tasks; read invoices in quarantine; reason about counterparties; forecast cash flow; explain | Compute every amount; enforce limits, payees, categories, reserve, suitability, jurisdiction; verify signatures; settle; anchor; pause and revoke |

| ID | Control | Implemented by | Verified by | Bench family or suite |
|---|---|---|---|---|
| C-MD-01 | Role separation above: no amount, address or date is produced by a model | `apps/agent` | Snapshot and grounding tests | TXT |
| C-MD-02 | Grammar-constrained output (llama-server `json_schema`, vLLM structured outputs, zod schemas on API paths); invalid output retried at most twice, then T? | `apps/agent` | JSON validity rate in the bench | — |
| C-MD-03 | Grounding: every amount, address, date and counterparty traces to the user's words, the mandate, the `PayeeBook` or verified chain state; missing grounding → T? | `apps/agent` | Bench | TXT, `memory_implant`, `within_mandate` |
| C-MD-04 | Deterministic policy mirror with shared vectors; differential fuzzing against the Solidity enforcers with time and block warps | `apps/agent`, `contracts/test` | Differential fuzz split (policy-rejected / reverted attack / reverted divergence): <!-- gen:fuzz.differential.split -->not yet measured<!-- /gen --> | `split_payment`, S-PRIV |
| C-MD-05 | Simulation conformance: `eth_simulateV1` via viem `simulateCalls` with asset tracing (answers on `sepolia.base.org` [V, live call per plan]); the asset diff must equal the intent; FISCO path uses `eth_call` | `apps/agent` simulator | Bench | S-PRIV, S-X402 |
| C-MD-06 | Monotonic-safety rule (section 2.2) | `apps/agent` tier function | <!-- gen:tests.monotonic.status -->not yet measured<!-- /gen --> | All |
| C-MD-07 | Anomaly model M3 (IsolationForest + LightGBM + Mondrian conformal); escalates only | ML | Held-out anomaly family | `urgency_authority`, `split_payment` |
| C-MD-08 | Anti-hallucination: the explainer writes prose with placeholders from reason codes; code fills every number, date, address, hash and name; a validator checks every numeral, hex string and entity against the record; any miss → template fallback | `apps/agent` explainer | Ungrounded-claim rate <!-- gen:bench.ungrounded.rate -->not yet measured<!-- /gen --> | — |
| C-MD-09 | AI-content labelling: "AI-generated" chip on explanations; `aigc` block (label, model, provider, contentId) in every receipt | `apps/web`, receipt schema in `packages/mandate` | Receipt schema test | — |
| C-MD-10 | Model provenance: executor model recorded per receipt; model and prompt hashes in the passport | `apps/agent`, `YinglongPassportRegistry` | Evidence table | — |
| C-MD-11 | Content safety on the mainland profile (Qwen3Guard-Stream-0.6B on chat replies): escalates to "not sure", never refuses money movement, not an injection defence | `apps/agent` | Config test | — |
| C-MD-12 | Memory: every entry carries provenance and a TTL; a recalled tainted entry is treated as fresh untrusted input; memory never supplies a recipient, amount or payee | `apps/agent` | Bench | `memory_implant` |
| C-MD-13 | No code execution: no eval, no interpreter, no shell; the MCP server is proposal-only | `apps/agent` | Code review, tool-list test | S-PRIV |
| C-MD-14 | Planning: typed step DAG with preconditions, dry run on simulation, re-plan on failure | `apps/agent` | Plan validity, pass@1 and pass^3 in the bench report | — |

---

## 5. BFIA area 3: Identity authentication and operation security

### 5.1 Controls

| ID | Control | Implemented by | Verified by | Bench family or suite |
|---|---|---|---|---|
| C-ID-01 | Agent identity: ERC-8004 agentId plus passport (owner DID, `identityCode` placeholder, VC hash, provenance hashes, issuer attestations, status, JWKS hash + `kid`); reverse lookup wallet → agentId; the agent NFT is held by a dedicated owner key, so `setAgentWallet` is unreachable through redemption | `YinglongPassportRegistry`, ERC-8004 IdentityRegistry | Registry tests | S-ID |
| C-ID-02 | Institution attestation ("dual authorisation" pattern, section 5.2) | `YinglongPassportRegistry` | Beat 1 evidence | S-ID |
| C-ID-03 | Counterparty verification on-chain: `VerifiedPayeeEnforcer`, `ReputationGateEnforcer`, with trusted issuers and trusted clients (10 at most) sealed in the mandate | Enforcers | Enforcer tests; `PayeeNotVerified` revert on Base | S-ID, `lookalike_address` |
| C-ID-04 | Redeemer lineage: `AgentLineageEnforcer`, stock `Redeemer` | Enforcers | Invariant 6 | S-PRIV |
| C-ID-05 | User authentication: WebAuthn P-256 passkeys on HybridDeleGator, which accepts WebAuthn and raw P-256 signatures from registered keys and ECDSA only from `owner` (here `address(0)`) [V, framework source] | Framework HybridDeleGator | Invariant 9 | S-SIG |
| C-ID-06 | T2 co-signature: `CoSignEnforcer` (section 2.3) | Enforcer | Invariant 9; nonce replay tests | S-PRIV |
| C-ID-07 | Approval page decodes `executionCallData` itself, resolves the payee name from the on-chain `PayeeBook`, and refuses to sign if its decoding differs from the runtime's description | `apps/web` `/approve/[id]` | e2e test with a lying runtime | `urgency_authority`, S-SIG |
| C-ID-08 | Signing-domain guard (section 2.4) | `apps/signer`, approval page | Guard unit tests per refused type | S-SIG |
| C-ID-09 | Agent signer: signs only `redeemDelegations` of payment shapes (guard); signs only T1 or approved T2 decisions; re-simulates at the head; adds a per-execution child delegation with `Timestamp(now - 1, now + 120 s)` and `LimitedCalls(1)`; asks the breaker to pause on refusal | `apps/signer` | Signer tests | S-PRIV |
| C-ID-10 | T3 unreachable through any delegation: allowlist first, `ForbiddenTargetsEnforcer`, invariant 5; T3 only by a user operation signed by the user's passkeys (or 2-of-3 directors) | Enforcers, compiler | Invariant 5 (fuzz and symbolic) | S-PRIV |
| C-ID-11 | Veto window for scheduled items: `VetoTimelockEnforcer` | Enforcer | Enforcer tests | `urgency_authority` |
| C-ID-12 | Mandate binding: `MandateBindingEnforcer`; at most one live delegation per mandate lineage; atomic `supersede` | Enforcer, `MandateRegistry` | Invariant 7 | S-PRIV |
| C-ID-13 | Payment decoding from calldata only (`PaymentDecoder`) | `contracts/src/libraries/PaymentDecoder.sol` [V, repo] | Decoder tests | S-PRIV |
| C-ID-14 | Enforcer trust rule (terms trusted, args untrusted, mode and length checks) | All custom enforcers | Review checklist | S-PRIV |
| C-ID-15 | Invariants 1 to 10 under fuzzing; invariants 1 to 5 under bounded symbolic execution | `contracts/test`, proof directory | <!-- gen:invariants.passing -->not yet measured<!-- /gen --> invariants pass; symbolic: <!-- gen:proofs.symbolic.status -->not yet measured<!-- /gen --> | All |
| C-ID-16 | Reentrancy bounded, not absent: allowlisted targets, `nonReentrant` on every YINGLONG-authored target, stateful enforcers update before execution, Slither detectors, a malicious ERC-777-style token test | Contracts, CI | Static analysis: <!-- gen:static.slither.high -->not yet measured<!-- /gen --> high open | S-PRIV |
| C-ID-17 | Re-delegation narrows only; sub-agent chains decrement the root user's counters exactly once; re-sealing never widens aggregate counters | Framework + custom enforcers | Invariants 6 and 7 | S-PRIV |

### 5.2 Institution authorisation ("dual authorisation")

The BFIA standard is reported to require that a third-party agent may not operate a financial institution's app interface without that institution's authorisation; press summaries call this "dual authorisation" [S, secondary source].

| Requirement | YINGLONG |
|---|---|
| Agent must not drive a financial app's interface without the institution's authorisation | The agent never operates any institution's app, screen or API on the user's behalf. It acts only through the user's own smart account, by redeeming a delegation the user sealed |
| Institution's authorisation is visible | The passport carries attestations from institutions (fictional in the demo: Harbour Digital Bank, Harbour Bay University); counterparties and the on-chain payee gate check them |
| User's authorisation is visible | The passkey seal on the delegation, published with its caveat array |
| Production | A licensed institution would act as issuer; the attestation would follow that institution's own policy. Not claimed today |

### 5.3 Invariants (plan section 9.5)

| # | Invariant | Fuzz | Symbolic (bounded) |
|---|---|---|---|
| 1 | No redemption sequence exceeds any category or period cap | Yes | Yes |
| 2 | The reserve floor is never breached | Yes | Yes |
| 3 | A paused or revoked mandate moves nothing | Yes | Yes |
| 4 | Only verified payees receive funds | Yes | Yes |
| 5 | No redemption sequence can change the delegator's signer set, alter the `PayeeBook`, untrip the kill switch, change `agentWallet` or touch the EntryPoint deposit | Yes | Yes |
| 6 | Sub-agent chains (depth 2 and 3) decrement the root user's category and velocity counters exactly once | Yes | — |
| 7 | At most one live delegation per mandate lineage; re-sealing never widens any aggregate counter | Yes | — |
| 8 | A ZK proof cannot be redeemed twice; two valid proofs summing above the hidden cap fail on the second | Yes | — |
| 9 | A 65-byte ECDSA signature never satisfies `CoSignEnforcer` on a passkey-only account | Yes | — |
| 10 | The facilitator cannot redeem an x402 child twice or above the price | Yes | — |

The "Fuzz" and "Symbolic" columns are the plan; per-invariant results are generated: <!-- gen:invariants.table -->not yet measured<!-- /gen -->

---

## 6. BFIA area 4: Data security and privacy protection

Full analysis: `docs/PIA.md`.

| ID | Control | Implemented by | Verified by |
|---|---|---|---|
| C-DP-01 | On-chain minimisation: only addresses, hashes, Merkle roots and caveat terms go on chain; no names, no free text, no document content | Schemas in `packages/mandate`, contracts | Schema review |
| C-DP-02 | PII scrubber before any third-party model API call (KR-14) | `apps/agent` normaliser | Recall <!-- gen:pia.scrubber.recall -->not yet measured<!-- /gen --> |
| C-DP-03 | Mainland profile: domestic model endpoints or the on-device intent model, no free API models, a locally mirrored sanctions list (no address export to screening services) | Provider config in `apps/agent` | Config test (but see DC-07) |
| C-DP-04 | Training and bench data are synthetic or public with no real identifiers; Chinese-script data only in private HuggingFace datasets referenced by revision and SHA-256; every licence recorded | `ml/`, `bench/`, `docs/third_party.md` | Licence register |
| C-DP-05 | Secrets outside the tree: runtime loaders read from a directory outside the repository [V, `ml/common/keys.py`]; `.gitignore` patterns for keys and tokens [V]; secret patterns in the rules gate [V]; gitleaks over history in CI | Repo tooling | CI |
| C-DP-06 | Web and transport: TLS (Caddy, Let's Encrypt), strict CSP, DOMPurify on anything HTML-like, no request leaves the origin (Playwright test), self-hosted fonts and assets | `apps/web`, `infra/` | e2e tests |
| C-DP-07 | Judge's Challenge data: consent line, 30-day retention, never part of the held-out family, used for retraining only after the PII scrubber and with consent | `apps/services` | Retention job test |
| C-DP-08 | User study: anonymous, with consent | Study tool | Study protocol |
| C-DP-09 | Receipts: full records off-chain (Postgres); on-chain only hashes and roots; backups | `apps/indexer`, `infra/` | Restore test |
| C-DP-10 | Data-subject rights: explanation per decision, ask, override, pause; the deletion limit for on-chain data is stated, not hidden | `apps/web`, `docs/PIA.md` | PIA |

---

## 7. BFIA area 5: Risk prevention, control and compliance

| ID | Control | Implemented by | Verified by |
|---|---|---|---|
| C-RC-01 | Kill switch: `trip()` (guardian, breaker watcher); `tripWithSig(account, nonce, deadline, sig)` verified through the account's ERC-1271 and relayable by anyone (no bundler); `untripWithSig` owner only; `supervisorPause(agentId)` pause only; dead-man timer; `GlobalPauseEnforcer` in every delegation | `KillSwitchRegistry`, `GlobalPauseEnforcer` | Time-to-pause p50 <!-- gen:time.pause.p50 -->not yet measured<!-- /gen --> (n = <!-- gen:time.pause.n -->not yet measured<!-- /gen -->) |
| C-RC-02 | Breaker: a reverted transaction writes nothing, so the breaker trips off-chain: policy and signer refusals call `trip()`; on-chain reverts are recovered by `eth_call` replay at the parent block | `apps/indexer` breaker watcher | Beat 8 evidence |
| C-RC-03 | Revocation: `MandateRegistry.revoke`/`supersede` plus `disableDelegation` in one user operation sent by our relayer straight to `EntryPoint.handleOps`; atomic `supersede` | `MandateRegistry`, relayer | Time-to-revoke p50 <!-- gen:time.revoke.p50 -->not yet measured<!-- /gen --> |
| C-RC-04 | Rotation: new agent key, `setAgentWallet` signed by the new key, mandate re-sealed | Signer, `YinglongPassportRegistry` | Time-to-rotate p50 <!-- gen:time.rotate.p50 -->not yet measured<!-- /gen --> |
| C-RC-05 | Exposure bound: "max funds at risk now" = remaining period caps, read on-chain and shown in the key-compromise drill | `apps/web`, enforcers | Bench max at risk <!-- gen:bench.max_at_risk -->not yet measured<!-- /gen --> |
| C-RC-06 | Budgets, reserve and velocity enforcers | Enforcers | Invariants 1, 2 |
| C-RC-07 | Suitability as code; first sweep into any product at T2 | `SuitabilityEnforcer`, policy | `UnsuitableProduct` revert (beat 10) |
| C-RC-08 | Jurisdiction as code: rail chosen by the mandate's profile; mainland rail is coin-free; a jurisdiction-forbidden rail cannot be enabled by any mandate | `JurisdictionEnforcer`, rail adapters | `RailNotPermitted` revert (beat 10) |
| C-RC-09 | Sanctions screening against a locally mirrored public list (OFAC SDN, UN) at the counterparty scale; deterministic; off-chain only | `apps/agent` counterparty verifier | Bench S-RAIL |
| C-RC-10 | Accountability ledger: EIP-712 receipts (SM2/SM3 co-signature on the mainland profile), hash chain, batched Merkle roots, two-way anchors FISCO ↔ Base, regulator node | `AccountabilityLedger`, anchoring relayer | Anchor transactions; `yinglong verify-tx` |
| C-RC-11 | Supervisory halt: FISCO DelegationManager owner is a 2-of-3 (KR-18) | FISCO deployment | Ownership read |
| C-RC-12 | Honest labels: test units, simulator and testnet labels on every surface; receipt `source` field (`live-base`, `live-fisco`, `anvil-bench`); vocabulary rules | `apps/web`, receipt schema | Review checklist |
| C-RC-13 | Incident response: five playbooks; playbook 1 rehearsed in beat 11 | `docs/INCIDENT_RESPONSE.md` | Drill record |
| C-RC-14 | Public attack endpoint controls (Judge's Challenge): guest mandates with tiny caps in team-minted `tHKD`, signed expiring QR tokens, per-QR daily quota, daily gas budget (<!-- gen:challenge.gas_budget -->not yet measured<!-- /gen -->), moderation, shadow mode on an Anvil fork labelled "simulated, not on-chain" | `apps/services` | Quota tests |
| C-RC-15 | Non-custodial primary path; any agent-held fallback account is labelled custodial | Architecture | Review |
| C-RC-16 | Evidence integrity: numbers only from code; held-out family hash committed before training (<!-- gen:bench.heldout.sha256 -->not yet measured<!-- /gen -->); nightly re-verification of every evidence hash (21 to 31 Oct); `MANIFEST.sha256` | `scripts/finalize`, CI | Manifest |

Compliance mapping per rule: `docs/COMPLIANCE_MATRIX.md`.

---

## 8. Accountability allocation

| Situation | Accountable | Evidence |
|---|---|---|
| Action inside the mandate | The user: the mandate is their authority, proven by the seal | Seal signature + receipt |
| Action outside the mandate | Prevented by code (invariants, typed reverts). If it ever happened, the operator of the agent service is accountable to the user, with recourse against the enforcer supplier under the deployment agreement | Invariant and proof logs; revert evidence |
| Counterparty fraud | The counterparty | Passport, attestations, receipts, escrow claim |
| AI explanation wrong, action within the mandate | The operator (explanations are labelled AI-generated; the decision record holds the facts) | Decision record hash in the receipt |
| Wrong institution attestation [I] | The issuer that attested; the operator for the choice of default trusted issuers | Attestation record, issuer key event log |
| Facilitator fails to settle or settles without delivery [I] | The facilitator operator; loss bounded by the quoted price | Child delegation hash (`keccak(permissionContext)`) in the receipt |
| Third-party infrastructure halts redemptions (KR-17) [I] | No loss of funds (fails safe); availability incident for the operator | Pause state read on-chain |

What a receipt proves and does not prove:

| It proves | It does not prove |
|---|---|
| The user's passkey sealed mandate M | That the user wanted this specific action (only that it was inside M) |
| Agent A (passport P) executed X via delegation D bound to M | That the model's reasoning was correct |
| The enforcers allowed X, or reverted it with a typed error | That off-chain components were uncompromised (it commits to what they reported) |
| The decision record existed before submission | That counterparties are honest beyond their attestations |
| The receipt is in a root anchored on FISCO BCOS and Base | Legal validity of the underlying contract |

---

## 9. Known risks

| ID | Risk | BFIA area | Mitigation | Residual risk |
|---|---|---|---|---|
| KR-01 | Testnet only; no third-party audit | 5 | Internal review (`docs/SECURITY_REVIEW.md`), invariants, bounded symbolic proofs, static analysis; the framework itself ships third-party audit reports [V, repo] that do not cover our enforcers | Undiscovered enforcer bugs. Not for real funds |
| KR-02 | Agent key in a software keystore on the VPS | 3 | Signer isolation; caveats bound the damage; pause; rotation drill; finals module: TEE-attested signer | Host compromise yields in-mandate loss up to the remaining caps until pause |
| KR-03 | Mainland settlement is an e-CNY-style simulator | 5 | Labelled "e-CNY-style simulator. Not the PBoC sandbox; no connection to PBoC or operator-bank systems." | Nothing about real mainland settlement is demonstrated |
| KR-04 | FISCO BCOS chain is run by the team (four nodes plus the regulator node) | 5 | Two-way anchoring to Base makes later rewrites detectable | Anchoring proves consistency, not independent consensus |
| KR-05 | ERC-8004 reputation is Sybil-prone | 3 | Trusted issuers and trusted clients (10 at most) sealed in the mandate; `PayeeBook` is primary | A compromised trusted client can inflate reputation |
| KR-06 | Sentinel false negatives | 1 | Layered scales; the chain is the backstop; measured FNR <!-- gen:sentinel.fnr -->not yet measured<!-- /gen --> | Undetected injections can still cause within-mandate manipulation (KR-07) |
| KR-07 | Within-mandate manipulation up to the caps | 5 | Idempotency keys, invoice-payee-amount cross-checks, anomaly → T?, T2 for new counterparties | Measured rate <!-- gen:bench.wmm.rate -->not yet measured<!-- /gen -->; max funds at risk = remaining cap (<!-- gen:bench.max_at_risk -->not yet measured<!-- /gen -->) |
| KR-08 | LLM availability in mainland China | 2 | Domestic endpoints, on-device intent model, template explanations, recorded-demo mode; no model → T? | Degraded understanding, never wider authority |
| KR-09 | Passkey loss | 3 | Two passkeys; guardian-initiated recovery with a delay the owner can cancel (see DC-05) | Both passkeys lost and guardian unavailable = locked account |
| KR-10 | Demo time compression | 5 | A flag runs budget periods at demo speed; labelled on screen | Period results under compression differ from real time |
| KR-11 | Self-hosted ValidationRegistry and facilitator are experimental | 5 | Labelled "self-attested" and "experimental"; facilitator limited to single-use, exact-amount children | Validation entries are self-attested |
| KR-12 | GB/Z 185 identity code is a placeholder | 3 | Field shows "YL-TEST-..." labelled placeholder | No official identity code; no interoperability claim |
| KR-13 | Faucet limits | 5 | `tHKD` minted by the team for the challenge; shadow mode | Live sample sizes are small (<!-- gen:bench.live.n -->not yet measured<!-- /gen --> live items) |
| KR-14 | Free API models may log prompts | 4 | PII scrubber before any API call; synthetic data only; mainland profile excludes free APIs | Scrubber misses would leak what a user typed |
| KR-15 | USDC v2.2 accepts ERC-1271 signatures on `permit` and `transferWithAuthorization` [V per plan]; HybridDeleGator validates any 32-byte hash without domain checks [V, framework source] | 3 | Signing-domain guard is the only path that creates a passkey challenge and refuses EIP-3009, Permit, Permit2, `personal_sign` and unknown domains; `TestHKD` accepts EOA signers only for EIP-3009 and Permit | Closed by our client code, not by the chain, for USDC (see DC-09) |
| KR-16 | FISCO DelegationManager domain uses chain ID 0 (FISCO `CHAINID` returns 0) and cannot carry a salt | 3 | YINGLONG's own domains add a salt; chain IDs differ from Base (84532) | A delegation signed for one chain-ID-0 deployment is distinguishable only by the verifying contract address |
| KR-17 | The Base Sepolia DelegationManager owner, a MetaMask EOA (`0xb0403b32f54d0bd752113f4009e8b534c6669f44`, `paused()` false on 15 Oct) [V, eth_call per plan], can pause all redemptions | 5 | Recorded-demo fallback; FISCO path unaffected; the owner cannot move funds | Availability only; fails safe |
| KR-18 | FISCO DelegationManager owner can halt every redemption on that chain | 5 | Owner made a 2-of-3 supervisory halt | Today the team holds every key on that chain (KR-04; see DC-04) |
| KR-19 | Public attack endpoint (Judge's Challenge) | 5 | C-RC-14 and C-DP-07 | Gas drain within the daily budget; offensive content between moderation passes; challenge downtime |

### 9.1 Open design checks (found while writing this assessment)

| ID | Check | Why it matters | Resolution path |
|---|---|---|---|
| DC-01 | Enforcers must not embed chain-specific addresses as immutables | Immutables are part of runtime code; if a registry address differs between Base and FISCO, the code hashes differ and the "identical bytecode" claim fails. DelegationManager and DeleGatorCore use immutables [V, framework source]; our enforcers must not | Registry addresses come from signed `terms` or a one-time storage write; CI compares runtime code hashes |
| DC-02 | Directors' passkeys on the treasury | MultiSigDeleGator v1.3.0 verifies ECDSA signatures only (`ECDSA.recover`, fixed signature length) [V, framework source], so 2-of-3 director passkeys need another account design | Either EOA director keys (labelled), or a multisig that accepts ERC-1271 / P-256 signers |
| DC-03 | Who maintains the `ForbiddenTargetsEnforcer` list | A "registry-maintained list" needs a maintainer, which would reintroduce an admin role the deployer must not keep | Fix the list at deployment, or carry it in signed `terms` |
| DC-04 | Who lifts a `supervisorPause` | Not specified; a pause that nobody can lift is a permanent freeze | Define: supervisor lifts its own pause; the user cannot override a supervisory pause; both events receipted |
| DC-05 | Guardian powers | Guardian can pause, veto and start delayed recovery; recovery is not in the contract list | Specify the recovery contract and delay, or drop recovery and state KR-09 plainly |
| DC-06 | Issuer key compromise | Trusted issuers are sealed in each mandate, so removing a compromised issuer needs every user to re-seal (T3) | Registry-level issuer status checked by `VerifiedPayeeEnforcer`, or accept re-seal (playbook 3) |
| DC-07 | Mainland-profile data residency | The VPS is in Azure East Asia (Hong Kong) and the plan's DashScope endpoint is the international region; both are outside the mainland | Production: mainland hosting and the mainland model region; today: fictional data only (PIA section 6) |
| DC-08 | Public caveat arrays | Publishing full caveat arrays on Base reveals a real user's spending rules and payees | Production default: private mandate (ZK) or consortium-only publication |
| DC-09 | Passkey RP origin integrity | Any script running on `yinglong-agent.tech` can ask the authenticator to sign any challenge; the authenticator does not show typed data | Strict CSP, no third-party scripts, Subresource Integrity, no off-origin requests; production: an account that validates ERC-1271 only for allowlisted domains [I] |
| DC-10 | Sanctions lists for the mainland profile | Applying foreign sanctions lists to mainland users may raise issues under the *Anti-Foreign Sanctions Law of the People's Republic of China* (2021; our translation of the title) [U, unverified; needs legal review] | Legal review before any mainland production use; demo uses public lists on fictional data only |
| DC-11 | Licence compatibility | The framework imports ERC-4337 interfaces from `account-abstraction` v0.7.0, whose files are GPL-3.0 [V, repo]; YINGLONG is Apache-2.0 | Legal review; see `docs/third_party.md` |

---

## 10. Now vs production

| Area | Now (this submission) | Production would require |
|---|---|---|
| Ledgers | Base Sepolia (public testnet); FISCO BCOS run by the team, with a regulator node played by the team | Consortium operated by independent parties (bank, operator, regulator); mainnet or licensed infrastructure |
| Value | Test units: `tHKD` (simulation of a regulated instrument, not issued by any licensee), testnet USDC, coin-free instructions | Instruments from licensed issuers through licensed institutions; e-CNY only via operator banks |
| Agent key | Software keystore on a VPS | HSM or attested TEE signer; key ceremony; monitored rotation |
| User keys | Two passkeys; a Chrome virtual authenticator where captioned in the video | Authenticator attestation policy; regulated recovery process |
| Assurance | Internal review; fuzzing; bounded symbolic execution; no third-party audit | Independent audits of enforcers, registries, signer, guard and circuits |
| Regulatory | No filing, no licence | Filing, testing and recall under item 11 of the agent Opinions where applicable; payment licence if custodial (Decree 768); generative-AI service filing; PIPL impact assessment by the deploying institution |
| Identity | `identityCode` placeholder "YL-TEST-..." | An issued identity code under the GB/Z 185-2026 series |
| Attestations | Fictional issuers (Harbour Digital Bank, Harbour Bay University) | Licensed bank or regulated issuers |
| Sanctions | Local mirror of public lists | Licensed screening provider and jurisdiction-appropriate lists (DC-10) |
| Models | Synthetic training data; OpenRouter, local and DashScope endpoints | Filed domestic models on the mainland; model-risk management and monitoring |
| Privacy | Fictional personas; mandate terms public on Base | Private mandates by default; mainland residency; consent management; deletion process |
| Governance of halts | Team holds every key | Bank + operator + regulator multisig with documented procedures |
| Monitoring | Breaker watcher and indexer | 24/7 monitoring and incident handling |
| Facilitator | MetaMask development facilitator or seller-settled | Contracted facilitator with service levels |

---

## 11. Control status at the assessed commit (generated)

Columns: control ID, status (`tested`, `implemented`, `designed`, `not started`), test or evidence path. Implemented <!-- gen:controls.implemented -->not yet measured<!-- /gen --> of <!-- gen:controls.total -->not yet measured<!-- /gen --> controls.

<!-- gen:controls.status_table -->not yet measured<!-- /gen -->

---

## 12. Evidence index

| Evidence | Location |
|---|---|
| Automated tests | <!-- gen:tests.total -->100<!-- /gen --> passing, <!-- gen:tests.failed -->not yet measured<!-- /gen --> failing (contracts <!-- gen:tests.contracts -->89<!-- /gen -->, TypeScript <!-- gen:tests.ts -->not yet measured<!-- /gen -->, Python <!-- gen:tests.py -->11<!-- /gen -->, end-to-end <!-- gen:tests.e2e -->not yet measured<!-- /gen -->) |
| Bytecode equality table | <!-- gen:bytecode.table -->not yet measured<!-- /gen --> |
| On-chain execution evidence | `docs/EXECUTION_EVIDENCE.md`, `docs/evidence/bundle.json` |
| Bench report | `bench/` reports; per-family table in `docs/THREAT_MODEL.md` |
| Security review | `docs/SECURITY_REVIEW.md` |
| Claims and their fallbacks | `docs/CLAIMS.md` |
