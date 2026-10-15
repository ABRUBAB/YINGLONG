import { formatUnits } from "@yinglong/mandate";

/**
 * Explainer. The text is assembled from templates keyed by reason codes; every amount, name, date and hash
 * is filled in by code from the decision record. A validator checks that every number and hex string in
 * the final text appears in the record; anything else falls back to the plain template. Explanations are
 * labelled "AI-generated" only when a model wrote connective prose (here: never for money facts).
 */
export interface ExplainInput {
  tier: string;
  decision: "execute" | "needs_approval" | "refused" | "ask";
  payeeLabel?: string;
  amount?: bigint;
  decimals?: number;
  symbol?: string;
  typedError?: string;
  refusalDetail?: string;
  stoppedAt?: string;
  t1Threshold?: bigint;
  flags?: string[];
  question?: string;
  txHash?: string;
}

const TEMPLATES: Record<string, (x: ExplainInput, a: string) => string> = {
  execute: (x, a) => `Ready to pay ${a} to ${x.payeeLabel}. It is inside your mandate, so I can do it on my own; you will get a receipt.`,
  needs_approval: (x, a) =>
    `I can pay ${a} to ${x.payeeLabel}, but it is above what I may do alone${x.t1Threshold !== undefined && x.decimals !== undefined ? ` (${formatUnits(x.t1Threshold, x.decimals)} ${x.symbol})` : ""}. Approve it on your phone if you want it.`,
  refused: (x, a) =>
    `I did not pay ${a}${x.payeeLabel ? ` to ${x.payeeLabel}` : ""}. ${x.stoppedAt ?? "A rule"} refused it${x.typedError ? ` (${x.typedError})` : ""}${x.refusalDetail ? `: ${x.refusalDetail}` : ""}.`,
  ask: (x) => `Not sure, your call. ${x.question ?? "Something in this request needs your decision."}`,
};

export function explain(x: ExplainInput): { text: string; aiGenerated: boolean; template: string } {
  const a = x.amount !== undefined && x.decimals !== undefined ? `${formatUnits(x.amount, x.decimals)} ${x.symbol ?? ""}`.trim() : "this";
  let text = TEMPLATES[x.decision]!(x, a);
  if (x.flags?.length && x.decision !== "execute") text += ` I also noticed: ${x.flags.join("; ")}.`;
  if (!validate(text, x)) text = TEMPLATES[x.decision]!({ ...x, flags: [] }, a);
  return { text, aiGenerated: false, template: x.decision };
}

/** Every numeral and hex string in the text must come from the decision record. */
export function validate(text: string, x: ExplainInput): boolean {
  const allowed = new Set<string>();
  const add = (s?: string) => s && s.match(/[0-9][0-9,.]*|0x[0-9a-fA-F]+/g)?.forEach((m) => allowed.add(m.replace(/[.,]$/, "")));
  if (x.amount !== undefined && x.decimals !== undefined) add(formatUnits(x.amount, x.decimals));
  if (x.t1Threshold !== undefined && x.decimals !== undefined) add(formatUnits(x.t1Threshold, x.decimals));
  add(x.typedError);
  add(x.refusalDetail);
  add(x.txHash);
  add(x.question);
  add(x.payeeLabel);
  x.flags?.forEach(add);
  add(x.stoppedAt);
  const found = text.match(/[0-9][0-9,.]*|0x[0-9a-fA-F]+/g) ?? [];
  return found.every((f) => allowed.has(f.replace(/[.,]$/, "")) || /^[0-9]$/.test(f));
}
