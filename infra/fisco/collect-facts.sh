#!/usr/bin/env bash
# Print, as JSON, the facts about the running chain that infra/fisco/README.md reports: binary and
# script hashes, genesis, consensus membership, system config, the addObserver transaction,
# listening sockets and systemd state. Contains no secrets (node IDs are public identifiers).
#
# Usage (on the server):  bash collect-facts.sh > chain-facts.json
# The copy in the repository is infra/fisco/chain-facts.json (fetched with scp, never hand-edited).
set -euo pipefail

BASE="${FISCO_BASE:-/opt/yinglong/fisco}"
NODE_ROOT="${BASE}/nodes/127.0.0.1"
SDK="${NODE_ROOT}/sdk"
RPC=http://127.0.0.1:8545

rpc() {
  curl -s -m 5 -H 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" "${RPC}" | jq -c '.result'
}
native() {
  curl -s -m 5 -k --cert "${SDK}/sdk.crt" --key "${SDK}/sdk.key" -H 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":[\"group0\",\"\"]}" https://127.0.0.1:20200 | jq -c '.result'
}
sysconfig() {
  cast call --rpc-url "${RPC}" 0x0000000000000000000000000000000000001000 'getValueByKey(string)(string,int256)' "$1" 2>/dev/null |
    jq -R -s -c 'split("\n") | map(select(length > 0)) | {value: (.[0] | fromjson? // .), enableBlock: (.[1] | tonumber? // .)}'
}

version_line() { "${NODE_ROOT}/fisco-bcos" -v | grep "$1" | sed 's/.*: //'; }

nodes='[]'
for i in 0 1 2 3 4; do
  dir="${NODE_ROOT}/node${i}"
  ini="${dir}/config.ini"
  get() { awk -v s="[$1]" -v k="$2" '/^\[/{sec=$0} sec==s && $1 ~ "^"k"=" {sub(/^[^=]*=/, "", $1); print $1; exit}' "${ini}"; }
  role=consensus
  [[ "${i}" == "4" ]] && role="observer (regulator)"
  nodes=$(jq -c --arg n "node${i}" --arg role "${role}" --arg id "$(cat "${dir}/conf/node.nodeid")" \
    --arg p2p "$(get p2p listen_ip):$(get p2p listen_port)" --arg rpc "$(get rpc listen_ip):$(get rpc listen_port)" \
    --arg web3 "$(get web3_rpc listen_ip):$(get web3_rpc listen_port)" --arg web3on "$(get web3_rpc enable)" \
    --arg unit "yinglong-fisco-node${i}.service" --arg active "$(systemctl is-active "yinglong-fisco-node${i}.service")" \
    --arg enabled "$(systemctl is-enabled "yinglong-fisco-node${i}.service")" \
    --arg restart "$(systemctl show "yinglong-fisco-node${i}.service" -p Restart --value)" \
    '. + [{node: $n, role: $role, nodeId: $id, p2p: $p2p, nativeRpc: $rpc, web3Rpc: $web3, web3Enabled: ($web3on == "true"),
           systemdUnit: $unit, active: $active, enabled: $enabled, restartPolicy: $restart}]' <<<"${nodes}")
done

block1=$(rpc eth_getBlockByNumber '["0x1", false]')
observer_tx=$(jq -r '.transactions[0]' <<<"${block1}")
observer_receipt=$(rpc eth_getTransactionReceipt "[\"${observer_tx}\"]")

features=$(awk '/^\[features\]/{f=1; next} /^\[/{f=0} f && $1 ~ /=/ {print $1}' "${NODE_ROOT}/node0/config.genesis" |
  jq -R -s -c 'split("\n") | map(select(length > 0) | split("=") | {(.[0]): .[1]}) | add')

listeners=$(ss -ltnpH 2>/dev/null | awk '/fisco-bcos/ {print $4}' | sort -u | jq -R -s -c 'split("\n") | map(select(length > 0))')
public_listeners=$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -v -E '^(127\.|\[::1\]|127\.0\.0\.5)' | sort -u | jq -R -s -c 'split("\n") | map(select(length > 0))')

jq -n \
  --arg collectedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg version "$(version_line 'FISCO BCOS Version')" \
  --arg commit "$(version_line 'Git Commit')" \
  --arg buildType "$(version_line 'Build Type')" \
  --arg shaBuildChain "$(sha256sum "${BASE}/dist/build_chain.sh" | cut -d' ' -f1)" \
  --arg shaTgz "$(sha256sum "${BASE}/dist/fisco-bcos-linux-x86_64.tar.gz" | cut -d' ' -f1)" \
  --arg shaBinary "$(sha256sum "${NODE_ROOT}/fisco-bcos" | cut -d' ' -f1)" \
  --arg shaGenesis "$(sha256sum "${NODE_ROOT}/node0/config.genesis" | cut -d' ' -f1)" \
  --arg genesisSame "$(sha256sum "${NODE_ROOT}"/node*/config.genesis | cut -d' ' -f1 | sort -u | wc -l)" \
  --arg smCrypto "$(awk -F= '/sm_crypto=/{print $2}' "${NODE_ROOT}/node0/config.genesis")" \
  --arg authCheck "$(awk -F= '/is_auth_check=/{print $2}' "${NODE_ROOT}/node0/config.genesis")" \
  --arg executorVersion "$(awk -F= '/^ *version=/{print $2}' "${NODE_ROOT}/node0/config.genesis")" \
  --arg chainId "$(awk -F= '/^ *chain_id=/{print $2; exit}' "${NODE_ROOT}/node0/config.genesis")" \
  --arg groupId "$(awk -F= '/group_id=/{print $2}' "${NODE_ROOT}/node0/config.genesis")" \
  --arg minSeal "$(awk -F= '/min_seal_time=/{print $2}' "${NODE_ROOT}/node0/config.ini")" \
  --argjson features "${features}" \
  --argjson nodes "${nodes}" \
  --argjson sealers "$(native getSealerList)" \
  --argjson observers "$(native getObserverList)" \
  --argjson ethChainId "$(rpc eth_chainId '[]')" \
  --argjson height "$(rpc eth_blockNumber '[]')" \
  --argjson observerReceipt "${observer_receipt}" \
  --arg observerTx "${observer_tx}" \
  --argjson listeners "${listeners}" \
  --argjson publicListeners "${public_listeners}" \
  --argjson cv "$(sysconfig compatibility_version)" \
  --argjson gasLimit "$(sysconfig tx_gas_limit)" \
  --argjson gasPrice "$(sysconfig tx_gas_price)" \
  --argjson web3ChainId "$(sysconfig web3_chain_id)" \
  --argjson execVer "$(sysconfig executor_version)" \
  --argjson fTimestamp "$(sysconfig feature_evm_timestamp)" \
  --argjson fAddress "$(sysconfig feature_evm_address)" \
  --argjson fCancun "$(sysconfig feature_evm_cancun)" \
  --argjson fBalance "$(sysconfig feature_balance)" \
  '{
    schema: "yinglong.fisco-chain-facts/1",
    collectedAt: $collectedAt,
    binary: {version: $version, gitCommit: $commit, buildType: $buildType, sha256: $shaBinary,
             releaseTarballSha256: $shaTgz, buildChainShSha256: $shaBuildChain},
    genesis: {sha256: $shaGenesis, identicalOnAllNodes: ($genesisSame == "1"), smCrypto: $smCrypto, chainId: $chainId,
              groupId: $groupId, authCheck: $authCheck, executorVersion: $executorVersion, features: $features},
    consensus: {algorithm: "pbft", minSealTimeMs: $minSeal, sealers: [$sealers[].nodeID], observers: $observers,
                addObserverTx: {hash: $observerTx, blockNumber: $observerReceipt.blockNumber, status: $observerReceipt.status,
                                from: $observerReceipt.from, to: $observerReceipt.to}},
    systemConfig: {compatibility_version: $cv, tx_gas_limit: $gasLimit, tx_gas_price: $gasPrice, web3_chain_id: $web3ChainId,
                   executor_version: $execVer, feature_evm_timestamp: $fTimestamp, feature_evm_address: $fAddress,
                   feature_evm_cancun: $fCancun, feature_balance: $fBalance},
    web3: {ethChainId: $ethChainId, blockHeight: $height},
    nodes: $nodes,
    fiscoListeners: $listeners,
    nonLoopbackListenersOnHost: $publicListeners
  }'
