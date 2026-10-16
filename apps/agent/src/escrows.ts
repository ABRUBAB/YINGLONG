import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi, type DecodedRevert } from "@yinglong/sdk";
import { roleAddress, type Role } from "@yinglong/sdk/server";
import { formatUnits, type Mandate } from "@yinglong/mandate";
import { ledgerContext, RevertError } from "./chain/ledger";
import { recordReceipt, receiptLog, type ReceiptRecord } from "./receipts";
import { stateOf, type PrincipalId, config } from "./world";

/**
 * Protected prepayment claims (ProtectedPayment, used as deployed): an escrow is released to the payee only by
 * its named release attester (here the fictional HBU confirming enrolment, signing with the issuer-hbu role key),
 * or refunded to the payer by anyone once its refund time has passed. The agent cannot move escrowed funds at
 * all; these routes only ask the attester or the relayer to call the contract and record a receipt.
 */
export const ESCROW_STATES = ["none", "held", "released", "refunded"] as const;
export type EscrowState = (typeof ESCROW_STATES)[number];

/** Attester role keys this service holds (fictional institutions, testnet keys). */
const ATTESTER_ROLES: { role: Role; label: string }[] = [
  { role: "issuer-hbu", label: "Harbour Bay University (fictional)" },
  { role: "issuer-harbour-digital-bank", label: "Harbour Digital Bank (fictional)" },
];

export interface EscrowView {
  escrowId: number;
  ledger: string;
  payer: Address;
  payee: { address: Address; id?: string; label: string };
  token: { address: Address; symbol: string; decimals: number };
  amount: bigint;
  conditionId: Hex;
  releaseAttester: { address: Address; label: string; heldByService: boolean };
  createdAt: string;
  refundAfter: string;
  state: EscrowState;
  canRelease: boolean;
  canRefundNow: boolean;
  fundingReceiptId?: Hex;
}

interface RawEscrow {
  payer: Address;
  payee: Address;
  token: Address;
  releaseAttester: Address;
  amount: bigint;
  conditionId: Hex;
  createdAt: bigint;
  refundAfter: bigint;
  state: number;
}

function attesterRole(addr: Address): { role: Role; label: string } | undefined {
  return ATTESTER_ROLES.find((a) => {
    try {
      return roleAddress(a.role).toLowerCase() === addr.toLowerCase();
    } catch {
      return false;
    }
  });
}

export function viewEscrow(id: number, e: RawEscrow, m: Mandate, now: bigint, ledger: string, receipts: ReceiptRecord[], principal: string): EscrowView {
  const payee = m.payees.find((p) => p.address.toLowerCase() === e.payee.toLowerCase());
  const asset = m.assets.find((a) => a.address.toLowerCase() === e.token.toLowerCase());
  const att = attesterRole(e.releaseAttester);
  const state = ESCROW_STATES[e.state] ?? "none";
  const funding = receipts.find(
    (r) =>
      r.principal === principal &&
      r.receipt.outcome === "confirmed" &&
      r.payment?.method === "transferAndCall" &&
      r.payment.payee.toLowerCase() === e.payee.toLowerCase() &&
      BigInt(r.payment.amount) === e.amount &&
      r.receipt.timestamp <= e.createdAt + 600n &&
      r.receipt.timestamp + 600n >= e.createdAt,
  );
  return {
    escrowId: id,
    ledger,
    payer: e.payer,
    payee: { address: e.payee, id: payee?.id, label: payee?.label ?? "unknown payee" },
    token: { address: e.token, symbol: asset?.symbol ?? "?", decimals: asset?.decimals ?? 6 },
    amount: e.amount,
    conditionId: e.conditionId,
    releaseAttester: { address: e.releaseAttester, label: att?.label ?? "unknown attester", heldByService: !!att },
    createdAt: new Date(Number(e.createdAt) * 1000).toISOString(),
    refundAfter: new Date(Number(e.refundAfter) * 1000).toISOString(),
    state,
    canRelease: state === "held" && !!att,
    canRefundNow: state === "held" && now >= e.refundAfter,
    fundingReceiptId: funding?.receipt.receiptId,
  };
}

/** Every ProtectedPayment escrow funded by this principal's account. */
export async function listEscrows(id: PrincipalId): Promise<{ escrows: EscrowView[]; block: bigint; contract: Address }> {
  const st = stateOf(id);
  const ctx = ledgerContext(st.ledger);
  const pp = ctx.addr("ProtectedPayment");
  const block = await ctx.pub.getBlock();
  const n = Number(await ctx.read<bigint>({ address: pp, abi: abi.ProtectedPaymentAbi, functionName: "escrowCount" }));
  const raws: RawEscrow[] = [];
  for (let i = 0; i < n; i += 25) {
    const ids = Array.from({ length: Math.min(25, n - i) }, (_, k) => i + k);
    raws.push(...(await Promise.all(ids.map((j) => ctx.read<RawEscrow>({ address: pp, abi: abi.ProtectedPaymentAbi, functionName: "escrowOf", args: [BigInt(j)] })))));
  }
  const receipts = receiptLog.all();
  const m = st.mandate as Mandate;
  const escrows = raws
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.payer.toLowerCase() === st.account.toLowerCase())
    .map(({ e, i }) => viewEscrow(i, e, m, block.timestamp, st.ledger, receipts, id));
  return { escrows, block: block.number, contract: pp };
}

async function readEscrow(id: PrincipalId, escrowId: number) {
  const st = stateOf(id);
  const ctx = ledgerContext(st.ledger);
  const pp = ctx.addr("ProtectedPayment");
  const n = await ctx.read<bigint>({ address: pp, abi: abi.ProtectedPaymentAbi, functionName: "escrowCount" });
  if (!Number.isSafeInteger(escrowId) || escrowId < 0 || BigInt(escrowId) >= n) throw new NotFound("unknown escrow");
  const e = await ctx.read<RawEscrow>({ address: pp, abi: abi.ProtectedPaymentAbi, functionName: "escrowOf", args: [BigInt(escrowId)] });
  if (e.payer.toLowerCase() !== st.account.toLowerCase()) throw new NotFound("this escrow was not funded by this principal");
  const block = await ctx.pub.getBlock();
  return { st, ctx, pp, e, view: viewEscrow(escrowId, e, st.mandate as Mandate, block.timestamp, st.ledger, receiptLog.all(), id) };
}

export class NotFound extends Error {}

function claimReceipt(id: PrincipalId, view: EscrowView, kind: "release" | "refund", res: { ok: boolean; hash: Hex }, by: string, extra: Record<string, unknown>, revert?: DecodedRevert): ReceiptRecord {
  const st = stateOf(id);
  const amt = `${formatUnits(view.amount, view.token.decimals)} ${view.token.symbol}`;
  return recordReceipt({
    principal: id,
    ledger: st.ledger,
    agentId: st.agentId,
    mandateHash: st.mandateHash!,
    delegationHash: st.delegationHash!,
    tier: "T3",
    outcome: res.ok ? "confirmed" : "reverted",
    txHash: res.hash,
    documents: { plan: { action: `escrow ${kind}`, escrowId: view.escrowId, by, ...extra }, stateReads: { escrow: { ...view, amount: view.amount.toString() } } },
    explanation: {
      text: !res.ok
        ? `The escrow ${kind} did not take effect${revert ? `: ${revert.message}` : ""}.`
        : kind === "release"
          ? `${view.releaseAttester.label} confirmed the condition and released ${amt} from escrow ${view.escrowId} to ${view.payee.label}. The agent cannot move escrowed funds; the attester did.`
          : `Escrow ${view.escrowId} passed its refund time unreleased: ${amt} returned to the payer.`,
      aiGenerated: false,
    },
    aigc: { model: kind === "release" ? "none (attester action)" : "none (refund after expiry)", provider: "local" },
    payment: { symbol: view.token.symbol, decimals: view.token.decimals, amount: view.amount.toString(), payeeLabel: kind === "release" ? view.payee.label : `${config(id).name} (refund)`, payee: kind === "release" ? view.payee.address : view.payer, method: kind },
    revertError: revert,
  });
}

/** The release attester (a role key this service holds) calls ProtectedPayment.release with an evidence hash. */
export async function releaseEscrow(id: PrincipalId, escrowId: number, evidence?: string): Promise<{ escrow: EscrowView; receipt: ReceiptRecord }> {
  const { ctx, pp, e, view } = await readEscrow(id, escrowId);
  if (view.state !== "held") throw new Error(`escrow is ${view.state}`);
  const att = attesterRole(e.releaseAttester);
  if (!att) throw new Error("the release attester of this escrow is not a role this service holds");
  const evidenceText = evidence ?? `condition confirmed for escrow ${escrowId} (fictional attestation; test environment)`;
  const evidenceHash = keccak256(stringToBytes(evidenceText));
  await ctx.ensureGas(e.releaseAttester, 5_000_000_000_000_000n);
  let res: { ok: boolean; hash: Hex };
  try {
    res = await ctx.write(att.role, { address: pp, abi: abi.ProtectedPaymentAbi as never, functionName: "release", args: [BigInt(escrowId), evidenceHash] });
  } catch (err) {
    if (err instanceof RevertError) throw new Error(`release refused: ${err.revert.message}`);
    throw err;
  }
  const after = await readEscrow(id, escrowId);
  return { escrow: after.view, receipt: claimReceipt(id, view, "release", res, att.label, { evidenceHash, evidence: evidenceText }) };
}

/** Anyone may refund after the refund time; our relayer pays the gas. Before it, the contract's TooEarly is reported. */
export async function refundEscrow(id: PrincipalId, escrowId: number): Promise<{ escrow: EscrowView; receipt: ReceiptRecord }> {
  const { ctx, pp, view } = await readEscrow(id, escrowId);
  if (view.state !== "held") throw new Error(`escrow is ${view.state}`);
  if (!view.canRefundNow) throw new Error(`too early: refundable after ${view.refundAfter}`);
  await ctx.ensureGas(ctx.roleAddress("relayer"), 5_000_000_000_000_000n);
  let res: { ok: boolean; hash: Hex };
  try {
    res = await ctx.write("relayer", { address: pp, abi: abi.ProtectedPaymentAbi as never, functionName: "refund", args: [BigInt(escrowId)] });
  } catch (err) {
    if (err instanceof RevertError) throw new Error(`refund refused: ${err.revert.message}`);
    throw err;
  }
  const after = await readEscrow(id, escrowId);
  return { escrow: after.view, receipt: claimReceipt(id, view, "refund", res, "relayer (anyone may refund after expiry)", {}) };
}

// ---------------------------------------------------------------- coverage gap

export interface Obligation {
  payeeId: string;
  payeeLabel: string;
  category: string;
  cadence: "every period" | "one-off" | "per invoice";
  symbol: string;
  decimals: number;
  upTo: bigint;
  protection: "escrow-protected" | "settled through escrow" | "paid directly (no protection)" | "unprotected";
  escrowIds: number[];
  refundableAfter?: string;
  why: string;
}

const OBLIGATION_CATEGORIES: Record<string, Obligation["cadence"]> = { rent: "every period", tuition: "one-off", supplier: "per invoice", payroll: "every period" };

/**
 * Coverage-gap card: for each obligation the mandate names (rent, tuition, supplier, payroll payees), is it
 * protected by an escrow (funds held until the payee's condition is attested, refundable otherwise) or not?
 * Plus the cover items YINGLONG has no record of (a checklist, not advice).
 */
export function coverageCard(input: { kind: "person" | "company"; mandate: Mandate; escrows: EscrowView[]; paidDirect: Set<string> }) {
  const m = input.mandate;
  const obligations: Obligation[] = [];
  for (const p of m.payees) {
    const cadence = OBLIGATION_CATEGORIES[p.category];
    if (!cadence) continue;
    const budget = m.budgets.find((b) => b.caps.some((c) => c.category === p.category));
    const cap = budget?.caps.find((c) => c.category === p.category);
    const asset = m.assets.find((a) => a.symbol === budget?.asset) ?? m.assets[0]!;
    const mine = input.escrows.filter((e) => e.payee.address.toLowerCase() === p.address.toLowerCase());
    const held = mine.filter((e) => e.state === "held");
    const released = mine.filter((e) => e.state === "released");
    let protection: Obligation["protection"] = "unprotected";
    let why = `Payments to ${p.label} go straight to the payee: once paid, nothing holds the money if the service is not delivered.`;
    if (held.length) {
      protection = "escrow-protected";
      why = `Held in escrow until ${held[0]!.releaseAttester.label} attests the condition; refunded to you if not released by ${held[0]!.refundAfter}.`;
    } else if (released.length) {
      protection = "settled through escrow";
      why = `Paid through escrow: released to ${p.label} after ${released[0]!.releaseAttester.label} attested the condition.`;
    } else if (input.paidDirect.has(p.address.toLowerCase())) {
      protection = "paid directly (no protection)";
      why = `Paid directly to ${p.label} this period; a direct payment has no claim path.`;
    }
    obligations.push({
      payeeId: p.id,
      payeeLabel: p.label,
      category: p.category,
      cadence,
      symbol: asset.symbol,
      decimals: asset.decimals,
      upTo: BigInt(cap?.amount ?? "0"),
      protection,
      escrowIds: mine.map((e) => e.escrowId),
      refundableAfter: held[0]?.refundAfter,
      why,
    });
  }
  const coverItems =
    input.kind === "person"
      ? [{ item: "medical cover", status: "none on record", gap: true, note: "YINGLONG holds no insurance records. Universities often ask non-local students to hold medical cover; check what yours requires. A checklist item, not advice." }]
      : [{ item: "supplier prepayment protection", status: input.escrows.some((e) => e.state === "held") ? "escrow in use" : "no escrowed prepayment", gap: false, note: "Supplier prepayments can be routed through ProtectedPayment so they are refundable if not delivered." }];
  const gaps = [
    ...obligations.filter((o) => o.protection === "unprotected" || o.protection === "paid directly (no protection)").map((o) => `${o.payeeLabel} (${o.category}): ${o.protection}`),
    ...coverItems.filter((c) => c.gap).map((c) => `${c.item}: ${c.status}`),
  ];
  return {
    obligations,
    coverItems,
    gaps,
    summary: {
      protected: obligations.filter((o) => o.protection === "escrow-protected").length,
      unprotected: obligations.filter((o) => o.protection === "unprotected" || o.protection === "paid directly (no protection)").length,
      settled: obligations.filter((o) => o.protection === "settled through escrow").length,
      gaps: gaps.length,
    },
    label: "Test units and fictional institutions. Protection means the ProtectedPayment escrow as deployed; this card is a checklist, not insurance or advice.",
  };
}

export async function coverageFor(id: PrincipalId) {
  const st = stateOf(id);
  const { escrows, block } = await listEscrows(id);
  const m = st.mandate as Mandate;
  // Direct payments in the current period of each payee's budget.
  const now = BigInt(Math.floor(Date.now() / 1000));
  const paidDirect = new Set<string>();
  for (const r of receiptLog.all()) {
    if (r.principal !== id || r.receipt.outcome !== "confirmed" || !r.payment || r.payment.method === "transferAndCall" || r.payment.method === "release" || r.payment.method === "refund") continue;
    const b = m.budgets.find((x) => x.asset === r.payment!.symbol);
    const len = BigInt(b?.periodLength ?? 30 * 86400);
    const start = BigInt(b?.periodStart ?? 0) + ((now - BigInt(b?.periodStart ?? 0)) / len) * len;
    if (r.receipt.timestamp >= start) paidDirect.add(r.payment.payee.toLowerCase());
  }
  return { ...coverageCard({ kind: config(id).kind, mandate: m, escrows, paidDirect }), block, ledger: st.ledger };
}
