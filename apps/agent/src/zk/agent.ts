// The agent wallet that redeems the private mandate.
//
// AgentLineageEnforcer requires the redeemer's passport to be bound to the principal's DID. The shared demo
// wallets (agent-ying, guest-arena) already hold passports bound to other principals on the live ledgers,
// so when neither is free the private-mandate beat uses a dedicated wallet of agent Ying, derived at runtime
// from Ying's testnet key (never written anywhere), with its own passport bound to the private-mandate
// principal. The passport is registered by the same `agent-owner` controller as every other passport.
import {
  concat,
  createWalletClient,
  http,
  keccak256,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { abi } from "@yinglong/sdk";
import { rolePrivateKey, type Role } from "@yinglong/sdk/server";
import { textHash } from "@yinglong/mandate";
import type { LedgerContext } from "../chain/ledger";
import { ensurePassport } from "../chain/passport";

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const STATUS_ACTIVE = 1;

export interface ZkAgent {
  /** Role name, or "derived:agent-ying/zk" for the dedicated wallet. */
  label: string;
  address: Address;
  wallet: WalletClient;
  agentId: bigint;
  registerTx?: Hex;
  attestTxs: Hex[];
  note?: string;
}

function derivedKey(): Hex {
  const k = BigInt(keccak256(concat([rolePrivateKey("agent-ying"), toHex(stringToBytes("yinglong:zk:agent-wallet:v1"))]))) % (SECP256K1_N - 1n);
  return toHex(k + 1n, { size: 32 });
}

async function walletInfo(ctx: LedgerContext, wallet: Address): Promise<[bigint, number, Hex]> {
  return ctx.read<[bigint, number, Hex]>({
    address: ctx.addr("YinglongPassportRegistry"),
    abi: abi.YinglongPassportRegistryAbi,
    functionName: "walletInfo",
    args: [wallet],
  });
}

/** Register (if needed) and attest a passport for an arbitrary wallet key, controlled by `agent-owner`. */
async function ensurePassportForKey(
  ctx: LedgerContext,
  privateKey: Hex,
  ownerDid: string,
  identityCode: string,
  kid: string,
  issuers: { role: Role; claim: string }[],
): Promise<{ agentId: bigint; registerTx?: Hex; attestTxs: Hex[] }> {
  const registry = ctx.addr("YinglongPassportRegistry");
  const wallet = privateKeyToAccount(privateKey).address;
  let [agentId] = await walletInfo(ctx, wallet);
  let registerTx: Hex | undefined;
  if (agentId === 0n) {
    await ctx.ensureGas(ctx.roleAddress("agent-owner"), 3_000_000_000_000_000n);
    const next = await ctx.read<bigint>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "nextAgentId" });
    const now = BigInt(Math.floor(Date.now() / 1000));
    const deadline = ctx.profile.timeUnit === "ms" ? (now + 3600n) * 1000n : now + 3600n;
    const digest = await ctx.read<Hex>({
      address: registry,
      abi: abi.YinglongPassportRegistryAbi,
      functionName: "bindWalletDigest",
      args: [next, ctx.roleAddress("agent-owner"), wallet, deadline],
    });
    const walletSig = (await sign({ hash: digest, privateKey, to: "hex" })) as Hex;
    const res = await ctx.write("agent-owner", {
      address: registry,
      abi: abi.YinglongPassportRegistryAbi as never,
      functionName: "register",
      args: [
        {
          agentWallet: wallet,
          ownerDidHash: textHash(ownerDid),
          passportVcHash: keccak256(stringToBytes(`passport-vc:${identityCode}:${kid}`)),
          provenanceHash: keccak256(stringToBytes("provenance:yinglong-agent:v1")),
          enforcerTableHash: keccak256(stringToBytes(JSON.stringify(ctx.deployment.contracts))),
          jwksHash: keccak256(stringToBytes(`jwks:${kid}`)),
          erc8004AgentId: 0n,
          identityCode,
          kid,
          registrationURI: "https://api.yinglong-agent.tech/agents/agent-ying-zk.json",
          deadline,
          walletSig,
        },
      ],
    });
    registerTx = res.hash;
    // Wait until a load-balanced public RPC shows the new passport.
    for (let i = 0; i < 30; i++) {
      [agentId] = await walletInfo(ctx, wallet);
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
  return { agentId, registerTx, attestTxs };
}

/**
 * The agent for the private mandate: agent-ying if its passport is free or already bound to `ownerDid`,
 * else guest-arena under the same rule, else Ying's dedicated private-mandate wallet.
 */
export async function ensureZkAgent(
  ctx: LedgerContext,
  ownerDid: string,
  identityCode: string,
  issuers: { role: Role; claim: string }[],
): Promise<ZkAgent> {
  const notes: string[] = [];
  for (const role of ["agent-ying", "guest-arena"] as const) {
    const [agentId, status, didHash] = await walletInfo(ctx, ctx.roleAddress(role));
    if (agentId === 0n || (didHash === textHash(ownerDid) && status === STATUS_ACTIVE)) {
      const p = await ensurePassport(ctx, role, ownerDid, identityCode, issuers);
      return { label: role, address: p.wallet, wallet: ctx.wallet(role), agentId: p.agentId, registerTx: p.registerTx, attestTxs: p.attestTxs, note: notes.join(" ") || undefined };
    }
    notes.push(`${role} already holds passport #${agentId} bound to another principal on ${ctx.name}.`);
  }
  const key = derivedKey();
  const account = privateKeyToAccount(key);
  const [existing, status, didHash] = await walletInfo(ctx, account.address);
  if (existing !== 0n && (didHash !== textHash(ownerDid) || status !== STATUS_ACTIVE)) {
    throw new Error(`the dedicated private-mandate wallet ${account.address} is bound to another principal or inactive`);
  }
  await ctx.ensureGas(account.address, 50_000_000_000_000_000n);
  const p = await ensurePassportForKey(ctx, key, ownerDid, identityCode, "agent-ying-zk-card-1", issuers);
  notes.push("Using agent Ying's dedicated private-mandate wallet (derived at runtime from Ying's testnet key, never stored) with its own passport bound to this principal.");
  const wallet = createWalletClient({ account, chain: ctx.chain, transport: http(ctx.profile.rpcUrl) });
  return { label: "agent-ying (private-mandate wallet)", address: account.address, wallet, agentId: p.agentId, registerTx: p.registerTx, attestTxs: p.attestTxs, note: notes.join(" ") };
}
