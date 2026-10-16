# YINGLONG Caveat Enforcers

*Reference for every caveat enforcer a YINGLONG delegation can carry: what it enforces, how its bytes are laid out, which state it keeps, how it fails, which compiler step emits it, what sentence the decompiler prints for it, and which tests cover it.*

**Summary (5 lines)**
1. A YINGLONG mandate is an ERC-7710 delegation (MetaMask Delegation Framework v1.3.0) whose caveats are the rules; this file documents each caveat enforcer from the code in `contracts/src`, `contracts/lib/delegation-framework/src/enforcers` and `packages/mandate/src`.
2. Thirteen custom enforcers live in `contracts/src/enforcers`, one more (`ZKMandateEnforcer`) in `contracts/src/zk`; nine stock enforcers are deployed as our own copies on every ledger by `contracts/script/DeployYinglong.s.sol`.
3. The compiler (`compileMandate` in `packages/mandate/src/compile.ts`) lists fifteen kinds in a fixed order and emits fourteen of them (the fifteenth, `ReputationGateEnforcer`, makes it throw); three custom enforcers and six stock enforcers are deployed but not emitted by it at this commit (marked below).
4. Terms are signed by the user and trusted; args come from the redeemer and are untrusted; every money rule reads the payment from the execution calldata through `PaymentDecoder`, never from args.
5. Test names below are the Foundry functions in `contracts/test`; where no test exists, this file says so.

---

## 1. Conventions that apply to every custom enforcer

| Convention | Where in the code |
|---|---|
| Base contract `YinglongEnforcer` (extends the framework's `CaveatEnforcer`); `_requireSingleDefault(mode)` reverts `InvalidExecutionMode()` unless the call type is single and the exec type is default | `contracts/src/enforcers/YinglongEnforcer.sol` |
| `terms` are part of the signed delegation (the delegation hash covers `keccak256(terms)`); `args` are not hashed (`EncoderLib._getCaveatPacketHash`, mirrored by `caveatHash` in `packages/mandate/src/delegation.ts`), so args are used only when verified on-chain (a signature, a proof) or merely logged | `contracts/src/enforcers/*.sol`, `packages/mandate/src/delegation.ts` |
| State is keyed by `msg.sender`, which is the DelegationManager during a redemption; calling a hook directly cannot touch the counters of the real DelegationManager | each stateful enforcer |
| No immutables in any YINGLONG enforcer, so runtime bytecode is identical on every ledger; the two enforcers that need an EIP-712 domain (`CoSignEnforcer`, `VetoTimelockEnforcer`) keep their domain salt in storage (`YinglongEIP712.domainSalt`) and recompute the domain separator with `block.chainid` on every call | `contracts/src/utils/YinglongEIP712.sol` |
| Malformed terms revert `InvalidTerms()`; malformed args (where args are read) revert `InvalidArgs()` | `contracts/src/utils/Errors.sol` |

### 1.1 Payment decoding (`contracts/src/libraries/PaymentDecoder.sol`)

Every enforcer that reasons about money decodes the single ERC-7579 execution with `PaymentDecoder.decode`. It reverts `NativeValueNotAllowed(value)` on any native value and `UndecodableExecution(selector)` on any other shape.

| Shape | Selector | Asset | Recipient | Beneficiary | Amount |
|---|---|---|---|---|---|
| ERC-20 `transfer(address to, uint256 amount)`, calldata exactly 68 bytes | `0xa9059cbb` | execution target | `to` | `to` | `amount` |
| ERC-1363 `transferAndCall(address to, uint256 amount, bytes data)` | `0x4000aea0` | execution target | `to` (a rail contract: escrow, quote settlement, fund) | first ABI word of `data` if `data` is at least 32 bytes (dirty upper bits revert), else `to` | `amount` |
| `instruct(address payee, uint256 amount, bytes32 purposeHash, bytes32 conditionHash, uint64 validUntil)` on `ConditionalPaymentInstructions`, calldata exactly 164 bytes | `0xa755512d` | execution target (the instruction contract) | `payee` | `payee` | `amount` |

The selector values are the ones `packages/mandate/src/constants.ts` (`SELECTORS`) emits into `AllowedMethodsEnforcer` terms.

### 1.2 Hook order in DelegationManager v1.3.0

For each `redeemDelegations` call (`contracts/lib/delegation-framework/src/DelegationManager.sol`): `beforeAllHook` for every caveat of every delegation (leaf to root), then per batch entry `beforeHook` (leaf to root), the execution, `afterHook` (root to leaf, caveats in reverse), and finally `afterAllHook` (root to leaf, caveats in reverse). Disabled delegations and a paused DelegationManager revert before any hook runs.

### 1.3 Caveat order emitted by the compiler

`CAVEAT_ORDER` in `packages/mandate/src/compile.ts`, emitted by `compileMandate(input, deployment)`:

| # | Enforcer | Emitted when | Count |
|---|---|---|---|
| 1 | `AllowedTargetsEnforcer` | always | 1 |
| 2 | `AllowedMethodsEnforcer` | always | 1 |
| 3 | `ValueLteEnforcer` | always (max 0) | 1 |
| 4 | `ForbiddenTargetsEnforcer` | always | 1 |
| 5 | `GlobalPauseEnforcer` | always | 1 |
| 6 | `AgentLineageEnforcer` | always | 1 |
| 7 | `MandateBindingEnforcer` | always | 1 |
| 8 | `JurisdictionEnforcer` | always | 1 |
| 9 | `VerifiedPayeeEnforcer` | always | 1 |
| 10 | `CoSignEnforcer` | per entry of `mandate.tiers` | 0..n |
| 11 | `CategoryBudgetEnforcer` | per entry of `mandate.budgets` | 0..n |
| 12 | `ReserveFloorEnforcer` | per entry of `mandate.reserveFloors` | 0..n |
| 13 | `VelocityEnforcer` | if `mandate.velocity` is not null | 0..1 |
| 14 | `SuitabilityEnforcer` | if `mandate.suitability` is not null | 0..1 |
| 15 | `ReputationGateEnforcer` | if `mandate.reputation` is not null the compiler **throws** ("reputation gate requires an ERC-8004 reputation registry address in the deployment (not configured yet)") | 0 |

The golden vectors show the result: `packages/mandate/golden/nadia.json` compiles to 16 caveats (two tier entries and two budget entries) and `packages/mandate/golden/lotus.json` to 13.

### 1.4 Decompiler

`decodeCaveat(c, deployment)` and `sentence(rule, names, timeUnit)` in `packages/mandate/src/decompile.ts` (Python twin: `tools/verify-py/src/yinglong_verify/decompile.py`). The enforcer is identified by its address in the deployment table; terms are decoded from bytes; labels (`namesFor` in `packages/mandate/src/names.ts`) only affect display. Decoders exist for the fourteen emitted kinds and, in TypeScript only, for `ZKMandateEnforcer`. Any enforcer without a decoder becomes `{kind: "unknown"}` with the sentence "Unknown rule at `<address>`; refuse to seal.", and the round-trip check "every rule decodes" fails. In the templates below, `{L(x)}` is the display label of address `x`, `{amt(asset, v)}` is `v` formatted with the asset's decimals followed by its label, and `{list(...)}` joins with commas and "and".

### 1.5 Test files referenced

| File | Contract | What it is |
|---|---|---|
| `contracts/test/YinglongBase.t.sol` | `YinglongBase` (abstract) | Fixture: EntryPoint, DelegationManager, HybridDeleGator with owner = address(0) and one P-256 key, every registry, enforcer and rail, Nadia's payee book and a 15-caveat Hong Kong mandate written by hand (`_nadiaCaveats`) |
| `contracts/test/NadiaMandate.t.sol` | `NadiaMandateTest` | Scenario tests, one per rule and tier |
| `contracts/test/zk/ZKMandateEnforcer.t.sol` | `ZKMandateEnforcerTest` | ZK enforcer with real proofs (hooks called directly) |
| `contracts/test/zk/ZKMandateEnforcerDM.t.sol` | `ZKMandateEnforcerDMTest` | Same caveat through the real DelegationManager and a HybridDeleGator |
| `contracts/test/zk/ZKVerifierRouter.t.sol` | `ZKVerifierRouterTest` | Router |
| `packages/mandate/test/mandate.test.ts` | vitest | Compiler order, determinism, decompiler sentences, round trip, tamper detection, Hash Ring, and (when an Anvil node is up) parity of the delegation hash with `DelegationManager.getDelegationHash` and `MandateRegistry.computeDelegationHash` |
| `tools/verify-py/tests/test_golden.py`, `test_ts_vectors.py` | pytest | Byte-for-byte agreement of the Python compiler and decompiler with the TypeScript golden vectors |

Counts of passing tests are generated: Foundry <!-- gen:tests.contracts -->390<!-- /gen --> (of which `NadiaMandateTest` <!-- gen:tests.forge.nadia -->30<!-- /gen -->), vitest <!-- gen:tests.ts -->176<!-- /gen -->, pytest <!-- gen:tests.py -->108<!-- /gen -->.

---

## 2. Stock enforcers (MetaMask Delegation Framework v1.3.0, own copies)

`DeployYinglong._stockEnforcers()` deploys our own copy of each, so every caveat on every ledger runs bytecode with a known code hash. They revert with strings, not typed errors.

### 2.1 AllowedTargetsEnforcer (emitted, position 1)

| Item | Value |
|---|---|
| Purpose | The execution target must be one of the listed addresses. YINGLONG lists the mandate's assets only, so the agent can call nothing but its sealed rails |
| Hooks | `beforeHook` (`onlySingleCallTypeMode`, `onlyDefaultExecutionMode`) |
| Terms | packed 20-byte addresses; length `20 * n`, `n >= 1` |
| Args | none |
| State | none |
| Errors | `AllowedTargetsEnforcer:invalid-terms-length`, `AllowedTargetsEnforcer:target-address-not-allowed` |
| Compiler | step 1 of `compileMandate`: `concat(m.assets.map(address))`; the compiler throws "allowlist overlaps the forbidden set" if any asset is in `forbiddenTargets(d)` or equals the principal's account |
| Sentence | "The agent can only touch these assets: {list(targets)}." |
| Tests | Caveat 0 of every redemption in `NadiaMandateTest`; vitest `compiler > emits the allowlists first and binds the mandate hash`; `ZKMandateEnforcerDMTest` uses it as the first caveat. No negative Foundry test targets it alone |

### 2.2 AllowedMethodsEnforcer (emitted, position 2)

| Item | Value |
|---|---|
| Purpose | The execution's 4-byte selector must be listed: `transfer`, `transferAndCall` and/or `instruct`. Token approvals and every other function are refused |
| Hooks | `beforeHook` (single call type, default mode) |
| Terms | packed 4-byte selectors; length `4 * n`, `n >= 1` |
| Args | none |
| State | none |
| Errors | `AllowedMethodsEnforcer:invalid-terms-length`, `AllowedMethodsEnforcer:invalid-execution-data-length`, `AllowedMethodsEnforcer:method-not-allowed` |
| Compiler | step 1: `concat(m.methods.map(SELECTORS))` |
| Sentence | "It can only call: {list(methods)}. Approvals and any other function are refused." |
| Tests | `NadiaMandateTest.test_T4_tokenApprovalIsNotAnAllowedMethod` |

### 2.3 ValueLteEnforcer (emitted, position 3)

| Item | Value |
|---|---|
| Purpose | Caps the native value of the execution; compiled as 0 |
| Hooks | `beforeHook` (single call type, default mode) |
| Terms | `uint256 max`, 32 bytes |
| Args | none |
| State | none |
| Errors | `ValueLteEnforcer:invalid-terms-length`, `ValueLteEnforcer:value-too-high` |
| Compiler | step 1: `abi.encode(uint256 0)` |
| Sentence | "It can never send the native coin." (or "It can send at most {max} wei of the native coin." if non-zero) |
| Tests | No dedicated Foundry test; `PaymentDecoder` also refuses native value (`ZKMandateEnforcerTest.test_nativeValue_reverts` covers the ZK path) |

### 2.4 AllowedCalldataEnforcer (deployed, not emitted)

| Item | Value |
|---|---|
| Purpose | A byte range of the execution calldata must equal a sealed value |
| Hooks | `beforeHook` (single call type, default mode) |
| Terms | `uint256 dataStart` (32 bytes) followed by the expected bytes; length at least 33 |
| Errors | `AllowedCalldataEnforcer:invalid-terms-size`, `...:invalid-calldata-length`, `...:invalid-calldata` |
| Compiler | not emitted; the decompiler returns "unknown" for it |
| Tests | none in `contracts/test` |

### 2.5 LimitedCallsEnforcer (deployed, not emitted by the mandate compiler)

| Item | Value |
|---|---|
| Purpose | At most `limit` redemptions of this delegation. Required as `LimitedCalls(1)` on x402 child delegations by the seller check `checkX402Child` in `apps/services/src/x402/erc7710.ts` |
| Hooks | `beforeHook` (default mode) |
| Terms | `uint256 limit`, 32 bytes (packed `uint256` in `limitedCallsTerms`) |
| State | `callCounts[delegationManager][delegationHash]` |
| Errors | `LimitedCallsEnforcer:invalid-terms-length`, `LimitedCallsEnforcer:limit-exceeded` |
| Sentence | none (decompiler: unknown) |
| Tests | vitest `apps/services/test/x402.test.ts` ("rejects a second attempt that reuses the same permission context"); no Foundry test |

### 2.6 TimestampEnforcer (deployed, not emitted by the mandate compiler)

| Item | Value |
|---|---|
| Purpose | Redemption only strictly after `after` and strictly before `before` (0 disables a bound). Required on x402 children by `checkX402Child`, which also bounds the window |
| Hooks | `beforeHook` (default mode) |
| Terms | `uint128 after` then `uint128 before`, packed, 32 bytes |
| State | none |
| Errors | `TimestampEnforcer:invalid-terms-length`, `TimestampEnforcer:early-delegation`, `TimestampEnforcer:expired-delegation` |
| Sentence | none (decompiler: unknown) |
| Tests | covered indirectly by `apps/services/test/x402.test.ts`; no Foundry test |

The mandate's own validity window is enforced by `MandateRegistry.isLive` through `MandateBindingEnforcer`, not by a Timestamp caveat.

### 2.7 NonceEnforcer (deployed, not emitted)

| Item | Value |
|---|---|
| Purpose | Revocation epoch: the delegation is valid only while `currentNonce[DM][delegator]` equals the sealed nonce; `incrementNonce(dm)` from the account invalidates every delegation carrying the old nonce |
| Hooks | `beforeHook` (default mode) |
| Terms | `uint256 nonce`, 32 bytes |
| State | `currentNonce[delegationManager][delegator]` |
| Errors | `NonceEnforcer:invalid-terms-length`, `NonceEnforcer:invalid-nonce` |
| Compiler | not emitted; revocation at this commit uses `MandateRegistry.revoke` (which `MandateBindingEnforcer` reads) and `DelegationManager.disableDelegation` |
| Tests | none |

### 2.8 RedeemerEnforcer (deployed, not emitted)

| Item | Value |
|---|---|
| Purpose | Only listed addresses may redeem |
| Hooks | `beforeHook` (default mode) |
| Terms | packed 20-byte addresses, `20 * n`, `n >= 1` |
| Errors | `RedeemerEnforcer:invalid-terms-length`, `RedeemerEnforcer:unauthorized-redeemer` |
| Compiler | not emitted; who may redeem a YINGLONG root delegation is decided by `AgentLineageEnforcer` |
| Tests | none |

### 2.9 ERC20TransferAmountEnforcer (deployed, not emitted by the mandate compiler)

| Item | Value |
|---|---|
| Purpose | Cumulative cap on ERC-20 `transfer` amount for one token. Required on x402 children as the exact price (`erc20TransferAmountTerms(asset, amount)` in `apps/services/src/x402/erc7710.ts`); because the cap is cumulative, the child must also carry `LimitedCalls(1)` |
| Hooks | `beforeHook` (single call type, default mode) |
| Terms | `address token` (20 bytes) then `uint256 maxTokens` (32 bytes), packed, 52 bytes |
| State | `spentMap[delegationManager][delegationHash]` |
| Errors | `ERC20TransferAmountEnforcer:invalid-terms-length`, `...:invalid-execution-length`, `...:invalid-contract`, `...:invalid-method`, `...:allowance-exceeded` |
| Tests | vitest `apps/services/test/x402.test.ts`; on FISCO the framework spike redeemed under this enforcer and recorded the over-cap revert `ERC20TransferAmountEnforcer:allowance-exceeded` (`infra/fisco/README.md`, generated results, from `contracts-fisco/deployments/fisco-spike.json`) |

---

## 3. Custom enforcers (`contracts/src/enforcers`)

### 3.1 ForbiddenTargetsEnforcer (position 4)

| Item | Value |
|---|---|
| Purpose | Keeps every T3 action out of reach of any delegation: the target may never be the delegator itself (signer changes, upgrades, deposits), the DelegationManager (`msg.sender`), or any address listed in the terms. A second, independent line behind `AllowedTargetsEnforcer` |
| Hooks | `beforeHook` (`view`) |
| Terms | packed 20-byte addresses; length must be a multiple of 20 (zero allowed) |
| Args | ignored |
| State | none |
| Errors | `ForbiddenTarget(address target)`, `InvalidTerms()`, `InvalidExecutionMode()` |
| Compiler | step 1: `forbiddenTargets(d)` = DelegationManager, EntryPoint, PayeeBook, MandateRegistry, KillSwitchRegistry, YinglongPassportRegistry, AccountabilityLedger, ProductRegistry of the deployment, plus `EXTRA_FORBIDDEN[ledger]` (on `base-sepolia`: EntryPoint v0.7, v0.8, v0.9, Circle Paymaster v0.7 and v0.8, ERC-8004 IdentityRegistry and ReputationRegistry), deduplicated |
| Sentence | "It can never call your own account or {n} protocol contracts ({list(targets)})." |
| Tests | `NadiaMandateTest.test_T4_selfCallToAccountIsForbidden` (a delegation with only this caveat; a self-call to `addKey` reverts `ForbiddenTarget(nadia)`) |

### 3.2 GlobalPauseEnforcer (position 5)

| Item | Value |
|---|---|
| Purpose | One tap stops everything: refuses every redemption while the account's kill switch is tripped (passkey pause, guardian, breaker watcher, dead-man timer), while the redeeming agent is halted by the supervisor in `KillSwitchRegistry`, or while the redeemer's passport exists and is not active |
| Hooks | `beforeAllHook` (`view`), so it runs before any `beforeHook` |
| Terms | `abi.encode(address killSwitch, address passportRegistry)`, 64 bytes |
| Args | ignored |
| State | none (reads `KillSwitchRegistry.isPaused(account, agent)` and `YinglongPassportRegistry.walletInfo(redeemer)`) |
| Errors | `Paused(address account, address agent)`, `InvalidTerms()`, `InvalidExecutionMode()` |
| Compiler | step 2: `abi.encode(KillSwitchRegistry, YinglongPassportRegistry)` |
| Sentence | "Everything stops the moment you press Pause, your guardian pauses, or the supervisor halts this agent." |
| Tests | `NadiaMandateTest.test_pause_passkeySignatureRelayedByAnyone`, `test_supervisorHaltsAgentIdentity`, `test_drill_leakedAgentKeyIsBoundedByCaveats`; `test_pause_guardianCanPauseButNotUnpause` (registry side). Live: the `agent blocked while paused` step in `apps/agent/data/e2e-anvil.json` and `apps/agent/data/e2e-fisco.json` |

### 3.3 AgentLineageEnforcer (position 6)

| Item | Value |
|---|---|
| Purpose | Identity-bound delegation: the redeemer must be the wallet of an ACTIVE passport whose owner DID hash equals the DID sealed in the mandate, or the x402 facilitator pinned in the mandate |
| Hooks | `beforeHook` (`view`) |
| Terms | `abi.encode(address passportRegistry, bytes32 ownerDidHash, address pinnedFacilitator)`, 96 bytes |
| Args | ignored |
| State | none (reads `walletInfo(redeemer)`) |
| Errors | `LineageViolation(address redeemer)`, `InvalidTerms()`, `InvalidExecutionMode()` |
| Compiler | step 2: `abi.encode(YinglongPassportRegistry, keccak256(principal.did), facilitator or address(0))` |
| Sentence | "Only agents whose passport is bound to your identity can use this mandate." With a facilitator: "Only agents whose passport is bound to your identity, or the pinned payment facilitator {L(facilitator)} for single-use payments, can use this mandate." |
| Tests | `NadiaMandateTest.test_T4_lineageViolation_unregisteredRedeemer` |

### 3.4 MandateBindingEnforcer (position 7)

| Item | Value |
|---|---|
| Purpose | Binds the delegation to a published, live mandate: `MandateRegistry.delegationOf(mandateHash)` must equal the redeemed delegation's hash and `isLive(mandateHash)` must be true (status Live, inside `[validFrom, validUntil]`). Logs the agent's intent hash and receipt nonce as commitments |
| Hooks | `beforeHook`; emits `MandateRedemption(delegationManager, delegator, mandateHash, delegationHash, redeemer, intentHash, receiptNonce)` |
| Terms | `abi.encode(address mandateRegistry, bytes32 mandateHash)`, 64 bytes |
| Args | empty, or `abi.encode(bytes32 intentHash, uint256 receiptNonce)` (64 bytes); any other length reverts `InvalidArgs()`. Untrusted, logged only. The agent runtime currently sends empty args |
| State | none |
| Errors | `MandateDelegationMismatch(bytes32 mandateHash, bytes32 expected, bytes32 actual)`, `MandateNotLive(bytes32 mandateHash)`, `InvalidTerms()`, `InvalidArgs()`, `InvalidExecutionMode()` |
| Compiler | step 2: `abi.encode(MandateRegistry, canonicalHash(mandate))` |
| Sentence | "It works only while mandate {first 10 hex chars}... is live in the public mandate registry." |
| Tests | `NadiaMandateTest.test_T4_mandateNotPublishedIsUnbound`, `test_revokedMandateMovesNothing`, `test_publishedCaveatsRoundTrip`, `test_resealNeverResetsBudgets` |

### 3.5 JurisdictionEnforcer (position 8)

| Item | Value |
|---|---|
| Purpose | Rails as code: the paid asset must be one of the assets sealed for the mandate's jurisdiction profile; under the mainland profile only coin-free instruction rails (`railKind() == 3`) are permitted, whatever the asset list says. A token that does not report a rail kind counts as value-bearing (kind 0) |
| Hooks | `beforeHook` (`view`); `railKindOf(asset)` uses a `staticcall` to `railKind()` |
| Terms | `abi.encode(uint8 profile, address[] allowedAssets)`; length `96 + 32 * n`; profile 1 = Hong Kong, 2 = international, 3 = mainland (others revert `InvalidTerms`) |
| Args | ignored |
| State | none |
| Errors | `RailNotPermitted(address asset, uint8 profile)`, `InvalidTerms()`, `InvalidExecutionMode()`, `UndecodableExecution`, `NativeValueNotAllowed` |
| Compiler | step 3: `abi.encode(PROFILE_IDS[m.jurisdiction], targets)` (the same asset list as the target allowlist) |
| Sentence | "Jurisdiction: {Hong Kong / International / Mainland China (coin-free rail)}. Rails allowed: {list(assets)}." |
| Tests | `NadiaMandateTest.test_T4_railNotPermitted_mainlandProfileCannotMoveTokens`; vitest `compiler > refuses a mainland mandate on a value token` (asserts the compiler accepts it and leaves the refusal to the chain) |

Rail kinds reported by the rails: `TestUnits` (tHKD: 1, tUSD: 2, set in `DeployYinglong._rails`), `ConditionalPaymentInstructions` (constant 3).

### 3.6 VerifiedPayeeEnforcer (position 9)

| Item | Value |
|---|---|
| Purpose | Only verified payees receive funds. The beneficiary (decoded from calldata) must be an active entry of the delegator's `PayeeBook`, or the wallet of an ACTIVE passport attested by an issuer in the sealed trusted-issuer set. When funds go through a rail contract (recipient differs from beneficiary), that contract must be one of the sealed intermediaries |
| Hooks | `beforeHook` (`view`) |
| Terms | `abi.encode(address payeeBook, address passportRegistry, address[] trustedIssuers, address[] intermediaries)`; length `192 + 32 * (issuers + intermediaries)` |
| Args | ignored |
| State | none (reads `PayeeBook.lookup(delegator, beneficiary)` and `YinglongPassportRegistry.isTrustedAgentWallet(beneficiary, issuers)`) |
| Errors | `PayeeNotVerified(address payee)`, `InvalidTerms()`, `InvalidExecutionMode()`, `UndecodableExecution`, `NativeValueNotAllowed` |
| Compiler | step 3: `abi.encode(PayeeBook, YinglongPassportRegistry, m.trustedIssuers[].address, m.intermediaries[].address)` |
| Sentence | "Money goes only to payees in your payee book{ or to agents attested by {list(issuers)}}{, through {list(intermediaries)} only}." |
| Tests | `NadiaMandateTest.test_T4_payeeNotVerified_mirage`, `test_escrow_cannotRouteToUnverifiedPayeeThroughEscrow`, `test_drill_leakedAgentKeyIsBoundedByCaveats`; attested-agent path in `test_T2_newPayeeServiceAboveNewPayeeCap`; intermediary path in `test_escrow_tuitionDepositReleasedOnEnrolment` and `test_quote_convertAtSignedPriceThenExpiredReplayReverts`. Live: `T4 raw attack to Mirage reverted on-chain` in `apps/agent/data/e2e-fisco.json` (revert `PayeeNotVerified`) |

This enforcer does not read reputation; the reputation threshold is the separate `ReputationGateEnforcer` (section 3.12).

### 3.7 CoSignEnforcer (position 10, one per asset tier)

| Item | Value |
|---|---|
| Purpose | Tier T2 on-chain. For the sealed asset: above the T2 ceiling always reverts (T3); above the T1 threshold needs the user's own approval, checked as the delegator account's ERC-1271 signature (the passkey) over an `Approval` bound to this delegation, this exact execution, a nonce and an expiry. An approval may also be attached below the threshold (when an AI signal escalated the action); if attached it must be valid. Payments in other assets are not governed by this caveat |
| Hooks | `beforeHook`; emits `CoSigned(delegationManager, delegationHash, nonce, amount)` |
| T1 threshold | `thresholdFor`: beneficiary not in the PayeeBook: `newPayeeT1Cap`; in the PayeeBook with a category listed in the terms: that category's T1 cap; otherwise `defaultT1Cap` |
| Terms | `abi.encode(address payeeBook, address asset, uint256 defaultT1Cap, uint256 newPayeeT1Cap, uint256 t2Ceiling, uint256 maxApprovalWindow, uint32[] categoryIds, uint256[] categoryT1Caps)`; length `320 + 64 * n` (arrays of equal length) |
| Args | empty, or `abi.encode(uint256 nonce, uint256 expiry, bytes signature)`. Checks: `block.timestamp <= expiry`, `expiry <= block.timestamp + maxApprovalWindow`, nonce unused, `SignatureChecker.isValidSignatureNow(delegator, approvalDigest(...), signature)` |
| Approval digest | EIP-712, domain `{name: "YINGLONG CoSign", version: "1", chainId: block.chainid, verifyingContract: this, salt: domainSalt}`, type `Approval(bytes32 delegationHash,bytes32 executionHash,uint256 nonce,uint256 expiry)`, `executionHash = keccak256(executionCallData)` |
| State | `nonceUsed[delegationManager][delegationHash][nonce]`, consumed in `beforeHook` |
| Errors | `AboveTierCeiling(uint256 amount, uint256 ceiling)`, `CoSignRequired(uint256 amount, uint256 threshold)` (also for an invalid signature), `SignatureExpired(uint256 deadline)`, `InvalidArgs()` (expiry beyond the window), `NonceAlreadyUsed(uint256 nonce)`, `InvalidTerms()`, `InvalidExecutionMode()`, `UndecodableExecution`, `NativeValueNotAllowed` |
| Compiler | step 4: one per `m.tiers` entry: `abi.encode(PayeeBook, asset, defaultT1Cap, newPayeeT1Cap, t2Ceiling, maxApprovalWindow, categoryT1Caps[].category ids, categoryT1Caps[].amount)` |
| Sentence | "Payments above {amt(defaultT1Cap)} need your approval on your phone{ (except {category} up to {amt}, ...)}; anyone new above {amt(newPayeeT1Cap)} also needs you; nothing above {amt(t2Ceiling)} is possible at all." |
| Tests | `NadiaMandateTest.test_T2_requiresCoSignAboveT1Cap`, `test_T2_coSignedPaymentPasses`, `test_T2_coSignNonceCannotBeReplayed`, `test_T2_coSignBoundToExactExecution`, `test_T2_ecdsaSignatureNeverSatisfiesPasskeyAccount` (invariant 9), `test_T2_newPayeeServiceAboveNewPayeeCap`, `test_T4_aboveT2Ceiling`, `test_T1_rentToVerifiedPayeeWithinBudget` (category cap for rent), `test_T4_reserveFloorBreached` (approved but still refused by the floor). Live: `T2 without approval` (revert `CoSignRequired`) and `T2 tuition escrow 5,000 tHKD co-signed by passkey` in `apps/agent/data/e2e-fisco.json` |

The agent attaches the approval to every `CoSignEnforcer` caveat of the delegation; only the caveat whose asset matches the payment reads it (`submitApproval` in `apps/agent/src/pipeline.ts`).

### 3.8 CategoryBudgetEnforcer (position 11, one per asset budget)

| Item | Value |
|---|---|
| Purpose | Budgets that bite: per-period caps per spending category for one asset. The category is the PayeeBook category of the beneficiary, never an agent argument; beneficiaries outside the book fall into `unlistedCategory`. A category without a cap in the terms has a cap of 0 |
| Hooks | `beforeHook`; emits `BudgetSpent(delegationManager, delegator, categoryId, asset, period, spent, cap)` |
| Period | `periodOf(start, length) = 0` before `start`, else `(block.timestamp - start) / length` (fixed periods) |
| Terms | `abi.encode(address payeeBook, address asset, uint64 periodStart, uint64 periodLength, uint32 unlistedCategory, uint32[] categoryIds, uint256[] caps)`; length `288 + 64 * n`; `periodLength` must be non-zero and the arrays of equal length |
| Args | ignored |
| State | `spent[keccak256(abi.encode(delegationManager, delegator, asset, categoryId, period))]`. Keyed by delegator, not by delegation, so the counters aggregate across every delegation of the account and a re-sealed mandate can never reset what was already spent in the period. Views: `spentKey`, `spentNow`, `periodOf` |
| Errors | `CategoryBudgetExceeded(uint32 categoryId, uint256 spent, uint256 cap)`, `InvalidTerms()`, `InvalidExecutionMode()`, `UndecodableExecution`, `NativeValueNotAllowed` |
| Compiler | step 5: one per `m.budgets` entry: `abi.encode(PayeeBook, asset, periodStart, periodLength, CATEGORY_IDS[unlistedCategory], caps[].category ids, caps[].amount)` |
| Sentence | "Every {period}: {list(category at most amt)}." |
| Tests | `NadiaMandateTest.test_T4_categoryBudgetExceeded_food`, `test_resealNeverResetsBudgets` |

Category ids: `contracts/src/utils/Categories.sol` and `CATEGORY_IDS` in `packages/mandate/src/constants.ts` (rent 1, food 2, tuition 3, transport 4, utilities 5, supplier 6, payroll 7, services 8, treasury 9, other 10).

### 3.9 ReserveFloorEnforcer (position 12)

| Item | Value |
|---|---|
| Purpose | "Never below the floor": after the whole redemption, the delegator's `balanceOf` of the asset must be at least the floor. On the coin-free rail, `ConditionalPaymentInstructions.balanceOf` returns the posted simulated balance minus pending instructions, so the same rule runs there |
| Hooks | `beforeHook` (`pure`: mode and terms check only), `afterAllHook` (`view`: the balance check, after the execution) |
| Terms | `abi.encode(address asset, uint256 floor)`, 64 bytes |
| Args | ignored |
| State | none |
| Errors | `ReserveFloorBreached(address asset, uint256 balanceAfter, uint256 floor)`, `InvalidTerms()`, `InvalidExecutionMode()` |
| Compiler | step 5: one per `m.reserveFloors` entry |
| Sentence | "Your {L(asset)} balance never goes below {amt(asset, amount)}." |
| Tests | `NadiaMandateTest.test_T4_reserveFloorBreached` |

### 3.10 VelocityEnforcer (position 13)

| Item | Value |
|---|---|
| Purpose | Limits how often and how much the agent moves per window: at most `maxCount` payments (any asset) and at most `maxOutflow` of `asset` per fixed window of `window` seconds. Defeats split payments |
| Hooks | `beforeHook`; emits `VelocityUsed(delegationManager, delegator, windowIndex, count, outflow)` |
| Window | `windowIndex = block.timestamp / window` (fixed windows, not rolling) |
| Terms | `abi.encode(address asset, uint64 window, uint32 maxCount, uint256 maxOutflow)`, 128 bytes; `window` must be non-zero |
| Args | ignored |
| State | `usage[keccak256(abi.encode(delegationManager, delegator, windowIndex))] = {uint32 count, uint256 outflow}`, aggregated across delegations of the account |
| Errors | `VelocityExceeded(uint256 count, uint256 outflow)`, `InvalidTerms()`, `InvalidExecutionMode()`, `UndecodableExecution`, `NativeValueNotAllowed` |
| Compiler | step 5: if `m.velocity`: `abi.encode(asset, window, maxCount, maxOutflow)` |
| Sentence | "At most {maxCount} payments and {amt(asset, maxOutflow)} per {window}." |
| Tests | `NadiaMandateTest.test_T4_velocityExceeded_splitPayments` |

A reverted transaction writes nothing, so the circuit breaker trips off-chain: when the policy mirror refuses a breaker-class rule (`BREAKER_RULES`, default `VelocityExceeded`) for a company principal, `apps/agent/src/pipeline.ts` asks the breaker watcher (`apps/indexer/src/breaker.ts`) to call `KillSwitchRegistry.trip(account)`.

### 3.11 SuitabilityEnforcer (position 14)

| Item | Value |
|---|---|
| Purpose | Suitability as code: when money flows into a listed test investment product, the product's risk class (1 to 5, `ProductRegistry`) must not exceed the class sealed in the mandate. Both recipient and beneficiary are checked; unlisted payees are not affected |
| Hooks | `beforeHook` (`view`) |
| Terms | `abi.encode(address productRegistry, uint8 maxRiskClass)`, 64 bytes |
| Args | ignored |
| State | none |
| Errors | `UnsuitableProduct(address product, uint8 riskClass, uint8 maxRiskClass)`, `InvalidTerms()`, `InvalidExecutionMode()`, `UndecodableExecution`, `NativeValueNotAllowed` |
| Compiler | step 5: if `m.suitability`: `abi.encode(ProductRegistry, maxRiskClass)` |
| Sentence | "Idle cash goes only into products of risk class {maxRiskClass} or lower." |
| Tests | `NadiaMandateTest.test_T4_unsuitableProduct`, `test_T1_sweepIntoSuitableFund` |

### 3.12 ReputationGateEnforcer (deployed, not emitted)

| Item | Value |
|---|---|
| Purpose | When the beneficiary holds a passport, its ERC-8004 reputation summarised over the sealed client list (1 to 10 clients) must reach the sealed minimum. Beneficiaries without a passport are not affected |
| Hooks | `beforeHook` (`view`); reads `walletInfo`, `erc8004IdOfWallet` and the ERC-8004 ReputationRegistry `getSummary(agentId, clients, tag1, "")` |
| Score | both sides scaled to 18 decimals; a count of 0 fails |
| Terms | `abi.encode(address reputationRegistry, address passportRegistry, address[] clients, int128 minScore, uint8 minScoreDecimals, string tag1)`; length `256 + 32 * clients + 32 * ceil(len(tag1) / 32)`; `MAX_CLIENTS = 10`, `minScoreDecimals <= 18` |
| Args | ignored |
| State | none |
| Errors | `ReputationTooLow(uint256 agentId, int256 score, int256 minScore)`, `InvalidTerms()`, `InvalidExecutionMode()` |
| Compiler | not emitted: `compileMandate` throws when `mandate.reputation` is set, because no deployment file carries an ERC-8004 reputation registry address yet; `ensurePassport` in `apps/agent/src/chain/passport.ts` registers passports with `erc8004AgentId = 0` |
| Sentence | none (decompiler: unknown) |
| Tests | none (deployed in the `YinglongBase` fixture but not exercised) |

### 3.13 VetoTimelockEnforcer (deployed, not emitted)

| Item | Value |
|---|---|
| Purpose | Scheduled payments with a veto window: the redeemer first announces the exact execution with `schedule(dm, delegationHash, delegator, executionCallData)`; redemption succeeds only after `window` seconds, only by the address that scheduled it, only if not vetoed, and consumes the schedule. The delegator vetoes directly (`veto`) or with a relayed passkey signature (`vetoWithSig`); a guardian stops everything through the kill switch instead |
| Hooks | `beforeHook`; events `Scheduled`, `VetoRecorded`, `ScheduleConsumed` |
| Veto digest | EIP-712, domain `{name: "YINGLONG Veto Timelock", version: "1", chainId, verifyingContract, salt}`, type `Veto(address delegationManager,bytes32 delegationHash,bytes32 executionHash,uint256 deadline)` |
| Terms | `abi.encode(uint256 window)`, 32 bytes |
| Args | ignored |
| State | `schedules[keccak256(abi.encode(dm, delegationHash, keccak256(executionCallData)))] = {scheduler, delegator, scheduledAt, vetoed}` |
| Errors | `NotScheduled()`, `Vetoed()`, `VetoWindowOpen(uint64 readyAt)`, `AlreadyScheduled()` (local), `Unauthorized(address)` (veto from a non-delegator), `SignatureExpired`, `InvalidSignature`, `InvalidTerms()`, `InvalidExecutionMode()` |
| Compiler | not emitted |
| Sentence | none (decompiler: unknown) |
| Tests | none (deployed in the `YinglongBase` fixture but not exercised) |

`schedule` is callable by any address; the schedule key does not include the scheduler. A third party that learns an execution before the agent schedules it could occupy its key first (the agent's `schedule` then reverts `AlreadyScheduled`, and the occupied entry is not redeemable by the agent). The enforcer is not emitted at this commit; this is listed as an open item in section 5.

### 3.14 ZKMandateEnforcer (`contracts/src/zk/ZKMandateEnforcer.sol`, deployed, not emitted)

| Item | Value |
|---|---|
| Purpose | Private, stateful mandate for ERC-20 payments. The user seals a Poseidon2 commitment to (cap, allowlist root, expiry, salt); for every redemption the agent proves in zero knowledge (circuit `circuits/mandate_compliance`, proof type `0x01`) that the payee is in the hidden allowlist, the claimed time T is not after the hidden expiry, and the running total stays within the hidden cap. The running total is itself a hiding commitment Poseidon2(total, blind) stored per (DelegationManager, delegationHash) |
| Hooks | `beforeHook` with the typed mode check (`InvalidExecutionMode`) followed by the framework modifiers `onlySingleCallTypeMode` and `onlyDefaultExecutionMode`; emits `MandatePaymentProven(delegationManager, delegationHash, redeemer, token, payee, amount, nonce, claimedTime, newRunningCommitment)` |
| Terms | `abi.encode(address router, bytes32 mandateCommitment)`, 64 bytes; router word must be a non-zero address, commitment below the BN254 scalar field |
| Args | exactly `abi.encode(uint256 nonce, uint64 claimedTime, bytes32 newRunningCommitment, bytes proof)` in canonical encoding (offset `0x80`, padded length), so `160 + ceil(len(proof) / 32) * 32` bytes; nonce and new commitment below the field, commitment non-zero. Proof size 7,616 bytes (`circuits/MANIFEST.json`) |
| Execution | must be ERC-20 `transfer(address,uint256)`, calldata exactly 68 bytes, clean address word, zero native value, amount at most 2^128 - 1; payee and amount come from calldata only |
| Clock rule | accepted only if `block.timestamp - 300 <= T <= block.timestamp + 60` (`MAX_CLAIMED_TIME_AGE`, `MAX_CLAIMED_TIME_SKEW`) |
| Public inputs (circuit order) | mandateCommitment, delegationHash high 128 bits, delegationHash low 128 bits, `block.chainid`, payee, amount, nonce, claimedTime, oldRunningCommitment (stored), newRunningCommitment (args) |
| State | `_running[delegationManager][delegationHash]` (view `runningCommitment`, initially `INITIAL_RUNNING_COMMITMENT` = Poseidon2(0, 0)); `nonceUsed[delegationManager][delegationHash][nonce]` |
| Errors | `InvalidMandateProof()`, `NonceAlreadyUsed(uint256)`, `ClaimedTimeOutOfRange(uint64, uint256)`, `AmountOutOfRange(uint256)`, `InvalidArgs()`, `InvalidTerms()`, `InvalidExecutionMode()`, `UndecodableExecution(bytes4)`, `NativeValueNotAllowed(uint256)`; router reverts `UnknownProofType`, `MalformedPublicInputs` |
| Verifier | `ZKVerifierRouter.verifyProof(0x01, proof, publicInputs)` dispatches to the bb 5.2.1 UltraHonk `HonkVerifier` and normalises every outcome to a bool; registration is append-only and the registrar can renounce |
| Compiler | not emitted by `compileMandate`; the token is not part of the statement, so a ZK mandate must be paired with `AllowedTargets` restricted to one ERC-20 |
| Sentence | decoded as rule kind `zkMandate` when the deployment lists the ZK stack (`OPTIONAL_CONTRACT_NAMES` in `packages/sdk/src/deployments.ts`): "Private mandate: every payment must carry a zero-knowledge proof that it stays within the hidden cap, payee list and expiry committed as {first 10 hex chars of the commitment}..." The Python decompiler (`tools/verify-py`) does not decode it yet |
| Gas | `circuits/MANIFEST.json`: `beforeHook` 2,566,806 (first payment) and 2,543,348 (later payment); `redeemDelegations` with the ZK caveat 2,832,510 and 2,815,420; measured in Foundry |
| Tests | `ZKMandateEnforcerTest`: `test_fixtureArgsMatchSolidityAbiEncoding`, `test_initialRunningCommitmentMatchesProver`, `test_publicInputLayoutMatchesProver`, `test_validProof_passes_and_advancesState`, `test_chainOfThree_reachesCapExactly`, `test_gas_verifyPath`, `test_replaySameNonce_reverts`, `test_replayProofUnderFreshNonce_reverts`, `test_invariant8_twoValidProofsAboveCap_secondFails`, `test_invariant8_reverseOrder_secondFails`, `test_outOfOrderChain_reverts`, `test_wrongPayee_notAllowlisted_reverts`, `test_wrongPayee_otherAllowlisted_reverts`, `test_tamperedAmount_reverts`, `testFuzz_tamperedAmount_reverts`, `test_tamperedNewRunningCommitment_reverts`, `test_wrongChainId_reverts`, `test_wrongDelegationHash_reverts`, `test_wrongMandateCommitment_reverts`, `test_tamperedProofByte_reverts`, `test_stateIsKeyedByDelegationManager`, `test_claimedTimeTooOld_reverts`, `test_claimedTimeTooFarAhead_reverts`, `test_claimedTimeWindowEdges_pass`, `test_expired_proofAtExpiry_lateBlock_reverts`, `test_expired_claimingLaterTimeThanProven_reverts`, `test_expiryTolerance_isAtMost300Seconds`, `test_nativeValue_reverts`, `test_notATransfer_reverts`, `test_transferWithExtraCalldata_reverts`, `test_dirtyRecipientBits_reverts`, `test_amountAboveU128_reverts`, `test_shortExecution_reverts`, `test_batchCallType_reverts`, `test_tryExecType_reverts`, `test_truncatedArgs_reverts`, `test_nonCanonicalArgs_reverts`, `test_nonceNotAFieldElement_reverts`, `test_zeroNewRunningCommitment_reverts`, `test_badTerms_revert`, `test_noImmutables_runtimeBytecodeIsChainIndependent`. `ZKMandateEnforcerDMTest`: `test_delegationHashMatchesProver`, `test_redeem_realProofs_movesTokensAndAdvancesState`, `test_redeem_replay_reverts`, `test_redeem_invariant8_secondFails`, `test_redeem_wrongPayee_reverts`, `test_redeem_tamperedAmount_reverts`. `ZKVerifierRouterTest`: `test_validProof_true`, `test_proofForOtherInputs_false`, `test_eachPublicInputIsBound`, `test_publicInputAboveFieldModulus_false`, `test_wrongNumberOfPublicInputs_false`, `test_truncatedProof_false`, `test_unknownProofType_reverts`, `test_malformedPublicInputs_reverts`, `test_registrationIsAppendOnly`, `test_onlyRegistrar`, `test_verifierMustHaveCode`, `test_renounceFreezesRouter`. Result recorded in `circuits/MANIFEST.json`: 59 of 59 passed |

---

## 4. Typed errors by enforcer

| Error (`contracts/src/utils/Errors.sol` unless noted) | Raised by |
|---|---|
| `PayeeNotVerified(address)` | `VerifiedPayeeEnforcer` |
| `CategoryBudgetExceeded(uint32, uint256, uint256)` | `CategoryBudgetEnforcer` |
| `ReserveFloorBreached(address, uint256, uint256)` | `ReserveFloorEnforcer` |
| `VelocityExceeded(uint256, uint256)` | `VelocityEnforcer` |
| `UnsuitableProduct(address, uint8, uint8)` | `SuitabilityEnforcer` |
| `RailNotPermitted(address, uint8)` | `JurisdictionEnforcer` |
| `Paused(address, address)` | `GlobalPauseEnforcer` |
| `CoSignRequired(uint256, uint256)`, `AboveTierCeiling(uint256, uint256)` | `CoSignEnforcer` |
| `VetoWindowOpen(uint64)`, `Vetoed()`, `NotScheduled()` | `VetoTimelockEnforcer` |
| `ForbiddenTarget(address)` | `ForbiddenTargetsEnforcer` |
| `LineageViolation(address)` | `AgentLineageEnforcer` |
| `MandateNotLive(bytes32)`, `MandateDelegationMismatch(bytes32, bytes32, bytes32)` | `MandateBindingEnforcer` |
| `ReputationTooLow(uint256, int256, int256)` | `ReputationGateEnforcer` |
| `InvalidMandateProof()` | `ZKMandateEnforcer` |
| `ClaimedTimeOutOfRange`, `AmountOutOfRange` (`contracts/src/zk/ZKErrors.sol`) | `ZKMandateEnforcer` |
| `UnknownProofType`, `ProofTypeAlreadyRegistered`, `VerifierHasNoCode`, `MalformedPublicInputs` (`ZKErrors.sol`) | `ZKVerifierRouter` |
| `InvalidTerms()`, `InvalidExecutionMode()` | every custom enforcer |
| `InvalidArgs()` | `MandateBindingEnforcer`, `CoSignEnforcer`, `ZKMandateEnforcer` |
| `UndecodableExecution(bytes4)`, `NativeValueNotAllowed(uint256)` | every enforcer that uses `PaymentDecoder`, and `ZKMandateEnforcer` |
| `SignatureExpired(uint256)`, `NonceAlreadyUsed(uint256)` | `CoSignEnforcer`, `ZKMandateEnforcer` (nonce), `VetoTimelockEnforcer.vetoWithSig` (expiry) |
| `QuoteExpired(uint64, uint256)` | `SignedQuoteSettlement` (a rail, not an enforcer) |

The TypeScript side decodes all of them with `decodeRevert` in `packages/sdk/src/errors.ts` (ABI `packages/sdk/src/abi/YinglongErrors.ts`); `tools/verify-py` decodes them in `verify-tx`.

---

## 5. Open items found while documenting

| Item | Detail |
|---|---|
| Not emitted by the compiler | `ReputationGateEnforcer` (compiler throws), `VetoTimelockEnforcer`, `ZKMandateEnforcer`, and the stock `LimitedCalls`, `Timestamp`, `Nonce`, `Redeemer`, `ERC20TransferAmount`, `AllowedCalldata`; apart from `ZKMandateEnforcer` (TypeScript only), none has a decompiler sentence, so a delegation that carried one would fail the round-trip check "every rule decodes" |
| No tests | `ReputationGateEnforcer`, `VetoTimelockEnforcer`; Foundry invariant campaign over the custom enforcers: `invariants.passing`: <!-- gen:invariants.passing -->5/10 (invariants 1, 2, 3, 4, 5 held in one Foundry stateful-fuzz campaign of 128 runs x 64 calls; 5 of the 10 have no fuzz campaign; source: forge test in this finalize run)<!-- /gen --> |
| `VetoTimelockEnforcer.schedule` | open to any caller with a key that omits the scheduler (section 3.13) |
| `CoSignEnforcer` | an invalid approval signature reverts `CoSignRequired`, not `InvalidSignature` |
| Assets without a tier entry | `CoSignEnforcer` and `CategoryBudgetEnforcer` skip payments in assets they do not name; a mandate must carry one tier entry and one budget entry per allowed asset (both scenario mandates in `packages/mandate/src/scenarios.ts` do) |
