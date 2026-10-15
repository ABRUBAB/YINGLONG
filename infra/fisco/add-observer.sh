#!/usr/bin/env bash
# Turn node4 (the regulator node) into an observer of group0.
#
# The genesis lists only node0..node3 as sealers; node4 starts with the same genesis and is
# then registered through the ConsensusPrecompiled (0x...1003) addObserver(string) call, sent
# as an ordinary Web3 transaction (gas price 0). The chain runs with auth_check=false, so the
# chain admin account created by build_chain.sh (nodes/ca/accounts/0x<addr>.pem) signs it.
# The private key is read into a shell variable only; it is never printed.
#
# Usage (on the server):  bash add-observer.sh
set -euo pipefail

BASE="${FISCO_BASE:-/opt/yinglong/fisco}"
NODES="${BASE}/nodes"
RPC="http://127.0.0.1:8545"
CONSENSUS_PRECOMPILED=0x0000000000000000000000000000000000001003
OBSERVER_ID="$(cat "${NODES}/observer.nodeid")"
SDK="${NODES}/127.0.0.1/sdk"

native() {
  curl -s -m 5 -k --cert "${SDK}/sdk.crt" --key "${SDK}/sdk.key" -H 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":[\"group0\",\"\"]}" https://127.0.0.1:20200
}

if native getObserverList | jq -e --arg id "${OBSERVER_ID}" '.result | index($id)' >/dev/null; then
  echo "node4 is already an observer"
  exit 0
fi

admin_pem="$(ls "${NODES}"/ca/accounts/0x*.pem | grep -v -E 'public|\.pub$' | head -1)"
admin_key="0x$(openssl ec -in "${admin_pem}" -text -noout 2>/dev/null |
  sed -n '/priv:/,/pub:/p' | grep -v -E 'priv:|pub:' | tr -d ' :\n')"

tx="$(cast send --rpc-url "${RPC}" --private-key "${admin_key}" --legacy --gas-limit 3000000 \
  --json "${CONSENSUS_PRECOMPILED}" 'addObserver(string)' "${OBSERVER_ID}")"
unset admin_key
echo "${tx}" | jq '{transactionHash, blockNumber, status, from, to}' 2>/dev/null ||
  echo "${tx}" | jq '.data | {transactionHash, blockNumber, status, from, to}'

sleep 3
echo "sealers:   $(native getSealerList | jq -r '.result | length')"
echo "observers: $(native getObserverList | jq -c '.result')"
