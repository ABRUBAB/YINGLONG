import { resolve } from "node:path";
import { hashTypedData, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { receiptDomain, receiptHash, type LedgerName } from "@yinglong/sdk";
import { rolePrivateKey } from "@yinglong/sdk/server";
import type { Mandate } from "@yinglong/mandate";
import { ledgerContext } from "./chain/ledger";
import { recordReceipt, receiptLog, type ReceiptRecord } from "./receipts";
import { DATA_DIR, DocStore } from "./store";
import { stateOf, type PrincipalId } from "./world";

/**
 * Credit building (Nadia): a payment-reliability credential. After confirmed, on-time rent payments, the
 * fictional Harbour Digital Bank (issuer role key) signs an EIP-712 statement {subject DID, count of on-time
 * payments, period, receipt ids, issuedAt}. Its hash is committed in an accountability receipt (plan document),
 * so the indexer anchors it in the same Merkle batches as the payments it cites. Deterministic rule only:
 * no model is involved in deciding what counts as on time.
 */
export const CREDENTIAL_STATEMENT = "test credential issued by a fictional bank; not a credit score";
export const ISSUER_ROLE = "issuer-harbour-digital-bank" as const;
export const ISSUER_LABEL = "Harbour Digital Bank (fictional)";

export const CREDENTIAL_TYPES = {
  PaymentReliability: [
    { name: "subject", type: "string" },
    { name: "onTimePayments", type: "uint32" },
    { name: "periodStart", type: "uint64" },
    { name: "periodEnd", type: "uint64" },
    { name: "receiptIds", type: "bytes32[]" },
    { name: "issuedAt", type: "uint64" },
    { name: "statement", type: "string" },
  ],
} as const;

export interface CredentialMessage {
  subject: string;
  onTimePayments: number;
  periodStart: bigint;
  periodEnd: bigint;
  receiptIds: Hex[];
  issuedAt: bigint;
  statement: string;
}

export function credentialDomain(chainId: number) {
  return { name: "YINGLONG Payment Reliability", version: "1", chainId } as const;
}

export interface RentRow {
  receiptId: Hex;
  at: bigint;
  amount: bigint;
}

/**
 * The rule. Rent is due at the start of each budget period of the rent category ("on the 1st"); a period counts
 * as on time when confirmed payments to the rent payee inside the due window (the first five days of the period,
 * or the whole period if it is shorter, as under demo time compression) add up to at least the sealed rent
 * amount. At most one on-time count per period.
 */
export function onTimeRent(rows: RentRow[], rule: { periodStart: bigint; periodLength: bigint; expected: bigint; dueWithin?: bigint }) {
  const due = rule.dueWithin ?? (rule.periodLength < 5n * 86_400n ? rule.periodLength : 5n * 86_400n);
  const byPeriod = new Map<bigint, RentRow[]>();
  for (const r of rows) {
    if (r.at < rule.periodStart) continue;
    const k = (r.at - rule.periodStart) / rule.periodLength;
    const start = rule.periodStart + k * rule.periodLength;
    if (r.at - start >= due) continue;
    byPeriod.set(k, [...(byPeriod.get(k) ?? []), r]);
  }
  const periods = [...byPeriod.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, rs]) => ({ index: k, start: rule.periodStart + k * rule.periodLength, end: rule.periodStart + (k + 1n) * rule.periodLength, total: rs.reduce((s, r) => s + r.amount, 0n), receipts: rs.map((r) => r.receiptId) }))
    .filter((p) => p.total >= rule.expected);
  return {
    onTime: periods.length,
    periodStart: periods[0]?.start,
    periodEnd: periods[periods.length - 1]?.end,
    receiptIds: periods.flatMap((p) => p.receipts),
    periods,
    dueWithinSeconds: due,
  };
}

export interface CredentialRecord {
  id: Hex; // EIP-712 hash of the credential
  principal: string;
  ledger: LedgerName;
  issuer: Address;
  issuerLabel: string;
  typedData: { domain: ReturnType<typeof credentialDomain>; types: typeof CREDENTIAL_TYPES; primaryType: "PaymentReliability"; message: CredentialMessage };
  signature: Hex;
  anchorReceiptId: Hex;
  rule: string;
  label: string;
  issuedAt: string;
}

export const credentialStore = new DocStore<{ credentials: Record<string, CredentialRecord> }>(resolve(DATA_DIR, "credentials.json"), { credentials: {} });

function rentRule(m: Mandate) {
  const payee = m.payees.find((p) => p.category === "rent");
  if (!payee) return undefined;
  for (const b of m.budgets) {
    const cap = b.caps.find((c) => c.category === "rent");
    if (cap) {
      const asset = m.assets.find((a) => a.symbol === b.asset)!;
      return { payee, symbol: asset.symbol, decimals: asset.decimals, expected: BigInt(cap.amount), periodStart: BigInt(b.periodStart), periodLength: BigInt(b.periodLength) };
    }
  }
  return undefined;
}

function rentRows(id: string, ledger: string, payee: string, symbol: string, rows: ReceiptRecord[]): RentRow[] {
  return rows
    .filter((r) => r.principal === id && r.ledger === ledger && r.receipt.outcome === "confirmed" && r.payment?.method === "transfer" && r.payment.symbol === symbol && r.payment.payee.toLowerCase() === payee.toLowerCase())
    .map((r) => ({ receiptId: r.receipt.receiptId, at: r.receipt.timestamp, amount: BigInt(r.payment!.amount) }));
}

export const RULE_TEXT =
  "A budget period counts as on time when confirmed rent payments to the sealed rent payee within the first five days of the period (the whole period when it is shorter) reach the sealed rent amount.";

export async function issuePaymentReliability(id: PrincipalId): Promise<CredentialRecord & { reused: boolean }> {
  const st = stateOf(id);
  const m = st.mandate as Mandate;
  const rule = rentRule(m);
  if (!rule) throw new Error("this principal's mandate has no rent payee and rent budget");
  const all = receiptLog.all();
  const res = onTimeRent(rentRows(id, st.ledger, rule.payee.address, rule.symbol, all), rule);
  if (res.onTime === 0) throw new Error("no on-time rent payments on record yet (confirmed receipts to the rent payee within the due window)");
  const existing = Object.values(credentialStore.get().credentials).find((c) => c.principal === id && c.typedData.message.receiptIds.join() === res.receiptIds.join());
  if (existing) return { ...existing, reused: true };

  const ctx = ledgerContext(st.ledger);
  const issuer = privateKeyToAccount(rolePrivateKey(ISSUER_ROLE));
  const message: CredentialMessage = {
    subject: st.did,
    onTimePayments: res.onTime,
    periodStart: res.periodStart!,
    periodEnd: res.periodEnd!,
    receiptIds: res.receiptIds,
    issuedAt: BigInt(Math.floor(Date.now() / 1000)),
    statement: CREDENTIAL_STATEMENT,
  };
  const typedData = { domain: credentialDomain(ctx.profile.chainId), types: CREDENTIAL_TYPES, primaryType: "PaymentReliability" as const, message };
  const signature = await issuer.signTypedData(typedData);
  const hash = hashTypedData(typedData);
  const rec = recordReceipt({
    principal: id,
    ledger: st.ledger,
    agentId: st.agentId,
    mandateHash: st.mandateHash!,
    delegationHash: st.delegationHash!,
    tier: "T0",
    outcome: "confirmed",
    documents: {
      plan: { action: "issue payment-reliability credential", credentialHash: hash, issuer: issuer.address, issuerLabel: ISSUER_LABEL, subject: st.did, onTimePayments: res.onTime, receiptIds: res.receiptIds, rule: RULE_TEXT },
      stateReads: { periods: res.periods.map((p) => ({ start: p.start.toString(), end: p.end.toString(), total: p.total.toString(), receipts: p.receipts })) },
    },
    explanation: {
      text: `${ISSUER_LABEL} signed a payment-reliability credential: ${res.onTime} on-time rent period(s) to ${rule.payee.label}. Test credential issued by a fictional bank; not a credit score.`,
      aiGenerated: false,
    },
    aigc: { model: "none (deterministic credential rule)", provider: "local" },
  });
  const record: CredentialRecord = {
    id: hash,
    principal: id,
    ledger: st.ledger,
    issuer: issuer.address,
    issuerLabel: ISSUER_LABEL,
    typedData,
    signature,
    anchorReceiptId: rec.receipt.receiptId,
    rule: RULE_TEXT,
    label: CREDENTIAL_STATEMENT,
    issuedAt: new Date(Number(message.issuedAt) * 1000).toISOString(),
  };
  credentialStore.update((d) => {
    d.credentials[hash] = record;
  });
  return { ...record, reused: false };
}

export function credentialsOf(id: string): CredentialRecord[] {
  return Object.values(credentialStore.get().credentials).filter((c) => c.principal === id);
}

const asBig = (v: unknown) => (typeof v === "bigint" ? v : BigInt(v as string | number));

/** Normalise a credential message received as JSON (numbers as strings) into typed values. */
export function parseMessage(m: Record<string, unknown>): CredentialMessage {
  return {
    subject: String(m.subject),
    onTimePayments: Number(m.onTimePayments),
    periodStart: asBig(m.periodStart),
    periodEnd: asBig(m.periodEnd),
    receiptIds: (m.receiptIds as Hex[]).map((x) => x.toLowerCase() as Hex),
    issuedAt: asBig(m.issuedAt),
    statement: String(m.statement),
  };
}

/**
 * Verify a credential: the signature recovers to the issuer role address (a trusted issuer of the subject's
 * mandate), every cited receipt exists in the receipt log with its hash intact, is confirmed, belongs to the
 * subject and pays the rent payee, and the anchoring receipt commits this credential's hash.
 */
export async function verifyCredential(input: { chainId: number; message: CredentialMessage; signature: Hex }, rows: ReceiptRecord[] = receiptLog.all()) {
  const typedData = { domain: credentialDomain(input.chainId), types: CREDENTIAL_TYPES, primaryType: "PaymentReliability" as const, message: input.message };
  const hash = hashTypedData(typedData);
  let recovered: Address | undefined;
  try {
    recovered = await recoverTypedDataAddress({ ...typedData, signature: input.signature });
  } catch {
    recovered = undefined;
  }
  let expectedIssuer: Address | undefined;
  try {
    expectedIssuer = privateKeyToAccount(rolePrivateKey(ISSUER_ROLE)).address;
  } catch {
    expectedIssuer = undefined;
  }
  const signatureValid = !!recovered && !!expectedIssuer && recovered.toLowerCase() === expectedIssuer.toLowerCase();
  const stored = credentialStore.get().credentials[hash];
  const principal = stored?.principal ?? Object.entries(stateIndex()).find(([, did]) => did === input.message.subject)?.[0];
  let rentPayee: string | undefined;
  let trustedIssuer = false;
  if (principal) {
    try {
      const m = stateOf(principal as PrincipalId).mandate as Mandate;
      rentPayee = m.payees.find((p) => p.category === "rent")?.address.toLowerCase();
      trustedIssuer = !!expectedIssuer && m.trustedIssuers.some((t) => t.address.toLowerCase() === expectedIssuer!.toLowerCase());
    } catch {
      /* unknown principal */
    }
  }
  const receipts = input.message.receiptIds.map((rid) => {
    const r = rows.find((x) => x.receipt.receiptId.toLowerCase() === rid.toLowerCase());
    if (!r) return { receiptId: rid, found: false, ok: false };
    let intact = false;
    try {
      const ctx = ledgerContext(r.ledger);
      intact = receiptHash(r.receipt, receiptDomain(ctx.addr("AccountabilityLedger"), ctx.profile.chainId, ctx.deployment.domainSalt)).toLowerCase() === r.receiptHash.toLowerCase();
    } catch {
      intact = false;
    }
    const confirmed = r.receipt.outcome === "confirmed";
    const toRent = !!rentPayee && r.payment?.payee.toLowerCase() === rentPayee;
    const ownReceipt = !!principal && r.principal === principal;
    return { receiptId: rid, found: true, intact, confirmed, toRentPayee: toRent, ownReceipt, txHash: r.receipt.txHash, ledger: r.ledger, ok: intact && confirmed && toRent && ownReceipt };
  });
  const anchor = stored ? rows.find((x) => x.receipt.receiptId === stored.anchorReceiptId) : undefined;
  const anchorCommits = !!anchor && (anchor.documents.plan as { credentialHash?: string } | undefined)?.credentialHash?.toLowerCase() === hash.toLowerCase();
  const countOk = input.message.onTimePayments > 0 && input.message.receiptIds.length >= input.message.onTimePayments;
  return {
    credentialHash: hash,
    valid: signatureValid && trustedIssuer && countOk && receipts.length > 0 && receipts.every((r) => r.ok),
    signatureValid,
    recovered,
    issuer: expectedIssuer,
    issuerLabel: ISSUER_LABEL,
    trustedIssuer,
    receipts,
    anchorReceiptId: stored?.anchorReceiptId,
    anchorCommitsCredential: anchorCommits,
    label: CREDENTIAL_STATEMENT,
  };
}

function stateIndex(): Record<string, string> {
  // principal id -> DID, for credentials presented without a stored copy.
  const out: Record<string, string> = {};
  for (const id of ["nadia", "lotus-sz", "lotus-hk", "guest"] as PrincipalId[]) {
    try {
      out[id] = stateOf(id).did;
    } catch {
      /* not onboarded */
    }
  }
  return out;
}
