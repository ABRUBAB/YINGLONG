import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { concat, encodeFunctionData, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { sign } from "viem/accounts";
import { abi } from "@yinglong/sdk";
import { buildUserOp, executeCallData, submitUserOp, userOpDigest, type PackedUserOp } from "@yinglong/sdk/account";
import { rolePrivateKey, type Role } from "@yinglong/sdk/server";
import { formatUnits, type Mandate } from "@yinglong/mandate";
import { ledgerContext } from "./chain/ledger";
import { recordReceipt } from "./receipts";
import { DATA_DIR, DocStore } from "./store";
import { stateOf, type PrincipalId } from "./world";

/**
 * Board proposals (T3 for a company): anything outside the treasurer agent's lanes, e.g. an equipment
 * purchase above the T2 ceiling, is executed by the company's own MultiSigDeleGator account only when a
 * threshold of directors (2 of 3) sign the same user operation. The agent can propose; it can never sign.
 */
export interface BoardProposal {
  id: string;
  principal: PrincipalId;
  ledger: string;
  title: string;
  payee: { id: string; label: string; address: Address };
  amount: string;
  decimals: number;
  symbol: string;
  op: PackedUserOp;
  digest: Hex;
  threshold: number;
  signatures: { director: Role; address: Address; signature: Hex; signedAt: string }[];
  status: "collecting" | "executed" | "failed";
  txHash?: Hex;
  createdAt: string;
}

export const board = new DocStore<{ proposals: Record<string, BoardProposal> }>(resolve(DATA_DIR, "board.json"), { proposals: {} });

export async function createBoardProposal(id: PrincipalId, args: { payeeId: string; amount: bigint; title: string; kind?: "payment" | "resume" }): Promise<BoardProposal> {
  const st = stateOf(id);
  const ctx = ledgerContext(st.ledger);
  const m = st.mandate as Mandate;
  const resume = args.kind === "resume";
  const payee = resume ? { id: "kill_switch", label: "Resume the treasurer agent (untrip)", address: ctx.addr("KillSwitchRegistry") as string, category: "other" } : m.payees.find((p) => p.id === args.payeeId);
  if (!payee) throw new Error("unknown payee");
  const asset = m.assets[0]!;
  const now = (await ctx.pub.getBlock()).timestamp;
  const target = resume ? ctx.addr("KillSwitchRegistry") : (asset.address as Address);
  const data = resume
    ? encodeFunctionData({ abi: abi.KillSwitchRegistryAbi, functionName: "untrip", args: [] })
    : asset.address.toLowerCase() === ctx.addr("ConditionalPaymentInstructions").toLowerCase()
      ? encodeFunctionData({
          abi: abi.ConditionalPaymentInstructionsAbi,
          functionName: "instruct",
          args: [payee.address as Address, args.amount, keccak256(stringToBytes(`board:${args.title}`)), keccak256(stringToBytes("condition:board-resolution")), now + 7n * 86400n],
        })
      : encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transfer", args: [payee.address as Address, args.amount] });
  const op = await buildUserOp({
    publicClient: ctx.pub,
    account: st.account,
    callData: executeCallData([{ to: target, data }]),
    ...(ctx.profile.legacyTx ? { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } : {}),
  });
  const digest = await userOpDigest(ctx.pub, op);
  const bp: BoardProposal = {
    id: randomUUID(),
    principal: id,
    ledger: st.ledger,
    title: args.title,
    payee: { id: payee.id, label: payee.label, address: payee.address as Address },
    amount: args.amount.toString(),
    decimals: asset.decimals,
    symbol: asset.symbol,
    op,
    digest,
    threshold: 2,
    signatures: [],
    status: "collecting",
    createdAt: new Date().toISOString(),
  };
  board.update((d) => {
    d.proposals[bp.id] = bp;
  });
  return bp;
}

/** A director signs (demo: with the director's testnet key). Executes once the threshold is reached. */
export async function directorSign(proposalId: string, director: "director-1" | "director-2" | "director-3"): Promise<BoardProposal> {
  const bp = board.get().proposals[proposalId];
  if (!bp) throw new Error("unknown board proposal");
  if (bp.status !== "collecting") throw new Error(`proposal is ${bp.status}`);
  const ctx = ledgerContext(bp.ledger as never);
  if (!bp.signatures.some((s) => s.director === director)) {
    const signature = (await sign({ hash: bp.digest, privateKey: rolePrivateKey(director), to: "hex" })) as Hex;
    board.update((d) => {
      d.proposals[proposalId]!.signatures.push({ director, address: ctx.roleAddress(director), signature, signedAt: new Date().toISOString() });
    });
  }
  const cur = board.get().proposals[proposalId]!;
  if (cur.signatures.length < cur.threshold) return cur;
  const sorted = [...cur.signatures].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1)).slice(0, cur.threshold);
  const op = { ...cur.op, signature: concat(sorted.map((s) => s.signature)) };
  const res = await submitUserOp({ publicClient: ctx.pub, relayer: ctx.wallet("relayer"), entryPoint: ctx.addr("EntryPoint"), op, ...ctx.txOpts() });
  const st = stateOf(cur.principal);
  recordReceipt({
    principal: cur.principal,
    ledger: cur.ledger as never,
    agentId: st.agentId,
    mandateHash: st.mandateHash!,
    delegationHash: st.delegationHash!,
    tier: "T3",
    outcome: res.success ? "confirmed" : "reverted",
    txHash: res.txHash,
    documents: { plan: { boardProposal: cur.id, title: cur.title, signers: sorted.map((s) => s.director) } },
    explanation: { text: `Board resolution executed by ${cur.threshold} of 3 directors: ${formatUnits(BigInt(cur.amount), cur.decimals)} ${cur.symbol} to ${cur.payee.label} (${cur.title}).`, aiGenerated: false },
    aigc: { model: "none (director signatures)", provider: "local" },
    payment: { symbol: cur.symbol, decimals: cur.decimals, amount: cur.amount, payeeLabel: cur.payee.label, payee: cur.payee.address, method: "userOperation" },
  });
  board.update((d) => {
    const x = d.proposals[proposalId]!;
    x.status = res.success ? "executed" : "failed";
    x.txHash = res.txHash;
  });
  return board.get().proposals[proposalId]!;
}
