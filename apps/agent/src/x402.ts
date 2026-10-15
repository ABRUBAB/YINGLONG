import type { Address, Hex } from "viem";
import { encodePermissionContext, type Delegation, type Mandate } from "@yinglong/mandate";
import { ledgerContext } from "./chain/ledger";
import { recordReceipt } from "./receipts";
import { evaluatePolicy } from "./scales/policy";
import { checkCounterparty } from "./scales/counterparty";
import type { PrincipalState } from "./world";
import { config } from "./world";

/**
 * x402 v2 client, "exact" scheme with the "erc7710" asset-transfer method, seller-settled: on a 402 the agent
 * checks the fee against the user's mandate (policy mirror + counterparty), asks the isolated signer for a
 * single-use, exact-amount child delegation agent -> seller, and retries with the PAYMENT-SIGNATURE header.
 * The seller redeems the child chain itself and only then delivers. The 402 description and memo are untrusted
 * input: they are never read into any prompt.
 */
const SERVICES = () => process.env.SERVICES_URL ?? "http://127.0.0.1:8790";
const SIGNER = () => process.env.SIGNER_URL ?? "http://127.0.0.1:8788";

interface Accept {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { redeemer?: string; assetTransferMethod?: string; [k: string]: unknown };
}

const b64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

export interface X402Result {
  ok: boolean;
  status: number;
  body?: Record<string, unknown>;
  fee?: { asset: Address; amount: bigint; payTo: Address };
  settlementTx?: Hex;
  refusal?: string;
  receiptId?: Hex;
}

export async function payOverX402(st: PrincipalState, path: string, opts: { label: string }): Promise<X402Result> {
  const ctx = ledgerContext(st.ledger);
  const url = `${SERVICES()}${path}`;
  const first = await fetch(url);
  if (first.status !== 402) return { ok: first.ok, status: first.status, body: (await first.json().catch(() => ({}))) as Record<string, unknown> };
  const header = first.headers.get("PAYMENT-REQUIRED");
  if (!header) return { ok: false, status: 402, refusal: "402 without a PAYMENT-REQUIRED header" };
  const challenge = b64(header) as { accepts: Accept[] };
  const acc = challenge.accepts.find((a) => a.scheme === "exact" && a.extra?.assetTransferMethod === "erc7710");
  if (!acc) return { ok: false, status: 402, refusal: "no exact/erc7710 payment option offered" };
  const asset = acc.asset as Address;
  const payTo = acc.payTo as Address;
  const amount = BigInt(acc.amount);
  const redeemer = (acc.extra?.redeemer ?? acc.payTo) as Address;
  const m = st.mandate as Mandate;

  // Deterministic checks before anything is signed: the fee is a payment like any other.
  const policy = await evaluatePolicy({
    ctx,
    mandate: m,
    delegation: st.delegation!,
    mandateHash: st.mandateHash!,
    account: st.account,
    agent: st.agentWallet,
    payment: { asset, recipient: payTo, beneficiary: payTo, amount, method: "transfer" },
  });
  const cp = await checkCounterparty(ctx, st.account, payTo, m.trustedIssuers.map((x) => x.address as Address), m.payees.map((p) => p.address as Address));
  const facilitatorOk = !!m.facilitator && m.facilitator.toLowerCase() === redeemer.toLowerCase();
  const refusal =
    policy.tier !== "T1"
      ? `fee refused by the mandate (${policy.refusals[0]?.typedError ?? policy.tier})`
      : cp.verdict !== "attested-agent" && cp.verdict !== "verified-payee"
        ? `seller is ${cp.verdict}`
        : !facilitatorOk
          ? "the seller is not the facilitator pinned in the mandate"
          : undefined;
  if (refusal) {
    recordReceipt({
      principal: st.id,
      ledger: st.ledger,
      agentId: st.agentId,
      mandateHash: st.mandateHash!,
      delegationHash: st.delegationHash!,
      tier: "T4",
      outcome: "rejected_policy",
      documents: { plan: { x402: path }, policy: { refusals: policy.refusals }, counterparty: cp },
      explanation: { text: `Did not pay the ${opts.label} fee: ${refusal}.`, aiGenerated: false },
      aigc: { model: "none (deterministic x402 client)", provider: "local" },
    });
    return { ok: false, status: 402, refusal, fee: { asset, amount, payTo } };
  }

  const signed = (await (
    await fetch(`${SIGNER()}/v1/sign-x402-child`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ledger: st.ledger,
        agentRole: config(st.id).agentRole,
        parentHash: st.delegationHash,
        seller: redeemer,
        asset,
        amount: amount.toString(),
        windowSeconds: Math.min(acc.maxTimeoutSeconds || 300, 300),
      }),
    })
  ).json()) as { ok: boolean; child?: Delegation & { salt: string }; reason?: string };
  if (!signed.ok || !signed.child) return { ok: false, status: 402, refusal: `signer refused: ${signed.reason}` };
  const child: Delegation = { ...signed.child, salt: BigInt(signed.child.salt) };
  const permissionContext = encodePermissionContext([child, st.delegation!]);
  const payload = { x402Version: 2, accepted: acc, payload: { delegationManager: ctx.addr("DelegationManager"), permissionContext, delegator: st.account } };
  const paid = await fetch(url, { headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload), "utf8").toString("base64") } });
  const body = (await paid.json().catch(() => ({}))) as Record<string, unknown>;
  const settlementTx = (paid.headers.get("X-Settlement-Tx") ?? undefined) as Hex | undefined;
  const rec = recordReceipt({
    principal: st.id,
    ledger: st.ledger,
    agentId: st.agentId,
    mandateHash: st.mandateHash!,
    delegationHash: st.delegationHash!,
    tier: "T1",
    outcome: paid.ok && settlementTx ? "confirmed" : "reverted",
    txHash: settlementTx,
    documents: { plan: { x402: path, seller: redeemer }, policy: { tier: policy.tier }, counterparty: cp },
    explanation: { text: `Paid the ${opts.label} fee over x402 (ERC-7710, single-use child delegation, settled by the seller).`, aiGenerated: false },
    aigc: { model: "none (deterministic x402 client)", provider: "local" },
    payment: { symbol: m.assets.find((a) => a.address.toLowerCase() === asset.toLowerCase())?.symbol ?? "fee", decimals: 6, amount: amount.toString(), payeeLabel: opts.label, payee: payTo, method: "x402/erc7710" },
  });
  return { ok: paid.ok, status: paid.status, body, fee: { asset, amount, payTo }, settlementTx, receiptId: rec.receipt.receiptId };
}
