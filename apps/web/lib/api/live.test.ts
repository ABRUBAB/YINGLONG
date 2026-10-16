/**
 * Live adapter against wire payloads shaped exactly like the agent service contract
 * (docs/api/AGENT_API.md). fetch is mocked; nothing leaves the process.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256, toHex } from "viem";
import { createLiveApi } from "./live";
import * as V from "./view";
import { hashRingGeometry } from "@yinglong/ui/hash-ring";
import { typedDataDigest } from "../signing-guard";
import { cosignTypedData } from "../chain";

const H = (s: string) => keccak256(toHex(s));
const A = (s: string) => `0x${H(s).slice(26)}`;

const principal = {
  id: "nadia",
  kind: "person",
  name: "Nadia Rahman",
  account: A("acct"),
  did: "did:pkh:eip155:84532:" + A("acct"),
  ledger: "base-sepolia",
  jurisdiction: "hk",
  signer: "passkey (WebAuthn)",
  agent: { label: "Ying", wallet: A("ying"), agentId: "4127", passportStatus: "active", identityCode: "YL-TEST-0000-4127" },
  paused: false,
};
const company = { ...principal, id: "lotus-sz", kind: "company", name: "Lotus Lane Trading (Shenzhen) Co.", ledger: "fisco", jurisdiction: "mainland", signer: "2-of-3 directors", agent: { ...principal.agent, label: "Treasurer", agentId: "5310" } };

const ring = hashRingGeometry(H("delegation"));
const mandateView = {
  mandateHash: H("mandate"),
  delegationHash: H("delegation"),
  lineageId: "nadia-1",
  version: 3,
  status: "live",
  jurisdiction: "hk",
  validFrom: "2026-10-02T04:00:00Z",
  validUntil: "2027-01-31T15:59:59Z",
  publishTx: H("publish"),
  explorerUrl: "https://sepolia.basescan.org/tx/" + H("publish"),
  ledger: "base-sepolia",
  sentences: ["Spend at most 3,000.00 tHKD on food each month."],
  userSentences: ["Keep food under 3,000 a month."],
  rules: [{ enforcer: "CategoryBudgetEnforcer", kind: "category-budget", sentence: "Spend at most 3,000.00 tHKD on food each month.", params: { category: "food", cap: "3000000000", period: 2592000 } }],
  roundTrip: { ok: true, checks: [{ name: "decode", ok: true, detail: "1 of 1 sentences match" }] },
  hashRing: { ticks: ring.ticks.map((t) => ({ ...t, nibble: 0 })), arcs: ring.arcs },
  sealedBy: "passkey",
};
const state = {
  principal,
  balances: [{ symbol: "tHKD", address: A("thkd"), decimals: 6, amount: "14250000000" }],
  mandate: mandateView,
  budgets: [{ symbol: "tHKD", category: "food", cap: "3000000000", spent: "1846500000", periodLengthSeconds: 2592000, periodEndsAt: "2026-10-31T15:59:59Z" }],
  tiers: [{ symbol: "tHKD", defaultT1Cap: "2000000000", newPayeeT1Cap: "0", t2Ceiling: "50000000000", categoryT1Caps: [] }],
  reserveFloors: [{ symbol: "tHKD", amount: "1500000000" }],
  velocity: { symbol: "tHKD", windowSeconds: 86400, maxCount: 6, maxOutflow: "12000000000", count: 2, outflow: "4236800000" },
  payees: [{ id: "hbu-bursar", label: "HBU Bursar", address: A("hbu"), category: "tuition" }],
  paused: false,
  block: 31884517,
};
const scales = Array.from({ length: 9 }, (_, k) => ({ n: k + 1, name: `Scale ${k + 1}`, status: k === 5 ? "stopped" : k > 5 ? "skipped" : "passed", reason: k === 5 ? "Not in the PayeeBook" : null, typedError: k === 5 ? "PayeeNotVerified" : undefined }));
const proposal = {
  id: "prop-1",
  principal: "nadia",
  request: "Pay 500 to 0xabc",
  intent: { summary: "Pay a new address" },
  language: "en",
  plan: [{ step: 1, description: "Resolve the payee" }],
  tier: "T4",
  decision: "refused",
  scales,
  explanation: { text: "Refused: the address is not a verified payee.", aiGenerated: true, model: "qwen3.5-9b" },
  payment: { symbol: "tHKD", decimals: 6, amount: "500000000", payee: { label: "Unknown", address: A("x") }, method: "transfer" },
  simulation: { ok: false, block: 31884517 },
  createdAt: "2026-10-16T01:00:00Z",
};
const receipt = {
  receiptId: "r-1",
  principal: "nadia",
  ledger: "base-sepolia",
  chainId: 84532,
  source: "live-base",
  tier: "T1",
  outcome: "confirmed",
  txHash: H("tx"),
  explorerUrl: "https://sepolia.basescan.org/tx/" + H("tx"),
  mandateHash: H("mandate"),
  delegationHash: H("delegation"),
  intentHash: H("intent"),
  agentId: 4127,
  payment: { symbol: "tHKD", decimals: 6, amount: "236800000", payee: { id: "kowloon-fresh", label: "Kowloon Fresh Market", address: A("kf") }, method: "transfer" },
  explanation: { text: "Inside the food budget.", aiGenerated: true, model: "qwen3.5-9b" },
  aigc: { label: "AI-generated", model: "qwen3.5-9b", provider: "local" },
  prevReceiptHash: H("prev"),
  receiptHash: H("receipt"),
  timestamp: "2026-10-15T11:42:00Z",
  anchor: { batchId: 312, root: H("root"), base: { txHash: H("anchor-base"), explorerUrl: null }, fisco: { txHash: H("anchor-fisco") } },
  proof: [H("sib1"), H("sib2")],
};
const td = cosignTypedData({ chainId: 84532, ledgerName: "base-sepolia", verifyingContract: A("cosign") as `0x${string}`, delegationHash: H("delegation"), executionCallData: "0x1234", nonce: 7n, expiry: 1793404800n });
const approval = {
  id: "apr-1",
  principal: "nadia",
  proposalId: "prop-2",
  kind: "cosign",
  decoded: { target: A("pp"), targetLabel: "Protected Payment", method: "deposit(address,uint256,bytes32)", payeeLabel: "HBU Bursar", payeeAddress: A("hbu"), symbol: "tHKD", decimals: 6, amount: "20000000000" },
  typedData: td,
  digest: typedDataDigest(td),
  expiresAt: "2026-10-16T02:00:00Z",
  status: "pending",
};
const routes: Record<string, unknown> = {
  "GET /v1/health": { ok: true, version: "0.3.0", ledgers: [{ name: "base-sepolia", chainId: 84532, block: 31884517, badge: "Base Sepolia" }, { name: "fisco", chainId: 20200, block: "1204639", badge: "FISCO BCOS" }], models: { intent: { provider: "openrouter", model: "qwen3.7-flash" }, sentinel: { model: "mmbert-sentinel" } } },
  "GET /v1/principals": [principal, company],
  "GET /v1/principals/nadia/state": state,
  "GET /v1/principals/lotus-sz/state": { ...state, principal: company, payees: [] },
  "POST /v1/principals/nadia/ask": proposal,
  "GET /v1/receipts?principal=nadia&limit=50": [receipt],
  "GET /v1/receipts?principal=lotus-sz&limit=30": [{ ...receipt, ledger: "fisco", chainId: 20200, source: "live-fisco", outcome: "reverted", revertError: { name: "VelocityExceeded", args: [], message: "velocity" } }],
  "GET /v1/receipts/r-1": receipt,
  "GET /proof/r-1?verify=1": {
    receiptHash: H("receipt"),
    batchId: 0,
    index: 3,
    proof: [H("sib1"), H("sib2")],
    root: H("root"),
    anchors: [{ ledger: "fisco", txHash: H("anchor-fisco"), blockNumber: "303", onchainBatchId: 1 }],
    valid: true,
    onChain: { ledger: "fisco", onchainBatchId: 1, valid: true },
  },
  "GET /v1/board-proposals?principal=lotus-sz": [
    { id: "bp-1", principal: "lotus-sz", ledger: "fisco", title: "Equipment purchase", payee: { id: "shenzhen_components", label: "Shenzhen Components", address: A("sc") }, amount: "18600000", decimals: 2, symbol: "CNY", op: {}, digest: H("op"), threshold: 2, signatures: [{ director: "director-1", address: A("d1"), signature: "0x01", signedAt: "2026-10-16T00:00:00Z" }], status: "collecting", createdAt: "2026-10-16T00:00:00Z" },
  ],
  "GET /v1/approvals?principal=nadia": [approval],
  "GET /v1/approvals?principal=lotus-sz": [{ ...approval, id: "apr-board", principal: "lotus-sz", signatures: [{ signer: "director-1", signedAt: "2026-10-16T00:00:00Z" }], threshold: 2 }],
  "GET /v1/approvals/apr-1": approval,
  "POST /v1/principals/nadia/pause": { approvalId: "apr-pause" },
  "GET /v1/approvals/apr-pause": { ...approval, id: "apr-pause", kind: "pause", decoded: null },
  "GET /v1/registry/agents": [{ agentId: "4127", wallet: A("ying"), label: "Ying", ownerDidHash: H("did"), identityCode: "YL-TEST-0000-4127", status: "active", attestations: [{ issuer: "did:web:hbu.example", issuerLabel: "HBU", claimHash: H("claim"), expiresAt: "2027-08-31T00:00:00Z" }], ledger: "base-sepolia" }, { agentId: "6660", wallet: A("mirage"), label: "Mirage", ownerDidHash: H("m"), status: "active", attestations: [], ledger: "base-sepolia" }],
  "GET /v1/evidence": { generatedAt: "2026-10-16T01:00:00Z", items: [{ beat: 6, title: "Forged payee reverted", ledger: "base-sepolia", txHash: H("ev"), explorerUrl: null, outcome: "reverted", revertError: { name: "PayeeNotVerified" } }] },
};

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("https://api.test", "");
    const key = `${init?.method ?? "GET"} ${path}`;
    if (!(key in routes)) return new Response(JSON.stringify({ error: { code: "not_found", message: `no route ${key}` } }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("live adapter maps the agent service wire format into the view model", () => {
  it("principal, passport, mandates, budgets", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test/");
    V.Health.parse(await api.health());
    const me = V.Principal.parse(await api.me());
    expect(me.agentName).toBe("Ying");
    const passport = V.Passport.parse(await api.passport("4127"));
    expect(passport.identityCode.placeholder).toBe(true);
    const [m] = (await api.mandates()) as V.Mandate[];
    V.Mandate.parse(m);
    expect(m!.serviceHashRing!.ticks).toHaveLength(64);
    expect(m!.published[0]!.explorerUrl).toContain("basescan");
    const lanes = (await api.budgets()) as V.BudgetLane[];
    expect(lanes.map((l) => l.label)).toEqual(["Food", "Out today"]);
    expect(lanes[1]!.floor!.value).toBe("1500000000");
  });

  it("ask, receipts and proofs", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const d = V.Decision.parse(await api.ask({ text: "Pay 500 to 0xabc" }));
    expect(d.outcome).toBe("refused");
    expect(d.scales[5]).toMatchObject({ scale: "counterparty", status: "stopped", error: "PayeeNotVerified" });
    const page = await api.receipts();
    const r = V.Receipt.parse((page as { items: V.Receipt[] }).items[0]);
    expect(r.summary).toBe("Payment to Kowloon Fresh Market");
    expect(r.agentId).toBe("4127");
    const proof = V.MerkleProof.parse(await api.receiptProof("r-1"));
    expect(proof.pairing).toBe("sorted");
    expect(proof.anchors.map((a) => a.ledger)).toEqual(["fisco"]);
    expect(proof.anchors[0]!.root).toBe(proof.root);
  });

  it("approvals resolve the payee against the PayeeBook; pause produces a signing request", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const [a] = (await api.approvals()) as V.ApprovalRequest[];
    V.ApprovalRequest.parse(a);
    expect(a!.decoded!.payee).toMatchObject({ name: "HBU Bursar", source: "PayeeBook", verified: true });
    const req = V.SigningRequest.parse(await api.requestPause("pause"));
    expect(req.kind).toBe("pause");
  });

  it("treasury, registry, evidence", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const t = V.TreasuryView.parse(await api.treasury("lotus-sz"));
    expect(t.entity.threshold).toBe(2);
    expect(t.proposals[0]!.signatures).toHaveLength(1);
    expect(t.instructions[0]).toMatchObject({ status: "rejected", rejectError: "VelocityExceeded" });
    const reg = (await api.registry()) as V.RegistryAgent[];
    expect(reg.find((x) => x.agentName === "Mirage")!.status).toBe("self-registered");
    const ev = V.EvidenceSummary.parse(await api.evidence());
    expect(ev.hashes[0]).toMatchObject({ kind: "revert", typedError: "PayeeNotVerified" });
  });

  it("reports a missing endpoint honestly", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    await expect(api.privateMandate("4127")).rejects.toThrow(/no route|does not provide/);
  });

  it("shares identical GETs inside the cache window and clears the cache on a POST", async () => {
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    const api = createLiveApi("https://api.test");
    await Promise.all([api.me(), api.me(), api.budgets()]);
    const gets = () => f.mock.calls.filter(([u, i]) => (i?.method ?? "GET") === "GET" && String(u).endsWith("/v1/principals")).length;
    expect(gets()).toBe(1);
    await api.ask({ text: "Pay 500 to 0xabc" });
    await api.me();
    expect(gets()).toBe(2);
  });

  it("falls back to the sealed mandate when the service cannot draft from free text", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const api = createLiveApi("https://api.test");
    const d = V.MandateDraft.parse(await api.compileMandate({ text: "Keep food under 3,000 a month", jurisdiction: "hk" }));
    expect(d.wire).toBeUndefined();
    expect(d.warnings[0]).toMatch(/does not draft mandates/);
    await expect(api.requestSeal(d)).rejects.toThrow(/no new mandate document/);
  });
});
