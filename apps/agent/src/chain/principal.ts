import { concat, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi } from "@yinglong/sdk";
import {
  buildUserOp,
  ensureAccount,
  executeCallData,
  hybridInitData,
  multisigInitData,
  multisigSign,
  submitUserOp,
  userOpDigest,
  type Call,
  type PackedUserOp,
  type PasskeySigner,
} from "@yinglong/sdk/account";
import type { LedgerContext } from "./ledger";

/**
 * A principal is the person or company the agent acts for, holding a smart account:
 *  - a person: HybridDeleGator with owner = address(0) and passkeys only (no seed phrase, no EOA owner);
 *  - a company: MultiSigDeleGator whose signers are its directors (2-of-3).
 * Principals act on-chain only through user operations signed by their own keys and submitted by our
 * relayer straight to the EntryPoint ("self-bundled").
 */
export interface Principal {
  kind: "person" | "company";
  name: string;
  account: Address;
  did: string;
  /** Sign a 32-byte digest as the account (ERC-1271 format for this account type). */
  sign(digest: Hex): Promise<Hex>;
  signerLabel: string;
}

export async function personPrincipal(ctx: LedgerContext, name: string, passkey: PasskeySigner, saltLabel: string): Promise<Principal> {
  const initData = hybridInitData([passkey.keyId], [passkey.x], [passkey.y]);
  const { address } = await ensureAccount({
    publicClient: ctx.pub,
    walletClient: ctx.wallet("relayer"),
    factory: ctx.addr("SimpleFactory"),
    implementation: ctx.addr("HybridDeleGatorImpl"),
    initData,
    salt: keccak256(stringToBytes(saltLabel)),
    ...ctx.txOpts(),
  });
  return {
    kind: "person",
    name,
    account: address,
    did: `did:pkh:eip155:${ctx.profile.chainId}:${address.toLowerCase()}`,
    sign: (digest) => passkey.sign(digest),
    signerLabel: passkey.kind === "software" ? "scripted passkey (software P-256 key)" : "passkey (WebAuthn)",
  };
}

export async function companyPrincipal(
  ctx: LedgerContext,
  name: string,
  directors: { address: Address; privateKey: Hex }[],
  threshold: number,
  saltLabel: string,
  approvingDirectors?: number[],
): Promise<Principal> {
  const initData = multisigInitData(
    directors.map((x) => x.address),
    BigInt(threshold),
  );
  const { address } = await ensureAccount({
    publicClient: ctx.pub,
    walletClient: ctx.wallet("relayer"),
    factory: ctx.addr("SimpleFactory"),
    implementation: ctx.addr("MultiSigDeleGatorImpl"),
    initData,
    salt: keccak256(stringToBytes(saltLabel)),
    ...ctx.txOpts(),
  });
  const signers = (approvingDirectors ?? directors.map((_, i) => i).slice(0, threshold)).map((i) => directors[i]!.privateKey);
  return {
    kind: "company",
    name,
    account: address,
    did: `did:pkh:eip155:${ctx.profile.chainId}:${address.toLowerCase()}`,
    sign: (digest) => multisigSign(digest, signers),
    signerLabel: `${threshold}-of-${directors.length} directors`,
  };
}

/** Run calls from the principal's own account via a self-bundled user operation. */
export async function actAsPrincipal(ctx: LedgerContext, p: Principal, calls: Call[]): Promise<{ txHash: Hex; success: boolean }> {
  await ctx.ensureGas(p.account, 5_000_000_000_000_000n);
  const op = await buildUserOp({
    publicClient: ctx.pub,
    account: p.account,
    callData: executeCallData(calls),
    ...(ctx.profile.legacyTx ? { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } : {}),
  });
  op.signature = await p.sign(await userOpDigest(ctx.pub, op));
  return submitUserOp({ publicClient: ctx.pub, relayer: ctx.wallet("relayer"), entryPoint: ctx.addr("EntryPoint"), op, ...ctx.txOpts() });
}

/** EIP-712 digest of a delegation under the deployed DelegationManager's own domain (read from chain). */
export async function delegationDigestOnChain(ctx: LedgerContext, delegationHash: Hex): Promise<Hex> {
  const domain = await ctx.read<Hex>({ address: ctx.addr("DelegationManager"), abi: abi.DelegationManagerAbi, functionName: "getDomainHash" });
  return keccak256(concat(["0x1901", domain, delegationHash]));
}

/** EIP-712 typed data of a user operation under the account's own DeleGatorCore domain (what the passkey signs). */
export function userOpTypedData(ctx: LedgerContext, op: PackedUserOp, accountKind: "person" | "company") {
  return {
    domain: { name: accountKind === "company" ? "MultiSigDeleGator" : "HybridDeleGator", version: "1", chainId: ctx.profile.chainId, verifyingContract: op.sender },
    types: {
      PackedUserOperation: [
        { name: "sender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "initCode", type: "bytes" },
        { name: "callData", type: "bytes" },
        { name: "accountGasLimits", type: "bytes32" },
        { name: "preVerificationGas", type: "uint256" },
        { name: "gasFees", type: "bytes32" },
        { name: "paymasterAndData", type: "bytes" },
        { name: "entryPoint", type: "address" },
      ],
    },
    primaryType: "PackedUserOperation",
    message: {
      sender: op.sender,
      nonce: op.nonce.toString(),
      initCode: op.initCode,
      callData: op.callData,
      accountGasLimits: op.accountGasLimits,
      preVerificationGas: op.preVerificationGas.toString(),
      gasFees: op.gasFees,
      paymasterAndData: op.paymasterAndData,
      entryPoint: ctx.addr("EntryPoint"),
    },
  };
}
