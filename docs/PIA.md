# YINGLONG Personal Information Impact Assessment

*Self-assessment under the Personal Information Protection Law of the People's Republic of China (PIPL, in force 1 Nov 2021; our translation of the title), Articles 24, 28 to 29, 38 to 39 and 55.*

**Summary (5 lines)**
1. The demo processes no real customer data: every account holder, company, bank, university and counterparty is fictional, and all training and bench data is synthetic or drawn from public datasets with no identifiers added by us.
2. Real personal information still exists at the edges: Judge's Challenge submissions, user-study answers, web access logs, and any person filmed for the video; each has a purpose, a consent step and a retention limit below.
3. The agent makes automated decisions inside a mandate the user sealed; each decision comes with an explanation, the user can make the agent ask instead of act, override an "ask" with a passkey, and pause everything with one tap (Art. 24).
4. Financial account information is sensitive personal information (Art. 28); what reaches a public chain is limited to addresses, hashes and mandate terms, and the public mandate terms themselves are flagged as a production blocker (DC-08).
5. The mainland profile uses domestic model endpoints and a local sanctions list, but today's hosting (Hong Kong VPS) and one planned model region sit outside the mainland, so a production deployment would need a PIPL cross-border mechanism (DC-07).

| Field | Value |
|---|---|
| Handler (today) | The YINGLONG team, as operator of a competition demo |
| Handler (production) | The deploying institution; this document would be redone by it |
| Assessed release | <!-- gen:meta.release_tag -->bb338d0<!-- /gen --> at commit <!-- gen:meta.commit -->bb338d0a6c634d327bb3acfd70e70f4d406deb83 (working tree had uncommitted changes)<!-- /gen --> |
| Related | `docs/SECURITY_SELF_ASSESSMENT.md` chapter 6 (controls C-DP-01 to C-DP-10), `docs/COMPLIANCE_MATRIX.md` |

Article summaries below are our reading of the statute [S, secondary source: our summary; verify against the authoritative text before quoting]. This assessment is not legal advice.

---

## 1. Why an assessment is required (Art. 55)

Art. 55 requires an impact assessment before, among other things: processing sensitive personal information; using personal information for automated decision-making; entrusting processing to, or providing data to, other handlers; and providing personal information abroad [S]. A production YINGLONG would trigger all four:

| Art. 55 trigger | YINGLONG feature |
|---|---|
| Sensitive personal information | Financial account information: balances, payees, mandate limits, transaction history |
| Automated decision-making | T1 actions taken by the agent alone inside the mandate |
| Providing data to other handlers | Model API providers; counterparties receiving payments; the regulator node |
| Cross-border provision | Public-chain publication; model APIs outside the mainland; hosting outside the mainland |

Art. 56 describes the content (lawfulness, legitimacy and necessity of purpose and method; impact on rights and security risks; whether protective measures are lawful, effective and proportionate) and asks that the report be kept for at least three years [S]. Sections 2 to 9 follow that content.

---

## 2. Data inventory

PI class: **S** = sensitive personal information (Art. 28), **P** = personal information, **N** = not personal information, **F** = fictional (looks like PI, describes no real person).

| # | Data item | Subjects | Source | Purpose | Where it lives | Public chain? | Class (demo / production) | Retention |
|---|---|---|---|---|---|---|---|---|
| D1 | Passkey private key | User | User's authenticator | Sign seals, approvals, pauses | Inside the authenticator only; never leaves it | No | — | User controls |
| D2 | Passkey public key (P-256 coordinates), key ID | User | Onboarding | Verify signatures on-chain | Smart-account storage | Yes | F / P | Permanent (on-chain) |
| D3 | Biometric used to unlock the passkey | User | Device | Local user verification | Device only; YINGLONG never receives it | No | — | Not processed by us |
| D4 | Smart-account address, user DID | User | Onboarding | Identify the delegator | Chain, Postgres | Yes | F / P | Permanent (on-chain) |
| D5 | Mandate text as typed or spoken (English, Bangla or Chinese input) | User | User | Compile the mandate | Browser; runtime memory; model provider if an API model is used | No | F / S (amounts, payees) | Not stored after compilation [I]; audio not retained [I] |
| D6 | Compiled mandate terms (caps, payee addresses, categories, reserve floor, validity, jurisdiction) | User | Compiler | Enforcement; round-trip verification | `MandateRegistry` caveat array; Postgres | **Yes** | F / **S** | Permanent (on-chain) — see DC-08 |
| D7 | `PayeeBook` entries (address, category) | User, payees | User (T3) | Payee gate, budgets | `PayeeBook` contract | Yes | F / S | Permanent (on-chain) |
| D8 | Payee display names and notes | User, payees | User | Show names to the user | Postgres only, never on chain (C-DP-01) | No | F / P | Account lifetime |
| D9 | Intents, plans, decision records, explanations | User | Runtime | Act, explain, audit | Postgres; hashes in receipts | Hashes only | F / S | Competition period [I] |
| D10 | Receipts | User, agent, counterparty | Runtime | Accountability | Postgres (full); `AccountabilityLedger` events and Merkle roots (hashes, ids) | Hashes and ids | F / S | Permanent (on-chain part) |
| D11 | Invoice images, emails, messages fed to the agent | Senders, user | Counterparties, user | Read amounts and payees in quarantine | Runtime; model provider if an API model is used | No | F / P | Not retained after the action [I] |
| D12 | Chat with Ying | User | User | Conversation | Postgres | No | F / P | Competition period [I] |
| D13 | Passport credential (owner DID, `identityCode` placeholder, attestations) | Agent, user | Issuers | Agent identity | VC off-chain; hash on chain | Hash only | F / P | Permanent (hash) |
| D14 | Sanctions list mirror (OFAC SDN, UN) | Listed persons and entities (real, public) | Public lists | Counterparty screening | Local file on the server | No | P (publicly disclosed) | Refreshed copy only |
| D15 | Judge's Challenge submissions (handle, attack text, QR token id, time) | Visitors (real) | Visitors | Public attack demonstration; post-submission retraining only with consent | Postgres; public board shows handle, family, stopping scale, revert hash | Revert hashes only | **P** | **30 days** [plan section 12.1] |
| D16 | User-study answers (comprehension answers, timings, SUS score) | Participants (real, anonymous) | Participants | Usability evidence | Study tool storage | No | P (anonymous by design) | Until the report; then aggregate only [I] |
| D17 | Web access logs (IP address, user agent, time) | Visitors (real) | Caddy | Security and abuse control | VPS | No | P | 30 days [I, proposal] |
| D18 | Video footage of a non-team person attacking from a phone (plan section 22.2) | That person (real) | Recording | Demo video | Video hosting | No | P | Life of the video; written consent required [I] |
| D19 | Training and bench data | None (synthetic) or third parties in public corpora | Generated; public datasets | Train and evaluate models | Kaggle, HuggingFace (private for Chinese-script data), `bench/`, `ml/data` | No | N / incidental P | Per dataset licence |
| D20 | Model prompts and outputs at API providers | User (demo: fictional) | Runtime | Inference | Provider (may log, KR-14) | No | F / S | Provider's policy |

---

## 3. Purpose, necessity and minimisation

| Principle | How YINGLONG applies it |
|---|---|
| Purpose limitation | Every item in section 2 has one stated purpose; receipts and decision records serve accountability, not marketing or profiling |
| Necessity on chain | Only what an enforcer must read goes on chain: addresses, categories, limits, hashes. Names, notes, documents and chat never do (C-DP-01) |
| Quarantine as minimisation | Readers turn documents into a closed schema of numbers, enums and opaque handles; the planner never sees the document text (C-IN-10) |
| PII scrubber | Removes mainland mobile numbers, 18-digit ID numbers, UnionPay card numbers, private keys and seed phrases before any third-party model call (C-IN-08, C-DP-02); measured recall <!-- gen:pia.scrubber.recall -->57/75 = 76.0% (Wilson 95% interval 65.2% to 84.2%, n = 75) on a labelled synthetic set; by kind: mainland-mobile 12/20, mainland-id 12/12, unionpay-card 16/16, private-key 8/12, seed-phrase 9/15; formats missed: mainland-mobile 3-4-4 with spaces; mainland-mobile 3-4-4 with dashes; private-key 64 hex without 0x; seed-phrase 12 words, no keyword; seed-phrase 12 numbered words; false positives on 3 of 10 benign strings (transaction hash (0x + 64 hex); ordinary sentence starting with 'recovery') (apps/agent/test/scrubber.test.ts)<!-- /gen --> |
| No biometric processing | Passkey biometrics stay in the authenticator; we receive a signature only |
| Remaining gap | The full caveat array is published on Base for round-trip verification. For a real person this discloses spending limits and payee addresses. Production default should be the private mandate (`ZKMandateEnforcer`) or consortium-only publication (DC-08) |

---

## 4. Sensitive personal information (Arts. 28 to 29)

Art. 28 lists financial accounts among sensitive personal information and allows processing only for a specific purpose, with sufficient necessity and strict protection; Art. 29 requires separate consent [S].

| Requirement | Demo | Production design |
|---|---|---|
| Specific purpose and necessity | Fictional data only | The mandate is the purpose statement: the user's own rules for the agent |
| Separate consent (Art. 29) | Not applicable (no real users) | A separate consent screen before the first seal, distinct from terms of use, naming the data in D6, D7, D9, D10 and the on-chain publication [I] |
| Notice of necessity and impact | Labels and this document | Shown at sealing, including "these terms will be public on a ledger" if publication is retained |
| Strict protection | Controls C-DP-01 to C-DP-10 | Plus mainland residency (DC-07) and private mandates (DC-08) |
| Minors | Not intended for minors; user-study participants must be adults [I] | Age gate |

---

## 5. Automated decision-making (Art. 24)

Art. 24 asks for transparency and fair results, forbids unreasonable differential treatment in transaction prices, and gives individuals the right to an explanation and the right to refuse decisions made solely by automated means that significantly affect their rights [S].

| Art. 24 element | YINGLONG mechanism | Where |
|---|---|---|
| Transparency | The mandate is decoded back into sentences and shown before sealing; every action produces a receipt with the decision record hash | Mandate Studio; receipts |
| Explanation | An explanation card per decision: the facts come from the decision record, the prose is labelled "AI-generated", and every number is filled by code | C-MD-08, C-MD-09 |
| Right to refuse automated decisions | (1) Any action above the T1 cap, any new counterparty and any first sweep needs the user's passkey (T2). (2) The user can seal a mandate with a T1 cap of zero, so nothing happens without approval [I]. (3) One-tap pause stops all automated action. (4) T3 decisions are never automated | Tiers; `KillSwitchRegistry` |
| "Ask" and override | Missing data, conflicts, stale state or AI suspicion put the agent in T? ("not sure, your call"); the user may override with an explicit passkey confirmation, which still passes every deterministic rule and the chain | T? state; `CoSignEnforcer` |
| No unreasonable price discrimination | YINGLONG sets no prices; FX quotes are signed by counterparties and the choice between quotes is a deterministic rule | Policy engine |
| AI can only lower its own authority | Monotonic-safety rule | Self-assessment section 2.2 |

---

## 6. Cross-border handling (Arts. 38 to 39)

Art. 38 permits providing personal information abroad only under a listed mechanism (for example a CAC security assessment, certification, or the standard contract); Art. 39 requires telling the individual the overseas recipient's name and contact details, the purpose, method and categories of data, and how to exercise rights, and obtaining separate consent [S].

| Flow | Destination | Crosses the mainland border for a mainland user? | Today | Production |
|---|---|---|---|---|
| Backend hosting | Azure East Asia region (Hong Kong) [plan section 20] | **Yes** (Hong Kong is outside the mainland for PIPL purposes [I]) | Fictional data only | Mainland hosting for the mainland profile (DC-07) |
| FISCO BCOS chain and regulator node | Same VPS (Hong Kong) | **Yes**, for the same reason | Fictional data only | Consortium nodes operated in the mainland |
| Base Sepolia | Public network, global replication | **Yes** (publication) | Addresses, hashes and mandate terms of fictional personas | Mainland profile publishes nothing personal on public chains; anchors carry Merkle roots only |
| Model APIs on the international profile (OpenRouter) | Outside the mainland | Yes | Not used by the mainland profile | Same |
| DashScope on the mainland profile | The plan names the international region [plan section 10.3] | **Yes** | Not yet used with real data | Mainland region or the on-device model (DC-07) |
| DeepSeek direct, on-device intent model | Domestic provider / user's device | No [I, endpoint location to be confirmed] | Mainland profile default | Same, plus filed-model check |
| Sanctions screening | Local mirror on our server | No export of addresses to screening services | As designed | Jurisdiction-appropriate lists (DC-10) |
| Video hosting (YouTube, Bilibili) | Global platforms | Yes, for any filmed person | Consent from any non-team person filmed | — |

**Mainland profile (designed):** domestic model endpoints or the on-device intent model; no free API models; local sanctions list with no address export; SM2/SM3 co-signatures on receipts; coin-free FISCO rail. **Gap:** the mainland profile is a configuration of one deployment that is hosted outside the mainland, so the residency promise holds for model calls only once DC-07 is resolved.

---

## 7. Model providers and training data

| Topic | Position |
|---|---|
| Training data | Synthetic requests, attacks and ledgers generated by us; public datasets under recorded licences (`docs/third_party.md`). We add no real identifiers. Chinese-script data lives only in private HuggingFace datasets referenced by revision and SHA-256, never in the repository |
| Public web corpora | Benign multilingual negatives come from FineWeb-2 (public web text). Such corpora can incidentally contain third-party personal information; we use them only as benign examples, never try to identify anyone, and should run the PII scrubber over them before training [I, action for R4]. Art. 27 allows processing personal information already lawfully disclosed within a reasonable scope [S] |
| Bench data | Personas and counterparties are fictional; Bangla-script labelled data may live in `bench/` and `ml/data` |
| Native-speaker review | Teammates review 200 translated samples per language; no reviewer data is recorded beyond the review result |
| Free API models may log prompts (KR-14) | Only synthetic content is sent; the PII scrubber runs before every API call; the mainland profile uses no free API |
| Judge's Challenge text | Never in the held-out family; used for a post-submission retrain only after the PII scrubber and with the visitor's consent |

---

## 8. Individual rights and security measures

| Right [S] | Demo | Constraint |
|---|---|---|
| Access and copy (Art. 45) | Receipts and decision records are viewable and exportable | — |
| Correction (Art. 46) | `PayeeBook` and mandate changes at T3 | On-chain history keeps the old version |
| Deletion (Art. 47) | Off-chain records (D5, D8, D9, D11, D12, D15, D16, D17) can be deleted | **On-chain data (D2, D4, D6, D7, D10 hashes, D13 hash) cannot be erased.** This is why the on-chain set is minimised and why DC-08 is a production blocker |
| Explanation of processing rules (Art. 48) | This document; the mandate decoder; explanation cards | — |

Security measures (Art. 51 [S]): controls C-DP-01 to C-DP-10 and the security self-assessment as a whole; secrets outside the tree; TLS; strict CSP; no request leaves our origin; backups; incident playbooks (`docs/INCIDENT_RESPONSE.md`). Art. 57 asks for immediate remedial action and notification after a leak [S]; playbook steps include notification.

---

## 9. Risk register

Ratings are our qualitative judgement [I]. L = low, M = medium, H = high.

| Risk | Likelihood | Impact | Treatment | Residual (demo) | Residual (production, as designed) |
|---|---|---|---|---|---|
| Public mandate terms disclose a person's spending rules | H (by design) | M | Fictional personas; private mandate available | L | **H until DC-08 is resolved** |
| Prompts logged by an API provider | M | M | Scrubber; synthetic data; no free API on mainland | L | M |
| Mainland data processed outside the mainland | H (by current hosting) | M | Fictional data only | L | **H until DC-07 is resolved** |
| Challenge visitor types personal data | M | L | Consent line; 30-day retention; scrubber | L | — |
| Filmed person's image published | L | L | Written consent | L | — |
| Incidental PI in public training corpora | M | L | Benign-only use; scrubber [I] | L | L |
| Re-identification from on-chain addresses | M | M | No names on chain; separate payee labels off-chain | L | M |
| Access-log IP addresses | H | L | Short retention | L | L |

---

## 10. Conclusion and open items

For the competition demo the residual personal-information risk is low, because every account holder is fictional and the real personal information we hold (D15 to D18) is small, consented and short-lived. A production deployment would be blocked by two items until resolved: **DC-07** (mainland residency of hosting and model calls) and **DC-08** (public caveat arrays). A deploying institution would also need separate-consent flows for sensitive data, a cross-border mechanism under Art. 38 for any remaining flow, and a deletion policy that accepts the immutability of on-chain records.

| Open item | Owner |
|---|---|
| Confirm retention periods marked [I] | Lead |
| Scrub public corpora before training | R4 |
| Consent text for the video participant and the Judge's Challenge | R5 |
| DashScope region and DeepSeek endpoint location for the mainland profile | R3 |
