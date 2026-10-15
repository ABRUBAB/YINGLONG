#!/usr/bin/env bash
# Rebuild the mandate compliance circuit, its verification key and its Solidity verifier.
# Linux or macOS only (nargo and bb have no Windows builds). Run from the circuits/ directory:
#
#   bash scripts/build-circuit.sh
#
# Then, on any OS with Foundry and Node:
#   (cd verifier && forge build --sizes)          # solc 0.8.27, london
#   node scripts/export-verifier.mjs              # bytecode artifact + vk (hex) into contracts/
#   pnpm fixtures                                 # real proofs for contracts/test/zk
#   node scripts/manifest.mjs                     # hashes, sizes, gas into MANIFEST.json
set -euo pipefail

NARGO_VERSION="1.0.0-rc.5"
BB_VERSION="5.2.1"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

got_nargo="$(nargo --version | sed -n 's/^nargo version = //p')"
got_bb="$(bb --version)"
if [ "$got_nargo" != "$NARGO_VERSION" ] || [ "$got_bb" != "$BB_VERSION" ]; then
  echo "toolchain mismatch: nargo $got_nargo (want $NARGO_VERSION), bb $got_bb (want $BB_VERSION)" >&2
  echo "install with: noirup -v $NARGO_VERSION && bbup -v $BB_VERSION" >&2
  exit 1
fi

# nargo skips writing the artifact when the program hash is unchanged, which would keep stale
# file_map sources; remove it so the artifact always reflects the current sources.
rm -f mandate_compliance/target/mandate_compliance.json
(cd mandate_compliance && nargo test && nargo compile)

mkdir -p build/mandate_compliance verifier/src/mandate_compliance
# --oracle_hash keccak with the default (zero-knowledge) UltraHonk flavour; identical to `-t evm`.
bb write_vk --scheme ultra_honk --oracle_hash keccak \
  -b mandate_compliance/target/mandate_compliance.json -o build/mandate_compliance
bb write_solidity_verifier --scheme ultra_honk \
  -k build/mandate_compliance/vk -o verifier/src/mandate_compliance/HonkVerifier.sol
bb gates -b mandate_compliance/target/mandate_compliance.json > mandate_compliance/target/gates.json

sha256sum mandate_compliance/src/main.nr mandate_compliance/Nargo.toml \
  mandate_compliance/target/mandate_compliance.json build/mandate_compliance/vk \
  build/mandate_compliance/vk_hash verifier/src/mandate_compliance/HonkVerifier.sol
cat mandate_compliance/target/gates.json
