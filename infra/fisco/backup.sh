#!/usr/bin/env bash
# Back up the YINGLONG FISCO BCOS chain without stopping consensus.
#
# node0 is stopped for the few seconds it takes to archive its RocksDB data directory (the other three
# sealers keep the PBFT quorum of 3 of 4, so the chain keeps producing blocks), then restarted; it
# catches up by block sync. The archive also holds every node's config, genesis, certificates and
# node keys, the chain CA and the SDK certificates, so it is SENSITIVE: it is written with mode 600
# under /opt/yinglong/fisco/backups and must never be copied into the repository.
#
# Usage (on the server):  bash backup.sh            keeps the newest 7 archives
# Restore (outline): stop yinglong-fisco.target, untar into /opt/yinglong/fisco, copy node0/data to
# every node directory that lost its data (or let empty nodes sync), start yinglong-fisco.target.
set -euo pipefail

BASE="${FISCO_BASE:-/opt/yinglong/fisco}"
NODE_ROOT="${BASE}/nodes/127.0.0.1"
DEST="${BASE}/backups"
KEEP="${KEEP:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${DEST}/fisco-chain-${STAMP}.tar.gz"

mkdir -p "${DEST}"
chmod 700 "${DEST}"
height_before=$(curl -s -m 5 -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' http://127.0.0.1:8546 | jq -r .result)

echo "[backup] stopping node0 (chain height $((height_before)))"
sudo systemctl stop yinglong-fisco-node0.service
trap 'sudo systemctl start yinglong-fisco-node0.service' EXIT

umask 077
set +e
tar -C "${BASE}" -czf "${ARCHIVE}" \
  --exclude='nodes/127.0.0.1/node1/data' --exclude='nodes/127.0.0.1/node2/data' \
  --exclude='nodes/127.0.0.1/node3/data' --exclude='nodes/127.0.0.1/node4/data' \
  --exclude='*/nohup.out' --exclude='*/log' \
  nodes build-chain.sh install-systemd.sh status.sh add-observer.sh backup.sh
rc=$?
set -e
sudo systemctl start yinglong-fisco-node0.service
trap - EXIT
# tar exit 1 means "some file changed while being read" (only files of running nodes); 2 is fatal.
if [[ "${rc}" -gt 1 ]]; then
  echo "[backup] tar failed with exit code ${rc}" >&2
  rm -f "${ARCHIVE}"
  exit 1
fi
sha256sum "${ARCHIVE}" >"${ARCHIVE}.sha256"
chmod 600 "${ARCHIVE}" "${ARCHIVE}.sha256"
echo "[backup] wrote ${ARCHIVE} ($(du -h "${ARCHIVE}" | cut -f1))"

# Retention.
ls -1t "${DEST}"/fisco-chain-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "${old}" "${old}.sha256"
done

sleep 5
height_after=$(curl -s -m 5 -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' http://127.0.0.1:8545 | jq -r .result)
echo "[backup] node0 back up at height $((height_after))"
