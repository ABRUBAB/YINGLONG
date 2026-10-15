import type { Address, Hex } from "viem";
import { abi, docHash } from "@yinglong/sdk";
import { CATEGORY_IDS, decodeCaveat, type DecodedRule, type Delegation, type Mandate } from "@yinglong/mandate";
import type { LedgerContext } from "../chain/ledger";

/**
 * Scale 5: the deterministic policy mirror. It evaluates the SAME rules the on-chain enforcers apply, from the
 * SAME decoded caveat bytes and the SAME on-chain counters, so the agent knows before submitting whether the
 * chain will accept, require the user's approval (T2), require a mandate change (T3) or refuse (T4).
 * Only this deterministic code (and the chain) may produce T4.
 */
export interface Payment {
  asset: Address;
  recipient: Address;
  beneficiary: Address;
  amount: bigint;
  method: "transfer" | "transferAndCall" | "instruct";
}

export interface PolicyRefusal {
  rule: string;
  typedError: string;
  detail: string;
}

export interface PolicyDecision {
  tier: "T1" | "T2" | "T3" | "T4";
  refusals: PolicyRefusal[];
  reasons: string[];
  t1Threshold?: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
  stateReads: Record<string, string>;
  stateReadsHash: Hex;
  maxFundsAtRisk?: bigint;
}

export async function evaluatePolicy(args: {
  ctx: LedgerContext;
  mandate: Mandate;
  delegation: Delegation;
  mandateHash: Hex;
  account: Address;
  agent: Address;
  payment: Payment;
}): Promise<PolicyDecision> {
  const { ctx, mandate, delegation, account, agent, payment } = args;
  const block = await ctx.pub.getBlock();
  const reads: Record<string, string> = {};
  const refusals: PolicyRefusal[] = [];
  const reasons: string[] = [];
  const rules: DecodedRule[] = delegation.caveats.map((c) => decodeCaveat(c, ctx.deployment));
  const dm = ctx.addr("DelegationManager");
  const lc = (a: string) => a.toLowerCase();
  const refuse = (rule: string, typedError: string, detail: string) => refusals.push({ rule, typedError, detail });

  // Pause and binding.
  const paused = await ctx.read<boolean>({ address: ctx.addr("KillSwitchRegistry"), abi: abi.KillSwitchRegistryAbi, functionName: "isPaused", args: [account, agent] });
  reads.paused = String(paused);
  if (paused) refuse("GlobalPauseEnforcer", "Paused", "the account is paused or the agent is halted");
  const live = await ctx.read<boolean>({ address: ctx.addr("MandateRegistry"), abi: abi.MandateRegistryAbi, functionName: "isLive", args: [args.mandateHash] });
  reads.mandateLive = String(live);
  if (!live) refuse("MandateBindingEnforcer", "MandateNotLive", "the mandate is not live");

  // Payee book entry of the beneficiary.
  const [known, category] = await ctx.read<[boolean, number]>({ address: ctx.addr("PayeeBook"), abi: abi.PayeeBookAbi, functionName: "lookup", args: [account, payment.beneficiary] });
  reads.payeeKnown = String(known);
  reads.payeeCategory = String(category);

  let t1Threshold: bigint | undefined;
  let tier: PolicyDecision["tier"] = "T1";
  let maxAtRisk: bigint | undefined;

  for (const r of rules) {
    switch (r.kind) {
      case "allowedTargets":
        if (!r.targets.some((t) => lc(t) === lc(payment.asset))) refuse("AllowedTargetsEnforcer", "AllowedTargetsEnforcer:target-address-not-allowed", payment.asset);
        break;
      case "jurisdiction": {
        if (!r.assets.some((a) => lc(a) === lc(payment.asset))) refuse("JurisdictionEnforcer", "RailNotPermitted", `${payment.asset} not sealed for ${r.profile}`);
        if (r.profile === "mainland") {
          const kind = await railKind(ctx, payment.asset);
          reads[`railKind:${payment.asset}`] = String(kind);
          if (kind !== 3) refuse("JurisdictionEnforcer", "RailNotPermitted", "mainland profile allows coin-free instructions only");
        }
        break;
      }
      case "verifiedPayee": {
        if (lc(payment.recipient) !== lc(payment.beneficiary) && !r.intermediaries.some((i) => lc(i) === lc(payment.recipient))) {
          refuse("VerifiedPayeeEnforcer", "PayeeNotVerified", `funds would go to ${payment.recipient} outside the sealed intermediaries`);
        }
        if (!known) {
          const attested =
            r.issuers.length > 0 &&
            (await ctx.read<boolean>({
              address: ctx.addr("YinglongPassportRegistry"),
              abi: abi.YinglongPassportRegistryAbi,
              functionName: "isTrustedAgentWallet",
              args: [payment.beneficiary, r.issuers],
            }));
          reads.beneficiaryAttested = String(attested);
          if (!attested) refuse("VerifiedPayeeEnforcer", "PayeeNotVerified", `${payment.beneficiary} is not in the payee book and not an attested agent`);
        }
        break;
      }
      case "coSign": {
        if (lc(r.asset) !== lc(payment.asset)) break;
        if (payment.amount > r.t2Ceiling) {
          tier = "T3";
          refuse("CoSignEnforcer", "AboveTierCeiling", `amount above the T2 ceiling of ${r.t2Ceiling}`);
        }
        let threshold = r.newPayeeT1Cap;
        if (known) {
          threshold = r.categoryT1Caps.find((c) => CATEGORY_IDS[c.category] === Number(category))?.amount ?? r.defaultT1Cap;
        }
        t1Threshold = threshold;
        if (payment.amount > threshold && tier === "T1") {
          tier = "T2";
          reasons.push(`above the T1 cap of ${threshold}: needs your approval`);
        }
        break;
      }
      case "categoryBudget": {
        if (lc(r.asset) !== lc(payment.asset)) break;
        const cat = known ? Number(category) : CATEGORY_IDS[r.unlistedCategory];
        const cap = r.caps.find((c) => CATEGORY_IDS[c.category] === cat)?.amount;
        const spent = await ctx.read<bigint>({
          address: ctx.addr("CategoryBudgetEnforcer"),
          abi: abi.CategoryBudgetEnforcerAbi,
          functionName: "spentNow",
          args: [dm, account, payment.asset, cat, r.periodStart, r.periodLength],
        });
        reads[`spent:${cat}`] = spent.toString();
        if (cap === undefined) refuse("CategoryBudgetEnforcer", "CategoryBudgetExceeded", `no budget for category ${cat}`);
        else {
          if (spent + payment.amount > cap) refuse("CategoryBudgetEnforcer", "CategoryBudgetExceeded", `${spent + payment.amount} would exceed the cap ${cap}`);
          const remaining = cap > spent ? cap - spent : 0n;
          maxAtRisk = maxAtRisk === undefined ? remaining : maxAtRisk + remaining;
        }
        break;
      }
      case "reserveFloor": {
        if (lc(r.asset) !== lc(payment.asset)) break;
        const bal = await ctx.read<bigint>({ address: payment.asset, abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [account] });
        reads[`balance:${payment.asset}`] = bal.toString();
        if (bal < payment.amount || bal - payment.amount < r.amount) refuse("ReserveFloorEnforcer", "ReserveFloorBreached", `balance after ${bal - payment.amount} below floor ${r.amount}`);
        break;
      }
      case "velocity": {
        const windowIndex = block.timestamp / r.window;
        const key = await ctx.read<Hex>({ address: ctx.addr("VelocityEnforcer"), abi: abi.VelocityEnforcerAbi, functionName: "usageKey", args: [dm, account, windowIndex] });
        const [count, outflow] = await ctx.read<[number, bigint]>({ address: ctx.addr("VelocityEnforcer"), abi: abi.VelocityEnforcerAbi, functionName: "usage", args: [key] });
        reads.velocityCount = String(count);
        reads.velocityOutflow = outflow.toString();
        const newOut = outflow + (lc(r.asset) === lc(payment.asset) ? payment.amount : 0n);
        if (Number(count) + 1 > r.maxCount || newOut > r.maxOutflow) refuse("VelocityEnforcer", "VelocityExceeded", `${Number(count) + 1} payments, ${newOut} out in this window`);
        break;
      }
      case "suitability": {
        for (const p of new Set([payment.recipient, payment.beneficiary])) {
          const [listed, riskClass] = await ctx.read<[boolean, number]>({ address: ctx.addr("ProductRegistry"), abi: abi.ProductRegistryAbi, functionName: "productInfo", args: [p] });
          if (listed) reads[`riskClass:${p}`] = String(riskClass);
          if (listed && Number(riskClass) > r.maxRiskClass) refuse("SuitabilityEnforcer", "UnsuitableProduct", `risk class ${riskClass} above ${r.maxRiskClass}`);
        }
        break;
      }
      default:
        break;
    }
  }

  if (refusals.some((x) => x.typedError !== "AboveTierCeiling")) tier = "T4";
  void mandate;
  return {
    tier,
    refusals,
    reasons,
    t1Threshold,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    stateReads: reads,
    stateReadsHash: docHash({ block: block.number.toString(), reads }),
    maxFundsAtRisk: maxAtRisk,
  };
}

async function railKind(ctx: LedgerContext, asset: Address): Promise<number> {
  try {
    return Number(await ctx.read<number>({ address: ctx.addr("JurisdictionEnforcer"), abi: abi.JurisdictionEnforcerAbi, functionName: "railKindOf", args: [asset] }));
  } catch {
    return 0;
  }
}
