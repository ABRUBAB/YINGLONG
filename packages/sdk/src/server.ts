// Server-only helpers: load testnet role keys and deployments from disk. Never import this in the browser.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { concat, keccak256, stringToBytes, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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

/**
 * Agent keys are named by a role, or by "visitor:v-<10 hex>" for the agent wallet of a visitor who signed up with
 * their own passkey. A visitor's agent key is derived at runtime from the guest-arena testnet key and the visitor
 * id (never stored), so the agent runtime and the isolated signer derive the same wallet independently.
 */
export type AgentKeyRef = Role | `visitor:${string}`;
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const VISITOR_ID = /^v-[0-9a-f]{10}$/;

export function agentPrivateKey(ref: AgentKeyRef | string): Hex {
  if (ref.startsWith("visitor:")) {
    const id = ref.slice("visitor:".length);
    if (!VISITOR_ID.test(id)) throw new Error("malformed visitor id");
    const k = BigInt(keccak256(concat([rolePrivateKey("guest-arena"), toHex(stringToBytes(`yinglong:visitor-agent:v1:${id}`))]))) % (SECP256K1_N - 1n);
    return toHex(k + 1n, { size: 32 });
  }
  return rolePrivateKey(ref as Role);
}

export function agentAddress(ref: AgentKeyRef | string): Address {
  return ref.startsWith("visitor:") ? privateKeyToAccount(agentPrivateKey(ref)).address : roleAddress(ref as Role);
}

export function loadDeployment(name: LedgerName): Deployment {
  const p = resolve(repoRoot(), "contracts", "deployments", `${name}.json`);
  if (!existsSync(p)) throw new Error(`no deployment for ${name} at ${p}`);
  return parseDeployment(JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>);
}
