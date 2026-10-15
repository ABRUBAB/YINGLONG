# apps/ecny-sim — e-CNY-style conditional-payment simulator

> **e-CNY-style simulator. Not the PBoC sandbox; no connection to PBoC or operator-bank systems.**

The coin-free mainland rail (plan section 7.1). Nothing on this ledger has monetary value. The simulator
plays the operator bank for `ConditionalPaymentInstructions`: it watches for new instructions, applies
simple deterministic conditions, and calls `execute` or `reject` with a reason code using the operator key
(the **`relayer`** role, which is the CPI operator). It also posts opening balances for demo accounts and
serves a statement per account. One Hono process, port **8792**.

## How it decides

For each pending instruction (polled by sequential **instruction id** via `instructionCount()`, which works
on Anvil and FISCO alike — FISCO's `eth_getLogs` only serves a short recent window):

1. not expired (`validUntil`);
2. **payee known** (in the simulator's known-payee set);
3. purpose allowed (if a purpose allowlist is configured);
4. **condition met** — `conditionHash` is zero (unconditional) or matches a stored invoice / delivery
   confirmation that is marked satisfied;
5. **balance available** — `balanceOf(account)` (posted balance minus pending) covers the amount.

All pass -> `execute(id, ref)`. Otherwise -> `reject(id, reasonHash(code))` with a reason code
(`PAYEE_NOT_KNOWN`, `CONDITION_NOT_MET`, `INSUFFICIENT_BALANCE`, `INSTRUCTION_EXPIRED`,
`PURPOSE_NOT_ALLOWED`).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Index and the CPI contract / operator |
| GET | `/status` | Cursor, counts (executed/rejected), known accounts, recent decisions |
| GET | `/statement/:account` | Posted / available / pending balance and the account's ledger entries |
| GET | `/conditions` | Stored conditions and whether each is satisfied |
| GET | `/instruction/:id` | The decision recorded for one instruction |
| POST | `/poll` | Process new instructions now (admin) |
| POST | `/open-balances` | Post opening balances for demo accounts (admin) |
| POST | `/conditions` · `/conditions/satisfy` | Add a condition / mark one satisfied (admin) |

## Run

```sh
pnpm --filter @yinglong/ecny-sim start                                  # anvil, :8792
LEDGER=fisco FISCO_RPC_URL=http://127.0.0.1:8545 pnpm --filter @yinglong/ecny-sim start
```

On start it posts opening balances for demo accounts and begins polling.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `LEDGER` | `anvil` | `anvil` \| `base-sepolia` \| `fisco` |
| `RPC_URL` / `FISCO_RPC_URL` | profile default | RPC override |
| `ECNY_PORT` | `8792` | HTTP port |
| `ECNY_POLL_MS` | `3000` | Poll interval |
| `ECNY_EXTRA_PAYEES` | — | Comma-separated extra known payee addresses |
| `ECNY_STATE_DIR` | `./state` | Where `<ledger>.json` is written (no secrets) |
| `ECNY_ADMIN_TOKEN` | — | If set, required as `x-admin-token` for admin routes |

## Tests

`pnpm --filter @yinglong/ecny-sim test` (needs the local Anvil deployment): the operator posts an opening
balance, two instructions are issued (one whose invoice condition is satisfied, one whose delivery condition
is not), and the simulator **executes one and rejects one**; then the second executes once its condition is
satisfied. Verified on live FISCO as well.
