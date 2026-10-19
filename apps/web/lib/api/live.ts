/**
 * Live adapter: the agent service at NEXT_PUBLIC_AGENT_API (default https://api.yinglong-agent.tech).
 * Every response is validated with the wire schemas in ./types and mapped into the view model in
 * ./view. A response that does not match the contract is an error, never silently rendered.
 * Endpoints an older service build lacks degrade to a clear error when absent.
 */
import { z } from "zod";
import { ApiRequestError, CONSOLE_PRINCIPAL, type AgentApi } from "./client";
import * as W from "./types";
import { mapProof } from "./proof";
import { activePrincipalId, activeVisitor } from "./session";
import { DIRECTORY_NAMES, type ContractDirectory } from "../account-ops";
import type {
  Amount,
  ApprovalRequest,
  BudgetLane,
  ChallengeAttempt,
  CityAgent,
  CityBatch,
  CityFeed,
  CityPrincipal,
  CityReceipt,
  CitySnapshot,
  CashForecast,
  Coverage,
  Credential,
  CredentialVerification,
  Decision,
  DirectorProposal,
  Escrow,
  Narration,
  SpendingInsights,
  Suitability,
  Ledger,
  LedgerInstruction,
  Mandate,
  MandateRule,
  Principal,
  Receipt,
  RegistryAgent,
  ScaleResult,
  SigningRequest,
  TreasuryEntity,
} from "./view";
import { SCALE_IDS } from "./view";
import { CHAIN_ID } from "../chain";

const VERIFY_COMMAND =
  "uvx --from 'git+https://github.com/ABRUBAB/YINGLONG@v1.0-submission#subdirectory=tools/verify-py' yinglong verify samples/nadia.delegation.json --chain base-sepolia";

const RAIL_NOTE: Record<W.WirePrincipal["jurisdiction"], string> = {
  hk: "Test units on Base Sepolia. Simulation of a regulated instrument; not issued by any licensee.",
  international: "Testnet assets, no monetary value, research demonstration.",
  mainland: "FISCO BCOS consortium ledger. e-CNY-style simulator; not the PBoC sandbox, no connection to any bank.",
};

export const mapLedger = (l: W.WireLedger): Ledger => (l === "anvil" ? "anvil-bench" : l);

const amount = (value: string, decimals: number, symbol: string): Amount => ({ value, decimals, symbol });

function iso(t: string | number | null | undefined): string | null {
  if (t === null || t === undefined) return null;
  if (typeof t === "number") return new Date(t * 1000).toISOString();
  return /^\d+$/.test(t) ? new Date(Number(t) * 1000).toISOString() : t;
}

function detectLanguage(text: string): Decision["input"]["language"] {
  const cps = Array.from(text, (c) => c.codePointAt(0)!);
  const bn = cps.some((c) => c >= 0x0980 && c <= 0x09ff);
  const zh = cps.some((c) => c >= 0x4e00 && c <= 0x9fff);
  const latin = /[A-Za-z]/.test(text);
  if ((bn || zh) && latin) return "mixed";
  return bn ? "bn" : zh ? "zh" : "en";
}

function humanize(kind: string): string {
  const words = kind.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describeModel(m: unknown): string {
  if (!m || typeof m !== "object") return "not reported";
  const o = m as Record<string, unknown>;
  if (typeof o.model === "string") return typeof o.provider === "string" ? `${o.provider} ${o.model}` : o.model;
  if (Array.isArray(o.models) && o.models.length) return String(o.models[0]);
  if (o.url === false) return "rules fallback";
  return "not reported";
}

function stringifyParams(p: Record<string, unknown>): MandateRule["params"] {
  const out: MandateRule["params"] = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "string" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" || typeof v === "bigint") out[k] = String(v);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
    else out[k] = JSON.stringify(v);
  }
  return out;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** "allowedTargets" -> "AllowedTargetsEnforcer" (the service sends the enforcer address and the rule kind). */
function enforcerName(kind: string): string {
  const pascal = kind.replace(/[-_ ]+(\w)/g, (_, c: string) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());
  return pascal.endsWith("Enforcer") ? pascal : `${pascal}Enforcer`;
}

function mapRules(rules: W.WireRule[]): MandateRule[] {
  return rules.map((r, i) => {
    const byField = ADDRESS.test(r.enforcer);
    const paramAddr = typeof r.params.enforcer === "string" && ADDRESS.test(r.params.enforcer) ? r.params.enforcer : null;
    const params = stringifyParams(Object.fromEntries(Object.entries(r.params).filter(([k]) => k !== "kind")));
    return {
      id: `${r.kind}-${i}`,
      sentence: r.sentence,
      enforcer: byField ? enforcerName(r.kind) : r.enforcer,
      enforcerAddress: byField ? r.enforcer : paramAddr,
      params,
      tierCeiling: null,
    };
  });
}

function mapHashRing(h: W.WireHashRing) {
  return { ticks: h.ticks.map(({ i, angleDeg, r0, r1 }) => ({ i, angleDeg, r0, r1 })), arcs: h.arcs };
}

function mapMandate(m: W.WireMandateView, ownerName: string, agentId: string, badge?: string | null): Mandate {
  const ledger = mapLedger(m.ledger);
  const version = Math.max(1, m.version ?? 1);
  return {
    id: m.mandateHash,
    mandateHash: m.mandateHash,
    delegationHash: m.delegationHash,
    version,
    status: m.status ?? "live",
    jurisdiction: m.jurisdiction,
    title: m.version ? `Mandate v${m.version}` : `Mandate ${m.lineageId}`,
    ownerName,
    agentId,
    rules: mapRules(m.rules),
    decodedSentences: m.roundTrip.sentences ?? m.sentences,
    roundTrip: m.roundTrip.checks.map((c) => ({ id: c.name, label: c.detail ? `${c.name}: ${c.detail}` : c.name, passed: c.ok })),
    validity: { notBefore: iso(m.validFrom)!, notAfter: iso(m.validUntil)! },
    sealedAt: iso(m.sealedAt ?? null),
    published: m.publishTx
      ? [{ ledger, chainId: CHAIN_ID[ledger], txHash: m.publishTx, explorerUrl: m.explorerUrl ?? null, badge: badge ?? null }]
      : [],
    supersedes: null,
    sourceText: m.userSentences.length ? m.userSentences.join(" ") : null,
    serviceHashRing: mapHashRing(m.hashRing),
  };
}

const payeeLabel = (p: W.WirePayment) => (typeof p.payee === "string" ? (p.payeeLabel ?? p.payee) : p.payee.label);
const payeeAddress = (p: W.WirePayment) => (typeof p.payee === "string" ? p.payee : (p.payee.address ?? null));
const payeeId = (p: W.WirePayment) => (typeof p.payee === "string" ? null : (p.payee.id ?? null));

function summarize(payment: W.WirePayment | null | undefined, fallback: string): string {
  if (!payment) return fallback;
  const m = payment.method.toLowerCase();
  const verb =
    m.includes("deposit") || m.includes("escrow") || m.includes("transferandcall")
      ? "Escrow or rail payment to"
      : m.includes("instruct")
        ? "Payment instruction to"
        : m.includes("sweep")
          ? "Sweep to"
          : m.includes("convert")
            ? "Conversion with"
            : "Payment to";
  return `${verb} ${payeeLabel(payment)}`;
}

function errorName(e: W.WireReceipt["revertError"] | string | null | undefined): string | null {
  const raw = typeof e === "string" ? e : e?.name;
  if (!raw) return null;
  const name = raw.split("(")[0]!.trim();
  return /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : null;
}

function mapReceipt(r: W.WireReceipt): Receipt {
  const ledger = mapLedger(r.ledger);
  const executed = r.outcome === "confirmed";
  return {
    receiptId: r.receiptId,
    receiptHash: r.receiptHash,
    chainId: r.chainId,
    ledger,
    ledgerBadge: r.ledgerBadge ?? null,
    agentId: r.agentId,
    mandateHash: r.mandateHash,
    delegationHash: r.delegationHash,
    intentHash: r.intentHash,
    tier: r.tier,
    txHash: r.txHash && !/^0x0{64}$/.test(r.txHash) ? r.txHash : null,
    explorerUrl: r.explorerUrl ?? null,
    outcome: r.outcome,
    // A confirmed receipt may carry the revert of an earlier attempt (e.g. CoSignRequired before approval).
    revertError: executed ? null : errorName(r.revertError),
    explanation: r.explanation.text,
    aigc: r.explanation.aiGenerated ? { label: "AI-generated", model: r.explanation.model ?? r.aigc.model, provider: r.aigc.provider ?? undefined } : null,
    timestamp: iso(r.timestamp)!,
    prevReceiptHash: r.prevReceiptHash,
    anchor: r.anchor ? { root: r.anchor.root, baseTx: r.anchor.base?.txHash ?? null, fiscoTx: r.anchor.fisco?.txHash ?? null } : null,
    summary: summarize(
      r.payment,
      r.outcome === "asked"
        ? "Ying stopped and asked you"
        : r.tier === "T0"
          ? "Read-only answer"
          : /^paused\b/i.test(r.explanation.text)
            ? "Paused the agent (kill switch)"
            : /^resumed\b/i.test(r.explanation.text)
              ? "Resumed the agent"
              : /^revoked the mandate/i.test(r.explanation.text)
                ? "Revoked the mandate"
                : /^mandate sealed/i.test(r.explanation.text)
                  ? /scripted/i.test(r.explanation.text)
                    ? "Mandate sealed (scripted passkey)"
                    : "Mandate sealed with your passkey"
                  : "Agent action",
    ),
    payeeName: r.payment ? payeeLabel(r.payment) : null,
    amount: r.payment ? amount(r.payment.amount, r.payment.decimals, r.payment.symbol) : null,
    category: null,
  };
}

function isPromiseLike<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as Promise<T>)?.then === "function";
}

function mapAttempt(a: z.infer<typeof W.WireChallengeAttempt>): ChallengeAttempt {
  const ledger = a.ledger ? mapLedger(a.ledger) : null;
  const typed = a.typedError ? (a.typedError.split("(")[0] ?? "").trim() : null;
  return {
    id: a.id,
    at: iso(a.at)!,
    handle: a.handle.slice(0, 32),
    family: a.family,
    stoppedAt: a.stoppedAt ? SCALE_IDS[a.stoppedAt - 1]! : null,
    outcome: a.outcome,
    error: typed && /^[A-Z][A-Za-z0-9]*$/.test(typed) ? typed : null,
    revert: a.txHash && ledger ? { ledger, chainId: CHAIN_ID[ledger], txHash: a.txHash, explorerUrl: a.explorerUrl ?? null } : null,
    proposalId: a.proposalId ?? null,
  };
}

function ledgerOfDomain(td: W.WireTypedData): { ledger: Ledger; chainId: number } {
  const raw = td.domain.chainId;
  const chainId = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;
  const ledger: Ledger = chainId === 84532 ? "base-sepolia" : chainId === 31337 ? "anvil-bench" : "fisco";
  return { ledger, chainId };
}

function mapApproval(a: W.WireApproval, payees: W.WirePrincipalState["payees"] = []): ApprovalRequest {
  const { ledger, chainId } = ledgerOfDomain(a.typedData);
  const d = a.decoded;
  const book = d?.payeeAddress ? payees.find((p) => p.address.toLowerCase() === d.payeeAddress!.toLowerCase()) : undefined;
  return {
    id: a.id,
    kind: a.kind,
    // The service keeps an unsigned request "pending" after its deadline; past expiry it can no longer be used.
    status: a.status === "signed" ? "approved" : a.status === "pending" && Date.parse(iso(a.expiresAt)!) < Date.now() ? "expired" : a.status,
    expiresAt: iso(a.expiresAt)!,
    tier: a.kind === "cosign" ? "T2" : a.kind === "seal" || a.kind === "resume" || a.kind === "revoke" ? "T3" : null,
    ledger,
    chainId,
    digest: a.digest,
    typedData: a.typedData,
    execution: a.execution ?? null,
    decoded: d
      ? {
          target: d.target,
          targetName: d.targetLabel,
          method: d.method,
          args: [],
          payee: d.payeeLabel && d.payeeLabel.trim()
            ? {
                id: book?.id ?? null,
                name: book?.label ?? d.payeeLabel,
                address: d.payeeAddress ?? null,
                source: book ? "PayeeBook" : "agent service",
                verified: Boolean(book),
              }
            : null,
          amount: d.amount != null && d.symbol ? amount(d.amount, d.decimals ?? 0, d.symbol) : null,
        }
      : null,
    reason: a.reason ?? null,
    explanation: a.explanation?.text ?? null,
    aigc: a.explanation?.aiGenerated ? { label: "AI-generated", model: a.explanation.model ?? "unknown" } : null,
    principal: a.principal,
  };
}

function toSigning(a: W.WireApproval, kind: SigningRequest["kind"] = a.kind): SigningRequest {
  return { id: a.id, kind, digest: a.digest, typedData: a.typedData, expiresAt: iso(a.expiresAt)! };
}

function periodOf(seconds: number): BudgetLane["period"] {
  if (Math.abs(seconds - 86_400) < 60) return "day";
  if (Math.abs(seconds - 604_800) < 600) return "week";
  if (seconds >= 2_419_200 && seconds <= 2_678_400) return "month";
  return "window";
}

function mapLanes(s: W.WirePrincipalState): BudgetLane[] {
  const dec = (symbol: string) => s.balances.find((b) => b.symbol === symbol)?.decimals ?? 6;
  const lanes: BudgetLane[] = s.budgets.map((b) => ({
    id: `${b.symbol}:${b.category}`,
    category: b.category,
    label: b.category.charAt(0).toUpperCase() + b.category.slice(1),
    cap: amount(b.cap, b.decimals ?? dec(b.symbol), b.symbol),
    spent: amount(b.spent, b.decimals ?? dec(b.symbol), b.symbol),
    period: periodOf(Number(b.periodLengthSeconds)),
    periodEnd: iso(b.periodEndsAt),
    floor: null,
    breachForecastDays: null,
    enforcer: "CategoryBudgetEnforcer",
  }));
  if (s.velocity && s.velocity.outflow != null) {
    const v = { ...s.velocity, outflow: s.velocity.outflow };
    const floor = s.reserveFloors.find((f) => f.symbol === v.symbol);
    lanes.push({
      id: `${v.symbol}:velocity`,
      category: "velocity",
      label: Number(v.windowSeconds) === 86_400 ? "Out today" : "Out in window",
      cap: amount(v.maxOutflow, dec(v.symbol), v.symbol),
      spent: amount(v.outflow, dec(v.symbol), v.symbol),
      period: periodOf(Number(v.windowSeconds)),
      periodEnd: null,
      floor: floor ? amount(floor.amount, dec(floor.symbol), floor.symbol) : null,
      breachForecastDays: null,
      enforcer: floor ? "VelocityEnforcer + ReserveFloorEnforcer" : "VelocityEnforcer",
    });
  }
  return lanes;
}

function mapDecision(p: W.WireProposal): Decision {
  const byN = new Map(p.scales.map((s) => [s.n, s]));
  const scales: ScaleResult[] = SCALE_IDS.map((id, k) => {
    const s = byN.get(k + 1);
    if (!s) return { scale: id, status: "skipped", reason: null, error: null, durationMs: null, revert: null };
    const err = s.typedError && /^[A-Z][A-Za-z0-9]*$/.test(s.typedError) ? s.typedError : null;
    // Real per-check timings (absent on older servers: null, never a stand-in).
    const durationMs = typeof s.ms === "number" && Number.isFinite(s.ms) && s.ms >= 0 ? Math.round(s.ms) : null;
    const unit = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null);
    return { scale: id, status: s.status, reason: s.reason ?? null, error: err, durationMs, revert: null, score: unit(s.score), threshold: unit(s.threshold) };
  });
  const policy = z.object({ refusals: z.array(z.object({ rule: z.string().nullish(), typedError: z.string().nullish(), detail: z.string().nullish() })).nullish() }).safeParse(p.policy);
  const refusals = policy.success ? (policy.data.refusals ?? []).map((r) => ({ rule: r.rule ?? null, typedError: r.typedError ?? null, detail: r.detail ?? null })) : [];
  const rev = W.WireRevertError.safeParse(p.simulation?.revert);
  const revert = rev.success ? { name: rev.data.name, args: rev.data.args ?? null, message: rev.data.message ?? null } : null;
  const intentObj = p.intent as Record<string, unknown> | string | null;
  const summary =
    typeof intentObj === "string"
      ? intentObj
      : typeof intentObj?.summary === "string"
        ? intentObj.summary
        : p.payment
          ? summarize(p.payment, p.request)
          : typeof intentObj?.kind === "string"
            ? humanize(intentObj.kind)
            : (p.plan[0]?.description ?? p.request);
  const pay = p.payment;
  const outcome: Decision["outcome"] =
    p.decision === "answered"
      ? "observed"
      : p.decision === "execute"
      ? p.tier === "T0"
        ? "observed"
        : p.status === "executed"
          ? "executed"
          : "executable"
      : p.decision === "needs_approval"
        ? "awaiting_approval"
        : p.decision === "ask"
          ? "asking"
          : p.tier === "T3"
            ? "reserved"
            : "refused";
  const lang = p.language && ["en", "bn", "zh", "mixed"].includes(p.language) ? (p.language as Decision["input"]["language"]) : detectLanguage(p.request);
  return {
    proposalId: p.id,
    createdAt: iso(p.createdAt)!,
    input: { text: p.request, language: lang },
    intent: {
      action: pay ? (/deposit|escrow/i.test(pay.method) ? "escrow" : /sweep/i.test(pay.method) ? "sweep" : /convert/i.test(pay.method) ? "convert" : "pay") : p.tier === "T0" ? "observe" : "other",
      summary,
      payeeId: pay ? payeeId(pay) : null,
      payeeName: pay ? payeeLabel(pay) : null,
      amount: pay ? amount(pay.amount, pay.decimals, pay.symbol) : null,
      category: null,
      intentHash: null,
    },
    plan: p.plan.map((s) => s.description),
    tier: p.tier,
    scales,
    outcome,
    question: p.decision === "ask" ? p.explanation.text : null,
    explanation: p.answer?.text ?? p.explanation.text,
    aigc: p.explanation.aiGenerated ? { label: "AI-generated", model: p.explanation.model ?? "unknown" } : null,
    approvalId: p.approvalId ?? null,
    receiptId: p.receiptIds?.[0] ?? null,
    suitability: p.suitability ? mapSuitability(p.suitability) : null,
    refusals,
    revert,
    raw: p,
  };
}

function mapSuitability(x: z.infer<typeof W.WireSuitability>): Suitability {
  return {
    product: {
      id: x.product.id ?? null,
      label: x.product.label,
      address: x.product.address,
      onChainName: x.product.onChainName ?? null,
      nameMatchesRegistry: x.product.nameMatchesRegistry ?? null,
    },
    listed: x.listed,
    riskClass: x.riskClass,
    riskLabel: x.riskLabel,
    mandateMaxRiskClass: x.mandateMaxRiskClass,
    mandateMaxLabel: x.mandateMaxLabel,
    verdict: x.verdict,
    outcome: x.outcome,
    why: x.why,
    source: { ...x.source, block: String(x.source.block), ledger: mapLedger(x.source.ledger) },
    label: x.label,
  };
}

function mapNarration(n: z.infer<typeof W.WireNarration>): Narration {
  return {
    text: n.text,
    aiGenerated: n.aiGenerated,
    label: n.label ?? (n.aiGenerated ? "AI-generated" : "template text (deterministic)"),
    model: n.model ?? (n.aiGenerated ? "not reported" : "none (template)"),
    provider: n.provider ?? "",
    fallbackReason: n.fallbackReason ?? null,
  };
}

const blockOf = (b: string | number | null | undefined) => (b === null || b === undefined ? null : String(b));

function mapEscrow(e: W.WireEscrow): Escrow {
  return {
    escrowId: e.escrowId,
    ledger: mapLedger(e.ledger),
    payee: { id: e.payee.id ?? null, label: e.payee.label, address: e.payee.address },
    amount: amount(e.amount, e.token.decimals, e.token.symbol),
    conditionId: e.conditionId,
    releaseAttester: e.releaseAttester,
    createdAt: iso(e.createdAt)!,
    refundAfter: iso(e.refundAfter)!,
    state: e.state,
    canRelease: e.canRelease,
    canRefundNow: e.canRefundNow,
    fundingReceiptId: e.fundingReceiptId ?? null,
  };
}

function mapCredential(c: W.WireCredential): Credential {
  const m = c.typedData.message;
  return {
    id: c.id,
    ledger: mapLedger(c.ledger),
    issuer: c.issuer,
    issuerLabel: c.issuerLabel,
    subject: m.subject,
    onTimePayments: Number(m.onTimePayments),
    periodStart: iso(m.periodStart)!,
    periodEnd: iso(m.periodEnd)!,
    receiptIds: m.receiptIds,
    statement: m.statement,
    signature: c.signature,
    anchorReceiptId: c.anchorReceiptId ?? null,
    rule: c.rule,
    label: c.label,
    issuedAt: iso(c.issuedAt)!,
  };
}

function mapVerification(v: z.infer<typeof W.WireCredentialVerification>): CredentialVerification {
  return {
    credentialHash: v.credentialHash,
    valid: v.valid,
    signatureValid: v.signatureValid,
    recovered: v.recovered ?? null,
    issuer: v.issuer ?? null,
    issuerLabel: v.issuerLabel,
    trustedIssuer: v.trustedIssuer,
    receipts: v.receipts.map((r) => ({
      receiptId: r.receiptId,
      found: r.found,
      intact: r.intact ?? null,
      confirmed: r.confirmed ?? null,
      toRentPayee: r.toRentPayee ?? null,
      ownReceipt: r.ownReceipt ?? null,
      txHash: r.txHash ?? null,
      ledger: r.ledger ? mapLedger(r.ledger) : null,
      ok: r.ok,
    })),
    anchorReceiptId: v.anchorReceiptId ?? null,
    anchorCommitsCredential: v.anchorCommitsCredential,
    label: v.label,
  };
}

function mapInsights(x: z.infer<typeof W.WireInsights>): SpendingInsights {
  return {
    period: x.period,
    categories: x.categories.map((c) => ({
      category: c.category,
      kind: c.kind,
      cap: amount(c.cap, c.decimals, c.symbol),
      spent: amount(c.spent, c.decimals, c.symbol),
      remaining: amount(c.remaining, c.decimals, c.symbol),
      usedBps: c.usedBps,
      forecast: amount(c.forecastPeriodEnd, c.decimals, c.symbol),
      forecastMethod: c.forecastMethod,
      wouldReachCapAt: c.wouldReachCapAt ? iso(c.wouldReachCapAt) : null,
      status: c.status,
    })),
    topPayees: x.topPayees.map((t) => ({ label: t.label, address: t.address, amount: amount(t.amount, t.decimals, t.symbol), payments: t.payments, receiptIds: t.receiptIds })),
    totals: x.totals.map((t) => ({ cap: amount(t.cap, t.decimals, t.symbol), spent: amount(t.spent, t.decimals, t.symbol), forecast: amount(t.forecastPeriodEnd, t.decimals, t.symbol) })),
    explanation: mapNarration(x.explanation),
    ledger: mapLedger(x.ledger),
    block: blockOf(x.block),
    label: x.label,
  };
}

function mapForecast(f: z.infer<typeof W.WireForecast>): CashForecast {
  const a = (v: string) => amount(v, f.decimals, f.symbol);
  return {
    symbol: f.symbol,
    decimals: f.decimals,
    horizonDays: f.horizonDays,
    rail: f.rail,
    start: { posted: a(f.start.posted), pending: a(f.start.pending) },
    reserveFloor: a(f.reserveFloor),
    minBalance: f.minBalance,
    headroomAboveFloor: f.headroomAboveFloor,
    supplierRunRatePerDay: a(f.supplierRunRatePerDay),
    events: f.events.map((e) => ({ day: e.day, date: iso(e.date)!, kind: e.kind, label: e.label, amount: a(e.amount) })),
    daily: f.daily.map((d) => ({ day: d.day, date: iso(d.date)!, outflow: d.outflow, balance: d.balance, belowFloor: d.belowFloor })),
    firstBreach: f.firstBreach ? { ...f.firstBreach, date: iso(f.firstBreach.date)! } : null,
    velocity: f.velocity
      ? {
          windowEndsAt: iso(f.velocity.windowEndsAt)!,
          maxCount: f.velocity.maxCount,
          used: f.velocity.used,
          countLeft: f.velocity.countLeft,
          maxOutflow: a(f.velocity.maxOutflow),
          outflow: a(f.velocity.outflow),
          outflowLeft: a(f.velocity.outflowLeft),
        }
      : null,
    flags: f.flags,
    explanation: mapNarration(f.explanation),
    label: f.label,
    ledger: mapLedger(f.ledger),
    block: blockOf(f.block),
    modelBands: f.modelBands ? { model: f.modelBands.model, label: f.modelBands.label, pBreach14d: f.modelBands.pBreach14d ?? null, days: f.modelBands.days } : null,
  };
}

function mapInstruction(r: Receipt): LedgerInstruction {
  return {
    id: r.receiptId,
    instructionHash: (r.receiptHash ?? r.intentHash) as string,
    kind: r.summary.split(" ")[0]?.toLowerCase() ?? "transfer",
    payeeName: r.payeeName ?? r.summary,
    amount: r.amount,
    condition: null,
    status:
      r.outcome === "confirmed" ? "executed" : r.outcome === "reverted" || r.outcome === "rejected_policy" ? "rejected" : "pending",
    rejectError: r.revertError,
    tx: r.txHash ? { ledger: r.ledger, chainId: r.chainId, txHash: r.txHash, explorerUrl: r.explorerUrl } : null,
    createdAt: r.timestamp,
    anchor: r.anchor ? { status: "anchored", root: r.anchor.root, baseTx: r.anchor.baseTx } : { status: "pending", root: null, baseTx: null },
  };
}

export function createLiveApi(baseUrl: string): AgentApi {
  const root = baseUrl.replace(/\/+$/, "");
  const enc = encodeURIComponent;

  // The service rate-limits per IP (60 requests a minute by default). Identical GETs issued by several
  // views at once share one request, and a GET answered in the last few seconds is reused; any POST
  // clears the cache because it may have changed what the next read returns.
  const GET_TTL_MS = 4000;
  const cache = new Map<string, { at: number; json: Promise<{ ok: boolean; status: number; json: unknown }> }>();

  async function fetchJson(method: "GET" | "POST", path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    if (method === "POST") cache.clear();
    const now = Date.now();
    const hit = method === "GET" ? cache.get(path) : undefined;
    if (hit && now - hit.at < GET_TTL_MS) return hit.json;
    // A visitor's own actions (ask with autoExecute, execute, bypass, decline, attack) carry the session
    // token the service issued at sign-up. Reads stay simple requests (no preflight, no token).
    const visitor = method === "POST" ? activeVisitor() : null;
    const headers: Record<string, string> = {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(visitor ? { "x-visitor-token": visitor.token } : {}),
      ...extraHeaders,
    };
    const run = (async () => {
      let res: Response;
      try {
        res = await fetch(`${root}${path}`, {
          method,
          credentials: "omit",
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          cache: "no-store",
        });
      } catch {
        cache.delete(path);
        throw new ApiRequestError(`The agent service at ${root} could not be reached.`, 0, "unreachable");
      }
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) cache.delete(path);
      return { ok: res.ok, status: res.status, json };
    })();
    if (method === "GET") cache.set(path, { at: now, json: run });
    return run;
  }

  async function call<T extends z.ZodType>(schema: T, method: "GET" | "POST", path: string, body?: unknown, headers?: Record<string, string>): Promise<z.infer<T>> {
    const res = await fetchJson(method, path, body, headers);
    const json = res.json;
    if (!res.ok) {
      const parsed = W.WireError.safeParse(json);
      if (parsed.success) {
        const e = parsed.data.error;
        if (typeof e === "string") {
          const typed = /\b([A-Z][A-Za-z0-9]+)\(/.exec(e)?.[1] ?? null;
          throw new ApiRequestError(e.length > 240 ? `${e.slice(0, 240)}...` : e, res.status, res.status === 403 ? "operator_only" : "service_error", typed);
        }
        throw new ApiRequestError(e.message, res.status, e.code, e.typedError ?? null);
      }
      if (res.status === 404) throw new ApiRequestError(`The agent service does not provide ${path} yet.`, 404, "not_found");
      throw new ApiRequestError(`Request to ${path} failed with status ${res.status}.`, res.status, "http_error");
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiRequestError(`The response from ${path} does not match the API contract.`, res.status, "contract_mismatch");
    return parsed.data;
  }

  const principals = () => call(z.array(W.WirePrincipal), "GET", "/v1/principals");
  const stateOf = (id: string) => call(W.WirePrincipalState, "GET", `/v1/principals/${enc(id)}/state`);
  const approvalOf = (id: string) => call(W.WireApproval, "GET", `/v1/approvals/${enc(id)}`);
  const receiptsOf = async (principal: string, limit = 50) =>
    // The service returns the append-only log in order; every screen lists receipts newest first.
    (await call(z.array(W.WireReceipt), "GET", `/v1/receipts?principal=${enc(principal)}&limit=${limit}`))
      .map(mapReceipt)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  /** The principal the console acts for: the visitor signed up on this device, else Nadia. */
  const cp = () => activePrincipalId();

  async function consolePrincipal(): Promise<W.WirePrincipal> {
    const id = cp();
    if (id !== CONSOLE_PRINCIPAL) {
      // Visitors are not in GET /v1/principals; their summary comes with their state.
      return (await stateOf(id)).principal;
    }
    const all = await principals();
    const p = all.find((x) => x.id === CONSOLE_PRINCIPAL) ?? all.find((x) => x.kind === "person");
    if (!p) throw new ApiRequestError("The agent service lists no personal principal.", 404, "no_principal");
    return p;
  }

  /** Deployment directory per wire ledger name, from /v1/evidence `contracts`. */
  async function directoryOf(ledger: string): Promise<ContractDirectory> {
    const ev = await call(W.WireEvidence, "GET", "/v1/evidence");
    const wire = ledger === "anvil-bench" ? "anvil" : ledger;
    const dir: ContractDirectory = { ledger: wire };
    for (const c of ev.contracts ?? []) {
      if (c.ledger !== wire) continue;
      const name = (DIRECTORY_NAMES as readonly string[]).find((n) => c.name === n || c.name.startsWith(`${n} `));
      if (name && !dir[name as (typeof DIRECTORY_NAMES)[number]]) dir[name as (typeof DIRECTORY_NAMES)[number]] = c.address as `0x${string}`;
    }
    return dir;
  }

  /**
   * Whether the mandate is still live. The service's MandateView carries `live` once it is added
   * (MandateRegistry.isLive); until then a confirmed revoke receipt for this mandate hash says it.
   */
  async function mandateStatus(principalId: string, m: W.WireMandateView): Promise<Mandate["status"]> {
    if (m.status) return m.status;
    if (m.live === false) return "revoked";
    if (m.live === true) return "live";
    const recent = await receiptsOf(principalId, 30).catch(() => [] as Receipt[]);
    const revoked = recent.some(
      (r) => r.outcome === "confirmed" && r.mandateHash.toLowerCase() === m.mandateHash.toLowerCase() && /^revoked the mandate/i.test(r.explanation),
    );
    return revoked ? "revoked" : "live";
  }

  function toPrincipal(p: W.WirePrincipal): Principal {
    return {
      id: p.id,
      kind: p.kind,
      did: p.did,
      displayName: p.name,
      account: p.account,
      ledger: mapLedger(p.ledger),
      ledgerBadge: p.ledgerBadge ?? null,
      agentId: p.agent.agentId,
      agentName: p.agent.label,
      jurisdiction: p.jurisdiction,
      signer: p.signer,
      paused: p.paused,
      passkeys: (p.passkeyIds ?? []).map((keyId, i) => ({ keyId, label: `Passkey ${i + 1}` })),
    };
  }

  async function entityOf(p: W.WirePrincipal): Promise<TreasuryEntity> {
    const m = /(\d+)\s*-?\s*of\s*-?\s*(\d+)/i.exec(p.signer);
    const threshold = m ? Number(m[1]) : 2;
    const n = m ? Number(m[2]) : 3;
    return {
      id: p.id,
      name: p.name,
      jurisdiction: p.jurisdiction,
      rail: { label: p.jurisdiction === "mainland" ? "Coin-free rail" : "HK test rail", ledger: mapLedger(p.ledger), note: RAIL_NOTE[p.jurisdiction] },
      agentName: p.agent.label,
      directors: Array.from({ length: n }, (_, i) => ({ id: `director-${i + 1}`, name: `Director ${i + 1}` })),
      threshold,
    };
  }

  async function signedResult(requestId: string, receipt: W.WireReceipt | null) {
    const a = await approvalOf(requestId).catch(() => null);
    const approval: ApprovalRequest = a
      ? mapApproval(a)
      : {
          id: requestId,
          kind: "cosign",
          status: "approved",
          expiresAt: new Date().toISOString(),
          tier: null,
          ledger: "base-sepolia",
          chainId: 84532,
          digest: `0x${"0".repeat(64)}`,
          typedData: { domain: {}, types: {}, primaryType: "Approval", message: {} },
          execution: null,
          decoded: null,
          reason: null,
          explanation: null,
          aigc: null,
        };
    return { approval, receipt: receipt ? mapReceipt(receipt) : null };
  }

  /** Agent City: how many of the most recent visitors get their own row (each costs one state read). */
  const CITY_VISITORS = 6;

  // The anchoring relayer (apps/indexer) answers on the same host. When the browser cannot read it
  // (network or CORS), stop asking for this page view: the city renders without batches and says so.
  let batchesBlocked = false;
  async function cityFeed(): Promise<CityFeed> {
    const [wire, batches] = await Promise.all([
      call(z.array(W.WireReceipt), "GET", "/v1/receipts?limit=200"),
      batchesBlocked
        ? null
        : call(W.WireBatches, "GET", "/batches").catch((e: unknown) => {
            if (e instanceof ApiRequestError && e.status === 0) batchesBlocked = true;
            return null;
          }),
    ]);
    const receipts: CityReceipt[] = wire
      .filter((r) => r.source !== "anvil-bench")
      .map((r) => {
        const v = mapReceipt(r);
        return {
          receiptId: v.receiptId,
          principal: r.principal,
          agentId: v.agentId,
          ledger: v.ledger,
          ledgerBadge: v.ledgerBadge,
          tier: v.tier,
          outcome: v.outcome,
          revertError: v.revertError,
          txHash: v.txHash,
          explorerUrl: v.explorerUrl,
          timestamp: v.timestamp,
          summary: v.summary,
          explanation: v.explanation,
          payee: r.payment ? { label: payeeLabel(r.payment), address: payeeAddress(r.payment) } : null,
          amount: v.amount,
          method: r.payment?.method ?? null,
        };
      })
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const mapped: CityBatch[] = (batches?.batches ?? []).map((b) => ({
      batchId: b.batchId,
      root: b.root,
      count: b.count,
      createdAt: iso(b.createdAt)!,
      anchors: b.anchors.map((a) => ({ ledger: mapLedger(a.ledger), txHash: a.txHash, blockNumber: a.blockNumber == null ? null : String(a.blockNumber) })),
      crossAnchors: (b.crossAnchors ?? []).map((c) => ({ onLedger: mapLedger(c.onLedger), remoteLedger: mapLedger(c.remoteLedger), txHash: c.txHash })),
    }));
    return { fetchedAt: new Date().toISOString(), receipts, batches: mapped, batchesReadable: batches !== null };
  }

  const api: AgentApi = {
    mode: "live",
    baseUrl: root,

    health: async () => {
      const h = await call(W.WireHealth, "GET", "/v1/health");
      return {
        ok: h.ok,
        version: h.version,
        ledgers: h.ledgers.map((l) => ({
          ledger: mapLedger(l.name),
          chainId: l.chainId ?? 0,
          block: l.ok === false ? "unreachable" : String(l.block ?? "unknown"),
          badge: l.badge ?? l.name,
        })),
        models: { intent: describeModel(h.models.intent), sentinel: describeModel(h.models.sentinel) },
      };
    },
    me: async () => toPrincipal(await consolePrincipal()),
    passport: async (agentId) => {
      const [all, reg] = await Promise.all([principals(), call(z.array(W.WireRegistryAgent), "GET", "/v1/registry/agents")]);
      const p = all.find((x) => x.agent.agentId === agentId);
      const r = reg.find((x) => x.agentId === agentId);
      if (!p && !r) throw new ApiRequestError(`Agent ${agentId} is not registered.`, 404, "not_found");
      const now = Date.now();
      return {
        agentId,
        agentName: p?.agent.label ?? r!.label,
        agentWallet: p?.agent.wallet ?? r!.wallet,
        ownerDid: p?.did ?? r!.ownerDidHash,
        ownerName: p?.name ?? "Unknown owner",
        identityCode: {
          value: p?.agent.identityCode ?? r?.identityCode ?? "none",
          placeholder: true,
          label: "Placeholder: no GB/Z 185 identity code has been issued",
        },
        attestations: (r?.attestations ?? []).map((a) => {
          const exp = iso(a.expiresAt);
          return {
            id: a.claimHash,
            issuerName: a.issuerLabel,
            issuerDid: a.issuer,
            kind: "attestation",
            trusted: true,
            status: exp && Date.parse(exp) < now ? "expired" : "valid",
            expiresAt: exp,
            tx: null,
          } as const;
        }),
        status: p ? (p.agent.passportStatus === "halted" ? "paused" : p.agent.passportStatus) : (r!.attestations ?? []).length ? "active" : "self-registered",
        reputation: null,
        provenance: null,
      };
    },

    mandates: async () => {
      const p = await consolePrincipal();
      const s = await stateOf(p.id);
      if (!s.mandate) return [];
      const status = await mandateStatus(p.id, s.mandate);
      return [{ ...mapMandate(s.mandate, p.name, p.agent.agentId, p.ledgerBadge), status }];
    },
    mandate: async (hash) => {
      const [p, m] = await Promise.all([consolePrincipal(), call(W.WireMandateView, "GET", `/v1/mandates/${enc(hash)}`)]);
      return mapMandate(m, p.name, p.agent.agentId, p.ledgerBadge);
    },
    compileMandate: async (req) => {
      // The service compiles mandate documents (yinglong.mandate/v1). Drafting one from free text is a
      // requested addition (POST /v1/mandates/draft), and so is reading the sealed document back
      // (GET /v1/principals/:id/mandate). Without either, the studio shows the sealed mandate exactly as
      // the state response decodes it from the chain, and sealing stays unavailable.
      const norm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
      const missing = (e: unknown) => e instanceof ApiRequestError && (e.status === 404 || e.status === 400);
      const lines = (rules: Mandate["rules"], decoded: string[]) =>
        rules.map((rule, i) => ({
          ruleId: rule.id,
          compiled: rule.sentence,
          decoded: decoded[i] ?? "",
          matches: decoded[i] !== undefined && norm(rule.sentence) === norm(decoded[i]!),
        }));
      let doc: unknown = null;
      const warnings: string[] = [];
      try {
        doc = (await call(z.object({ mandate: z.unknown() }), "POST", "/v1/mandates/draft", { principal: cp(), text: req.text, jurisdiction: req.jurisdiction })).mandate;
      } catch (e) {
        if (!missing(e)) throw e;
        try {
          doc = await call(z.unknown(), "GET", `/v1/principals/${enc(cp())}/mandate`);
          warnings.push("The agent service does not draft mandates from free text yet, so this preview compiles the sealed mandate document unchanged.");
        } catch (e2) {
          if (!missing(e2)) throw e2;
          const m = (await stateOf(cp())).mandate;
          if (!m) throw new ApiRequestError("The agent service does not draft mandates from free text yet, and this principal has no sealed mandate to show.", 404, "not_found");
          const rules = mapRules(m.rules);
          return {
            draftId: m.mandateHash,
            jurisdiction: req.jurisdiction,
            rules,
            delegationHash: m.delegationHash,
            mandateHash: m.mandateHash,
            roundTrip: lines(rules, m.roundTrip.sentences ?? m.sentences),
            checks: m.roundTrip.checks.map((c) => ({ id: c.name, label: c.detail ? `${c.name}: ${c.detail}` : c.name, passed: c.ok })),
            warnings: [
              "The agent service does not draft mandates from free text yet. This shows your sealed mandate as the service decodes it from the chain; nothing new can be sealed from here.",
            ],
            language: detectLanguage(req.text),
            serviceHashRing: mapHashRing(m.hashRing),
            wire: undefined,
          };
        }
      }
      const r = await call(W.WireCompileResult, "POST", "/v1/mandates/compile", { principal: cp(), mandate: doc });
      const rules = mapRules(r.rules);
      const decoded = r.roundTrip?.sentences ?? r.sentences;
      return {
        draftId: r.mandateHash,
        jurisdiction: req.jurisdiction,
        rules,
        delegationHash: r.delegationHash,
        mandateHash: r.mandateHash,
        roundTrip: lines(rules, decoded),
        checks: r.roundTrip
          ? r.roundTrip.checks.map((c) => ({ id: c.name, label: c.detail ? `${c.name}: ${c.detail}` : c.name, passed: c.ok }))
          : [{ id: "decode", label: "Every caveat decodes back to the sentence shown", passed: rules.every((rule, i) => decoded[i] !== undefined && norm(rule.sentence) === norm(decoded[i]!)) }],
        warnings,
        language: detectLanguage(req.text),
        serviceHashRing: mapHashRing(r.hashRing),
        wire: r.mandate,
      };
    },
    requestSeal: async (draft) => {
      if (draft.wire === undefined) throw new ApiRequestError("This preview shows the sealed mandate; there is no new mandate document to seal.", 409, "nothing_to_seal");
      const { approvalId } = await call(W.WireApprovalRef, "POST", "/v1/mandates/seal", { principal: cp(), mandate: draft.wire });
      return toSigning(await approvalOf(approvalId), "seal");
    },
    budgets: async () => mapLanes(await stateOf(cp())),

    ask: async (req) => {
      // autoExecute is accepted only with the visitor's own token (or the operator's): on the demo account the
      // request is checked and proposed, and executing it is a separate (operator) step.
      const own = cp() !== CONSOLE_PRINCIPAL && Boolean(activeVisitor());
      const p = await call(W.WireProposal, "POST", `/v1/principals/${enc(cp())}/ask`, own ? { text: req.text, autoExecute: true } : { text: req.text });
      const d = mapDecision(p);
      return p.receipt ? { ...d, outcome: "executed", receipt: mapReceipt(p.receipt), receiptId: p.receipt.receiptId } : d;
    },
    execute: async (proposalId) => {
      const r = await call(W.WireSignatureResult, "POST", `/v1/proposals/${enc(proposalId)}/execute`, {});
      if (!r.receipt) throw new ApiRequestError("The agent service returned no receipt.", 502, "no_receipt");
      return mapReceipt(r.receipt);
    },
    receipts: async (opts = {}) => ({ items: await receiptsOf(opts.principal ?? cp(), opts.limit ?? 50), nextCursor: null }),
    receipt: async (id) => mapReceipt(await call(W.WireReceipt, "GET", `/v1/receipts/${enc(id)}`)),
    receiptProof: async (id) => {
      const p = await call(W.WireProof, "GET", `/proof/${enc(id)}?verify=1`);
      const verifiedOn = p.onChain?.valid ? mapLedger(p.onChain.ledger) : null;
      return {
        receiptId: id,
        leaf: p.receiptHash,
        pairing: "sorted",
        path: p.proof.map((sibling) => ({ sibling, position: null })),
        root: p.root,
        anchors: p.anchors.map((a) => {
          const ledger = mapLedger(a.ledger);
          return {
            ledger,
            chainId: CHAIN_ID[ledger],
            txHash: a.txHash,
            blockNumber: a.blockNumber != null ? Number(a.blockNumber) : null,
            // The indexer reports AccountabilityLedger.verifyReceipt on this ledger: the root it holds matches.
            root: verifiedOn === ledger ? p.root : null,
            explorerUrl: null,
          };
        }),
      };
    },
    tx: async (ledger, hash) => {
      const t = await call(W.WireTx, "GET", `/v1/tx/${enc(ledger)}/${enc(hash)}`);
      const status = /success|confirmed/i.test(t.status) ? "success" : /revert|fail/i.test(t.status) ? "reverted" : /pending/i.test(t.status) ? "pending" : "unknown";
      const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : JSON.stringify(v));
      return {
        ledger: mapLedger(t.ledger),
        badge: t.ledgerBadge ?? null,
        chainId: t.chainId,
        hash: t.hash,
        status,
        blockNumber: t.blockNumber != null ? String(t.blockNumber) : null,
        from: t.from ?? null,
        to: t.to ?? null,
        toName: t.toName ?? null,
        gasUsed: t.gasUsed != null ? String(t.gasUsed) : null,
        call: t.call
          ? {
              contract: t.call.contract ?? t.toName ?? "contract",
              fn: t.call.function,
              args: Array.isArray(t.call.args)
                ? t.call.args.map(str)
                : typeof t.call.args === "string"
                  ? [t.call.args]
                  : Object.entries(t.call.args ?? {}).map(([k, v]) => `${k}: ${str(v)}`),
            }
          : null,
        events: (t.events ?? []).map((e) => ({
          contract: e.contract ?? e.addressName ?? "contract",
          event: e.event,
          args: Object.fromEntries(Object.entries(e.args ?? {}).map(([k, v]) => [k, str(v)])),
        })),
        note: t.note ?? null,
        revert: t.revert ? { name: t.revert.name, message: t.revert.message ?? null } : null,
        revertSource: t.revertSource ?? null,
      };
    },
    findReceiptByTx: async (txHash) => {
      for (const p of await principals()) {
        const hit = (await receiptsOf(p.id, 200).catch(() => [] as Receipt[])).find((r) => r.txHash?.toLowerCase() === txHash.toLowerCase());
        if (hit) return hit;
      }
      return null;
    },
    agentReceipts: async (agentId) => {
      const p = (await principals()).find((x) => x.agent.agentId === agentId);
      return p ? receiptsOf(p.id, 10) : [];
    },

    approvals: async () => {
      const [list, s] = await Promise.all([
        call(z.array(W.WireApproval), "GET", `/v1/approvals?principal=${enc(cp())}`),
        stateOf(cp()).catch(() => null),
      ]);
      return list
        .filter((a) => a.kind === "cosign")
        .map((a) => mapApproval(a, s?.payees))
        .filter((a) => a.status === "pending");
    },
    approval: async (id) => {
      const a = await approvalOf(id);
      const s = await stateOf(a.principal).catch(() => null);
      return mapApproval(a, s?.payees);
    },
    submitSignature: async (requestId, sig) => {
      const r = await call(W.WireSignatureResult, "POST", `/v1/approvals/${enc(requestId)}/signature`, { signature: sig.signature, keyId: sig.keyId });
      return signedResult(requestId, r.receipt ?? null);
    },
    demoSign: async (requestId) => {
      const r = await call(W.WireSignatureResult, "POST", `/v1/approvals/${enc(requestId)}/demo-sign`, {});
      return signedResult(requestId, r.receipt ?? null);
    },
    attack: async (req) => {
      const r = await call(
        z.object({ proposal: W.WireProposal.nullish(), receipt: W.WireReceipt.nullish() }),
        "POST",
        `/v1/principals/${enc(cp())}/attack`,
        req,
      );
      return { decision: r.proposal ? mapDecision(r.proposal) : null, receipt: r.receipt ? mapReceipt(r.receipt) : null };
    },
    declineApproval: async (id) => mapApproval(await call(W.WireApproval, "POST", `/v1/approvals/${enc(id)}/decline`, {})),

    pauseStatus: async () => {
      const p = await consolePrincipal();
      return { paused: p.paused, since: null, txs: [], measuredMs: null };
    },
    requestPause: async (action) => {
      const r = await call(W.WireApprovalRef, "POST", `/v1/principals/${enc(cp())}/${action}`, {});
      return toSigning(r.approval ?? (await approvalOf(r.approvalId)), action);
    },
    requestRevoke: async () => {
      const r = await call(W.WireApprovalRef, "POST", `/v1/principals/${enc(cp())}/revoke`, {});
      return toSigning(r.approval ?? (await approvalOf(r.approvalId)), "revoke");
    },
    revokeContext: async (principalId) => {
      const id = principalId ?? cp();
      const s = await stateOf(id);
      if (!s.mandate) throw new ApiRequestError("This principal has no sealed mandate.", 404, "no_mandate");
      return {
        principalId: id,
        account: s.principal.account as `0x${string}`,
        ledger: s.principal.ledger,
        mandateHash: s.mandate.mandateHash as `0x${string}`,
        delegationHash: s.mandate.delegationHash as `0x${string}`,
        directory: await directoryOf(s.principal.ledger),
      };
    },
    contractDirectory: (ledger) => directoryOf(ledger),

    draftVisitorMandate: async (text) => {
      const d = await call(W.WireVisitorDraft, "POST", "/v1/mandates/draft", { text });
      return {
        draft: d.draft,
        decodedSentences: d.decodedSentences,
        diff: d.diff.map((r) => ({ ...r, said: r.said ?? null, note: r.note ?? null })),
        flagged: d.flagged,
        adjustments: d.adjustments.map((a) => ({ ...a, said: a.said ?? null })),
        compiled: { ...d.compiled, preview: d.compiled.preview ?? true },
        payeeBook: d.payeeBook,
        userSentences: d.userSentences,
        roundTrip: { ok: d.roundTrip.ok, checks: d.roundTrip.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail ?? null })) },
        serviceHashRing: d.hashRing ? mapHashRing(d.hashRing) : null,
        ledger: mapLedger(d.ledger),
        ledgerBadge: d.ledgerBadge ?? null,
        aigc: { ...d.aigc, latencyMs: d.aigc.latencyMs ?? null },
        note: d.note ?? null,
      };
    },
    visitorReseal: async (visitorId, token, mandate) => {
      const v = await call(W.WireVisitorSignUp, "POST", `/v1/visitors/${enc(visitorId)}/reseal`, mandate === undefined ? {} : { mandate }, { "x-visitor-token": token });
      return {
        visitorId: v.visitorId,
        token: v.token,
        account: v.account,
        did: v.did,
        ledger: mapLedger(v.ledger),
        ledgerBadge: v.ledgerBadge ?? null,
        agent: v.agent,
        mandate: v.mandate,
        requests: v.requests,
      };
    },
    visitorLoginChallenge: async () => {
      const v = await call(W.WireLoginChallenge, "POST", "/v1/visitors/login/challenge", {});
      return { nonce: v.nonce, issuedAt: v.issuedAt, digest: v.digest, chainId: Number(v.typedData.domain.chainId) };
    },
    visitorLogin: async (req) => {
      const v = await call(W.WireLogin, "POST", "/v1/visitors/login", req);
      return { ...v, credentialId: v.credentialId ?? undefined, owner: v.owner ?? undefined, publicKey: v.publicKey ?? undefined };
    },
    visitorSignUp: async (req) => {
      const v = await call(
        W.WireVisitorSignUp,
        "POST",
        "/v1/visitors",
        req.owner
          ? { owner: req.owner, ...(req.mandate === undefined ? {} : { mandate: req.mandate }) }
          : {
              credentialId: req.credentialId,
              publicKey: { x: req.publicKey!.x, y: req.publicKey!.y },
              ...(req.mandate === undefined ? {} : { mandate: req.mandate }),
            },
      );
      return {
        visitorId: v.visitorId,
        token: v.token,
        account: v.account,
        did: v.did,
        ledger: mapLedger(v.ledger),
        ledgerBadge: v.ledgerBadge ?? null,
        agent: v.agent,
        mandate: v.mandate,
        requests: v.requests,
      };
    },
    visitorSeal: async (visitorId, token, sigs) => {
      const r = await call(
        W.WireVisitorSeal,
        "POST",
        `/v1/visitors/${enc(visitorId)}/seal`,
        { userOpSignature: sigs.userOpSignature, delegationSignature: sigs.delegationSignature },
        { "x-visitor-token": token },
      );
      return {
        principal: toPrincipal(r.principal),
        mandateHash: r.mandateHash,
        publishTx: r.publishTx ?? null,
        ledger: mapLedger(r.principal.ledger),
        ledgerBadge: r.principal.ledgerBadge ?? null,
      };
    },

    treasuryEntities: async () => Promise.all((await principals()).filter((p) => p.kind === "company").map(entityOf)),
    treasury: async (entityId) => {
      const all = await principals();
      const p = all.find((x) => x.id === entityId);
      if (!p) throw new ApiRequestError(`Entity ${entityId} is not listed.`, 404, "not_found");
      const [s, board, receipts] = await Promise.all([
        stateOf(entityId),
        call(z.array(W.WireBoardProposal), "GET", `/v1/board-proposals?principal=${enc(entityId)}`).catch(() => [] as W.WireBoardProposal[]),
        receiptsOf(entityId, 30),
      ]);
      const entity = await entityOf(p);
      const proposals: DirectorProposal[] = board.map((b) => ({
        id: b.id,
        title: b.title,
        payeeName: b.payee.label,
        amount: b.amount !== "0" ? amount(b.amount, b.decimals, b.symbol) : null,
        reason: `Outside the treasurer agent's lanes: ${b.threshold} of ${entity.directors.length} directors sign one user operation from the company account.`,
        tier: "T3",
        createdAt: b.createdAt ? iso(b.createdAt) : null,
        signatures: b.signatures.map((sg) => ({ directorId: sg.director, signedAt: iso(sg.signedAt ?? null) ?? "" })),
        status: b.status === "collecting" ? "open" : b.status === "executed" ? "executed" : "rejected",
        tx: b.txHash ? { ledger: mapLedger(b.ledger), chainId: CHAIN_ID[mapLedger(b.ledger)], txHash: b.txHash } : null,
      }));
      return {
        entity: { ...entity, threshold: board[0]?.threshold ?? entity.threshold },
        lanes: mapLanes(s),
        proposals,
        instructions: receipts.map(mapInstruction),
        mandate: s.mandate ? mapMandate(s.mandate, p.name, p.agent.agentId, p.ledgerBadge) : null,
        forecast: null,
        payees: s.payees.map((x) => ({ id: x.id, label: x.label, address: x.address, category: x.category ?? "" })),
        asset: s.balances[0]
          ? { symbol: s.balances[0].symbol, decimals: s.balances[0].decimals, unit: s.balances[0].symbol.match(/^[A-Za-z]+/)?.[0] ?? s.balances[0].symbol }
          : null,
      };
    },
    signBoardProposal: async (entityId, proposalId, directorId) => {
      const b = await call(W.WireBoardProposal, "POST", `/v1/board-proposals/${enc(proposalId)}/sign`, { director: directorId });
      const t = await api.treasury(entityId);
      const view = isPromiseLike(t) ? await t : t;
      const found = view.proposals.find((x) => x.id === b.id);
      if (!found) throw new ApiRequestError("The board proposal disappeared after signing.", 404, "not_found");
      return found;
    },

    registry: async () => {
      const [reg, all] = await Promise.all([call(z.array(W.WireRegistryAgent), "GET", "/v1/registry/agents"), principals()]);
      return reg.map((r): RegistryAgent => {
        const kind = r.kind ?? (r.principal?.startsWith("v-") ? "visitor" : "demo");
        // Match on the principal the registry names (two companies may share one treasurer agent id).
        const p =
          kind === "demo"
            ? (all.find((x) => x.id === r.principal) ?? all.find((x) => x.agent.agentId === r.agentId && x.ledger === r.ledger) ?? all.find((x) => x.agent.agentId === r.agentId))
            : undefined;
        const s = r.status.toLowerCase();
        const status: RegistryAgent["status"] =
          s === "halted" || s === "paused"
            ? "paused"
            : s === "revoked"
              ? "revoked"
              : s.includes("self") || (!p && !r.principal && (r.attestations ?? []).length === 0)
                ? "self-registered"
                : "active";
        return {
          kind,
          agentId: r.agentId,
          agentName: r.label,
          ownerName: p?.name ?? (kind === "visitor" && r.principal ? `Visitor ${r.principal.slice(2, 6).toUpperCase()}` : "Unknown"),
          ownerDid: r.ownerDidHash,
          wallet: r.wallet,
          ledger: mapLedger(r.ledger),
          jurisdiction: p?.jurisdiction ?? null,
          status,
          identityCode: r.identityCode ?? null,
          trustedAttestations: r.attestations ? r.attestations.length : null,
          issuers: (r.attestations ?? []).map((a) => a.issuerLabel),
          reputation: null,
          receipts: null,
          lastReceiptId: null,
        };
      });
    },
    privateMandate: async (agentId) => {
      const m = await call(W.WirePrivateMandate, "GET", `/v1/supervisor/agents/${enc(agentId)}/private-mandate`);
      return {
        agentId: m.agentId,
        commitment: m.commitment,
        proofStatus: m.proofStatus,
        verifierTx: m.verifierTx ? { ledger: mapLedger(m.verifierTx.ledger), chainId: m.verifierTx.chainId, txHash: m.verifierTx.txHash } : null,
        statements: m.statements,
      };
    },
    setHalted: async (agentId, halted) => {
      // The route needs the ledger the passport lives on; the registry names it.
      const reg = await call(z.array(W.WireRegistryAgent), "GET", "/v1/registry/agents");
      const ledger = reg.find((a) => a.agentId === agentId)?.ledger;
      if (!ledger) throw new ApiRequestError(`Agent ${agentId} is not in the registry.`, 404, "not_found");
      await call(z.unknown(), "POST", `/v1/supervisor/agents/${enc(agentId)}/halt`, { halted, ledger });
    },

    challengeSession: async () => {
      const s = await call(W.WireChallengeSession, "GET", "/v1/challenge/session").catch((e: unknown) => {
        if (e instanceof ApiRequestError && /not onboarded/i.test(e.message))
          throw new ApiRequestError("The guest mandate is not set up on the agent service yet. The board below still shows every recorded attempt.", e.status, "guest_not_ready");
        throw e;
      });
      return {
        sessionId: s.guestPrincipal,
        guestPrincipal: s.guestPrincipal,
        joinUrl: s.joinUrl,
        rule: s.rule,
        guestMandate: { mandateHash: s.mandateHash, delegationHash: s.delegationHash, cap: amount(s.cap.amount, s.cap.decimals, s.cap.symbol), expiresAt: iso(s.expiresAt)! },
        quota: { perDay: s.quota.perDay, used: s.quota.used ?? null },
        shadowMode: s.shadowMode,
        ledgerBadge: s.ledgerBadge ?? null,
        sentences: s.sentences ?? [],
      };
    },
    challengeAttempts: async () => (await call(z.array(W.WireChallengeAttempt), "GET", "/v1/challenge/attempts")).map(mapAttempt),
    submitAttempt: async (req) => {
      const a = await call(W.WireChallengeAttempt, "POST", "/v1/challenge/attempt", { text: req.text, handle: req.handle, bypass: req.bypass });
      let decision: Decision | null = null;
      let receipt: Receipt | null = null;
      if (a.proposalId) {
        const p = await call(W.WireProposal, "GET", `/v1/proposals/${enc(a.proposalId)}`);
        decision = mapDecision(p);
        const last = p.receiptIds?.[p.receiptIds.length - 1];
        if (last) receipt = await call(W.WireReceipt, "GET", `/v1/receipts/${enc(last)}`).then(mapReceipt, () => null);
      }
      const attempt = mapAttempt(a);
      if (!decision) throw new ApiRequestError("The challenge attempt carries no proposal to show.", 502, "no_proposal");
      if (req.bypass && attempt.revert) {
        decision = {
          ...decision,
          scales: decision.scales.map((sc) =>
            sc.scale === "chain"
              ? { ...sc, status: "stopped", error: attempt.error, reason: "The caveat enforcers reverted the raw redemption.", revert: attempt.revert }
              : sc.status === "passed" || sc.status === "skipped"
                ? sc
                : sc,
          ),
        };
      }
      return { attempt, decision, receipt };
    },

    city: async (): Promise<CitySnapshot> => {
      const [all, reg, health, feed] = await Promise.all([
        principals(),
        call(z.array(W.WireRegistryAgent), "GET", "/v1/registry/agents").catch(() => [] as W.WireRegistryAgent[]),
        call(W.WireHealth, "GET", "/v1/health").catch(() => null),
        cityFeed(),
      ]);
      // Visitors are not in /v1/principals; the registry lists them. The most recent ones get a full row.
      const visitorEntries = reg.filter((r) => (r.kind ?? (r.principal?.startsWith("v-") ? "visitor" : "demo")) === "visitor" && r.principal);
      const recentVisitors = [...visitorEntries].sort((a, b) => Number(b.agentId) - Number(a.agentId)).slice(0, CITY_VISITORS);
      const passportOf = (entry: W.WireRegistryAgent | undefined, principalStatus?: string): CityPrincipal["agent"]["passport"] => {
        const st = (entry?.status ?? principalStatus ?? "").toLowerCase();
        if (st === "halted" || st === "paused") return "halted";
        if (st === "revoked") return "revoked";
        if (st.includes("self")) return "self-registered";
        // An entry in YinglongPassportRegistry is a passport a trusted issuer signed; an owner-less entry
        // with no attestation is an identity its holder registered for itself.
        if (entry) return !entry.principal && !(entry.attestations ?? []).length ? "self-registered" : "attested";
        return principalStatus === "active" ? "attested" : "self-registered";
      };
      const toCity = (p: W.WirePrincipal, s: W.WirePrincipalState | null, kind: CityPrincipal["kind"], name: string): CityPrincipal => {
        const entry = reg.find((r) => r.principal === p.id) ?? reg.find((r) => r.agentId === p.agent.agentId && r.ledger === p.ledger);
        const m = s?.mandate ?? null;
        const ledger = m ? mapLedger(m.ledger) : mapLedger(p.ledger);
        return {
          id: p.id,
          kind,
          name,
          jurisdiction: p.jurisdiction,
          ledger: mapLedger(p.ledger),
          ledgerBadge: p.ledgerBadge ?? null,
          account: p.account,
          signer: p.signer,
          paused: s?.paused ?? p.paused,
          agent: {
            agentId: p.agent.agentId,
            label: p.agent.label,
            wallet: p.agent.wallet,
            identityCode: p.agent.identityCode || entry?.identityCode || null,
            passport: passportOf(entry, p.agent.passportStatus),
            issuers: (entry?.attestations ?? []).map((a) => a.issuerLabel),
          },
          mandate: m
            ? {
                mandateHash: m.mandateHash,
                status: m.status ?? (m.live === false ? "revoked" : "live"),
                sentences: m.userSentences.length ? m.userSentences : m.sentences,
                sealedAt: iso(m.sealedAt ?? null),
                publishTx: m.publishTx ? { ledger, chainId: CHAIN_ID[ledger], txHash: m.publishTx } : null,
                explorerUrl: m.explorerUrl ?? null,
              }
            : null,
          payees: (s?.payees ?? []).map((x) => ({ label: x.label, address: x.address, category: x.category ?? null })),
        };
      };
      const listed = await Promise.all(
        all.map(async (p) => toCity(p, await stateOf(p.id).catch(() => null), p.kind === "company" ? "company" : "person", p.name)),
      );
      const visitors = (
        await Promise.all(
          recentVisitors.map(async (r) => {
            const s = await stateOf(r.principal!).catch(() => null);
            return s ? toCity(s.principal, s, "visitor", `Visitor ${r.principal!.slice(2, 6).toUpperCase()}`) : null;
          }),
        )
      ).filter((v): v is CityPrincipal => v !== null);
      const owned = new Set([...all.map((p) => p.id), ...visitorEntries.map((v) => v.principal!)]);
      const agents: CityAgent[] = reg
        .filter((r) => !(r.principal && owned.has(r.principal)))
        .map((r) => ({
          agentId: r.agentId,
          label: r.label,
          wallet: r.wallet,
          ledger: mapLedger(r.ledger),
          passport: passportOf(r),
          identityCode: r.identityCode ?? null,
          issuers: (r.attestations ?? []).map((a) => a.issuerLabel),
          ownerName: null,
        }));
      return {
        principals: [...listed, ...visitors],
        agents,
        ledgers: (health?.ledgers ?? []).map((l) => ({
          ledger: mapLedger(l.name),
          badge: l.badge ?? l.name,
          ok: l.ok !== false,
          block: l.ok === false || l.block == null ? null : String(l.block),
        })),
        visitorCount: visitorEntries.length,
        feed,
      };
    },
    cityFeed: () => cityFeed(),

    insights: async () => mapInsights(await call(W.WireInsights, "GET", `/v1/principals/${enc(cp())}/insights?explain=1`)),
    coverage: async () => {
      const c = await call(W.WireCoverage, "GET", `/v1/principals/${enc(cp())}/coverage`);
      const out: Coverage = {
        obligations: c.obligations.map((o) => ({
          payeeId: o.payeeId,
          payeeLabel: o.payeeLabel,
          category: o.category,
          cadence: o.cadence,
          upTo: amount(o.upTo, o.decimals, o.symbol),
          protection: o.protection,
          escrowIds: o.escrowIds,
          refundableAfter: o.refundableAfter ? iso(o.refundableAfter) : null,
          why: o.why,
        })),
        coverItems: c.coverItems,
        gaps: c.gaps,
        summary: c.summary,
        label: c.label,
        ledger: mapLedger(c.ledger),
        block: blockOf(c.block),
      };
      return out;
    },
    escrows: async () => {
      const r = await call(W.WireEscrowList, "GET", `/v1/principals/${enc(cp())}/escrows`);
      return { escrows: r.escrows.map(mapEscrow), contract: r.contract ?? null, block: blockOf(r.block) };
    },
    releaseEscrow: async (escrowId, evidence) => {
      const r = await call(z.object({ escrow: W.WireEscrow, receipt: W.WireReceipt.nullish() }), "POST", `/v1/principals/${enc(cp())}/escrows/${escrowId}/release`, evidence ? { evidence } : {});
      return { escrow: mapEscrow(r.escrow), receipt: r.receipt ? mapReceipt(r.receipt) : null };
    },
    refundEscrow: async (escrowId) => {
      const r = await call(z.object({ escrow: W.WireEscrow, receipt: W.WireReceipt.nullish() }), "POST", `/v1/principals/${enc(cp())}/escrows/${escrowId}/refund`, {});
      return { escrow: mapEscrow(r.escrow), receipt: r.receipt ? mapReceipt(r.receipt) : null };
    },
    credentials: async () => (await call(z.array(W.WireCredential), "GET", `/v1/principals/${enc(cp())}/credentials`)).map(mapCredential),
    issueCredential: async () => {
      const r = await call(z.object({ credential: W.WireCredential, verification: W.WireCredentialVerification }), "POST", `/v1/principals/${enc(cp())}/credentials/payment-reliability`, {});
      return { credential: mapCredential(r.credential), verification: mapVerification(r.verification) };
    },
    verifyCredential: async (hash) => mapVerification(await call(W.WireCredentialVerification, "GET", `/v1/credentials/${enc(hash)}/verify`)),
    forecast: async (entityId, days = 30) => mapForecast(await call(W.WireForecast, "GET", `/v1/principals/${enc(entityId)}/forecast?days=${days}&explain=1`)),
    runPayroll: async (entityId, req) => {
      const p = await call(W.WireProposal, "POST", `/v1/principals/${enc(entityId)}/payroll`, { amount: req.amount, ...(req.memo ? { memo: req.memo } : {}) });
      const d = mapDecision(p);
      return p.receipt ? { ...d, outcome: "executed", receipt: mapReceipt(p.receipt), receiptId: p.receipt.receiptId } : d;
    },
    askAs: async (principalId, req) => mapDecision(await call(W.WireProposal, "POST", `/v1/principals/${enc(principalId)}/ask`, { text: req.text })),
    proof: async () => mapProof(await call(W.WireProofBundle, "GET", "/v1/proof"), root),
    // Not through fetchJson: the judge's "Try it live" must never answer from the GET cache.
    ping: async () => {
      const url = `${root}/v1/health`;
      const at = new Date().toISOString();
      const t0 = performance.now();
      try {
        const res = await fetch(url, { method: "GET", credentials: "omit", headers: { accept: "application/json" }, cache: "no-store" });
        const body: unknown = await res.json().catch(() => null);
        const ms = Math.round(performance.now() - t0);
        const parsed = W.WireHealth.safeParse(body);
        return { ok: res.ok && (parsed.success ? parsed.data.ok : true), status: res.status, ms, at, url, body };
      } catch {
        return { ok: false, status: 0, ms: Math.round(performance.now() - t0), at, url, body: null };
      }
    },
    evidence: async () => {
      const e = await call(W.WireEvidence, "GET", "/v1/evidence");
      const kindOf = (o: string, err: unknown): "payment" | "revert" | "refusal" | "seal" | "pause" | "anchor" | "other" => {
        const s = o.toLowerCase();
        if (s.includes("revert")) return "revert";
        if (s.includes("reject") || s.includes("refus")) return "refusal";
        if (s.includes("seal")) return "seal";
        if (s.includes("pause") || s.includes("trip")) return "pause";
        if (s.includes("anchor")) return "anchor";
        if (s.includes("confirm")) return err ? "revert" : "payment";
        return "other";
      };
      return {
        generatedAt: iso(e.generatedAt)!,
        commit: e.commit ?? "service",
        generator: "agent service /v1/evidence",
        metrics: (e.metrics ?? []).map((m) => ({ id: m.id, label: m.label, value: m.value, unit: m.unit ?? null, n: m.n ?? null, interval: m.interval ?? null, source: m.source, note: m.note ?? null })),
        hashes: e.items.map((it, i) => {
          const ledger = mapLedger(it.ledger);
          const err = typeof it.revertError === "string" ? it.revertError : it.revertError?.name;
          return {
            id: `${it.beat ?? "item"}-${i}`,
            label: it.beat ? `Beat ${it.beat}: ${it.title}` : it.title,
            kind: kindOf(it.outcome, err),
            tx: { ledger, chainId: CHAIN_ID[ledger], txHash: it.txHash, explorerUrl: it.explorerUrl ?? null },
            typedError: err && /^[A-Z][A-Za-z0-9]*$/.test(err) ? err : null,
          };
        }),
        contracts: (e.contracts ?? []).map((c) => ({ ...c, ledger: mapLedger(c.ledger) })),
        verifyCommand: VERIFY_COMMAND,
        receipt: null,
      };
    },
  };
  return api;
}
