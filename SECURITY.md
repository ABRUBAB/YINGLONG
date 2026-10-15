# Security Policy

**Summary (5 lines)**
1. YINGLONG is a student hackathon project running on testnets and a team-run FISCO BCOS test chain; it holds no real funds, and there is no bug bounty.
2. Please report vulnerabilities privately through GitHub's private vulnerability reporting on this repository; do not open a public issue with details.
3. Good-faith research within the scope below is welcome, and we will not pursue anyone who follows these rules.
4. The Judge's Challenge is the sanctioned public attack surface: attack the agent there as much as the quotas allow.
5. Known risks are documented in `docs/SECURITY_SELF_ASSESSMENT.md` (KR-01 to KR-19); please report anything that goes beyond the residual risk stated there.

## Project status

| Item | Status |
|---|---|
| Networks | Base Sepolia (public testnet) and a FISCO BCOS chain run by the team |
| Value at risk | Test units and testnet assets with no monetary value |
| Audit | No third-party audit; internal review in `docs/SECURITY_REVIEW.md` |
| Production use | Not intended. Do not use YINGLONG with real funds or real personal data |

## Scope

| In scope | Out of scope |
|---|---|
| Code in this repository: contracts under `contracts/src`, `apps/*`, `packages/*`, `tools/verify-py`, `circuits/` | Third-party code and services: the MetaMask Delegation Framework itself, the canonical DelegationManager on Base Sepolia, USDC, Base, x402 facilitators, model APIs, hosting providers (report those to their owners) |
| YINGLONG contracts deployed on Base Sepolia and on our FISCO BCOS chain (addresses in `deployments/`) | Mainnets (we deploy nothing there) |
| The demo site `yinglong-agent.tech` and its `app.` and `api.` subdomains | Volumetric denial of service, spam, social engineering of the team, physical attacks |
| The Judge's Challenge, within its published quotas | Attacks on other visitors, or on data they submitted |

Especially interesting to us: any way to move value outside a sealed mandate; any way to reach a reserved (T3) function through a delegation; any way to get the user's passkey to sign a message outside the signing-domain allowlist; any way to make an AI signal lower a tier; replay of approvals, proofs or delegations; anything that makes a receipt or anchor lie.

## How to report

1. Use **GitHub private vulnerability reporting** on this repository (Security tab, "Report a vulnerability").
2. If that option is unavailable, open a public issue titled "Security contact request" **with no details**; we will reply with a private channel.

Please include: the component and commit or deployed address; the steps or a proof-of-concept (a Foundry test is ideal); what you expected and what happened; any transaction hashes. Do not include real personal data.

## What we will do

| Step | Commitment |
|---|---|
| Acknowledge | We aim to acknowledge within three days during the competition period (until 23 Nov 2026). We are a student team and cannot offer a service level |
| Assess | We assign a severity using the definitions in `docs/SECURITY_REVIEW.md` |
| Fix | Fixes land in a new tag. The `v1.0-submission` tag is never moved, so evaluators see exactly what was submitted; any later fix is labelled as post-submission |
| Disclose | Coordinated disclosure through a GitHub Security Advisory once a fix or mitigation exists, and an entry in `docs/SECURITY_REVIEW.md` crediting you if you wish |

## Safe harbour

We will not take action against research that: stays within the scope above; uses only testnet funds and your own accounts or guest mandates; does not access, change or delete other people's data; does not degrade the service for others; and gives us reasonable time to respond before public disclosure.

## Judge's Challenge rules

Scan a QR code to get a guest mandate with tiny caps funded with test units. Each QR allows a limited number of attacks per day, and the site switches to a labelled "shadow mode" on a local fork when the daily gas budget is spent. Submissions are kept for 30 days; please do not type personal information. Attacks there are the point of the exercise, not a policy violation.
