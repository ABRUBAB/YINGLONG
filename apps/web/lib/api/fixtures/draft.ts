/**
 * SAMPLE "say, see, seal" for fixtures mode only: a small deterministic parser standing in for
 * POST /v1/mandates/draft. It applies the documented visitor bounds (docs/API.md section 3.8) so the
 * page shows clamped, default and unmapped rows, but it compiles nothing: the hashes are sample
 * hashes of the normalised rules and the sentences are written from the same values.
 */
import { keccak256, toHex } from "viem";
import type { VisitorDraft } from "../view";
import { addr } from "./util";

const CATALOGUE = [
  { id: "arena_cafe", label: "Arena Cafe", category: "food" },
  { id: "kowloon_food_mart", label: "Kowloon Food Mart", category: "food" },
  { id: "hbu_bookshop", label: "HBU Bookshop", category: "tuition" },
  { id: "harbour_homes", label: "Harbour Homes", category: "rent" },
  { id: "victoria_fx", label: "Victoria FX", category: "services" },
] as const;
const STANDARD = ["arena_cafe", "kowloon_food_mart", "hbu_bookshop"];
const BOUNDS = { dailyBudgetMax: 1000, t1Max: 200, t2Max: 1000, floorMax: 900, countMax: 50, outflowMax: 1000, daysMax: 30 };
const DEFAULTS = { budget: { food: 100, tuition: 300, rent: 500, services: 50 } as Record<string, number>, t1: 20, t2: 200, floor: 100, count: 10, outflow: 400, window: "hour", days: 30 };
const U = "tHKD";

const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, "")) : null);
const fmt = (n: number) => `${n.toLocaleString("en-US")} ${U}`;
const join = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function sampleVisitorDraft(text: string): VisitorDraft {
  const t = text.toLowerCase();
  const clauses = text.split(/(?<=[.;!?])\s+|\n+/).map((c) => c.trim()).filter(Boolean);
  const used = new Set<number>();
  const find = (re: RegExp) => {
    for (let i = 0; i < clauses.length; i++) {
      const m = re.exec(clauses[i]!);
      if (m) {
        used.add(i);
        return m;
      }
    }
    return null;
  };
  const named = CATALOGUE.filter((p) => t.includes(p.label.toLowerCase()));
  named.forEach((p) => clauses.forEach((c, i) => c.toLowerCase().includes(p.label.toLowerCase()) && used.add(i)));
  const payees = named.length ? named : CATALOGUE.filter((p) => STANDARD.includes(p.id));

  const saidFood = num(find(/food[^0-9]*?(\d[\d,]*)\s*(?:a|per)\s*day/i)?.[1]);
  const saidT1 = num(find(/(?:ask me|check with me|my approval)[^0-9]*?(?:above|over)\s*(\d[\d,]*)/i)?.[1]);
  const saidT2 = num(find(/(?:never (?:more than|above)|at most)\s*(\d[\d,]*)\s*(?:in one|per|for one|a) payment/i)?.[1] ?? find(/never (?:more than|above)\s*(\d[\d,]*)/i)?.[1]);
  const saidFloor = num(find(/(?:keep|leave)\s*(?:at least\s*)?(\d[\d,]*)/i)?.[1] ?? find(/below\s*(\d[\d,]*)/i)?.[1]);
  const vel = find(/(\d+)\s*payments?\s*(?:an|a|per)\s*(hour|day)/i);
  const saidCount = num(vel?.[1]);
  const window = vel?.[2]?.toLowerCase() ?? DEFAULTS.window;
  const saidDays = num(find(/for\s*(\d+)\s*days?/i)?.[1]);
  const unmapped = clauses.filter((_, i) => !used.has(i));

  const adjustments: VisitorDraft["adjustments"] = [];
  const clamp = (field: string, said: number | null, def: number, max: number, unit = U) => {
    if (said === null) return def;
    if (said > max) {
      adjustments.push({ field, said: `${said} ${unit}`.trim(), enforced: `${max} ${unit}`.trim(), kind: "clamped", reason: `The visitor bound for ${field} is ${max} ${unit}`.trim() + "." });
      return max;
    }
    return said;
  };
  const food = clamp("food budget", saidFood, DEFAULTS.budget.food!, BOUNDS.dailyBudgetMax);
  let t2 = clamp("hard ceiling", saidT2, DEFAULTS.t2, BOUNDS.t2Max);
  let t1 = clamp("approval threshold", saidT1, DEFAULTS.t1, BOUNDS.t1Max);
  if (t1 > t2) {
    adjustments.push({ field: "approval threshold", said: `${t1} ${U}`, enforced: `${t2} ${U}`, kind: "adjusted", reason: "The ask-me threshold cannot be above the hard ceiling." });
    t1 = t2;
  }
  const floor = clamp("reserve floor", saidFloor, DEFAULTS.floor, BOUNDS.floorMax);
  const count = clamp("payments per window", saidCount, DEFAULTS.count, BOUNDS.countMax, "");
  const days = clamp("validity", saidDays, DEFAULTS.days, BOUNDS.daysMax, "days");
  const adj = (field: string) => adjustments.find((a) => a.field === field);
  t2 = Math.max(t2, 1);

  const status = (said: number | null, field: string): VisitorDraft["diff"][number]["status"] => (said === null ? "default" : adj(field)?.kind ?? "as you said");
  const row = (rule: string, said: number | null, enforced: string, source: string, field: string, unit = U): VisitorDraft["diff"][number] => {
    const st = status(said, field);
    return { rule, said: said === null ? null : `${said} ${unit}`.trim(), enforced, source, status: st, flagged: st === "clamped" || st === "adjusted", note: adj(field)?.reason ?? null };
  };
  const categories = [...new Set(payees.map((p) => p.category))];
  const budgetLine = categories.map((c) => `${c === "tuition" ? "course materials" : c} at most ${fmt(c === "food" ? food : DEFAULTS.budget[c]!)} a day`).join("; ");
  const decodedSentences = [
    `The agent can only touch ${U}.`,
    "It can only call transfer.",
    `It may pay only ${join(payees.map((p) => p.label))} (your PayeeBook).`,
    `Alone it pays at most ${fmt(t1)} at a time; up to ${fmt(t2)} with your passkey.`,
    `${budgetLine.charAt(0).toUpperCase()}${budgetLine.slice(1)}.`,
    `The balance never drops below ${fmt(floor)}.`,
    `At most ${count} payments and ${fmt(DEFAULTS.outflow)} per ${window}.`,
    `The mandate is valid for ${days} days.`,
  ];
  const diff: VisitorDraft["diff"] = [
    {
      rule: "who may be paid",
      said: named.length ? join(named.map((p) => p.label)) : null,
      enforced: join(payees.map((p) => p.label)),
      source: "PayeeBook (written by the same signed operation)",
      status: named.length ? "as you said" : "default",
      flagged: false,
      note: null,
    },
    row("food per day", saidFood, `${fmt(food)} a day`, "CategoryBudgetEnforcer caveat", "food budget"),
    row("ask me above (T1 cap)", saidT1, fmt(t1), "CoSignEnforcer caveat", "approval threshold"),
    row("never above (T2 ceiling)", saidT2, fmt(t2), "CoSignEnforcer caveat", "hard ceiling"),
    row("keep at least (reserve floor)", saidFloor, fmt(floor), "ReserveFloorEnforcer caveat", "reserve floor"),
    row(`payments per ${window}`, saidCount, `${count} per ${window}`, "VelocityEnforcer caveat", "payments per window", ""),
    row("valid for", saidDays, `${days} days`, "MandateRegistry validity (published with the mandate)", "validity", "days"),
    ...unmapped.map((u) => ({ rule: "could not be mapped", said: u, enforced: "nothing: this is NOT enforced", source: "none", status: "not enforced" as const, flagged: true, note: null })),
  ];
  const rules = { payees: payees.map((p) => p.id), budgets: categories.map((c) => ({ category: c, amount: String(c === "food" ? food : DEFAULTS.budget[c]) })), t1Cap: String(t1), t2Ceiling: String(t2), reserveFloor: String(floor), velocity: { window, maxCount: count, maxOutflow: String(DEFAULTS.outflow) }, validityDays: days, unmapped };
  const seed = keccak256(toHex(`yinglong-sample:draft:${JSON.stringify(rules)}`));
  const userSentences = clauses;
  return {
    // Sample only: the decoded sentences travel with the draft so the sample sign-up shows what was seen.
    draft: { template: "visitor", rules, userSentences, decoded: decodedSentences },
    decodedSentences,
    diff,
    flagged: diff.filter((d) => d.flagged).length,
    adjustments,
    compiled: { mandateHash: keccak256(toHex(`${seed}:mandate`)), delegationHash: keccak256(toHex(`${seed}:delegation`)), caveatCount: decodedSentences.length, preview: true },
    payeeBook: payees.map((p) => ({ id: p.id, label: p.label, category: p.category, address: addr(`visitor-catalogue:${p.id}`) })),
    userSentences,
    roundTrip: { ok: true, checks: [{ name: "decode", ok: true, detail: `${decodedSentences.length} of ${decodedSentences.length} caveats decode (sample)` }] },
    serviceHashRing: null,
    ledger: "fisco",
    ledgerBadge: "FISCO BCOS (sample)",
    aigc: { label: "deterministic rule parser", model: "sample rule parser (fixtures mode)", provider: "local", via: "rules", latencyMs: null },
    note: "Sample data: fixtures mode applies the visitor bounds but compiles nothing; hashes are sample hashes.",
  };
}
