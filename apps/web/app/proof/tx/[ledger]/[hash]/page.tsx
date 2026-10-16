import type { Metadata } from "next";
import { TxLookup } from "@/components/proof/tx-lookup";

export const metadata: Metadata = {
  title: "Transaction",
  description: "Read-only view of a transaction on the FISCO BCOS consortium ledger or the Anvil bench, with its accountability receipt.",
};

export default async function TxPage({ params }: { params: Promise<{ ledger: string; hash: string }> }) {
  const { ledger, hash } = await params;
  return (
    <>
      <main id="main">
        <TxLookup ledger={ledger} hash={hash} />
      </main>
    </>
  );
}
