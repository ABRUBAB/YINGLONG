import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi } from "@yinglong/sdk";
import { agentAddress, agentPrivateKey, type AgentKeyRef, type Role } from "@yinglong/sdk/server";
import { sign } from "viem/accounts";
import type { LedgerContext } from "./ledger";

export interface PassportInfo {
  agentId: bigint;
  wallet: Address;
  registerTx?: Hex;
  attestTxs: Hex[];
}

/**
 * Make sure the agent wallet `walletRole` has an active passport bound to `ownerDid`, controlled by the
 * dedicated `agent-owner` key (held apart from the user's account, so no delegation can rotate the wallet),
 * and attested by the given issuers. Idempotent.
 */
export async function ensurePassport(
  ctx: LedgerContext,
  walletRole: AgentKeyRef,
  ownerDid: string,
  identityCode: string,
  issuers: { role: Role; claim: string }[],
): Promise<PassportInfo> {
  const registry = ctx.addr("YinglongPassportRegistry");
  const wallet = agentAddress(walletRole);
  let agentId = await ctx.read<bigint>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "agentIdOf", args: [wallet] });
  let registerTx: Hex | undefined;
  if (agentId === 0n) {
    await ctx.ensureGas(ctx.roleAddress("agent-owner"), 3_000_000_000_000_000n);
    const next = await ctx.read<bigint>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "nextAgentId" });
    // The registry checks the deadline against block time, which can run ahead of the wall clock (local bench time jumps).
    const head = await ctx.pub.getBlock();
    const chainNow = ctx.profile.timeUnit === "ms" ? head.timestamp / 1000n : head.timestamp;
    const wallNow = BigInt(Math.floor(Date.now() / 1000));
    const now = chainNow > wallNow ? chainNow : wallNow;
    const deadline = ctx.profile.timeUnit === "ms" ? (now + 3600n) * 1000n : now + 3600n;
    const digest = await ctx.read<Hex>({
      address: registry,
      abi: abi.YinglongPassportRegistryAbi,
      functionName: "bindWalletDigest",
      args: [next, ctx.roleAddress("agent-owner"), wallet, deadline],
    });
    const walletSig = (await sign({ hash: digest, privateKey: agentPrivateKey(walletRole), to: "hex" })) as Hex;
    const res = await ctx.write("agent-owner", {
      address: registry,
      abi: abi.YinglongPassportRegistryAbi as never,
      functionName: "register",
      args: [
        {
          agentWallet: wallet,
          ownerDidHash: keccak256(stringToBytes(ownerDid)),
          passportVcHash: keccak256(stringToBytes(`passport-vc:${identityCode}`)),
          provenanceHash: keccak256(stringToBytes("provenance:yinglong-agent:v1")),
          enforcerTableHash: keccak256(stringToBytes(JSON.stringify(ctx.deployment.contracts))),
          jwksHash: keccak256(stringToBytes(`jwks:${walletRole}`)),
          erc8004AgentId: 0n,
          identityCode,
          kid: `${walletRole}-card-1`,
          registrationURI: `https://api.yinglong-agent.tech/agents/${walletRole.replace(":", "-")}.json`,
          deadline,
          walletSig,
        },
      ],
    });
    registerTx = res.hash;
    // Public RPCs behind a load balancer can answer from a node one block behind: wait until the passport is visible.
    for (let i = 0; i < 30; i++) {
      agentId = await ctx.read<bigint>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "agentIdOf", args: [wallet] });
      if (agentId !== 0n) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const attestTxs: Hex[] = [];
  for (const i of issuers) {
    const issuer = ctx.roleAddress(i.role);
    const ok = await ctx.read<boolean>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "isAttestedBy", args: [agentId, issuer] });
    if (ok) continue;
    await ctx.ensureGas(issuer, 3_000_000_000_000_000n);
    const res = await ctx.write(i.role, {
      address: registry,
      abi: abi.YinglongPassportRegistryAbi as never,
      functionName: "attest",
      args: [agentId, keccak256(stringToBytes(i.claim)), 0n],
    });
    attestTxs.push(res.hash);
  }
  return { agentId, wallet, registerTx, attestTxs };
}
