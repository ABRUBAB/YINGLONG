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
| Release | <!-- gen:meta.release_tag -->99e8147<!-- /gen --> |
| Commit assessed | <!-- gen:meta.commit -->99e8147edb8cfcd4467597907d46e586a34048ad (working tree had uncommitted changes)<!-- /gen --> |
| Numbers generated at | <!-- gen:meta.generated_at -->2026-10-16T01:41:10.888Z<!-- /gen --> |
| Owners | R4 (AI security) and R2 (contracts), per plan section 17 |
| Companion documents | `docs/THREAT_MODEL.md`, `docs/PIA.md`, `docs/INCIDENT_RESPONSE.md`, `docs/COMPLIANCE_MATRIX.md`, `docs/SECURITY_REVIEW.md` |

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
| `apps/agent` tier function | The AI signal type is an enum `{none, confirm, ask}`; final tier = maximum of `det(a)` and the AI tier in the order T1 < T2 < T?; T3 and T4 are outside the AI type by construction. Property test: <!-- gen:tests.monotonic.status -->passing: 2 property tests, exhaustive 72 cases and 5,000 random escalation chains (apps/agent/test/tiers.test.ts)<!-- /gen --> |
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

Message kinds allowed at the assessed commit: <!-- gen:guard.allowlist.count -->7<!-- /gen --> (printed from the allowlist, never typed).

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
| C-IN-02 | Deterministic deployment: own CREATE2 factory from a fresh deployer at nonce 0; solc 0.8.23, `evm_version = london`, `bytecode_hash = "none"`, `cbor_metadata = false` [V, `contracts/foundry.toml`]; deployer keeps no admin role (result: <!-- gen:deploy.deployer_roles -->4 roles still held by the deployer key `0x5C470480380dC2014898345aC6226c67cbF5E407` on FISCO BCOS: ProductRegistry.admin(), TestHKD.minter(), TestUSD.minter(), ZKVerifierRouter.registrar() (scan of 46 contracts, 461 getter calls, block 467); Base Sepolia not deployed<!-- /gen -->) | Deployment scripts, `deployments/*/v2.json` | Post-deploy role scan | CI |
| C-IN-03 | Signed enforcer table (addresses + code hashes); its hash sits in the passport; `yinglong verify` compares `extcodehash` on both ledgers | `packages/mandate`, `tools/verify-py`, `YinglongPassportRegistry` | Bytecode equality: <!-- gen:bytecode.equal -->13<!-- /gen --> of <!-- gen:bytecode.total -->13<!-- /gen --> enforcers | CI |
| C-IN-04 | Account initialisation: HybridDeleGator with owner `address(0)` and two passkeys (phone + laptop), deployed in the first sponsored user operation; passkey RP ID fixed to `yinglong-agent.tech` | `apps/web` onboarding, framework HybridDeleGator | Onboarding e2e test | — |
| C-IN-05 | FISCO initialisation: standard (non-SM) build only (an SM build replaces KECCAK256 with SM3 and breaks every EIP-712 check [S, secondary source]); chain ID 0 ledger profile; YINGLONG domains add a salt; feature flags verified on the chain | `contracts-fisco/`, `infra/` | Ledger-profile golden tests | — |
| C-IN-06 | Mandate compilation: `AllowedTargets` + `AllowedMethods` first; allowlist and forbidden set asserted disjoint; `ValueLte(0)`, `GlobalPauseEnforcer` and `MandateBindingEnforcer` always present; the root delegate is never `ANY_DELEGATE` | `packages/mandate` compiler | Compiler property tests | S-PRIV |
| C-IN-07 | Round-trip verification: caveat array published in `MandateRegistry`; delegation hash recomputed; enforcer code hashes checked; terms decoded back to sentences; two independent implementations (TypeScript, Python) agree on <!-- gen:verify.golden.n -->2<!-- /gen --> golden files and <!-- gen:verify.property.n -->67<!-- /gen --> property cases | `packages/mandate`, `tools/verify-py` | Golden and property tests | — |
| C-IN-08 | Input normaliser: homoglyphs, bidi controls, invisible characters; PII scrubber (mainland mobile numbers, 18-digit ID numbers, UnionPay card numbers, private keys, seed phrases) | `apps/agent` normaliser | Scrubber recall on a labelled set: <!-- gen:pia.scrubber.recall -->57/75 = 76.0% (Wilson 95% interval 65.2% to 84.2%, n = 75) on a labelled synthetic set; by kind: mainland-mobile 12/20, mainland-id 12/12, unionpay-card 16/16, private-key 8/12, seed-phrase 9/15; formats missed: mainland-mobile 3-4-4 with spaces; mainland-mobile 3-4-4 with dashes; private-key 64 hex without 0x; seed-phrase 12 words, no keyword; seed-phrase 12 numbered words; false positives on 3 of 10 benign strings (transaction hash (0x + 64 hex); ordinary sentence starting with 'recovery') (apps/agent/test/scrubber.test.ts)<!-- /gen --> | `direct_injection` |
| C-IN-09 | Injection sentinel M1; escalates only | ML serving | Bench per family; FNR <!-- gen:sentinel.fnr -->3/36 = 8.3% (Wilson 95% interval 2.9% to 21.8%) on the held-out bench family, offline evaluation of `ABRUBAB/yl-sentinel-mmbert-base@1062546` at its validation-selected threshold 0.2 (ml/results/m1_sentinel_mmbert.json); not deployed: the live agent reports no sentinel URL configured<!-- /gen --> | `direct_injection`, `multilingual`, TXT, `memory_implant` |
| C-IN-10 | Quarantine: readers return a closed schema of enums, numbers, verified IDs and opaque handles, each a `Tagged<T>` with source, reader model hash and taint; a snapshot test proves no quarantined bytes reach any planner prompt | `apps/agent`, `packages/provenance` | Snapshot test | TXT, `visual_injection` |
| C-IN-11 | `PayeeBook` enum: the intent's recipient is a `PayeeBook` id or `NEW_PAYEE_REQUEST`; the model cannot emit an address; a new payee is always a T3 request | `packages/mandate` intent schema | Schema tests | TXT, `lookalike_address` |
| C-IN-12 | Two-reader agreement on tainted financial fields (amount, payee), including the vision reader; readers of different model families; disagreement → T? | `apps/agent` readers | Bench | `visual_injection` |
| C-IN-13 | Untrusted protocol input: x402 `description`, A2A card fields, token names, invoice memos are untrusted; A2A cards canonicalised (RFC 8785) and JWS ES256-signed; `kid` and JWKS hash in the passport | `apps/agent`, `apps/services`, `YinglongPassportRegistry` | Card-verification tests | TXT, S-ID, S-X402 |
| C-IN-14 | Supply chain: pinned lockfiles, `--ignore-scripts`, SBOM (hash <!-- gen:sbom.sha256 -->`d6d821e342553d4759bdc989f3d9e645fa04dc28ace2ae0b57090feb0b88fddd` (docs/evidence/sbom.cdx.json, 332 components; pnpm 12.11.2 sbom (CycloneDX 1.6) + uv 0.12.19 (bea138450 2026-09-24 x86_64-pc-windows-msvc) export (CycloneDX 1.5))<!-- /gen -->), framework submodule pinned at v1.3.0 [V, repo], no third-party skills or MCP servers in the signing path, CI rules gate for Chinese characters, AI attribution and secrets [V, `scripts/check-rules.mjs`] | CI, `scripts/` | CI jobs | CI |
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
| C-MD-06 | Monotonic-safety rule (section 2.2) | `apps/agent` tier function | <!-- gen:tests.monotonic.status -->passing: 2 property tests, exhaustive 72 cases and 5,000 random escalation chains (apps/agent/test/tiers.test.ts)<!-- /gen --> | All |
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
| C-ID-15 | Invariants 1 to 10 under fuzzing; invariants 1 to 5 under bounded symbolic execution | `contracts/test`, proof directory | <!-- gen:invariants.passing -->5/10 (invariants 1, 2, 3, 4, 5 held in one Foundry stateful-fuzz campaign of 128 runs x 64 calls; 5 of the 10 have no fuzz campaign; source: forge test in this finalize run)<!-- /gen --> invariants pass; symbolic: <!-- gen:proofs.symbolic.status -->6 of 6 properties proved within bounds for invariants 1, 2, 3, 4, 5 (halmos 0.3.3, loops unrolled to 4, solver timeout 300 s; enforcer hooks executed symbolically, the DelegationManager and the account are not; Kontrol not run)<!-- /gen --> | All |
| C-ID-16 | Reentrancy bounded, not absent: allowlisted targets, `nonReentrant` on every YINGLONG-authored target, stateful enforcers update before execution, Slither detectors, a malicious ERC-777-style token test | Contracts, CI | Static analysis: <!-- gen:static.slither.high -->0 (raw high 0; Slither 0.11.6, 102 detectors over contracts/src)<!-- /gen --> high open | S-PRIV |
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

The "Fuzz" and "Symbolic" columns are the plan; per-invariant results are generated: <!-- gen:invariants.table -->Foundry campaign 128 runs x 64 calls; symbolic results from contracts/reports/symbolic.json:

| # | Foundry invariant fuzzing | Halmos (bounded) | Medusa | Echidna | Kontrol |
|---|---|---|---|---|---|
| 1 | held (`invariant_categoryCapsHold`) | 1 of 1 properties proved within bounds (halmos 0.3.3, loop 4) | not run | not run | not run |
| 2 | held (`invariant_reserveFloorHolds`) | 2 of 2 properties proved within bounds (halmos 0.3.3, loop 4) | not run | not run | not run |
| 3 | held (`invariant_noMovementWhilePaused`) | 1 of 1 properties proved within bounds (halmos 0.3.3, loop 4) | not run | not run | not run |
| 4 | held (`invariant_onlyVerifiedPayees`) | 1 of 1 properties proved within bounds (halmos 0.3.3, loop 4) | not run | not run | not run |
| 5 | held (`invariant_authorityUnchanged`) | 1 of 1 properties proved within bounds (halmos 0.3.3, loop 4) | not run | not run | not run |
| 6 | no campaign | not run | not run | not run | not run |
| 7 | no campaign | not run | not run | not run | not run |
| 8 | no campaign; 3 unit tests `*invariant8*` pass | not run | not run | not run | not run |
| 9 | no campaign | not run | not run | not run | not run |
| 10 | no campaign | not run | not run | not run | not run |
<!-- /gen -->

---

## 6. BFIA area 4: Data security and privacy protection

Full analysis: `docs/PIA.md`.

| ID | Control | Implemented by | Verified by |
|---|---|---|---|
| C-DP-01 | On-chain minimisation: only addresses, hashes, Merkle roots and caveat terms go on chain; no names, no free text, no document content | Schemas in `packages/mandate`, contracts | Schema review |
| C-DP-02 | PII scrubber before any third-party model API call (KR-14) | `apps/agent` normaliser | Recall <!-- gen:pia.scrubber.recall -->57/75 = 76.0% (Wilson 95% interval 65.2% to 84.2%, n = 75) on a labelled synthetic set; by kind: mainland-mobile 12/20, mainland-id 12/12, unionpay-card 16/16, private-key 8/12, seed-phrase 9/15; formats missed: mainland-mobile 3-4-4 with spaces; mainland-mobile 3-4-4 with dashes; private-key 64 hex without 0x; seed-phrase 12 words, no keyword; seed-phrase 12 numbered words; false positives on 3 of 10 benign strings (transaction hash (0x + 64 hex); ordinary sentence starting with 'recovery') (apps/agent/test/scrubber.test.ts)<!-- /gen --> |
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
| C-RC-01 | Kill switch: `trip()` (guardian, breaker watcher); `tripWithSig(account, nonce, deadline, sig)` verified through the account's ERC-1271 and relayable by anyone (no bundler); `untripWithSig` owner only; `supervisorPause(agentId)` pause only; dead-man timer; `GlobalPauseEnforcer` in every delegation | `KillSwitchRegistry`, `GlobalPauseEnforcer` | Time-to-pause p50 <!-- gen:time.pause.p50 -->0.222<!-- /gen --> s (n = <!-- gen:time.pause.n -->7<!-- /gen -->, <!-- gen:time.ledger -->FISCO BCOS (team-run consortium ledger)<!-- /gen -->) |
| C-RC-02 | Breaker: a reverted transaction writes nothing, so the breaker trips off-chain: policy and signer refusals call `trip()`; on-chain reverts are recovered by `eth_call` replay at the parent block | `apps/indexer` breaker watcher | Beat 8 evidence |
| C-RC-03 | Revocation: `MandateRegistry.revoke`/`supersede` plus `disableDelegation` in one user operation sent by our relayer straight to `EntryPoint.handleOps`; atomic `supersede` | `MandateRegistry`, relayer | Time-to-revoke p50 <!-- gen:time.revoke.p50 -->0.213<!-- /gen --> s |
| C-RC-04 | Rotation: new agent key, `setAgentWallet` signed by the new key, mandate re-sealed | Signer, `YinglongPassportRegistry` | Time-to-rotate p50 <!-- gen:time.rotate.p50 -->0.747 s to re-seal the mandate with the same agent key (n = 5, measured at the drill client; no agent-key rotation is drilled)<!-- /gen --> |
| C-RC-05 | Exposure bound: "max funds at risk now" = remaining period caps, read on-chain and shown in the key-compromise drill | `apps/web`, enforcers | Bench max at risk <!-- gen:bench.max_at_risk -->not yet measured<!-- /gen --> |
| C-RC-06 | Budgets, reserve and velocity enforcers | Enforcers | Invariants 1, 2 |
| C-RC-07 | Suitability as code; first sweep into any product at T2 | `SuitabilityEnforcer`, policy | `UnsuitableProduct` revert (beat 10) |
| C-RC-08 | Jurisdiction as code: rail chosen by the mandate's profile; mainland rail is coin-free; a jurisdiction-forbidden rail cannot be enabled by any mandate | `JurisdictionEnforcer`, rail adapters | `RailNotPermitted` revert (beat 10) |
| C-RC-09 | Sanctions screening against a locally mirrored public list (OFAC SDN, UN) at the counterparty scale; deterministic; off-chain only | `apps/agent` counterparty verifier | Bench S-RAIL |
| C-RC-10 | Accountability ledger: EIP-712 receipts (SM2/SM3 co-signature on the mainland profile), hash chain, batched Merkle roots, two-way anchors FISCO ↔ Base, regulator node | `AccountabilityLedger`, anchoring relayer | Anchor transactions; `yinglong verify-tx` |
| C-RC-11 | Supervisory halt: FISCO DelegationManager owner is a 2-of-3 (KR-18) | FISCO deployment | Ownership read |
| C-RC-12 | Honest labels: test units, simulator and testnet labels on every surface; receipt `source` field (`live-base`, `live-fisco`, `anvil-bench`); vocabulary rules | `apps/web`, receipt schema | Review checklist |
| C-RC-13 | Incident response: five playbooks; playbook 1 rehearsed in beat 11 | `docs/INCIDENT_RESPONSE.md` | Drill record |
| C-RC-14 | Public attack endpoint controls (Judge's Challenge): guest mandates with tiny caps in team-minted `tHKD`, signed expiring QR tokens, per-QR daily quota, daily gas budget (<!-- gen:challenge.gas_budget -->118,393,600 gas per day on FISCO BCOS = 200 on-chain attack submissions per day (CHALLENGE_BYPASS_PER_DAY default in apps/agent/src/challenge.ts) x 591,968 gas, the largest measured guest attack (median 528,012, n = 2); gas price on the team-run chain is 0; plus 20 attempts per client IP per day<!-- /gen -->), moderation, shadow mode on an Anvil fork labelled "simulated, not on-chain" | `apps/services` | Quota tests |
| C-RC-15 | Non-custodial primary path; any agent-held fallback account is labelled custodial | Architecture | Review |
| C-RC-16 | Evidence integrity: numbers only from code; held-out family hash committed before training (<!-- gen:bench.heldout.sha256 -->`e23a3fcd99fc68f889884bc7cf2748ff665e9c3597a7ce2fc30b64586de0deea` (memory_implant, 36 items, bench/attacks/heldout.jsonl; recomputed at generation: matches)<!-- /gen -->); nightly re-verification of every evidence hash (21 to 31 Oct); `MANIFEST.sha256` | `scripts/finalize`, CI | Manifest |

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
| KR-06 | Sentinel false negatives | 1 | Layered scales; the chain is the backstop; measured FNR <!-- gen:sentinel.fnr -->3/36 = 8.3% (Wilson 95% interval 2.9% to 21.8%) on the held-out bench family, offline evaluation of `ABRUBAB/yl-sentinel-mmbert-base@1062546` at its validation-selected threshold 0.2 (ml/results/m1_sentinel_mmbert.json); not deployed: the live agent reports no sentinel URL configured<!-- /gen --> | Undetected injections can still cause within-mandate manipulation (KR-07) |
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

Columns: control ID, status (`tested`, `implemented`, `designed`, `not started`), test or evidence path. Implemented <!-- gen:controls.implemented -->66 (29 of them tested)<!-- /gen --> of <!-- gen:controls.total -->72<!-- /gen --> controls.

<!-- gen:controls.status_table -->Status derived at generation from docs/evidence/controls.json (paths checked for existence, tests against the most recent test run at 2026-10-16T01:31:28.020Z): tested 29, implemented 37, designed 6, not started 0.

| Control | Status | Evidence path | Tests | Note |
|---|---|---|---|---|
| C-IN-01 | implemented | `ml/serving/app.py`, `ml/serving/models.lock.json` | - | partial: the ML server refuses to start on a model-file hash mismatch; the agent runtime does not pin prompts, schemas, policy or the enforcer table |
| C-IN-02 | implemented | `contracts/foundry.toml`, `contracts/script/DeployYinglong.s.sol`, `contracts/src/utils/YinglongCreate2Deployer.sol` | - | deployer roles after setup: see deploy.deployer_roles |
| C-IN-03 | tested | `tools/verify-py/src/yinglong_verify`, `packages/mandate/src/roundtrip.ts`, `apps/agent/src/chain/passport.ts`, `contracts/deployments/fisco.json` | `tools/verify-py/tests/test_golden.py`: pass | the passport carries keccak256 of the deployment's contract table (apps/agent/src/chain/passport.ts); the table itself is not separately signed |
| C-IN-04 | tested | `packages/sdk/src/account.ts`, `apps/agent/src/visitors.ts`, `apps/web/lib/passkey/webauthn.ts` | `contracts/test/NadiaMandate.t.sol` /test_T2_ecdsaSignatureNeverSatisfiesPasskeyAccount/: pass; `apps/web/lib/passkey/passkey.test.ts`: pass | one passkey per account in this build; the account is deployed by the relayer, not in a sponsored user operation |
| C-IN-05 | tested | `infra/fisco/build-chain.sh`, `infra/fisco/chain-facts.json`, `contracts-fisco/reports/probe-2026-10-16.json`, `packages/sdk/src/ledgers.ts` | `tools/verify-py/tests/test_ts_vectors.py`: pass | the FISCO profile uses chain id 20200 |
| C-IN-06 | tested | `packages/mandate/src/compile.ts` | `packages/mandate/test/mandate.test.ts` /allowlists first/: pass |  |
| C-IN-07 | tested | `packages/mandate/src/roundtrip.ts`, `packages/mandate/src/decompile.ts`, `tools/verify-py/src/yinglong_verify/decompile.py`, `contracts/src/registries/MandateRegistry.sol` | `packages/mandate/test/mandate.test.ts` /round-trips/: pass; `tools/verify-py/tests/test_golden.py`: pass; `tools/verify-py/tests/test_ts_vectors.py`: pass; `contracts/test/NadiaMandate.t.sol` /test_publishedCaveatsRoundTrip/: pass |  |
| C-IN-08 | tested | `apps/agent/src/scales/normalise.ts` | `apps/agent/test/scrubber.test.ts`: pass | recall: pia.scrubber.recall |
| C-IN-09 | implemented | `apps/agent/src/scales/sentinel.ts`, `ml/sentinel/evaluate.py`, `ml/serving/app.py` | - | evaluated offline (ml/results); the live agent reports no sentinel URL configured |
| C-IN-10 | implemented | `packages/provenance/src/index.ts`, `apps/agent/src/scales/quarantine.ts` | - | the snapshot test named in the control does not exist |
| C-IN-11 | implemented | `apps/agent/src/understand/intent.ts`, `contracts/src/registries/PayeeBook.sol` | - |  |
| C-IN-12 | implemented | `apps/agent/src/scales/quarantine.ts` | - |  |
| C-IN-13 | tested | `apps/services/src/cards.ts`, `apps/services/src/jose.ts`, `apps/agent/src/scales/counterparty.ts` | `apps/services/test/x402.test.ts` /signed card/: pass |  |
| C-IN-14 | implemented | `pnpm-lock.yaml`, `scripts/check-rules.mjs`, `.github/workflows/ci.yml`, `docs/evidence/sbom.cdx.json` | - | pnpm runs only allow-listed build scripts (allowBuilds in pnpm-workspace.yaml) |
| C-IN-15 | implemented | `apps/agent/src/scales/quarantine.ts` | - | code review only |
| C-MD-01 | implemented | `apps/agent/src/understand/intent.ts`, `apps/agent/src/explain.ts` | - |  |
| C-MD-02 | implemented | `apps/agent/src/llm/provider.ts` | - |  |
| C-MD-03 | implemented | `apps/agent/src/pipeline.ts` | - | bench not run in this release |
| C-MD-04 | implemented | `apps/agent/src/scales/policy.ts` | - | differential fuzzing against the Solidity enforcers is not in the repository |
| C-MD-05 | implemented | `apps/agent/src/pipeline.ts` | - | partial: eth_call simulation of the redemption; no eth_simulateV1 asset diff |
| C-MD-06 | tested | `apps/agent/src/tiers.ts` | `apps/agent/test/tiers.test.ts`: pass |  |
| C-MD-07 | implemented | `ml/anomaly`, `ml/results/m3_anomaly.json`, `apps/agent/src/tiers.ts` | - |  |
| C-MD-08 | implemented | `apps/agent/src/explain.ts` | - |  |
| C-MD-09 | implemented | `apps/agent/src/receipts.ts`, `apps/web/components/data/receipt-certificate.tsx` | - |  |
| C-MD-10 | implemented | `apps/agent/src/receipts.ts`, `apps/agent/src/chain/passport.ts` | - |  |
| C-MD-11 | designed | - | - | no content-safety model in this build |
| C-MD-12 | designed | - | - | the agent keeps no memory in this build |
| C-MD-13 | implemented | `apps/agent/src` | - | by absence: no eval, interpreter or shell in apps/agent; no MCP server in this build |
| C-MD-14 | designed | - | - | plans are linear step lists, not a typed DAG with preconditions |
| C-ID-01 | tested | `contracts/src/registries/YinglongPassportRegistry.sol`, `apps/agent/src/chain/passport.ts` | `contracts/test/NadiaMandate.t.sol` /test_T4_lineageViolation_unregisteredRedeemer/: pass |  |
| C-ID-02 | implemented | `contracts/src/registries/YinglongPassportRegistry.sol`, `apps/agent/data/e2e-fisco.json` | - |  |
| C-ID-03 | tested | `contracts/src/enforcers/VerifiedPayeeEnforcer.sol`, `contracts/src/enforcers/ReputationGateEnforcer.sol` | `contracts/test/NadiaMandate.t.sol` /test_T4_payeeNotVerified_mirage/: pass | ReputationGateEnforcer has no test |
| C-ID-04 | tested | `contracts/src/enforcers/AgentLineageEnforcer.sol` | `contracts/test/NadiaMandate.t.sol` /test_T4_lineageViolation_unregisteredRedeemer/: pass |  |
| C-ID-05 | tested | `packages/sdk/src/account.ts`, `apps/web/lib/passkey/webauthn.ts` | `apps/web/lib/passkey/passkey.test.ts`: pass; `contracts/test/NadiaMandate.t.sol` /test_T2_ecdsaSignatureNeverSatisfiesPasskeyAccount/: pass |  |
| C-ID-06 | tested | `contracts/src/enforcers/CoSignEnforcer.sol` | `contracts/test/NadiaMandate.t.sol` /test_T2_coSign/: pass |  |
| C-ID-07 | tested | `apps/web/app/approve/[id]/page.tsx`, `apps/web/components/approve/approve-card.tsx`, `apps/web/lib/chain.ts` | `apps/web/lib/api/contract.test.ts` /own decoding/: pass; `apps/web/tests/flows.spec.ts` /approve/: pass | no e2e test with a lying runtime |
| C-ID-08 | tested | `apps/web/lib/signing-guard.ts`, `apps/signer/src/guard.ts` | `apps/web/lib/api/contract.test.ts` /signing-domain guard/: pass |  |
| C-ID-09 | implemented | `apps/signer/src/guard.ts`, `apps/signer/src/child.ts`, `apps/signer/src/server.ts` | - | apps/signer has no tests |
| C-ID-10 | tested | `contracts/src/enforcers/ForbiddenTargetsEnforcer.sol`, `packages/mandate/src/compile.ts` | `contracts/test/NadiaMandate.t.sol` /test_T4_selfCallToAccountIsForbidden/: pass; `contracts/test/invariants/MandateInvariants.t.sol`: pass |  |
| C-ID-11 | implemented | `contracts/src/enforcers/VetoTimelockEnforcer.sol` | - | VetoTimelockEnforcer has no test |
| C-ID-12 | tested | `contracts/src/enforcers/MandateBindingEnforcer.sol`, `contracts/src/registries/MandateRegistry.sol` | `contracts/test/NadiaMandate.t.sol` /test_T4_mandateNotPublishedIsUnbound\|test_revokedMandateMovesNothing\|test_resealNeverResetsBudgets/: pass |  |
| C-ID-13 | implemented | `contracts/src/libraries/PaymentDecoder.sol` | - | exercised through the enforcer tests; no dedicated decoder test |
| C-ID-14 | implemented | `contracts/src/enforcers/YinglongEnforcer.sol` | - | review checklist |
| C-ID-15 | tested | `contracts/test/invariants/MandateInvariants.t.sol`, `contracts/reports/symbolic.json` | `contracts/test/invariants/MandateInvariants.t.sol`: pass | invariants 1 to 5 under fuzzing and bounded symbolic execution; 6 to 10 not in a fuzz campaign |
| C-ID-16 | implemented | `contracts/src/rails/ProtectedPayment.sol`, `contracts/reports/slither.json` | - | no malicious ERC-777-style token test |
| C-ID-17 | tested | `contracts/src/enforcers/CategoryBudgetEnforcer.sol` | `contracts/test/NadiaMandate.t.sol` /test_resealNeverResetsBudgets/: pass | partial: sub-agent chains are not compiled in this build (invariant 6 untested) |
| C-DP-01 | implemented | `packages/mandate/src/schema.ts`, `contracts/src/registries/AccountabilityLedger.sol` | - |  |
| C-DP-02 | tested | `apps/agent/src/scales/normalise.ts`, `apps/agent/src/pipeline.ts` | `apps/agent/test/scrubber.test.ts`: pass |  |
| C-DP-03 | implemented | `apps/agent/src/llm/provider.ts` | - | provider configuration only; no config test |
| C-DP-04 | implemented | `ml/THIRD_PARTY.md`, `bench/MANIFEST.json`, `docs/third_party.md` | - |  |
| C-DP-05 | implemented | `ml/common/keys.py`, `packages/sdk/src/server.ts`, `.gitignore`, `scripts/check-rules.mjs`, `.github/workflows/ci.yml` | - |  |
| C-DP-06 | tested | `apps/web/next.config.ts` | `apps/web/tests/network.spec.ts`: pass | no DOMPurify in this build |
| C-DP-07 | designed | - | - | the challenge exists (apps/agent/src/challenge.ts); no retention job or consent record |
| C-DP-08 | designed | - | - | no study tool in this build |
| C-DP-09 | implemented | `apps/agent/src/receipts.ts`, `apps/indexer/src/receipts.ts`, `infra/fisco/backup.sh` | - | full records are JSON files, not Postgres; no restore test |
| C-DP-10 | implemented | `docs/PIA.md`, `apps/web/components/console/console.tsx` | - |  |
| C-RC-01 | tested | `contracts/src/registries/KillSwitchRegistry.sol`, `contracts/src/enforcers/GlobalPauseEnforcer.sol` | `contracts/test/NadiaMandate.t.sol` /test_pause_\|test_supervisorHaltsAgentIdentity/: pass; `contracts/test/invariants/MandateInvariants.t.sol`: pass |  |
| C-RC-02 | implemented | `apps/indexer/src/breaker.ts`, `apps/agent/src/pipeline.ts` | - |  |
| C-RC-03 | tested | `contracts/src/registries/MandateRegistry.sol`, `apps/agent/src/pipeline.ts`, `docs/evidence/drills/timing-fisco.json` | `contracts/test/NadiaMandate.t.sol` /test_revokedMandateMovesNothing/: pass |  |
| C-RC-04 | tested | `contracts/src/registries/YinglongPassportRegistry.sol` | `contracts/test/NadiaMandate.t.sol` /test_drill_leakedAgentKeyIsBoundedByCaveats/: pass | rotation (setAgentWallet) is exercised in the Foundry drill; no route rotates the agent key on the live system |
| C-RC-05 | tested | `apps/web/components/console/authority-panel.tsx`, `docs/evidence/drills/pb1.json` | `contracts/test/NadiaMandate.t.sol` /test_drill_leakedAgentKeyIsBoundedByCaveats/: pass |  |
| C-RC-06 | tested | `contracts/src/enforcers/CategoryBudgetEnforcer.sol`, `contracts/src/enforcers/ReserveFloorEnforcer.sol`, `contracts/src/enforcers/VelocityEnforcer.sol` | `contracts/test/NadiaMandate.t.sol` /test_T4_categoryBudgetExceeded_food\|test_T4_reserveFloorBreached\|test_T4_velocityExceeded_splitPayments/: pass; `contracts/test/invariants/MandateInvariants.t.sol`: pass |  |
| C-RC-07 | tested | `contracts/src/enforcers/SuitabilityEnforcer.sol` | `contracts/test/NadiaMandate.t.sol` /test_T4_unsuitableProduct/: pass |  |
| C-RC-08 | tested | `contracts/src/enforcers/JurisdictionEnforcer.sol` | `contracts/test/NadiaMandate.t.sol` /test_T4_railNotPermitted/: pass |  |
| C-RC-09 | implemented | `apps/agent/src/scales/counterparty.ts` | - |  |
| C-RC-10 | tested | `contracts/src/registries/AccountabilityLedger.sol`, `apps/indexer/src/anchoring.ts` | `apps/indexer/test/indexer.test.ts` /anchor/: pass | anchored on FISCO BCOS only until Base Sepolia is deployed; no SM2/SM3 co-signature |
| C-RC-11 | designed | - | - | the 2-of-3 owner is not implemented; see deploy.deployer_roles for the DelegationManager owner |
| C-RC-12 | implemented | `apps/agent/src/receipts.ts` | - |  |
| C-RC-13 | implemented | `docs/INCIDENT_RESPONSE.md`, `apps/agent/scripts/ir-drill.ts`, `docs/evidence/drills/pb1.json` | - | playbook 1 drilled on the live ledger; playbooks 2 to 5 not drilled |
| C-RC-14 | implemented | `apps/agent/src/challenge.ts` | - | partial: per-IP daily quota and a daily bypass budget in code; no signed QR tokens, moderation or quota tests |
| C-RC-15 | implemented | `packages/sdk/src/account.ts` | - |  |
| C-RC-16 | implemented | `apps/agent/scripts/finalize.ts`, `bench/HELDOUT_SHA256.txt`, `docs/evidence/bundle.json` | - | no nightly re-verification job or MANIFEST.sha256 in this build |
<!-- /gen -->

---

## 12. Evidence index

| Evidence | Location |
|---|---|
| Automated tests | <!-- gen:tests.total -->332<!-- /gen --> passing, <!-- gen:tests.failed -->3 (pytest tools/verify-py: 3)<!-- /gen --> failing (contracts <!-- gen:tests.contracts -->93<!-- /gen -->, TypeScript <!-- gen:tests.ts -->75<!-- /gen -->, Python <!-- gen:tests.py -->105<!-- /gen -->, end-to-end <!-- gen:tests.e2e -->47<!-- /gen -->) |
| Bytecode equality table | <!-- gen:bytecode.table -->Local Anvil (bench) vs FISCO BCOS 3.17.1 (consortium ledger); Anvil hashes as recorded at deployment; FISCO BCOS hashes re-read live (keccak256 of eth_getCode) at generation and equal to the deployment file:

| Enforcer | Local Anvil (bench) address | FISCO BCOS 3.17.1 (consortium ledger) address | Code hash | Equal |
|---|---|---|---|---|
| `AgentLineageEnforcer` | `0x7D1bb83c30816847CD7ef4436c9a2492468A2125` | `0x2ee94183aD4cE72aee14F83bD15033A698AdBF0C` | `0xd3807e7a283bf4bdb905f47da33c382a590ca158a9d1807cba34d577d879303e` | yes |
| `CategoryBudgetEnforcer` | `0x8Bd87Eeca3FB1011421a2B8A3445426a23BedC85` | `0x0FBA56325B5c59F0E5cF589D25bFe6818850ae97` | `0xe2b29ed37b400d5763f4a06b45a77fd1f356dfa56a0fa0c1b7c606b8eb1e1072` | yes |
| `CoSignEnforcer` | `0xCD901317f70459f4bCc8FAE0d0d4503bb9D53629` | `0x8b143D8a816F309C7426E620E4540F686b12A853` | `0xcac545a2bef4f4427b42e53eee1718c36d9688233a0d4870663c43aaddf7ab85` | yes |
| `ForbiddenTargetsEnforcer` | `0xf936387f3aA038fEd260a0F701A7209961a47b68` | `0x7ac856d4257CC0a9A3be8606912e9853b84a97c8` | `0x9011c8455ef546ba751012ceea833382cd55958125c921824d8e1c12fd7157e0` | yes |
| `GlobalPauseEnforcer` | `0xC313B762639e6492549F55D2fD1B5079fcCD65b6` | `0x66E0dF12E1F2bFC6ed96903c4383973F5386A784` | `0x146eab35ecd379b884ee3a8738fd137642123c313714ae50409b2d4b882ab9d6` | yes |
| `JurisdictionEnforcer` | `0xA77e5C328A29b29dB6df21d0C479E0B01A53e558` | `0x6AfAd65A0cF138f52C4E00b07A96B59e77E0c21E` | `0x3c18ad73f732e746093718eea6520b80e311063f7adc6114397c6fb4cd46154c` | yes |
| `MandateBindingEnforcer` | `0xCe848804Adb705b3B4709e048a3Ab101770fa642` | `0xF86370F739e571a0F4Afb432e1C12bE6A76fC05b` | `0x20d077292dac232c197e3b90a67f780ed88cb3db7d55c6fe29897c1603ceec7d` | yes |
| `ReputationGateEnforcer` | `0xe9909B519f9F5963422C1650a88A738777d0EAaF` | `0x4681E89F8f61f0a1c78D9a8a0df2b1dBd29CB07C` | `0xeee353be492a0ceda0ac5caa86293b8c7e8b0049d126cafc27c7a7d1072c7466` | yes |
| `ReserveFloorEnforcer` | `0xDb48F57DEF3B0faeb4D790479EED2D8eb43755E7` | `0x3A50F926300c42b8304711Bdc8eb35dF4fB56617` | `0x5d7aef15a922b63649f6315524ea063b7f340c5884da95919f37a7224d6c826c` | yes |
| `SuitabilityEnforcer` | `0x2226D5508f5c6D3A24cD15Be35d4F5Df43583846` | `0x5f5d5A8f0e740f52BC1Ce2CeB4B554EbE0f091c8` | `0x38732451a588e925d2cda59c0618647586cd0fa41d154f6a357edbde6e9df333` | yes |
| `VelocityEnforcer` | `0xAfC2bC04bB16DBc42d04c6b4BD99675b163ef2a8` | `0x659458ca15dcd1AC7493513a37fD36063642f8E6` | `0x57816b708ba6b0414e9f2f2430f40bc241ea2fccf7c449a6be10fe253816a707` | yes |
| `VerifiedPayeeEnforcer` | `0x565f3eC5983a67a6d207709F6BCf88105e37257E` | `0xaBc4B99D759A06781BAFB096c65c2dB30beb073c` | `0x96dcfc1e152bd1ca0e9397ddd9618f573ef9eee83e34ce550a322660c23b004d` | yes |
| `VetoTimelockEnforcer` | `0xf3792671423A1ef50a45c7d68F86768F0AA040F3` | `0xFae68Be7B69B1dF2d09Ec1258dbb6f2A620AB58B` | `0xdf2c8aa906f46a6648de08e53fd51da93f7d8318156c5ae3bd6279badec69941` | yes |
<!-- /gen --> |
| On-chain execution evidence | `docs/EXECUTION_EVIDENCE.md`, `docs/evidence/bundle.json` |
| Bench report | `bench/` reports; per-family table in `docs/THREAT_MODEL.md` |
| Security review | `docs/SECURITY_REVIEW.md` |
