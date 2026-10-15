# FISCO BCOS consortium ledger (YINGLONG)

The coin-free consortium rail of YINGLONG: a FISCO BCOS 3.17.1 chain run by the team on one VM, used to
show that the same MetaMask Delegation Framework bytecode that runs on the public testnets also runs on a
consortium chain, with a separate observer node standing in for a regulator.

> Honest label: this is a **team-run test chain on a single VM** (KR-04). Four consensus nodes on one
> host give no real fault tolerance or independence; anchoring proves consistency, not consensus. It is
> not a production network and is not operated by, or connected to, any institution.

## Layout

| Item | Value |
|---|---|
| Host | Azure VM `yinglong-vps`, Ubuntu 24.04, 2 vCPU, 8 GiB RAM + 4 GiB swap, user `azureuser` |
| Software | FISCO BCOS **3.17.1**, standard (non-SM) build, official `build_chain.sh` and `fisco-bcos-linux-x86_64.tar.gz` from the v3.17.1 GitHub release (SHA-256 pinned in `build-chain.sh`) |
| Chain | `chain0`, one group `group0`, PBFT, executor version 1 (the default of `build_chain.sh` 3.17.1), auth check off |
| Nodes | `node0`..`node3` consensus (sealers), `node4` observer ("regulator node") |
| Files on the server | `/opt/yinglong/fisco` (`dist/` release assets, `nodes/127.0.0.1/node*` node directories, `nodes/ca` chain CA, `backups/`, the scripts from this folder) |
| Foundry on the server | v1.8.5 in `/opt/yinglong/tools/foundry`, `cast` linked to `/usr/local/bin/cast` |

Ports (every FISCO socket is bound to **127.0.0.1**; only Caddy's 80/443 and SSH are reachable from outside):

| Node | Role | P2P | Native RPC (TLS, SDK cert) | Web3 JSON-RPC | systemd unit |
|---|---|---|---|---|---|
| node0 | consensus | 30300 | 20200 | **8545** | `yinglong-fisco-node0.service` |
| node1 | consensus | 30301 | 20201 | 8546 | `yinglong-fisco-node1.service` |
| node2 | consensus | 30302 | 20202 | 8547 | `yinglong-fisco-node2.service` |
| node3 | consensus | 30303 | 20203 | 8548 | `yinglong-fisco-node3.service` |
| node4 | observer (regulator) | 30304 | 20204 | 8549 | `yinglong-fisco-node4.service` |

The RPC is **not exposed publicly**. Do not add it to Caddy before the governance issue under
"Limitations" is addressed.

## How the chain was built

All commands ran on the server as `azureuser` from `/opt/yinglong/fisco`; the scripts are the files in
this folder, copied there with `scp`.

1. `bash build-chain.sh`
   - downloads `build_chain.sh` and `fisco-bcos-linux-x86_64.tar.gz` (v3.17.1) and checks their SHA-256;
   - runs `bash build_chain.sh -l 127.0.0.1:5 -p 30300,20200 -o /opt/yinglong/fisco/nodes -e /opt/yinglong/fisco/dist/bin/fisco-bcos`
     (no `-s`, so the chain uses secp256k1 + keccak256; an SM build would switch KECCAK256/CREATE2 to SM3);
   - removes node4 from the genesis sealer list, so the genesis has exactly four consensus nodes;
   - appends a `[features]` section to the genesis: `feature_evm_timestamp=1`, `feature_evm_address=1`,
     `feature_evm_cancun=1` (`feature_balance` is left off); `compatibility_version` stays at the
     3.17.1 default and the Web3 chain id at the `build_chain.sh` default;
   - rewrites every `config.ini`: `[p2p]`, `[rpc]` and `[web3_rpc]` `listen_ip=127.0.0.1`,
     `[web3_rpc] enable=true`, Web3 port 8545 + node index;
   - checks that the five `config.genesis` files are byte-identical.
2. `sudo bash install-systemd.sh`: writes `yinglong-fisco-node0..4.service` (one per node,
   `Restart=always`, `RestartSec=5`, `WantedBy=yinglong-fisco.target`) and `yinglong-fisco.target`
   (`WantedBy=multi-user.target`), enables and starts them.
3. `bash add-observer.sh`: registers node4 as an observer with the ConsensusPrecompiled
   (`0x...1003`) `addObserver(string)` call, sent as an ordinary Web3 transaction signed by the chain
   admin account that `build_chain.sh` generated (`nodes/ca/accounts/`, server only).
4. `bash collect-facts.sh > chain-facts.json` (copied back as `infra/fisco/chain-facts.json`).

Features were set in the genesis rather than with `setSystemConfigByKey`, so they are active from block 0.
The same switches can be flipped later without the Java console: send `setValueByKey("feature_x","1")` to the
SystemConfigPrecompiled at `0x0000000000000000000000000000000000001000` as a Web3 transaction (with auth
check off any account may do so; it takes effect from the next block). No FISCO console, Java runtime or
WeBASE was installed.

## Operations

```bash
# on the server
bash /opt/yinglong/fisco/status.sh                 # units, sockets, heights, sealers/observers, features
sudo systemctl stop yinglong-fisco.target          # stop all five nodes
sudo systemctl start yinglong-fisco.target         # start all five nodes
sudo systemctl restart yinglong-fisco-node4        # one node
journalctl -u yinglong-fisco-node0 -n 50           # unit events; node logs: nodes/127.0.0.1/node0/log/
bash /opt/yinglong/fisco/backup.sh                 # online backup, keeps 7 archives in /opt/yinglong/fisco/backups
```

- The units start on boot (`yinglong-fisco.target` is wanted by `multi-user.target`) and restart on any exit.
  A killed node was observed to come back under systemd; a full VM reboot has **not** been performed yet
  (to avoid interrupting `edge-caddy`); do one when convenient and run `status.sh` afterwards.
- Do not use the `start_all.sh` / `stop_all.sh` / `node*/start.sh` scripts generated by `build_chain.sh`:
  they bypass systemd and would start duplicate processes.
- `backup.sh` stops node0 only (the other three sealers keep the PBFT quorum), archives node0's data plus all
  configs, node keys, the chain CA and SDK certificates, restarts node0 and lets it catch up. The archives are
  sensitive (mode 600) and must never be copied into this repository. Restore: stop the target, untar into
  `/opt/yinglong/fisco`, give each node the archived `node0/data` (or let it resync), start the target.

### Reaching the RPC from a laptop (SSH tunnel)

SSH is allowed only from the team lead's IP. From that machine:

```powershell
# PowerShell (Windows OpenSSH)
& "$env:WINDIR\System32\OpenSSH\ssh.exe" -i "$env:USERPROFILE\.ssh\yinglong-vps_key.pem" -N `
  -L 8545:127.0.0.1:8545 -L 8549:127.0.0.1:8549 azureuser@20.239.152.146
```

```bash
# Git Bash / Linux / macOS
ssh -i ~/.ssh/yinglong-vps_key.pem -N -L 8545:127.0.0.1:8545 -L 8549:127.0.0.1:8549 azureuser@20.239.152.146
```

Then `cast chain-id --rpc-url http://127.0.0.1:8545`. Use another local port (for example
`-L 18545:127.0.0.1:8545`) when a local anvil already occupies 8545. Port 8549 is the observer node.

## Probe and spike

Everything lives in `contracts-fisco/` (Foundry project; the framework is compiled from the unmodified
`contracts/lib/delegation-framework` submodule at v1.3.0 with solc 0.8.23, `evm_version = london`,
200 optimizer runs, no metadata hash):

| File | Purpose |
|---|---|
| `contracts-fisco/probe/FiscoProbe.sol` | probe contracts (`FiscoProbe`, `ProbeChild`, `ProbeP256`) |
| `contracts-fisco/src/FrameworkImports.sol` | pulls EntryPoint v0.7, DelegationManager, Hybrid/MultiSig DeleGators, the stock enforcers and ERC1967Proxy into the build |
| `contracts-fisco/src/spike/SpikeTestToken.sol` | test ERC-20 (no value) |
| `contracts-fisco/script/probe.mjs` | deploys the probe and writes `contracts-fisco/reports/probe-<date>.json` |
| `contracts-fisco/script/spike.mjs` | deploys the framework, signs a delegation, redeems it, writes `contracts-fisco/deployments/fisco-spike.json` (or `anvil-spike-<chainId>.json`) |
| `contracts-fisco/script/compare-codehash.mjs` | compares runtime code hashes FISCO vs anvil, writes `contracts-fisco/reports/codehash-compare-<date>.json` |
| `contracts-fisco/script/lib/chain.mjs`, `curves.mjs` | dependency-free JSON-RPC, keccak-256, RLP, raw transactions (signatures from `cast wallet sign --no-hash`), SM2/P-256 test vectors |

```bash
cd contracts-fisco
forge build
FISCO_RPC_URL=http://127.0.0.1:8545 node script/probe.mjs        # throwaway key, nothing funded
node script/spike.mjs --target fisco --rpc http://127.0.0.1:8545 # refuses to overwrite fisco-spike.json without --force
anvil --hardfork london --port 28545                              # and --chain-id 20200 --port 28546 for the second run
node script/spike.mjs --target anvil --rpc http://127.0.0.1:28545
node script/compare-codehash.mjs
node ../infra/fisco/render-readme.mjs                             # refreshes the block below
```

Keys: the spike reads the role keys from `../.secrets/testnet-keys.json` at runtime (outside the repository)
and passes them only to `cast wallet sign`. Roles used: `deployer` (all deployments), `supervisor`
(DelegationManager owner), `director-1` (owner of the HybridDeleGator account, signs the delegation),
`agent-treasurer` (delegate, sends `redeemDelegations`), `svc-shenzhen-components` (recipient). The
probe signs with a random key generated in memory. FISCO charges no gas (gas price 0), so nothing was funded.

## Results

<!-- generated:results:start -->
_Generated by `node infra/fisco/render-readme.mjs` from `infra/fisco/chain-facts.json`, `contracts-fisco/reports/probe-2026-10-16.json`, `contracts-fisco/deployments/fisco-spike.json` and `contracts-fisco/reports/codehash-compare-2026-10-16.json`. Do not edit by hand._

### Chain facts (collected on the server)

| Item | Value |
|---|---|
| fisco-bcos | 3.17.1 (Linux/g++/Release), commit `b29d0cbe16...c9bb`, binary sha256 `e67cd8f86926...0541` |
| Release tarball / build_chain.sh sha256 | `28eb054bb222...3cbb` / `ed667e1e346a...dbe7` |
| Genesis sha256 (identical on all 5 nodes) | `1057114f31ad...7c86` (yes) |
| sm_crypto / auth check / executor version | false / false / 1 |
| chain / group | chain0 / group0 |
| Genesis [features] | feature_evm_timestamp=1, feature_evm_address=1, feature_evm_cancun=1 |
| eth_chainId | 0x4ee8 (20200) |
| Consensus | PBFT, min_seal_time 500 ms, 4 sealers, 1 observer |
| addObserver(node4) tx | `0xf7944a362a768930854fa5c16edd93d37c5834004c4879bd322137af33e51f50` (block 1, status 0x1, to `0x0000000000000000000000000000000000001003`) |
| fisco-bcos sockets | all 15 on 127.0.0.1 |
| Non-loopback listeners on the host | 0.0.0.0:22, 0.0.0.0:443, 0.0.0.0:80, [::]:22, [::]:443, [::]:80 |
| Collected at | 2026-10-15T21:19:11Z |

System config read back through the SystemConfigPrecompiled (`getValueByKey`, value / enable block; `"" / -1` means never set, i.e. off):

| Key | Value | Enabled from block |
|---|---|---|
| `compatibility_version` | `3.17.1` | 0 |
| `tx_gas_limit` | `3000000000` | 0 |
| `tx_gas_price` | `0x0` | 0 |
| `web3_chain_id` | `20200` | 0 |
| `executor_version` | `1` | 0 |
| `feature_evm_timestamp` | `1` | 0 |
| `feature_evm_address` | `1` | 0 |
| `feature_evm_cancun` | `1` | 0 |
| `feature_balance` | (unset) | -1 |

Nodes:

| Node | Role | Node ID | P2P | Native RPC | Web3 RPC | systemd unit | State |
|---|---|---|---|---|---|---|---|
| node0 | consensus | `7199ec3a26...c934` | 127.0.0.1:30300 | 127.0.0.1:20200 | 127.0.0.1:8545 | `yinglong-fisco-node0.service` | active, enabled, Restart=always |
| node1 | consensus | `eb9c9ae4ce...df6a` | 127.0.0.1:30301 | 127.0.0.1:20201 | 127.0.0.1:8546 | `yinglong-fisco-node1.service` | active, enabled, Restart=always |
| node2 | consensus | `5e2aede5cd...6864` | 127.0.0.1:30302 | 127.0.0.1:20202 | 127.0.0.1:8547 | `yinglong-fisco-node2.service` | active, enabled, Restart=always |
| node3 | consensus | `40aa041fcc...e51e` | 127.0.0.1:30303 | 127.0.0.1:20203 | 127.0.0.1:8548 | `yinglong-fisco-node3.service` | active, enabled, Restart=always |
| node4 | observer (regulator) | `9265510cbb...688a` | 127.0.0.1:30304 | 127.0.0.1:20204 | 127.0.0.1:8549 | `yinglong-fisco-node4.service` | active, enabled, Restart=always |

### Probe results (2026-10-15T21:13:53.812Z)

| Question | Observed on FISCO | Report field |
|---|---|---|
| eth_chainId | 0x4ee8 (20200) | chain |
| CHAINID opcode inside a contract | 20200 in a mined tx, 20200 in eth_call; equals eth_chainId: yes | evmContext |
| TIMESTAMP units | seconds (block.timestamp 1792098840, 0 s from wall clock); RPC header timestamp in seconds | evmContext |
| Other context opcodes | block.gaslimit 3,000,000,000, basefee 0, coinbase `0x0000000000000000000000000000000000000000`, prevrandao 0, gasprice 0; BLOCKHASH(n-1) equals RPC parent hash: yes | evmContext |
| Block time | blocks only when transactions are pending (0 blocks in 5 s idle); submit-to-receipt median 199 ms (min 198, max 518) over the SSH tunnel | blockTime |
| Legacy (type 0) required? | no: type 2 accepted (status 0x1, reported type 0x2); type 0 also works | txType2, txType0Details |
| Legacy tx as reported by eth_getTransactionByHash | type 0x0, chainId 0x4ee8, v 0x1 (y-parity, not EIP-155 v), gasPrice 0x0 | txType0Details |
| Max contract size | no EIP-170 limit: runtimes up to 65,536 bytes deployed; initcode 49,152 bytes accepted, 49,153 (MaxInitCodeSizeExceeded), 65,536 (MaxInitCodeSizeExceeded) rejected (EIP-3860 limit enforced at the RPC) | contractSizeLimits |
| Gas limit | eth_getBlockByNumber gasLimit 30,000,000; EVM block.gaslimit 3,000,000,000 (= system tx_gas_limit); tx with gas 3,000,000,001 accepted: yes | gasLimits |
| Gas price | eth_gasPrice 0x0, baseFeePerGas 0x0 | chain |
| EXTCODEHASH | contract: equals keccak256(eth_getCode) yes; EOA with nonce: `0x000000...0000` (keccak256("") on Ethereum: no); non-existent: zero yes | extcodehash |
| CREATE address | Ethereum formula keccak(rlp(sender, nonce)) for a top-level web3 deploy: yes; for CREATE inside a contract (contract nonce starts at 1): yes | deployLegacyType0, createAddress |
| CREATE2 | works: yes (actual = in-contract prediction = off-chain prediction) | create2 |
| P-256 precompile 0x100 (RIP-7212) | absent: direct eth_call errors, staticcall from a contract returns success with 0 bytes; the framework's verifier falls back to the SCL Solidity verifier: valid signature accepted yes, tampered rejected yes, eth_estimateGas 261,807 gas | p256 |
| Crypto precompile 0x...100a | answers. sm3("abc") matches the GB/T 32905 vector: yes; keccak256Hash matches the opcode: yes; sm2Verify valid signature: yes, returned account = right160(sm3(pub)): yes, wrong message rejected: yes | fiscoCryptoPrecompile0x100a |
| sm2Verify convention | sm2Verify(M, pub64, r, s) checks (r, s) over e = SM3(Z_A || M), default user ID 1234567812345678; a signature over M itself (no Z_A) is rejected: yes | fiscoCryptoPrecompile0x100a |
| eth_getLogs | works (yes) but the filter must carry address, topics, fromBlock and toBlock keys; topic matching is case-sensitive (lowercase hex works, mixed case returns 0); blockHash filters rejected. eth_newFilter + eth_getFilterLogs: 3 logs | ethGetLogs.filterShapes |
| eth_call with state overrides | silently ignored: stateDiff applied no, code override applied no (no error is returned) | ethCallStateOverride |
| eth_call block tag | ignored: a call at an older block returns the latest state (no honoured) | historicalEthCall |
| eth_estimateGas | exact (estimate minus gasUsed: ping 0, burn 0, deploy 0); sending with exactly the estimate succeeds; a reverting call returns JSON-RPC error code 16 with an empty message and the ABI-encoded revert data in error.data; gas metering differs from Ethereum (a small contract deployment used 2,259 gas) | estimateGas |
| Reverted transaction | mined with status 0x0; the receipt carries no revert data; eth_call replay returns it (decoded: `probe-revert-reason`) | revertOnChainAndReplay |
| Native value | a tx with value 1 wei is mined but reverts (status 0x0): `Account balance is not enough!` (feature_balance off) | nativeValue |
| Cancun opcodes at runtime | PUSH0 works, TSTORE_TLOAD works, MCOPY works, BLOBBASEFEE works, BASEFEE works (executor v1 always runs the Cancun revision) | cancunOpcodesAtRuntime |
| Nonce | eth_getTransactionCount latest 38, pending 38 | nonces |
| debug_traceTransaction | not supported (Method not found) | debugTrace |
| RPC methods answered | `web3_clientVersion`, `net_version`, `net_listening`, `net_peerCount`, `eth_chainId`, `eth_syncing`, `eth_blockNumber`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_accounts`, `eth_coinbase`, `eth_mining`, `eth_getBalance`, `eth_getTransactionCount(latest)`, `eth_getTransactionCount(pending)`, `eth_getBlockByNumber(latest)`, `eth_getBlockByNumber(pending)`, `eth_getBlockByNumber(safe)`, `eth_getBlockByNumber(finalized)`, `eth_getBlockByNumber(earliest)`, `eth_estimateGas`, `eth_newBlockFilter`, `eth_newPendingTransactionFilter` | rpcMethods |
| RPC methods not available | `eth_protocolVersion`, `eth_feeHistory`, `eth_getBlockReceipts`, `eth_getProof`, `eth_createAccessList`, `eth_simulateV1`, `txpool_status`, `debug_traceCall` | rpcMethods |

eth_getLogs filter shapes:

| Filter | Result |
|---|---|
| address+topics+range | ok, 3 logs |
| address+range (no topics key) | error: topics is null |
| address+range+topics[] | ok, 3 logs |
| address[]+topics+range | ok, 3 logs |
| topics+range (no address key) | error: address is null |
| address:[]+topics+range | ok, 3 logs |
| address+topics (no range) | error: fromBlock is null |
| null wildcard + indexed sender topic (lowercase hex) | ok, 3 logs |
| null wildcard + indexed sender topic (mixed-case hex) | ok, 0 logs |
| OR list in topic0 | ok, 3 logs |
| blockHash only | error: fromBlock is null |
| blockHash+address+topics | error: fromBlock is null |

### Delegation Framework v1.3.0 spike on FISCO (2026-10-15T21:09:08.839Z)

**Verdict: GO.** all framework contracts deployed: yes; deployed runtime equals the compiled artifact (immutables aside): yes; delegation signature valid through ERC-1271: yes; redemption within the cap: yes; redemption above the cap reverted: yes with `ERC20TransferAmountEnforcer:allowance-exceeded`; redemption exactly to the cap: yes.

Deployed contracts (deployer role, nonces from 0):

| Contract | Address | Deploy tx | Runtime size | EXTCODEHASH |
|---|---|---|---|---|
| EntryPoint | `0x65005f35c005450f9E102db183672F780cD83d28` | `0xa8d1e4645406eb7562df5d2da36c6d90613ba9da238d9d4ca1a1161d98c60503` | 14,267 | `0xf1b49602dc4a377ac58c29d1b826ad5ed54f25b63ddcd5fc7dc9dfb5a6fac930` |
| SCL_RIP7212 | `0xc810d0CA070909c3FdeDD3a7b162015cD606b51f` | `0x51120cde170ce189d765aa81c58822ff9cca2c3a3ef9ffff021fe53b59c344b7` | 3,170 | `0x581401b1223186fcbb91547dee1bf1a04e85ef6520fae8c614120280d80e22cf` |
| DelegationManager | `0x5025bd3A74C7773da5A9866fCF3d0a2f585f5704` | `0x1d96c167dd124e8fb786acee8b856e035b61e39947e4c302c0abd5df05b1d20a` | 11,449 | `0xbc5a55bcfb71d710751418a34b0c9a31b50add9ffda69494f586ebe78c8504a0` |
| HybridDeleGatorImpl | `0xE1498aDc6b3b40dfB8321e9C99A75153800c1525` | `0x70be12c7cae5d2c8afd5f1044338952d550de5fb63ad46e828984a620b1bf41d` | 20,150 | `0xbc1bd99a190c342a6f3f8b332d6e76f137d89c93b10d4ad45daf0db79dd58286` |
| MultiSigDeleGatorImpl | `0x05282A658456a1444CE458d9F8bcb6D884E69f26` | `0x7c1e570f5d803b2d5185aeb6f6bb0f2e5b70ee01d98ba52e8f65dfb11698826d` | 16,896 | `0x84ff5b738e017e243839d3a232719ea1b3b9114f23e127296d358b4c2a5aefab` |
| AllowedTargetsEnforcer | `0x36B7b16E61bD2976Db2bFe7015D3ec9236374662` | `0xfb3e83a5f069e9225a6eb2a7c59f62a385ce4c7700997c356bc246f8a4d4918e` | 1,792 | `0xe4d2f0b66f717eb1e965e3b1c9fab141892bac911231a55e5420d2cbb7c741f3` |
| AllowedMethodsEnforcer | `0xdD08Ffa06fDCCf17b3E3Be6bd3cEe55ce46b89F7` | `0xe7788ca09796ca3d60868b4895fd80c46dfb32ed662bec5fdd5a8b08065e16c6` | 1,990 | `0x17344b881b76d2434975c15a034670182ce7045df1c1bdea41fec700e85e54c2` |
| ValueLteEnforcer | `0x4E0085530E3FE41B183Ca1dcd042399dec7A4DFB` | `0x00c0e43dc9b74de1396da5a7126a97faa1bbed166243da738445c7bd9b5ee4eb` | 1,218 | `0x8b8a23e180523c303f6f9c7344b8b749f5eec647a2f7d654ec1b158b9768018e` |
| TimestampEnforcer | `0x1CF85Ef7198B68864431Aec3EFE8F6c54A18947C` | `0x4e9b530eda80bae2b3f0d4594ca42929d16d47f9383383f7ba3cbb6cc30a6248` | 1,201 | `0xfca9d56e17358a33cfd86a7ee397301b3779716a8d0945467f7855dff7945324` |
| LimitedCallsEnforcer | `0xe23b2b669351Bd7fa2A73d515D0305Fe3114C6c3` | `0x5c9162a4c690cee6c76b2d3b22b2d655cf4ac626fa8f8fddec7b70af7acd7c98` | 1,203 | `0x3c72628386641c1a7ffc1f8e305251643ac65aa76030ffafea86b38d35862f7a` |
| NonceEnforcer | `0x37dC4E452Ade815a8473156811563379eEbea3CF` | `0xfd43f2fe74d5454538a9d3ab01abc947fb12299d9860a6b183a671e4f09613b5` | 1,240 | `0x627f5544b6cbf9f4e418f8e6f8b21b0a0017bad203b2bc728719eb9bbb9b49cf` |
| RedeemerEnforcer | `0x586B8032Db3b29287D205862C78dC14C69CFdC30` | `0x2de4f0618cadad9f2196686621df41e611de8758cd51e9828654fd3991df2afa` | 1,557 | `0xc3610e7dee46a9fd9a12a495c16f76fcf54c023110ed81abfd84cc0d0aa1a220` |
| ERC20TransferAmountEnforcer | `0xEEE6c38f9A2bDc58F1cC97Ee5f33746CA959912a` | `0xa40078339fbe7f33aa7e946bac23667ae43856a9ed5fadbdc7400a7a393d82c5` | 2,025 | `0xf8dfb11de07d9a9e48b4737fca579f67638c482c43c31c6f4daf084d6d727677` |
| HybridDeleGatorProxy | `0x7294e099207EB8139f25e7fcFFAba9287EcE4Dd2` | `0x9472556690d07786b34dbfa4d7a67093d149ba053ac7c28e493f615deea18ba0` | 116 | `0x8a909b59f80272a7f9361d39cc15f2e956f710e8b385bd8d2e7d604d1f04a4e6` |
| SpikeTestToken | `0xe8ab47FCAeDaa1d709C3591d3a58043545d2Ce71` | `0x2ee953f4a1dda332a6078de438934bb89ba5676ce094f7147f8114e04ea2e618` | 1,771 | `0xdcb0a4f389e153b89e1524ca0ce3b9c50a11ce082be9f8567f7808964329f95d` |
| SenderCreator | `0xd168c796E6Db529A15869341e3b4461a22C59Eee` | EntryPoint constructor (CREATE, nonce 1) | 445 | `0xf7ef70c5f65dd3a86b30faa8382f6ef083533f3aee47ee62e4bbe7993dfeece4` |

Account and delegation:

| Item | Value |
|---|---|
| DelegationManager owner | `0xbDc9EdC82A9958A1B49011C5f803f2E9188AdB12` (supervisor: yes), paused false, VERSION 1.3.0 |
| DelegationManager EIP-712 domain | chainId 20200 (domain hash computed with chain id 20200); domain hash `0x44a2100550c7f72e9f017cb3238f7710ad7710cf969b9731cc03a4d11c471909` |
| HybridDeleGator account (ERC1967 proxy) | `0x7294e099207EB8139f25e7fcFFAba9287EcE4Dd2` -> impl `0xE1498aDc6b3b40dfB8321e9C99A75153800c1525`; owner `0x0930e855a98BDD0d7335F8DE3A203F41B5A2ccfC` (director-1: yes); none (initialize called with empty key arrays) |
| Test token | `0xe8ab47FCAeDaa1d709C3591d3a58043545d2Ce71` YINGLONG Spike Test Unit (test unit, no value); account balance 1000000000000000000000000 |
| Delegation | delegator account -> delegate `0x27D51dF9306022DB196b473E6721DBDE80aBBF50` (agent-treasurer), root authority, salt 8802446868053909575 |
| Caveats | AllowedTargetsEnforcer (only the test token); AllowedMethodsEnforcer (only transfer(address,uint256)); ERC20TransferAmountEnforcer (cumulative cap 1000000000000000000000 base units) |
| Delegation hash (on-chain = off-chain) | `0xcc1a046373d877cff050b7059a55bad2d97b9c20f4a0a356a026c2abcf6ca164` (yes) |
| Typed-data hash signed by director-1 | `0x6f0cb5df8aa0d64f7b238eeaf2f6e4cb205028899828356b237cfcf7448fa71e`; isValidSignature returned `0x1626ba7e` |

Redemptions (agent-treasurer calls `DelegationManager.redeemDelegations`, recipient svc-shenzhen-components):

| Step | Tx | Status | Gas used | Recipient balance after | Spent (enforcer) |
|---|---|---|---|---|---|
| redeemDelegations 250 | `0x3c3c9324bc2bd4cf91040a887fc48a2df9845e79615aadb5b1dcbd4e2ca5ca72` | 0x1 | 275,285 | 250000000000000000000 | 250000000000000000000 |
| redeemDelegations 800 (over cap) | `0xb0f2d5ca9f5dfa431a75440eaab5150ce39d18feddaf59b4420ec82633b0502b` | 0x0 | 140,245 | 250000000000000000000 | 250000000000000000000 |
| redeemDelegations 750 (boundary) | `0xa98f2d40c33500ce084c706b74a61b5defa8d554162e7dec15ac271230fc1e10` | 0x1 | 275,285 | 1000000000000000000000 | 1000000000000000000000 |

Over-cap attempt: eth_estimateGas returned error code 16 with revert `ERC20TransferAmountEnforcer:allowance-exceeded`; the transaction was then forced on-chain with a fixed gas limit and mined with status 0x0; eth_call replay at the parent block decoded `ERC20TransferAmountEnforcer:allowance-exceeded` (FISCO ignores the block tag, so this replay ran against the latest state, which the revert left unchanged: yes).

### Runtime code hash: FISCO vs local anvil (london)

Same forge artifacts (solc 0.8.23, london, 200 runs, no metadata hash) deployed by the same deployer key from nonce 0 on each chain. EXTCODEHASH read on-chain with the opcode; masked hash zeroes every immutable slot listed in the artifact's immutableReferences.

| Contract | vs anvil chain 31337 | vs anvil chain 20200 | Explanation (chain 31337) |
|---|---|---|---|
| EntryPoint | equal | equal | identical runtime bytecode |
| SCL_RIP7212 | equal | equal | identical runtime bytecode |
| DelegationManager | differs | equal | identical except immutables set in the constructor: EIP712._cachedDomainSeparator, EIP712._cachedChainId (chain id: FISCO 20200, anvil 31337) |
| HybridDeleGatorImpl | differs | equal | identical except immutables set in the constructor: EIP712._cachedDomainSeparator, EIP712._cachedChainId (chain id: FISCO 20200, anvil 31337) |
| MultiSigDeleGatorImpl | differs | equal | identical except immutables set in the constructor: EIP712._cachedDomainSeparator, EIP712._cachedChainId (chain id: FISCO 20200, anvil 31337) |
| AllowedTargetsEnforcer | equal | equal | identical runtime bytecode |
| AllowedMethodsEnforcer | equal | equal | identical runtime bytecode |
| ValueLteEnforcer | equal | equal | identical runtime bytecode |
| TimestampEnforcer | equal | equal | identical runtime bytecode |
| LimitedCallsEnforcer | equal | equal | identical runtime bytecode |
| NonceEnforcer | equal | equal | identical runtime bytecode |
| RedeemerEnforcer | equal | equal | identical runtime bytecode |
| ERC20TransferAmountEnforcer | equal | equal | identical runtime bytecode |
| HybridDeleGatorProxy | equal | equal | identical runtime bytecode |
| SpikeTestToken | equal | equal | identical runtime bytecode |
| SenderCreator | equal | equal | identical runtime bytecode |

- anvil chain 31337: same addresses yes; identical runtime 13; differ only in immutables 3 (DelegationManager, HybridDeleGatorImpl, MultiSigDeleGatorImpl); differ otherwise 0.
- anvil chain 20200: same addresses yes; identical runtime 16; differ only in immutables 0; differ otherwise 0.
<!-- generated:results:end -->

## Limitations and consequences for YINGLONG

These follow from the generated results above.

1. **Chain ID is not 0.** On 3.17.1 the CHAINID opcode returns the genesis `[web3] chain_id` (the
   `build_chain.sh` default), equal to `eth_chainId`, and the DelegationManager's EIP-712 domain uses it.
   The FISCO ledger profile and KR-16 in the master plan (chain ID 0) should be updated. The default value is
   shared by every FISCO chain built with defaults; a chain-specific id would need a new genesis (or a
   `web3_chain_id` system-config change, after which OpenZeppelin's EIP712 recomputes the domain and old
   signatures stop verifying). Not changed here.
2. **Governance is open on this chain.** `is_auth_check=false`: any account that can reach the RPC can call
   the system precompiles (system config, consensus membership). Today the RPC is loopback-only and reachable
   only through SSH. Before any public RPC: rebuild with auth mode (`build_chain.sh -A`) or put a proxy in
   front that drops transactions to the `0x...1000`-`0x...10004` system precompiles.
3. **No RIP-7212 precompile.** Address `0x100` is empty on FISCO; the framework's P256 verifier falls back to
   the SCL Solidity verifier (works, costs more gas; gas is free here). Passkey accounts therefore work.
4. **Simulation gaps.** `eth_call` ignores both state overrides (silently) and the block tag (always latest
   state). "Replay at the parent block" on FISCO is a replay against the latest state: run it immediately
   after the failure, or simulate on anvil. No `debug_trace*`, `eth_simulateV1`, `eth_feeHistory`,
   `eth_getProof`, `eth_createAccessList`, `eth_getBlockReceipts`.
5. **eth_getLogs quirks.** The indexer must always send `address` (may be `[]`), `topics` (may be `[]`),
   `fromBlock` and `toBlock`, and lowercase hex topics; `blockHash` filters are rejected.
6. **EVM differences.** EXTCODEHASH of an EOA is zero (Ethereum: keccak256 of empty); no EIP-170 runtime size
   limit (only the EIP-3860 initcode limit at the RPC); the transaction gas field is not capped at
   `tx_gas_limit`; gas metering differs from Ethereum, so FISCO gas numbers are not comparable; native value
   transfers revert (`feature_balance` off), so value-based enforcers only make sense with value 0.
7. **Cancun at runtime.** Executor v1 always runs the Cancun revision (PUSH0, MCOPY, TSTORE work), whatever
   `feature_evm_cancun` says; `london` stays the common compilation target because of the other ledgers.
8. **Reverted transactions** are mined with status 0 and no revert data in the receipt; eth_call or
   eth_estimateGas return the reason in `error.data` with error code 16 and an empty message (viem reads
   `error.data`).
9. **Single host.** All five nodes share one VM, one disk and one CA; a reboot test is still pending; WeBASE-Front
   was not installed (optional item, skipped to keep the VM lean).
