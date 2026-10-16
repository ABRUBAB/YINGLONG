import { erc20Abi, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi } from "@yinglong/sdk";
import { decodeCaveat, type Delegation } from "@yinglong/mandate";
import type { LedgerContext } from "./chain/ledger";

/**
 * Suitability explanation card (suitability as code). For a sweep into a product, the card shows what the
 * chain will check: the product's risk class from the on-chain ProductRegistry, the maximum class sealed in
 * the mandate's SuitabilityEnforcer caveat, and the deterministic verdict with its reason. Text is assembled
 * by code from these reads; no model is involved.
 */
export const RISK_LABELS: Record<number, string> = { 1: "lowest (cash-like)", 2: "low", 3: "medium", 4: "high", 5: "highest" };

export interface SuitabilityCard {
  product: { id?: string; label: string; address: Address; onChainName?: string; nameMatchesRegistry?: boolean };
  listed: boolean;
  riskClass: number | null;
  riskLabel: string;
  mandateMaxRiskClass: number | null;
  mandateMaxLabel: string;
  verdict: "suitable" | "unsuitable" | "not a listed product" | "no suitability rule sealed";
  outcome: "approved" | "needs your approval" | "refused" | "held";
  why: string[];
  source: { registry: Address; function: "productInfo"; enforcer: "SuitabilityEnforcer"; block: string; ledger: string };
  label: string;
}

export function buildSuitabilityCard(x: {
  product: SuitabilityCard["product"];
  listed: boolean;
  riskClass: number;
  maxRiskClass: number | null;
  decision: "execute" | "needs_approval" | "refused" | "ask" | "answered";
  registry: Address;
  block: bigint;
  ledger: string;
}): SuitabilityCard {
  const verdict: SuitabilityCard["verdict"] =
    x.maxRiskClass === null ? "no suitability rule sealed" : !x.listed ? "not a listed product" : x.riskClass > x.maxRiskClass ? "unsuitable" : "suitable";
  const why: string[] = [];
  if (x.listed) why.push(`${x.product.label} is listed in the ProductRegistry with risk class ${x.riskClass} (${RISK_LABELS[x.riskClass] ?? "unknown"}).`);
  else why.push(`${x.product.label} is not listed in the ProductRegistry, so the suitability rule does not apply to it.`);
  if (x.maxRiskClass !== null) why.push(`The mandate allows products up to risk class ${x.maxRiskClass} (${RISK_LABELS[x.maxRiskClass] ?? "unknown"}), the result of the suitability assessment sealed in it.`);
  if (verdict === "unsuitable") why.push(`Class ${x.riskClass} is above ${x.maxRiskClass}: the SuitabilityEnforcer reverts this sweep with UnsuitableProduct, whatever the agent or anyone says.`);
  if (verdict === "suitable") why.push(`Class ${x.riskClass} is within ${x.maxRiskClass}: the suitability rule allows this sweep; the other mandate rules still apply.`);
  if (x.decision === "needs_approval" || x.decision === "ask") why.push("This sweep still waits for your approval (for example, the first sweep into a product).");
  if (x.product.nameMatchesRegistry === false) why.push("The product name in your payee book does not match the name hash in the registry.");
  return {
    product: x.product,
    listed: x.listed,
    riskClass: x.listed ? x.riskClass : null,
    riskLabel: x.listed ? (RISK_LABELS[x.riskClass] ?? "unknown") : "not listed",
    mandateMaxRiskClass: x.maxRiskClass,
    mandateMaxLabel: x.maxRiskClass === null ? "none sealed" : (RISK_LABELS[x.maxRiskClass] ?? "unknown"),
    verdict,
    outcome: x.decision === "execute" ? "approved" : x.decision === "needs_approval" ? "needs your approval" : x.decision === "refused" ? "refused" : "held",
    why,
    source: { registry: x.registry, function: "productInfo", enforcer: "SuitabilityEnforcer", block: x.block.toString(), ledger: x.ledger },
    label: "Test products only; no real fund is represented. Risk classes are set by the test registry admin.",
  };
}

/** Read the registry and the sealed caveat for a sweep's product. */
export async function suitabilityCard(
  ctx: LedgerContext,
  delegation: Delegation,
  product: { id?: string; label: string; address: Address },
  decision: "execute" | "needs_approval" | "refused" | "ask" | "answered",
): Promise<SuitabilityCard> {
  const registry = ctx.addr("ProductRegistry");
  const block = await ctx.pub.getBlockNumber();
  const [listed, riskClass] = await ctx.read<[boolean, number]>({ address: registry, abi: abi.ProductRegistryAbi, functionName: "productInfo", args: [product.address] });
  const rule = delegation.caveats.map((c) => decodeCaveat(c, ctx.deployment)).find((r) => r.kind === "suitability");
  let onChainName: string | undefined;
  let nameMatchesRegistry: boolean | undefined;
  try {
    onChainName = await ctx.read<string>({ address: product.address, abi: erc20Abi, functionName: "name" });
    const p = await ctx.read<[boolean, number, Hex]>({ address: registry, abi: abi.ProductRegistryAbi, functionName: "products", args: [product.address] });
    // The registry commits the product's name; the payee label in the mandate must hash to it.
    if (p[2] && !/^0x0+$/.test(p[2])) nameMatchesRegistry = keccak256(stringToBytes(product.label)).toLowerCase() === p[2].toLowerCase();
  } catch {
    /* not an ERC-20 product or no name */
  }
  return buildSuitabilityCard({
    product: { ...product, onChainName, nameMatchesRegistry },
    listed,
    riskClass: Number(riskClass),
    maxRiskClass: rule && rule.kind === "suitability" ? rule.maxRiskClass : null,
    decision,
    registry,
    block,
    ledger: ctx.name,
  });
}
