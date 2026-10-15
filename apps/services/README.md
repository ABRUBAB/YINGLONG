# apps/services — Agent City services, Mirage, x402 seller

One Node process (Hono, port 8790) that hosts the fictional **Agent City** service agents, each with its own
role key and passport identity. All agents, institutions and amounts are fictional, for a hackathon
demonstration. **Test units only, no monetary value.**

## What it serves

- **Pearl River FX Desk** (`svc-pearl-river-fx`) and **Victoria FX** (`svc-victoria-fx`) — signed FX quotes
  over **x402 v2** (`exact` scheme, `erc7710` asset-transfer method). The desk settles the payment itself
  (**seller-settled**): it redeems the payer's single-use child delegation through the DelegationManager,
  waits for the receipt, and only then returns a `SignedQuoteSettlement` EIP-712 Quote (amountOut from a
  fixed demo rate table, expiry 120 s, unique nonce) plus the settlement tx hash in a header.
- **KYB Verifier** (`svc-kyb-verifier`) — a signed KYB result (EIP-712) behind the same x402 flow; attests
  demo merchants on-chain during setup.
- **Mirage** (`mirage`) — the fictional rogue agent **for security testing**: a self-signed agent card whose
  key is not registered, a look-alike `payTo`, injected instructions in the 402 `description`/memo, and
  clearly-labelled phishing fixtures. It has **no** trusted-issuer attestation, so the counterparty scale
  refuses it.
- **A2A agent cards** at `GET /agents/:slug/.well-known/agent-card.json`, canonicalised with RFC 8785 (JCS)
  and signed with JWS **ES256**. The JWKS is published at `/agents/:slug/.well-known/jwks.json`; the card's
  `kid` and `keccak256(JCS(JWKS))` are what `YinglongPassportRegistry` stores. Mirage's card is signed with a
  key that is **not** the registered one, so it fails `kid` / JWKS-hash verification.
- Merchant payee identities (landlord, bursar, suppliers, scholarship foundation) with passports.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Service index and the fee asset / settlement mode |
| GET | `/healthz` | Liveness |
| GET | `/fx/:desk/quote?payer=&inToken=&outToken=&amountIn=` | x402-protected signed FX quote (`:desk` = `pearl-river`, `victoria`, `mirage`) |
| GET | `/kyb/:address` | x402-protected signed KYB result |
| GET | `/agents/:slug/.well-known/agent-card.json` | Signed A2A card |
| GET | `/agents/:slug/.well-known/jwks.json` | Card JWKS |
| GET | `/agents/:slug/registration.json` | ERC-8004-style registration file |
| POST | `/verify-card` | `{ card, trustedIssuers? }` -> the counterparty scale's verdict |
| GET | `/agents/mirage/passport-credential.json`, `/agents/mirage/fixtures/email.json`, `/agents/mirage/fixtures/invoice.json`, `/agents/mirage/look-alikes.json` | Labelled rogue fixtures for the attack beats |
| GET | `/admin/liquidity` · POST `/admin/liquidity/refill` | FX liquidity (test ledgers) |

### x402 flow (per the spec)

1. No `PAYMENT-SIGNATURE` header -> **402** with a base64 `PAYMENT-REQUIRED` header (a `PaymentRequired` with
   `accepts[0]` = `{scheme:"exact", network:"eip155:<chainId>", amount:<fee>, asset:<tUSD/USDC>, payTo:<desk
   wallet>, maxTimeoutSeconds, extra:{assetTransferMethod:"erc7710", …, childCaveats}}`).
2. The payer builds a single-use child delegation **agent -> seller** carrying `ERC20TransferAmount(asset,
   exact fee)` + `LimitedCalls(1)` + `Timestamp(<= 300 s)`, ABI-encodes the `Delegation[]` chain as
   `permissionContext`, and resends with `PAYMENT-SIGNATURE` = base64 of the `PaymentPayload`
   (`payload = {delegationManager, permissionContext, delegator}`).
3. The seller validates the child structurally, simulates `redeemDelegations`, produces the resource,
   **settles** (redeem + wait for the receipt + check the Transfer), and returns **200** with the resource,
   a `PAYMENT-RESPONSE` header and `X-Settlement-Tx`. Nothing is delivered before settlement;
   `settlement_pending` means unpaid.

## Settlement modes (`X402_SETTLEMENT`)

- `seller` (default) — the desk's own wallet is the leaf delegate and submits the redemption.
- `yinglong-facilitator` — the leaf delegate is YINGLONG's `facilitator` role (use when the payer pins that
  facilitator in `AgentLineageEnforcer`).
- `metamask-facilitator` — **Base Sepolia only**: forwards `/verify` and `/settle` to MetaMask's x402
  facilitator; the leaf delegate is the facilitator signer (plan section 9.2).

## Run

```sh
# from the repo root (loads keys from ../.secrets at runtime; never printed)
pnpm --filter @yinglong/services setup            # idempotent on-chain setup (anvil)
pnpm --filter @yinglong/services start            # serve on :8790

# FISCO
FISCO_RPC_URL=http://127.0.0.1:8545 pnpm --filter @yinglong/services setup -- --ledger fisco
LEDGER=fisco FISCO_RPC_URL=http://127.0.0.1:8545 pnpm --filter @yinglong/services start
```

`scripts/setup.ts` registers/attests **only service agents** (Mirage gets no attestation), mints test units,
and funds FX liquidity. It does **not** register `agent-ying` or `agent-treasurer`: their owner DID is the
principal's smart-account DID, known only to the agent runtime, which registers them itself.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `LEDGER` | `anvil` | `anvil` \| `base-sepolia` \| `fisco` |
| `RPC_URL` | profile default | Override the ledger RPC |
| `SERVICES_PORT` | `8790` | HTTP port |
| `SERVICES_PUBLIC_URL` | `http://127.0.0.1:8790` | Base URL used in cards / `jku` / registration files |
| `X402_SETTLEMENT` | `seller` | `seller` \| `yinglong-facilitator` \| `metamask-facilitator` |
| `X402_ASSET` | `TestUSD` | `TestUSD` \| `TestHKD` \| `USDC` (Base only) \| an address |
| `X402_FX_FEE` / `X402_KYB_FEE` / `X402_MIRAGE_FEE` | `250000` / `1000000` / `100000` | Fees in base units (6 decimals) |
| `X402_MAX_CHILD_WINDOW` | `300` | Max accepted child `Timestamp` window (seconds) |
| `QUOTE_TTL_SECONDS` | `120` | Signed-quote expiry |
| `LIQUIDITY_KEEPER` | `1` | Keep FX liquidity topped up (test ledgers) |
| `SERVICES_ADMIN_TOKEN` | — | If set, required as `x-admin-token` for `/admin/*` |

`state/<ledger>.json` records the service ids and addresses (no secrets).

## Tests

`pnpm --filter @yinglong/services test` (needs the local Anvil deployment): the x402 round trip (a delegation
from a HybridDeleGator account pays a desk and the returned quote is accepted by `SignedQuoteSettlement`),
replay rejection, `QuoteExpired`, and Mirage's card failing `kid` / attestation verification.
