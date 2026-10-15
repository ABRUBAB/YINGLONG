// e-CNY-style simulator against the live Anvil deployment: the operator posts an opening balance, the paying
// account issues two conditional payment instructions (one whose invoice condition is satisfied, one whose
// delivery condition is not), and the simulator executes the first and rejects the second with a reason code.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { keccak256, stringToBytes, type Hex } from "viem";
import { abi } from "@yinglong/sdk";
import { roleAddress } from "@yinglong/sdk/server";
import { makeSim, type SimDeps } from "../src/app";
import { REASONS, reasonHash } from "../src/simulator";

const RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8645";
process.env.LEDGER = "anvil";
process.env.RPC_URL = RPC;
process.env.ECNY_STATE_DIR = mkdtempSync(join(tmpdir(), "ecny-sim-test-"));

let deps: SimDeps;
const treasurer = roleAddress("agent-treasurer");
const supplier = roleAddress("svc-shenzhen-components");
const forwarders = roleAddress("svc-kowloon-forwarders");
const cpiFn = (functionName: string, args: readonly unknown[]) => ({ address: deps.ledger.addr("ConditionalPaymentInstructions"), abi: abi.ConditionalPaymentInstructionsAbi, functionName, args });

const INVOICE_OK: Hex = keccak256(stringToBytes("invoice:SZC-2026-10-approved"));
const DELIVERY_PENDING: Hex = keccak256(stringToBytes("delivery:KWL-2026-10-pending"));
const PURPOSE = keccak256(stringToBytes("purpose:supplier-payment"));

beforeAll(async () => {
  deps = makeSim();
  // Reset the posted balance deterministically so repeated runs still have funds.
  await deps.ledger.ensureGas(roleAddress("relayer"));
  await deps.ledger.write("relayer", cpiFn("postBalance", [treasurer, 50_000_000n, keccak256(stringToBytes("opening:test"))]));
  await deps.ledger.ensureGas(treasurer);
}, 180_000);

async function instruct(condition: Hex): Promise<number> {
  const before = await deps.ledger.read<bigint>(cpiFn("instructionCount", []));
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + 3600);
  await deps.ledger.write("agent-treasurer", cpiFn("instruct", [supplierOrForwarder(condition), 1_000_000n, PURPOSE, condition, validUntil]));
  return Number(before); // ids are sequential; the new one is `before`
}
function supplierOrForwarder(condition: Hex) {
  return condition === DELIVERY_PENDING ? forwarders : supplier;
}

describe("conditional payment instructions", () => {
  it("executes an instruction whose invoice condition is satisfied", async () => {
    const id = await instruct(INVOICE_OK);
    const processed = await deps.sim.poll();
    const mine = processed.find((p) => p.id === id);
    expect(mine?.decision).toBe("executed");
    const inst = await deps.ledger.read<{ status: number; resultRef: Hex }>(cpiFn("instructionOf", [BigInt(id)]));
    expect(Number(inst.status)).toBe(2); // Executed
    const supplierBal = await deps.ledger.read<bigint>(cpiFn("postedBalance", [supplier]));
    expect(supplierBal).toBeGreaterThanOrEqual(1_000_000n);
  });

  it("rejects an instruction whose delivery condition is not satisfied, with a reason code", async () => {
    const id = await instruct(DELIVERY_PENDING);
    const processed = await deps.sim.poll();
    const mine = processed.find((p) => p.id === id);
    expect(mine?.decision).toBe("rejected");
    expect(mine?.reason).toBe(REASONS.conditionNotMet);
    const inst = await deps.ledger.read<{ status: number; resultRef: Hex }>(cpiFn("instructionOf", [BigInt(id)]));
    expect(Number(inst.status)).toBe(3); // Rejected
    expect(inst.resultRef.toLowerCase()).toBe(reasonHash(REASONS.conditionNotMet).toLowerCase());
  });

  it("executes the delivery instruction once its condition is satisfied", async () => {
    deps.sim.setConditionSatisfied(DELIVERY_PENDING, true);
    const id = await instruct(DELIVERY_PENDING);
    const processed = await deps.sim.poll();
    expect(processed.find((p) => p.id === id)?.decision).toBe("executed");
  });

  it("serves a statement for the paying account", async () => {
    const st = await deps.sim.statement(treasurer);
    expect(st.entries.some((e) => e.kind === "debit")).toBe(true);
    expect(BigInt(st.postedBalance)).toBeGreaterThanOrEqual(0n);
  });
});
