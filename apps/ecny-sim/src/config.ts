import { resolve } from "node:path";
import { getAddress, type Address } from "viem";
import type { LedgerName } from "@yinglong/sdk";
import { roleAddress, type Role } from "@yinglong/sdk/server";
import type { Condition, KnownAccount } from "./simulator";
import { purposeHash } from "./simulator";

export interface EcnySimConfig {
  ledger: LedgerName;
  rpcUrl?: string;
  port: number;
  host: string;
  statePath: string;
  pollIntervalMs: number;
  adminToken?: string;
  knownAccounts: KnownAccount[];
  conditions: Condition[];
  allowedPurposes: string[];
}

const appRoot = resolve(import.meta.dirname, "..");
const FEN = (n: number) => (BigInt(n) * 100n).toString(); // 2-decimal CNY instruction units

function int(v: string | undefined, d: number): number {
  if (!v) return d;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`expected a non-negative integer, got ${v}`);
  return n;
}

/**
 * Default demo cast on the coin-free rail: Lotus Lane Trading (Shenzhen) as the paying account, two known
 * payees (Shenzhen Components supplier and a staff payroll account), and a couple of pre-stored conditions
 * (one satisfied invoice, one unsatisfied delivery confirmation) so the demo can execute one instruction and
 * reject one. All fictional; test environment only.
 */
export function defaultAccounts(treasurerRole: Role = "agent-treasurer"): KnownAccount[] {
  const treasurer = roleAddress(treasurerRole);
  return [
    { address: treasurer, label: "Lotus Lane Trading (Shenzhen) treasurer (fictional)", openingBalance: FEN(500_000), isPayee: false },
    { address: roleAddress("svc-shenzhen-components"), label: "Shenzhen Components (fictional supplier)", isPayee: true },
    { address: roleAddress("svc-kowloon-forwarders"), label: "Kowloon Forwarders (fictional)", isPayee: true },
    { address: roleAddress("director-1"), label: "Staff payroll account (fictional)", isPayee: true },
  ];
}

export function defaultConditions(): Condition[] {
  return [
    { conditionHash: purposeHash("invoice:SZC-2026-10-approved"), kind: "invoice", ref: "SZC-2026-10-approved", satisfied: true, note: "Matched supplier invoice (fictional); approved for payment." },
    { conditionHash: purposeHash("delivery:KWL-2026-10-pending"), kind: "delivery-confirmation", ref: "KWL-2026-10-pending", satisfied: false, note: "Delivery not yet confirmed (fictional); instruction will be rejected until satisfied." },
  ];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EcnySimConfig {
  const ledger = (env.LEDGER ?? env.ECNY_LEDGER ?? "anvil") as LedgerName;
  if (!["anvil", "base-sepolia", "fisco"].includes(ledger)) throw new Error(`unknown LEDGER ${ledger}`);
  const port = int(env.ECNY_PORT ?? env.PORT, 8792);
  const extraPayees = (env.ECNY_EXTRA_PAYEES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((a): KnownAccount => ({ address: getAddress(a) as Address, label: "configured payee", isPayee: true }));
  return {
    ledger,
    rpcUrl: env.RPC_URL || undefined,
    port,
    host: env.ECNY_HOST ?? "127.0.0.1",
    statePath: resolve(env.ECNY_STATE_DIR ?? resolve(appRoot, "state"), `${ledger}.json`),
    pollIntervalMs: int(env.ECNY_POLL_MS, 3_000),
    adminToken: env.ECNY_ADMIN_TOKEN || undefined,
    knownAccounts: [...defaultAccounts(), ...extraPayees],
    conditions: defaultConditions(),
    allowedPurposes: [], // any purpose allowed by default
  };
}
