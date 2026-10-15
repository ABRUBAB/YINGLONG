// The private mandate: a delegation whose spending rule (cap, payee allowlist, expiry) is hidden behind a
// Poseidon2 commitment and enforced by ZKMandateEnforcer with a zero-knowledge proof per payment.
import { concat, encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, toHex, type Address, type Hex } from "viem";
import { abi } from "@yinglong/sdk";
import type { Call } from "@yinglong/sdk/account";
import {
  PROFILE_IDS,
  SELECTORS,
  canonicalHash,
  delegationHash as hashDelegation,
  forbiddenTargets,
  rootDelegation,
  textHash,
  type Caveat,
  type Delegation,
} from "@yinglong/mandate";
import type { LedgerContext } from "../chain/ledger";
import { actAsPrincipal, delegationDigestOnChain, type Principal } from "../chain/principal";

export const PROOF_TYPE_MANDATE_COMPLIANCE = 1;

/** Minimal ABI of ZKMandateEnforcer (contracts/src/zk/ZKMandateEnforcer.sol). */
export const ZKMandateEnforcerAbi = [
  {
    type: "function",
    name: "runningCommitment",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "_delegationManager" },
      { type: "bytes32", name: "_delegationHash" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "nonceUsed",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "INITIAL_RUNNING_COMMITMENT", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

/** Minimal ABI of ZKVerifierRouter. */
export const ZKVerifierRouterAbi = [
  {
    type: "function",
    name: "verifierOf",
    stateMutability: "view",
    inputs: [{ type: "uint8", name: "proofType" }],
    outputs: [{ type: "address" }],
  },
] as const;

export function zkAddress(ctx: LedgerContext, name: "ZKMandateEnforcer" | "ZKVerifierRouter" | "HonkVerifier"): Address {
  const a = ctx.deployment.optional[name]?.address;
  if (!a) throw new Error(`${name} is not deployed on ${ctx.name} (run apps/agent/scripts/deploy-zk.ts)`);
  return a;
}

/**
 * The value block.chainid has inside this ledger's EVM. It is a public input of every proof, so it must be
 * the EVM's own value, not the RPC chain id. Read from the DelegationManager's EIP-712 domain hash.
 */
export async function evmChainId(ctx: LedgerContext): Promise<bigint> {
  const dm = ctx.addr("DelegationManager");
  const domain = await ctx.read<Hex>({ address: dm, abi: abi.DelegationManagerAbi, functionName: "getDomainHash" });
  const typeHash = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
  for (const id of [BigInt(ctx.profile.chainId), 0n, 1n]) {
    const h = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [typeHash, keccak256(toHex("DelegationManager")), keccak256(toHex("1")), id, dm],
      ),
    );
    if (h === domain) return id;
  }
  throw new Error("could not determine block.chainid from the DelegationManager domain");
}

/** The public half of a private mandate. It never contains the cap, the payees, the expiry or the salt. */
export interface PrivateMandateDoc {
  kind: "yinglong.private-mandate/v1";
  ledger: string;
  chainId: number;
  principal: { account: string; did: string };
  agent: { wallet: string; agentId: string };
  lineageId: string;
  asset: { symbol: string; address: string };
  methods: string[];
  jurisdiction: "hk";
  /** Public outer validity window; the hidden expiry inside the commitment is tighter. */
  validity: { from: number; until: number };
  zk: {
    proofType: number;
    circuit: string;
    vkHash: string;
    router: string;
    enforcer: string;
    commitment: string;
    statement: string;
  };
  nonce: string;
}

export const PRIVATE_STATEMENT =
  "Each payment proves in zero knowledge that the payee is in the hidden allowlist, the claimed time is not after the hidden expiry, and the running total stays within the hidden cap; the running total is carried as a hiding commitment.";

export interface CompiledPrivateMandate {
  doc: PrivateMandateDoc;
  mandateHash: Hex;
  lineageIdHash: Hex;
  caveats: Caveat[];
  caveatNames: string[];
  zkCaveatIndex: number;
  delegation: Delegation;
  delegationHash: Hex;
  publishParams: {
    mandateHash: Hex;
    agent: Address;
    lineageId: Hex;
    jurisdiction: number;
    validFrom: bigint;
    validUntil: bigint;
    salt: bigint;
    caveats: Caveat[];
  };
}

/**
 * Caveats, in this exact order: AllowedTargets [asset], AllowedMethods [transfer], ValueLte 0,
 * ForbiddenTargets (the compiler's list), GlobalPause, AgentLineage, MandateBinding,
 * ZKMandateEnforcer(router, commitment).
 */
export function compilePrivateMandate(ctx: LedgerContext, doc: PrivateMandateDoc, delegationSalt: bigint): CompiledPrivateMandate {
  const d = ctx.deployment;
  const mandateHash = canonicalHash(doc);
  const lineageIdHash = textHash(doc.lineageId);
  const asset = doc.asset.address as Address;
  const forbidden = forbiddenTargets(d);
  if (forbidden.some((f) => f.toLowerCase() === asset.toLowerCase())) throw new Error("asset is in the forbidden set");

  const named: [string, Address, Hex][] = [
    ["AllowedTargetsEnforcer", d.contracts.AllowedTargetsEnforcer.address, encodePacked(["address"], [asset])],
    ["AllowedMethodsEnforcer", d.contracts.AllowedMethodsEnforcer.address, SELECTORS.transfer as Hex],
    ["ValueLteEnforcer", d.contracts.ValueLteEnforcer.address, encodeAbiParameters([{ type: "uint256" }], [0n])],
    ["ForbiddenTargetsEnforcer", d.contracts.ForbiddenTargetsEnforcer.address, concat(forbidden.map((t) => encodePacked(["address"], [t])))],
    [
      "GlobalPauseEnforcer",
      d.contracts.GlobalPauseEnforcer.address,
      encodeAbiParameters([{ type: "address" }, { type: "address" }], [d.contracts.KillSwitchRegistry.address, d.contracts.YinglongPassportRegistry.address]),
    ],
    [
      "AgentLineageEnforcer",
      d.contracts.AgentLineageEnforcer.address,
      encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }, { type: "address" }],
        [d.contracts.YinglongPassportRegistry.address, textHash(doc.principal.did), "0x0000000000000000000000000000000000000000"],
      ),
    ],
    [
      "MandateBindingEnforcer",
      d.contracts.MandateBindingEnforcer.address,
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [d.contracts.MandateRegistry.address, mandateHash]),
    ],
    [
      "ZKMandateEnforcer",
      zkAddress(ctx, "ZKMandateEnforcer"),
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [zkAddress(ctx, "ZKVerifierRouter"), doc.zk.commitment as Hex]),
    ],
  ];
  const caveats: Caveat[] = named.map(([, enforcer, terms]) => ({ enforcer, terms, args: "0x" }));
  const delegation = rootDelegation(doc.principal.account as Address, doc.agent.wallet as Address, caveats, delegationSalt);
  return {
    doc,
    mandateHash,
    lineageIdHash,
    caveats,
    caveatNames: named.map(([n]) => n),
    zkCaveatIndex: named.length - 1,
    delegation,
    delegationHash: hashDelegation(delegation),
    publishParams: {
      mandateHash,
      agent: doc.agent.wallet as Address,
      lineageId: lineageIdHash,
      jurisdiction: PROFILE_IDS[doc.jurisdiction],
      validFrom: BigInt(doc.validity.from),
      validUntil: BigInt(doc.validity.until),
      salt: delegationSalt,
      caveats,
    },
  };
}

export interface SealedPrivateMandate {
  compiled: CompiledPrivateMandate;
  delegation: Delegation;
  publishTx: Hex;
  retiredMandate?: Hex;
  sealedBy: string;
}

/**
 * Publish the private mandate document hash and its caveat array in MandateRegistry from the principal's
 * own account (one self-bundled user operation, retiring the lineage's live mandate first), then sign the
 * delegation with the principal's passkey.
 */
export async function sealPrivateMandate(ctx: LedgerContext, p: Principal, compiled: CompiledPrivateMandate): Promise<SealedPrivateMandate> {
  const registry = ctx.addr("MandateRegistry");
  const live = await ctx.read<Hex>({ address: registry, abi: abi.MandateRegistryAbi, functionName: "liveMandateOfLineage", args: [p.account, compiled.lineageIdHash] });
  const zero = `0x${"0".repeat(64)}`;
  const calls: Call[] = [];
  if (live !== zero) {
    calls.push({ to: registry, data: encodeFunctionData({ abi: abi.MandateRegistryAbi, functionName: "revoke", args: [live] }) });
  }
  calls.push({ to: registry, data: encodeFunctionData({ abi: abi.MandateRegistryAbi, functionName: "publish", args: [compiled.publishParams] }) });
  const res = await actAsPrincipal(ctx, p, calls);
  if (!res.success) throw new Error(`publishing the private mandate failed in user operation ${res.txHash}`);
  const recorded = await ctx.read<Hex>({ address: registry, abi: abi.MandateRegistryAbi, functionName: "delegationOf", args: [compiled.mandateHash] });
  if (recorded.toLowerCase() !== compiled.delegationHash.toLowerCase()) {
    throw new Error(`registry recorded delegation ${recorded}, expected ${compiled.delegationHash}`);
  }
  const digest = await delegationDigestOnChain(ctx, compiled.delegationHash);
  const delegation: Delegation = { ...compiled.delegation, signature: await p.sign(digest) };
  return { compiled, delegation, publishTx: res.txHash, retiredMandate: live !== zero ? live : undefined, sealedBy: p.signerLabel };
}

/** The signed delegation with the ZK caveat's args (nonce, claimed time, new commitment, proof) filled in. */
export function withZkArgs(sealed: SealedPrivateMandate, enforcerArgs: Hex): Delegation {
  const caveats = sealed.delegation.caveats.map((c, i) => (i === sealed.compiled.zkCaveatIndex ? { ...c, args: enforcerArgs } : c));
  return { ...sealed.delegation, caveats };
}
