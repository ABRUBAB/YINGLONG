#!/usr/bin/env node
// Take Base Sepolia live in one command once the deployer holds testnet ETH:
//   1. check the deployer balance (public address, no key needed for this),
//   2. deploy every YINGLONG contract against the canonical MetaMask Delegation Framework (scripts/deploy.mjs),
//   3. deploy the ZK private-mandate stack (apps/agent/scripts/deploy-zk.ts),
//   4. run the scripted student scenario end to end with real transactions (apps/agent/scripts/e2e.ts),
//   5. run the private-mandate beat (apps/agent/scripts/zk-private-mandate.ts),
//   6. print the bytecode comparison against FISCO BCOS.
// Usage: node scripts/base-go-live.mjs [--min-eth 0.004] [--skip-deploy]
// Everything moves test units only. Keys are read at runtime by the scripts it calls; nothing is printed.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const minEth = Number(args.includes("--min-eth") ? args[args.indexOf("--min-eth") + 1] : "0.004");
const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const DEPLOYER = "0x5C470480380dC2014898345aC6226c67cbF5E407";

function step(title, cmd, argv, cwd = root) {
  console.log(`\n== ${title}`);
  const r = spawnSync(cmd, argv, { cwd, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, BASE_SEPOLIA_RPC_URL: RPC } });
  if (r.status !== 0) {
    console.error(`step failed: ${title} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [DEPLOYER, "latest"] }) });
const wei = BigInt((await res.json()).result);
const eth = Number(wei) / 1e18;
console.log(`deployer ${DEPLOYER} holds ${eth.toFixed(6)} Base Sepolia ETH (testnet)`);
if (eth < minEth) {
  console.error(`need at least ${minEth} ETH on Base Sepolia for the deployer; nothing was sent`);
  process.exit(2);
}

if (!args.includes("--skip-deploy")) step("deploy contracts (canonical framework)", "node", ["scripts/deploy.mjs", "base-sepolia"]);
step("deploy the ZK private-mandate stack", "npx", ["tsx", "apps/agent/scripts/deploy-zk.ts", "base-sepolia"]);
step("scripted student scenario, real transactions", "npx", ["tsx", "apps/agent/scripts/e2e.ts", "base-sepolia"]);
step("private mandate verified by proofs at redemption", "npx", ["tsx", "scripts/zk-private-mandate.ts", "base-sepolia"], resolve(root, "apps/agent"));

const load = (l) => JSON.parse(readFileSync(resolve(root, "contracts/deployments", `${l}.json`), "utf8"));
if (existsSync(resolve(root, "contracts/deployments/base-sepolia.json"))) {
  const base = load("base-sepolia");
  const fisco = load("fisco");
  const hashes = (d) => Object.fromEntries(Object.entries({ ...(d.contracts ?? {}), ...(d.optional ?? {}) }).filter(([, v]) => v && typeof v === "object").map(([k, v]) => [k, v.codeHash]));
  const b = hashes(base);
  const f = hashes(fisco);
  const common = Object.keys(b).filter((k) => f[k]);
  const same = common.filter((k) => b[k] === f[k]);
  console.log(`\nbytecode: ${same.length} of ${common.length} contracts identical on Base Sepolia and FISCO BCOS; different: ${common.filter((k) => b[k] !== f[k]).join(", ") || "none"}`);
}
console.log("\nNext: commit contracts/deployments/base-sepolia.json and apps/agent/data/*base-sepolia*.json, set ANCHOR_LEDGERS=fisco,base-sepolia in infra/app/compose.yaml, redeploy the VPS, then run finalize.");
