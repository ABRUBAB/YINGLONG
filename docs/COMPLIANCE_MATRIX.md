# YINGLONG Compliance Matrix

*Each rule we cite, what it asks, how YINGLONG answers it in code, which component implements it, and which artefact proves it.*

**Summary (5 lines)**
1. This matrix expands section 7.2 of our plan: every row names the requirement, our implementation, the implementing component and the evidence artefact a reviewer can open.
2. Chinese policy documents are cited by English titles, marked "our translation" where no official English title exists; every row carries a status label, and [S] or [U] rows are secondary or unverified sources.
3. The design maps cleanly onto the three decision classes of the 2026 agent Opinions (item 6), its behaviour fences and traceable records (item 7), and the five areas of the BFIA agent security standard.
4. Where a rule would apply only to a production service (filing, licences, cross-border mechanisms), the row says so and the item is listed under "never claimed".
5. This is a technical mapping, not a legal opinion and not a certification of compliance.

Artefact paths marked *(planned)* do not exist at the time of writing; `scripts/finalize` reports how many listed paths are still missing at release: <!-- gen:compliance.paths_missing -->TBD<!-- /gen -->.

---

## 1. Matrix

| # | Rule (English title) | Status | Requirement | Implementation | Implementing component | Evidence artefact |
|---|---|---|---|---|---|---|
| 1 | HKMA "ART" framework (Accountability, Resilience, Trust), 15 Oct 2026 | [V] | A coming discussion paper "will explore" intent-anchored accountability, a registry of material AI agents and effective intervention mechanisms | Receipts carry intent, plan and decision-record hashes (Vein); passport registry with a supervisor registry view (Pearl); one-tap pause, supervisory pause, DelegationManager halt | `AccountabilityLedger`, `YinglongPassportRegistry`, `KillSwitchRegistry`, `/supervisor` route in `apps/web` | `docs/EXECUTION_EVIDENCE.md` *(planned)*; supervisor pause tx <!-- gen:tx.supervisor_pause.fisco -->TBD<!-- /gen --> |
| 2 | *Implementation Opinions on the Standardized Application and Innovative Development of Intelligent Agents* (CAC with NDRC and MIIT, 8 May 2026; our translation), item 4 | [V] | Agent registry with digital identity, discovery and capability declarations; research into compliant payment | ERC-8004 identity + passport; A2A 1.0 agent cards as capability declarations; x402 paid through ERC-7710 as compliant-payment research | ERC-8004 IdentityRegistry, `YinglongPassportRegistry`, `apps/services`, x402 client in `apps/agent` | Registration and passport tx (`docs/EXECUTION_EVIDENCE.md` *(planned)*) |
| 3 | Same Opinions, item 6 | [V] | Decisions only the user makes / decisions needing user authorisation / autonomous agent decisions; right to know and final say; never exceed the authorised scope | T3 / T2 / T1; T? state; notifications; veto window; enforcers revert anything outside the mandate | Tier function in `apps/agent`; `CoSignEnforcer`, `VetoTimelockEnforcer`, `ForbiddenTargetsEnforcer` and the rest of the enforcer set | Tier tests; invariants (`docs/SECURITY_SELF_ASSESSMENT.md` 5.3); revert evidence |
| 4 | Same Opinions, item 7 | [V] | Built-in rules and behaviour fences; blockchain for verifiable, traceable records | T4 typed reverts; receipts anchored on FISCO BCOS and Base | `contracts/src/utils/Errors.sol` [V, repo], enforcers, `AccountabilityLedger` | Revert tx <!-- gen:tx.revert_payee.base -->TBD<!-- /gen -->; anchors <!-- gen:tx.anchor.fisco -->TBD<!-- /gen --> / <!-- gen:tx.anchor.base -->TBD<!-- /gen --> |
| 5 | Same Opinions, item 11 | [V] | Filing, testing and recall for sensitive fields and key industries (finance is not named explicitly) | **Not performed, not claimed.** A production deployment in financial services would be expected to fall under it. Technical recall capability exists: pause, revoke, supervisory pause | `KillSwitchRegistry`, `MandateRegistry` | Security evidence pack (generated) |
| 6 | *Artificial Intelligence: Agent Interconnection*, GB/Z 185-2026 series (seven guidance documents including identity code and identity management; our translation) | [S] secondary source | National guidance on agent identity codes | `identityCode` field in the passport; demo shows a labelled placeholder "YL-TEST-..."; never an invented official code | `YinglongPassportRegistry`, passport schema in `packages/mandate` | Passport schema; KR-12 |
| 7 | *Security Requirements for Financial Applications of Agent Technology* (Beijing FinTech Industry Alliance group standard, 27 Aug 2026; our translation; number reported as T/BFIA 070-2026, unverified), area 1: initialisation and input security | [S] secondary source | Secure initialisation and input handling | Controls C-IN-01 to C-IN-15 | `apps/agent`, `packages/provenance`, `packages/mandate`, deployment scripts | `docs/SECURITY_SELF_ASSESSMENT.md` chapter 3 |
| 8 | BFIA standard, area 2: model inference and decision security | [S] secondary source | Safe inference and decisions | Controls C-MD-01 to C-MD-14; monotonic-safety rule | `apps/agent` | Self-assessment chapter 4; bench report |
| 9 | BFIA standard, area 3: identity authentication and operation security | [S] secondary source | Authentication, authorisation and operation controls | Controls C-ID-01 to C-ID-17; tiers; invariants | Enforcers, registries, `apps/signer`, approval page | Self-assessment chapter 5; invariant results |
| 10 | BFIA standard, area 4: data security and privacy protection | [S] secondary source | Data protection | Controls C-DP-01 to C-DP-10 | `apps/agent`, `apps/web`, `infra/` | Self-assessment chapter 6; `docs/PIA.md` |
| 11 | BFIA standard, area 5: risk prevention, control and compliance | [S] secondary source | Risk controls and compliance | Controls C-RC-01 to C-RC-16 | `KillSwitchRegistry`, enforcers, `apps/indexer` | Self-assessment chapter 7; `docs/INCIDENT_RESPONSE.md` |
| 12 | BFIA standard: third-party agents may not operate a financial app's interface without the institution's authorisation (press summaries: "dual authorisation") | [S] secondary source | Institution authorisation for third-party agents | The agent never operates an institution's app interface; it acts only through the user's own account; the passport carries institution attestations | `YinglongPassportRegistry`, `VerifiedPayeeEnforcer` | Attestation tx in beat 1 (`docs/EXECUTION_EVIDENCE.md` *(planned)*) |
| 13 | BFIA standard: device capture must follow the called party's policy | [S] secondary source | No uncontrolled screen or microphone capture | Quarantined readers read only files the user supplies; no screen or microphone capture | `apps/agent` readers | Code review (C-IN-15) |
| 14 | *Guiding Opinions on the Safe Development and Application of AI in the Banking and Insurance Industries* (NFRA, 18 Jun 2026; reported as Document No. 8 of 2026; our translation) | [V] for risk tiers, admission control for high-risk use, human supervision at key stages, explainability; [S] secondary source for fund transfers as high-risk, emergency shutdown, labelling | Risk tiers; admission control; human supervision; explainability | T0 to T4 + T?; first payment to a new counterparty and first sweep at T2; T3 reserved; explanation cards; pause; AI labels | Tier function, `CoSignEnforcer`, explainer, `KillSwitchRegistry` | Bench report; UI tests |
| 15 | PBoC Science and Technology Department remarks, 28 Dec 2025 | [S] secondary source | Final decisions by people; supervision at key steps; intervention in emergencies | Sealing and T3; T2; pause | Mandate Studio, `CoSignEnforcer`, `KillSwitchRegistry` | Beats 2, 5, 11 evidence |
| 16 | *Notice of the PBoC and Seven Other Departments on Further Preventing and Handling Risks Related to Virtual Currencies* (Yin Fa [2026] No. 42, 6 Feb 2026; our translation) | [S] secondary source (full-text repost; verify on pbc.gov.cn) | No virtual-currency business; no offshore RMB-pegged stablecoins without approval; no domestic RWA tokenisation outside approved infrastructure; overseas entities may not serve mainland users | Coin-free mainland rail; `JurisdictionEnforcer`; vocabulary rules; public-testnet surfaces hold test units only and never read as a service to mainland users | `JurisdictionEnforcer`, rail adapters, `apps/ecny-sim` | `RailNotPermitted` revert (beat 10) |
| 17 | e-CNY as account-based "digital deposit money" from 1 Jan 2026; e-CNY smart contracts used for subsidies, promotions and prepaid-fund supervision | [S] secondary source | Programmable money only through operator banks | e-CNY-style conditional-payment **simulator** modelled on public pilots; never "issue", "wrap" or "integrate" | `apps/ecny-sim`, `ConditionalPaymentInstructions` | On-screen label "e-CNY-style simulator. Not the PBoC sandbox; no connection to PBoC or operator-bank systems." |
| 18 | PIPL Art. 24 (*Personal Information Protection Law of the People's Republic of China*; our translation) | [S] secondary source (our summary of the statute) | Automated decisions: transparency, explanation, right to refuse | Explanation per decision; ask (T?) and passkey override; pause; zero-cap mandate option | Explainer, orchestrator, `KillSwitchRegistry` | `docs/PIA.md` section 5 |
| 19 | PIPL Arts. 28 to 29 | [S] secondary source | Sensitive personal information (financial accounts); separate consent | Fictional data in the demo; separate consent screen designed for production; on-chain minimisation | Schemas, `apps/web` | `docs/PIA.md` section 4 |
| 20 | PIPL Arts. 38 to 39 | [S] secondary source | Cross-border transfer mechanisms; notice and separate consent | Mainland profile: domestic model endpoints, local sanctions list (no address export), no free APIs. Gap DC-07 (Hong Kong hosting; international model region) | Provider configuration in `apps/agent` | `docs/PIA.md` section 6 |
| 21 | PIPL Art. 55 | [S] secondary source | Personal information impact assessment | This project's PIA | — | `docs/PIA.md` |
| 22 | *Measures for Labelling AI-Generated Synthetic Content* (our translation) and GB 45438-2025 *Cybersecurity technology: Labeling method for content generated by artificial intelligence*, both in force 1 Sep 2025 | [S] secondary source | Explicit and implicit labels on AI-generated content | "AI-generated" chip (explicit); `aigc` block in every receipt (implicit metadata) | `apps/web`, receipt schema in `packages/mandate` | Receipt schema test |
| 23 | *Interim Measures for the Management of Generative AI Services* (2023; our translation) | [S] secondary source | Filed models for public services in China | Mainland profile uses domestic models or our on-device model; the demo offers no public service in China. Filing not performed | Provider configuration | Provider config |
| 24 | HK Stablecoins Ordinance (Cap. 656), in force 1 Aug 2025 | [S] secondary source | Licensed issuers only | `tHKD` labelled "Test units. Simulation of a regulated instrument; not issued by any licensee." | `TestHKD`, `apps/web` labels | Labels |
| 25 | *Regulations on the Supervision and Administration of Non-bank Payment Institutions* (State Council Decree No. 768, in force 1 May 2024; our translation) | [S] secondary source | Holding customer funds needs a licence | Non-custodial primary path (the user's own smart account); any agent-held fallback account labelled custodial | Architecture | Architecture section of `docs/TECHNICAL.md` *(planned)* |
| 26 | OWASP Top 10 for Agentic Applications 2026 (ASI01 to ASI10) | [S] secondary source | Agentic threat coverage | Controls per risk and BFIA area | — | `docs/THREAT_MODEL.md` section 6 |

---

## 2. Never claimed

YINGLONG does not claim, and no YINGLONG document, slide, video or interface may state or imply:

| Never claimed | What is true instead |
|---|---|
| A bank partnership or any institutional partnership | All institutions in the demo (Harbour Digital Bank, Harbour Bay University and every Agent City participant) are fictional |
| e-CNY integration, or any connection to PBoC or operator-bank systems | An e-CNY-style simulator, labelled |
| A licence of any kind (payment, stablecoin, virtual asset, banking) | None held |
| An issued GB/Z 185 identity code | `identityCode` is a labelled placeholder |
| A third-party audit | Internal review only; `docs/SECURITY_REVIEW.md` says so on its title page |
| Production readiness | Testnets and a team-run consortium chain; test units only |
| Filing under item 11 of the agent Opinions or generative-AI service filing | Not performed |
| Involvement of a regulator | The "regulator node" and "supervisor" are roles played by the team (KR-04, KR-18) |
| Partnership, sponsorship or endorsement by Base, MetaMask, Circle, FISCO BCOS, WeBank, HashKey, Conflux or any other named project | "All third-party marks are the property of their respective owners. No partnership, sponsorship or endorsement is implied." |
| Real money | Test units and testnet assets with no monetary value |
| "World's first" | "To our knowledge" wording only |
| Compliance certification | This matrix is a technical mapping, not a legal opinion |
