// Loader for the mandate compliance prover in circuits/prover (noir_js + bb.js, keccak ZK UltraHonk).
// circuits/ is not a workspace package (it pins noir_js and bb.js to the exact nargo/bb versions that built
// the verifier), so it is imported by path at runtime. Install it once with `pnpm --dir circuits install`.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Hex } from "viem";
import { repoRoot } from "@yinglong/sdk/server";

export interface ZkMandateSecret {
  /** Hidden cap on the running total, in token base units. */
  cap: bigint;
  /** Hidden payee allowlist (at most 256 addresses). */
  allowlist: Hex[];
  /** Hidden expiry, in the ledger's block.timestamp unit (seconds). */
  expiry: bigint;
  salt: bigint;
}

export interface ZkRunningState {
  total: bigint;
  blind: bigint;
}

export interface ZkPaymentContext {
  delegationHash: Hex;
  /** The value of block.chainid inside the EVM of the target ledger. */
  chainId: bigint;
  payee: Hex;
  amount: bigint;
  nonce: bigint;
  claimedTime: bigint;
}

export interface ZkRequest {
  mandate: ZkMandateSecret;
  running: ZkRunningState;
  payment: ZkPaymentContext;
  newBlind?: bigint;
}

export interface ZkProof {
  proof: Hex;
  publicInputs: Hex[];
  publicInputsPacked: Hex;
  mandateCommitment: Hex;
  oldRunningCommitment: Hex;
  newRunningCommitment: Hex;
  newRunning: ZkRunningState;
  /** abi.encode(uint256 nonce, uint64 claimedTime, bytes32 newRunningCommitment, bytes proof) */
  enforcerArgs: Hex;
}

export interface ZkProverModule {
  proveMandateCompliance(req: ZkRequest): Promise<ZkProof>;
  verifyMandateCompliance(p: Pick<ZkProof, "proof" | "publicInputs">): Promise<boolean>;
  checkStatement(req: ZkRequest): Promise<{ ok: boolean; error?: string }>;
  initPoseidon(): Promise<void>;
  buildAllowlistTree(addresses: Hex[]): { root: bigint };
  mandateCommitment(cap: bigint, allowlistRoot: bigint, expiry: bigint, salt: bigint): bigint;
  initialRunningCommitment(): Promise<Hex>;
  encodeEnforcerArgs(nonce: bigint, claimedTime: bigint, newRunningCommitment: Hex, proof: Hex): Hex;
  randomField(): bigint;
  toHex32(x: bigint): Hex;
  destroyProver(): Promise<void>;
}

let loaded: ZkProverModule | undefined;

/** Load circuits/prover/src/index.ts (requires tsx or another TypeScript-aware loader). */
export async function zkProver(): Promise<ZkProverModule> {
  if (loaded) return loaded;
  const root = repoRoot();
  const entry = resolve(root, "circuits", "prover", "src", "index.ts");
  if (!existsSync(entry)) throw new Error(`prover not found at ${entry}`);
  if (!existsSync(resolve(root, "circuits", "node_modules", "@aztec", "bb.js"))) {
    throw new Error("circuits dependencies are missing: run `pnpm --dir circuits install`");
  }
  loaded = (await import(pathToFileURL(entry).href)) as ZkProverModule;
  return loaded;
}

/** Circuit facts recorded by circuits/scripts/manifest.mjs (vk hash, toolchain), if present. */
export function zkManifest(): { vkHash?: string; toolchain?: Record<string, unknown>; circuit?: { name?: string } } {
  const p = resolve(repoRoot(), "circuits", "MANIFEST.json");
  if (!existsSync(p)) return {};
  const m = JSON.parse(readFileSync(p, "utf8")) as {
    verificationKey?: { vkHash?: string };
    toolchain?: Record<string, unknown>;
    circuit?: { name?: string };
  };
  return { vkHash: m.verificationKey?.vkHash, toolchain: m.toolchain, circuit: m.circuit };
}
