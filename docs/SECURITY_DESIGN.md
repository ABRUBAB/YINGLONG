# YINGLONG Security Design

*Technical documentation, part 3 of 3. Part 1 is [ARCHITECTURE.md](ARCHITECTURE.md). Part 2 is [CORE_ALGORITHMS.md](CORE_ALGORITHMS.md). The control-by-control assessment with generated status is [SECURITY_SELF_ASSESSMENT.md](SECURITY_SELF_ASSESSMENT.md); the attack trees are in [THREAT_MODEL.md](THREAT_MODEL.md); the internal review is [SECURITY_REVIEW.md](SECURITY_REVIEW.md); incident playbooks are in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).*

This document explains *why the system is built the way it is* to be safe: the security goals, who we defend against, the layers, the keys, the privacy design, and what has been tested. It ends with what is not claimed.

---

## 1. Security goals

| # | Goal | How it is met (short) |
|---|---|---|
| G1 | The agent can never move value outside the rules the owner sealed | Rules are on-chain enforcers; the agent can only redeem a delegation they guard |
| G2 | A tricked model cannot widen its own authority | Models can only escalate; they never lower a tier or produce an address |
| G3 | A leaked agent key does bounded damage and can be stopped fast | Caveats cap the loss; a passkey signature pauses and revokes; the key can be rotated |
| G4 | The owner knows what they approve | The approval page decodes the exact payment and signs only allowlisted message types |
| G5 | Every action leaves checkable evidence | Hash-chained receipts, Merkle-anchored on two ledgers, an independent verifier |
| G6 | Personal data does not leave the machine unscrubbed | Normalisation scrubs before any model call; synthetic data only in training |
| G7 | Failures are safe | Unreachable models, simulators or ledgers lead to ask or refuse, never to wider authority |

## 2. What we protect

Funds in the owner's smart account (test units today); the integrity of the sealed mandate; the agent key; the owner's passkeys; the agent's identity and attestations; the evidence trail; personal data; and the availability of pause and revoke (the owner's emergency brake).

## 3. Who we defend against

| Adversary | What they can do | The main answer |
|---|---|---|
| Content attacker | Writes any text or image the agent reads (invoice, email, memo, token name, payment-request description, agent card) | Quarantine, sentinel, closed schema, payee enum, chain enforcers |
| Rogue agent | Registers its own identity, copies credentials, offers look-alike addresses | Payee book, attestations from trusted issuers sealed in the mandate, look-alike test |
| Phisher | Gets the owner to tap a passkey prompt | Signing-domain guard that signs only decoded, allowlisted message types |
| Host attacker | Takes the agent host and the agent key | Signer isolation, caveats bound the loss, pause, revoke, rotate |
| Malicious counterparty | Misprices, withholds delivery, replays | Single-use exact-amount x402 child delegations, signed quotes, seller-settled |
| Supply-chain attacker | Ships a bad package, model or tool | Pinned lockfiles, SBOM, models pinned by SHA-256, fail-closed hash check at startup |
| Insider or operator | Holds team keys (chain nodes, relayer, supervisor) | Role separation; the supervisor can pause, never spend; anchoring is append-only |
| Public challenge visitor | Unlimited attempts on a guest mandate | A tiny guest mandate, quotas, a separate key |
| Infrastructure fault | Stale or disagreeing state, an outage | Re-simulation at the chain head, ask on disagreement |

## 4. The layers (defence in depth)

An attack has to get through every layer, and the last two do not depend on any model.

| Layer | What it does | Fails to |
|---|---|---|
| L1 Input hygiene | Unicode normalisation, strips hidden characters, flags mixed scripts, scrubs personal data | Escalate |
| L2 Detection | The injection sentinel (M1) raises a tier on suspected attacks | Escalate |
| L3 Quarantine | Untrusted documents are read by separate readers into a closed schema, behind opaque handles; the planner never sees that text; a prompt guard blocks repeats | Escalate |
| L4 Constrained planning | The planner's output is a strict schema; the payee is an identifier from the owner's book; amounts are integers | Discard the output |
| L5 Deterministic policy | A mirror of the on-chain rules decides T1 to T4; counterparty and look-alike checks | Refuse or ask |
| L6 Simulation | The real redemption runs as `eth_call`; the result must agree with the tier | Ask |
| L7 Behaviour check | Rules plus the behaviour model (M3) flag unusual actions | Escalate |
| L8 Signer guard | The only process with the agent key accepts exactly one transaction shape and re-simulates at the head | Refuse to sign |
| L9 On-chain enforcers | Every caveat of the mandate (up to 14 kinds) runs again at redemption and reverts with a named error | Revert |
| L10 Evidence | A receipt for every outcome, anchored; kill switch, revoke and rotate | n/a |

**The monotonic rule** ties L2, L3, L7 together: model signals can raise T1 to T2 and T2 to ask. They cannot lower a tier and cannot produce T3 or T4. A refusal comes only from deterministic code. This rule is tested with an exhaustive 72-case check and 5,000 random escalation chains, and it is why we can report an attack result that does not depend on the model being right.

## 5. Authority design: tiers and who can do what

| Tier | Meaning | Enforced by |
|---|---|---|
| T0 | Observe (read-only) | No signing path exists |
| T1 | Act inside every rule | Every caveat at redemption |
| T2 | Confirm: above the act-alone cap, or a flagged T1 | The co-sign enforcer verifies the owner's own signature on the exact payment |
| T3 | Reserved: change the rules, add a payee, above the ceiling | Only the account itself (passkey, or 2 of 3 directors); the enforcers keep these contracts out of any delegation's reach |
| T4 | Refuse | A rule refuses; the same attempt reverts on-chain with a typed error |
| ASK | Not sure | Nothing is signed; the owner decides |

This follows the structure of China's 2026 agent guidance (decisions only the user makes, decisions needing authorisation, autonomous decisions), turned into tiers the ledger enforces.

**Accounts.** A person's account has a passkey (P-256) as its only owner (owner address zero): there is no seed phrase and no ECDSA owner, so a plain signature can never satisfy it. A company's account is 2-of-3 directors. Principals act through user operations sent directly to the EntryPoint.

**Roles and keys.**

| Role | Can | Cannot |
|---|---|---|
| Owner passkey | Seal, approve T2, pause, resume, all T3 actions | n/a |
| Directors (company) | 2-of-3 company actions | Act alone |
| Agent wallet | Redeem its delegation inside the caveats | Anything else (signer guard and caveats) |
| Passport controller | Register, rotate the agent wallet, update hashes | Spend |
| Relayer | Submit user operations and relayed pause signatures | Sign for a principal |
| Guardian and breaker watcher | Trip the kill switch for accounts that named them | Unpause, spend |
| Supervisor (regulator role) | Halt or resume an agent identity | Spend, rotate keys, change mandates |
| Anchoring relayer | Append roots and cross-anchors | Alter or delete a root |
| Deployer | Deploy; keeps only the minter and registry-admin roles of the test units | Spend a user's funds |

Keys are test keys loaded at runtime from outside the repository and never printed or committed (the repository rules and a secret scan in CI enforce this).

## 6. Defences in detail

**Identity binding.** The delegate must hold an active passport whose owner identity hash equals the one sealed in the mandate; the passport is controlled by a separate key, so no delegation can rotate the agent wallet. The mandate must be live in a public registry that recomputes the delegation hash from the published caveats.

**Signer isolation.** The signer listens on 127.0.0.1 only and accepts one kind of transaction: `redeemDelegations` on the deployment's DelegationManager, one to eight entries, a delegation chain whose leaf delegate is this agent, an execution on a known asset with a payment selector, and no native value. It requires a T1 decision (or T2 with approval) and a successful simulation at the head before signing.

**Signing-domain guard (owner passkey).** The approval page is the only path that hands a challenge to the passkey. It accepts only these EIP-712 message kinds: delegation, approval, receipt, trip and untrip, veto, and user operation, each only for its request kind, and only if the digest it is asked to sign equals the hash it recomputes from the typed data it shows. Since the review fix, user operations are decoded: no value, and only the account functions the kind needs. EIP-3009 transfers, Permit, Permit2, raw message signing and unknown domains are refused. This closes the risk that a signature for a smart account validates any 32-byte hash.

**Token design.** The test units accept EIP-3009 and Permit signatures from ordinary keys only, never from a smart account, so a phished passkey signature cannot move them outside the caveats.

**Public attack endpoint.** The challenge uses a guest mandate with tiny caps, a separate key and quotas; the risks of the public board (offensive text, downtime) are listed in the known-risk table of the self-assessment.

**Supply chain.** Lockfiles are pinned and installs run without scripts; a software bill of materials is generated; the three models are pinned by SHA-256 in `models.lock.json` and the service fails closed on a mismatch; model and prompt hashes go into each receipt.

## 7. Privacy design

| Measure | What it does |
|---|---|
| Scrubbing before any model call | Removes private keys, 18-digit mainland ID numbers, card numbers, mobile numbers and seed phrases. Measured recall on the synthetic test set: 57 of 75 (76.0%, 95% interval 65.2% to 84.2%), so it is a safety net, not a guarantee |
| Fictional data only | The demo uses fictional people and companies; training data is synthetic or public with licences recorded; Chinese-script rows live only in private datasets referenced by hash |
| Private mandates | A zero-knowledge proof enforces a hidden cap, hidden expiry and hidden allowlist root; only a commitment is public |
| Minimal public record | A public caveat array shows a person's rules; the production default would be a private mandate or consortium-only publication |
| Passkeys stay on the device | The server never sees a private key; sign-up uses the owner's own passkey |

A privacy impact assessment is in [PIA.md](PIA.md).

## 8. Assurance: what has been tested

| Area | Evidence |
|---|---|
| Contract rules | Foundry tests of every enforcer and tier through the real DelegationManager; 100% line coverage and 99.49% branch coverage of our enforcer sources at the last coverage run |
| Invariants | Ten designed invariants: unit tests for nine of them (one is not yet tested because no sub-agent chains are compiled); a stateful fuzz campaign for five; bounded symbolic proofs (halmos) for five; the others are listed as not fuzzed |
| Static analysis | Slither: 14 raw findings, all triaged as false positives |
| Zero-knowledge | 59 Foundry tests with real proofs; each of the ten public inputs is flipped and must be rejected |
| Two verifiers | TypeScript and Python re-implement the compiler and checks independently and agree on every golden and vector case |
| Benchmark | 300 attacks in 13 families on a local chain with an on-chain judge: 0 of 300 moved value outside the mandate; 208 of 208 raw attempts blocked; a stock-caveat control lost value in 90 of 105 hijacks |
| Incident drills | A leaked-key drill on the team chain: detect 0.7 s, pause 1.6 s, revoke 2.8 s, rotate 4.2 s, evidence bundle 4.2 s (from the fault); a one-block pause takes a median of 0.22 s |
| Internal review | Eight findings (0 critical, 0 high, 2 medium, 4 low, 2 informational): five are fixed with commits (including both medium ones, in sign-up and in the web signing guard); three are accepted, two low ones in read-only helper functions because the deployed bytecode is frozen and cited as evidence, and one informational |
| Application tests | Unit and end-to-end tests across the agent, signer, services, web (Playwright) and verifier; counts are generated in [PROOF.md](../PROOF.md) |

Frameworks mapped: the OWASP Top 10 for Agentic Applications 2026 (all ten risks), and the five areas of the BFIA self-assessment (initialisation and input, model inference and decision, identity and operation, data and privacy, risk control and compliance). The mapping tables are in [THREAT_MODEL.md](THREAT_MODEL.md) and [SECURITY_SELF_ASSESSMENT.md](SECURITY_SELF_ASSESSMENT.md); the control catalogue is generated with a status for each of 72 controls.

## 9. Incident response

Five playbooks run in the same order: detect, pause, revoke, rotate, notify, evidence. They cover an agent key leak, device theft or passkey loss, an issuer key compromise, a facilitator compromise and an RPC outage. The breaker watcher trips the kill switch automatically when a company's agent hits a breaker-class rule (a velocity breach by default). Pause needs only one passkey signature and can be relayed by anyone; only the owner can resume.

## 10. Known risks and honest limits

| Risk | Residual |
|---|---|
| Test networks and test units only; no third-party audit | Undiscovered enforcer bugs; not for real funds |
| The agent key sits in a software keystore on one host | A host compromise yields in-mandate loss up to the remaining caps until paused |
| The mainland rail is a simulator | Nothing about real mainland settlement is shown |
| The FISCO chain and the supervisor and relayer keys are held by the team | Anchoring shows consistency, not independent consensus |
| The sentinel misses 8.3% of the held-out attack family and over-flags about one benign document in seven | Missed attacks reach the chain, which is the backstop; extra flags cost confirmations |
| Manipulation inside the owner's own limits | 9 of 44 benchmark items went through; the loss is capped by the limits |
| Reputation systems are Sybil-prone | Trusted issuers are sealed in the mandate; the payee book is primary |
| Passkey loss | Two passkeys and guardian recovery are designed; both passkeys lost with no guardian locks the account |
| Free model APIs may log prompts | Scrubbing runs first; only synthetic or fictional text is used |
| Automated runs use scripted software passkeys | Labelled in every place they appear; the live sign-up uses real WebAuthn passkeys |
| Public ledger records a mandate's rules | Use private mandates in production |
| The behaviour model was added after the last benchmark run | It can only escalate and fails open, so it cannot move value; its effect on the number of confirmations is not in the benchmark |

The full known-risk list (19 entries), the open design checks (11 entries) and the plan for production (audit, TEE-backed keys, independent chain operators, mainland hosting) are in [SECURITY_SELF_ASSESSMENT.md](SECURITY_SELF_ASSESSMENT.md).

## 11. How a reviewer can check these claims

1. Open `/challenge` on the live site: type an attack, or push a raw transaction past the AI, and read the named revert and its hash.
2. Open `/proof`: the two-chain table and the match marks for the identical rule contracts.
3. Run `yinglong verify` (one command, only an RPC endpoint) to recompile a sealed mandate and compare it with the chain.
4. Read [PROOF.md](../PROOF.md) and [EXECUTION_EVIDENCE.md](EXECUTION_EVIDENCE.md) for the transactions, and the generated numbers in `docs/evidence/bundle.json`.
