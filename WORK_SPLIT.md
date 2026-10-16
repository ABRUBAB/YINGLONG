# Work split

Read this before changing anything. It says who owns which files, the API contract between the front end and the services, and how changes reach `main`.

## Ownership

| Area | Paths | Owner |
|---|---|---|
| Front end: pages, components, styles, theme, charts, animation, 3D, front-end tests | `apps/web/app/**`, `apps/web/components/**`, `apps/web/lib/**`, `apps/web/content/*.ts`, `apps/web/public/**`, `apps/web/tests/**`, `apps/web/*.config.*`, `packages/ui/**` | Front end (R5) |
| Generated front-end data | `apps/web/content/generated/site-data.json` (written by `apps/web/scripts/site-data.mjs`) | Back end regenerates; front end reads |
| Agent runtime and API | `apps/agent/**` (API in `apps/agent/src/server.ts`) | Back end (R1, R3) |
| Signer, services, indexer, simulator | `apps/signer`, `apps/services`, `apps/indexer`, `apps/ecny-sim` | Back end (R3) |
| Contracts, deployments, circuits | `contracts/`, `contracts-fisco/`, `circuits/`; deployments are frozen | Back end (R2) |
| ML, bench | `ml/`, `bench/` | AI/ML (R1, R2, R4) |
| Shared packages | `packages/sdk`, `packages/mandate`, `packages/provenance` | Back end (R1) |
| Infrastructure, scripts, docs | `infra/`, `scripts/`, `docs/`, `README.md`, `PROOF.md` | Back end (R1) |

Change a file outside your area only after agreeing with its owner.

## API contract

- **Base URL:** `NEXT_PUBLIC_AGENT_API` (default `https://api.yinglong-agent.tech`). JSON everywhere.
- **Money:** base-unit integer strings with `decimals`; never floats.
- **Reference:** every route, its authentication and its shapes are in [docs/API.md](docs/API.md), and the front end parses responses with the zod schemas in `apps/web/lib/api/types.ts`.

Routes the front end relies on:

| Purpose | Route | Notes |
|---|---|---|
| Live status | `GET /v1/health` | `ok`, ledgers with block heights, model providers; time the request on the client for "response time" |
| Proof ("verify it yourself") | `GET /v1/proof` | Repository and commit, both ledgers with contracts and bytecode comparison, newest transactions with explorer links, ML metrics with intervals and a confusion matrix, bench results |
| Every transaction | `GET /v1/evidence` | All receipts with a transaction hash, plus every contract with its code hash |
| Audit download | `GET /v1/receipts/:id/audit` | A JSON file: receipt, decision trace with per-check `ms`, transaction, anchor, how to re-verify |
| One receipt | `GET /v1/receipts/:id` | Receipt plus Merkle anchor path |
| Principal state | `GET /v1/principals/:id/state` | Mandate, budgets (spent and remaining per category), pause state |
| Ask the agent | `POST /v1/principals/:id/ask` | Proposal with `scales[]` (the nine checks, each with `status`, `reason`, `ms`), `policy.refusals[]` (rule, typed error, detail), `counterparty`, `simulation`, `tier`, `decision` |
| Execute, bypass | `POST /v1/proposals/:id/execute`, `/bypass` | Receipt with tx hash or typed revert |
| Spending insights | `GET /v1/principals/:id/insights` | Category spend for charts |
| Cash forecast | `GET /v1/principals/:id/forecast` | Quantile bands for the fan chart |
| Hack-it challenge | `GET /v1/challenge/session`, `POST /v1/challenge/attempt`, `GET /v1/challenge/attempts` | Which check stopped each attempt, revert hash |
| Regulator | `GET /v1/registry/agents`, `POST /v1/supervisor/agents/:agentId/halt` | |
| Transaction decoder | `GET /v1/tx/:ledger/:hash` | Decoded call, events, revert |
| Sign-up and log in | `POST /v1/visitors`, `/v1/visitors/:id/seal`, `/v1/visitors/login/challenge`, `/v1/visitors/login` | Passkey or secret key |

Rules for the contract:
1. **Additive only.** The back end only adds fields or routes, never renames or removes them without agreement.
2. **Changes need agreement.** Neither side changes a shape the other uses without telling the other first.
3. **Write it down.** Every change is recorded in `docs/API.md`.
4. **Real data only.** Every number, timer, score and hash the front end shows comes from these routes or from the chain. Data that was recorded rather than live is labelled as recorded.

## Git workflow

1. **Never push to `main` directly.** Each person works on a branch named after the area and the topic, for example `frontend/light-mode` or `backend/proof-api`.
2. **Before pushing, pull and rebase:** `git pull --rebase origin main`.
3. **Run the checks before every push:** `node scripts/check-rules.mjs` (English only, no secrets) and the tests of the packages you changed. For the front end, run `cd apps/web && npx vitest run && pnpm build:e2e && npx playwright test`.
4. **Open a pull request to `main`, one topic per pull request.** CI must be green before merging.
5. **Commit under your own name and email.**
6. **Never commit** keys, `.env` files, personal data or private notes; CI scans the full history.
7. **No force-pushes to `main`.**
