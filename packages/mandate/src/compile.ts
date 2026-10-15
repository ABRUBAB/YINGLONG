import { concat, encodeAbiParameters, encodePacked, type Address, type Hex } from "viem";
import { addr, type Deployment } from "@yinglong/sdk";
import { canonicalHash, textHash } from "./canonical";
import { CATEGORY_IDS, PROFILE_IDS, SELECTORS, type Category } from "./constants";
import { delegationHash, rootDelegation, type Caveat, type Delegation } from "./delegation";
import { MandateSchema, type Mandate } from "./schema";

/** Extra addresses no delegation may ever call, on top of the deployment's own protocol contracts. */
export const EXTRA_FORBIDDEN: Record<string, Address[]> = {
  "base-sepolia": [
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032", // EntryPoint v0.7
    "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108", // EntryPoint v0.8
    "0x433709009B8330FDa32311DF1C2AFA402eD8D009", // EntryPoint v0.9
    "0x31BE08D380A21fc740883c0BC434FcFc88740b58", // Circle Paymaster v0.7
    "0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966", // Circle Paymaster v0.8
    "0x8004A818BFB912233c491871b3d84c89A494BD9e", // ERC-8004 IdentityRegistry
    "0x8004B663056A597Dffe9eCcC1965A193B7388713", // ERC-8004 ReputationRegistry
  ],
};

/** The order in which the compiler emits caveats. The allowlists always come first. */
export const CAVEAT_ORDER = [
  "AllowedTargetsEnforcer",
  "AllowedMethodsEnforcer",
  "ValueLteEnforcer",
  "ForbiddenTargetsEnforcer",
  "GlobalPauseEnforcer",
  "AgentLineageEnforcer",
  "MandateBindingEnforcer",
  "JurisdictionEnforcer",
  "VerifiedPayeeEnforcer",
  "CoSignEnforcer",
  "CategoryBudgetEnforcer",
  "ReserveFloorEnforcer",
  "VelocityEnforcer",
  "SuitabilityEnforcer",
  "ReputationGateEnforcer",
] as const;

export interface CompiledMandate {
  mandate: Mandate;
  mandateHash: Hex;
  lineageIdHash: Hex;
  caveats: Caveat[];
  delegation: Delegation;
  delegationHash: Hex;
  publishParams: {
    mandateHash: Hex;
    agent: Address;
    lineageId: Hex;
    jurisdiction: number;
    validFrom: bigint;
    validUntil: bigint;
    salt: bigint;
    caveats: Caveat[];
  };
}

const lower = (a: string) => a.toLowerCase();

function assetAddress(m: Mandate, symbol: string): Address {
  const a = m.assets.find((x) => x.symbol === symbol);
  if (!a) throw new Error(`mandate references unknown asset ${symbol}`);
  return a.address as Address;
}

const catId = (c: string) => CATEGORY_IDS[c as Category];

export function forbiddenTargets(d: Deployment): Address[] {
  const own: Address[] = [
    addr(d, "DelegationManager"),
    addr(d, "EntryPoint"),
    addr(d, "PayeeBook"),
    addr(d, "MandateRegistry"),
    addr(d, "KillSwitchRegistry"),
    addr(d, "YinglongPassportRegistry"),
    addr(d, "AccountabilityLedger"),
    addr(d, "ProductRegistry"),
  ];
  const all = [...own, ...(EXTRA_FORBIDDEN[d.ledger] ?? [])];
  return [...new Map(all.map((a) => [lower(a), a])).values()];
}

/** Compile a mandate document into the exact caveat array its delegation carries. Pure and deterministic. */
export function compileMandate(input: Mandate, d: Deployment): CompiledMandate {
  const m = MandateSchema.parse(input);
  if (m.ledger !== d.ledger) throw new Error(`mandate is for ${m.ledger}, deployment is ${d.ledger}`);
  const mandateHash = canonicalHash(m);
  const lineageIdHash = textHash(m.lineageId);
  const account = m.principal.account as Address;
  const agent = m.agent.wallet as Address;
  const caveats: Caveat[] = [];
  const push = (name: Parameters<typeof addr>[1], terms: Hex) => caveats.push({ enforcer: addr(d, name), terms, args: "0x" });

  // 1. Allowlists first.
  const targets = m.assets.map((a) => a.address as Address);
  const forbidden = forbiddenTargets(d);
  const forbiddenSet = new Set(forbidden.map(lower));
  for (const t of targets) {
    if (forbiddenSet.has(lower(t)) || lower(t) === lower(account)) throw new Error(`allowlist overlaps the forbidden set: ${t}`);
  }
  push("AllowedTargetsEnforcer", concat(targets.map((t) => encodePacked(["address"], [t]))));
  push("AllowedMethodsEnforcer", concat(m.methods.map((x) => SELECTORS[x] as Hex)));
  push("ValueLteEnforcer", encodeAbiParameters([{ type: "uint256" }], [0n]));
  push("ForbiddenTargetsEnforcer", concat(forbidden.map((t) => encodePacked(["address"], [t]))));

  // 2. Identity, pause and binding.
  push(
    "GlobalPauseEnforcer",
    encodeAbiParameters([{ type: "address" }, { type: "address" }], [addr(d, "KillSwitchRegistry"), addr(d, "YinglongPassportRegistry")]),
  );
  push(
    "AgentLineageEnforcer",
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }, { type: "address" }],
      [addr(d, "YinglongPassportRegistry"), textHash(m.principal.did), (m.facilitator ?? "0x0000000000000000000000000000000000000000") as Address],
    ),
  );
  push("MandateBindingEnforcer", encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [addr(d, "MandateRegistry"), mandateHash]));

  // 3. Rails and payees.
  push(
    "JurisdictionEnforcer",
    encodeAbiParameters([{ type: "uint8" }, { type: "address[]" }], [PROFILE_IDS[m.jurisdiction], targets]),
  );
  push(
    "VerifiedPayeeEnforcer",
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address[]" }, { type: "address[]" }],
      [
        addr(d, "PayeeBook"),
        addr(d, "YinglongPassportRegistry"),
        m.trustedIssuers.map((x) => x.address as Address),
        m.intermediaries.map((x) => x.address as Address),
      ],
    ),
  );

  // 4. Tiers (T1 caps, T2 approval, T3 ceiling), per asset.
  for (const t of m.tiers) {
    push(
      "CoSignEnforcer",
      encodeAbiParameters(
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
        [
          addr(d, "PayeeBook"),
          assetAddress(m, t.asset),
          BigInt(t.defaultT1Cap),
          BigInt(t.newPayeeT1Cap),
          BigInt(t.t2Ceiling),
          BigInt(t.maxApprovalWindow),
          t.categoryT1Caps.map((c) => catId(c.category)),
          t.categoryT1Caps.map((c) => BigInt(c.amount)),
        ],
      ),
    );
  }

  // 5. Budgets that bite, reserve floor, velocity, suitability, reputation.
  for (const b of m.budgets) {
    push(
      "CategoryBudgetEnforcer",
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "uint32" },
          { type: "uint32[]" },
          { type: "uint256[]" },
        ],
        [
          addr(d, "PayeeBook"),
          assetAddress(m, b.asset),
          BigInt(b.periodStart),
          BigInt(b.periodLength),
          catId(b.unlistedCategory),
          b.caps.map((c) => catId(c.category)),
          b.caps.map((c) => BigInt(c.amount)),
        ],
      ),
    );
  }
  for (const f of m.reserveFloors) {
    push("ReserveFloorEnforcer", encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [assetAddress(m, f.asset), BigInt(f.amount)]));
  }
  if (m.velocity) {
    push(
      "VelocityEnforcer",
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint64" }, { type: "uint32" }, { type: "uint256" }],
        [assetAddress(m, m.velocity.asset), BigInt(m.velocity.window), m.velocity.maxCount, BigInt(m.velocity.maxOutflow)],
      ),
    );
  }
  if (m.suitability) {
    push("SuitabilityEnforcer", encodeAbiParameters([{ type: "address" }, { type: "uint8" }], [addr(d, "ProductRegistry"), m.suitability.maxRiskClass]));
  }
  if (m.reputation) {
    throw new Error("reputation gate requires an ERC-8004 reputation registry address in the deployment (not configured yet)");
  }

  const salt = BigInt(m.salt);
  const delegation = rootDelegation(account, agent, caveats, salt);
  const dh = delegationHash(delegation);
  return {
    mandate: m,
    mandateHash,
    lineageIdHash,
    caveats,
    delegation,
    delegationHash: dh,
    publishParams: {
      mandateHash,
      agent,
      lineageId: lineageIdHash,
      jurisdiction: PROFILE_IDS[m.jurisdiction],
      validFrom: BigInt(m.validity.from),
      validUntil: BigInt(m.validity.until),
      salt,
      caveats,
    },
  };
}
