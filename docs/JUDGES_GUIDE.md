# YINGLONG Judge's Guide (one page)

**Summary (5 lines)**
1. YINGLONG lets an AI agent pay on a person's or company's behalf only inside a mandate the user sealed with a passkey; the rules are smart-contract caveat enforcers, not prompts.
2. In ten minutes you can watch the 60-second cut, open real transaction hashes on two ledgers, run one command that re-verifies a mandate, and attack the agent yourself.
3. Everything that moves is a test unit on a testnet or a coin-free instruction on our team-run FISCO BCOS chain; the table below says exactly what is simulated.
4. Every number you see is generated from code; anything marked "AI-generated" is an explanation, never a fact source.
5. No bank partnership, licence, e-CNY integration, third-party audit or production readiness is claimed.

## 1. Ten minutes, in order

| Step | Do this | Where |
|---|---|---|
| 1 | Watch the 60-second cut | <!-- gen:links.video_60s -->TBD<!-- /gen --> |
| 2 | Open `PROOF.md`: ten hashes across Base Sepolia and FISCO BCOS, each with an explorer link | Repository root |
| 3 | Re-verify a mandate yourself (needs `uv`) | `uvx --from 'git+https://github.com/ABRUBAB/YINGLONG@v1.0-submission#subdirectory=tools/verify-py' yinglong verify samples/nadia.delegation.json --chain base-sepolia` |
| 4 | Attack Ying: scan the QR, type any attack, press "bypass" for an on-chain revert hash | `https://app.yinglong-agent.tech/challenge` |
| 5 | Read the security self-assessment (tiers + known risks) | `docs/SECURITY_SELF_ASSESSMENT.md` |

## 2. What to click

| Route | What you see | What to check |
|---|---|---|
| `/app` | Nadia's agent: activity table, Authority panel, Hash Ring | Each row has a state word and, if on chain, a hash link |
| `/approve/[id]` | The phone approval card | The card decodes the calldata itself and names the payee from the on-chain payee book |
| `/treasury` | Lotus Lane Shenzhen and Hong Kong | Rail label under the entity switch; 2-of-3 director queue |
| `/supervisor` | Registry of agents; "Verify" drawer | The Merkle path from a receipt to both anchors; "Pause agent" pauses, never spends |
| `/proof` | Proof Center | Every number carries its source chip (live testnet, FISCO, Anvil fork, Kaggle run) |
| `/challenge` | Judge's Challenge board | Which scale stopped each attack; revert hashes |

## 3. What to verify

| Claim | How to check it | Expected |
|---|---|---|
| The mandate on chain is the one the user sealed | `yinglong verify` (step 3) | Sentences match; delegation hash recomputes; status live or revoked as stated |
| Same enforcer code on both ledgers | `yinglong verify` prints code hashes per ledger | <!-- gen:bytecode.equal -->TBD<!-- /gen --> of <!-- gen:bytecode.total -->TBD<!-- /gen --> equal |
| Attacks revert with a typed reason | `yinglong verify-tx <hash> --chain base-sepolia` on a revert hash from `PROOF.md` | e.g. `PayeeNotVerified` |
| Receipts are anchored on both ledgers | `/supervisor` Verify drawer, or `yinglong verify-tx` | Fetched roots match |
| Pause works | Pause tx in `PROOF.md` | Later redemptions revert `Paused` |

## 4. What is real, what is simulated

| Item | Status |
|---|---|
| Transactions on Base Sepolia | Real, on a public testnet; test units with no monetary value |
| Transactions on FISCO BCOS | Real, on a **team-run** chain; every node on it is run by us (layout: <!-- gen:fisco.nodes -->TBD<!-- /gen -->) |
| `tHKD` | Test token: "Simulation of a regulated instrument; not issued by any licensee" |
| USDC | Circle testnet USDC, no monetary value |
| Mainland settlement | e-CNY-style **simulator**; no connection to PBoC or operator-bank systems |
| Harbour Digital Bank, Harbour Bay University, every Agent City company, Nadia, Lotus Lane | **Fictional** |
| Regulator and supervisor | A **role played by the team** |
| Passkeys in the video | Real phone, or a Chrome virtual authenticator where captioned |
| Budget periods in the demo | Time-compressed by a flag, labelled on screen |
| Judge's Challenge after the daily gas budget | "Shadow mode" on an Anvil fork, labelled "simulated, not on-chain" |
| Agent identity code | Placeholder "YL-TEST-...", not an issued code |
| Bench numbers | Each with its source label; see `docs/CLAIMS.md` for the wording rules |

More: `docs/THREAT_MODEL.md`, `docs/COMPLIANCE_MATRIX.md` (including the "never claimed" list), `docs/PIA.md`, `docs/INCIDENT_RESPONSE.md`, `docs/SECURITY_REVIEW.md`.
