# Contract analysis evidence (`contracts/reports/`)

*What each machine-generated report about the Solidity contracts is, how to rerun it, and what it does not show.*

**Summary (5 lines)**
1. The reports (`slither.json`, `aderyn.json`, `coverage.json`, `gas.json`, `symbolic.json`, `fuzz.json`) plus `versions.json` are written by `contracts/reports/gen_reports.py` from raw tool output kept next to them.
2. No number in this file or in the reports is typed by hand; the only hand-written content is the Slither and Aderyn triage text (verdict and one-line reason per finding) inside `gen_reports.py`.
3. Every report carries `tool`, `version`, `command`, `generatedAt`, `commit` (`git rev-parse HEAD` at generation), `srcTree` (the git tree hash of `contracts/src`, unchanged by commits that do not touch it) and the uncommitted paths under `contracts/` at that moment.
4. The symbolic results are bounded checks of our enforcers' hook logic, not a full proof and not a check of the whole system.
5. This is internal tooling output, not an audit.

## Keys fed to `scripts/finalize`

| Key (docs/GENERATED_KEYS.md) | File | JSON path |
|---|---|---|
| `static.slither.high` | `slither.json` | `openAfterTriage.High` (raw count in `rawCountsByImpact.High`) |
| `static.slither.medium` | `slither.json` | `openAfterTriage.Medium` (raw count in `rawCountsByImpact.Medium`) |
| `static.aderyn.high` | `aderyn.json` | `openAfterTriage.HighInstances` (raw counts in `rawCounts`; `status` says whether it ran) |
| `coverage.contracts` | `coverage.json` | `total.lines.pct` and `total.branches.pct` (hit/found beside them) |
| `gas.overhead.median` | `gas.json` | `headline.median` with `headline.n` and `headline.p95` |
| `proofs.symbolic.status` | `symbolic.json` | `summary`, `properties[].status`, `bounds` |
| `review.tools.versions` | `versions.json` | `tools` |
| `fuzz.calls` | `fuzz.json` | `calls.total` (definition in `calls.definition`) |

## Setup

All commands run on the team's Windows machine with Git Bash; caches stay off `C:`.

```bash
export TEMP=D:/tools/tmp TMP=D:/tools/tmp UV_CACHE_DIR=D:/tools/uv-cache \
       UV_TOOL_DIR=D:/tools/uv-tools UV_TOOL_BIN_DIR=D:/tools/uv-bin UV_PYTHON_INSTALL_DIR=D:/tools/uv-python
export PATH=/d/tools/foundry:/d/tools/uv-bin:/d/tools/aderyn-bin:$PATH
uv tool install --python 3.12 slither-analyzer
# halmos pulls safe-pysha3, which needs MSVC on Windows; use the pycryptodome keccak backend instead
printf 'eth-hash[pycryptodome]==0.8.0\n' > D:/tools/tmp/halmos-overrides.txt
uv tool install --python 3.12 halmos --overrides D:/tools/tmp/halmos-overrides.txt
```

After producing any raw file, rebuild the JSON with `python reports/gen_reports.py <name>` (or `all`) from `contracts/`.

## 1. Slither: `slither.json`, `slither.raw.json`, `slither.log.txt`

- **What:** Slither over `contracts/src` only. `rawCountsByImpact` counts every result by impact (High, Medium, Low, Informational, Optimization). Every High and Medium result is triaged in `triage[]` with detector, location, verdict and a one-line reason; `openAfterTriage` counts those not marked false positive (an untriaged new finding counts as open). True positives, if any, are listed in `truePositives` and are not fixed by this work.
- **Rerun** (from `contracts/`):
  ```bash
  slither . --filter-paths "lib/|test/|script/" --json reports/slither.raw.json > reports/slither.log.txt 2>&1
  python reports/gen_reports.py slither
  ```
  Slither's Foundry integration runs `forge clean` and a forced build that skips tests and scripts, so run `forge build` afterwards.
- **Does not show:** anything about `lib/` (the MetaMask Delegation Framework, OpenZeppelin, and others); Low, Informational and Optimization results are counted, not triaged; the triage is ours, not independent.

## 2. Aderyn: `aderyn.json`, `aderyn.raw.json`, `aderyn.attempts.json`, `aderyn-windows.patch`

- **What:** Aderyn over `contracts/src`. `rawCounts` gives High and Low issues (Aderyn has no Medium level) and their instance counts; every High instance is triaged in `triage[]` with detector, location, verdict and a one-line reason, and `openAfterTriage.HighInstances` counts those not marked false positive. True positives, if any, are listed in `truePositives` and are not fixed by this work.
- **How the binary was obtained:** Aderyn publishes no Windows build, so it was compiled from the official v0.6.8 source release (checksum verified) with Rust stable for `x86_64-pc-windows-gnu`, plus the small local patch in `contracts/reports/aderyn-windows.patch`: a non-Unix fallback for the MCP server's signal handler, and path normalisation (separators and the Windows verbatim prefix) where per-file stats are collected and looked up. Without it the tool panicked on every finding. No detector code is changed. `aderyn.attempts.json` records every installation attempt and why the earlier ones failed.
- **Rerun** (from `contracts/`, with the built `aderyn` on PATH; on Linux or macOS `npm i -g @cyfrin/aderyn` gives an unpatched binary):
  ```bash
  # build on Windows (once): unpack the v0.6.8 source release, apply the patch, then
  #   export RUST_MIN_STACK=268435456 RUSTC_BOOTSTRAP=aderyn_driver CARGO_PROFILE_RELEASE_LTO=false
  #   cargo +stable build --release --locked -p aderyn   (msys64 mingw64 binutils first on PATH)
  aderyn . --src src -x lib,test,script -o reports/aderyn.raw.json
  python reports/gen_reports.py aderyn
  ```
- **Does not show:** anything about `lib/`; Low findings are counted, not triaged; the triage is ours, not independent; results come from a locally patched build, so they could differ from an official binary if the patch had side effects beyond the code it touches.

## 3. Coverage: `coverage.json`, `lcov.info`, `coverage.summary.txt`

- **What:** line, statement, branch and function coverage of every file under `contracts/src`, per file and in total, from one `forge coverage` run of the whole Foundry suite. Totals are summed from the per-file hit/found counts; rows for `test/`, `script/` and `lib/` in the same run are dropped.
- **Rerun** (from `contracts/`):
  ```bash
  forge coverage --report summary --report lcov --report-file reports/lcov.info > reports/coverage.summary.txt
  python reports/gen_reports.py coverage
  ```
  `--ir-minimum` was not needed.
- **Does not show:** that covered code is correct; Foundry instruments without the optimizer, so the measured bytecode differs from the deployed one; Halmos `check_` functions are not executed by `forge coverage` and add nothing to it.

## 4. Gas overhead: `gas.json`, `gas.raw.json`, `contracts/test/GasOverhead.t.sol`

- **What:** the gas of one redemption (an agent paying a small fixed tHKD amount, `PAY` in the test, to a verified payee through `DelegationManager.redeemDelegations`) under Nadia's full sealed mandate (`YinglongBase._nadiaCaveats`: the stock AllowedTargets, AllowedMethods and ValueLte caveats plus the YINGLONG caveats) versus the same payment under a delegation with stock enforcers only (AllowedTargets, AllowedMethods, ValueLte, ERC20TransferAmount). Both are signed by the same passkey, so signature verification cancels out. Samples of the two configurations are interleaved; the headline is the median of the per-payment differences at a daily cadence, where every redemption opens a new VelocityEnforcer window (the more expensive case). The intraday cadence (several payments per window) and the marginal cost of each YINGLONG caveat (full mandate minus that caveat) are reported beside it. The effective Foundry config has `isolate = true`, so each sample is a separate transaction and includes the base transaction cost and the calldata cost; the calldata part is reported separately.
- **Rerun** (from `contracts/`):
  ```bash
  forge test --match-path test/GasOverhead.t.sol                      # must pass
  forge test --match-path test/GasOverhead.t.sol --json -vv > reports/gas.raw.json
  python reports/gen_reports.py gas
  ```
  `-vv` is required for the JSON to contain the `GAS|...` console lines; the generator strips raw event logs and traces from the saved file.
- **Does not show:** gas on Base Sepolia or FISCO BCOS (this is the local Foundry EVM with `evm_version = london`); L2 data fees; other payment shapes (co-signed, escrow, quote settlement, instruction rail) or other mandates; the per-caveat marginals do not add up exactly to the total because removing a caveat also changes encoding and memory costs shared by all caveats.

## 5. Bounded symbolic execution: `symbolic.json`, `halmos.raw.json`, `halmos.log.txt`, `contracts/test/symbolic/SymbolicEnforcers.t.sol`

- **What:** Halmos `check_` functions for the properties behind invariants 1 to 5 of `contracts/test/invariants/MandateInvariants.t.sol`, each calling one of our enforcer hooks directly with symbolic inputs (amounts, recipients, targets, timestamps, pause actions, payment shapes):
  1. category caps: `CategoryBudgetEnforcer` over a bounded sequence of payments with a ghost sum per category and period;
  2. reserve floor: `ReserveFloorEnforcer.afterAllHook` passes exactly when the final balance is at least the floor, and every hook accepts only single-call default-mode executions;
  3. pause: `GlobalPauseEnforcer.beforeAllHook` never passes while `KillSwitchRegistry.isPaused` is true or the redeemer's passport is not active;
  4. verified payees: `VerifiedPayeeEnforcer` only passes beneficiaries in the delegator's `PayeeBook` or trusted agent wallets, through sealed intermediaries;
  5. authority: `ForbiddenTargetsEnforcer` never lets a call reach the delegator, the DelegationManager or a listed address.

  Each property has a status (`proved within bounds`, `counterexample`, `timeout`, `not run`), the symbolic inputs, the path counts and the measured time. Each property also has a vacuity probe (`check_vacuity_*`) that asserts the hook always refuses; Halmos is expected to find a counterexample for it, which shows the property check is not passing only because every path reverts. Probes therefore appear as `[FAIL]` in the Halmos log by design.
- **Rerun** (from the repository root):
  ```bash
  FOUNDRY_DYNAMIC_TEST_LINKING=false halmos --root contracts --match-contract '^Sym' --function check_ \
    --loop 4 --solver-timeout-assertion 300000 --json-output contracts/reports/halmos.raw.json
  cd contracts && python reports/gen_reports.py symbolic
  ```
  Foundry's dynamic test linking (on by default in this Foundry version) rewrites `new Contract()` in tests into `vm.deployCode` calls, which Halmos does not support, so it is switched off for this run only.
- **Does not show:** a full proof. The bounds are those in `symbolic.json` (loop unrolling, solver timeout, a fixed number of payments in the budget check, a fixed-length forbidden list, fixed byte lengths). The DelegationManager, the smart account, P-256 and ECDSA signature checks, the passport registry (replaced by a mock with settable answers) and the composition of all caveats in one redemption are not symbolically executed; that composition is only exercised (not proved) by the fuzzed invariant campaign. Kontrol was not run.

## 6. Fuzz and invariant calls: `fuzz.json`, `forge-test.raw.json`

- **What:** the number of calls executed by the invariant campaign (handler calls over all runs and depth) and by the fuzz tests (one call per run), with the run and depth settings, from one `forge test --json` run of the whole suite with the repository's default profile. Foundry runs the `invariant_*` functions of `MandateInvariantsTest` in one shared campaign and checks all of them after every call, so the campaign's calls are counted once. Per-test inline configuration (a `forge-config` comment) can lower a fuzz test's runs below the profile default; the per-test values are listed in `campaigns`.
- **Rerun** (from `contracts/`):
  ```bash
  forge test --json > reports/forge-test.raw.json
  python reports/gen_reports.py fuzz      # also strip the traces field from the raw file if it is large
  ```
- **Does not show:** what the fuzzer explored beyond the call count (no corpus coverage); the deeper `ci` and `deep` profiles in `foundry.toml` were not used for this report; the handler catches reverting redemptions, so refused payments are counted as calls, not as reverts.

## Versions: `versions.json`

`python reports/gen_reports.py versions` records `--version` of every tool found on PATH (`forge`, `slither`, `halmos`, `aderyn`) and the pinned `solc` from `foundry.toml`.

## Regenerating after a commit

The reports name the commit that was `HEAD` when they were generated and list the files under `contracts/` that were not yet committed. After committing the tests and scripts, rerun the tool commands above and then `python reports/gen_reports.py all`, so the reports point at a commit that contains everything they measured. Running only `gen_reports.py` re-reads the old raw files and would stamp them with the new commit.
