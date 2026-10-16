import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/site-header";
import { ProofDocument } from "@/components/proof/proof";

export const metadata: Metadata = {
  title: "Proof",
  description: "Transactions on both ledgers, generated numbers with sources, identical bytecode, a receipt as a certificate, and the one-command verifier.",
};

export default function ProofPage() {
  return (
    <>
      <SiteHeader obsidian={false} className="no-print" />
      <main id="main">
        <ProofDocument />
      </main>
    </>
  );
}
