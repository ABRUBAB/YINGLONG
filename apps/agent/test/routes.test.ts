import { roles } from "./helpers/env";
import { beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abi } from "@yinglong/sdk";
import type { Mandate } from "@yinglong/mandate";
import { app } from "../src/server";
import { recordReceipt } from "../src/receipts";
import { anvilReady, deployment, newAccount, seedLotusHk, seedLotusSz, seedNadia } from "./helpers/seed";

const OP = { "x-admin-token": "test-operator-token", "Content-Type": "application/json" };
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
  app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe("proof routes (no ledger needed)", () => {
  it("serves the proof bundle with real result files and an audit 404 for unknown receipts", async () => {
    const r = await req("GET", "/v1/proof");
    expect(r.status).toBe(200);
    const p = await json(r);
    expect(p).toMatchObject({ schema: "yinglong.proof/1", build: { repo: "https://github.com/ABRUBAB/YINGLONG" } });
    const ml = p.ml as { sentinel: { confusion: { tp: number; fn: number; tn: number; fp: number }; test: { positives: number; negatives: number } } };
    expect(ml.sentinel.confusion.tp + ml.sentinel.confusion.fn).toBe(ml.sentinel.test.positives);
    expect(ml.sentinel.confusion.tn + ml.sentinel.confusion.fp).toBe(ml.sentinel.test.negatives);
    expect((await req("GET", "/v1/receipts/0xnope/audit")).status).toBe(404);
  });
});

describe("new routes: auth and validation (no ledger needed)", () => {
  it("unknown principals answer 404 on every new route", async () => {
    for (const [m, p] of [
      ["GET", "/v1/principals/nobody/insights"],
      ["GET", "/v1/principals/nobody/escrows"],
      ["GET", "/v1/principals/nobody/coverage"],
      ["GET", "/v1/principals/nobody/forecast"],
      ["GET", "/v1/principals/nobody/credentials"],
      ["POST", "/v1/principals/nobody/credentials/payment-reliability"],
      ["POST", "/v1/principals/nobody/payroll"],
      ["POST", "/v1/principals/nobody/escrows/0/release"],
      ["POST", "/v1/principals/nobody/escrows/0/refund"],
    ] as const) {
      const r = await req(m, p, m === "POST" ? {} : undefined, OP);
      expect(r.status, `${m} ${p}`).toBe(404);
    }
  });

  it("state-changing routes need the operator token (or the visitor's own token where allowed)", async () => {
    for (const p of ["/v1/principals/nadia/credentials/payment-reliability", "/v1/principals/nadia/escrows/0/release", "/v1/principals/nadia/escrows/0/refund", "/v1/principals/lotus-sz/payroll"]) {
      const r = await req("POST", p, {});
      expect(r.status, p).toBe(403);
    }
    const r = await req("POST", "/v1/principals/v-0123456789/credentials/payment-reliability", {}, { "Content-Type": "application/json", "x-visitor-token": "wrong" });
    expect(r.status).toBe(403);
  });

  it("verifies a presented credential and rejects a malformed one", async () => {
    expect((await req("POST", "/v1/credentials/verify", { chainId: 1, message: {}, signature: "0x" })).status).toBe(400);
    expect((await req("GET", `/v1/credentials/0x${"00".repeat(32)}/verify`)).status).toBe(404);
  });

  it("health lists the providers in fallback order without secrets", async () => {
    const r = await json(await req("GET", "/v1/health"));
    const providers = r.providers as { order: string[]; list: { name: string; configured: boolean }[] };
    expect(providers.order[0]).toBe("dashscope");
    expect(providers.order[providers.order.length - 1]).toBe("rules");
    expect(providers.list.map((p) => p.name)).toEqual(["dashscope", "openrouter", "llama-server", "rules"]);
    expect(JSON.stringify(r)).not.toMatch(/sk-(ws|or)-/);
    expect((r.models as { intent: { model: string } }).intent.model).toBe("deterministic rule parser");
  });
});

describe("credential routes (receipt log only)", () => {
  it("issues, lists and verifies over HTTP", async () => {
    const st = seedNadia();
    const rent = (st.mandate as Mandate).payees.find((p) => p.category === "rent")!;
    expect((await req("POST", "/v1/principals/nadia/credentials/payment-reliability", {}, OP)).status).toBe(400);
    recordReceipt({
      principal: "nadia",
      ledger: "anvil",
      agentId: st.agentId,
      mandateHash: st.mandateHash!,
      delegationHash: st.delegationHash!,
      tier: "T1",
      outcome: "confirmed",
      txHash: `0x${"cd".repeat(32)}`,
      documents: {},
      explanation: { text: "rent", aiGenerated: false },
      aigc: { model: "m", provider: "local" },
      payment: { symbol: "tHKD", decimals: 6, amount: "9500000000", payeeLabel: rent.label, payee: rent.address, method: "transfer" },
    });
    const issued = await json(await req("POST", "/v1/principals/nadia/credentials/payment-reliability", {}, OP));
    const cred = issued.credential as { id: Hex; signature: Hex; typedData: { domain: { chainId: number }; message: Record<string, unknown> }; label: string };
    expect((issued.verification as { valid: boolean }).valid).toBe(true);
    expect(cred.label).toMatch(/not a credit score/);
    expect(cred.typedData.message.onTimePayments).toBe(1);
    const list = (await json(await req("GET", "/v1/principals/nadia/credentials"))) as unknown as { id: string }[];
    expect(list.map((x) => x.id)).toEqual([cred.id]);
    expect((await json(await req("GET", `/v1/credentials/${cred.id}/verify`))).valid).toBe(true);
    const presented = await json(await req("POST", "/v1/credentials/verify", { chainId: cred.typedData.domain.chainId, message: cred.typedData.message, signature: cred.signature }));
    expect(presented).toMatchObject({ valid: true, credentialHash: cred.id });
    const forged = await json(await req("POST", "/v1/credentials/verify", { chainId: cred.typedData.domain.chainId, message: { ...cred.typedData.message, onTimePayments: 9 }, signature: cred.signature }));
    expect(forged.valid).toBe(false);
  });
});

// ---------------------------------------------------------------- against the local anvil ledger (read-mostly)
const ready = await anvilReady();
describe.skipIf(!ready)("chain-reading routes on the local anvil deployment", () => {
  const rpc = process.env.ANVIL_RPC_URL!;
  const pub = createPublicClient({ transport: http(rpc) });
  const payer = newAccount();
  let escrowIds: number[] = [];

  beforeAll(async () => {
    const st = seedNadia(payer.address);
    seedLotusSz();
    seedLotusHk();
    const m = st.mandate as Mandate;
    const tHKD = deployment.contracts.TestHKD.address;
    const pp = deployment.contracts.ProtectedPayment.address;
    const bursar = m.payees.find((p) => p.id === "hbu_bursar")!.address as Address;
    // Test units for a fresh throwaway payer: impersonate the test token's minter on anvil only.
    const minter = (await pub.readContract({ address: tHKD, abi: abi.TestUnitsAbi, functionName: "minter" })) as Address;
    await pub.request({ method: "anvil_impersonateAccount" as never, params: [minter] as never });
    await pub.request({ method: "anvil_setBalance" as never, params: [minter, "0xde0b6b3a7640000"] as never });
    await pub.request({ method: "anvil_setBalance" as never, params: [payer.address, "0xde0b6b3a7640000"] as never });
    const asMinter = createWalletClient({ account: minter, transport: http(rpc) });
    const chain = { id: await pub.getChainId(), name: "anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
    await pub.waitForTransactionReceipt({ hash: await asMinter.writeContract({ chain, address: tHKD, abi: abi.TestUnitsAbi, functionName: "mint", args: [payer.address, 10_000_000_000n] }) });
    await pub.request({ method: "anvil_stopImpersonatingAccount" as never, params: [minter] as never });
    const w = createWalletClient({ account: privateKeyToAccount(payer.privateKey), transport: http(rpc) });
    const before = Number(await pub.readContract({ address: pp, abi: abi.ProtectedPaymentAbi, functionName: "escrowCount" }));
    const now = (await pub.getBlock()).timestamp;
    for (const refundAfter of [now + 86_400n, 1n]) {
      const data = encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint64" }],
        [bursar, keccak256(stringToBytes("condition:hbu_bursar:enrolment")), roles["issuer-hbu"]!.address, refundAfter],
      );
      await pub.waitForTransactionReceipt({ hash: await w.writeContract({ chain, address: tHKD, abi: abi.TestUnitsAbi, functionName: "transferAndCall", args: [pp, 2_500_000_000n, data] }) });
    }
    escrowIds = [before, before + 1];
  }, 120_000);

  it("lists the principal's escrows and the coverage gap", async () => {
    const r = await json(await req("GET", "/v1/principals/nadia/escrows"));
    const list = r.escrows as { escrowId: number; state: string; canRelease: boolean; canRefundNow: boolean; amount: string }[];
    expect(list.map((e) => e.escrowId)).toEqual(escrowIds);
    expect(list[0]).toMatchObject({ state: "held", canRelease: true, canRefundNow: false, amount: "2500000000" });
    expect(list[1]!.canRefundNow).toBe(true);
    const cov = await json(await req("GET", "/v1/principals/nadia/coverage"));
    expect((cov.obligations as { payeeId: string; protection: string }[]).find((o) => o.payeeId === "hbu_bursar")!.protection).toBe("escrow-protected");
    expect(cov.gaps).toContain("medical cover: none on record");
  });

  it("refund before the refund time is refused; the attester releases; an expired escrow is refunded", async () => {
    const early = await req("POST", `/v1/principals/nadia/escrows/${escrowIds[0]}/refund`, {}, OP);
    expect(early.status).toBe(400);
    expect((await json(early)).error).toMatch(/too early/);
    const rel = await json(await req("POST", `/v1/principals/nadia/escrows/${escrowIds[0]}/release`, { evidence: "enrolment confirmed (fictional)" }, OP));
    expect(rel.escrow).toMatchObject({ state: "released" });
    expect(rel.receipt).toMatchObject({ outcome: "confirmed", tier: "T3", payment: { method: "release", payeeLabel: "HBU Bursar" } });
    expect((await req("POST", `/v1/principals/nadia/escrows/${escrowIds[0]}/release`, {}, OP)).status).toBe(400);
    const ref = await json(await req("POST", `/v1/principals/nadia/escrows/${escrowIds[1]}/refund`, {}, OP));
    expect(ref.escrow).toMatchObject({ state: "refunded" });
    expect(ref.receipt).toMatchObject({ outcome: "confirmed", payment: { method: "refund" } });
    const bal = (await pub.readContract({ address: deployment.contracts.TestHKD.address, abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [payer.address] })) as bigint;
    expect(bal).toBe(10_000_000_000n - 2_500_000_000n);
    expect((await req("POST", "/v1/principals/nadia/escrows/999999/release", {}, OP)).status).toBe(404);
  });

  it("insights read the enforced budget counters and explain with the template when no model answers", async () => {
    const r = await json(await req("GET", "/v1/principals/nadia/insights"));
    const cats = r.categories as { category: string; cap: string; spent: string; remaining: string }[];
    expect(cats.find((c) => c.category === "food")).toMatchObject({ cap: "3000000000", spent: "0", remaining: "3000000000" });
    expect(r.period).toMatchObject({ timeCompressed: true, lengthSeconds: 86400 });
    expect(r.explanation).toMatchObject({ aiGenerated: false, model: "none (template)" });
    expect(String(r.label)).toMatch(/not advice/);
  });

  it("forecasts 30 days of cash on the coin-free rail and the token rail", async () => {
    const sz = await json(await req("GET", "/v1/principals/lotus-sz/forecast?days=30"));
    expect(sz).toMatchObject({ symbol: "CNY", decimals: 2, horizonDays: 30, rail: "coin-free instructions (e-CNY-style simulator)" });
    expect((sz.daily as unknown[]).length).toBe(31);
    expect((sz.events as { kind: string }[]).some((e) => e.kind === "payroll")).toBe(true);
    expect(sz.velocity).toMatchObject({ maxCount: 6 });
    expect(sz.explanation).toMatchObject({ aiGenerated: false });
    const hk = await json(await req("GET", "/v1/principals/lotus-hk/forecast?days=7&explain=1"));
    expect(hk).toMatchObject({ symbol: "tHKD", horizonDays: 7, rail: "test token" });
    expect((await req("GET", "/v1/principals/lotus-hk/forecast?days=500")).status).toBe(400);
  });

  it("a sweep proposal carries the suitability card from the on-chain ProductRegistry", async () => {
    const risky = await json(await req("POST", "/v1/principals/lotus-hk/ask", { text: "Sweep 10,000 HKD into the Test Growth Fund" }));
    expect(risky.suitability).toMatchObject({ verdict: "unsuitable", riskClass: 5, mandateMaxRiskClass: 2, product: { id: "test_growth", nameMatchesRegistry: true } });
    expect(risky.tier).toBe("T4");
    const ok = await json(await req("POST", "/v1/principals/lotus-hk/ask", { text: "Sweep 10,000 HKD into the Test Money Market Fund" }));
    expect(ok.suitability).toMatchObject({ verdict: "suitable", riskClass: 2, riskLabel: "low" });
    const pay = await json(await req("POST", "/v1/principals/lotus-hk/ask", { text: "Pay Kowloon Forwarders 1,000 HKD for freight" }));
    expect(pay.suitability).toBeUndefined();
  }, 60_000);

  it("payroll is refused for a principal without a payroll payee", async () => {
    const r = await req("POST", "/v1/principals/lotus-hk/payroll", { amount: "100" }, OP);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/no payroll payee/);
  });
});
