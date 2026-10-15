// Poseidon2 commitments computed exactly as the mandate_compliance circuit computes them.
//
// barretenberg's Poseidon2 sponge over BN254 (state width 4, rate 3, capacity 1, IV = length * 2^64).
// The circuit writes the sponge out with the stdlib permutation; bb.js exposes the same sponge as
// poseidon2Hash. Golden values are asserted on both sides (circuits/mandate_compliance/src/main.nr
// tests and circuits/prover/test/golden.test.ts).
import { BackendType, BarretenbergSync } from "@aztec/bb.js";

export type Hex = `0x${string}`;

/** BN254 scalar field modulus (the circuit's native field). */
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const TREE_DEPTH = 8;
export const MAX_ALLOWLIST = 1 << TREE_DEPTH;
export const U128_MAX = (1n << 128n) - 1n;
export const U64_MAX = (1n << 64n) - 1n;

let hasher: BarretenbergSync | undefined;

/** Initialise the hashing backend (WASM, no SRS). Safe to call more than once. */
export async function initPoseidon(): Promise<void> {
  if (!hasher) hasher = await BarretenbergSync.new({ backend: BackendType.Wasm, skipSrsInit: true });
}

function sync(): BarretenbergSync {
  if (!hasher) throw new Error("call initPoseidon() first");
  return hasher;
}

export function toField(x: bigint): Uint8Array {
  if (x < 0n || x >= FIELD_MODULUS) throw new RangeError(`value is not a field element: ${x}`);
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function fromField(b: Uint8Array): bigint {
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}

export function toHex32(x: bigint): Hex {
  return `0x${x.toString(16).padStart(64, "0")}`;
}

function hash(inputs: bigint[]): bigint {
  return fromField(sync().poseidon2Hash({ inputs: inputs.map(toField) }).hash);
}

export const poseidon2Hash1 = (a: bigint): bigint => hash([a]);
export const poseidon2Hash2 = (a: bigint, b: bigint): bigint => hash([a, b]);
export const poseidon2Hash4 = (a: bigint, b: bigint, c: bigint, d: bigint): bigint => hash([a, b, c, d]);

/** mandateCommitment = Poseidon2(cap, allowlistRoot, expiry, salt). */
export function mandateCommitment(cap: bigint, allowlistRoot: bigint, expiry: bigint, salt: bigint): bigint {
  if (cap < 0n || cap > U128_MAX) throw new RangeError("cap must fit in u128");
  if (expiry < 0n || expiry > U64_MAX) throw new RangeError("expiry must fit in u64");
  return poseidon2Hash4(cap, allowlistRoot, expiry, salt);
}

/** runningCommitment = Poseidon2(total, blind). The first payment uses (0, 0). */
export function runningCommitment(total: bigint, blind: bigint): bigint {
  if (total < 0n || total > U128_MAX) throw new RangeError("running total must fit in u128");
  return poseidon2Hash2(total, blind);
}

/** Allowlist leaf for an address: Poseidon2(address as a field element). */
export function allowlistLeaf(payee: Hex): bigint {
  return poseidon2Hash1(addressToField(payee));
}

export function addressToField(a: Hex): bigint {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`not an address: ${a}`);
  return BigInt(a);
}

export interface AllowlistTree {
  root: bigint;
  /** levels[0] = leaves (256), levels[8] = [root] */
  levels: bigint[][];
  addresses: Hex[];
}

/** Depth-8 Poseidon2 tree; leaf i is allowlistLeaf(addresses[i]); empty leaves are 0. */
export function buildAllowlistTree(addresses: Hex[]): AllowlistTree {
  if (addresses.length === 0 || addresses.length > MAX_ALLOWLIST) {
    throw new RangeError(`allowlist must hold 1..${MAX_ALLOWLIST} addresses`);
  }
  const seen = new Set<string>();
  for (const a of addresses) {
    const k = a.toLowerCase();
    if (seen.has(k)) throw new Error(`duplicate allowlist address ${a}`);
    seen.add(k);
  }
  let level: bigint[] = Array.from({ length: MAX_ALLOWLIST }, (_, i) =>
    i < addresses.length ? allowlistLeaf(addresses[i]!) : 0n,
  );
  const levels = [level];
  for (let d = 0; d < TREE_DEPTH; d++) {
    const next: bigint[] = [];
    for (let j = 0; j < level.length; j += 2) next.push(poseidon2Hash2(level[j]!, level[j + 1]!));
    levels.push(next);
    level = next;
  }
  return { root: level[0]!, levels, addresses };
}

/** Sibling path (leaf level first) and index for `payee`. Throws if the payee is not allowlisted. */
export function allowlistPath(tree: AllowlistTree, payee: Hex): { index: number; path: bigint[] } {
  const index = tree.addresses.findIndex((a) => a.toLowerCase() === payee.toLowerCase());
  if (index < 0) throw new Error(`payee ${payee} is not in the allowlist`);
  const path: bigint[] = [];
  let i = index;
  for (let d = 0; d < TREE_DEPTH; d++) {
    path.push(tree.levels[d]![i ^ 1]!);
    i >>= 1;
  }
  return { index, path };
}

/** A uniformly random field element (64 random bytes reduced mod p; bias below 2^-250). */
export function randomField(): bigint {
  const bytes = new Uint8Array(64);
  globalThis.crypto.getRandomValues(bytes);
  return fromField(bytes) % FIELD_MODULUS;
}
