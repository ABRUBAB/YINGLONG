/**
 * SAMPLE behaviour for fixtures mode only: a tiny keyword simulator standing in for the agent
 * runtime so the console, Mandate Studio and the Judge's Challenge can be exercised without a
 * backend. It follows the product's rules (master plan 4.1): AI signals (sentinel, anomaly) only
 * escalate; only deterministic scales (policy, counterparty, chain) refuse.
 */
import { encodeAbiParameters, hashStruct, keccak256, toHex, type Hex } from "viem";
import { DELEGATION_MANAGER, DELEGATION_TYPES } from "../../chain";
import { formatUnits, parseUnits } from "../../format";
import { SCALE_IDS, type Decision, type MandateDraft, type MandateRule, type ScaleId, type ScaleResult, type Tier } from "../view";
import { NADIA_ACCOUNT, YING_WALLET, nadiaRules, PAYEES } from "./data";
import { addr, amt, h, THKD } from "./util";


// Code-point ranges built from numbers so this source file stays ASCII-only.
const range = (a: number, b: number) => String.fromCodePoint(a) + "-" + String.fromCodePoint(b);
/** Bengali block U+0980-U+09FF (echoed Bangla input). */
const BENGALI = new RegExp("[" + range(0x0980, 0x09ff) + "]");
/** Bengali digits U+09E6-U+09EF. */
const BENGALI_DIGITS = new RegExp("[" + range(0x09e6, 0x09ef) + "]", "g");
/** Cyrillic look-alikes, zero-width and bidi control characters. */
const LOOKALIKE = new RegExp("[" + range(0x0400, 0x04ff) + range(0x200b, 0x200f) + range(0x202a, 0x202e) + "]");
const toAsciiDigits = (text: string) => text.replace(BENGALI_DIGITS, (d) => String(d.codePointAt(0)! - 0x09e6));

const AIGC = { label: "AI-generated" as const, model: "qwen3.5-9b-instruct-q4 (sample)", provider: "local" };

type Verdict = {
  stopAt?: ScaleId;
  stopKind?: "stopped" | "escalated";
  error?: string;
  reason?: string;
  escalations?: Partial<Record<ScaleId, { error: string; reason: string }>>;
  revert?: boolean;
};

function scales(v: Verdict, bypass = false, seed = "x"): ScaleResult[] {
  let reached = true;
  return SCALE_IDS.map((id, k) => {
    const durationMs = [3, 18, 41, 6, 4, 22, 140, 9, 1900][k]!;
    if (bypass && id !== "chain") {
      return { scale: id, status: "skipped", reason: "Bypassed: a raw redemption was sent straight to the chain.", error: null, durationMs: null, revert: null };
    }
    if (!reached) return { scale: id, status: "skipped", reason: null, error: null, durationMs: null, revert: null };
    const esc = v.escalations?.[id];
    if (v.stopAt === id) {
      reached = false;
      return {
        scale: id,
        status: v.stopKind ?? "stopped",
        reason: v.reason ?? null,
        error: v.error ?? null,
        durationMs,
        revert: v.revert ? { ledger: "base-sepolia", chainId: 84532, txHash: h(`tx:base:sim:${seed}`), blockNumber: null } : null,
      };
    }
    if (esc) return { scale: id, status: "escalated", reason: esc.reason, error: esc.error, durationMs, revert: null };
    return { scale: id, status: "passed", reason: null, error: null, durationMs, revert: null };
  }) as ScaleResult[];
}

function language(text: string): Decision["input"]["language"] {
  const bn = BENGALI.test(text);
  const latin = /[A-Za-z]/.test(text);
  if (bn && latin) return "mixed";
  if (bn) return "bn";
  return "en";
}

function amountIn(text: string): bigint | null {
  const ascii = toAsciiDigits(text);
  const m = /(\d[\d,]*(?:\.\d{1,6})?)/.exec(ascii);
  return m ? parseUnits(m[1]!, THKD.decimals) : null;
}

export function simulateDecision(text: string, opts: { bypass?: boolean; guest?: boolean } = {}): Decision {
  const t = text.toLowerCase();
  const seed = keccak256(toHex(text)).slice(2, 12);
  const value = amountIn(text);
  const amount = value !== null ? { value: value.toString(), decimals: THKD.decimals, symbol: THKD.symbol } : null;
  const base = {
    proposalId: `prop-${seed}`,
    createdAt: new Date().toISOString(),
    input: { text, language: language(text) },
    aigc: AIGC,
    plan: [] as string[],
    approvalId: null as string | null,
    receiptId: null as string | null,
    question: null as string | null,
  };
  const intent = (action: Decision["intent"]["action"], summary: string, payeeId: string | null, payeeName: string | null, category: string | null) => ({
    action,
    summary,
    payeeId,
    payeeName,
    amount,
    category,
    intentHash: h(`intent:sim:${seed}`),
  });
  const done = (
    tier: Tier,
    outcome: Decision["outcome"],
    i: Decision["intent"],
    s: ScaleResult[],
    explanation: string,
    extra: Partial<Decision> = {},
  ): Decision => ({ ...base, tier, outcome, intent: i, scales: s, explanation, ...extra });

  const injection = /(ignore|disregard|override|system prompt|new instructions|forget (the|your) rules|director approved|urgent|bank account (has )?changed|changed (its|their|our) bank)/i.test(text);
  const address = /0x[0-9a-f]{6,40}/i.test(text);
  const approve = /(approve|allowance|unlimited|permit)/i.test(text);
  const split = /(split|four payments|4 payments|in parts|several small)/i.test(text);
  const homoglyph = LOOKALIKE.test(text);

  if (opts.bypass) {
    const error = approve ? "ForbiddenTarget" : split ? "VelocityExceeded" : "PayeeNotVerified";
    return done(
      "T4",
      "refused",
      intent("pay", "Raw redemption sent straight to the chain", "NEW_PAYEE_REQUEST", "Unverified address", null),
      scales({ stopAt: "chain", error, reason: "The caveat enforcers reverted the redemption with a typed error. Nothing moved.", revert: true }, true, seed),
      "Even with every off-chain check bypassed, the enforcers on chain refused the redemption.",
    );
  }
  if (homoglyph) {
    return done(
      "ASK",
      "asking",
      intent("pay", "Payee name contains look-alike or invisible characters", null, null, null),
      scales({ stopAt: "normalise", stopKind: "escalated", error: "AmbiguousIntent", reason: "Look-alike or invisible characters were found in the payee name, so Ying stopped and asked." }),
      "The request named a payee with characters that only look like Latin letters. Ying will not guess which payee you meant.",
      { question: "Which payee in your PayeeBook did you mean?" },
    );
  }
  if (injection) {
    return done(
      "T4",
      "refused",
      intent("pay", "Pay a new account named in an untrusted message", "NEW_PAYEE_REQUEST", "Unverified account", "tuition"),
      scales({
        escalations: {
          sentinel: { error: "InjectionSuspected", reason: "The sentinel flagged instructions hidden in untrusted content. It can only escalate." },
          quarantine: { error: "TaintedField", reason: "The payee and amount came from a quarantined message, not from you." },
        },
        stopAt: "counterparty",
        error: "PayeeNotVerified",
        reason: "The account is not in your PayeeBook and no trusted issuer attests it. This rule is deterministic, so the action is refused.",
      }),
      "A message asked Ying to pay a new account. The sentinel escalated it, and the counterparty rule refused it because the account is not a verified payee.",
    );
  }
  if (approve) {
    return done(
      "T4",
      "refused",
      intent("other", "Grant a token allowance", null, null, null),
      scales({ stopAt: "policy", error: "ForbiddenTarget", reason: "Token approvals are never allowed by your mandate. Only transfer and escrow deposit are callable." }),
      "Your mandate does not let Ying approve token allowances, so the policy mirror refused the request before anything was signed.",
    );
  }
  if (split) {
    return done(
      "T4",
      "refused",
      intent("pay", "Several payments just under the ask threshold", null, null, null),
      scales({ stopAt: "policy", error: "VelocityExceeded", reason: "Splitting one payment into several stays inside each cap but breaks the 24-hour velocity rule." }),
      "Splitting a payment to avoid your approval threshold is caught by the velocity rule.",
    );
  }
  if (address) {
    return done(
      "T3",
      "reserved",
      intent("pay", "Pay an address that is not in your PayeeBook", "NEW_PAYEE_REQUEST", "New payee", null),
      scales({ stopAt: "counterparty", error: "PayeeNotVerified", reason: "Adding a payee is reserved for your own account. Ying cannot do it for you." }),
      "Ying never pays raw addresses. To pay someone new, add them to your PayeeBook yourself; the first payment will then ask you.",
    );
  }
  if (/(balance|how much|left|remaining|spent)/i.test(t)) {
    return done(
      "T0",
      "observed",
      { ...intent("observe", "Read balances and budgets", null, null, null), amount: null },
      scales({}),
      "Food: 1,153.50 of 3,000.00 tHKD left this month. Daily outflow: 7,763.20 of 12,000.00 tHKD left today. Balance stays above the 1,500.00 tHKD floor.",
    );
  }
  if (/(tuition|deposit|hbu)/i.test(t)) {
    return done(
      "T2",
      "awaiting_approval",
      { ...intent("escrow", "Tuition deposit to HBU Bursar into protected escrow", PAYEES.hbu.id, PAYEES.hbu.name, "tuition"), amount: amt("20000", THKD) },
      scales({ stopAt: "policy", stopKind: "escalated", error: "CoSignRequired", reason: "Above your 2,000.00 tHKD ask threshold, so your passkey must co-sign." }),
      "The tuition deposit is inside your mandate but above your ask threshold. Approve it on your phone and Ying will deposit it into escrow.",
      { approvalId: "apr-tuition" },
    );
  }
  if (/(rent|harbour homes|landlord)/i.test(t)) {
    return done(
      "T4",
      "refused",
      { ...intent("pay", "Rent to Harbour Homes", PAYEES.harbourHomes.id, PAYEES.harbourHomes.name, "rent"), amount: amt("9500", THKD) },
      scales({ stopAt: "policy", error: "CategoryBudgetExceeded", reason: "October rent of 9,500.00 tHKD was already paid on 1 Oct. A second payment would exceed the rent budget." }),
      "Rent for October is already paid, so a second rent payment is refused. This also stops a payee being paid twice.",
    );
  }
  if (/(grocer|food|lunch|dinner|market|kowloon fresh)/i.test(t)) {
    const v = value ?? parseUnits("120", THKD.decimals)!;
    const cap = parseUnits("1153.50", THKD.decimals)!;
    if (v > cap) {
      return done(
        "T4",
        "refused",
        { ...intent("pay", "Food purchase", PAYEES.kowloonFresh.id, PAYEES.kowloonFresh.name, "food"), amount: { value: v.toString(), decimals: 6, symbol: "tHKD" } },
        scales({ stopAt: "policy", error: "CategoryBudgetExceeded", reason: `Only 1,153.50 tHKD is left in this month's food budget.` }),
        "This purchase is more than the food budget has left this month.",
      );
    }
    const tier: Tier = v > parseUnits("2000", 6)! ? "T2" : "T1";
    return done(
      tier,
      tier === "T1" ? "executable" : "awaiting_approval",
      { ...intent("pay", "Food purchase at Kowloon Fresh Market", PAYEES.kowloonFresh.id, PAYEES.kowloonFresh.name, "food"), amount: { value: v.toString(), decimals: 6, symbol: "tHKD" } },
      scales({}),
      `Inside the food budget: ${formatUnits(v, 6)} tHKD to a verified payee. Ying paid it and wrote a receipt.`,
      { plan: ["Check the food budget", "Pay Kowloon Fresh Market from the food lane", "Write and anchor the receipt"] },
    );
  }
  return done(
    "ASK",
    "asking",
    { ...intent("other", "Unclear request", null, null, null) },
    scales({ stopAt: "ground", stopKind: "escalated", error: "AmbiguousIntent", reason: "The amount, payee or purpose could not be traced to your words or your mandate." }),
    "Ying could not tie this request to a payee and an amount it can verify, so it stopped instead of guessing.",
    { question: "Who should be paid, how much, and from which budget?" },
  );
}

export function attackFamily(text: string, bypass: boolean): string {
  if (bypass) return "Raw redemption (bypass)";
  if (LOOKALIKE.test(text)) return "Unicode look-alike payee";
  if (/(director approved|urgent)/i.test(text)) return "Urgent authority claim";
  if (/(ignore|disregard|override|system prompt|instructions)/i.test(text)) return "Hidden instruction";
  if (/bank account/i.test(text)) return "Changed bank account";
  if (/(approve|allowance|unlimited|permit)/i.test(text)) return "Token approval";
  if (/(split|in parts|several)/i.test(text)) return "Split payments";
  if (/0x[0-9a-f]{6,}/i.test(text)) return "Raw address payout";
  return "Free-form request";
}

/* ------------------------------------------------------------------ sample mandate compiler */

const fmt = (v: bigint) => formatUnits(v, THKD.decimals);

export function compileSample(text: string, jurisdiction: MandateDraft["jurisdiction"]): MandateDraft {
  const lang = language(text);
  const ascii = toAsciiDigits(text);
  const find = (re: RegExp) => {
    const m = re.exec(ascii);
    return m ? parseUnits(m[1]!.replace(/,/g, ""), THKD.decimals) : null;
  };
  const rent = find(/rent[^0-9]{0,40}(\d[\d,]*(?:\.\d+)?)/i) ?? parseUnits("9500", 6)!;
  const food = find(/food[^0-9]{0,30}(\d[\d,]*(?:\.\d+)?)/i) ?? parseUnits("3000", 6)!;
  const floor = find(/below[^0-9]{0,20}(\d[\d,]*(?:\.\d+)?)/i) ?? parseUnits("1500", 6)!;
  const ask = find(/(?:above|over)[^0-9]{0,20}(\d[\d,]*(?:\.\d+)?)/i) ?? parseUnits("2000", 6)!;
  const tuition = /tuition/i.test(ascii);

  const byId = Object.fromEntries(nadiaRules.map((r) => [r.id, r]));
  const rules: MandateRule[] = [byId.allowlist!];
  rules.push({ ...byId.rent!, sentence: `Pay rent of ${fmt(rent)} tHKD to Harbour Homes on the 1st of each month.`, params: { ...byId.rent!.params, cap: rent.toString() } });
  rules.push({ ...byId.food!, sentence: `Spend at most ${fmt(food)} tHKD on food each month.`, params: { ...byId.food!.params, cap: food.toString() } });
  rules.push({ ...byId.floor!, sentence: `Never let the tHKD balance fall below ${fmt(floor)} tHKD.`, params: { ...byId.floor!.params, floor: floor.toString() } });
  if (tuition) rules.push(byId.tuition!);
  rules.push({
    ...byId.ask!,
    sentence: `Ask me before any payment above ${fmt(ask)} tHKD and before paying anyone new.`,
    params: { ...byId.ask!.params, threshold: ask.toString() },
  });
  rules.push(byId.payees!, byId.velocity!);
  const railRule = { ...byId.rail! };
  if (jurisdiction !== "hk") {
    railRule.sentence =
      jurisdiction === "mainland"
        ? "Never approve tokens, call unlisted contracts or move anything of value on chain; use the coin-free rail."
        : "Never approve tokens, call unlisted contracts or leave the international test rail.";
    railRule.params = { ...railRule.params, profile: jurisdiction };
  }
  rules.push(railRule);

  const typedData = delegationTypedData(rules);
  const delegationHash = (hashStruct as (a: unknown) => Hex)({ data: typedData.message, primaryType: "Delegation", types: DELEGATION_TYPES });
  const mandateHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [delegationHash, jurisdiction]));
  return {
    draftId: `draft-${delegationHash.slice(2, 10)}`,
    jurisdiction,
    rules,
    delegationHash,
    mandateHash,
    serviceHashRing: null,
    wire: typedData,
    roundTrip: rules.map((r) => ({ ruleId: r.id, compiled: r.sentence, decoded: r.sentence, matches: true })),
    checks: [
      { id: "allowlist-first", label: "Target and method allowlist emitted first", passed: true },
      { id: "forbidden-disjoint", label: "Allowlist and forbidden set are disjoint", passed: true },
      { id: "codehash", label: "Every enforcer code hash matches the signed enforcer table", passed: true },
      { id: "decode", label: "Terms decode back to the same sentences", passed: true },
    ],
    warnings:
      lang === "en"
        ? []
        : ["Sample compiler: only English phrases are read in fixtures mode; the live compiler reads Bangla and Chinese input."],
    language: lang,
  };
}

const ROOT_AUTHORITY = `0x${"f".repeat(64)}` as Hex;

/** EIP-712 Delegation for the DelegationManager domain (sample caveat terms: ABI-encoded JSON params). */
export function delegationTypedData(rules: MandateRule[]) {
  return {
    domain: { name: "DelegationManager", version: "1", chainId: 84532, verifyingContract: DELEGATION_MANAGER },
    types: DELEGATION_TYPES,
    primaryType: "Delegation",
    message: {
      delegate: YING_WALLET,
      delegator: NADIA_ACCOUNT,
      authority: ROOT_AUTHORITY,
      caveats: rules.map((r) => ({
        enforcer: r.enforcerAddress ?? addr(`enforcer:${r.enforcer}`),
        terms: encodeAbiParameters([{ type: "string" }], [JSON.stringify(r.params)]),
      })),
      salt: "0",
    },
  };
}
