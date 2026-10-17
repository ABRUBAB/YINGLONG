import type { Metadata } from "next";
import { Judge } from "@/components/judge/judge";

export const metadata: Metadata = {
  title: "3-minute demo",
  description: "One click at a time: your own AI agent gets rules locked on chain, pays a shop, is blocked when tricked, and even a raw transaction is refused by the blockchain. Real operations, real records.",
};

export default function JudgePage() {
  return (
    <main id="main">
      <Judge />
    </main>
  );
}
