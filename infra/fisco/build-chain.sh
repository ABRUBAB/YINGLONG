#!/usr/bin/env bash
# Build the YINGLONG consortium ledger: FISCO BCOS 3.17.1 (standard, non-SM build),
# one group (group0), 4 consensus nodes (node0..node3) and 1 observer node (node4, the
# "regulator node"), all on one host and all bound to 127.0.0.1.
#
# What this script does, in order:
#   1. downloads the official build_chain.sh and the Linux x86_64 fisco-bcos binary from the
#      v3.17.1 GitHub release and checks their SHA-256;
#   2. runs build_chain.sh for 5 nodes (non-SM: no -s flag);
#   3. removes node4 from the genesis sealer list (it joins later as an observer through the
#      ConsensusPrecompiled addObserver transaction, see add-observer.sh);
#   4. adds a [features] section to the genesis (feature_evm_timestamp, feature_evm_address,
#      feature_evm_cancun; feature_balance stays off);
#   5. rewrites every config.ini so that P2P, native RPC and Web3 RPC listen on 127.0.0.1 only,
#      enables the Web3 JSON-RPC and gives each node its own Web3 port (8545..8549).
#
# Usage (on the server, as azureuser):  bash build-chain.sh
# Refuses to run if the nodes directory already exists (never overwrites a live chain).
set -euo pipefail

FISCO_VERSION="v3.17.1"
BASE="${FISCO_BASE:-/opt/yinglong/fisco}"
DIST="${BASE}/dist"
NODES="${BASE}/nodes"
NODE_COUNT=5
OBSERVER_INDEX=4
P2P_START=30300
RPC_START=20200
WEB3_START=8545
RELEASE_URL="https://github.com/FISCO-BCOS/FISCO-BCOS/releases/download/${FISCO_VERSION}"
# SHA-256 of the release assets as downloaded on 2026-10-15 (UTC).
SHA_BUILD_CHAIN="ed667e1e346acbe2fea7b667856ddf05af9e4892ac0424ff9f703f0ea601dbe7"
SHA_BINARY_TGZ="28eb054bb222b805e116bf7d2462709f99d1f460a732e978555abe61973b3cbb"

log() { printf '[build-chain] %s\n' "$*"; }

if [[ -e "${NODES}" ]]; then
  log "refusing to run: ${NODES} already exists (stop the chain and move it away first)"
  exit 1
fi

mkdir -p "${DIST}/bin"
cd "${DIST}"
[[ -f build_chain.sh ]] || curl -sSLO "${RELEASE_URL}/build_chain.sh"
[[ -f fisco-bcos-linux-x86_64.tar.gz ]] || curl -sSLO "${RELEASE_URL}/fisco-bcos-linux-x86_64.tar.gz"
echo "${SHA_BUILD_CHAIN}  build_chain.sh" | sha256sum -c -
echo "${SHA_BINARY_TGZ}  fisco-bcos-linux-x86_64.tar.gz" | sha256sum -c -
tar -xzf fisco-bcos-linux-x86_64.tar.gz -C bin
"${DIST}/bin/fisco-bcos" -v

log "running build_chain.sh (non-SM, ${NODE_COUNT} nodes)"
bash build_chain.sh -l "127.0.0.1:${NODE_COUNT}" -p "${P2P_START},${RPC_START}" -o "${NODES}" -e "${DIST}/bin/fisco-bcos"

NODE_ROOT="${NODES}/127.0.0.1"
OBSERVER_ID="$(cat "${NODE_ROOT}/node${OBSERVER_INDEX}/conf/node.nodeid")"
printf '%s\n' "${OBSERVER_ID}" >"${NODES}/observer.nodeid"

for ((i = 0; i < NODE_COUNT; i++)); do
  dir="${NODE_ROOT}/node${i}"
  genesis="${dir}/config.genesis"
  ini="${dir}/config.ini"

  # 1. genesis: drop the observer from the sealer list, then add the feature section.
  grep -v "${OBSERVER_ID}" "${genesis}" >"${genesis}.tmp"
  mv "${genesis}.tmp" "${genesis}"
  cat >>"${genesis}" <<'EOF'

[features]
    ; EVM TIMESTAMP opcode returns seconds instead of milliseconds
    feature_evm_timestamp=1
    ; EVM-style CREATE/CREATE2 addresses in the legacy executor (executor v1 already uses them)
    feature_evm_address=1
    ; Cancun VM schedule in the legacy executor (executor v1 always runs the Cancun revision)
    feature_evm_cancun=1
EOF

  # 2. config.ini: every listener on 127.0.0.1, Web3 RPC on, one Web3 port per node.
  awk -v web3port="$((WEB3_START + i))" '
    /^\[/ { section = $0 }
    section == "[p2p]" && $1 ~ /^listen_ip=/ { print "    listen_ip=127.0.0.1"; next }
    section == "[rpc]" && $1 ~ /^listen_ip=/ { print "    listen_ip=127.0.0.1"; next }
    section == "[web3_rpc]" && $1 ~ /^enable=/ { print "    enable=true"; next }
    section == "[web3_rpc]" && $1 ~ /^listen_ip=/ { print "    listen_ip=127.0.0.1"; next }
    section == "[web3_rpc]" && $1 ~ /^listen_port=/ { print "    listen_port=" web3port; next }
    { print }
  ' "${ini}" >"${ini}.tmp"
  mv "${ini}.tmp" "${ini}"
done

# The genesis must be byte-identical on every node.
sha256sum "${NODE_ROOT}"/node*/config.genesis
if [[ "$(sha256sum "${NODE_ROOT}"/node*/config.genesis | awk '{print $1}' | sort -u | wc -l)" != "1" ]]; then
  log "genesis files differ between nodes"
  exit 1
fi

chmod 700 "${NODES}/ca" 2>/dev/null || true
chmod 600 "${NODE_ROOT}"/node*/conf/*.key "${NODE_ROOT}"/node*/conf/node.pem 2>/dev/null || true
log "done. observer node id saved to ${NODES}/observer.nodeid"
log "next: sudo bash install-systemd.sh, then bash add-observer.sh"
