# YINGLONG Judge's Guide (one page)

**Summary (5 lines)**
1. YINGLONG lets an AI agent pay on a person's or company's behalf only inside a mandate the user sealed (a passkey; for a company, 2 of 3 directors); the rules are smart-contract caveat enforcers, not prompts.
2. In ten minutes you can open real transaction hashes, decode any of them, re-verify a sealed mandate with one command, and attack the agent yourself.
3. Everything that moves is a test unit or a coin-free instruction; the table at the end says exactly what is simulated.
4. Every number in the documents is generated from code (`apps/agent/scripts/finalize.ts`); anything labelled "AI-generated" is an explanation, never a fact source.
5. No bank partnership, licence, e-CNY integration, third-party audit or production readiness is claimed.

## 1. Ten minutes, in order

| Step | Do this | Where |
|---|---|---|
| 1 | Watch the 60-second cut | <!-- gen:links.video_60s -->not yet measured<!-- /gen --> |
| 2 | Open the one-page proof: sealed mandates, allowed payments, approved payments, on-chain refusals with typed errors, a 2-of-3 board resolution, a one-tap pause | [`PROOF.md`](../PROOF.md) |
| 3 | Decode any FISCO BCOS transaction (FISCO has no public explorer, so we serve a read-only decoder) | `https://api.yinglong-agent.tech/v1/tx/fisco/<hash>` |
| 4 | Re-verify a mandate yourself with the independent Python verifier (needs `uv`) | `uvx --from 'git+https://github.com/ABRUBAB/YINGLONG#subdirectory=tools/verify-py' yinglong verify nadia --chain anvil --offline` |
| 5 | Attack the guest agent: type any attack; "bypass" pushes it raw to the chain and returns the revert hash | `https://app.yinglong-agent.tech/challenge` (API: `POST https://api.yinglong-agent.tech/v1/challenge/attempt`) |
| 6 | Read the security self-assessment (tiers + known risks) | [`docs/SECURITY_SELF_ASSESSMENT.md`](SECURITY_SELF_ASSESSMENT.md) |

## 2. What to click

| Route | What you see | What to check |
|---|---|---|
| `/app` | Nadia's agent: activity table, Authority panel, Hash Ring | Each row has a state word and, if on chain, a hash with its ledger badge |
| `/approve/[id]` | The approval card | The card decodes the call itself and only signs one of the six allowed message kinds |
| `/treasury` | Lotus Lane Shenzhen (coin-free rail) and Hong Kong | 2-of-3 director queue; rail label under the entity switch |
| `/supervisor` | Registry of agents; Verify drawer | Merkle path from a receipt to its anchor; "Pause agent" pauses, never spends |
| `/proof` | Proof Center | Every number carries its source |
| `/challenge` | Judge's Challenge board | Which of the nine scales stopped each attack; revert hashes |

## 3. What to verify

| Claim | How to check it | Expected |
|---|---|---|
| The mandate on chain is exactly the one the user sealed | `yinglong verify <mandateHash> --chain fisco --rpc https://api.yinglong-agent.tech/rpc/fisco` (mandate hashes are in `PROOF.md` and `docs/EXECUTION_EVIDENCE.md`) | Sentences decoded from the published caveats; delegation hash recomputes; status live; enforcer code hashes match |
| Same enforcer bytecode on two ledgers | `docs/EXECUTION_EVIDENCE.md`, "Contracts and code hashes" | <!-- gen:chain.bytecode.equal -->38<!-- /gen --> of <!-- gen:chain.bytecode.total -->46<!-- /gen --> identical (<!-- gen:chain.bytecode.pair -->Base Sepolia vs FISCO BCOS<!-- /gen -->); differences are framework contracts with deployment-time immutables |
| Attacks revert on chain with a typed reason | `yinglong verify-tx <hash> --chain fisco --rpc https://api.yinglong-agent.tech/rpc/fisco`, or the decoder in step 3 | e.g. `PayeeNotVerified`, `UnsuitableProduct`, `Paused` |
| Pause works | Pause transaction in `PROOF.md`, then the next attempt | Redemptions revert `Paused` until the principal resumes |
| The agent cannot widen its own authority | `contracts/test/invariants/MandateInvariants.t.sol` (stateful fuzzing) and `contracts/test/NadiaMandate.t.sol` | Caps, reserve floor, pause, verified payees and signer set hold under fuzzing |

## 4. What is real, what is simulated

| Item | Status |
|---|---|
| Transactions on FISCO BCOS 3.17.1 | Real, on a **team-run** consortium chain (4 consensus nodes + 1 observer as the "regulator node", all run by us) |
| Transactions on Base Sepolia | Public testnet; status: <!-- gen:deploy.base.status -->deployed (46 contracts)<!-- /gen --> |
| Local Anvil runs | Development bench only; never presented as live evidence |
| `tHKD`, `tUSD` | Team-minted test units: "Simulation of a regulated instrument; not issued by any licensee" |
| Mainland settlement | e-CNY-style **simulator**; no connection to PBoC or operator-bank systems |
| Harbour Digital Bank, Harbour Bay University, every Agent City company, Nadia, Lotus Lane | **Fictional** |
| Regulator and supervisor | A **role played by the team** |
| Passkeys | The app uses real WebAuthn passkeys; automated runs use scripted passkeys (software P-256 keys) and receipts say so |
| Budget periods on the live server | Time-compressed to one day (`DEMO_PERIOD_SECONDS`), labelled |
| Agent identity code | Placeholder "YL-TEST-...", not an issued code |
| AI models | Named in every receipt (`aigc.model`); when no model answers, a deterministic rule parser is used and named as such |

More: [`docs/TECHNICAL.md`](TECHNICAL.md), [`docs/THREAT_MODEL.md`](THREAT_MODEL.md), [`docs/COMPLIANCE_MATRIX.md`](COMPLIANCE_MATRIX.md) (including the "never claimed" list), [`docs/PIA.md`](PIA.md), [`docs/INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md), [`docs/SECURITY_REVIEW.md`](SECURITY_REVIEW.md).
