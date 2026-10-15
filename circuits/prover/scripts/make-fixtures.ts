// Generate REAL mandate compliance proofs for the Foundry tests in contracts/test/zk.
//
//   pnpm --dir circuits fixtures
//
// Writes contracts/test/vectors/zk/mandate_compliance.fixtures.json. All test values are fictional test
// units. Commitments and blindings are derived deterministically from fixed labels; the proofs
// themselves are randomised by the zero-knowledge prover, so regenerated files differ only in proof bytes.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeAbiParameters, encodePacked, getContractAddress, keccak256, toHex } from "viem";

import {
  FIELD_MODULUS,
  destroyProver,
  initialRunningCommitment,
  proveMandateCompliance,
  verifyMandateCompliance,
  type Hex,
  type MandateComplianceProof,
  type MandateSecret,
  type RunningState,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../contracts/test/vectors/zk/mandate_compliance.fixtures.json");

const label = (s: string): bigint => BigInt(keccak256(toHex(s)));
const field = (s: string): bigint => label(s) % FIELD_MODULUS;
const addr = (s: string): Hex => `0x${keccak256(toHex(s)).slice(-40)}` as Hex;

const CHAIN_ID = 31337n; // Foundry default chain id
const DELEGATION_HASH = keccak256(toHex("yinglong.zk.test.delegation")) as Hex;

const payeeRent = addr("yinglong.zk.test.payee.rent");
const payeeTuition = addr("yinglong.zk.test.payee.tuition");
const payeeGrocer = addr("yinglong.zk.test.payee.grocer");
const notAllowlisted = addr("yinglong.zk.test.payee.mirage");

const mandate: MandateSecret = {
  cap: 1_000_000_000n, // 1,000.000000 test units (6 decimals)
  allowlist: [payeeRent, payeeTuition, payeeGrocer],
  expiry: 1_900_000_000n,
  salt: field("yinglong.zk.test.salt"),
};

interface Case {
  running: RunningState;
  payee: Hex;
  amount: bigint;
  nonce: bigint;
  claimedTime: bigint;
  newBlind: bigint;
}

const zero: RunningState = { total: 0n, blind: 0n };
const blind = (n: number) => field(`yinglong.zk.test.blind.${n}`);

async function prove(c: Case, delegationHash: Hex = DELEGATION_HASH): Promise<MandateComplianceProof> {
  const p = await proveMandateCompliance({
    mandate,
    running: c.running,
    newBlind: c.newBlind,
    payment: {
      delegationHash,
      chainId: CHAIN_ID,
      payee: c.payee,
      amount: c.amount,
      nonce: c.nonce,
      claimedTime: c.claimedTime,
    },
  });
  if (!(await verifyMandateCompliance(p))) throw new Error("bb.js rejected a fresh proof");
  return p;
}

function out(c: Case, p: MandateComplianceProof) {
  return {
    payee: c.payee,
    amount: c.amount.toString(),
    nonce: c.nonce.toString(),
    claimedTime: c.claimedTime.toString(),
    oldRunningCommitment: p.oldRunningCommitment,
    newRunningCommitment: p.newRunningCommitment,
    proof: p.proof,
    publicInputs: p.publicInputsPacked,
    args: p.enforcerArgs,
  };
}

const T0 = 1_800_000_000n;

// p1 -> p2 -> p3 is one valid chain: 600 + 300 + 100 = 1,000 = cap (boundary).
const p1: Case = { running: zero, payee: payeeRent, amount: 600_000_000n, nonce: 1n, claimedTime: T0, newBlind: blind(1) };
const p2: Case = {
  running: { total: 600_000_000n, blind: blind(1) },
  payee: payeeTuition,
  amount: 300_000_000n,
  nonce: 2n,
  claimedTime: T0 + 600n,
  newBlind: blind(2),
};
const p3: Case = {
  running: { total: 900_000_000n, blind: blind(2) },
  payee: payeeGrocer,
  amount: 100_000_000n,
  nonce: 3n,
  claimedTime: T0 + 1200n,
  newBlind: blind(3),
};
// Invariant 8: a second, individually valid proof that also starts from zero. 600 + 500 > cap.
const overCap: Case = { running: zero, payee: payeeTuition, amount: 500_000_000n, nonce: 7n, claimedTime: T0, newBlind: blind(7) };
// Claimed time exactly at the hidden expiry (the latest T the circuit accepts).
const atExpiry: Case = {
  running: zero,
  payee: payeeGrocer,
  amount: 1n,
  nonce: 9n,
  claimedTime: mandate.expiry,
  newBlind: blind(9),
};

// ---- Integration through the real DelegationManager (contracts/test/zk/ZKMandateEnforcerDM.t.sol) ----
// The test deploys from a fixed deployer in a fixed order, so every address in the delegation (and thus
// the delegation hash) is known here without running the test. The test asserts the hash matches.
const IT_DEPLOYER = addr("yinglong.zk.it.deployer");
const IT_AGENT = addr("yinglong.zk.it.agent");
const at = (nonce: number): Hex => getContractAddress({ from: IT_DEPLOYER, nonce: BigInt(nonce) }) as Hex;
const IT = {
  delegationManager: at(0),
  hybridDeleGatorImpl: at(1),
  delegator: at(2), // ERC1967Proxy -> HybridDeleGator
  token: at(3),
  allowedTargetsEnforcer: at(4),
  zkMandateEnforcer: at(5),
  router: at(6),
};
const ROOT_AUTHORITY = `0x${"f".repeat(64)}` as Hex;
const DELEGATION_TYPEHASH = keccak256(
  toHex("Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"),
);
const CAVEAT_TYPEHASH = keccak256(toHex("Caveat(address enforcer,bytes terms)"));
const caveatHash = (enforcer: Hex, terms: Hex) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }], [CAVEAT_TYPEHASH, enforcer, keccak256(terms)]));

const started = Date.now();
const cases: Record<string, Case> = { p1, p2, p3, overCap, atExpiry };
const proofs: Record<string, ReturnType<typeof out>> = {};
let commitment: Hex | undefined;
for (const [name, c] of Object.entries(cases)) {
  const t = Date.now();
  const p = await prove(c);
  commitment ??= p.mandateCommitment;
  if (p.mandateCommitment !== commitment) throw new Error("mandate commitment changed between cases");
  proofs[name] = out(c, p);
  console.log(`${name}: proved in ${Date.now() - t} ms, ${(p.proof.length - 2) / 2} proof bytes`);
}
// Integration delegation: caveats [AllowedTargets(token), ZKMandateEnforcer(router, commitment)], salt 0.
const zkTerms = encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [IT.router, commitment!]) as Hex;
const caveatsHash = keccak256(
  encodePacked(
    ["bytes32", "bytes32"],
    [caveatHash(IT.allowedTargetsEnforcer, encodePacked(["address"], [IT.token]) as Hex), caveatHash(IT.zkMandateEnforcer, zkTerms)],
  ),
);
const IT_DELEGATION_HASH = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
    [DELEGATION_TYPEHASH, IT_AGENT, IT.delegator, ROOT_AUTHORITY, caveatsHash, 0n],
  ),
) as Hex;
const itCases: Record<string, Case> = {
  dm1: { running: zero, payee: payeeRent, amount: 600_000_000n, nonce: 1n, claimedTime: T0, newBlind: blind(101) },
  dm2: {
    running: { total: 600_000_000n, blind: blind(101) },
    payee: payeeTuition,
    amount: 400_000_000n,
    nonce: 2n,
    claimedTime: T0 + 60n,
    newBlind: blind(102),
  },
  // 600 + 500 > cap: valid alone, must fail after dm1.
  dmOverCap: { running: zero, payee: payeeGrocer, amount: 500_000_000n, nonce: 3n, claimedTime: T0 + 60n, newBlind: blind(103) },
};
const itProofs: Record<string, ReturnType<typeof out>> = {};
for (const [name, c] of Object.entries(itCases)) {
  const t = Date.now();
  const p = await prove(c, IT_DELEGATION_HASH);
  itProofs[name] = out(c, p);
  console.log(`${name}: proved in ${Date.now() - t} ms`);
}
await destroyProver();

const fixture = {
  note: "Generated by circuits/prover/scripts/make-fixtures.ts with real UltraHonk (keccak, ZK) proofs. Test units only.",
  generator: { noir_js: "1.0.0-rc.5", "bb.js": "5.2.1", verifierTarget: "evm" },
  chainId: CHAIN_ID.toString(),
  delegationHash: DELEGATION_HASH,
  mandateCommitment: commitment,
  initialRunningCommitment: await initialRunningCommitment(),
  expiry: mandate.expiry.toString(),
  payees: { rent: payeeRent, tuition: payeeTuition, grocer: payeeGrocer, notAllowlisted },
  cases: proofs,
  integration: {
    deployer: IT_DEPLOYER,
    agent: IT_AGENT,
    addresses: IT,
    delegationHash: IT_DELEGATION_HASH,
    cases: itProofs,
  },
  proveMillisTotal: Date.now() - started,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${OUT}`);
