import { decodeAbiParameters, getAddress, slice, size, type Address, type Hex } from "viem";
import { nameByAddress, type Deployment } from "@yinglong/sdk";
import { categoryName, profileName, PROFILE_LABELS, SELECTORS, type Category, type Jurisdiction } from "./constants";
import type { Caveat } from "./delegation";

export type DecodedRule =
  | { kind: "allowedTargets"; targets: Address[] }
  | { kind: "allowedMethods"; methods: string[] }
  | { kind: "valueLte"; max: bigint }
  | { kind: "forbiddenTargets"; targets: Address[] }
  | { kind: "globalPause"; killSwitch: Address; passport: Address }
  | { kind: "agentLineage"; passport: Address; ownerDidHash: Hex; facilitator: Address }
  | { kind: "mandateBinding"; registry: Address; mandateHash: Hex }
  | { kind: "jurisdiction"; profile: Jurisdiction; assets: Address[] }
  | { kind: "verifiedPayee"; payeeBook: Address; passport: Address; issuers: Address[]; intermediaries: Address[] }
  | {
      kind: "coSign";
      payeeBook: Address;
      asset: Address;
      defaultT1Cap: bigint;
      newPayeeT1Cap: bigint;
      t2Ceiling: bigint;
      maxApprovalWindow: bigint;
      categoryT1Caps: { category: Category; amount: bigint }[];
    }
  | {
      kind: "categoryBudget";
      payeeBook: Address;
      asset: Address;
      periodStart: bigint;
      periodLength: bigint;
      unlistedCategory: Category;
      caps: { category: Category; amount: bigint }[];
    }
  | { kind: "reserveFloor"; asset: Address; amount: bigint }
  | { kind: "velocity"; asset: Address; window: bigint; maxCount: number; maxOutflow: bigint }
  | { kind: "suitability"; registry: Address; maxRiskClass: number }
  | { kind: "zkMandate"; router: Address; commitment: Hex }
  | { kind: "unknown"; enforcer: Address; terms: Hex };

export interface Names {
  /** Lower-case address to a human label (assets, payees, issuers, intermediaries, contracts). */
  label: Map<string, string>;
  /** Lower-case asset address to decimals. */
  decimals: Map<string, number>;
}

function packedAddresses(terms: Hex): Address[] {
  const n = size(terms);
  if (n % 20 !== 0) throw new Error("packed address list has a bad length");
  const out: Address[] = [];
  for (let i = 0; i < n; i += 20) out.push(getAddress(slice(terms, i, i + 20)));
  return out;
}

const SELECTOR_NAMES = new Map<string, string>(Object.entries(SELECTORS).map(([k, v]) => [v, k]));

/** Decode one caveat's terms by its enforcer. Bytes are the source of truth; labels are only for display. */
export function decodeCaveat(c: Caveat, d: Deployment): DecodedRule {
  const name = nameByAddress(d).get(c.enforcer.toLowerCase());
  const t = c.terms;
  switch (name) {
    case "AllowedTargetsEnforcer":
      return { kind: "allowedTargets", targets: packedAddresses(t) };
    case "AllowedMethodsEnforcer": {
      const methods: string[] = [];
      for (let i = 0; i < size(t); i += 4) {
        const sel = slice(t, i, i + 4);
        methods.push(SELECTOR_NAMES.get(sel) ?? sel);
      }
      return { kind: "allowedMethods", methods };
    }
    case "ValueLteEnforcer":
      return { kind: "valueLte", max: decodeAbiParameters([{ type: "uint256" }], t)[0] };
    case "ForbiddenTargetsEnforcer":
      return { kind: "forbiddenTargets", targets: packedAddresses(t) };
    case "GlobalPauseEnforcer": {
      const [killSwitch, passport] = decodeAbiParameters([{ type: "address" }, { type: "address" }], t);
      return { kind: "globalPause", killSwitch, passport };
    }
    case "AgentLineageEnforcer": {
      const [passport, ownerDidHash, facilitator] = decodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "address" }], t);
      return { kind: "agentLineage", passport, ownerDidHash, facilitator };
    }
    case "MandateBindingEnforcer": {
      const [registry, mandateHash] = decodeAbiParameters([{ type: "address" }, { type: "bytes32" }], t);
      return { kind: "mandateBinding", registry, mandateHash };
    }
    case "JurisdictionEnforcer": {
      const [profile, assets] = decodeAbiParameters([{ type: "uint8" }, { type: "address[]" }], t);
      return { kind: "jurisdiction", profile: profileName(profile), assets: [...assets] };
    }
    case "VerifiedPayeeEnforcer": {
      const [payeeBook, passport, issuers, intermediaries] = decodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address[]" }, { type: "address[]" }],
        t,
      );
      return { kind: "verifiedPayee", payeeBook, passport, issuers: [...issuers], intermediaries: [...intermediaries] };
    }
    case "CoSignEnforcer": {
      const [payeeBook, asset, defaultT1Cap, newPayeeT1Cap, t2Ceiling, maxApprovalWindow, cats, caps] = decodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint32[]" },
          { type: "uint256[]" },
        ],
        t,
      );
      return {
        kind: "coSign",
        payeeBook,
        asset,
        defaultT1Cap,
        newPayeeT1Cap,
        t2Ceiling,
        maxApprovalWindow,
        categoryT1Caps: cats.map((c, i) => ({ category: categoryName(c), amount: caps[i]! })),
      };
    }
    case "CategoryBudgetEnforcer": {
      const [payeeBook, asset, periodStart, periodLength, unlisted, cats, caps] = decodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "uint32" },
          { type: "uint32[]" },
          { type: "uint256[]" },
        ],
        t,
      );
      return {
        kind: "categoryBudget",
        payeeBook,
        asset,
        periodStart,
        periodLength,
        unlistedCategory: categoryName(unlisted),
        caps: cats.map((c, i) => ({ category: categoryName(c), amount: caps[i]! })),
      };
    }
    case "ReserveFloorEnforcer": {
      const [asset, amount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], t);
      return { kind: "reserveFloor", asset, amount };
    }
    case "VelocityEnforcer": {
      const [asset, window, maxCount, maxOutflow] = decodeAbiParameters(
        [{ type: "address" }, { type: "uint64" }, { type: "uint32" }, { type: "uint256" }],
        t,
      );
      return { kind: "velocity", asset, window, maxCount, maxOutflow };
    }
    case "SuitabilityEnforcer": {
      const [registry, maxRiskClass] = decodeAbiParameters([{ type: "address" }, { type: "uint8" }], t);
      return { kind: "suitability", registry, maxRiskClass };
    }
    case "ZKMandateEnforcer": {
      const [router, commitment] = decodeAbiParameters([{ type: "address" }, { type: "bytes32" }], t);
      return { kind: "zkMandate", router, commitment };
    }
    default:
      return { kind: "unknown", enforcer: c.enforcer, terms: c.terms };
  }
}

// ---------------------------------------------------------------- English sentences

export function formatUnits(amount: bigint, decimals: number): string {
  const neg = amount < 0n;
  const a = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = (a / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

function duration(seconds: bigint, unit: "s" | "ms" = "s"): string {
  const s = unit === "ms" ? seconds / 1000n : seconds;
  if (s % 86400n === 0n) return s === 86400n ? "day" : `${s / 86400n} days`;
  if (s % 3600n === 0n) return s === 3600n ? "hour" : `${s / 3600n} hours`;
  if (s % 60n === 0n) return `${s / 60n} minutes`;
  return `${s} seconds`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** One plain-English sentence per rule. Every number and address comes from the decoded bytes. */
export function sentence(r: DecodedRule, names: Names, timeUnit: "s" | "ms" = "s"): string {
  const L = (a: string) => names.label.get(a.toLowerCase()) ?? `${a.slice(0, 6)}...${a.slice(-4)}`;
  const amt = (asset: Address, v: bigint) => `${formatUnits(v, names.decimals.get(asset.toLowerCase()) ?? 0)} ${L(asset)}`;
  switch (r.kind) {
    case "allowedTargets":
      return `The agent can only touch these assets: ${list(r.targets.map(L))}.`;
    case "allowedMethods":
      return `It can only call: ${list(r.methods)}. Approvals and any other function are refused.`;
    case "valueLte":
      return r.max === 0n ? "It can never send the native coin." : `It can send at most ${r.max} wei of the native coin.`;
    case "forbiddenTargets":
      return `It can never call your own account or ${r.targets.length} protocol contracts (${list(r.targets.map(L))}).`;
    case "globalPause":
      return "Everything stops the moment you press Pause, your guardian pauses, or the supervisor halts this agent.";
    case "agentLineage":
      return r.facilitator === "0x0000000000000000000000000000000000000000"
        ? "Only agents whose passport is bound to your identity can use this mandate."
        : `Only agents whose passport is bound to your identity, or the pinned payment facilitator ${L(r.facilitator)} for single-use payments, can use this mandate.`;
    case "mandateBinding":
      return `It works only while mandate ${r.mandateHash.slice(0, 10)}... is live in the public mandate registry.`;
    case "jurisdiction":
      return `Jurisdiction: ${PROFILE_LABELS[r.profile]}. Rails allowed: ${list(r.assets.map(L))}.`;
    case "verifiedPayee": {
      const who = r.issuers.length ? ` or to agents attested by ${list(r.issuers.map(L))}` : "";
      const via = r.intermediaries.length ? `, through ${list(r.intermediaries.map(L))} only` : "";
      return `Money goes only to payees in your payee book${who}${via}.`;
    }
    case "coSign": {
      const special = r.categoryT1Caps.map((c) => `${c.category} up to ${amt(r.asset, c.amount)}`);
      const s1 = `Payments above ${amt(r.asset, r.defaultT1Cap)} need your approval on your phone`;
      const s2 = special.length ? ` (except ${list(special)})` : "";
      return `${s1}${s2}; anyone new above ${amt(r.asset, r.newPayeeT1Cap)} also needs you; nothing above ${amt(r.asset, r.t2Ceiling)} is possible at all.`;
    }
    case "categoryBudget":
      return `Every ${duration(r.periodLength, timeUnit)}: ${list(r.caps.map((c) => `${c.category} at most ${amt(r.asset, c.amount)}`))}.`;
    case "reserveFloor":
      return `Your ${L(r.asset)} balance never goes below ${amt(r.asset, r.amount)}.`;
    case "velocity":
      return `At most ${r.maxCount} payments and ${amt(r.asset, r.maxOutflow)} per ${duration(r.window, timeUnit)}.`;
    case "suitability":
      return `Idle cash goes only into products of risk class ${r.maxRiskClass} or lower.`;
    case "zkMandate":
      return `Private mandate: every payment must carry a zero-knowledge proof that it stays within the hidden cap, payee list and expiry committed as ${r.commitment.slice(0, 10)}...`;
    case "unknown":
      return `Unknown rule at ${r.enforcer}; refuse to seal.`;
  }
}

export function decompile(caveats: Caveat[], d: Deployment, names: Names, timeUnit: "s" | "ms" = "s") {
  const rules = caveats.map((c) => decodeCaveat(c, d));
  return { rules, sentences: rules.map((r) => sentence(r, names, timeUnit)) };
}
