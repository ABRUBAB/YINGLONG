import type { Metadata } from "next";
import { Treasury } from "@/components/treasury/treasury";

export const metadata: Metadata = {
  title: "Treasury",
  description: "Lotus Lane's programmable treasury: lanes the agent runs alone, a 2-of-3 director queue, and the instruction ledger with anchors.",
};

export default function TreasuryPage() {
  return <Treasury />;
}
