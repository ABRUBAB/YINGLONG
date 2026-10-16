# YINGLONG Incident Response

*Five playbooks, each in the same order: detect → pause → revoke → rotate → notify → evidence.*

**Summary (5 lines)**
1. Five playbooks cover the incidents that matter for an agent wallet: agent key leak, device theft or passkey loss, issuer key compromise, facilitator compromise, and RPC or bundler outage.
2. Every playbook runs the same six steps, so the first responder never has to think about order: detect, pause, revoke, rotate, notify, evidence.
3. Pausing never depends on our infrastructure: the user's passkey-signed pause can be relayed by anyone as a plain transaction, and the guardian and breaker watcher can trip it directly.
4. Step times are measured in drills and filled from drill logs; a playbook that has not been drilled says "not drilled" instead of a time, and no time is promised in advance.
5. Playbook 1 is rehearsed on camera in the key-compromise drill (demo beat 11); the others are tabletop procedures until their drills are recorded.

Related: `docs/THREAT_MODEL.md` section 8 (key table), `docs/SECURITY_SELF_ASSESSMENT.md` controls C-RC-01 to C-RC-04 and C-RC-13, `SECURITY.md` (how outsiders report).

---

## 1. Conventions

| Item | Rule |
|---|---|
| t0 | The moment the fault is injected (drill) or the first detection signal is logged (real incident) |
| Measured time | Elapsed time from t0 to completion of the step: on-chain inclusion for pause, revoke and rotate; message delivered for notify; evidence bundle hash written for evidence. Produced by the drill scripts (planned under `scripts/drills/`) as `docs/evidence/drills/pbN.json` and filled by `scripts/finalize`. Block time at measurement is recorded next to every time (Base Sepolia moves to 200 ms blocks with the Denim upgrade on 21 Oct 2026 [S, secondary source]) |
| Not drilled | Printed when no drill log exists. A time is never typed by hand |
| Severity | **SEV1**: value could move outside a mandate, or a key with spending or T3 power is compromised. **SEV2**: in-mandate loss or identity compromise possible. **SEV3**: degraded availability, no loss path |
| Evidence standard | Every step leaves an artefact (transaction hash, user-operation hash, receipt id, or the SHA-256 of a log excerpt). The incident bundle is hashed and its hash receipted in `AccountabilityLedger`, so it is anchored on both ledgers |

### 1.1 Roles

| Role | Holder | Responsibility |
|---|---|---|
| Incident lead | R1 | Declares severity, owns the timeline, decides on public notice |
| Chain operator | R2 | Pause, revoke, contract-level actions, FISCO chain |
| Runtime | R3 | Signer, relayer, orchestrator, facilitator settings, RPC providers |
| Security analyst | R4 | Detection signals, bench and anomaly data, root cause |
| Communications | R5 | User-facing notices, status banner, public advisory |

### 1.2 Pause and revoke instruments

| Instrument | Who can use it | Needs our infrastructure? | Effect |
|---|---|---|---|
| `KillSwitchRegistry.tripWithSig` | User passkey signature, relayed by anyone | No: any account can submit it as a plain transaction | `GlobalPauseEnforcer` reverts `Paused` on every delegation of the account |
| `KillSwitchRegistry.trip` | Guardian, breaker watcher | No | Same |
| `KillSwitchRegistry.supervisorPause(agentId)` | Supervisor key | No | Pauses one agent identity; never spends |
| `disableDelegation` + `Nonce` bump | User account (user operation) | Relayer straight to `EntryPoint.handleOps`; bundler as fallback | Revokes the delegation and every delegation of the old nonce epoch |
| `MandateRegistry.supersede` | User account (user operation) | Same | Atomic replacement of a mandate |
| Orchestrator stop flag | Runtime | Yes | Agent stops proposing (T?); no on-chain effect |

---

## 2. Playbook 1: agent key leak (SEV1)

Rehearsed in demo beat 11. Last drill: <!-- gen:ir.pb1.drill -->pb1-2026-10-16T01-03-20-656Z on FISCO BCOS (team-run consortium ledger): fresh visitor principal v-6637a6444a (scripted passkey (software P-256 key)), times from t0 = the leaked-key attack (pb1.json)<!-- /gen -->

| Step | Action | Who / key | How | Measured time since t0 | Evidence |
|---|---|---|---|---|---|
| Detect | Out-of-pattern redemption attempts; reverts recovered by `eth_call` replay; signer or policy refusals; anomaly (M3) escalations; secret-scanning alert | Breaker watcher, R4 | `apps/indexer` watcher; gitleaks | <!-- gen:ir.pb1.detect -->+0.712 s (watcher saw the on-chain revert [`0x4610e08984...`](https://app.yinglong-agent.tech/proof/tx/fisco/0x4610e089843cf8072e5c11bac17266c794c9549b46fefb23b200a0e764ab25d2))<!-- /gen --> | Alert log hash; revert hashes |
| Pause | Trip the kill switch for the account (watcher `trip()` or user `tripWithSig`) | Breaker watcher or user passkey | Relayed plain transaction | <!-- gen:ir.pb1.pause -->+1.581 s ([`0x98ffc2c3a3...`](https://app.yinglong-agent.tech/proof/tx/fisco/0x98ffc2c3a3bd8cdb4aa414a95231e3ae717ace8950af4ed4ec7d430d64dd0658))<!-- /gen --> | Pause tx hash |
| Revoke | `disableDelegation` of the leaked key's delegation + `Nonce` bump, one user operation | User passkey | Relayer → `EntryPoint.handleOps` | <!-- gen:ir.pb1.revoke -->+2.847 s (user operation [`0xd511294e6b...`](https://app.yinglong-agent.tech/proof/tx/fisco/0xd511294e6bde301f1cc45b61054ae29314111dc6f3d5a40f7eda51b81c7b185c))<!-- /gen --> | User-operation hash |
| Rotate | New agent key in the vault; `setAgentWallet` (signed by the new key) by the agent NFT owner key; passport and agent-card JWKS updated; mandate re-sealed to the new key; `untripWithSig` | R3, user passkey | Signer, `YinglongPassportRegistry`, `MandateRegistry.supersede` | <!-- gen:ir.pb1.rotate -->+4.150 s (re-seal with the same passkey [`0x2fc40410de...`](https://app.yinglong-agent.tech/proof/tx/fisco/0x2fc40410ded1695d9eb9af79a4696b455df0dd3437432152c3d1cf84a1846984), then resume [`0x64711ac39e...`](https://app.yinglong-agent.tech/proof/tx/fisco/0x64711ac39e50dc8bf3f5206688b3f54abc3cee762b5c4bc9d277965addddd530); the agent key itself is not rotated in this drill)<!-- /gen --> | Rotation event; new mandate hash |
| Notify | User (in-app); counterparties via the rotated agent card; supervisor console status; public advisory if any value moved | R5 | App notice; registry status | <!-- gen:ir.pb1.notify -->not automated<!-- /gen --> | Notice ids |
| Evidence | Bundle: attempts, reverts, pause, revoke, rotation, and **actual loss vs "max funds at risk"** (sum of in-mandate redemptions between leak and pause vs remaining caps at leak time) | R4 | Drill script; `AccountabilityLedger` | <!-- gen:ir.pb1.evidence -->+4.155 s (pb1.json SHA-256 `0ce50a239909c3e24f373be0939d90e53b579b8d6bfdeb8e0d3796ae755302f4`, verified at generation)<!-- /gen --> | Bundle hash, anchor; drill result: <!-- gen:ir.pb1.exposure -->actual loss 0 vs max at risk 402000000 tHKD (base units, remaining period caps at t0); attempted 100000000 tHKD<!-- /gen --> |

Bound: everything the leaked key can do is inside the caveats; loss before pause is at most the remaining period caps (C-RC-05).

---

## 3. Playbook 2: device theft or passkey loss (SEV1 if theft, SEV3 if loss)

Last drill: <!-- gen:ir.pb2.drill -->not drilled<!-- /gen -->

| Step | Action | Who / key | How | Measured time since t0 | Evidence |
|---|---|---|---|---|---|
| Detect | User report; unexpected T2 approvals or seals; sign-in from a new device; synced-passkey provider alert | User, R4 | App; provider notice | <!-- gen:ir.pb2.detect -->not drilled<!-- /gen --> | Report record |
| Pause | `tripWithSig` from the remaining passkey, or guardian `trip()` | User (second passkey) or guardian | Relayed plain transaction | <!-- gen:ir.pb2.pause -->not drilled<!-- /gen --> | Pause tx hash |
| Revoke | `removeKey` for the stolen passkey (HybridDeleGator refuses to remove the last signer when there is no owner [V, framework source]); veto any scheduled items in the veto window | User (remaining passkey) | User operation | <!-- gen:ir.pb2.revoke -->not drilled<!-- /gen --> | User-operation hash |
| Rotate | `addKey` for a new passkey; if both passkeys are lost, guardian-initiated recovery with a delay the owner can cancel (DC-05) | User or guardian | User operation | <!-- gen:ir.pb2.rotate -->not drilled<!-- /gen --> | Key events |
| Notify | User confirmation on the new device; guardian | R5 | App | <!-- gen:ir.pb2.notify -->not drilled<!-- /gen --> | Notice ids |
| Evidence | Signer-set history, pause and key events, any approvals signed by the stolen key | R4 | `AccountabilityLedger` | <!-- gen:ir.pb2.evidence -->not drilled<!-- /gen --> | Bundle hash, anchor |

Note: a passkey synced through a cloud account is stolen when that account is; the user should also secure the cloud account. Treasury directors follow the same steps on the 2-of-3 account (one stolen key alone can do nothing).

---

## 4. Playbook 3: issuer key compromise (SEV2)

Issuers in the demo are fictional (Harbour Digital Bank, Harbour Bay University) and run by the team. Last drill: <!-- gen:ir.pb3.drill -->not drilled<!-- /gen -->

| Step | Action | Who / key | How | Measured time since t0 | Evidence |
|---|---|---|---|---|---|
| Detect | Attestation events the issuer did not log; attestations for unknown agents; issuer report | Indexer watch, R4 | Compare attestation events with the issuer's own log | <!-- gen:ir.pb3.detect -->not drilled<!-- /gen --> | Event list hash |
| Pause | `supervisorPause` of every agentId attested by the issuer after the suspected compromise time; users who sealed the issuer are told to pause if any payment to such an agent is pending | Supervisor key; users | Plain transactions | <!-- gen:ir.pb3.pause -->not drilled<!-- /gen --> | Pause tx hashes |
| Revoke | Mark the issuer's attestations after the compromise time as revoked in `YinglongPassportRegistry` (needs the issuer-status path, DC-06) | Registry path per DC-06 | Transaction | <!-- gen:ir.pb3.revoke -->not drilled<!-- /gen --> | Status events |
| Rotate | Issuer publishes a new key; affected users re-seal their trusted-issuer set (T3) or the registry-level issuer status takes effect | Issuer; users | Re-seal (`supersede`) | <!-- gen:ir.pb3.rotate -->not drilled<!-- /gen --> | New mandate hashes |
| Notify | Affected users, counterparties, supervisor console | R5 | App; registry status | <!-- gen:ir.pb3.notify -->not drilled<!-- /gen --> | Notice ids |
| Evidence | Forged attestations, payments to agents they vouched for, pauses, re-seals | R4 | `AccountabilityLedger` | <!-- gen:ir.pb3.evidence -->not drilled<!-- /gen --> | Bundle hash, anchor |

Exposure: only users who sealed this issuer, only to agents it attested, and still within those users' caps and reputation gate.

---

## 5. Playbook 4: facilitator compromise (SEV2)

Last drill: <!-- gen:ir.pb4.drill -->not drilled<!-- /gen -->

| Step | Action | Who / key | How | Measured time since t0 | Evidence |
|---|---|---|---|---|---|
| Detect | `settlement_pending` with no on-chain settlement; settlements for children never delivered; facilitator `/supported` signer addresses change; double-settlement reverts | Runtime, R4 | Indexer and x402 client logs | <!-- gen:ir.pb4.detect -->not drilled<!-- /gen --> | Log hash; revert hashes |
| Pause | Stop issuing x402 children (orchestrator flag); switch to the seller-settled fallback; trip the kill switch only if parent caveats look affected | R3 | Config flag | <!-- gen:ir.pb4.pause -->not drilled<!-- /gen --> | Config change hash |
| Revoke | `disableDelegation` on every unexpired x402 child (each expires within 300 s anyway) | Agent or user account | Transactions | <!-- gen:ir.pb4.revoke -->not drilled<!-- /gen --> | Tx hashes |
| Rotate | Pin a new facilitator host and its matching redeemer addresses; mandates that pin the facilitator are re-sealed (T3) | R3; users | Config; `supersede` | <!-- gen:ir.pb4.rotate -->not drilled<!-- /gen --> | New mandate hashes |
| Notify | Users with pending x402 payments; affected sellers | R5 | App | <!-- gen:ir.pb4.notify -->not drilled<!-- /gen --> | Notice ids |
| Evidence | Every child delegation (`keccak(permissionContext)` from receipts), settlements, deliveries | R4 | `AccountabilityLedger` | <!-- gen:ir.pb4.evidence -->not drilled<!-- /gen --> | Bundle hash, anchor |

Bound: each child is single-use and exact-amount (invariant 10); worst case = the sum of outstanding unexpired children, each a payment the user meant to make.

---

## 6. Playbook 5: RPC or bundler outage (SEV3)

Last drill: <!-- gen:ir.pb5.drill -->not drilled<!-- /gen -->

| Step | Action | Who / key | How | Measured time since t0 | Evidence |
|---|---|---|---|---|---|
| Detect | Two-provider quorum disagreement; head stale by block number; bundler errors; user operations not included; anchoring gap | Runtime | Quorum and freshness monitors | <!-- gen:ir.pb5.detect -->not drilled<!-- /gen --> | Monitor log hash |
| Pause | Automatic: the agent enters T? and proposes nothing (fail-closed). If an on-chain pause is needed, `tripWithSig` goes out through any other RPC; no bundler is needed | Runtime; user | Orchestrator; plain transaction | <!-- gen:ir.pb5.pause -->not drilled<!-- /gen --> | State change; pause tx hash if used |
| Revoke | Only if needed: `disableDelegation` through the relayer straight to the EntryPoint (no bundler) | User passkey | Relayer | <!-- gen:ir.pb5.revoke -->not drilled<!-- /gen --> | User-operation hash |
| Rotate | Switch RPC providers and bundler; rotate provider API keys if exposed | R3 | Config | <!-- gen:ir.pb5.rotate -->not drilled<!-- /gen --> | Config change hash |
| Notify | Status banner; recorded-demo mode for judges, labelled as recorded | R5 | Web | <!-- gen:ir.pb5.notify -->not drilled<!-- /gen --> | Banner record |
| Evidence | Quorum logs, freshness by block number, catch-up of anchors after recovery | R4 | Indexer | <!-- gen:ir.pb5.evidence -->not drilled<!-- /gen --> | Bundle hash, anchor |

Related third-party halts: the MetaMask-owned Base Sepolia DelegationManager can be paused by its owner (KR-17): redemptions fail safe, the FISCO path continues, and the demo falls back to recorded mode. A FISCO node outage of one node out of four is tolerated by its consensus [S, secondary source]; more is a chain outage handled by this playbook.

---

## 7. After every incident or drill

1. Root cause and the scale or enforcer that should have caught it earlier.
2. New bench item or test that reproduces it (never added to the held-out family).
3. Finding recorded in `docs/SECURITY_REVIEW.md` with severity, status and fix commit.
4. Known-risk table updated if the residual risk changed.
