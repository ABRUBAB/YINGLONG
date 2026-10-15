import { CONTRACT_NAMES, type Deployment } from "@yinglong/sdk";
import type { Names } from "./decompile";
import type { Mandate } from "./schema";

const PRETTY: Partial<Record<(typeof CONTRACT_NAMES)[number], string>> = {
  TestHKD: "tHKD",
  TestUSD: "tUSD",
  ProtectedPayment: "escrow (ProtectedPayment)",
  SignedQuoteSettlement: "quote settlement",
  ConditionalPaymentInstructions: "coin-free instructions",
  TestMoneyMarketFund: "Test Money Market Fund",
  TestGrowthFund: "Test Growth Fund",
};

/** Display labels from the deployment and the mandate document (labels never affect enforcement). */
export function namesFor(d: Deployment, m?: Mandate): Names {
  const label = new Map<string, string>();
  const decimals = new Map<string, number>();
  for (const n of CONTRACT_NAMES) label.set(d.contracts[n].address.toLowerCase(), PRETTY[n] ?? n);
  decimals.set(d.contracts.TestHKD.address.toLowerCase(), 6);
  decimals.set(d.contracts.TestUSD.address.toLowerCase(), 6);
  decimals.set(d.contracts.ConditionalPaymentInstructions.address.toLowerCase(), 2);
  if (m) {
    for (const a of m.assets) {
      label.set(a.address.toLowerCase(), a.symbol);
      decimals.set(a.address.toLowerCase(), a.decimals);
    }
    for (const p of m.payees) label.set(p.address.toLowerCase(), p.label);
    for (const i of m.trustedIssuers) label.set(i.address.toLowerCase(), i.label);
    for (const i of m.intermediaries) label.set(i.address.toLowerCase(), i.label);
  }
  return { label, decimals };
}
