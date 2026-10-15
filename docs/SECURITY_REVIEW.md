# YINGLONG Internal Security Review

> **Internal review by the YINGLONG team; no third-party audit has been performed.**

**Summary (5 lines)**
1. This is a self-review in audit format by the people who wrote the code; it is not independent and it is not an audit.
2. Scope: YINGLONG's own contracts, the agent signer and signing-domain guard, the policy mirror, the mandate compiler and both verifiers; the MetaMask Delegation Framework is out of scope (its own audit reports ship with it).
3. Method: manual review against a fixed checklist, static analysis, fuzzing and invariant campaigns, bounded symbolic execution, differential testing of the policy mirror against the contracts, and a threat-model walkthrough.
4. Findings by severity: <!-- gen:review.count.critical -->not yet measured<!-- /gen --> critical, <!-- gen:review.count.high -->not yet measured<!-- /gen --> high, <!-- gen:review.count.medium -->not yet measured<!-- /gen --> medium, <!-- gen:review.count.low -->not yet measured<!-- /gen --> low, <!-- gen:review.count.info -->not yet measured<!-- /gen --> informational; <!-- gen:review.fixed -->not yet measured<!-- /gen --> fixed, <!-- gen:review.open -->not yet measured<!-- /gen --> open, <!-- gen:review.wontfix -->not yet measured<!-- /gen --> accepted.
5. Section 7 lists the issues we chose not to fix and why; known risks KR-01 to KR-19 are in `docs/SECURITY_SELF_ASSESSMENT.md`.


| Field | Value |
|---|---|
| Commit reviewed | <!-- gen:review.commit -->not yet measured<!-- /gen --> |
| Review completed | <!-- gen:review.date -->not yet measured<!-- /gen --> |
| Release | <!-- gen:meta.release_tag -->1da0e0e<!-- /gen --> |
| Reviewers | YINGLONG team members (roles R2 contracts, R4 AI security; read-only reviewer sessions at the planned review gate) |
| Tool versions used | <!-- gen:review.tools.versions -->not yet measured<!-- /gen --> |

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

<!-- gen:review.findings.table -->not yet measured<!-- /gen -->

Columns: ID, title, severity, component, status (fixed, acknowledged, open), fix commit.

## 6. Finding details

<!-- gen:review.findings.details -->not yet measured<!-- /gen -->

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

Found during this review and accepted: <!-- gen:review.wontfix.table -->not yet measured<!-- /gen -->

## 8. Automated results

| Area | Result |
|---|---|
| Static analysis | Slither high open: <!-- gen:static.slither.high -->not yet measured<!-- /gen -->; medium open: <!-- gen:static.slither.medium -->not yet measured<!-- /gen -->; Aderyn high open: <!-- gen:static.aderyn.high -->not yet measured<!-- /gen --> |
| Tests | <!-- gen:tests.total -->223<!-- /gen --> passing, <!-- gen:tests.failed -->not yet measured<!-- /gen --> failing |
| Contract coverage | <!-- gen:coverage.contracts -->not yet measured<!-- /gen --> |
| Invariants | <!-- gen:invariants.table -->not yet measured<!-- /gen --> |
| Fuzz volume | <!-- gen:fuzz.calls -->not yet measured<!-- /gen --> calls |
| Symbolic execution | <!-- gen:proofs.symbolic.status -->not yet measured<!-- /gen --> |
| Differential fuzzing split | <!-- gen:fuzz.differential.split -->not yet measured<!-- /gen --> |
| Enforcer gas overhead vs stock | <!-- gen:gas.overhead.median -->not yet measured<!-- /gen --> |

## 9. Reproduction

Commands and logs live in the proof directory (`proof/`, planned): `forge test`, invariant profiles (`FOUNDRY_PROFILE=ci` and `deep`), Slither and Aderyn with pinned configs, Halmos and Kontrol targets, Medusa and Echidna harnesses, and the differential-fuzz runner.

## 10. Limitations of this review

Self-review by the authors; time-boxed to a hackathon schedule; bounded symbolic execution only; no review of third-party code in scope; no economic or legal review. It is not a substitute for an independent audit.
