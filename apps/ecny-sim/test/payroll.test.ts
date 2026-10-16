// Payroll on the coin-free rail: the staff payroll payee sealed in Lotus Lane's mandate is a known payee of the
// simulator, so an unconditional payroll instruction to it is executed (no chain needed: evaluate() only).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Throwaway role keys for this test only (never the testnet key file).
const dir = mkdtempSync(join(tmpdir(), "ecny-payroll-"));
const roles: Record<string, { address: Address; privateKey: Hex }> = {};
for (const r of ["agent-treasurer", "svc-shenzhen-components", "svc-kowloon-forwarders", "director-1", "relayer"]) {
  const pk = generatePrivateKey();
  roles[r] = { address: privateKeyToAccount(pk).address, privateKey: pk };
}
writeFileSync(join(dir, "keys.json"), JSON.stringify({ roles }));
process.env.YINGLONG_SECRETS = join(dir, "keys.json");

const { defaultAccounts, STAFF_PAYROLL } = await import("../src/config");
const { Simulator, REASONS } = await import("../src/simulator");

describe("staff payroll payee", () => {
  it("is the label-derived address the agent's mandate seals", () => {
    expect(STAFF_PAYROLL.toLowerCase()).toBe(`0x${keccak256(stringToBytes("lotus-lane-payroll")).slice(26)}`);
    const acct = defaultAccounts().find((a) => a.address.toLowerCase() === STAFF_PAYROLL.toLowerCase());
    expect(acct?.isPayee).toBe(true);
    expect(acct?.label).toMatch(/payroll/i);
  });

  it("an unconditional payroll instruction is accepted; an unknown payee is not", () => {
    const ledger = { name: "anvil", addr: () => "0x0000000000000000000000000000000000000001" } as never;
    const sim = new Simulator({ ledger, statePath: join(dir, "state.json"), knownAccounts: defaultAccounts(), conditions: [], allowedPurposes: [] });
    const zero = `0x${"00".repeat(32)}` as Hex;
    const base = { account: roles["agent-treasurer"]!.address, amount: 8_000_000n, purposeHash: keccak256(stringToBytes("purpose:payroll")), conditionHash: zero, validUntil: 0n };
    expect(sim.evaluate({ ...base, payee: STAFF_PAYROLL }, 1n, 10_000_000n)).toEqual({ ok: true });
    expect(sim.evaluate({ ...base, payee: "0x000000000000000000000000000000000000dEaD" }, 1n, 10_000_000n).reason).toBe(REASONS.payeeNotKnown);
    expect(sim.evaluate({ ...base, payee: STAFF_PAYROLL }, 1n, 1n).reason).toBe(REASONS.insufficientBalance);
  });
});
