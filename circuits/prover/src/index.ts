// Prover for the YINGLONG private mandate (proof type 0x01, mandate compliance).
//
// noir_js executes the circuit to a witness; bb.js UltraHonkBackend proves it with the keccak oracle
// and zero knowledge (verifierTarget "evm"), which is what the generated Solidity verifier checks.
// Versions are pinned in circuits/package.json and must equal nargo / bb used to build the circuit and
// the verifier (see circuits/MANIFEST.json).
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Barretenberg, UltraHonkBackend, type ProofData } from "@aztec/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { encodeAbiParameters, type Hex as ViemHex } from "viem";

import {
  FIELD_MODULUS,
  U128_MAX,
  U64_MAX,
  addressToField,
  allowlistPath,
  buildAllowlistTree,
  initPoseidon,
  mandateCommitment,
  randomField,
  runningCommitment,
  toHex32,
  type AllowlistTree,
  type Hex,
} from "./poseidon.js";

export * from "./poseidon.js";

export const PROOF_TYPE_MANDATE_COMPLIANCE = 0x01;
export const NUM_PUBLIC_INPUTS = 10;

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CIRCUIT_PATH = resolve(here, "../../mandate_compliance/target/mandate_compliance.json");

/** The hidden mandate. Only the agent (prover) and the user who sealed it know these values. */
export interface MandateSecret {
  /** Cap on the running total, in token base units (u128). */
  cap: bigint;
  /** Allowlisted payee addresses (at most 256). Order fixes leaf indices and therefore the root. */
  allowlist: Hex[];
  /** Expiry, unix seconds (u64). */
  expiry: bigint;
  /** Random field element that hides cap, root and expiry. */
  salt: bigint;
}

/** Private running total and its blinding. The first payment starts from {total: 0n, blind: 0n}. */
export interface RunningState {
  total: bigint;
  blind: bigint;
}

/** Public context of one payment; every field ends up in the public inputs. */
export interface PaymentContext {
  delegationHash: Hex;
  chainId: bigint;
  payee: Hex;
  amount: bigint;
  nonce: bigint;
  /** Claimed time T, unix seconds. The enforcer accepts T in [block.timestamp - 300, block.timestamp + 60]. */
  claimedTime: bigint;
}

export interface MandateComplianceInputs {
  mandate: MandateSecret;
  running: RunningState;
  payment: PaymentContext;
  /** Fresh blinding for the new running commitment. Random if omitted. */
  newBlind?: bigint;
}

export interface MandateComplianceProof {
  /** Raw UltraHonk proof bytes, as the Solidity verifier expects them. */
  proof: Hex;
  /** The 10 public inputs as 32-byte words, in circuit order. */
  publicInputs: Hex[];
  /** publicInputs concatenated: the `publicInputs` bytes argument of ZKVerifierRouter.verifyProof. */
  publicInputsPacked: Hex;
  mandateCommitment: Hex;
  oldRunningCommitment: Hex;
  newRunningCommitment: Hex;
  /** Store this privately; it opens newRunningCommitment and is the `running` of the next payment. */
  newRunning: RunningState;
  /** abi.encode(uint256 nonce, uint64 claimedTime, bytes32 newRunningCommitment, bytes proof): caveat args. */
  enforcerArgs: Hex;
}

export interface ProverOptions {
  circuitPath?: string;
  /** Directory for the CRS download cache (bb.js default is ~/.bb-crs). Env: YINGLONG_BB_CRS_PATH. */
  crsPath?: string;
  threads?: number;
}

export interface WitnessInputs {
  inputs: Record<string, string | string[]>;
  mandateCommitment: bigint;
  oldRunningCommitment: bigint;
  newRunningCommitment: bigint;
  newRunning: RunningState;
  tree: AllowlistTree;
}

/** The Poseidon2(0, 0) constant: the old running commitment of the very first payment. */
export async function initialRunningCommitment(): Promise<Hex> {
  await initPoseidon();
  return toHex32(runningCommitment(0n, 0n));
}

/** delegationHash split into two 128-bit limbs (hi, lo), as the enforcer does. */
export function splitDelegationHash(h: Hex): { hi: bigint; lo: bigint } {
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error(`not a bytes32: ${h}`);
  const v = BigInt(h);
  return { hi: v >> 128n, lo: v & U128_MAX };
}

/**
 * Build the circuit input map and every derived commitment (no proving). `skipStatementChecks` leaves the
 * cap and expiry checks to the circuit itself (used to demonstrate that the circuit refuses).
 */
export async function buildWitnessInputs(
  req: MandateComplianceInputs,
  opts: { skipStatementChecks?: boolean } = {},
): Promise<WitnessInputs> {
  await initPoseidon();
  const { mandate, running, payment } = req;
  const { amount, nonce, claimedTime, chainId } = payment;
  if (amount < 0n || amount > U128_MAX) throw new RangeError("amount must fit in u128");
  if (claimedTime < 0n || claimedTime > U64_MAX) throw new RangeError("claimedTime must fit in u64");
  if (nonce < 0n || nonce >= FIELD_MODULUS) throw new RangeError("nonce must be below the field modulus");
  if (chainId < 0n || chainId >= FIELD_MODULUS) throw new RangeError("chainId must be below the field modulus");
  const newTotal = running.total + amount;
  if (newTotal > U128_MAX) throw new RangeError("running total overflows u128");
  if (!opts.skipStatementChecks) {
    if (newTotal > mandate.cap) throw new RangeError("payment would exceed the mandate cap: no proof exists");
    if (claimedTime > mandate.expiry) throw new RangeError("claimed time is after the mandate expiry: no proof exists");
  }

  const tree = buildAllowlistTree(mandate.allowlist);
  const { index, path } = allowlistPath(tree, payment.payee);
  const commitment = mandateCommitment(mandate.cap, tree.root, mandate.expiry, mandate.salt);
  const newBlind = req.newBlind ?? randomField();
  const oldRc = runningCommitment(running.total, running.blind);
  const newRc = runningCommitment(newTotal, newBlind);
  const { hi, lo } = splitDelegationHash(payment.delegationHash);

  const dec = (x: bigint) => x.toString();
  const inputs: Record<string, string | string[]> = {
    cap: dec(mandate.cap),
    allowlist_root: dec(tree.root),
    payee_path: path.map(dec),
    payee_index: dec(BigInt(index)),
    expiry: dec(mandate.expiry),
    salt: dec(mandate.salt),
    old_total: dec(running.total),
    old_blind: dec(running.blind),
    new_blind: dec(newBlind),
    mandate_commitment: dec(commitment),
    delegation_hash_hi: dec(hi),
    delegation_hash_lo: dec(lo),
    chain_id: dec(chainId),
    payee: dec(addressToField(payment.payee)),
    amount: dec(amount),
    nonce: dec(nonce),
    claimed_time: dec(claimedTime),
    old_running_commitment: dec(oldRc),
    new_running_commitment: dec(newRc),
  };
  return {
    inputs,
    mandateCommitment: commitment,
    oldRunningCommitment: oldRc,
    newRunningCommitment: newRc,
    newRunning: { total: newTotal, blind: newBlind },
    tree,
  };
}

/** Public inputs in circuit order, as 32-byte words, computed without proving. */
export function expectedPublicInputs(w: WitnessInputs): Hex[] {
  const order = [
    "mandate_commitment",
    "delegation_hash_hi",
    "delegation_hash_lo",
    "chain_id",
    "payee",
    "amount",
    "nonce",
    "claimed_time",
    "old_running_commitment",
    "new_running_commitment",
  ];
  return order.map((k) => toHex32(BigInt(w.inputs[k] as string)));
}

export function encodeEnforcerArgs(nonce: bigint, claimedTime: bigint, newRunningCommitment: Hex, proof: Hex): Hex {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes" }],
    [nonce, claimedTime, newRunningCommitment as ViemHex, proof as ViemHex],
  ) as Hex;
}

let cached: { key: string; api: Barretenberg; noir: Noir; backend: UltraHonkBackend } | undefined;

async function engine(opts: ProverOptions) {
  const circuitPath = opts.circuitPath ?? DEFAULT_CIRCUIT_PATH;
  const crsPath = opts.crsPath ?? process.env.YINGLONG_BB_CRS_PATH;
  const threads = opts.threads ?? Math.max(1, availableParallelism());
  const key = `${circuitPath}|${crsPath ?? ""}|${threads}`;
  if (cached?.key === key) return cached;
  if (cached) await cached.api.destroy();
  const circuit = JSON.parse(readFileSync(circuitPath, "utf8")) as CompiledCircuit;
  const api = await Barretenberg.new({ threads, ...(crsPath ? { crsPath } : {}) });
  cached = { key, api, noir: new Noir(circuit), backend: new UltraHonkBackend(circuit.bytecode, api) };
  return cached;
}

/** Release the proving backend (worker threads, WASM memory). */
export async function destroyProver(): Promise<void> {
  if (cached) await cached.api.destroy();
  cached = undefined;
}

function bytesToHex(b: Uint8Array): Hex {
  return `0x${Buffer.from(b).toString("hex")}`;
}

/**
 * Prove that one ERC-20 transfer complies with the hidden mandate and advances the running total.
 * Throws before proving if the statement is false (cap exceeded, payee not allowlisted, expired).
 */
export async function proveMandateCompliance(
  req: MandateComplianceInputs,
  opts: ProverOptions = {},
): Promise<MandateComplianceProof> {
  const w = await buildWitnessInputs(req);
  const { noir, backend } = await engine(opts);
  const { witness } = await noir.execute(w.inputs);
  const pd: ProofData = await backend.generateProof(witness, { verifierTarget: "evm" });

  const expected = expectedPublicInputs(w);
  const got = pd.publicInputs.map((x) => toHex32(BigInt(x)));
  if (got.length !== NUM_PUBLIC_INPUTS || got.some((x, i) => x !== expected[i])) {
    throw new Error(`public inputs mismatch: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  }
  const proof = bytesToHex(pd.proof);
  const newRc = toHex32(w.newRunningCommitment);
  return {
    proof,
    publicInputs: got,
    publicInputsPacked: `0x${got.map((x) => x.slice(2)).join("")}`,
    mandateCommitment: toHex32(w.mandateCommitment),
    oldRunningCommitment: toHex32(w.oldRunningCommitment),
    newRunningCommitment: newRc,
    newRunning: w.newRunning,
    enforcerArgs: encodeEnforcerArgs(req.payment.nonce, req.payment.claimedTime, newRc, proof),
  };
}

/**
 * Execute the circuit on the request without the TypeScript pre-checks and without proving. Returns the
 * circuit's own verdict: `ok: false` with the failing constraint's message when no witness (and thus no
 * proof) can exist, e.g. "cap exceeded".
 */
export async function checkStatement(
  req: MandateComplianceInputs,
  opts: ProverOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const w = await buildWitnessInputs(req, { skipStatementChecks: true });
  const { noir } = await engine(opts);
  try {
    await noir.execute(w.inputs);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Off-chain check with bb.js (same keccak ZK flavour as the Solidity verifier). */
export async function verifyMandateCompliance(
  p: Pick<MandateComplianceProof, "proof" | "publicInputs">,
  opts: ProverOptions = {},
): Promise<boolean> {
  const { backend } = await engine(opts);
  const proof = Uint8Array.from(Buffer.from(p.proof.slice(2), "hex"));
  return backend.verifyProof({ proof, publicInputs: p.publicInputs }, { verifierTarget: "evm" });
}
