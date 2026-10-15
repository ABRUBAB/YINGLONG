# yinglong-verify

`yinglong verify` is the independent Python implementation of YINGLONG's round-trip mandate verification.
It does not import or call any YINGLONG TypeScript. It shares only three kinds of data with the rest of the
repository, all bundled inside the package so it runs from its own subdirectory:

- the deployment tables (`contracts/deployments/*.json`: addresses and runtime code hashes);
- the ABIs exported from the Foundry build output (`contracts/out`);
- the golden vectors written by the TypeScript reference (`packages/mandate/golden/*.json`), used only to
  prove that both implementations agree.

Everything else is re-implemented here: canonical JSON and the mandate hash, the mandate compiler (from the
enforcers' term layouts), the ERC-7710 delegation hash (MetaMask Delegation Framework v1.3.0 `EncoderLib`),
the English decompiler, the Hash Ring, the accountability receipt EIP-712 hash, `docHash`, and the
sorted-pair Merkle proofs.

Ledgers are labelled honestly everywhere: Anvil is a local bench (simulated), Base Sepolia is a public
testnet, FISCO BCOS is a team-run consortium ledger. Amounts are test units.

## Run it (judges)

Needs [uv](https://docs.astral.sh/uv/). Nothing else: no Node, no Foundry, no keys.

```sh
# Offline, against the bundled golden vector: recomputes everything and compares with the TypeScript output.
uvx --from 'git+https://github.com/ABRUBAB/YINGLONG#subdirectory=tools/verify-py' yinglong verify nadia --chain anvil --offline

# Online: a mandate published on a ledger, given by its document, or by its mandate hash alone.
uvx --from 'git+https://github.com/ABRUBAB/YINGLONG#subdirectory=tools/verify-py' yinglong verify path/to/mandate.json --chain base-sepolia
uvx --from 'git+https://github.com/ABRUBAB/YINGLONG#subdirectory=tools/verify-py' yinglong verify 0x<mandateHash> --chain fisco --rpc <FISCO RPC URL>

# A transaction: decode YINGLONG events, tie a redemption to its mandate, recover a revert reason.
uvx --from 'git+https://github.com/ABRUBAB/YINGLONG#subdirectory=tools/verify-py' yinglong verify-tx 0x<txHash> --chain fisco --expect PayeeNotVerified

# A receipt: EIP-712 hash, the documents it commits to, and inclusion in an anchored batch root.
uvx --from 'git+https://github.com/ABRUBAB/YINGLONG#subdirectory=tools/verify-py' yinglong verify-receipt receipt.json --proof proof.json --chain anvil

# Which ledgers and deployment files are known, and whether their RPC endpoints answer.
uvx --from 'git+https://github.com/ABRUBAB/YINGLONG#subdirectory=tools/verify-py' yinglong ledgers
```

Pin a release by adding `@<tag>` after the repository URL (for example `...YINGLONG@v1.0-submission#subdirectory=tools/verify-py`).

From a checkout: `cd tools/verify-py && uv run yinglong verify nadia --chain anvil --offline`.

## Commands

### `yinglong verify <input> --chain anvil|base-sepolia|fisco`

`<input>` is one of:

| Input | What is verified |
|---|---|
| a mandate document (`schema: "yinglong.mandate/v1"`) | the document against what the ledger holds |
| a golden vector (`packages/mandate/golden/*.json`), or the bundled names `nadia` and `lotus` | as above, plus byte-for-byte parity with the TypeScript compiler, decompiler and Hash Ring |
| a `0x` mandate hash | the on-chain record alone (no document checks); the rules are decoded from the published bytes |
| a snapshot written by `--save-snapshot` | the recorded on-chain values, offline |

Options: `--rpc URL`, `--deployment PATH`, `--offline`, `--svg ring.svg`, `--save-snapshot snap.json`,
`--from-block N`, `--json`, `-v` (per-enforcer and per-contract tables).

The output has four parts: what the user said (the mandate's own sentences; model input, never enforced),
what the code enforces (one English sentence per caveat, decoded from the bytes), the Hash Ring as an ASCII
strip (and SVG with `--svg`), and a PASS/FAIL table.

### `yinglong verify-tx <txhash> --chain ...`

Fetches the transaction and its receipt and decodes every log with the bundled ABIs (MandateRedemption,
BudgetSpent, VelocityUsed, CoSigned, Tripped, ReceiptBatchAnchored, CrossAnchored, Instructed, QuoteSettled,
EscrowCreated, MandatePublished, RedeemedDelegation, Transfer and the rest). For each redeemed delegation it
recomputes the delegation hash in Python and looks up the published mandate it belongs to; each
MandateRedemption event must name that delegation and the mandate the registry records for it.
For a failed transaction it replays the call with `eth_call` at the parent block (FISCO: against the
latest state, see below) and decodes the revert data as a YINGLONG typed error (`contracts/src/utils/Errors.sol`),
a Delegation Framework error, `Error(string)` or `Panic(uint256)`. Failed user operations inside a successful
bundle are decoded from `UserOperationRevertReason`. `--expect success` or `--expect <ErrorName>` turns the
result into a pass/fail assertion.

### `yinglong verify-receipt <receipt> [--proof proof.json] --chain ...`

`<receipt>` may be a bare receipt, `{receipt, domain?, receiptHash?}`, a ReceiptRecord written by
`apps/agent` (one line of `apps/agent/data/receipts.jsonl`, chosen with `--index N`), or a proof written by
`apps/indexer` (which embeds receipt, proof, root and per-ledger anchors). Bigints may be numbers, decimal
strings or `{"$n": "..."}`. The EIP-712 domain is taken from the file, else from the deployment
(AccountabilityLedger address, `domainSalt`) and the ledger chain id (`--domain-chain-id` overrides).

### `yinglong ledgers`

Prints the ledger profiles (anvil 31337 at `http://127.0.0.1:8645`; base-sepolia 84532 at
`https://sepolia.base.org`; fisco from `FISCO_RPC_URL`), probes each RPC (`--no-probe` to skip) and lists the
deployment files found in the repository checkout and in the bundle.

RPC overrides: `--rpc`, or `ANVIL_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, `FISCO_RPC_URL` (`FISCO_CHAIN_ID`,
default 20200; `FISCO_TIME_UNIT`, `s` or `ms`). Deployment files are looked up in this order: `--deployment`,
`YINGLONG_DEPLOYMENTS` (a directory), the repository checkout around the current directory, the bundled copy.
The file actually used and its SHA-256 are printed in the first row of every result.

Exit codes: `0` every check passed, `1` at least one check failed, `2` bad input, missing file or unknown
transaction. Offline runs print `PASS OFFLINE` and exit `0` when every check that could run passed; the
on-chain checks are listed as `SKIP`.

## What each check proves, and what it does not

| Check | It proves | It does not prove |
|---|---|---|
| mandate document is valid; mandate hash = keccak256(canonical JSON) | the document parses under schema v1 (unknown keys stripped, as zod does) and hashes to this value | that the document says what the user meant |
| Python compiler re-emits the caveats | the document compiles, deterministically, into this exact caveat array | that the compiler's choices are wise (only that two implementations agree on them) |
| published caveats equal the Python-compiled caveats | the caveat array in the `MandatePublished` event is, byte for byte, what the document compiles to | anything about caveats added by a different, unpublished delegation |
| registry caveatsHash equals keccak256(abi.encode(published caveats)) | the event's caveats are the ones the registry stored at publication | |
| delegation hash recomputed in Python equals registry `delegationOf` | Python's EncoderLib twin, the event and the registry's Solidity agree on H | |
| `DelegationManager.getDelegationHash` returns the same hash | H is the hash the DelegationManager computes for this delegation, so these are the caveats it enforces when a delegation with this hash is redeemed | that the user's passkey signed it (the signature is checked by the account at redemption) |
| published account, agent, salt, lineage, jurisdiction and validity equal the document | the registry record describes this document's delegation | |
| every caveat decodes into a known rule and an English sentence; allowlists come first | no unknown enforcer is present, and the target and method allowlists are caveats 0 and 1 | that the English sentence is a complete legal description; it is a faithful rendering of the bytes |
| MandateBindingEnforcer binds this mandate hash in this registry | redemption reverts unless this mandate is live in this registry | |
| each enforcer accepts its terms and `getTermsInfo` returns the Python-decoded values | the enforcer contract itself decodes the bytes to the same numbers and addresses (and does not reject them with `InvalidTerms`) | how the enforcer uses those values (that is the audited contract code) |
| registry `isLive(mandateHash)` | status Live and the ledger time is inside the validity window, at the block read | that it will still be live later |
| DelegationManager has not disabled the delegation | `disabledDelegations(H)` is false at the block read | |
| code hash of every enforcer, the DelegationManager and the registry equals the deployment table | the bytecode at each address hashes to the value in the deployment table | that the table's code is correct or audited; it binds addresses to known bytecode only. The table itself is trusted as published in the repository (its SHA-256 is printed) |
| equal to the TypeScript output (golden rows) | the two implementations agree byte for byte on hash, caveats, rules, sentences and ring geometry | that both are free of a shared misunderstanding |
| receipt EIP-712 hash, document commitments, receipt chain | the receipt fields, and the intent, plan, policy, state reads, counterparty check, simulation, explanation and AIGC block it commits to, hash to the recorded values; each receipt links to the previous one | that the documents are true or that the AI explanation is correct (the receipt only commits to what was reported) |
| Merkle path, anchored batch root, `AccountabilityLedger.verifyReceipt` | the receipt is a leaf of a batch root anchored on this ledger, checked by the contract's own MerkleProof | when the action happened beyond the block that anchored the batch |

The Hash Ring proves hash identity, not mandate correctness.

## Hash Ring spec v1

Input H is the 32-byte delegation hash the DelegationManager accepts (`getDelegationHash`, no second hash).
64 ticks; tick i at angle -90 + i * 5.625 degrees (12 o'clock, clockwise); its length is one nibble of H
(high nibble of byte i/2 for even i, low for odd): from 0.80R to (0.84 + 0.01 * nibble)R. Nine arcs from
K = keccak256(H): arc j starts at -90 + K[j] * 360 / 256 degrees, sweeps 8 + (K[j + 9] mod 32) degrees, at
radius (0.70 - 0.025 * j)R. Revoked (status Superseded or Revoked, or the delegation disabled): ticks 62, 63,
0 and 1 are omitted and the ticks turn ash. Values are rounded to 6 decimals with JavaScript `Math.round`
semantics. The ASCII strip prints `" .:-=+*#%@ABCDEF"[nibble]` for the 64 ticks.

## Ledger notes

- **FISCO BCOS** (web3 RPC): `eth_getLogs` needs address, topics, fromBlock and toBlock all present and
  silently returns nothing for wide ranges, so the verifier locates `MandatePublished` by the registry's
  `publishedAt` timestamp (binary search over blocks) and scans in 10-block chunks as a fallback
  (`YINGLONG_LOG_CHUNK` overrides). `eth_call` ignores block tags, so revert reasons are recovered against the
  latest state (and through `eth_estimateGas` if `eth_call` carries no data); the output says so.
- **Base Sepolia**: no deployment file is committed yet; `--chain base-sepolia` exits 2 until
  `contracts/deployments/base-sepolia.json` exists and the bundle is refreshed.
- **Anvil**: the bench chain is reset whenever it restarts; mandates and transactions from an earlier session
  are gone.

## Development

```sh
cd tools/verify-py
uv run pytest                                  # unit, golden, TypeScript-vector, CLI and ledger tests
python scripts/sync-data.py                    # refresh the bundled deployments, golden vectors and ABIs
python scripts/sync-data.py --check            # exit 1 if the bundle is out of date
npx tsx tools/verify-py/scripts/ts-vectors.ts  # from the repository root: regenerate tests/vectors/ts-vectors.json
```

`scripts/sync-data.py` needs `forge build` output in `contracts/out` to refresh the ABIs (it keeps the
bundled ABIs otherwise) and writes `src/yinglong_verify/data/MANIFEST.json` with the SHA-256 of every bundled
file. `scripts/ts-vectors.ts` produces cross-implementation vectors with the TypeScript reference itself:
canonical JSON corner cases (UTF-16 key order, escapes, lone surrogates), `docHash` number formatting,
delegation hashes, compiled mandate variants on every deployment, synthetic decompiler sentences (both time
units), Hash Ring geometry, receipt hashes and Merkle trees.

Ledger tests skip themselves when a ledger is not reachable:

- shared Anvil at `http://127.0.0.1:8645` (read-only: code hashes, every published mandate by hash);
- a private fork of it (`anvil --fork-url`, binary from `ANVIL_BIN`, `PATH` or `~/.foundry/bin`): the golden
  Nadia mandate is published by account impersonation inside the fork, then verify, verify-tx (success and a
  typed revert), verify-receipt (after anchoring a batch), disable and revoke are exercised; nothing is
  written to the shared chain;
- FISCO BCOS at `FISCO_RPC_URL` (read-only, using `apps/agent/data/e2e-fisco.json`).
