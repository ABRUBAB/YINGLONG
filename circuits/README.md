# YINGLONG circuits: the private mandate

Status: **test build, not audited.** Every amount here is in test units. Noir 1.0.0-rc.5 is a release
candidate. Numbers in the table below are written by `circuits/scripts/manifest.mjs` from
`circuits/MANIFEST.json`; do not edit them by hand.

<!-- BEGIN GENERATED: circuits/scripts/manifest.mjs (do not edit by hand) -->
| Item | Value |
|---|---|
| Toolchain | nargo 1.0.0-rc.5, bb 5.2.1, noir_js 1.0.0-rc.5, bb.js 5.2.1, verifier solc 0.8.27+commit.40a35a09, project solc 0.8.23, evm london |
| Circuit | 135 ACIR opcodes, 4,554 gates, dyadic size 2^13 |
| Public inputs | 10: mandate_commitment, delegation_hash_hi, delegation_hash_lo, chain_id, payee, amount, nonce, claimed_time, old_running_commitment, new_running_commitment |
| Proof size | 7,616 bytes |
| HonkVerifier runtime | 18,530 B (EIP-170 limit 24,576 B) |
| RelationsLib / ZKTranscriptLib runtime | 8,074 B / 6,216 B |
| ZKMandateEnforcer / ZKVerifierRouter runtime | 4,134 B / 1,949 B |
| Post-london opcodes in reachable code | none |
| Gas: HonkVerifier.verify | 2,324,637 |
| Gas: router.verifyProof | 2,359,529 |
| Gas: enforcer beforeHook (first / later payment) | 2,566,806 / 2,543,348 |
| Gas: DelegationManager.redeemDelegations with the ZK caveat (first / later) | 2,832,510 / 2,815,420 |
| Foundry tests | 59/59 passed |
| vk hash | `0x05c62f51284e760d87811fdcc9218c1ebd0b101695ceb6cf002e43c391a48494` |
| SHA-256 main.nr | `47b64ab72b064429f135b942583043bb4598150544784325705a1154e865ce46` |
| SHA-256 ACIR bytecode | `0a12de4f2b9c2dc8bf99d85315abdad1e8b8088d468245b1518a492445f837e2` |
| SHA-256 vk (binary) | `102fba1d5e2e5ae077d285cd9ad687bca6320ff1e35c0b7fcc5368721e728138` |
| SHA-256 HonkVerifier.sol | `47e3e510b7a8ceb79cbeacb583114e1cf63bfe5a84558aeec2680fe72d49a9b9` |
<!-- END GENERATED -->

## What the proof says, in plain English

The user seals a mandate for their agent: "pay at most this much in total, only to these payees,
until this date". Only a fingerprint of it (the *mandate commitment*) goes on-chain; the cap, the
payee list and the deadline stay private.

Each time the agent pays, it attaches a zero-knowledge proof that says:

1. the secret mandate behind the commitment exists and the agent knows it;
2. the payee of this transfer is on the secret payee list;
3. the time the agent claims (T) is not after the secret deadline;
4. the amount paid so far under this delegation, plus this payment, stays within the secret cap
   (128-bit arithmetic, overflow refused);
5. the sealed running total moves from its previous value to the new one.

The running total is itself sealed (a commitment with a fresh random blinding each time), and the
enforcer stores the latest sealed value. A second proof can only build on the first, so two proofs
that are each fine on their own cannot both be spent if together they pass the cap (invariant 8).

Proof type `0x01` = mandate compliance (`circuits/mandate_compliance/src/main.nr`).

## Public inputs (circuit order)

| # | Name | Where the enforcer takes it from |
|---|---|---|
| 0 | `mandate_commitment` = Poseidon2(cap, allowlistRoot, expiry, salt) | caveat terms (signed by the user) |
| 1 | `delegation_hash_hi` (upper 128 bits) | hook parameter `delegationHash` |
| 2 | `delegation_hash_lo` (lower 128 bits) | hook parameter `delegationHash` |
| 3 | `chain_id` | `block.chainid` |
| 4 | `payee` (address as a field element) | execution calldata of `transfer(address,uint256)` |
| 5 | `amount` (u128) | execution calldata of `transfer(address,uint256)` |
| 6 | `nonce` | args (any unused field element) |
| 7 | `claimed_time` T (u64) | args, checked against the block clock |
| 8 | `old_running_commitment` = Poseidon2(oldTotal, oldBlind) | enforcer storage, keyed by (DelegationManager, delegationHash) |
| 9 | `new_running_commitment` = Poseidon2(oldTotal + amount, newBlind) | args; stored after a valid proof |

Private witness: cap (u128), allowlist root, depth-8 sibling path and leaf index for the payee,
expiry (u64), salt, oldTotal (u128), oldBlind, newBlind.

Hashing: barretenberg's Poseidon2 sponge over BN254 (state width 4, rate 3, IV = length x 2^64). An
allowlist leaf is Poseidon2(payee); a node is Poseidon2(left, right); empty leaves are 0. The circuit
writes the sponge out with `std::hash::poseidon2_permutation` (no external Noir dependency) and the
TypeScript side uses bb.js `poseidon2Hash`; both sides assert the same golden values.

**First payment:** the old running commitment is Poseidon2(0, 0)
= `0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1`, hard-coded in
`ZKMandateEnforcer.INITIAL_RUNNING_COMMITMENT` and returned by `runningCommitment()` until the first
payment lands.

`delegation_hash_*`, `chain_id` and `nonce` appear in no constraint. They are still bound: UltraHonk
folds every public input into the permutation argument, and `ZKVerifierRouter.t.sol`
(`test_eachPublicInputIsBound`) flips each of the ten words in turn and checks the proof is rejected.

## On-chain contracts

* `contracts/src/zk/ZKVerifierRouter.sol`: ERC-8262-style `verifyProof(uint8 proofType, bytes proof,
  bytes publicInputs) returns (bool)`. Public inputs are consecutive 32-byte words. Registration is
  append-only (a proof type can never be re-pointed) and only the registrar may add types; the
  registrar can renounce. Rejections from the generated verifier (which mostly reverts) are returned
  as `false`; an unknown proof type or a ragged public-input buffer reverts.
* `contracts/src/zk/ZKMandateEnforcer.sol`: a `CaveatEnforcer` (MetaMask Delegation Framework v1.3.0).
  * Terms: `abi.encode(address router, bytes32 mandateCommitment)`.
  * Args: `abi.encode(uint256 nonce, uint64 claimedTime, bytes32 newRunningCommitment, bytes proof)`,
    strict canonical encoding only.
  * `beforeHook` order: typed check for single call type and default execution type (then the
    framework's own modifiers), decode terms, decode the execution (must be ERC-20
    `transfer(address,uint256)`, selector `0xa9059cbb`, exactly 68 bytes, clean address word, zero
    native value; payee and amount come from calldata only), decode args, clock rule, nonce unused for
    (msg.sender, delegationHash), build the ten public inputs with the stored running commitment,
    verify through the router, then mark the nonce used and store the new running commitment.
  * **Clock rule:** the circuit proves T <= expiry; the enforcer accepts T only when
    `block.timestamp - 300 <= T <= block.timestamp + 60`. A proof stays usable for five minutes
    (proving plus inclusion) and may run at most 60 s ahead of the chain clock.
  * Range checks before the verifier: amount <= 2^128 - 1 (`AmountOutOfRange`), nonce and new running
    commitment below the BN254 scalar field and the commitment non-zero (`InvalidArgs`), mandate
    commitment below the field (`InvalidTerms`). The generated verifier also refuses any public input
    at or above the field modulus, so `nonce + p` cannot alias `nonce`.
  * Errors: `InvalidMandateProof`, `NonceAlreadyUsed`, `InvalidArgs`, `InvalidTerms`,
    `InvalidExecutionMode`, `UndecodableExecution`, `NativeValueNotAllowed` from
    `src/utils/Errors.sol`; `ClaimedTimeOutOfRange`, `AmountOutOfRange` and the router errors from
    `src/zk/ZKErrors.sol`.
  * No immutables in either contract: runtime bytecode is identical on every chain
    (`test_noImmutables_runtimeBytecodeIsChainIndependent` uses `type(C).runtimeCode`, which does not
    compile for contracts with immutables).
* `contracts/src/zk/generated/mandate_compliance/`: the deployable verifier artifact
  (`HonkVerifier.artifact.json`: creation and runtime bytecode of `HonkVerifier`, `RelationsLib` and
  `ZKTranscriptLib`, link offsets and immutable offsets, compiler settings, sizes, opcode scan) and the
  verification key as hex text (`vk.hex`, `vk_hash.hex`). The vk is stored as hex because its raw
  bytes can decode as CJK code points and would trip the English-only gate.

### Why the verifier is compiled separately

bb 5.2.1 emits `pragma solidity ^0.8.27` and uses `require(condition, CustomError())` throughout, which
solc supports only from 0.8.26 (via-IR) or 0.8.27 (legacy pipeline). The main Foundry project pins
solc 0.8.23 for every file, so the generated source cannot live in `contracts/src` without breaking
`forge build`. We do not edit generated code, so the verifier is kept verbatim in
`circuits/verifier/src/mandate_compliance/HonkVerifier.sol` and compiled by the standalone Foundry
project `circuits/verifier/` with **solc 0.8.27** (the oldest its pragma accepts), `evm_version =
london`, optimizer 200 runs, no via-IR, no metadata. The exporter walks the reachable code and fails
if it finds PUSH0, MCOPY, TLOAD, TSTORE, BLOBHASH or BLOBBASEFEE. It fits EIP-170 as generated (bb
already splits it into the verifier plus two linked libraries), so no optimizer tuning, extra library
linking or circuit change was needed.

The verifier uses the precompiles at 0x05 (modexp), 0x06 (ecAdd), 0x07 (ecMul) and 0x08 (pairing),
which a standard (non-SM) FISCO BCOS build provides. **It has not yet been executed on FISCO**; that
belongs to the FISCO deployment spike.

### Deploying

1. Deploy `relationsLib.bytecode` and `transcriptLib.bytecode` from the artifact.
2. Write their addresses into `verifier.bytecode` at `relationsLibOffsets` and `transcriptLibOffsets`
   (20 bytes each), deploy it.
3. Deploy `ZKVerifierRouter(registrar)`, call `registerVerifier(0x01, verifier)`, optionally
   `renounceRegistrar()`.
4. Deploy `ZKMandateEnforcer` (no constructor arguments).

For identical addresses on every chain, deploy all six through the same CREATE2 factory and salt; the
verifier's runtime code embeds the library addresses. `contracts/test/zk/ZKTestBase.sol` shows the
linking and checks the deployed runtime against the artifact byte for byte.

Pair the ZK caveat with `AllowedTargets` restricted to one ERC-20 (the token is not part of the
statement; see limitations).

## Prover (Node)

`circuits/prover/src/index.ts` (noir_js + bb.js `UltraHonkBackend`, `verifierTarget: "evm"` = keccak
oracle with zero knowledge):

* `proveMandateCompliance({ mandate, running, payment, newBlind? }) -> { proof, publicInputs, publicInputsPacked, mandateCommitment, oldRunningCommitment, newRunningCommitment, newRunning, enforcerArgs }`.
  It refuses before proving if the statement is false (cap, allowlist, expiry), and checks that bb.js
  returns exactly the public inputs it computed.
* `mandateCommitment`, `runningCommitment`, `buildAllowlistTree`, `allowlistPath`,
  `initialRunningCommitment`, `encodeEnforcerArgs`, `verifyMandateCompliance`.
* CLI: `pnpm --dir circuits prove prove request.json --out proof.json`, `... verify proof.json`,
  `... commit mandate.json`, `... initial`.

Keep `newRunning` (total and blind) private and persist it only once the payment is confirmed
on-chain: `runningCommitment(dm, delegationHash)` equals `newRunningCommitment` exactly when it landed.

Versions: `@noir-lang/noir_js` **1.0.0-rc.5** and `@aztec/bb.js` **5.2.1** are pinned in
`circuits/package.json` to the same versions as nargo and bb; `manifest.mjs` refuses a mismatch.
Set `YINGLONG_BB_CRS_PATH` to choose where bb.js caches the reference string (a one-off download
on first use).

Toolchain note: Noir's own repository at v1.0.0-rc.5 pins bb 5.0.0 for its integration tests, and the
bbup compatibility map has no entry for the rc series yet. We use the plan's pair (nargo 1.0.0-rc.5,
bb 5.2.1) because it is verified end to end here: nargo-compiled ACIR, a bb 5.2.1 CLI vk and
verifier, bb.js 5.2.1 proofs, `bb verify` on Linux accepting a bb.js proof made on Windows, bb.js
deriving the byte-identical vk, and the Solidity verifier accepting the proofs.

## Tests

* `nargo test` (`main.nr`): golden Poseidon2 values, a valid payment, cap exceeded, payee
  not allowlisted, expired, u128 overflow.
* `pnpm --dir circuits test` (`prover/test/golden.test.ts`): TypeScript hashes equal the circuit's,
  the enforcer constant equals Poseidon2(0, 0), the circuit refuses each false statement, prove and
  verify round trip, bb.js vk equals the CLI vk.
* Foundry, with real proofs from `contracts/test/vectors/zk/mandate_compliance.fixtures.json`:
  * `ZKMandateEnforcer.t.sol`: valid proof passes and advances state; a chain of three reaching the cap
    exactly; same nonce replayed (`NonceAlreadyUsed`); same proof under a fresh nonce; invariant 8 in
    both orders; out-of-order chain; payee not allowlisted; other allowlisted payee; tampered amount
    (fixed and fuzzed); tampered new commitment, chain id, delegation hash, mandate commitment and
    proof byte; clock window edges; proof at T = expiry landing 301 s late; T moved past expiry;
    execution decoding (native value, wrong selector, extra calldata, dirty address bits, amount
    above u128, short execution); batch and try modes; malformed, non-canonical and out-of-field args;
    bad terms; no immutables; gas of the verify path.
  * `ZKVerifierRouter.t.sol`: every public input bound, out-of-field aliasing refused, wrong input
    count, truncated proof, unknown type, append-only registry, registrar-only, renounce.
  * `ZKMandateEnforcerDM.t.sol`: the same caveat through the real `DelegationManager` and a
    `HybridDeleGator`, with `AllowedTargets` first; tokens move; replay, invariant 8, wrong payee and
    tampered amount revert and move nothing. The prover computes this delegation hash ahead of time
    from the fixed deployment order, and the test asserts it matches.

## Trust assumptions

1. **Proof system.** Soundness and zero knowledge of UltraHonk (keccak transcript, ZK flavour) as
   implemented in bb 5.2.1 and in its generated Solidity verifier. We did not audit either.
2. **Reference string.** UltraHonk uses a universal BN254 KZG reference string, which bb downloads
   from Aztec's CRS host. Aztec publishes it as the output of its Ignition ceremony. Soundness assumes
   that ceremony's toxic waste is unknown (one honest participant).
3. **Hiding.** The salt and every blinding must be uniformly random and secret. With a guessable salt
   the cap, root and expiry could be brute-forced from the commitment.
4. **Terms are trusted, args are not.** The user signs the router address and the commitment. The
   agent supplies nonce, T, the new commitment and the proof; only the proof gives them meaning.
   Payee and amount come from calldata.
5. **Router governance.** The registrar can add new proof types but can never re-point an existing
   one; `renounceRegistrar()` freezes the router.
6. **Clock.** `block.timestamp` as set by the block producer, with the 300 s / 60 s window above.
7. **Toolchain match.** Proofs from any other noir_js / bb.js versions than those pinned may not
   verify. The verifier bytecode was compiled with solc 0.8.27, not the project's 0.8.23.
8. **Privacy is against the public, not the agent.** The agent holds the mandate secrets in order to
   prove.

## Limitations (stated honestly)

* **The running total is only weakly private.** Amounts and payees are public in calldata and events,
  so anyone can add up the payments of a delegation. What stays hidden is the cap, the expiry, the
  salt and the rest of the allowlist. Each successful payment also reveals that the cap is at least
  the running total and that the payee is listed.
* **The token is not in the statement.** One running total counts raw units of whatever ERC-20 the
  delegation may call; restrict the delegation to one token with `AllowedTargets`.
* **Expiry tolerance.** A proof made at T = expiry can land up to 300 s after the hidden expiry
  (tested), and T may be up to 60 s ahead of the chain clock.
* **One transfer per redemption.** Single call type, default execution type, ERC-20
  `transfer` only; no batches, no `transferFrom`, no native value.
* **Sequential payments.** Each proof builds on the previous commitment, so concurrent payments under
  one delegation cannot both land; the loser must be re-proved. If the agent loses its private
  running state (total and blind), the mandate can no longer be used and must be re-sealed.
* **Allowlist size.** At most 256 payees (tree depth 8).
* **The redeemer is not bound.** Any delegate that knows the secrets and is allowed to redeem can
  prove; who may redeem is governed by the delegation itself.
* **Gas.** Each payment pays for a full UltraHonk verification (see the gas rows of the table at the
  top), dominated by the pairing and MSM precompiles; acceptable on Base Sepolia and on FISCO BCOS
  (gas price 0), expensive on Ethereum L1.
* **Maturity.** Noir 1.0.0-rc.5 is a release candidate; the verifier and circuit are unaudited; the
  verifier has not yet run on FISCO BCOS.

## Rebuild deterministically

```bash
# 1. Linux or macOS (nargo and bb have no Windows builds), from circuits/:
noirup -v 1.0.0-rc.5 && bbup -v 5.2.1
bash scripts/build-circuit.sh
#    compare the printed SHA-256 of the vk and HonkVerifier.sol, and MANIFEST.json acirBytecodeSha256
#    (the compiled JSON itself embeds the build directory in file_map, so its file hash moves with it)

# 2. Any OS with Foundry 1.8.5 (on Windows keep solc on D:, e.g. FOUNDRY_SOLC=D:/tools/solc/solc-0.8.27.exe):
(cd verifier && forge build --sizes)
node scripts/export-verifier.mjs          # artifact + vk.hex into contracts/, opcode scan, EIP-170 check

# 3. Node 22+ and pnpm, from circuits/:
pnpm install
YINGLONG_BB_CRS_PATH=/path/to/cache pnpm fixtures   # real proofs into contracts/test/vectors/zk/
YINGLONG_BB_CRS_PATH=/path/to/cache pnpm test

# 4. From contracts/:
forge test --match-path "test/zk/*" --json -vv > ../circuits/build/forge-zk-tests.json

# 5. From the repository root:
node circuits/scripts/manifest.mjs        # MANIFEST.json and the table at the top of this file
```

Proof bytes differ on every run (zero-knowledge randomness); commitments, the vk, the verifier and
the delegation hash do not.

## Files

| Path | What |
|---|---|
| `mandate_compliance/src/main.nr`, `Nargo.toml` | the circuit and its nargo tests |
| `mandate_compliance/target/mandate_compliance.json`, `gates.json` | compiled ACIR (used by the prover) and gate count |
| `verifier/` | standalone Foundry project for the verbatim bb verifier (solc 0.8.27, london) |
| `prover/src/` | `index.ts` (prover API), `poseidon.ts` (commitments, allowlist tree), `cli.ts` |
| `prover/scripts/make-fixtures.ts` | real proofs for the Foundry tests |
| `prover/test/golden.test.ts` | golden and negative tests |
| `scripts/build-circuit.sh` | nargo + bb build with version checks |
| `scripts/export-verifier.mjs`, `scripts/opcodes.mjs` | verifier artifact export, london opcode scan |
| `scripts/manifest.mjs` | `MANIFEST.json` and the generated table |
| `MANIFEST.json` | SHA-256 of circuit, ACIR, vk, verifier and contracts; versions; sizes; gas |
