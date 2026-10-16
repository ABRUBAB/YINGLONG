/**
 * Agent City sample data (NEXT_PUBLIC_DATA_MODE=fixtures only, always shown with the "Sample data" chip).
 * It is shaped exactly like the live snapshot (principals, passport registry, payee books, receipts,
 * anchoring batches) so the page derives its graph the same way in both modes.
 */
import type { CityBatch, CityPrincipal, CityReceipt, CitySnapshot, Receipt } from "../view";
import { entities, nadiaMandate, PAYEES, principal, receipts, registry, treasuryViews } from "./data";
import { addr, amt, baseTx, CNYT, fiscoTx, h, minutesAgo, THKD } from "./util";

const MIRAGE = registry.find((r) => r.agentName === "Mirage")!;
const FORGED = addr("forged-hbu-account");
const ARENA = addr("arena-cafe");
const ATTACKER = addr("attacker-injection");

const nadiaPayees = Object.values(PAYEES).map((p) => ({ label: p.name, address: p.address, category: p.category }));
const lotusPayees = {
  "lotus-sz": [
    { label: "Shenzhen Components", address: addr("sz-components"), category: "supplier" },
    { label: "Staff payroll account", address: addr("sz-payroll"), category: "payroll" },
  ],
  "lotus-hk": [
    { label: "Kowloon Forwarders", address: addr("kowloon-forwarders"), category: "supplier" },
    { label: "Test Money Market Fund", address: addr("test-mmf"), category: "treasury" },
    { label: "Test Growth Fund", address: addr("test-growth"), category: "treasury" },
  ],
} as const;

function lotus(id: "lotus-sz" | "lotus-hk"): CityPrincipal {
  const e = entities.find((x) => x.id === id)!;
  const m = treasuryViews[id]!.mandate;
  const reg = registry.find((r) => r.agentId === "5310")!;
  return {
    id,
    kind: "company",
    name: e.name,
    jurisdiction: e.jurisdiction,
    ledger: e.rail.ledger,
    ledgerBadge: e.rail.ledger === "fisco" ? "FISCO BCOS (team-run consortium ledger)" : "Base Sepolia (testnet)",
    account: addr(`${id}-account`),
    signer: "2-of-3 directors",
    paused: false,
    agent: { agentId: "5310", label: "Lotus Lane treasurer", wallet: reg.wallet, identityCode: reg.identityCode, passport: "attested", issuers: reg.issuers },
    mandate: m
      ? {
          mandateHash: m.mandateHash,
          status: m.status,
          sentences:
            id === "lotus-sz"
              ? ["Pay approved suppliers by conditional instruction.", "Keep the operating reserve above 250,000.", "Board approval (2 of 3) for capital purchases."]
              : ["Pay HK suppliers in tHKD.", "Sweep idle cash into low-risk products only.", "First sweep needs a director."],
          sealedAt: m.sealedAt,
          publishTx: m.published[0] ?? null,
          explorerUrl: null,
        }
      : null,
    payees: [...lotusPayees[id]],
  };
}

function person(id: string, kind: "person" | "visitor", name: string, agentId: string, agentLabel: string, payees: CityPrincipal["payees"]): CityPrincipal {
  return {
    id,
    kind,
    name,
    jurisdiction: "hk",
    ledger: "base-sepolia",
    ledgerBadge: "Base Sepolia (testnet)",
    account: addr(`${id}-account`),
    signer: kind === "visitor" ? "passkey (WebAuthn)" : "scripted passkey (software P-256 key)",
    paused: false,
    agent: { agentId, label: agentLabel, wallet: addr(`${id}-agent`), identityCode: `YL-TEST-${agentId.padStart(4, "0")}`, passport: "attested", issuers: ["Harbour Digital Bank (fictional)"] },
    mandate: {
      mandateHash: h(`mandate:${id}`),
      status: "live",
      sentences: ["Pay Arena Cafe up to 50 tHKD a day.", "Ask me for anyone new."],
      sealedAt: minutesAgo(240),
      publishTx: baseTx(`publish:${id}`),
      explorerUrl: null,
    },
    payees,
  };
}

const principals: CityPrincipal[] = [
  {
    id: principal.id,
    kind: "person",
    name: principal.displayName,
    jurisdiction: principal.jurisdiction,
    ledger: principal.ledger,
    ledgerBadge: principal.ledgerBadge,
    account: principal.account,
    signer: principal.signer,
    paused: principal.paused,
    agent: {
      agentId: principal.agentId,
      label: principal.agentName,
      wallet: registry[0]!.wallet,
      identityCode: registry[0]!.identityCode,
      passport: "attested",
      issuers: registry[0]!.issuers,
    },
    mandate: {
      mandateHash: nadiaMandate.mandateHash,
      status: "live",
      sentences: nadiaMandate.decodedSentences.slice(0, 6),
      sealedAt: nadiaMandate.sealedAt,
      publishTx: nadiaMandate.published[0] ?? null,
      explorerUrl: null,
    },
    payees: nadiaPayees,
  },
  lotus("lotus-sz"),
  lotus("lotus-hk"),
  person("guest", "person", "Guest (Judge's Challenge)", "12", "Arena agent", [{ label: "Arena Cafe", address: ARENA, category: "food" }]),
  person("v-3f8a2c", "visitor", "Visitor 3F8A", "19", "Ying", [{ label: "Arena Cafe", address: ARENA, category: "food" }]),
  person("v-b71d04", "visitor", "Visitor B71D", "18", "Ying", [{ label: "Arena Cafe", address: ARENA, category: "food" }]),
];

const payeeAddress = new Map<string, string>([...nadiaPayees.map((p) => [p.label, p.address] as const), ["Mirage", MIRAGE.wallet], ["Unverified address", FORGED]]);

function fromReceipt(r: Receipt): CityReceipt {
  return {
    receiptId: r.receiptId,
    principal: "nadia",
    agentId: r.agentId,
    ledger: r.ledger,
    ledgerBadge: r.ledgerBadge,
    tier: r.tier,
    outcome: r.outcome,
    revertError: r.revertError,
    txHash: r.txHash,
    explorerUrl: r.explorerUrl,
    timestamp: r.timestamp,
    summary: r.summary,
    explanation: r.explanation,
    payee: r.payeeName ? { label: r.payeeName, address: (payeeAddress.get(r.payeeName) as `0x${string}` | undefined) ?? null } : null,
    amount: r.amount,
    method: r.payeeName ? "transfer" : null,
  };
}

let seq = 0;
function sample(
  p: CityPrincipal,
  minutes: number,
  payee: { label: string; address: string },
  outcome: CityReceipt["outcome"],
  value: ReturnType<typeof amt> | null,
  summary: string,
  extra: Partial<CityReceipt> = {},
): CityReceipt {
  const key = `city:${p.id}:${seq++}`;
  const fisco = p.ledger === "fisco";
  return {
    receiptId: h(`receipt:${key}`),
    principal: p.id,
    agentId: p.agent.agentId,
    ledger: p.ledger,
    ledgerBadge: p.ledgerBadge,
    tier: outcome === "confirmed" ? "T1" : outcome === "awaiting_approval" || outcome === "asked" ? "T2" : "T4",
    outcome,
    revertError: null,
    txHash: outcome === "asked" || outcome === "awaiting_approval" ? null : fisco ? fiscoTx(key).txHash : baseTx(key).txHash,
    explorerUrl: null,
    timestamp: minutesAgo(minutes),
    summary,
    explanation: summary,
    payee: { label: payee.label, address: payee.address as `0x${string}` },
    amount: value,
    method: fisco ? "instruct" : "transfer",
    ...extra,
  };
}

const [, sz, hk, guest, v1, v2] = principals as [CityPrincipal, CityPrincipal, CityPrincipal, CityPrincipal, CityPrincipal, CityPrincipal];
const szc = sz.payees[0]!;
const payroll = sz.payees[1]!;
const kf = hk.payees[0]!;
const mmf = hk.payees[1]!;
const growth = hk.payees[2]!;
const arena = { label: "Arena Cafe", address: ARENA };

const extra: CityReceipt[] = [
  sample(sz, 12, szc, "confirmed", amt("27640", CNYT), "Payment instruction to Shenzhen Components (invoice 2231)"),
  sample(sz, 18, szc, "rejected_policy", amt("49900", CNYT), "Refuse a split payment to Shenzhen Components", { revertError: "VelocityExceeded" }),
  sample(sz, 44, payroll, "confirmed", amt("412000", CNYT), "Payroll run for October"),
  sample(sz, 61, szc, "confirmed", amt("12800", CNYT), "Payment instruction to Shenzhen Components (invoice 2219)"),
  sample(hk, 9, kf, "confirmed", amt("18400", THKD), "Freight to Kowloon Forwarders"),
  sample(hk, 31, mmf, "awaiting_approval", amt("150000", THKD), "First sweep into the test money market fund (needs a director)"),
  sample(hk, 33, growth, "reverted", amt("80000", THKD), "Refuse a high-risk test product", { revertError: "UnsuitableProduct" }),
  sample(guest, 6, arena, "confirmed", amt("38", THKD), "Coffee at Arena Cafe"),
  sample(guest, 7, { label: "attacker (prompt injection)", address: ATTACKER }, "reverted", amt("5000", THKD), "Refuse a payment smuggled into a challenge prompt", {
    revertError: "PayeeNotVerified",
  }),
  sample(v1, 15, arena, "confirmed", amt("42", THKD), "Lunch at Arena Cafe"),
  sample(v2, 20, arena, "asked", amt("640", THKD), "Ask before a larger order at Arena Cafe"),
];

const feedReceipts: CityReceipt[] = [...receipts.filter((r) => r.ledger !== "anvil-bench").map(fromReceipt), ...extra].sort(
  (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
);

function batch(id: number, minutes: number, count: number): CityBatch {
  const root = h(`root:city-batch-${id}`);
  return {
    batchId: id,
    root,
    count,
    createdAt: minutesAgo(minutes),
    anchors: [
      { ledger: "base-sepolia", txHash: baseTx(`anchor:city-${id}`).txHash, blockNumber: String(31_884_000 + id * 40) },
      { ledger: "fisco", txHash: fiscoTx(`anchor:city-${id}`).txHash, blockNumber: String(1_204_000 + id * 12) },
    ],
    crossAnchors: [
      { onLedger: "fisco", remoteLedger: "base-sepolia", txHash: fiscoTx(`cross:city-${id}`).txHash },
      { onLedger: "base-sepolia", remoteLedger: "fisco", txHash: baseTx(`cross:city-${id}`).txHash },
    ],
  };
}

export const citySnapshot: CitySnapshot = {
  principals,
  agents: registry
    .filter((r) => !["4127", "5310"].includes(r.agentId))
    .map((r) => ({
      agentId: r.agentId,
      label: r.agentName,
      wallet: r.wallet,
      ledger: r.ledger,
      passport: r.status === "self-registered" ? "self-registered" : r.status === "paused" ? "halted" : r.status === "revoked" ? "revoked" : "attested",
      identityCode: r.identityCode,
      issuers: r.issuers,
      ownerName: r.ownerName === "Unknown" ? null : r.ownerName,
    })),
  ledgers: [
    { ledger: "base-sepolia", badge: "Base Sepolia (testnet)", ok: true, block: "31884610" },
    { ledger: "fisco", badge: "FISCO BCOS (team-run consortium ledger)", ok: true, block: "1204588" },
  ],
  visitorCount: 2,
  feed: { fetchedAt: minutesAgo(0), receipts: feedReceipts, batches: [batch(311, 95, 14), batch(312, 35, 9)], batchesReadable: true },
};
