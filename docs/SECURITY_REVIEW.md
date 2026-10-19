# YINGLONG Internal Security Review

> **Internal review by the YINGLONG team; no third-party audit has been performed.**

**Summary (5 lines)**
1. This is a self-review in audit format by the people who wrote the code; it is not independent and it is not an audit.
2. Scope: YINGLONG's own contracts, the agent signer and signing-domain guard, the policy mirror, the mandate compiler and both verifiers; the MetaMask Delegation Framework is out of scope (its own audit reports ship with it).
3. Method: manual review against a fixed checklist, static analysis, fuzzing and invariant campaigns, bounded symbolic execution, differential testing of the policy mirror against the contracts, and a threat-model walkthrough.
4. Findings by severity: <!-- gen:review.count.critical -->0<!-- /gen --> critical, <!-- gen:review.count.high -->0<!-- /gen --> high, <!-- gen:review.count.medium -->2<!-- /gen --> medium, <!-- gen:review.count.low -->4<!-- /gen --> low, <!-- gen:review.count.info -->2<!-- /gen --> informational; <!-- gen:review.fixed -->5 (YR-01 in `4d402b6`, YR-02 in `4d402b6`, YR-03 in `30ee250`, YR-04 in `a706b92`, YR-07 in `a706b92`)<!-- /gen --> fixed, <!-- gen:review.open -->0<!-- /gen --> open, <!-- gen:review.wontfix -->3<!-- /gen --> accepted.
5. Section 7 lists the issues we chose not to fix and why; known risks KR-01 to KR-19 are in `docs/SECURITY_SELF_ASSESSMENT.md`.


| Field | Value |
|---|---|
| Commit reviewed | <!-- gen:review.commit -->a706b92<!-- /gen --> |
| Review completed | <!-- gen:review.date -->2026-10-17<!-- /gen --> |
| Release | <!-- gen:meta.release_tag -->7ff0e17<!-- /gen --> |
| Reviewers | YINGLONG team members (roles R2 contracts, R4 AI security; read-only reviewer sessions at the planned review gate) |
| Tool versions used | <!-- gen:review.tools.versions -->forge 1.8.5; slither 0.11.6; aderyn 0.6.8; halmos 0.3.3<!-- /gen --> |

---

## 1. Scope

| In scope | Path |
|---|---|
| Custom caveat enforcers and `PaymentDecoder` | `contracts/src/enforcers/` *(planned)*, `contracts/src/libraries/` |
| Registries: `MandateRegistry`, `PayeeBook`, `KillSwitchRegistry`, `YinglongPassportRegistry`, `AccountabilityLedger`, `ValidationRegistry` | `contracts/src/` *(planned)* |
| Rails and scenario contracts: `ProtectedPayment`, `SignedQuoteSettlement`, `ProductRegistry`, `TestMoneyMarketFund`, `TestHKD`, `ConditionalPaymentInstructions`, `CrossAnchor`, `YinglongCreate2Deployer` | `contracts/src/` *(planned)* |
| Noir circuits and generated verifiers | `circuits/` *(planned)* |
| Agent signer vault and signing-domain guard | `apps/signer` *(planned)* |
| Approval page | `apps/web` `/approve/[id]` *(planned)* |
| Policy mirror and tier function | `apps/agent` *(planned)* |
| Relayer and breaker watcher | `apps/indexer` *(planned)* |
| Mandate compiler, decompiler, Hash Ring | `packages/mandate` *(planned)* |
| Python verifier | `tools/verify-py` *(planned)* |

| Out of scope | Reason |
|---|---|
| MetaMask Delegation Framework v1.3.0 (DelegationManager, DeleGators, stock enforcers) | Pinned third-party code with its own audit reports in `contracts/lib/delegation-framework/audits/` |
| ERC-8004 reference registries, USDC, EntryPoint, paymasters | Third-party deployments |
| FISCO BCOS node software, Base | Platform |
| Model quality | Measured in the bench report |
| Front-end visual layer | Covered by end-to-end and accessibility tests, not this review |

## 2. Methodology

| Technique | What it covers | Tool (version pinned in plan Appendix A) |
|---|---|---|
| Manual review | Checklist in section 3 for every enforcer and registry; signer and guard code paths | — |
| Static analysis | Reentrancy, access control, unchecked calls, shadowing | Slither 0.11.6, Aderyn 0.6.8 |
| Unit and fuzz tests | Every typed error reachable; boundaries; malformed `args` and calldata | Foundry v1.8.5 |
| Invariant campaigns | Invariants 1 to 10 with the fuzzer playing agent, attacker, user and time | Foundry, Medusa v1.5.1, Echidna v2.3.3 |
| Symbolic execution | Invariants 1 to 5, bounded: our enforcers against the framework DelegationManager; not a full-system proof | Halmos v0.3.3, Kontrol v1.0.255 |
| Differential testing | TypeScript policy mirror vs Solidity enforcers on shared vectors with time and block warps | vitest + Foundry |
| Round-trip tests | Compiler → chain → decompiler, two implementations, both ledger profiles | Golden and property tests |
| Threat-model walkthrough | Every leaf in `docs/THREAT_MODEL.md` section 4 traced to a control and a test | — |
| Bench cross-check | Every bench attack that reached the chain re-checked for its typed revert | Bench runner |

## 3. Review checklist (applied to every custom enforcer)

| # | Check |
|---|---|
| 1 | Default execution mode enforced; other call types revert |
| 2 | `terms` decoded with exact length checks; malformed terms revert `InvalidTerms` |
| 3 | `args` treated as untrusted: length validated; used only for on-chain-verified data or logging |
| 4 | Payment read from calldata through `PaymentDecoder`; native value and unknown shapes revert |
| 5 | State keyed by `msg.sender` (the DelegationManager) and the delegation hash or delegator; no cross-delegation interference |
| 6 | State written in `beforeHook` when the check depends on it; nothing relies on state written by a reverted execution |
| 7 | No external call to untrusted code; read-only calls checked for success and return length |
| 8 | No chain-specific immutables (identical bytecode, DC-01) |
| 9 | No admin role, no upgradeability, no owner after deployment |
| 10 | Typed error from `Errors.sol` on every refusal |
| 11 | Gas overhead measured against stock enforcers |
| 12 | Behaviour identical under the Base (seconds, chain ID 84532) and FISCO (chain ID 0) ledger profiles |

## 4. Severity definitions

| Severity | Definition for YINGLONG |
|---|---|
| Critical | Value can move outside a sealed mandate; a T3 function is reachable through a delegation; the passkey can be made to sign outside the allowlist; pause can be bypassed |
| High | In-mandate limits (caps, velocity, reserve, payee gate) can be exceeded; replay of an approval, proof or delegation; pause or revoke can be blocked by a third party we control |
| Medium | Evidence can be falsified or suppressed undetectably; an AI signal can lower a tier; denial of service of pause, revoke or anchoring |
| Low | Defence-in-depth gaps with no direct loss path; misleading labels |
| Informational | Code quality, gas, documentation |

## 5. Findings

<!-- gen:review.findings.table -->

| ID | Title | Severity | Component | Status | Fix commit |
|---|---|---|---|---|---|
| YR-01 | Starting a sign-up with an existing account's public key reset that account | medium | apps/agent visitors (registerVisitor) | fixed | `4d402b6` |
| YR-02 | Login challenge did not bind the issue time and chain id it handed out | low | apps/agent visitors (loginChallenge, loginVisitor) | fixed | `4d402b6` |
| YR-03 | A co-sign approval was created for a payment the ledger refuses for another reason | low | apps/agent pipeline (ask) | fixed | `30ee250` |
| YR-04 | The web signing guard allows a user operation without decoding its calls | medium | apps/web lib/signing-guard.ts | fixed | `a706b92` |
| YR-05 | MandateRegistry.canExecute reports no live mandate after the newer of two live mandates is revoked | low | contracts MandateRegistry | wontfix | - |
| YR-06 | ProductRegistry.allProducts lists a product twice after delist and relist | low | contracts ProductRegistry | wontfix | - |
| YR-07 | Logging in on a second device ends the first device's session | info | apps/agent visitors (loginVisitor) | fixed | `a706b92` |
| YR-08 | Login challenges and sign-ups in progress are kept in memory | info | apps/agent visitors | wontfix | - |
<!-- /gen -->

Columns: ID, title, severity, component, status (fixed, acknowledged, open), fix commit.

## 6. Finding details

<!-- gen:review.findings.details -->
**YR-01. Starting a sign-up with an existing account's public key reset that account** (medium, fixed)

- Description: POST /v1/visitors overwrote the stored visitor record (new session token, sealed flag cleared) before any signature proved control of the key. The passkey public key and the secret-key owner address are public, so anyone could start such a sign-up.
- Impact: Denial of service: the real owner's session stopped working and log in again refused the account until it sealed again. No funds or authority could be taken: sealing still needs the key.
- Recommendation: Keep a sealed account's record and session unchanged until the new seal verifies on the account itself.
- Resolution: The pending sign-up now holds its own record and token; the stored record is replaced only after the seal verifies (ERC-1271 on the account). apps/agent/scripts/visitor-key-e2e.mts re-registers an address as a stranger would and still logs in and pays.

**YR-02. Login challenge did not bind the issue time and chain id it handed out** (low, fixed)

- Description: Only the nonce and its expiry were stored; the signed message was rebuilt from the issue time sent back by the client and the chain id of the account's ledger.
- Impact: Low: the nonce was already single-use and expired after 5 minutes, so replay was not possible; the message a user signed could differ from the one issued.
- Recommendation: Store the issue time and chain id with the nonce and rebuild the message from the stored values.
- Resolution: Challenges store {expires, issuedAt, chainId}; a mismatching issue time or ledger is refused.

**YR-03. A co-sign approval was created for a payment the ledger refuses for another reason** (low, fixed)

- Description: When the simulation reverted for a reason other than the missing co-signature (for example VelocityExceeded), an escalated request still produced an approval request.
- Impact: The user could approve a payment that would then revert on chain: a confusing approval, no loss of funds (the enforcers refuse it).
- Recommendation: Create an approval only when the simulation succeeds or fails solely with CoSignRequired.
- Resolution: The approval is created only for an approvable simulation.

**YR-04. The web signing guard allows a user operation without decoding its calls** (medium, fixed)

- Description: PackedUserOperation is on the allowlist for seal, resume and revoke, but the guard does not decode the inner calls against an allowlist, and an unknown message kind from the network throws instead of returning a typed refusal.
- Impact: The guard relies on the page's own decoding of what the user is shown; a compromised service could ask the passkey to sign a user operation with other calls. The account's enforcers still bound what an agent can do, and the user sees the decoded operation before signing.
- Recommendation: Decode the user operation's execution calls and accept only the publish, delegation, pause, resume and revoke calls to known contracts; return a typed refusal for unknown kinds.
- Resolution: The guard decodes the user operation's execute call: it must send no value and may only call the account functions its kind needs (seal: publish, supersede, revoke, setPayees, setGuardian; revoke: revoke, disableDelegation; resume: untrip). Unknown kinds return KindMismatch. Unit tests cover a hidden transfer, a value-sending call and an unknown kind.

**YR-05. MandateRegistry.canExecute reports no live mandate after the newer of two live mandates is revoked** (low, wontfix)

- Description: One liveMandateOfAgent slot per account and agent, while two lineages may each hold a live mandate; revoking the newer one clears the slot although the older one is still live (test_finding_canExecuteAfterRevokingNewerOfTwoLiveMandates, skipped).
- Impact: View only: the read interface answers (false, NO_LIVE_MANDATE) for an agent that can still redeem. Enforcement is unaffected: MandateBindingEnforcer checks each mandate's own status.
- Recommendation: Track live mandates per lineage, or recompute the slot on revoke.
- Resolution: Accepted for this release.

**YR-06. ProductRegistry.allProducts lists a product twice after delist and relist** (low, wontfix)

- Description: list() appends to the product array whenever the product is not currently listed, so delist followed by list duplicates it (test_finding_relistAfterDelistDuplicatesAllProducts, skipped).
- Impact: View only: allProducts() returns duplicates. Suitability enforcement reads the product mapping and is unaffected.
- Recommendation: Append only on the first listing, or de-duplicate in the view.
- Resolution: Accepted for this release.

**YR-07. Logging in on a second device ends the first device's session** (info, fixed)

- Description: Each login issues a new session token and stores only its hash, replacing the previous one.
- Impact: Usability: the first device is logged out without notice. No security impact.
- Recommendation: Keep a small set of session hashes per visitor, or tell the user that other devices were signed out.
- Resolution: Log in again keeps the hashes of up to four earlier session tokens, so earlier devices stay logged in; visitor-key-e2e.mts pays with the first device's token after a second login.

**YR-08. Login challenges and sign-ups in progress are kept in memory** (info, wontfix)

- Description: Open login challenges and pending seals live in process memory.
- Impact: A service restart asks a visitor in the middle of a login or sign-up to start it again. No data is lost: sealed accounts are stored on disk and on chain.
- Recommendation: Persist them with their expiry if restarts become frequent.
- Resolution: Accepted.
<!-- /gen -->

## 7. Issues we chose not to fix, and why

Known at design time and carried into the review:

| Issue | Why not fixed | Compensating control |
|---|---|---|
| The Base Sepolia DelegationManager owner (a MetaMask EOA) can pause every redemption (KR-17) | Not our contract; deploying our own on Base would lose the canonical framework addresses | Fails safe (no funds move); FISCO path unaffected; recorded-demo fallback |
| USDC accepts ERC-1271 signatures on `permit` and `transferWithAuthorization`, and HybridDeleGator validates any hash (KR-15) | Neither contract is ours; a domain-restricting account is a production item | Signing-domain guard; strict CSP; `TestHKD` restricted to EOA signers |
| FISCO DelegationManager domain uses chain ID 0 and no salt (KR-16) | Changing the framework domain would break identical bytecode | Our own domains are salted; distinct verifying-contract addresses |
| FISCO chain and regulator node run by the team (KR-04, KR-18) | A competition team cannot recruit independent consortium operators | Two-way anchoring to Base makes rewrites detectable |
| Agent key in a software keystore (KR-02) | No HSM available; TEE signer is a finals module | Caveats bound the loss; pause; rotation drill |
| ERC-8004 reputation is Sybil-prone (KR-05) | Inherent to a permissionless registry | Sealed trusted-issuer and trusted-client lists; `PayeeBook` first |
| Sanctions screening is off-chain only | Lists change daily; an on-chain list needs an admin role | Deterministic off-chain check; on-chain payee gate still applies |
| ValidationRegistry entries are self-attested (KR-11) | No external validator exists yet | Labelled "self-attested" |
| Reentrancy is bounded, not absent | Allowlisted targets may call back by design | `nonReentrant` on every YINGLONG target; state updated before execution; tests with a malicious token |
| Full caveat arrays are public on Base (DC-08) | Round-trip verification needs them public | Fictional personas only; private mandates available |

Found during this review and accepted: <!-- gen:review.wontfix.table -->

| ID | Title | Severity | Reason |
|---|---|---|---|
| YR-05 | MandateRegistry.canExecute reports no live mandate after the newer of two live mandates is revoked | low | The deployed bytecode is frozen and cited by the execution evidence on two ledgers; the defect affects a read-only helper, not enforcement. Fix in the next contract version. |
| YR-06 | ProductRegistry.allProducts lists a product twice after delist and relist | low | Frozen, evidence-cited bytecode; read-only helper; the front end de-duplicates. |
| YR-08 | Login challenges and sign-ups in progress are kept in memory | info | Both expire within 15 minutes; a restart costs one retry and keeps the attack surface small. |
<!-- /gen -->

## 8. Automated results

| Area | Result |
|---|---|
| Static analysis | Slither high open: <!-- gen:static.slither.high -->0 (raw high 0; Slither 0.11.6, 102 detectors over contracts/src)<!-- /gen -->; medium open: <!-- gen:static.slither.medium -->0 (raw medium 14, of which 14 triaged as false positives with reasons in contracts/reports/slither.json)<!-- /gen -->; Aderyn high open: <!-- gen:static.aderyn.high -->0 (Aderyn aderyn 0.6.8 (built from the v0.6.8 source release with the local Windows portability patch reports/aderyn-windows.patch))<!-- /gen --> |
| Tests | <!-- gen:tests.total -->830<!-- /gen --> passing, <!-- gen:tests.failed -->0<!-- /gen --> failing |
| Contract coverage | <!-- gen:coverage.contracts -->lines 100% (856/856), statements 100% (1048/1048), branches 99.49% (197/198), functions 100% (183/183) of contracts/src (forge 1.8.5 coverage)<!-- /gen --> |
| Invariants | <!-- gen:invariants.table -->Foundry campaign 128 runs x 64 calls; symbolic results from contracts/reports/symbolic.json:

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
<!-- /gen --> |
| Fuzz volume | <!-- gen:fuzz.calls -->14,352 (8,192 invariant handler calls in 128 runs, plus 6160 fuzz-test runs; contracts/reports/fuzz.json)<!-- /gen --> calls |
| Symbolic execution | <!-- gen:proofs.symbolic.status -->6 of 6 properties proved within bounds for invariants 1, 2, 3, 4, 5 (halmos 0.3.3, loops unrolled to 4, solver timeout 300 s; enforcer hooks executed symbolically, the DelegationManager and the account are not; Kontrol not run)<!-- /gen --> |
| Differential fuzzing split | <!-- gen:fuzz.differential.split -->not yet measured<!-- /gen --> |
| Enforcer gas overhead vs stock | <!-- gen:gas.overhead.median -->433,180 gas per payment (p95 437,289, n = 20): the sealed 15-caveat mandate vs 4 stock caveats for the same 1 tHKD transfer, paired samples a day apart (contracts/reports/gas.json)<!-- /gen --> |

## 9. Reproduction

Commands and logs live in the proof directory (`proof/`, planned): `forge test`, invariant profiles (`FOUNDRY_PROFILE=ci` and `deep`), Slither and Aderyn with pinned configs, Halmos and Kontrol targets, Medusa and Echidna harnesses, and the differential-fuzz runner.

## 10. Limitations of this review

Self-review by the authors; time-boxed to a hackathon schedule; bounded symbolic execution only; no review of third-party code in scope; no economic or legal review. It is not a substitute for an independent audit.
