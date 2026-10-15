#!/usr/bin/env bash
# Status of the YINGLONG FISCO BCOS chain: systemd state, listening sockets, block height per
# node over the Web3 RPC, sealer/observer lists (native RPC) and system config incl. features.
# Usage (on the server):  bash status.sh        (exit code 0 only if all five nodes answer)
set -uo pipefail

BASE="${FISCO_BASE:-/opt/yinglong/fisco}"
SDK="${BASE}/nodes/127.0.0.1/sdk"
NODE_COUNT=5
WEB3_START=8545
ok=0

rpc() {
  curl -s -m 5 -H 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":$3}" "http://127.0.0.1:$1"
}
# Native RPC (TLS with the SDK certificate; the node certificate CN is not a host name, hence -k on loopback).
native() {
  curl -s -m 5 -k --cert "${SDK}/sdk.crt" --key "${SDK}/sdk.key" -H 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":[\"group0\",\"\"]}" https://127.0.0.1:20200
}

echo "== systemd"
for ((i = 0; i < NODE_COUNT; i++)); do
  printf 'node%d  %-8s restarts=%s\n' "${i}" "$(systemctl is-active "yinglong-fisco-node${i}.service" 2>/dev/null)" \
    "$(systemctl show "yinglong-fisco-node${i}.service" -p NRestarts --value 2>/dev/null)"
done

echo "== fisco-bcos listeners (all must be 127.0.0.1)"
ss -ltnpH 2>/dev/null | awk '/fisco-bcos/ { print "  " $4 }' | sort -t: -k2 -n
if ss -ltnpH 2>/dev/null | awk '/fisco-bcos/ { print $4 }' | grep -v '^127\.0\.0\.1:' >/dev/null; then
  echo "  WARNING: a fisco-bcos socket is not bound to 127.0.0.1"
fi

echo "== block height and peers per node (Web3 RPC)"
for ((i = 0; i < NODE_COUNT; i++)); do
  port=$((WEB3_START + i))
  height=$(rpc "${port}" eth_blockNumber '[]' | jq -r '.result // "down"' 2>/dev/null)
  peers=$(rpc "${port}" net_peerCount '[]' | jq -r '.result // "?"' 2>/dev/null)
  if [[ "${height}" == 0x* ]]; then
    ok=$((ok + 1))
    printf 'node%d  web3 127.0.0.1:%d  block %d  peers %s\n' "${i}" "${port}" "$((height))" "${peers}"
  else
    printf 'node%d  web3 127.0.0.1:%d  DOWN\n' "${i}" "${port}"
  fi
done

echo "== consensus (native RPC)"
echo "  sealers:   $(native getSealerList | jq -r '[.result[].nodeID[0:16]] | join(", ")' 2>/dev/null)"
echo "  observers: $(native getObserverList | jq -r '[.result[][0:16]] | join(", ")' 2>/dev/null)"
for ((i = 0; i < NODE_COUNT; i++)); do
  printf '  node%d id %s\n' "${i}" "$(cut -c1-16 "${BASE}/nodes/127.0.0.1/node${i}/conf/node.nodeid")"
done

echo "== chain id (eth_chainId)"
echo "  $(rpc "${WEB3_START}" eth_chainId '[]' | jq -r '.result')"

# SystemConfigPrecompiled (0x...1000).getValueByKey(string) via eth_call; needs cast (Foundry).
if command -v cast >/dev/null 2>&1; then
  echo "== system config (value, enable block; empty value and -1 = never set = off)"
  for key in compatibility_version tx_gas_limit tx_gas_price web3_chain_id executor_version \
    feature_evm_timestamp feature_evm_address feature_evm_cancun feature_balance; do
    raw=$(cast call --rpc-url "http://127.0.0.1:${WEB3_START}" 0x0000000000000000000000000000000000001000 \
      'getValueByKey(string)(string,int256)' "${key}" 2>/dev/null | tr '\n' ' ')
    printf '  %-24s %s\n' "${key}" "${raw:-<unset>}"
  done
fi

echo "== memory"
free -h | awk 'NR <= 2 { print "  " $0 }'
echo "== summary: ${ok}/${NODE_COUNT} nodes answering"
[[ "${ok}" == "${NODE_COUNT}" ]]
