#!/usr/bin/env bash
# Install one systemd unit per FISCO BCOS node (yinglong-fisco-node0..4.service) plus a target
# (yinglong-fisco.target) that starts all five. Units restart on failure and on any exit
# (Restart=always) and are enabled so the chain comes back after a reboot.
#
# Usage (on the server):  sudo bash install-systemd.sh
set -euo pipefail

BASE="${FISCO_BASE:-/opt/yinglong/fisco}"
NODE_ROOT="${BASE}/nodes/127.0.0.1"
RUN_USER="${FISCO_USER:-azureuser}"
NODE_COUNT=5
UNIT_DIR=/etc/systemd/system

if [[ "$(id -u)" != "0" ]]; then
  echo "run with sudo" >&2
  exit 1
fi

cat >"${UNIT_DIR}/yinglong-fisco.target" <<EOF
[Unit]
Description=YINGLONG FISCO BCOS 3.17.1 chain (group0: 4 consensus nodes + 1 observer)
Wants=$(for ((i = 0; i < NODE_COUNT; i++)); do printf 'yinglong-fisco-node%d.service ' "${i}"; done)
After=network-online.target

[Install]
WantedBy=multi-user.target
EOF

for ((i = 0; i < NODE_COUNT; i++)); do
  role="consensus"
  [[ "${i}" == "4" ]] && role="observer (regulator)"
  cat >"${UNIT_DIR}/yinglong-fisco-node${i}.service" <<EOF
[Unit]
Description=YINGLONG FISCO BCOS node${i} (${role})
After=network-online.target
Wants=network-online.target
PartOf=yinglong-fisco.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${NODE_ROOT}/node${i}
ExecStart=${NODE_ROOT}/fisco-bcos -c config.ini -g config.genesis
Restart=always
RestartSec=5
TimeoutStopSec=60
KillSignal=SIGTERM
LimitNOFILE=65535
LimitCORE=0
StandardOutput=append:${NODE_ROOT}/node${i}/nohup.out
StandardError=append:${NODE_ROOT}/node${i}/nohup.out

[Install]
WantedBy=yinglong-fisco.target
EOF
done

systemctl daemon-reload
systemctl enable yinglong-fisco.target
for ((i = 0; i < NODE_COUNT; i++)); do
  systemctl enable "yinglong-fisco-node${i}.service"
done
systemctl start yinglong-fisco.target
sleep 5
systemctl --no-pager --lines=0 status 'yinglong-fisco-node*' | grep -E 'yinglong-fisco-node|Active:'
