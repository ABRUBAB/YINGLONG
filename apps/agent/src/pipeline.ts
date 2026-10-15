import { randomUUID } from "node:crypto";
import { encodeAbiParameters, encodeFunctionData, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi, docHash, type DecodedRevert, type Tier } from "@yinglong/sdk";
import { formatUnits, type Delegation, type Mandate } from "@yinglong/mandate";
import { HandleStore } from "@yinglong/provenance";
import { ledgerContext, type LedgerContext } from "./chain/ledger";
import { redeemCallData, replayRevert, simulateRedemption, singleExecution } from "./chain/mandates";
import { explain } from "./explain";
import { recordReceipt, receiptLog, type ReceiptRecord } from "./receipts";
import { checkCounterparty, type CounterpartyResult } from "./scales/counterparty";
import { normalise } from "./scales/normalise";
import { evaluatePolicy, type Payment, type PolicyDecision } from "./scales/policy";
import { readDocument, readImage, type QuarantinedRead } from "./scales/quarantine";
import { payOverX402 } from "./x402";
import { sentinel, type SentinelResult } from "./scales/sentinel";
import { DATA_DIR, DocStore } from "./store";
import { understand, type Intent, type UnderstandResult } from "./understand/intent";
import { finalTier } from "./tiers";
import { config, nextCosignNonce, principalHandle, stateOf, type PrincipalId, type PrincipalState } from "./world";
import { resolve } from "node:path";

export type ScaleStatus = "passed" | "stopped" | "escalated" | "skipped";
export interface ScaleReport {
  n: number;
  name: string;
  status: ScaleStatus;
  reason: string;
  typedError?: string;
  model?: string;
}

export interface Proposal {
  id: string;
  principal: PrincipalId;
  ledger: string;
  request: string;
  intent: Intent;
  understanding: Omit<UnderstandResult, "intent">;
  language: string;
  plan: { step: number; description: string }[];
  tier: Tier;
  decision: "execute" | "needs_approval" | "refused" | "ask" | "answered";
  scales: ScaleReport[];
  explanation: { text: string; aiGenerated: boolean; model?: string };
  payment?: { symbol: string; decimals: number; amount: string; payee: { id?: string; label: string; address: Address }; method: string };
  simulation?: { ok: boolean; revert?: DecodedRevert; block: string };
  policy?: PolicyDecision;
  counterparty?: CounterpartyResult;
  answer?: unknown;
  approvalId?: string;
  breaker?: { tripped: boolean; txHash?: Hex; reason: string };
  execution?: Hex;
  calldata?: Hex;
  status: "open" | "executed" | "refused" | "awaiting_approval" | "asked" | "answered";
  receiptIds: Hex[];
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  principal: PrincipalId;
  proposalId: string;
  kind: "cosign" | "pause" | "resume";
  decoded: { target: Address; targetLabel: string; method: string; payeeLabel: string; payeeAddress: Address; symbol: string; decimals: number; amount: string };
  typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> };
  digest: Hex;
  nonce: bigint;
  expiry: bigint;
  expiresAt: string;
  status: "pending" | "signed" | "expired" | "declined";
  execution: { target: Address; value: string; callData: Hex };
  reason: string;
  explanation: { text: string; aiGenerated: boolean; model?: string };
  threshold?: number;
  signatures?: { signer: string; signedAt: string }[];
}

interface Proposals {
  proposals: Record<string, Proposal>;
  approvals: Record<string, ApprovalRequest>;
}
export const proposals = new DocStore<Proposals>(resolve(DATA_DIR, "proposals.json"), { proposals: {}, approvals: {} });

const SYMBOL_TO_CONTRACT: Record<string, "TestHKD" | "TestUSD" | "ConditionalPaymentInstructions"> = {
  tHKD: "TestHKD",
  tUSD: "TestUSD",
  CNY: "ConditionalPaymentInstructions",
};

function toBaseUnits(value: string, decimals: number): bigint {
  const [w, f = ""] = value.split(".");
  if (f.length > decimals) throw new Error("too many decimals");
  return BigInt(w!) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0");
}


// ---------------------------------------------------------------- ask

export async function ask(id: PrincipalId, text: string, attachments: { kind: "invoice" | "email" | "quote" | "invoice_image"; content: string }[] = []): Promise<Proposal> {
  const st = stateOf(id);
  const cfg = config(id);
  const ctx = ledgerContext(st.ledger);
  const m = st.mandate as Mandate;
  const scales: ScaleReport[] = [];
  const handles = new HandleStore();
  const aiFlags: string[] = [];

  // 1. Normalise.
  const norm = normalise(text);
  const images = attachments.filter((a) => a.kind === "invoice_image" && a.content.startsWith("data:image/"));
  const normAtt = attachments.filter((a) => a.kind !== "invoice_image").map((a) => ({ ...a, kind: a.kind as "invoice" | "email" | "quote", n: normalise(a.content) }));
  const nflags = [...norm.flags, ...normAtt.flatMap((a) => a.n.flags)];
  scales.push({
    n: 1,
    name: "Normalise",
    status: nflags.length ? "escalated" : "passed",
    reason: nflags.length ? nflags.join("; ") : `clean${norm.scrubbed.length ? `; scrubbed ${norm.scrubbed.map((s) => s.kind).join(", ")}` : ""}`,
  });
  if (nflags.length) aiFlags.push("hidden or look-alike characters");

  // 2. Sentinel (escalates only).
  const sRes: SentinelResult[] = [await sentinel(norm.text), ...(await Promise.all(normAtt.map((a) => sentinel(a.n.text))))];
  const injected = sRes.filter((s) => s.label === "injection");
  scales.push({
    n: 2,
    name: "Sentinel",
    status: injected.length ? "escalated" : "passed",
    reason: injected.length ? `possible prompt injection (score ${Math.max(...injected.map((s) => s.score)).toFixed(2)}${injected[0]?.matched?.length ? `: ${injected[0].matched.join(", ")}` : ""})` : "no injection signal",
    model: sRes[0]!.model,
  });
  if (injected.length) aiFlags.push("possible prompt injection");

  // 3. Quarantine untrusted documents (closed schema, opaque handles, two readers).
  const reads: QuarantinedRead[] = [];
  const payees = m.payees.map((p) => ({ id: p.id, label: p.label, category: p.category, address: p.address as Address }));
  for (const a of normAtt) reads.push(await readDocument(handles, a.n.text, a.kind, payees));
  for (const img of images) reads.push(await readImage(handles, img.content, payees));
  const qflags = reads.flatMap((r) => r.flags);
  scales.push({
    n: 3,
    name: "Quarantine",
    status: reads.length === 0 ? "skipped" : qflags.length ? "escalated" : "passed",
    reason: reads.length === 0 ? "no untrusted documents" : qflags.length ? qflags.join("; ") : `${reads.length} document(s) read by ${reads[0]!.readers.length} reader(s); fields agree`,
  });
  if (qflags.length) aiFlags.push(...qflags);

  // Understand the user's own words (the planner never sees quarantined text).
  try {
    handles.assertClean(norm.text);
  } catch {
    aiFlags.push("your message repeats text from an untrusted document");
  }
  const u = await understand(norm.text, payees, cfg.defaultUnit);
  let intent = u.intent;
  const r0 = reads[0];
  if (r0 && (intent.kind === "pay" || intent.kind === "unknown")) {
    intent = {
      ...intent,
      kind: "pay",
      payee: intent.payee ?? r0.fields.payee.value,
      ambiguities: intent.ambiguities.filter(
        (a) => !(a === "missing_amount" && (intent.amount || r0.fields.amount.value)) && !(a === "missing_payee" && (intent.payee || r0.fields.payee.value)) && a !== "missing_date",
      ),
      amount: intent.amount ?? (r0.fields.amount.value ? { value: r0.fields.amount.value, unit: r0.fields.currency.value === "unknown" ? cfg.defaultUnit : (r0.fields.currency.value as Intent["amount"] extends infer A ? (A extends { unit: infer U } ? U : never) : never) } : null),
    };
  }
  const base = {
    id: randomUUID(),
    principal: id,
    ledger: st.ledger,
    request: text,
    intent,
    understanding: { via: u.via, model: u.model, provider: u.provider, latencyMs: u.latencyMs, promptSha256: u.promptSha256 },
    language: intent.language,
    receiptIds: [] as Hex[],
    createdAt: new Date().toISOString(),
  };

  // Read-only requests (T0).
  if (["query_balance", "query_activity", "query_forecast"].includes(intent.kind)) {
    const answer = await answerQuery(ctx, st, intent.kind);
    const p: Proposal = {
      ...base,
      plan: [{ step: 1, description: "read on-chain state (no signing path)" }],
      tier: "T0",
      decision: "answered",
      scales,
      explanation: { text: answer.text, aiGenerated: false },
      answer,
      status: "answered",
    };
    proposals.update((d) => {
      d.proposals[p.id] = p;
    });
    return p;
  }

  // 4. Ground: every field must trace to the user's words, the mandate, the payee book or the chain.
  const groundIssues: string[] = [];
  let tier: Tier = "T1";
  let asked: string | undefined;
  intent = { ...intent, ambiguities: intent.ambiguities.filter((a) => a !== "missing_date" || intent.when.recurrence !== "none") };
  if (intent.ambiguities.length) asked = `I need you to clarify: ${intent.ambiguities.map((a) => a.replace(/_/g, " ")).join(", ")}.`;
  if (intent.kind === "add_payee" || intent.payee === "NEW_PAYEE_REQUEST" || intent.kind === "change_mandate") tier = "T3";
  if (!["pay", "escrow", "sweep", "convert"].includes(intent.kind) && tier !== "T3") asked = asked ?? `I can only pay, escrow, sweep or convert inside your mandate; "${intent.kind}" needs you.`;
  const FX_DESK = { id: "pearl_river_fx", label: "Pearl River FX Desk", category: "services", address: ctx.roleAddress("svc-pearl-river-fx") };
  const payee = intent.kind === "convert" ? FX_DESK : payees.find((p) => p.id === intent.payee);
  const unit = intent.amount?.unit ?? cfg.defaultUnit;
  const contract = SYMBOL_TO_CONTRACT[unit];
  const asset = contract ? ctx.addr(contract) : undefined;
  const assetDoc = m.assets.find((a) => asset && a.address.toLowerCase() === asset.toLowerCase());
  if (!assetDoc) groundIssues.push(`${unit} is not an asset of this mandate`);
  let amount: bigint | undefined;
  if (intent.amount && assetDoc) {
    try {
      amount = toBaseUnits(intent.amount.value, assetDoc.decimals);
    } catch {
      groundIssues.push("amount has more decimals than the asset");
    }
    const digits = intent.amount.value.replace(/\.0+$/, "");
    const fromUser = norm.text.replace(/,/g, "").includes(digits);
    if (!fromUser) {
      if (r0?.agreement.amount && r0.fields.amount.value === intent.amount.value) aiFlags.push("amount comes from an untrusted document");
      else groundIssues.push("the amount does not appear in your words or in an agreed document reading");
    }
  }
  if (!payee && tier !== "T3") groundIssues.push("no verified payee");
  scales.push({
    n: 4,
    name: "Ground",
    status: groundIssues.length ? "escalated" : "passed",
    reason: groundIssues.length ? groundIssues.join("; ") : "payee, amount and asset trace to your words, the mandate and the payee book",
  });
  if (groundIssues.length && tier !== "T3") asked = asked ?? `I could not ground this request: ${groundIssues.join("; ")}.`;

  // Conversion: buy a signed quote over x402 (seller-settled ERC-7710), then settle it through the mandate.
  let fx: { transferAndCallData: Hex; quoteNonce?: string; settlementTx?: Hex; fee?: string } | undefined;
  if (intent.kind === "convert" && amount !== undefined && asset && assetDoc && !groundIssues.length) {
    const outSymbol = assetDoc.symbol === "tUSD" ? "tHKD" : "tUSD";
    const r = await payOverX402(st, `/fx/pearl-river/quote?payer=${st.account}&inToken=${assetDoc.symbol}&outToken=${outSymbol}&amountIn=${amount}`, { label: "Pearl River FX quote" });
    if (!r.ok || !r.body?.transferAndCallData) {
      groundIssues.push(`could not buy a signed FX quote: ${r.refusal ?? r.status}`);
    } else {
      fx = { transferAndCallData: r.body.transferAndCallData as Hex, settlementTx: r.settlementTx, fee: r.fee?.amount.toString() };
      if (r.receiptId) base.receiptIds.push(r.receiptId);
    }
  }

  // Build the execution.
  let payment: Payment | undefined;
  let execution: Hex | undefined;
  let method = "transfer";
  if (payee && asset && amount !== undefined && assetDoc) {
    if (intent.kind === "convert") {
      if (fx) {
        method = "transferAndCall";
        const settlement = ctx.addr("SignedQuoteSettlement");
        payment = { asset, recipient: settlement, beneficiary: payee.address, amount, method: "transferAndCall" };
        execution = singleExecution({ to: asset, data: encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transferAndCall", args: [settlement, amount, fx.transferAndCallData] }) });
      }
    } else if (intent.kind === "escrow" && unit !== "CNY") {
      method = "transferAndCall";
      const attester = ctx.roleAddress(id === "nadia" ? "issuer-hbu" : "issuer-harbour-digital-bank");
      const now = Number((await ctx.pub.getBlock()).timestamp);
      const data = encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint64" }],
        [payee.address, keccak256(stringToBytes(`condition:${payee.id}:${intent.conditions.join(",") || "delivery"}`)), attester, BigInt(now + 30 * 86400)],
      );
      payment = { asset, recipient: ctx.addr("ProtectedPayment"), beneficiary: payee.address, amount, method: "transferAndCall" };
      execution = singleExecution({ to: asset, data: encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transferAndCall", args: [ctx.addr("ProtectedPayment"), amount, data] }) });
    } else if (unit === "CNY") {
      method = "instruct";
      const now = Number((await ctx.pub.getBlock()).timestamp);
      payment = { asset, recipient: payee.address, beneficiary: payee.address, amount, method: "instruct" };
      execution = singleExecution({
        to: asset,
        data: encodeFunctionData({
          abi: abi.ConditionalPaymentInstructionsAbi,
          functionName: "instruct",
          args: [payee.address, amount, keccak256(stringToBytes(`purpose:${payee.category}`)), keccak256(stringToBytes(`condition:${intent.conditions.join(",") || "none"}`)), BigInt(now + 7 * 86400)],
        }),
      });
    } else if (intent.kind === "sweep") {
      method = "transferAndCall";
      payment = { asset, recipient: payee.address, beneficiary: payee.address, amount, method: "transferAndCall" };
      execution = singleExecution({ to: asset, data: encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transferAndCall", args: [payee.address, amount, "0x"] }) });
    } else {
      payment = { asset, recipient: payee.address, beneficiary: payee.address, amount, method: "transfer" };
      execution = singleExecution({ to: asset, data: encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transfer", args: [payee.address, amount] }) });
    }
  }

  // 5. Policy mirror (deterministic).
  let policy: PolicyDecision | undefined;
  if (payment) {
    policy = await evaluatePolicy({ ctx, mandate: m, delegation: st.delegation!, mandateHash: st.mandateHash!, account: st.account, agent: st.agentWallet, payment });
    if (policy.tier === "T4" || policy.tier === "T3") tier = policy.tier;
    else if (policy.tier === "T2" && tier === "T1") tier = "T2";
  }
  scales.push({
    n: 5,
    name: "Policy",
    status: !policy ? "skipped" : policy.refusals.length ? "stopped" : "passed",
    reason: !policy ? "nothing to evaluate" : policy.refusals.length ? policy.refusals.map((r) => `${r.typedError}: ${r.detail}`).join("; ") : policy.reasons.join("; ") || "inside every rule of the mandate",
    typedError: policy?.refusals[0]?.typedError,
  });

  // 6. Counterparty.
  let cp: CounterpartyResult | undefined;
  if (payment) {
    cp = await checkCounterparty(ctx, st.account, payment.beneficiary, m.trustedIssuers.map((x) => x.address as Address), payees.map((p) => p.address));
    if (cp.verdict === "sanctioned" || cp.verdict === "look-alike") {
      tier = "T4";
    }
  }
  scales.push({
    n: 6,
    name: "Counterparty",
    status: !cp ? "skipped" : cp.verdict === "verified-payee" || cp.verdict === "attested-agent" ? "passed" : "stopped",
    reason: !cp ? "no counterparty" : `${cp.verdict}${cp.lookAlikeOf ? ` of ${cp.lookAlikeOf}` : ""}`,
    typedError: cp && (cp.verdict === "sanctioned" || cp.verdict === "look-alike" || cp.verdict === "unverified") ? "PayeeNotVerified" : undefined,
  });

  // 7. Simulate on the ledger itself.
  let simulation: Proposal["simulation"];
  let calldata: Hex | undefined;
  if (execution) {
    calldata = redeemCallData([st.delegation!], execution);
    const sim = await simulateRedemption(ctx, st.agentWallet, calldata);
    simulation = { ok: sim.ok, revert: sim.revert, block: sim.blockNumber.toString() };
    const consistent =
      (tier === "T1" && sim.ok) ||
      (tier === "T2" && !sim.ok && sim.revert?.name === "CoSignRequired") ||
      ((tier === "T4" || tier === "T3") && !sim.ok);
    if (!consistent && tier === "T1") asked = asked ?? `The ledger disagrees with my rule check (${sim.revert?.message ?? "unexpected success"}).`;
    scales.push({
      n: 7,
      name: "Simulate",
      status: sim.ok ? "passed" : tier === "T2" ? "escalated" : "stopped",
      reason: sim.ok ? `succeeds at block ${sim.blockNumber}` : `reverts: ${sim.revert?.message}`,
      typedError: sim.revert?.name,
    });
  } else scales.push({ n: 7, name: "Simulate", status: "skipped", reason: "nothing to simulate" });

  // 8. Anomaly (escalates only).
  let anomaly = "within your usual pattern";
  if (payment) {
    const past = receiptLog
      .all()
      .filter(
        (r) =>
          r.principal === id &&
          r.receipt.outcome === "confirmed" &&
          r.payment?.payee.toLowerCase() === payment!.beneficiary.toLowerCase() &&
          r.payment?.method === payment!.method,
      )
      .map((r) => BigInt(r.payment!.amount));
    const max = past.reduce((a, b) => (b > a ? b : a), 0n);
    if (past.length >= 2 && payment.amount > max * 3n) {
      anomaly = "amount is more than three times the largest past payment to this payee";
      aiFlags.push(anomaly);
    }
    if (intent.kind === "sweep" && past.length === 0) {
      anomaly = "first sweep into this product: you decide once, later sweeps can run alone";
      aiFlags.push(anomaly);
    }
  }
  scales.push({ n: 8, name: "Anomaly", status: anomaly.startsWith("within") ? "passed" : "escalated", reason: anomaly });

  // Monotonic safety: AI signals can only raise the tier, never lower it, never produce T3 or T4.
  tier = finalTier(tier, aiFlags.length, !!asked);
  scales.push({
    n: 9,
    name: "Chain",
    status: tier === "T1" ? "passed" : tier === "T4" ? "stopped" : "skipped",
    reason: tier === "T1" ? "the enforcers will decide at redemption" : tier === "T4" ? "the enforcers would revert this redemption" : "waiting for you",
  });

  const decision: Proposal["decision"] = tier === "T1" ? "execute" : tier === "T2" ? "needs_approval" : tier === "ASK" ? "ask" : "refused";
  const stopped = scales.find((s) => s.status === "stopped");
  const ex = explain({
    tier,
    decision,
    payeeLabel: payee?.label,
    amount,
    decimals: assetDoc?.decimals,
    symbol: assetDoc?.symbol,
    typedError: stopped?.typedError ?? (tier === "T3" ? "reserved for you" : undefined),
    refusalDetail: tier === "T3" ? "adding payees, changing limits and anything above the T2 ceiling are yours alone" : policy?.refusals[0]?.detail,
    stoppedAt: stopped ? `The ${stopped.name.toLowerCase()} check` : undefined,
    t1Threshold: policy?.t1Threshold,
    flags: aiFlags,
    question: asked,
  });

  const p: Proposal = {
    ...base,
    plan: buildPlan(intent, method, tier),
    tier,
    decision,
    scales,
    explanation: { text: ex.text, aiGenerated: ex.aiGenerated },
    payment:
      payment && assetDoc && payee
        ? { symbol: assetDoc.symbol, decimals: assetDoc.decimals, amount: payment.amount.toString(), payee: { id: payee.id, label: payee.label, address: payee.address }, method }
        : undefined,
    simulation,
    policy,
    counterparty: cp,
    execution,
    calldata,
    status: decision === "execute" ? "open" : decision === "needs_approval" ? "awaiting_approval" : decision === "ask" ? "asked" : "refused",
  };

  // T2, and an "ask" that came only from AI escalation (a valid payment exists): the user decides with an
  // explicit passkey approval. An ask caused by missing or ungrounded data has no payment to approve.
  if ((decision === "needs_approval" || (decision === "ask" && groundIssues.length === 0 && !intent.ambiguities.length)) && execution && payment && assetDoc && payee && simulation) {
    p.approvalId = await createCosignApproval(ctx, st, p, execution);
  }
  if (decision === "refused" || decision === "ask") {
    const rec = writeReceipt(p, st, decision === "ask" ? "asked" : "rejected_policy");
    p.receiptIds.push(rec.receipt.receiptId);
  }
  // Circuit breaker: a deterministic refusal of a breaker-class rule pauses the account through the breaker
  // watcher (pause only; only the principal can resume). Reverted transactions write nothing on-chain, so the
  // breaker trips off-chain from the policy decision.
  const breakerRules = (process.env.BREAKER_RULES ?? "VelocityExceeded").split(",");
  const tripRule = policy?.refusals.find((r) => breakerRules.includes(r.typedError));
  if (tier === "T4" && tripRule && config(id).kind === "company" && policy?.stateReads.paused !== "true") {
    p.breaker = await tripBreaker(ctx, st.account, `${tripRule.typedError}: ${tripRule.detail}`);
  }
  proposals.update((d) => {
    d.proposals[p.id] = p;
  });
  return p;
}

function buildPlan(intent: Intent, method: string, tier: Tier) {
  const steps = [
    "understand the request (closed schema; payee from your payee book only)",
    "check the mandate rules against live ledger state",
    "verify the counterparty",
    `simulate the ${method} redemption on the ledger`,
  ];
  if (tier === "T2") steps.push("wait for your approval on your phone (passkey)");
  if (tier === "T1" || tier === "T2") steps.push("sign the redemption in the isolated signer and submit", "verify the result and record a receipt");
  return steps.map((d, i) => ({ step: i + 1, description: d }));
}

// ---------------------------------------------------------------- circuit breaker

async function tripBreaker(ctx: LedgerContext, account: Address, reason: string): Promise<{ tripped: boolean; txHash?: Hex; reason: string }> {
  const url = process.env.BREAKER_URL;
  if (url) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account, reason, ledger: ctx.name, by: "policy" }) });
      const j = (await r.json()) as { txHash?: Hex };
      return { tripped: r.ok, txHash: j.txHash, reason };
    } catch {
      /* fall through to the local watcher key */
    }
  }
  const res = await ctx.write("breaker-watcher", { address: ctx.addr("KillSwitchRegistry"), abi: abi.KillSwitchRegistryAbi as never, functionName: "trip", args: [account] });
  return { tripped: res.ok, txHash: res.hash, reason };
}

// ---------------------------------------------------------------- approvals (T2)

async function createCosignApproval(ctx: LedgerContext, st: PrincipalState, p: Proposal, execution: Hex): Promise<string> {
  const now = (await ctx.pub.getBlock()).timestamp;
  const expiry = now + (ctx.profile.timeUnit === "ms" ? 540_000n : 540n);
  const nonce = nextCosignNonce(st.id);
  const digest = await ctx.read<Hex>({
    address: ctx.addr("CoSignEnforcer"),
    abi: abi.CoSignEnforcerAbi,
    functionName: "approvalDigest",
    args: [st.delegationHash!, keccak256(execution), nonce, expiry],
  });
  const id = randomUUID();
  const a: ApprovalRequest = {
    id,
    principal: st.id,
    proposalId: p.id,
    kind: "cosign",
    decoded: {
      target: p.payment!.method === "transferAndCall" ? ctx.addr("ProtectedPayment") : (p.payment!.payee.address as Address),
      targetLabel: p.payment!.method === "transferAndCall" ? "escrow (ProtectedPayment)" : p.payment!.payee.label,
      method: p.payment!.method,
      payeeLabel: p.payment!.payee.label,
      payeeAddress: p.payment!.payee.address,
      symbol: p.payment!.symbol,
      decimals: p.payment!.decimals,
      amount: p.payment!.amount,
    },
    typedData: {
      domain: { name: "YINGLONG CoSign", version: "1", chainId: ctx.profile.chainId, verifyingContract: ctx.addr("CoSignEnforcer"), salt: ctx.deployment.domainSalt },
      types: {
        Approval: [
          { name: "delegationHash", type: "bytes32" },
          { name: "executionHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
        ],
      },
      primaryType: "Approval",
      message: { delegationHash: st.delegationHash, executionHash: keccak256(execution), nonce: nonce.toString(), expiry: expiry.toString() },
    },
    digest,
    nonce,
    expiry,
    expiresAt: new Date(Date.now() + 540_000).toISOString(),
    status: "pending",
    execution: { target: `0x${execution.slice(2, 42)}` as Address, value: BigInt(`0x${execution.slice(42, 106)}`).toString(), callData: `0x${execution.slice(106)}` as Hex },
    reason: p.scales.filter((s) => s.status === "escalated").map((s) => s.reason).join("; ") || "above the amount the agent may pay alone",
    explanation: p.explanation,
    threshold: config(st.id).kind === "company" ? 2 : 1,
    signatures: [],
  };
  proposals.update((d) => {
    d.approvals[id] = a;
  });
  return id;
}

/** Use the user's approval signature (verified on-chain through the account's ERC-1271) and execute. */
export async function submitApproval(approvalId: string, signature: Hex): Promise<ReceiptRecord> {
  const a = proposals.get().approvals[approvalId];
  if (!a) throw new Error("unknown approval");
  if (a.status !== "pending") throw new Error(`approval is ${a.status}`);
  if (a.kind === "pause" || a.kind === "resume") return submitPauseApproval(a, signature);
  const p = proposals.get().proposals[a.proposalId]!;
  const st = stateOf(a.principal);
  const ctx = ledgerContext(st.ledger);
  const magic = await ctx.pub
    .readContract({ address: st.account, abi: abi.HybridDeleGatorAbi, functionName: "isValidSignature", args: [a.digest, signature] })
    .catch(() => "0x");
  if (magic !== "0x1626ba7e") throw new Error("the approval signature is not valid for this account");
  const cosign = ctx.addr("CoSignEnforcer").toLowerCase();
  const d: Delegation = {
    ...st.delegation!,
    // Attach the approval to every CoSign caveat: only the caveat for the paid asset reads its args.
    caveats: st.delegation!.caveats.map((c) =>
      c.enforcer.toLowerCase() === cosign
        ? { ...c, args: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], [a.nonce, a.expiry, signature]) }
        : c,
    ),
  };
  proposals.update((x) => {
    x.approvals[approvalId]!.status = "signed";
  });
  return execute(p.id, { delegation: d, approvalSig: signature });
}

/** One-tap pause / resume: the principal signs Trip or Untrip; our relayer submits it as a plain transaction. */
export async function createPauseApproval(id: PrincipalId, kind: "pause" | "resume"): Promise<ApprovalRequest> {
  const st = stateOf(id);
  const ctx = ledgerContext(st.ledger);
  const ks = ctx.addr("KillSwitchRegistry");
  const nonce = await ctx.read<bigint>({ address: ks, abi: abi.KillSwitchRegistryAbi, functionName: "nonces", args: [st.account] });
  const now = (await ctx.pub.getBlock()).timestamp;
  const deadline = now + (ctx.profile.timeUnit === "ms" ? 3_600_000n : 3600n);
  const digest = await ctx.read<Hex>({ address: ks, abi: abi.KillSwitchRegistryAbi, functionName: kind === "pause" ? "tripDigest" : "untripDigest", args: [st.account, nonce, deadline] });
  const primaryType = kind === "pause" ? "Trip" : "Untrip";
  const a: ApprovalRequest = {
    id: randomUUID(),
    principal: id,
    proposalId: "",
    kind,
    decoded: { target: ks, targetLabel: "KillSwitchRegistry", method: kind === "pause" ? "tripWithSig" : "untripWithSig", payeeLabel: "", payeeAddress: st.account, symbol: "", decimals: 0, amount: "0" },
    typedData: {
      domain: { name: "YINGLONG Kill Switch", version: "1", chainId: ctx.profile.chainId, verifyingContract: ks, salt: ctx.deployment.domainSalt },
      types: { [primaryType]: [{ name: "account", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType,
      message: { account: st.account, nonce: nonce.toString(), deadline: deadline.toString() },
    },
    digest,
    nonce,
    expiry: deadline,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    status: "pending",
    execution: { target: ks, value: "0", callData: "0x" },
    reason: kind === "pause" ? "Pause every delegation of this account now." : "Resume the agent.",
    explanation: { text: kind === "pause" ? "Sign to stop your agent immediately. Only you can resume it." : "Sign to let your agent act again inside your mandate.", aiGenerated: false },
    threshold: config(id).kind === "company" ? 2 : 1,
    signatures: [],
  };
  proposals.update((d) => {
    d.approvals[a.id] = a;
  });
  return a;
}

async function submitPauseApproval(a: ApprovalRequest, signature: Hex): Promise<ReceiptRecord> {
  const st = stateOf(a.principal);
  const ctx = ledgerContext(st.ledger);
  const t0 = Date.now();
  const res = await ctx.write("relayer", {
    address: ctx.addr("KillSwitchRegistry"),
    abi: abi.KillSwitchRegistryAbi as never,
    functionName: a.kind === "pause" ? "tripWithSig" : "untripWithSig",
    args: [st.account, a.nonce, a.expiry, signature],
  });
  const ms = Date.now() - t0;
  proposals.update((d) => {
    d.approvals[a.id]!.status = "signed";
  });
  return recordReceipt({
    principal: a.principal,
    ledger: st.ledger,
    agentId: st.agentId,
    mandateHash: st.mandateHash!,
    delegationHash: st.delegationHash!,
    tier: "T3",
    outcome: res.ok ? "confirmed" : "reverted",
    txHash: res.hash,
    approvalSig: signature,
    documents: { plan: { action: a.kind, msToConfirmed: ms, block: res.receipt.blockNumber.toString() } },
    explanation: { text: a.kind === "pause" ? `Paused every delegation of this account (confirmed in ${ms} ms, block ${res.receipt.blockNumber}).` : "Resumed the agent.", aiGenerated: false },
    aigc: { model: "none (user signature)", provider: "local" },
  });
}

export function declineApproval(approvalId: string): ApprovalRequest {
  const a = proposals.get().approvals[approvalId];
  if (!a) throw new Error("unknown approval");
  if (a.status !== "pending") throw new Error(`approval is ${a.status}`);
  proposals.update((d) => {
    d.approvals[approvalId]!.status = "declined";
    if (a.proposalId && d.proposals[a.proposalId]) d.proposals[a.proposalId]!.status = "refused";
  });
  const p = a.proposalId ? proposals.get().proposals[a.proposalId] : undefined;
  if (p) writeReceipt(p, stateOf(a.principal), "rejected_policy");
  return proposals.get().approvals[approvalId]!;
}

/**
 * Attack simulation ("what a hijacked agent would send"): build the raw redemption an attacker holding the
 * agent's key would submit, run the policy mirror and simulation on it, and push it to the chain through the
 * signer's chain-test mode so the ledger's own refusal (typed revert) is recorded as evidence.
 */
export async function hijack(id: PrincipalId, args: { to: Address; amount: bigint; symbol: "tHKD" | "tUSD" | "CNY"; family: string }): Promise<{ proposal: Proposal; receipt?: ReceiptRecord }> {
  const st = stateOf(id);
  const ctx = ledgerContext(st.ledger);
  const m = st.mandate as Mandate;
  const contract = SYMBOL_TO_CONTRACT[args.symbol]!;
  const asset = ctx.addr(contract);
  const isCpi = args.symbol === "CNY";
  const now = Number((await ctx.pub.getBlock()).timestamp);
  const data = isCpi
    ? encodeFunctionData({ abi: abi.ConditionalPaymentInstructionsAbi, functionName: "instruct", args: [args.to, args.amount, keccak256(stringToBytes("purpose:attack")), keccak256(stringToBytes("condition:none")), BigInt(now + 86400)] })
    : encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transfer", args: [args.to, args.amount] });
  const execution = singleExecution({ to: asset, data });
  const payment: Payment = { asset, recipient: args.to, beneficiary: args.to, amount: args.amount, method: isCpi ? "instruct" : "transfer" };
  const policy = await evaluatePolicy({ ctx, mandate: m, delegation: st.delegation!, mandateHash: st.mandateHash!, account: st.account, agent: st.agentWallet, payment });
  const calldata = redeemCallData([st.delegation!], execution);
  const sim = await simulateRedemption(ctx, st.agentWallet, calldata);
  const decimals = m.assets.find((a) => a.address.toLowerCase() === asset.toLowerCase())?.decimals ?? 6;
  const p: Proposal = {
    id: randomUUID(),
    principal: id,
    ledger: st.ledger,
    request: `attack simulation (${args.family}): raw redemption to ${args.to}`,
    intent: { kind: "pay", payee: null, amount: null, category: null, when: { date: null, recurrence: "none" }, conditions: [], ambiguities: [], language: "en" },
    understanding: { via: "rules", model: "none (attack simulation)", provider: "local", latencyMs: 0, promptSha256: "" },
    language: "en",
    plan: [{ step: 1, description: "send the raw redemption a hijacked agent would send, skipping every off-chain check" }],
    tier: sim.ok && policy.refusals.length === 0 ? "T1" : "T4",
    decision: "refused",
    scales: [
      { n: 5, name: "Policy", status: policy.refusals.length ? "stopped" : "passed", reason: policy.refusals.map((r) => `${r.typedError}: ${r.detail}`).join("; ") || "no refusal", typedError: policy.refusals[0]?.typedError },
      { n: 7, name: "Simulate", status: sim.ok ? "passed" : "stopped", reason: sim.ok ? "succeeds" : `reverts: ${sim.revert?.message}`, typedError: sim.revert?.name },
      { n: 9, name: "Chain", status: "stopped", reason: "submitted raw to show the enforcers revert it" },
    ],
    explanation: { text: `Attack simulation: a hijacked agent tries to send funds to ${args.to}.`, aiGenerated: false },
    payment: { symbol: args.symbol, decimals, amount: args.amount.toString(), payee: { label: `attacker (${args.family})`, address: args.to }, method: payment.method },
    simulation: { ok: sim.ok, revert: sim.revert, block: sim.blockNumber.toString() },
    policy,
    execution,
    calldata,
    status: "refused",
    receiptIds: [],
    createdAt: new Date().toISOString(),
  };
  proposals.update((d) => {
    d.proposals[p.id] = p;
  });
  if (p.tier !== "T4") return { proposal: p };
  const receipt = await bypass(p.id);
  return { proposal: proposals.get().proposals[p.id]!, receipt };
}

/** Demo-only: sign a pending approval with the principal's scripted passkey (labelled in the receipt). */
export async function demoApprove(approvalId: string): Promise<ReceiptRecord> {
  const a = proposals.get().approvals[approvalId];
  if (!a) throw new Error("unknown approval");
  const { p } = await principalHandle(a.principal);
  return submitApproval(approvalId, await p.sign(a.digest));
}

// ---------------------------------------------------------------- execute and bypass

async function signerRedeem(ledger: string, agentRole: string, calldata: Hex, decision: { tier: Tier; proposalId: string; approved?: boolean }, mode: "normal" | "chain-test", account: Address) {
  const url = process.env.SIGNER_URL ?? "http://127.0.0.1:8788";
  const r = await fetch(`${url}/v1/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ledger, agentRole, calldata, decision, mode, account }),
  });
  const j = (await r.json()) as { ok: boolean; txHash?: Hex; reason?: string };
  if (!j.ok || !j.txHash) throw new Error(`signer refused: ${j.reason}`);
  return j.txHash;
}

export async function execute(proposalId: string, opts: { delegation?: Delegation; approvalSig?: Hex } = {}): Promise<ReceiptRecord> {
  const p = proposals.get().proposals[proposalId];
  if (!p) throw new Error("unknown proposal");
  if (p.status === "executed") throw new Error("already executed");
  const allowed = p.tier === "T1" || ((p.tier === "T2" || p.tier === "ASK") && !!opts.approvalSig);
  if (!allowed) throw new Error(`a ${p.tier} proposal cannot be executed by the agent`);
  const st = stateOf(p.principal);
  const ctx = ledgerContext(st.ledger);
  const calldata = redeemCallData([opts.delegation ?? st.delegation!], p.execution!);
  const txHash = await signerRedeem(st.ledger, config(p.principal).agentRole, calldata, { tier: p.tier === "ASK" ? "T2" : p.tier, proposalId, approved: !!opts.approvalSig }, "normal", st.account);
  const rcpt = await ctx.pub.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  const ok = rcpt.status === "success";
  const revert = ok ? undefined : await replayRevert(ctx, txHash);
  const rec = writeReceipt(p, st, ok ? "confirmed" : "reverted", txHash, opts.approvalSig, revert);
  proposals.update((d) => {
    const x = d.proposals[proposalId]!;
    x.status = ok ? "executed" : "refused";
    x.receiptIds.push(rec.receipt.receiptId);
  });
  return rec;
}

/** Judge's Challenge "bypass": push a refused redemption straight to the chain to show it reverts there too. */
export async function bypass(proposalId: string): Promise<ReceiptRecord> {
  const p = proposals.get().proposals[proposalId];
  if (!p || !p.calldata) throw new Error("nothing to bypass");
  if (p.tier !== "T4") throw new Error("bypass only demonstrates refusals (T4)");
  const st = stateOf(p.principal);
  const ctx = ledgerContext(st.ledger);
  const txHash = await signerRedeem(st.ledger, config(p.principal).agentRole, p.calldata, { tier: "T4", proposalId }, "chain-test", st.account);
  const rcpt = await ctx.pub.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  const revert = rcpt.status === "success" ? undefined : await replayRevert(ctx, txHash);
  const rec = writeReceipt(p, st, rcpt.status === "success" ? "confirmed" : "reverted", txHash, undefined, revert);
  proposals.update((d) => {
    d.proposals[proposalId]!.receiptIds.push(rec.receipt.receiptId);
  });
  return rec;
}

function writeReceipt(p: Proposal, st: PrincipalState, outcome: ReceiptRecord["receipt"]["outcome"], txHash?: Hex, approvalSig?: Hex, revert?: DecodedRevert): ReceiptRecord {
  return recordReceipt({
    principal: p.principal,
    ledger: st.ledger,
    proposalId: p.id,
    agentId: st.agentId,
    mandateHash: st.mandateHash!,
    delegationHash: st.delegationHash!,
    tier: p.tier,
    outcome,
    txHash,
    approvalSig,
    documents: {
      intent: p.intent,
      plan: p.plan,
      policy: p.policy ? { tier: p.policy.tier, refusals: p.policy.refusals, reasons: p.policy.reasons, block: p.policy.blockNumber } : undefined,
      stateReads: p.policy?.stateReads,
      counterparty: p.counterparty,
      simulation: p.simulation,
    },
    explanation:
      outcome === "reverted"
        ? { text: `The ledger refused this redemption: ${revert?.message ?? "reverted"}.`, aiGenerated: false }
        : outcome === "confirmed"
          ? { text: p.payment ? `Paid ${formatUnits(BigInt(p.payment.amount), p.payment.decimals)} ${p.payment.symbol} to ${p.payment.payee.label}.` : "Done.", aiGenerated: false }
          : p.explanation,
    aigc: { model: p.understanding.model, provider: p.understanding.provider },
    payment: p.payment ? { ...p.payment, payeeLabel: p.payment.payee.label, payee: p.payment.payee.address } : undefined,
    revertError: revert ?? p.simulation?.revert,
  });
}

// ---------------------------------------------------------------- T0 answers

async function answerQuery(ctx: LedgerContext, st: PrincipalState, kind: string) {
  const m = st.mandate as Mandate;
  if (kind === "query_activity") {
    const recent = receiptLog.all().filter((r) => r.principal === st.id).slice(-5);
    return { kind, text: recent.length ? `Last ${recent.length} actions: ${recent.map((r) => `${r.receipt.outcome} ${r.payment ? `${formatUnits(BigInt(r.payment.amount), r.payment.decimals)} ${r.payment.symbol} to ${r.payment.payeeLabel}` : ""}`.trim()).join("; ")}.` : "No actions yet.", receipts: recent.map((r) => r.receipt.receiptId) };
  }
  const balances = [];
  for (const a of m.assets) {
    const v = await ctx.read<bigint>({ address: a.address as Address, abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [st.account] });
    balances.push({ symbol: a.symbol, decimals: a.decimals, amount: v.toString() });
  }
  return { kind, text: `Your balances: ${balances.map((b) => `${formatUnits(BigInt(b.amount), b.decimals)} ${b.symbol}`).join(", ")}.`, balances };
}

export function proposalHash(p: Proposal): Hex {
  return docHash({ id: p.id, intent: p.intent, tier: p.tier });
}
