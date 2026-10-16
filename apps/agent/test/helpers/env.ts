// Test environment: imported FIRST by every test file that loads the service modules. It points the service at
// a throwaway data directory and a throwaway role-key file (fresh random keys; never the testnet key file),
// disables model calls unless a test enables them with a mocked fetch, and sets an operator token.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROLES = [
  "deployer",
  "agent-ying",
  "agent-treasurer",
  "mirage",
  "guardian",
  "breaker-watcher",
  "relayer",
  "supervisor",
  "director-1",
  "director-2",
  "director-3",
  "issuer-hbu",
  "issuer-harbour-digital-bank",
  "svc-pearl-river-fx",
  "svc-kyb-verifier",
  "svc-harbour-homes",
  "svc-hbu-bursar",
  "svc-shenzhen-components",
  "svc-kowloon-forwarders",
  "anchoring-relayer",
  "agent-owner",
  "svc-victoria-fx",
  "svc-scholarship-foundation",
  "facilitator",
  "guest-arena",
];

export const dir = mkdtempSync(join(tmpdir(), "yl-agent-test-"));
export const roles: Record<string, { address: Address; privateKey: Hex }> = {};
for (const r of ROLES) {
  const pk = generatePrivateKey();
  roles[r] = { address: privateKeyToAccount(pk).address, privateKey: pk };
}
writeFileSync(join(dir, "keys.json"), JSON.stringify({ roles }));

process.env.YINGLONG_SECRETS = join(dir, "keys.json");
process.env.AGENT_DATA_DIR = join(dir, "data");
process.env.AGENT_ADMIN_TOKEN = "test-operator-token";
process.env.NADIA_LEDGER = "anvil";
process.env.LOTUS_SZ_LEDGER = "anvil";
process.env.LOTUS_HK_LEDGER = "anvil";
process.env.DEMO_PERIOD_SECONDS = "86400";
process.env.LLM_DISABLED = process.env.LLM_DISABLED ?? "1";
process.env.DASHSCOPE_DISABLED = "1";
delete process.env.OPENROUTER_API_KEY;
process.env.OPENROUTER_KEY_FILE = join(dir, "no-openrouter-key.txt");
process.env.INDEXER_URL = "http://127.0.0.1:9";
process.env.ANVIL_RPC_URL = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8645";
process.env.FISCO_RPC_URL = "http://127.0.0.1:9";
