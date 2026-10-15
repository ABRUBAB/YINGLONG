#!/usr/bin/env node
// CLI for the mandate compliance prover.
//
//   pnpm --dir circuits prove -- prove   <request.json> [--out proof.json]
//   pnpm --dir circuits prove -- verify  <proof.json>
//   pnpm --dir circuits prove -- commit  <mandate.json>        (prints mandateCommitment and allowlist root)
//   pnpm --dir circuits prove -- initial                       (prints Poseidon2(0, 0))
//
// request.json (integers as decimal strings, base units):
//   { "mandate": { "cap": "1000000000", "allowlist": ["0x..."], "expiry": "1900000000", "salt": "123" },
//     "running": { "total": "0", "blind": "0" },
//     "payment": { "delegationHash": "0x..32 bytes", "chainId": "84532", "payee": "0x...", "amount": "600000000",
//                  "nonce": "1", "claimedTime": "1800000000" },
//     "newBlind": "optional; random if omitted" }
// The output carries newRunning (total and blind): keep it private, it is the next payment's `running`.
// Set YINGLONG_BB_CRS_PATH to choose where bb.js caches the CRS.
import { readFileSync, writeFileSync } from "node:fs";

import {
  buildAllowlistTree,
  destroyProver,
  initPoseidon,
  initialRunningCommitment,
  mandateCommitment,
  proveMandateCompliance,
  toHex32,
  verifyMandateCompliance,
  type Hex,
  type MandateComplianceInputs,
} from "./index.js";

const big = (v: unknown, name: string): bigint => {
  if (typeof v !== "string" && typeof v !== "number") throw new Error(`${name} must be a decimal string`);
  if (typeof v === "number" && !Number.isSafeInteger(v)) throw new Error(`${name} is not a safe integer; use a string`);
  return BigInt(v);
};

function parseRequest(raw: any): MandateComplianceInputs {
  return {
    mandate: {
      cap: big(raw.mandate.cap, "mandate.cap"),
      allowlist: raw.mandate.allowlist as Hex[],
      expiry: big(raw.mandate.expiry, "mandate.expiry"),
      salt: big(raw.mandate.salt, "mandate.salt"),
    },
    running: { total: big(raw.running?.total ?? "0", "running.total"), blind: big(raw.running?.blind ?? "0", "running.blind") },
    payment: {
      delegationHash: raw.payment.delegationHash as Hex,
      chainId: big(raw.payment.chainId, "payment.chainId"),
      payee: raw.payment.payee as Hex,
      amount: big(raw.payment.amount, "payment.amount"),
      nonce: big(raw.payment.nonce, "payment.nonce"),
      claimedTime: big(raw.payment.claimedTime ?? Math.floor(Date.now() / 1000), "payment.claimedTime"),
    },
    ...(raw.newBlind !== undefined ? { newBlind: big(raw.newBlind, "newBlind") } : {}),
  };
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

async function main(argv: string[]): Promise<number> {
  const [cmd, file, ...rest] = argv;
  const outIdx = rest.indexOf("--out");
  const outFile = outIdx >= 0 ? rest[outIdx + 1] : undefined;
  switch (cmd) {
    case "prove": {
      if (!file) throw new Error("usage: prove <request.json> [--out proof.json]");
      const started = Date.now();
      const res = await proveMandateCompliance(parseRequest(JSON.parse(readFileSync(file, "utf8"))));
      const text = json({ ...res, proveMillis: Date.now() - started });
      if (outFile) writeFileSync(outFile, `${text}\n`);
      else process.stdout.write(`${text}\n`);
      return 0;
    }
    case "verify": {
      if (!file) throw new Error("usage: verify <proof.json>");
      const p = JSON.parse(readFileSync(file, "utf8"));
      const ok = await verifyMandateCompliance({ proof: p.proof, publicInputs: p.publicInputs });
      console.log(ok ? "valid" : "INVALID");
      return ok ? 0 : 1;
    }
    case "commit": {
      if (!file) throw new Error("usage: commit <mandate.json>");
      await initPoseidon();
      const m = JSON.parse(readFileSync(file, "utf8"));
      const tree = buildAllowlistTree(m.allowlist as Hex[]);
      const c = mandateCommitment(big(m.cap, "cap"), tree.root, big(m.expiry, "expiry"), big(m.salt, "salt"));
      console.log(json({ mandateCommitment: toHex32(c), allowlistRoot: toHex32(tree.root) }));
      return 0;
    }
    case "initial": {
      console.log(await initialRunningCommitment());
      return 0;
    }
    default:
      console.error("commands: prove <request.json> [--out f] | verify <proof.json> | commit <mandate.json> | initial");
      return 2;
  }
}

main(process.argv.slice(2))
  .then(async (code) => {
    await destroyProver();
    process.exit(code);
  })
  .catch(async (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    await destroyProver();
    process.exit(1);
  });
