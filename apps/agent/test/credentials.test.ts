import { roles } from "./helpers/env";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Mandate } from "@yinglong/mandate";
import { CREDENTIAL_STATEMENT, CREDENTIAL_TYPES, credentialDomain, credentialsOf, issuePaymentReliability, onTimeRent, verifyCredential } from "../src/credentials";
import { recordReceipt, receiptLog } from "../src/receipts";
import { seedNadia } from "./helpers/seed";

const DAY = 86_400n;
const U = (n: number) => BigInt(n) * 1_000_000n;

describe("on-time rent rule", () => {
  const rule = { periodStart: 0n, periodLength: 30n * DAY, expected: U(9_500) };
  const r = (id: string, day: bigint, amount: bigint) => ({ receiptId: id as Hex, at: day * DAY + 3600n, amount });
  it("counts at most one period, inside the first five days, when the payments reach the sealed rent", () => {
    const res = onTimeRent(
      [
        r("0x01", 30n, U(9_500)), // period 1, day 0: on time
        r("0x02", 61n, U(5_000)), // period 2, day 1 ...
        r("0x03", 63n, U(4_500)), // ... and day 3: together on time
        r("0x04", 97n, U(9_500)), // period 3, day 7: late
        r("0x05", 120n, U(9_000)), // period 4: short
      ],
      rule,
    );
    expect(res.onTime).toBe(2);
    expect(res.receiptIds).toEqual(["0x01", "0x02", "0x03"]);
    expect(res.periodStart).toBe(30n * DAY);
    expect(res.periodEnd).toBe(90n * DAY);
    expect(res.dueWithinSeconds).toBe(5n * DAY);
  });
  it("under demo time compression the whole (short) period is the due window", () => {
    expect(onTimeRent([r("0x01", 3n, U(9_500))], { ...rule, periodLength: DAY }).dueWithinSeconds).toBe(DAY);
  });
});

describe("payment-reliability credential", () => {
  afterEach(() => vi.useRealTimers());

  it("is refused without on-time rent, then issued, signed by the issuer, anchored by a receipt and verifiable", async () => {
    const st = seedNadia();
    const m = st.mandate as Mandate;
    const rent = m.payees.find((p) => p.category === "rent")!;
    await expect(issuePaymentReliability("nadia")).rejects.toThrow(/no on-time rent/);

    const pay = (amount: bigint, payee: Address, outcome: "confirmed" | "reverted" = "confirmed") =>
      recordReceipt({
        principal: "nadia",
        ledger: "anvil",
        agentId: st.agentId,
        mandateHash: st.mandateHash!,
        delegationHash: st.delegationHash!,
        tier: "T1",
        outcome,
        txHash: `0x${"ab".repeat(32)}`,
        documents: { plan: { test: true } },
        explanation: { text: "rent", aiGenerated: false },
        aigc: { model: "deterministic rule parser", provider: "local" },
        payment: { symbol: "tHKD", decimals: 6, amount: amount.toString(), payeeLabel: rent.label, payee, method: "transfer" },
      });
    // Two daily periods (demo time compression): one full rent each day; a reverted one and a food payment do not count.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T02:00:00Z"));
    const a = pay(U(9_500), rent.address as Address);
    pay(U(9_500), rent.address as Address, "reverted");
    vi.setSystemTime(new Date("2026-10-15T02:00:00Z"));
    const b = pay(U(9_500), rent.address as Address);
    pay(U(1_200), m.payees.find((p) => p.category === "food")!.address as Address);
    vi.useRealTimers();

    const cred = await issuePaymentReliability("nadia");
    expect(cred.reused).toBe(false);
    expect(cred.issuer).toBe(roles["issuer-harbour-digital-bank"]!.address);
    expect(cred.typedData.message).toMatchObject({ subject: st.did, onTimePayments: 2, statement: CREDENTIAL_STATEMENT, receiptIds: [a.receipt.receiptId, b.receipt.receiptId] });
    expect(cred.label).toBe("test credential issued by a fictional bank; not a credit score");
    const anchor = receiptLog.all().find((x) => x.receipt.receiptId === cred.anchorReceiptId)!;
    expect((anchor.documents.plan as { credentialHash: string }).credentialHash).toBe(cred.id);
    expect(anchor.aigc.model).toBe("none (deterministic credential rule)");

    const v = await verifyCredential({ chainId: cred.typedData.domain.chainId, message: cred.typedData.message, signature: cred.signature });
    expect(v).toMatchObject({ valid: true, signatureValid: true, trustedIssuer: true, anchorCommitsCredential: true });
    expect(v.receipts.every((x) => x.ok && x.intact)).toBe(true);

    // Same receipts again: the stored credential is returned, no second anchor receipt.
    const n = receiptLog.all().length;
    expect((await issuePaymentReliability("nadia")).reused).toBe(true);
    expect(receiptLog.all().length).toBe(n);
    expect(credentialsOf("nadia")).toHaveLength(1);

    // Tampering: a changed count recovers another signer; a self-issued credential is not from the issuer.
    const forged = { ...cred.typedData.message, onTimePayments: 12 };
    expect((await verifyCredential({ chainId: cred.typedData.domain.chainId, message: forged, signature: cred.signature })).signatureValid).toBe(false);
    const mallory = privateKeyToAccount(generatePrivateKey());
    const selfSig = await mallory.signTypedData({ domain: credentialDomain(cred.typedData.domain.chainId), types: CREDENTIAL_TYPES, primaryType: "PaymentReliability", message: cred.typedData.message });
    const self = await verifyCredential({ chainId: cred.typedData.domain.chainId, message: cred.typedData.message, signature: selfSig });
    expect(self).toMatchObject({ valid: false, signatureValid: false });
    expect(self.recovered).toBe(mallory.address);
    // A receipt that does not exist fails the receipt check even with the issuer's signature.
    const issuer = privateKeyToAccount(roles["issuer-harbour-digital-bank"]!.privateKey);
    const ghost = { ...cred.typedData.message, receiptIds: [`0x${"99".repeat(32)}` as Hex] , onTimePayments: 1 };
    const ghostSig = await issuer.signTypedData({ domain: credentialDomain(cred.typedData.domain.chainId), types: CREDENTIAL_TYPES, primaryType: "PaymentReliability", message: ghost });
    const g = await verifyCredential({ chainId: cred.typedData.domain.chainId, message: ghost, signature: ghostSig });
    expect(g).toMatchObject({ valid: false, signatureValid: true });
    expect(g.receipts[0]).toMatchObject({ found: false });
  });
});
