/**
 * Pure helpers for the live execution view: which of the nine checks ran and how, which result state
 * to show, the three-line takeaway, and the one safe alternative after a refusal. Everything here is
 * code-filled from the service's own fields; nothing is guessed or made up.
 */
import type { Amount, Decision, Receipt, ScaleId } from "@/lib/api/view";
import { SCALE_IDS, SCALE_NAMES } from "@/lib/api/view";
import { formatAmount, formatUnits, parseUnits } from "@/lib/format";

export type NodeStatus = "pending" | "passed" | "stopped" | "escalated" | "skipped";

export interface GraphNode {
  n: number;
  id: ScaleId;
  /** Full name, e.g. "Quarantine and taint". */
  name: string;
  /** One word for the rail, e.g. "Quarantine". */
  short: string;
  status: NodeStatus;
  /** Real wall-clock time of the check, or null when the service did not report one. */
  ms: number | null;
  reason: string | null;
  error: string | null;
  /** Sentinel only. */
  score: number | null;
  threshold: number | null;
}

export type ResultKind = "verified" | "sending" | "blocked" | "reserved" | "approval" | "question" | "answer" | "error";

const SHORT: Record<ScaleId, string> = {
  normalise: "Normalise",
  sentinel: "Sentinel",
  quarantine: "Quarantine",
  ground: "Ground",
  policy: "Policy",
  counterparty: "Counterparty",
  simulate: "Simulate",
  anomaly: "Anomaly",
  chain: "Chain",
};

/** Typed errors in plain words. Unknown names are split on their capitals. */
const PLAIN: Record<string, string> = {
  PayeeNotVerified: "Not a verified payee",
  CategoryBudgetExceeded: "Over the budget for this category",
  VelocityExceeded: "Too much within 24 hours",
  ForbiddenTarget: "Not an allowed action",
  CoSignRequired: "Needs your approval",
  AmbiguousIntent: "The request is unclear",
  InjectionSuspected: "Hidden instructions found",
  TaintedField: "Details came from an untrusted message",
  Paused: "The agent is paused",
  ReserveFloorBreached: "Would go below the reserve floor",
  AllowanceExceeded: "Over the allowance",
};

export function plainError(name: string | null | undefined): string | null {
  if (!name) return null;
  return PLAIN[name] ?? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/** The nine nodes before a response: all pending. */
export function pendingNodes(): GraphNode[] {
  return SCALE_IDS.map((id, k) => ({ n: k + 1, id, name: SCALE_NAMES[id], short: SHORT[id], status: "pending", ms: null, reason: null, error: null, score: null, threshold: null }));
}

/**
 * The nine nodes from a decision. Check 9 (Chain) is the on-chain result: pending while the payment
 * is being sent, then the receipt's outcome.
 */
export function graphNodes(d: Decision, receipt: Receipt | null, executing: boolean): GraphNode[] {
  return d.scales.map((s, k) => {
    const node: GraphNode = {
      n: k + 1,
      id: s.scale,
      name: SCALE_NAMES[s.scale],
      short: SHORT[s.scale],
      status: s.status,
      ms: s.durationMs ?? null,
      reason: s.reason ?? null,
      error: s.error ?? null,
      score: s.score ?? null,
      threshold: s.threshold ?? null,
    };
    if (s.scale !== "chain") return node;
    if (executing) return { ...node, status: "pending", reason: "Sending to the chain", error: null };
    if (!receipt) return node;
    if (receipt.outcome === "confirmed") return { ...node, status: "passed", reason: "Confirmed on chain", error: null };
    if (receipt.outcome === "reverted" || receipt.outcome === "rejected_policy") return { ...node, status: "stopped", reason: "The chain reverted it", error: receipt.revertError ?? node.error };
    if (receipt.outcome === "pending") return { ...node, status: "pending", reason: "Waiting for the block", error: null };
    return node;
  });
}

/** The check that decided: the first stopped one, else the first escalated one. */
export function decidingNode(nodes: GraphNode[]): GraphNode | null {
  return nodes.find((n) => n.status === "stopped") ?? nodes.find((n) => n.status === "escalated") ?? null;
}

/** Sum of the reported timings, or null when the service reported none. */
export function totalMs(nodes: GraphNode[]): number | null {
  const ms = nodes.map((n) => n.ms).filter((x): x is number => typeof x === "number");
  return ms.length ? ms.reduce((a, b) => a + b, 0) : null;
}

export function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString("en-US")} ms`;
}

export function resultKind(d: Decision | null, receipt: Receipt | null, error: Error | null, executing: boolean): ResultKind | null {
  if (error) return "error";
  if (!d) return null;
  if (executing) return "sending";
  if (receipt) return receipt.outcome === "reverted" || receipt.outcome === "rejected_policy" ? "blocked" : "verified";
  switch (d.outcome) {
    case "executed":
    case "executable":
      return "verified";
    case "awaiting_approval":
      return "approval";
    case "asking":
      return "question";
    case "observed":
      return "answer";
    case "reserved":
      return "reserved";
    default:
      return "blocked";
  }
}

export interface BlockReason {
  /** Plain words for the typed error. */
  title: string;
  typedError: string | null;
  /** Which rule or revert spoke: a policy rule name or the revert name. */
  rule: string | null;
  /** The service's own detail, with the numbers in words. */
  detail: string | null;
  source: "policy" | "simulation" | "chain" | "check";
}

/** The reason line: a policy refusal first, then the simulation's revert, then the check that stopped. */
export function blockReason(d: Decision, receipt: Receipt | null): BlockReason | null {
  if (receipt && (receipt.outcome === "reverted" || receipt.outcome === "rejected_policy")) {
    return { title: plainError(receipt.revertError) ?? "The chain reverted it", typedError: receipt.revertError, rule: null, detail: null, source: "chain" };
  }
  const refusal = d.refusals?.[0];
  if (refusal && (refusal.typedError || refusal.detail)) {
    return { title: plainError(refusal.typedError) ?? "Refused by a rule", typedError: refusal.typedError, rule: refusal.rule, detail: refusal.detail, source: "policy" };
  }
  if (d.revert) {
    return { title: plainError(d.revert.name) ?? "The simulation reverted", typedError: d.revert.name, rule: d.revert.name, detail: d.revert.message, source: "simulation" };
  }
  const stop = d.scales.find((s) => s.status === "stopped") ?? d.scales.find((s) => s.status === "escalated");
  if (!stop) return null;
  return { title: plainError(stop.error) ?? `Stopped at ${SCALE_NAMES[stop.scale]}`, typedError: stop.error, rule: null, detail: stop.reason, source: "check" };
}

const CAP_WORDS = /(cap|limit|left|remaining|remains|budget|threshold|max|maximum|allowed|allowance|up to|at most|floor)/i;

/**
 * The cap a refusal detail names, in base units, or null. Looks for a number introduced by a cap word
 * ("Only 1,153.50 tHKD is left", "cap 300.00"); failing that, the largest number below the request.
 */
export function capFromDetail(detail: string | null | undefined, requested: Amount | null): bigint | null {
  if (!detail) return null;
  const decimals = requested?.decimals ?? 2;
  const asked = requested ? BigInt(requested.value) : null;
  const found: { value: bigint; capWord: boolean }[] = [];
  for (const m of detail.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const text = m[0].replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(text)) continue;
    const value = parseUnits(text, decimals);
    if (value === null || value <= 0n) continue;
    const before = detail.slice(Math.max(0, m.index - 48), m.index);
    const after = detail.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const capWord = CAP_WORDS.test(before) || CAP_WORDS.test(after);
    // A bare integer with no cap word nearby is a date or a count ("paid on 1 Oct"), not a money cap.
    if (!capWord && !/[.,]/.test(m[0])) continue;
    found.push({ value, capWord });
  }
  const inside = found.filter((f) => asked === null || f.value < asked);
  const byCap = inside.filter((f) => f.capWord);
  const pick = (byCap.length ? byCap : inside).sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0))[0];
  return pick ? pick.value : null;
}

export interface SafeAlternative {
  label: string;
  request: string;
}

/**
 * One safe next step after a refusal: a smaller request inside the cap the rule named, otherwise a
 * read-only question about the budget. Never a way round the rule.
 */
export function safeAlternative(d: Decision, reason: BlockReason | null): SafeAlternative | null {
  const asked = d.intent.amount;
  const cap = capFromDetail(reason?.detail, asked);
  if (cap !== null && asked && cap < BigInt(asked.value)) {
    const capText = formatUnits(cap, asked.decimals).replace(/,/g, "").replace(/\.00$/, "");
    const capAmount = formatAmount({ value: cap.toString(), decimals: asked.decimals, symbol: asked.symbol });
    // The amount as the user may have typed it: "2,000.00", "2000.00", "2,000" or "2000".
    const grouped = formatUnits(BigInt(asked.value), asked.decimals);
    const forms = [grouped, grouped.replace(/,/g, ""), grouped.replace(/\.00$/, ""), grouped.replace(/,/g, "").replace(/\.00$/, "")];
    const re = new RegExp(`(?<![\\d.,])(${[...new Set(forms)].map(escape).join("|")})(?![\\d])`);
    const text = d.input.text;
    const request = re.test(text) ? text.replace(re, capText) : d.intent.payeeName ? `Pay ${d.intent.payeeName} ${capText}` : `Pay ${capText}`;
    return { label: `Pay ${capAmount} instead`, request };
  }
  // A budget-style rule with no usable cap in its detail: offer the read-only question instead.
  if (d.intent.category && /Budget|Velocity|Allowance|Floor/.test(reason?.typedError ?? "")) {
    return { label: "Check what is left", request: `What is left in my ${d.intent.category} budget?` };
  }
  return null;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** At most three short lines above the graph. */
export function takeaway(kind: ResultKind, d: Decision | null, receipt: Receipt | null, nodes: GraphNode[], error: Error | null): string[] {
  if (kind === "error") return [error?.message ?? "The agent service did not answer."];
  if (!d) return [];
  const amount = receipt?.amount ?? d.intent.amount;
  const payee = receipt?.payeeName ?? d.intent.payeeName;
  const what = amount ? `${formatAmount(amount)}${payee ? ` to ${payee}` : ""}` : (payee ?? d.intent.summary);
  const total = totalMs(nodes);
  const deciding = decidingNode(nodes);
  const at = deciding ? `check ${deciding.n}, ${deciding.name}` : null;
  switch (kind) {
    case "verified": {
      const lines = [receipt?.outcome === "pending" ? `Sent ${what}. Waiting for the block.` : `Paid ${what}.`];
      lines.push(total !== null ? `All nine checks passed in ${formatMs(total)}.` : "All nine checks passed.");
      if (receipt?.outcome === "confirmed" && receipt.txHash) lines.push("The receipt is on chain.");
      return lines;
    }
    case "sending":
      return [`Eight checks passed. Sending ${what} to the chain.`];
    case "blocked": {
      const reason = blockReason(d, receipt);
      return [at ? `Stopped at ${at}.` : "Stopped by the rules.", `${reason?.title ?? "Refused"}.`, "Nothing was signed. Nothing moved."].slice(0, 3);
    }
    case "reserved":
      return [at ? `Stopped at ${at}.` : "Reserved for you.", "Only you can do this on your own account.", "Nothing was signed."];
    case "approval":
      return [deciding?.reason ?? "Inside your rules, but above your ask threshold.", "Your passkey must approve it before anything moves."];
    case "question":
      return ["Ying did not guess.", d.question ?? d.explanation].slice(0, 3);
    case "answer":
      return [d.explanation];
  }
}
