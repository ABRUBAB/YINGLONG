import { resolve } from "node:path";
import type { LedgerName } from "@yinglong/sdk";

export interface IndexerConfig {
  /** Ledgers whose AccountabilityLedger receives anchors and cross-anchors. */
  anchorLedgers: LedgerName[];
  /** Ledgers whose KillSwitchRegistry the breaker watcher can trip. */
  breakerLedgers: LedgerName[];
  rpcUrls: Partial<Record<LedgerName, string>>;
  port: number;
  host: string;
  dataDir: string;
  /** Agent receipts API base, or undefined to read from a file. */
  agentApiUrl?: string;
  receiptsFile?: string;
  principal?: string;
  batchMaxReceipts: number;
  batchMaxAgeMs: number;
  pollIntervalMs: number;
  autoStart: boolean;
  adminToken?: string;
  /** FISCO read-only proxy. */
  fiscoRpcUrl?: string;
  proxyRateLimitPerMin: number;
  proxyMaxBlockRange: number;
}

const appRoot = resolve(import.meta.dirname, "..");

function int(v: string | undefined, d: number): number {
  if (!v) return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`expected a non-negative number, got ${v}`);
  return n;
}
function list(v: string | undefined, d: LedgerName[]): LedgerName[] {
  if (!v) return d;
  return v.split(",").map((s) => s.trim()).filter(Boolean) as LedgerName[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const anchorLedgers = list(env.ANCHOR_LEDGERS, ["anvil"]);
  const rpcUrls: Partial<Record<LedgerName, string>> = {};
  if (env.ANVIL_RPC_URL) rpcUrls.anvil = env.ANVIL_RPC_URL;
  if (env.BASE_SEPOLIA_RPC_URL) rpcUrls["base-sepolia"] = env.BASE_SEPOLIA_RPC_URL;
  if (env.FISCO_RPC_URL) rpcUrls.fisco = env.FISCO_RPC_URL;
  return {
    anchorLedgers,
    breakerLedgers: list(env.BREAKER_LEDGERS, anchorLedgers),
    rpcUrls,
    port: int(env.INDEXER_PORT ?? env.PORT, 8791),
    host: env.INDEXER_HOST ?? "127.0.0.1",
    dataDir: resolve(env.INDEXER_DATA_DIR ?? resolve(appRoot, "data")),
    agentApiUrl: env.AGENT_API_URL || (env.RECEIPTS_FILE ? undefined : "http://127.0.0.1:8787"),
    receiptsFile: env.RECEIPTS_FILE ? resolve(env.RECEIPTS_FILE) : undefined,
    principal: env.RECEIPTS_PRINCIPAL || undefined,
    batchMaxReceipts: int(env.BATCH_MAX_RECEIPTS, 16),
    batchMaxAgeMs: int(env.BATCH_MAX_AGE_MS, 5 * 60_000),
    pollIntervalMs: int(env.INDEXER_POLL_MS, 15_000),
    autoStart: (env.INDEXER_AUTOSTART ?? "1") !== "0",
    adminToken: env.INDEXER_ADMIN_TOKEN || undefined,
    fiscoRpcUrl: env.FISCO_RPC_URL || env.FISCO_PROXY_UPSTREAM || undefined,
    proxyRateLimitPerMin: int(env.FISCO_PROXY_RATE_PER_MIN, 120),
    proxyMaxBlockRange: int(env.FISCO_PROXY_MAX_BLOCK_RANGE, 5_000),
  };
}
