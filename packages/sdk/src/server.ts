// Server-only helpers: load testnet role keys and deployments from disk. Never import this in the browser.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import { parseDeployment, type Deployment } from "./deployments";
import type { LedgerName } from "./ledgers";

export type Role =
  | "deployer"
  | "agent-ying"
  | "agent-treasurer"
  | "mirage"
  | "guardian"
  | "breaker-watcher"
  | "relayer"
  | "supervisor"
  | "director-1"
  | "director-2"
  | "director-3"
  | "issuer-hbu"
  | "issuer-harbour-digital-bank"
  | "svc-pearl-river-fx"
  | "svc-kyb-verifier"
  | "svc-harbour-homes"
  | "svc-hbu-bursar"
  | "svc-shenzhen-components"
  | "svc-kowloon-forwarders"
  | "anchoring-relayer"
  | "agent-owner"
  | "svc-victoria-fx"
  | "svc-scholarship-foundation"
  | "facilitator"
  | "guest-arena";

interface KeyFile {
  roles: Record<string, { address: Address; privateKey: string }>;
}

/** Repository root (this file lives at packages/sdk/src). */
export function repoRoot(): string {
  return process.env.YINGLONG_ROOT ?? resolve(import.meta.dirname ?? __dirname, "..", "..", "..");
}

function secretsPath(): string {
  return process.env.YINGLONG_SECRETS ?? resolve(repoRoot(), "..", ".secrets", "testnet-keys.json");
}

let cache: KeyFile | undefined;

function keyFile(): KeyFile {
  if (cache) return cache;
  const p = secretsPath();
  if (!existsSync(p)) throw new Error(`testnet key file not found at ${p} (set YINGLONG_SECRETS)`);
  cache = JSON.parse(readFileSync(p, "utf8")) as KeyFile;
  return cache;
}

export function roleAddress(role: Role): Address {
  const r = keyFile().roles[role];
  if (!r) throw new Error(`unknown role ${role}`);
  return r.address;
}

/** Testnet-only private key for a role. Never log the return value. */
export function rolePrivateKey(role: Role): Hex {
  const r = keyFile().roles[role];
  if (!r) throw new Error(`unknown role ${role}`);
  return (r.privateKey.startsWith("0x") ? r.privateKey : `0x${r.privateKey}`) as Hex;
}

export function loadDeployment(name: LedgerName): Deployment {
  const p = resolve(repoRoot(), "contracts", "deployments", `${name}.json`);
  if (!existsSync(p)) throw new Error(`no deployment for ${name} at ${p}`);
  return parseDeployment(JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>);
}
