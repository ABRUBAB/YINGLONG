import { encodeFunctionData, encodePacked, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi, decodeRevert, revertDataOf, type DecodedRevert } from "@yinglong/sdk";
import { SINGLE_DEFAULT_MODE, type Call } from "@yinglong/sdk/account";
import { CATEGORY_IDS, compileMandate, encodePermissionContext, type CompiledMandate, type Delegation, type Mandate } from "@yinglong/mandate";
import type { LedgerContext } from "./ledger";
import { actAsPrincipal, delegationDigestOnChain, type Principal } from "./principal";

export interface SealedMandate {
  compiled: CompiledMandate;
  /** The root delegation with the principal's signature. */
  delegation: Delegation;
  publishTx: Hex;
  sealedBy: string;
}

/** Calls that write the principal's payee book (T3: only the account itself can do this). */
export function payeeBookCalls(ctx: LedgerContext, m: Mandate): Call[] {
  if (m.payees.length === 0) return [];
  return [
    {
      to: ctx.addr("PayeeBook"),
      data: encodeFunctionData({
        abi: abi.PayeeBookAbi,
        functionName: "setPayees",
        args: [
          m.payees.map((p) => p.address as Address),
          m.payees.map((p) => CATEGORY_IDS[p.category as keyof typeof CATEGORY_IDS]),
          m.payees.map((p) => keccak256(stringToBytes(p.label))),
        ],
      }),
    },
  ];
}

export function guardianCalls(ctx: LedgerContext, guardians: Address[]): Call[] {
  return guardians.map((g) => ({
    to: ctx.addr("KillSwitchRegistry"),
    data: encodeFunctionData({ abi: abi.KillSwitchRegistryAbi, functionName: "setGuardian", args: [g, true] }),
  }));
}

/**
 * Seal: compile the mandate, publish it (with its full caveat array) from the principal's account in one
 * user operation together with the payee book, then sign the delegation with the principal's key.
 * If `supersede` is given, the old mandate is superseded and its delegation disabled in the same operation.
 */
export async function sealMandate(
  ctx: LedgerContext,
  p: Principal,
  m: Mandate,
  opts: { extraCalls?: Call[]; supersede?: { mandateHash: Hex; delegation: Delegation } } = {},
): Promise<SealedMandate> {
  const compiled = compileMandate(m, ctx.deployment);
  // At most one live mandate per lineage: retire the current one in the same user operation.
  const live = await ctx.read<Hex>({
    address: ctx.addr("MandateRegistry"),
    abi: abi.MandateRegistryAbi,
    functionName: "liveMandateOfLineage",
    args: [p.account, compiled.lineageIdHash],
  });
  const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const retire: Call[] = [];
  if (live !== zero && !opts.supersede) {
    // Revoking the mandate kills its delegation at once (MandateBindingEnforcer requires a live mandate).
    retire.push({ to: ctx.addr("MandateRegistry"), data: encodeFunctionData({ abi: abi.MandateRegistryAbi, functionName: "revoke", args: [live] }) });
  }
  const publish = opts.supersede
    ? encodeFunctionData({ abi: abi.MandateRegistryAbi, functionName: "supersede", args: [opts.supersede.mandateHash, compiled.publishParams] })
    : encodeFunctionData({ abi: abi.MandateRegistryAbi, functionName: "publish", args: [compiled.publishParams] });
  const calls: Call[] = [...payeeBookCalls(ctx, m), ...(opts.extraCalls ?? []), ...retire, { to: ctx.addr("MandateRegistry"), data: publish }];
  if (opts.supersede) {
    calls.push({
      to: ctx.addr("DelegationManager"),
      data: encodeFunctionData({
        abi: abi.DelegationManagerAbi,
        functionName: "disableDelegation",
        args: [{ ...opts.supersede.delegation, authority: opts.supersede.delegation.authority }],
      }),
    });
  }
  const res = await actAsPrincipal(ctx, p, calls);
  if (!res.success) throw new Error(`publishing the mandate failed in user operation ${res.txHash}`);
  const digest = await delegationDigestOnChain(ctx, compiled.delegationHash);
  const delegation: Delegation = { ...compiled.delegation, signature: await p.sign(digest) };
  return { compiled, delegation, publishTx: res.txHash, sealedBy: p.signerLabel };
}

export function singleExecution(call: Call): Hex {
  return encodePacked(["address", "uint256", "bytes"], [call.to, call.value ?? 0n, call.data]);
}

export function redeemCallData(chain: Delegation[], execution: Hex): Hex {
  return encodeFunctionData({
    abi: abi.DelegationManagerAbi,
    functionName: "redeemDelegations",
    args: [[encodePermissionContext(chain)], [SINGLE_DEFAULT_MODE], [execution]],
  });
}

export interface SimulationResult {
  ok: boolean;
  revert?: DecodedRevert;
  blockNumber: bigint;
}

/** Simulate a redemption from the agent's address at the latest block (eth_call). */
export async function simulateRedemption(ctx: LedgerContext, agent: Address, calldata: Hex): Promise<SimulationResult> {
  const blockNumber = await ctx.pub.getBlockNumber();
  try {
    await ctx.pub.call({ account: agent, to: ctx.addr("DelegationManager"), data: calldata, blockNumber });
    return { ok: true, blockNumber };
  } catch (e) {
    return { ok: false, revert: decodeRevert(revertDataOf(e)), blockNumber };
  }
}

/** Replay a mined transaction with eth_call at its parent block to recover the typed revert reason. */
export async function replayRevert(ctx: LedgerContext, txHash: Hex): Promise<DecodedRevert | undefined> {
  const tx = await ctx.pub.getTransaction({ hash: txHash });
  try {
    await ctx.pub.call({ account: tx.from, to: tx.to!, data: tx.input, blockNumber: (tx.blockNumber ?? 1n) - 1n });
    return undefined;
  } catch (e) {
    return decodeRevert(revertDataOf(e));
  }
}
