import { concat, decodeAbiParameters, decodeFunctionData, encodeFunctionData, keccak256, pad, toHex, type Address, type Hex, type PublicClient } from "viem";
import { sign } from "viem/accounts";
import { abi, type Deployment } from "@yinglong/sdk";
import { delegationHash, encodePermissionContext, type Delegation } from "@yinglong/mandate";

/**
 * Per-execution child delegation (plan 8.2 "Sign"). The user's root delegation cannot change per execution,
 * so the signer narrows it: for every redemption it signs, with the agent key, a child delegation
 * agent -> agent whose caveats are Timestamp(now - 1, now + 120 s) and LimitedCalls(1). The chain becomes
 * [child, root]: the execution is valid on-chain only inside a two-minute window and only once, even if the
 * signed transaction leaks or is replayed. All root caveats still apply unchanged.
 */
const DELEGATION_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "tuple[]", components: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }, { name: "args", type: "bytes" }] },
    { name: "salt", type: "uint256" },
    { name: "signature", type: "bytes" },
  ],
} as const;

export const CHILD_WINDOW_SECONDS = 120n;

export async function wrapWithChild(args: {
  calldata: Hex;
  deployment: Deployment;
  agent: Address;
  agentKey: Hex;
  pub: PublicClient;
  timeUnit: "s" | "ms";
}): Promise<{ calldata: Hex; children: Hex[] }> {
  const d = decodeFunctionData({ abi: abi.DelegationManagerAbi, data: args.calldata });
  if (d.functionName !== "redeemDelegations") throw new Error("not a redemption");
  const [contexts, modes, executions] = d.args as readonly [readonly Hex[], readonly Hex[], readonly Hex[]];
  const block = await args.pub.getBlock();
  const unit = args.timeUnit === "ms" ? 1000n : 1n;
  const after = block.timestamp - 1n * unit;
  const before = block.timestamp + CHILD_WINDOW_SECONDS * unit;
  const timestampTerms = concat([pad(toHex(after), { size: 16 }), pad(toHex(before), { size: 16 })]);
  const limitedTerms = pad(toHex(1n), { size: 32 });
  const domainHash = (await args.pub.readContract({
    address: args.deployment.contracts.DelegationManager.address,
    abi: abi.DelegationManagerAbi,
    functionName: "getDomainHash",
  })) as Hex;

  const children: Hex[] = [];
  const newContexts: Hex[] = [];
  for (const ctx of contexts) {
    const [chain] = decodeAbiParameters([DELEGATION_TUPLE], ctx);
    const parent = chain[0]!;
    const child: Delegation = {
      delegate: args.agent,
      delegator: args.agent,
      authority: delegationHash({ ...parent, caveats: [...parent.caveats] }),
      caveats: [
        { enforcer: args.deployment.contracts.TimestampEnforcer.address, terms: timestampTerms, args: "0x" },
        { enforcer: args.deployment.contracts.LimitedCallsEnforcer.address, terms: limitedTerms, args: "0x" },
      ],
      salt: BigInt(keccak256(toHex(`${Date.now()}:${Math.random()}`))),
      signature: "0x",
    };
    const childHash = delegationHash(child);
    const digest = keccak256(concat(["0x1901", domainHash, childHash]));
    child.signature = (await sign({ hash: digest, privateKey: args.agentKey, to: "hex" })) as Hex;
    children.push(childHash);
    newContexts.push(encodePermissionContext([child, ...chain.map((x) => ({ ...x, caveats: [...x.caveats] }))]));
  }
  const calldata = encodeFunctionData({ abi: abi.DelegationManagerAbi, functionName: "redeemDelegations", args: [newContexts, [...modes], [...executions]] });
  return { calldata, children };
}
