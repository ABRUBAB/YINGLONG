import { decodeEventLog, decodeFunctionData, type Abi, type Hex } from "viem";
import { abi, nameByAddress, type LedgerName } from "@yinglong/sdk";
import { ledgerContext } from "./chain/ledger";
import { replayRevert } from "./chain/mandates";

/**
 * A minimal transaction explorer for ledgers without a public one (FISCO BCOS is a team-run consortium
 * ledger): receipt, decoded call, decoded YINGLONG and framework events, and the typed revert reason
 * recovered by replay. Read-only.
 */
const ALL_ABIS = Object.entries(abi).map(([name, a]) => ({ name: name.replace(/Abi$/, ""), abi: a as Abi }));

function decodeLog(log: { address: string; topics: Hex[]; data: Hex }) {
  for (const { name, abi: a } of ALL_ABIS) {
    try {
      const ev = decodeEventLog({ abi: a, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      return { contract: name, event: ev.eventName, args: ev.args };
    } catch {
      /* try next */
    }
  }
  return { contract: "unknown", event: log.topics[0] ?? "", args: {} };
}

export async function explainTx(ledger: LedgerName, hash: Hex) {
  const ctx = ledgerContext(ledger);
  const [tx, rcpt] = await Promise.all([ctx.pub.getTransaction({ hash }), ctx.pub.getTransactionReceipt({ hash })]);
  const names = nameByAddress(ctx.deployment);
  let call: { contract?: string; function: string; args?: unknown } = { function: tx.input.slice(0, 10) };
  for (const { name, abi: a } of ALL_ABIS) {
    try {
      const d = decodeFunctionData({ abi: a, data: tx.input });
      call = { contract: tx.to ? (names.get(tx.to.toLowerCase()) ?? name) : name, function: d.functionName, args: d.functionName === "redeemDelegations" ? "(permission contexts, modes, executions)" : d.args };
      break;
    } catch {
      /* try next */
    }
  }
  const revert = rcpt.status === "success" ? undefined : await replayRevert(ctx, hash);
  return {
    ledger,
    ledgerBadge: ctx.profile.badge,
    chainId: ctx.profile.chainId,
    hash,
    status: rcpt.status,
    blockNumber: rcpt.blockNumber,
    from: tx.from,
    to: tx.to,
    toName: tx.to ? names.get(tx.to.toLowerCase()) : undefined,
    gasUsed: rcpt.gasUsed,
    call,
    events: rcpt.logs.map((l) => ({ address: l.address, addressName: names.get(l.address.toLowerCase()), ...decodeLog(l as never) })),
    revert,
    note: ledger === "fisco" ? "FISCO BCOS: reverted transactions carry no revert data; the reason is recovered by replaying the call against the latest state." : undefined,
  };
}
