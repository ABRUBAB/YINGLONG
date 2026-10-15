#!/usr/bin/env node
// Deploy YINGLONG to one ledger with Foundry, loading testnet keys from ../.secrets (never printed).
// Usage: node scripts/deploy.mjs <ledger> [--rpc <url>]
//   ledgers: anvil (local), fisco (via SSH tunnel on 127.0.0.1:8545 by default), base-sepolia
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const secretsFile = resolve(root, "..", ".secrets", "testnet-keys.json");
if (!existsSync(secretsFile)) {
  console.error(`missing ${secretsFile}`);
  process.exit(1);
}
const keys = JSON.parse(readFileSync(secretsFile, "utf8")).roles;
for (const r of Object.values(keys)) if (!r.privateKey.startsWith("0x")) r.privateKey = `0x${r.privateKey}`;

const ledger = process.argv[2];
const rpcIdx = process.argv.indexOf("--rpc");
const LEDGERS = {
  anvil: { rpc: "http://127.0.0.1:8545", mode: "deploy", extra: [] },
  fisco: { rpc: "http://127.0.0.1:8545", mode: "deploy", extra: ["--legacy", "--with-gas-price", "0", "--slow", "--skip-simulation"] },
  "base-sepolia": { rpc: "https://sepolia.base.org", mode: "existing", extra: ["--slow"] },
};
const cfg = LEDGERS[ledger];
if (!cfg) {
  console.error(`unknown ledger ${ledger}; one of ${Object.keys(LEDGERS).join(", ")}`);
  process.exit(1);
}
const rpc = rpcIdx > 0 ? process.argv[rpcIdx + 1] : cfg.rpc;

const env = {
  ...process.env,
  DEPLOYER_PRIVATE_KEY: keys.deployer.privateKey,
  LEDGER_NAME: ledger,
  FRAMEWORK_MODE: cfg.mode,
  SUPERVISOR: keys.supervisor.address,
  ANCHORER: keys["anchoring-relayer"].address,
  CPI_OPERATOR: keys.relayer.address,
  // Canonical MetaMask Delegation Framework v1.3.0 on Base Sepolia (verified 15 Oct 2026, see plan 9.2).
  ENTRYPOINT: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  DELEGATION_MANAGER: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
  HYBRID_IMPL: "0x48dBe696A4D990079e039489bA2053B36E8FFEC4",
  MULTISIG_IMPL: "0x56a9EdB16a0105eb5a4C54f4C062e2868844f3A7",
  SIMPLE_FACTORY: "0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c",
};

const forge = process.platform === "win32" ? "D:\\tools\\foundry\\forge.exe" : "forge";
const args = ["script", "script/DeployYinglong.s.sol:DeployYinglong", "--rpc-url", rpc, "--broadcast", ...cfg.extra];
const r = spawnSync(forge, args, { cwd: resolve(root, "contracts"), env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const redact = (s) => s.replaceAll(keys.deployer.privateKey, "<redacted>").replaceAll(keys.deployer.privateKey.replace(/^0x/, ""), "<redacted>");
process.stdout.write(redact(r.stdout ?? ""));
process.stderr.write(redact(r.stderr ?? ""));
process.exit(r.status ?? 1);
