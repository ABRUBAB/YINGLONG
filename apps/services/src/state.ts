// Small JSON state files (no secrets): the setup output per ledger and the x402 settlement log.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Address, Hex } from "viem";

export interface ServiceState {
  slug: string;
  role: string;
  name: string;
  wallet: Address;
  agentId: string;
  controller: Address;
  kid: string;
  jwksHash: Hex;
  identityCode: string;
  attestedBy: Address[];
}

export interface SetupState {
  ledger: string;
  chainId: number;
  updatedAt: string;
  label: string;
  contracts: Record<string, Address>;
  services: Record<string, ServiceState>;
  liquidity: Record<string, Record<string, string>>;
  minted: Record<string, Record<string, string>>;
  txs: { step: string; hash: Hex }[];
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export const setupStatePath = (stateDir: string, ledger: string) => resolve(stateDir, `${ledger}.json`);

export interface SettlementRecord {
  at: string;
  service: string;
  network: string;
  contextHash: Hex;
  transaction: Hex;
  payer: Address;
  payTo: Address;
  asset: Address;
  amount: string;
  status: "settled" | "pending" | "failed";
}

/** Append-only settlement log; also the source of the replay guard across restarts. */
export class SettlementLog {
  private readonly used = new Set<string>();
  private readonly inflight = new Set<string>();

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as SettlementRecord;
          if (r.status !== "failed") this.used.add(r.contextHash.toLowerCase());
        } catch {
          /* ignore a torn line */
        }
      }
    }
  }

  isUsed(contextHash: Hex): boolean {
    const k = contextHash.toLowerCase();
    return this.used.has(k) || this.inflight.has(k);
  }

  /** Claim a permission context for settlement; false if it is already settled or being settled. */
  claim(contextHash: Hex): boolean {
    if (this.isUsed(contextHash)) return false;
    this.inflight.add(contextHash.toLowerCase());
    return true;
  }

  release(contextHash: Hex): void {
    this.inflight.delete(contextHash.toLowerCase());
  }

  record(r: SettlementRecord): void {
    const k = r.contextHash.toLowerCase();
    this.inflight.delete(k);
    if (r.status !== "failed") this.used.add(k);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(r)}\n`);
  }
}
