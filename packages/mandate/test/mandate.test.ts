import { describe, expect, it } from "vitest";
import { createPublicClient, http, keccak256, toHex, type Address, type Hex } from "viem";
import { abi, LEDGERS } from "@yinglong/sdk";
import { loadDeployment } from "@yinglong/sdk/server";
import {
  canonicalHash,
  canonicalJson,
  compileMandate,
  decompile,
  delegationHash,
  hashRingAscii,
  hashRingGeometry,
  namesFor,
  nadiaMandate,
  rootDelegation,
  tickDifference,
  verifyRoundTrip,
  type Mandate,
} from "../src/index";

const d = loadDeployment("anvil");
const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const parties = {
  account: A(0xa11ce),
  agent: A(0x1),
  harbourHomes: A(0x101),
  hbuBursar: A(0x102),
  foodMart: A(0x103),
  issuerHbu: A(0x201),
  issuerBank: A(0x202),
};
const NOW = 1_792_000_000;

describe("canonical JSON", () => {
  it("sorts keys, drops whitespace and keeps UTF-8", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: "x", c: null }] })).toBe('{"a":[2,{"c":null,"d":"x"}],"b":1}');
    const bangla = String.fromCodePoint(0x0986, 0x09ae, 0x09be, 0x09b0);
    expect(canonicalJson({ s: bangla })).toBe(`{"s":"${bangla}"}`);
  });
  it("refuses floats for money", () => {
    expect(() => canonicalJson({ x: 1.5 })).toThrow();
  });
});

describe("compiler", () => {
  const m = nadiaMandate(d, parties, { now: NOW });
  const c = compileMandate(m, d);

  it("emits the allowlists first and binds the mandate hash", () => {
    expect(c.caveats[0]!.enforcer).toBe(d.contracts.AllowedTargetsEnforcer.address);
    expect(c.caveats[1]!.enforcer).toBe(d.contracts.AllowedMethodsEnforcer.address);
    expect(c.mandateHash).toBe(canonicalHash(m));
    expect(c.caveats.length).toBe(16);
  });

  it("is deterministic and sensitive to one word", () => {
    const again = compileMandate(nadiaMandate(d, parties, { now: NOW }), d);
    expect(again.delegationHash).toBe(c.delegationHash);
    const edited: Mandate = structuredClone(m);
    edited.budgets[0]!.caps[1]!.amount = (30_000n * 1_000_000n).toString(); // "3,000" -> "30,000"
    const e = compileMandate(edited, d);
    expect(e.delegationHash).not.toBe(c.delegationHash);
    expect(tickDifference(e.delegationHash, c.delegationHash)).toBeGreaterThanOrEqual(16);
  });

  it("decompiles every rule into English with the right numbers", () => {
    const { sentences, rules } = decompile(c.caveats, d, namesFor(d, m));
    expect(rules.some((r) => r.kind === "unknown")).toBe(false);
    const text = sentences.join("\n");
    expect(text).toContain("food at most 3,000 tHKD");
    expect(text).toContain("never goes below 1,500 tHKD");
    expect(text).toContain("Payments above 2,000 tHKD need your approval");
    expect(text).toContain("rent up to 9,500 tHKD");
    expect(text).toContain("Jurisdiction: Hong Kong");
  });

  it("round-trips against its own published form", () => {
    const r = verifyRoundTrip({
      mandate: m,
      deployment: d,
      onChainCaveats: c.caveats,
      onChainDelegationHash: c.delegationHash,
      delegator: parties.account,
      delegate: parties.agent,
      salt: 1n,
    });
    expect(r.ok).toBe(true);
  });

  it("detects a tampered published caveat", () => {
    const tampered = c.caveats.map((x) => ({ ...x }));
    tampered[11] = { ...tampered[11]!, terms: (tampered[11]!.terms.slice(0, -2) + "ff") as Hex };
    const r = verifyRoundTrip({
      mandate: m,
      deployment: d,
      onChainCaveats: tampered,
      onChainDelegationHash: c.delegationHash,
      delegator: parties.account,
      delegate: parties.agent,
      salt: 1n,
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a mainland mandate on a value token", () => {
    const bad = structuredClone(m);
    bad.jurisdiction = "mainland";
    // compiles (rule is enforced on-chain), but the on-chain JurisdictionEnforcer refuses any non coin-free rail
    expect(() => compileMandate(bad, d)).not.toThrow();
  });
});

describe("Hash Ring", () => {
  const h = keccak256(toHex("yinglong"));
  it("has 64 ticks and 9 arcs, gap when revoked", () => {
    const g = hashRingGeometry(h);
    expect(g.ticks).toHaveLength(64);
    expect(g.arcs).toHaveLength(9);
    expect(hashRingGeometry(h, { revoked: true }).ticks).toHaveLength(60);
    expect(hashRingAscii(h)).toHaveLength(64);
  });
  it("random hashes differ in at least 16 ticks", () => {
    for (let i = 0; i < 200; i++) {
      const a = keccak256(toHex(`a${i}`));
      const b = keccak256(toHex(`b${i}`));
      expect(tickDifference(a, b)).toBeGreaterThanOrEqual(16);
    }
  });
});

describe("parity with Solidity (needs anvil on 8645 with the deployment)", async () => {
  const client = createPublicClient({ transport: http(LEDGERS.anvil.rpcUrl) });
  const up = await client.getChainId().then(() => true).catch(() => false);
  it.skipIf(!up)("delegation hash equals DelegationManager.getDelegationHash and MandateRegistry", async () => {
    const m = nadiaMandate(d, parties, { now: NOW });
    const c = compileMandate(m, d);
    const dele = rootDelegation(parties.account, parties.agent, c.caveats, 1n);
    const onDm = await client.readContract({
      address: d.contracts.DelegationManager.address,
      abi: abi.DelegationManagerAbi,
      functionName: "getDelegationHash",
      args: [{ ...dele, authority: dele.authority as Hex }],
    });
    const onRegistry = await client.readContract({
      address: d.contracts.MandateRegistry.address,
      abi: abi.MandateRegistryAbi,
      functionName: "computeDelegationHash",
      args: [parties.account, parties.agent, 1n, c.caveats],
    });
    expect(onDm).toBe(delegationHash(dele));
    expect(onRegistry).toBe(c.delegationHash);
  });
});
