import { CertificateCard, shortHash } from "@yinglong/ui";
import type { Receipt } from "@/lib/api/view";
import { explorerTxUrl } from "@/lib/chain";
import { formatAmount, formatTime, LEDGER_LABEL, TIER_LABEL } from "@/lib/format";
import { Qr } from "@/components/qr";
import { outcomeRing, outcomeWord } from "./parts";

/** A receipt as a certificate (bank-statement grid, Hash Ring, explorer QR, honest footer). */
export function ReceiptCertificate({ r, className }: { r: Receipt; className?: string }) {
  const href = explorerTxUrl(r.ledger, r.txHash, r.explorerUrl);
  const labels = [
    r.ledgerBadge ?? (r.ledger === "anvil-bench" ? "Anvil bench (simulated)" : LEDGER_LABEL[r.ledger]),
    r.amount?.symbol === "CNY test units" ? "e-CNY-style simulator" : "Test units",
  ];
  return (
    <CertificateCard
      className={className}
      receiptId={r.receiptId}
      title={r.summary}
      delegationHash={r.delegationHash}
      outcome={outcomeRing(r.outcome)}
      outcomeLabel={outcomeWord(r.outcome)}
      outcomeError={r.revertError ?? undefined}
      explanation={r.explanation}
      aigcModel={r.aigc?.model}
      labels={labels}
      rows={[
        { label: "Time", value: formatTime(r.timestamp, { seconds: true }) + " HKT" },
        ...(r.amount ? [{ label: "Amount", value: formatAmount(r.amount), mono: true }] : []),
        ...(r.payeeName ? [{ label: "Payee", value: r.payeeName }] : []),
        { label: "Tier", value: `${r.tier === "ASK" ? "T?" : r.tier} · ${TIER_LABEL[r.tier]}` },
        { label: "Agent", value: `Passport ${r.agentId}`, mono: true },
        { label: "Mandate hash", value: shortHash(r.mandateHash, 10, 8), full: r.mandateHash, mono: true },
        { label: "Delegation hash", value: shortHash(r.delegationHash, 10, 8), full: r.delegationHash, mono: true },
        { label: "Intent hash", value: shortHash(r.intentHash, 10, 8), full: r.intentHash, mono: true },
        {
          label: "Transaction",
          value: r.txHash ? (
            href ? (
              <a href={href} target="_blank" rel="noreferrer noopener" className="text-steel underline decoration-line-3 underline-offset-2">
                {shortHash(r.txHash, 10, 8)}
                <span className="sr-only"> (opens the block explorer)</span>
              </a>
            ) : (
              shortHash(r.txHash, 10, 8)
            )
          ) : (
            "None (refused before signing)"
          ),
          full: r.txHash ?? undefined,
          mono: true,
        },
        { label: "Previous receipt", value: shortHash(r.prevReceiptHash, 10, 8), full: r.prevReceiptHash, mono: true },
        {
          label: "Anchor",
          value: r.anchor ? `root ${shortHash(r.anchor.root, 8, 6)} · Base ${r.anchor.baseTx ? "yes" : "no"} · FISCO ${r.anchor.fiscoTx ? "yes" : "no"}` : "Not anchored yet",
          full: r.anchor?.root,
          mono: Boolean(r.anchor),
        },
      ]}
      qr={href ? <Qr value={href} size={88} label={`QR code linking to the explorer page of transaction ${shortHash(r.txHash ?? "")}`} glyph={false} /> : undefined}
    />
  );
}
