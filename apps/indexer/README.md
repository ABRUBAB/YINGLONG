# apps/indexer — anchoring relayer, breaker watcher, read-only FISCO RPC proxy

One Hono process, port **8791**, with three jobs.

## 1. Anchoring relayer (`anchoring-relayer` key)

Pulls accountability receipts, batches them, builds a **sorted-pair Merkle tree** (the OpenZeppelin
`MerkleProof` convention, so proofs verify with `AccountabilityLedger.verifyReceipt`), anchors the batch root
on **every configured ledger** (`anchorBatch`), then **cross-anchors** each ledger with the others' latest
root, block number and block hash (`crossAnchor`). Batches and per-receipt proofs are kept in a local JSON
store.

- **Source**: the agent API `GET <AGENT_API_URL>/v1/receipts?since=<n>` (JSON array of receipts in the shape
  of `packages/sdk/src/receipt.ts`, bigint fields as strings). Until the agent is running, set `RECEIPTS_FILE`
  to a JSONL path instead (one receipt — or one agent-API `receiptView` — per line).
- **Leaf**: a receipt's Merkle leaf is its EIP-712 hash under the `AccountabilityLedger` domain of the ledger
  the action happened on (`receipt.source`), recomputed exactly as `apps/agent` did and checked against any
  `receiptHash` the API already carried.
- **Batch trigger**: `BATCH_MAX_RECEIPTS` receipts, or `BATCH_MAX_AGE_MS` since the first pending receipt.

| Method | Path | Purpose |
|---|---|---|
| GET | `/proof/:receiptId` | `{ receipt, receiptHash, batchId, index, proof, root, anchors:[{ledger,txHash,blockNumber,onchainBatchId}] }`; add `?verify=1` to also run `verifyReceipt` on-chain |
| GET | `/status` · `/batches` | Relayer status and anchored batches |
| POST | `/anchor-now` · `/pull` | Force a batch / pull now (admin) |

## 2. Breaker watcher (`breaker-watcher` key)

`POST /breaker/trip { account, reason, ledger? }` -> `KillSwitchRegistry.trip(account)`. The watcher key must
be configured as a **guardian** of the account (it can only pause, never unpause or spend); if it is not, the
response says so and nothing is sent. `GET /breaker/status/:account` reports the trip and guardian state.

## 3. Read-only FISCO JSON-RPC proxy

`POST /rpc/fisco` is the **only public path** to the FISCO ledger (its own auth is off, so write methods must
never be exposed). It forwards an allowlist of **read methods only** — `eth_chainId`, `net_version`,
`eth_blockNumber`, `eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_getTransactionByHash`,
`eth_getTransactionReceipt`, `eth_call`, `eth_getLogs` (bounded block range, `blockHash` filters rejected),
`eth_getCode`, `eth_getBalance`, `eth_getStorageAt` — and rejects everything else (writes, admin, debug,
trace) with `-32601`. Per-IP rate limits apply; batches are all-or-nothing.

## Run

```sh
# anchor on anvil, read receipts from a file, no FISCO proxy
RECEIPTS_FILE=./receipts.jsonl ANCHOR_LEDGERS=anvil pnpm --filter @yinglong/indexer start

# anchor on both ledgers (two-way cross-anchoring), proxy the FISCO RPC
ANCHOR_LEDGERS=anvil,fisco AGENT_API_URL=http://127.0.0.1:8787 \
FISCO_RPC_URL=http://127.0.0.1:8545 pnpm --filter @yinglong/indexer start
```

## Environment

| Var | Default | Meaning |
|---|---|---|
| `ANCHOR_LEDGERS` | `anvil` | Comma-separated ledgers to anchor on |
| `BREAKER_LEDGERS` | = anchor ledgers | Ledgers whose kill switch the breaker can trip |
| `ANVIL_RPC_URL` / `BASE_SEPOLIA_RPC_URL` / `FISCO_RPC_URL` | profile defaults | RPC overrides |
| `AGENT_API_URL` | `http://127.0.0.1:8787` | Agent receipts API base (ignored if `RECEIPTS_FILE` is set) |
| `RECEIPTS_FILE` | — | JSONL receipts source (file mode) |
| `RECEIPTS_PRINCIPAL` | — | Filter the agent API by principal |
| `BATCH_MAX_RECEIPTS` / `BATCH_MAX_AGE_MS` | `16` / `300000` | Batch triggers |
| `INDEXER_POLL_MS` | `15000` | Relayer tick interval |
| `INDEXER_AUTOSTART` | `1` | Start the relayer loop on boot |
| `INDEXER_DATA_DIR` | `./data` | Local batch/proof store |
| `FISCO_PROXY_RATE_PER_MIN` | `120` | Per-IP rate limit for `/rpc/fisco` |
| `FISCO_PROXY_MAX_BLOCK_RANGE` | `5000` | Max `eth_getLogs` block span forwarded |
| `INDEXER_ADMIN_TOKEN` | — | If set, required as `x-admin-token` for admin routes |

## Tests

`pnpm --filter @yinglong/indexer test` (needs the local Anvil deployment): anchor 5 fake receipts and verify
a proof via `AccountabilityLedger.verifyReceipt`; the FISCO proxy rejects `eth_sendRawTransaction` and other
write/admin/debug methods, bounds `eth_getLogs`, forwards reads, and rate-limits per IP. Anchoring and
on-chain verification confirmed on live FISCO as well.
