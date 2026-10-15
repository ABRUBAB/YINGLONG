// Golden tests: the TypeScript Poseidon2 commitments equal the circuit's, the circuit refuses false
// statements, and bb.js derives the same verification key as the bb CLI that generated the verifier.
//
//   pnpm --dir circuits test        (set YINGLONG_BB_CRS_PATH to keep the CRS cache off the system drive)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";

import {
  DEFAULT_CIRCUIT_PATH,
  buildWitnessInputs,
  destroyProver,
  initPoseidon,
  initialRunningCommitment,
  poseidon2Hash1,
  poseidon2Hash2,
  poseidon2Hash4,
  proveMandateCompliance,
  toHex32,
  verifyMandateCompliance,
  type Hex,
  type MandateComplianceInputs,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

// Printed by `nargo test --show-output` (circuits/mandate_compliance/src/main.nr).
const GOLDEN = {
  hash1_1: "0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373",
  hash2_1_2: "0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383",
  hash4_1_2_3_4: "0x130bf204a32cac1f0ace56c78b731aa3809f06df2731ebcf6b3464a15788b1b9",
  hash2_0_0: "0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1",
};

const payee = "0x00000000000000000000000000000000000000b1" as Hex;
const base: MandateComplianceInputs = {
  mandate: {
    cap: 1000n,
    allowlist: ["0x00000000000000000000000000000000000000b0", payee, "0x00000000000000000000000000000000000000b2"],
    expiry: 2_000_000_000n,
    salt: 424242n,
  },
  running: { total: 0n, blind: 0n },
  payment: {
    delegationHash: `0x${"ab".repeat(32)}`,
    chainId: 84532n,
    payee,
    amount: 400n,
    nonce: 1n,
    claimedTime: 1_900_000_000n,
  },
  newBlind: 777n,
};

let noir: Noir;

before(async () => {
  await initPoseidon();
  noir = new Noir(JSON.parse(readFileSync(DEFAULT_CIRCUIT_PATH, "utf8")) as CompiledCircuit);
});

after(async () => {
  await destroyProver();
});

describe("Poseidon2 golden values (TypeScript == circuit)", () => {
  it("hash1, hash2, hash4 and the first-payment constant", async () => {
    assert.equal(toHex32(poseidon2Hash1(1n)), GOLDEN.hash1_1);
    assert.equal(toHex32(poseidon2Hash2(1n, 2n)), GOLDEN.hash2_1_2);
    assert.equal(toHex32(poseidon2Hash4(1n, 2n, 3n, 4n)), GOLDEN.hash4_1_2_3_4);
    assert.equal(await initialRunningCommitment(), GOLDEN.hash2_0_0);
  });

  it("the enforcer hard-codes the same Poseidon2(0, 0)", () => {
    const sol = readFileSync(resolve(repo, "contracts/src/zk/ZKMandateEnforcer.sol"), "utf8");
    const m = /INITIAL_RUNNING_COMMITMENT =\s*(0x[0-9a-f]{64})/.exec(sol);
    assert.ok(m, "constant not found");
    assert.equal(m[1], GOLDEN.hash2_0_0);
  });

  it("commitments computed in TypeScript satisfy the circuit", async () => {
    const w = await buildWitnessInputs(base);
    await noir.execute(w.inputs); // throws if any commitment differs from the circuit's computation
  });
});

describe("the circuit refuses false statements", () => {
  async function rejects(mutate: (i: Record<string, string | string[]>) => void, msg: RegExp) {
    const w = await buildWitnessInputs(base);
    mutate(w.inputs);
    await assert.rejects(noir.execute(w.inputs), msg);
  }

  it("cap exceeded", async () => {
    const w = await buildWitnessInputs({ ...base, running: { total: 600n, blind: 5n } }); // 600 + 400 = cap
    w.inputs.amount = "401";
    w.inputs.new_running_commitment = toHex32(poseidon2Hash2(1001n, 777n));
    await assert.rejects(noir.execute(w.inputs), /cap exceeded/);
  });

  it("payee not in the allowlist", () =>
    rejects((i) => {
      i.payee = BigInt("0x00000000000000000000000000000000000000ff").toString();
    }, /payee not in allowlist/));

  it("claimed time after expiry", () =>
    rejects((i) => {
      i.claimed_time = "2000000001";
    }, /mandate expired/));

  it("wrong old running commitment", () =>
    rejects((i) => {
      i.old_total = "1";
    }, /old running commitment does not open/));

  it("wrong mandate commitment", () =>
    rejects((i) => {
      i.salt = "1";
    }, /mandate commitment does not open/));

  it("u128 overflow of the running total", async () => {
    const max = (1n << 128n) - 1n;
    const w = await buildWitnessInputs(base);
    w.inputs.old_total = max.toString();
    w.inputs.old_running_commitment = toHex32(poseidon2Hash2(max, 0n));
    w.inputs.amount = "2";
    await assert.rejects(noir.execute(w.inputs));
  });

  it("the TypeScript prover refuses before proving", async () => {
    await assert.rejects(
      buildWitnessInputs({ ...base, payment: { ...base.payment, amount: 1001n } }),
      /exceed the mandate cap/,
    );
    await assert.rejects(
      buildWitnessInputs({ ...base, payment: { ...base.payment, payee: "0x00000000000000000000000000000000000000ff" } }),
      /not in the allowlist/,
    );
    await assert.rejects(
      buildWitnessInputs({ ...base, payment: { ...base.payment, claimedTime: 2_000_000_001n } }),
      /after the mandate expiry/,
    );
  });
});

describe("prove and verify with bb.js (keccak, ZK)", () => {
  it("round-trips and binds every public input", async () => {
    const p = await proveMandateCompliance(base);
    assert.equal(p.publicInputs.length, 10);
    assert.equal((p.proof.length - 2) / 2, 7616);
    assert.equal(await verifyMandateCompliance(p), true);
    const tampered = [...p.publicInputs];
    tampered[5] = toHex32(401n); // amount
    assert.equal(await verifyMandateCompliance({ proof: p.proof, publicInputs: tampered }).catch(() => false), false);
  });

  it("bb.js derives the same verification key as the bb CLI", async () => {
    const circuit = JSON.parse(readFileSync(DEFAULT_CIRCUIT_PATH, "utf8")) as CompiledCircuit;
    const api = await Barretenberg.new({ ...(process.env.YINGLONG_BB_CRS_PATH ? { crsPath: process.env.YINGLONG_BB_CRS_PATH } : {}) });
    try {
      const vk = await new UltraHonkBackend(circuit.bytecode, api).getVerificationKey({ verifierTarget: "evm" });
      const cliVkHex = readFileSync(resolve(repo, "contracts/src/zk/generated/mandate_compliance/vk.hex"), "utf8");
      const cliVk = Buffer.from(cliVkHex.trim(), "hex");
      const h = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
      assert.equal(h(vk), h(cliVk));
    } finally {
      await api.destroy();
    }
  });
});
