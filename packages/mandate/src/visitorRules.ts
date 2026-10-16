import { z } from "zod";
import type { Address } from "viem";
import { addr, type Deployment } from "@yinglong/sdk";
import type { Mandate } from "./schema";

/**
 * "Say, see, seal": a visitor's own rules, in a CLOSED schema. A model (or the deterministic rule parser) may
 * only fill this shape: payees from a fixed catalogue, per-category daily budgets, the approval threshold (T1
 * cap), the hard ceiling (T2), a reserve floor, a velocity limit and a validity. `normaliseVisitorRules` then
 * applies hard bounds (test units only, everything within the visitor faucet) and defaults, recording every
 * change; `visitorMandateFromRules` builds the mandate document the compiler turns into caveats. Nothing here
 * grants authority by itself: what is enforced is what the compiled caveats say.
 */
export const VISITOR_PAYEES = [
  { id: "arena_cafe", label: "Arena Cafe", category: "food", seed: "arena-cafe" },
  { id: "kowloon_food_mart", label: "Kowloon Food Mart", category: "food", seed: "kowloon-food-mart" },
  { id: "hbu_bookshop", label: "HBU Bookshop", category: "tuition", seed: "hbu-bookshop" },
  { id: "harbour_homes", label: "Harbour Homes", category: "rent", seed: "visitor-harbour-homes" },
  { id: "victoria_fx", label: "Victoria FX", category: "services", seed: "visitor-victoria-fx" },
] as const;
export type VisitorPayeeId = (typeof VISITOR_PAYEES)[number]["id"];
export const VISITOR_PAYEE_IDS = VISITOR_PAYEES.map((p) => p.id) as [VisitorPayeeId, ...VisitorPayeeId[]];
export const VISITOR_CATEGORIES = ["food", "tuition", "rent", "services", "transport", "other"] as const;
export type VisitorCategory = (typeof VISITOR_CATEGORIES)[number];

/** Hard bounds, in whole test units (tHKD, 6 decimals). The visitor faucet mints up to 1,000 tHKD. */
export const VISITOR_BOUNDS = {
  unit: "tHKD",
  decimals: 6,
  faucet: 1_000n,
  dailyBudgetMax: 1_000n,
  t1Max: 200n,
  t2Max: 1_000n,
  floorMax: 900n,
  velocityCountMax: 50,
  velocityOutflowMax: 1_000n,
  validityDaysMax: 30,
  newPayeeT1Cap: 1n,
  unlistedServicesCap: 2n,
} as const;

/** Defaults when the visitor did not say (the same numbers as the standard visitor mandate). */
export const VISITOR_DEFAULTS = {
  budgets: { food: 100n, tuition: 300n, rent: 500n, services: 50n, transport: 50n, other: 50n } as Record<VisitorCategory, bigint>,
  t1Cap: 20n,
  t2Ceiling: 200n,
  reserveFloor: 100n,
  velocity: { window: "hour" as const, maxCount: 10, maxOutflow: 400n },
  validityDays: 30,
};

const amount = z.string().regex(/^[0-9]{1,15}(\.[0-9]{1,6})?$/, "a decimal amount of whole test units");

/** What a model or the rule parser may return. Every field is optional in meaning (null = the visitor did not say). */
export const VisitorRulesSchema = z.object({
  payees: z.array(z.enum(VISITOR_PAYEE_IDS)).max(VISITOR_PAYEES.length),
  budgets: z.array(z.object({ category: z.enum(VISITOR_CATEGORIES), amount })).max(VISITOR_CATEGORIES.length),
  t1Cap: amount.nullable(),
  t2Ceiling: amount.nullable(),
  reserveFloor: amount.nullable(),
  velocity: z.object({ window: z.enum(["hour", "day"]), maxCount: z.number().int().min(0).max(1_000_000).nullable(), maxOutflow: amount.nullable() }).nullable(),
  validityDays: z.number().int().min(0).max(100_000).nullable(),
  /** Phrases the extractor could not map to any field: shown to the visitor as NOT enforced. */
  unmapped: z.array(z.string().max(300)).max(20),
});
export type VisitorRules = z.infer<typeof VisitorRulesSchema>;

/** The JSON Schema given to models (strict, closed). */
export const VISITOR_RULES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["payees", "budgets", "t1Cap", "t2Ceiling", "reserveFloor", "velocity", "validityDays", "unmapped"],
  properties: {
    payees: { type: "array", items: { type: "string", enum: [...VISITOR_PAYEE_IDS] } },
    budgets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "amount"],
        properties: { category: { type: "string", enum: [...VISITOR_CATEGORIES] }, amount: { type: "string" } },
      },
    },
    t1Cap: { anyOf: [{ type: "string" }, { type: "null" }] },
    t2Ceiling: { anyOf: [{ type: "string" }, { type: "null" }] },
    reserveFloor: { anyOf: [{ type: "string" }, { type: "null" }] },
    velocity: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["window", "maxCount", "maxOutflow"],
          properties: {
            window: { type: "string", enum: ["hour", "day"] },
            maxCount: { anyOf: [{ type: "integer" }, { type: "null" }] },
            maxOutflow: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        },
        { type: "null" },
      ],
    },
    validityDays: { anyOf: [{ type: "integer" }, { type: "null" }] },
    unmapped: { type: "array", items: { type: "string" } },
  },
} as const;

export interface Adjustment {
  field: string;
  said: string | null;
  enforced: string;
  kind: "clamped" | "default" | "adjusted";
  reason: string;
}

/** Normalised rules: every value present, in base units, inside the bounds. */
export interface NormalisedVisitorRules {
  payees: VisitorPayeeId[];
  budgets: { category: VisitorCategory; amount: bigint }[];
  t1Cap: bigint;
  t2Ceiling: bigint;
  reserveFloor: bigint;
  velocity: { window: "hour" | "day"; maxCount: number; maxOutflow: bigint };
  validityDays: number;
  unmapped: string[];
}

const BASE = 10n ** BigInt(VISITOR_BOUNDS.decimals);
export function visitorToBase(v: string): bigint {
  const [w, f = ""] = v.split(".");
  return BigInt(w!) * BASE + BigInt((f + "000000").slice(0, VISITOR_BOUNDS.decimals) || "0");
}
export function visitorFromBase(v: bigint): string {
  const w = v / BASE;
  const f = (v % BASE).toString().padStart(VISITOR_BOUNDS.decimals, "0").replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

/** Apply bounds and defaults. Throws only if the input is not the closed schema. */
export function normaliseVisitorRules(input: unknown): { rules: NormalisedVisitorRules; adjustments: Adjustment[] } {
  const raw = VisitorRulesSchema.parse(input);
  const adj: Adjustment[] = [];
  const B = VISITOR_BOUNDS;
  const unitMax = (field: string, said: string | null, fallback: bigint, max: bigint, min = 0n): bigint => {
    if (said === null) {
      adj.push({ field, said: null, enforced: visitorFromBase(fallback * BASE), kind: "default", reason: "you did not say; the standard visitor value applies" });
      return fallback * BASE;
    }
    const v = visitorToBase(said);
    if (v > max * BASE) {
      adj.push({ field, said, enforced: visitorFromBase(max * BASE), kind: "clamped", reason: `above the visitor bound of ${max} ${B.unit} (test units; the faucet holds ${B.faucet})` });
      return max * BASE;
    }
    if (v < min * BASE) {
      adj.push({ field, said, enforced: visitorFromBase(min * BASE), kind: "clamped", reason: `below the minimum of ${min} ${B.unit}` });
      return min * BASE;
    }
    return v;
  };

  // Budgets: one per category (the last statement wins), each within the daily bound and at least 1.
  const said = new Map<VisitorCategory, string>();
  for (const b of raw.budgets) said.set(b.category, b.amount);
  // Payees: as named; else every catalogue payee of a budgeted category; else the standard three.
  let payees = [...new Set(raw.payees)];
  if (!payees.length) {
    payees = VISITOR_PAYEES.filter((p) => said.has(p.category as VisitorCategory)).map((p) => p.id);
    if (payees.length) adj.push({ field: "payees", said: null, enforced: payees.join(", "), kind: "default", reason: "no payee named: the catalogue payees of the categories you budgeted" });
    else {
      payees = ["arena_cafe", "kowloon_food_mart", "hbu_bookshop"];
      adj.push({ field: "payees", said: null, enforced: payees.join(", "), kind: "default", reason: "no payee or category named: the standard visitor payees" });
    }
  }
  const budgets: NormalisedVisitorRules["budgets"] = [];
  const needed = new Set<VisitorCategory>([...said.keys(), ...payees.map((id) => VISITOR_PAYEES.find((p) => p.id === id)!.category as VisitorCategory)]);
  for (const c of VISITOR_CATEGORIES) {
    if (!needed.has(c)) continue;
    budgets.push({ category: c, amount: unitMax(`budget.${c}`, said.get(c) ?? null, VISITOR_DEFAULTS.budgets[c], B.dailyBudgetMax, 1n) });
  }
  if (!budgets.some((b) => b.category === "services")) {
    // Payments to attested agents outside the payee book count as "services": kept tiny unless the visitor says otherwise.
    budgets.push({ category: "services", amount: B.unlistedServicesCap * BASE });
  }

  let t2 = unitMax("t2Ceiling", raw.t2Ceiling, VISITOR_DEFAULTS.t2Ceiling, B.t2Max, 1n);
  let t1 = unitMax("t1Cap", raw.t1Cap, VISITOR_DEFAULTS.t1Cap, B.t1Max, 0n);
  if (t1 > t2) {
    adj.push({ field: "t1Cap", said: raw.t1Cap, enforced: visitorFromBase(t2), kind: "adjusted", reason: "the amount the agent may pay alone cannot exceed the hard ceiling" });
    t1 = t2;
  }
  let floor = unitMax("reserveFloor", raw.reserveFloor, VISITOR_DEFAULTS.reserveFloor, B.floorMax, 0n);
  if (floor + 1n * BASE > B.faucet * BASE) floor = (B.faucet - 1n) * BASE;

  const v = raw.velocity;
  const window = v?.window ?? VISITOR_DEFAULTS.velocity.window;
  let maxCount = v?.maxCount ?? null;
  if (maxCount === null) {
    maxCount = VISITOR_DEFAULTS.velocity.maxCount;
    adj.push({ field: "velocity.maxCount", said: null, enforced: String(maxCount), kind: "default", reason: "you did not say; the standard visitor value applies" });
  } else if (maxCount > B.velocityCountMax || maxCount < 1) {
    const e = Math.min(Math.max(maxCount, 1), B.velocityCountMax);
    adj.push({ field: "velocity.maxCount", said: String(maxCount), enforced: String(e), kind: "clamped", reason: `between 1 and ${B.velocityCountMax} payments per ${window}` });
    maxCount = e;
  }
  const maxOutflow = unitMax("velocity.maxOutflow", v?.maxOutflow ?? null, VISITOR_DEFAULTS.velocity.maxOutflow, B.velocityOutflowMax, 1n);
  if (!v) adj.push({ field: "velocity.window", said: null, enforced: window, kind: "default", reason: "you did not say; the standard visitor value applies" });

  let validityDays = raw.validityDays ?? VISITOR_DEFAULTS.validityDays;
  if (raw.validityDays === null) adj.push({ field: "validityDays", said: null, enforced: String(validityDays), kind: "default", reason: "you did not say; the standard visitor value applies" });
  else if (validityDays > B.validityDaysMax || validityDays < 1) {
    const e = Math.min(Math.max(validityDays, 1), B.validityDaysMax);
    adj.push({ field: "validityDays", said: String(raw.validityDays), enforced: String(e), kind: "clamped", reason: `a visitor mandate lasts 1 to ${B.validityDaysMax} days` });
    validityDays = e;
  }

  return {
    rules: { payees, budgets, t1Cap: t1, t2Ceiling: t2, reserveFloor: floor, velocity: { window, maxCount, maxOutflow }, validityDays, unmapped: raw.unmapped },
    adjustments: adj,
  };
}

/** Normalised rules back to the closed schema (what the draft route returns and the sign-up route accepts). */
export function rulesToDraft(r: NormalisedVisitorRules): VisitorRules {
  return {
    payees: r.payees,
    budgets: r.budgets.map((b) => ({ category: b.category, amount: visitorFromBase(b.amount) })),
    t1Cap: visitorFromBase(r.t1Cap),
    t2Ceiling: visitorFromBase(r.t2Ceiling),
    reserveFloor: visitorFromBase(r.reserveFloor),
    velocity: { window: r.velocity.window, maxCount: r.velocity.maxCount, maxOutflow: visitorFromBase(r.velocity.maxOutflow) },
    validityDays: r.validityDays,
    unmapped: r.unmapped,
  };
}

export interface VisitorRuleParties {
  account: Address;
  agent: Address;
  issuerBank: Address;
  /** Address of each catalogue payee (label-derived addresses in the demo; no keys). */
  payeeAddress: (id: VisitorPayeeId) => Address;
}

/** Build the visitor's mandate from normalised rules (same structure as the standard visitor mandate). */
export function visitorMandateFromRules(
  d: Deployment,
  p: VisitorRuleParties,
  r: NormalisedVisitorRules,
  opts: { now: number; salt?: string; name: string; did?: string; sentences: string[]; timeUnit?: "s" | "ms" },
): Mandate {
  const ms = opts.timeUnit === "ms" ? 1000 : 1;
  const tHKD = addr(d, "TestHKD");
  const s = (v: bigint) => v.toString();
  return {
    schema: "yinglong.mandate/v1",
    title: "Your own rules (said, seen, sealed with your passkey)",
    ledger: d.ledger,
    jurisdiction: "hk",
    principal: { kind: "person", name: opts.name, did: opts.did ?? `did:pkh:eip155:${d.chainId}:${p.account.toLowerCase()}`, account: p.account },
    agent: { wallet: p.agent, label: "Ying" },
    lineageId: "visitor",
    salt: opts.salt ?? "1",
    validity: { from: opts.now - 60 * ms, until: opts.now + r.validityDays * 86400 * ms },
    assets: [{ symbol: "tHKD", address: tHKD, decimals: 6 }],
    methods: ["transfer"],
    payees: r.payees.map((id) => {
      const c = VISITOR_PAYEES.find((x) => x.id === id)!;
      return { id: c.id, label: c.label, address: p.payeeAddress(id), category: c.category };
    }),
    trustedIssuers: [{ label: "Harbour Digital Bank", address: p.issuerBank }],
    intermediaries: [],
    tiers: [
      {
        asset: "tHKD",
        defaultT1Cap: s(r.t1Cap),
        newPayeeT1Cap: s(r.t1Cap < VISITOR_BOUNDS.newPayeeT1Cap * BASE ? r.t1Cap : VISITOR_BOUNDS.newPayeeT1Cap * BASE),
        t2Ceiling: s(r.t2Ceiling),
        maxApprovalWindow: 600,
        categoryT1Caps: [],
      },
    ],
    budgets: [{ asset: "tHKD", periodStart: 0, periodLength: 86400 * ms, unlistedCategory: "services", caps: r.budgets.map((b) => ({ category: b.category, amount: s(b.amount) })) }],
    reserveFloors: [{ asset: "tHKD", amount: s(r.reserveFloor) }],
    velocity: { asset: "tHKD", window: (r.velocity.window === "hour" ? 3600 : 86400) * ms, maxCount: r.velocity.maxCount, maxOutflow: s(r.velocity.maxOutflow) },
    suitability: { maxRiskClass: 1 },
    reputation: null,
    facilitator: null,
    sentences: opts.sentences,
  };
}
