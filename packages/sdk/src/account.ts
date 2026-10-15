import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  keccak256,
  pad,
  sha256,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { sign as ecdsaSign } from "viem/accounts";
import { P256 } from "ox";
import { EntryPointAbi, HybridDeleGatorAbi, MultiSigDeleGatorAbi, SimpleFactoryAbi } from "./abi/index";
import { ERC1967_PROXY_CREATION_CODE } from "./bytecode";

export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export const SINGLE_DEFAULT_MODE = pad("0x00", { size: 32 }) as Hex; // CALLTYPE_SINGLE, EXECTYPE_DEFAULT
export const BATCH_DEFAULT_MODE = concat(["0x01", pad("0x00", { size: 31 })]) as Hex;

// ---------------------------------------------------------------- passkeys

/** Anything that can produce a HybridDeleGator-compatible P-256 signature over a 32-byte hash. */
export interface PasskeySigner {
  keyId: string;
  x: bigint;
  y: bigint;
  /** Returns the signature bytes the HybridDeleGator accepts (raw 96-byte or WebAuthn-encoded). */
  sign(hash: Hex): Promise<Hex>;
  /** "software" for scripted runs (a P-256 key in memory), "webauthn" for a real authenticator. */
  kind: "software" | "webauthn";
}

/**
 * A software P-256 key producing the framework's RAW P-256 format: keccak256(keyId) || r || s over
 * sha256(hash), low-s. Used for scripted evidence runs and labelled "scripted passkey (software P-256 key)";
 * the browser uses WebAuthn, which the same account also accepts.
 */
export function softwarePasskey(keyId: string, privateKey: Hex): PasskeySigner {
  const pub = P256.getPublicKey({ privateKey });
  return {
    keyId,
    x: pub.x,
    y: pub.y,
    kind: "software",
    async sign(hash: Hex) {
      const digest = sha256(hash);
      const sig = P256.sign({ payload: digest, privateKey });
      let s = sig.s;
      if (s > P256_N / 2n) s = P256_N - s;
      return concat([keccak256(stringToBytes(keyId)), pad(toHex(sig.r), { size: 32 }), pad(toHex(s), { size: 32 })]);
    },
  };
}

/** Deterministic test passkey from a seed string (testnet only). */
export function seededPasskey(keyId: string, seed: string): PasskeySigner {
  const k = BigInt(keccak256(stringToBytes(seed))) % (P256_N - 1n);
  return softwarePasskey(keyId, pad(toHex(k + 1n), { size: 32 }));
}

// ---------------------------------------------------------------- account deployment

export function hybridInitData(keyIds: string[], xs: bigint[], ys: bigint[], owner: Address = "0x0000000000000000000000000000000000000000"): Hex {
  return encodeFunctionData({ abi: HybridDeleGatorAbi, functionName: "initialize", args: [owner, keyIds, xs, ys] });
}

export function multisigInitData(signers: Address[], threshold: bigint): Hex {
  return encodeFunctionData({ abi: MultiSigDeleGatorAbi, functionName: "initialize", args: [signers, threshold] });
}

export function proxyCreationCode(implementation: Address, initData: Hex): Hex {
  return concat([ERC1967_PROXY_CREATION_CODE, encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [implementation, initData])]);
}

export function predictProxyAddress(factory: Address, creationCode: Hex, salt: Hex): Address {
  return getContractAddress({ from: factory, opcode: "CREATE2", bytecode: creationCode, salt });
}

/** Deploy (idempotently) an account proxy through the framework SimpleFactory. Anyone can pay for this. */
export async function ensureAccount(args: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  factory: Address;
  implementation: Address;
  initData: Hex;
  salt: Hex;
  gasPrice?: bigint;
}): Promise<{ address: Address; txHash?: Hex }> {
  const code = proxyCreationCode(args.implementation, args.initData);
  const address = predictProxyAddress(args.factory, code, args.salt);
  const existing = await args.publicClient.getCode({ address });
  if (existing && existing !== "0x") return { address };
  const txHash = await args.walletClient.writeContract({
    address: args.factory,
    abi: SimpleFactoryAbi,
    functionName: "deploy",
    args: [code, args.salt],
    chain: args.walletClient.chain ?? null,
    account: args.walletClient.account!,
    ...(args.gasPrice !== undefined ? { gasPrice: args.gasPrice, type: "legacy" as const } : {}),
  });
  const rcpt = await args.publicClient.waitForTransactionReceipt({ hash: txHash });
  if (rcpt.status !== "success") throw new Error(`account deployment reverted: ${txHash}`);
  return { address, txHash };
}

// ---------------------------------------------------------------- user operations (EntryPoint v0.7)

export interface Call {
  to: Address;
  value?: bigint;
  data: Hex;
}

/** Calldata for DeleGatorCore.execute(ModeCode, bytes) with one or many calls. */
export function executeCallData(calls: Call[]): Hex {
  if (calls.length === 1) {
    const c = calls[0]!;
    const exec = encodePacked(["address", "uint256", "bytes"], [c.to, c.value ?? 0n, c.data]);
    return encodeFunctionData({ abi: HybridDeleGatorAbi, functionName: "execute", args: [SINGLE_DEFAULT_MODE, exec] });
  }
  const exec = encodeAbiParameters(
    [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
    [calls.map((c) => ({ target: c.to, value: c.value ?? 0n, callData: c.data }))],
  );
  return encodeFunctionData({ abi: HybridDeleGatorAbi, functionName: "execute", args: [BATCH_DEFAULT_MODE, exec] });
}

export interface PackedUserOp {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

const packUint128 = (hi: bigint, lo: bigint) => concat([pad(toHex(hi), { size: 16 }), pad(toHex(lo), { size: 16 })]) as Hex;

export async function buildUserOp(args: {
  publicClient: PublicClient;
  account: Address;
  callData: Hex;
  verificationGas?: bigint;
  callGas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}): Promise<PackedUserOp> {
  const nonce = (await args.publicClient.readContract({ address: args.account, abi: HybridDeleGatorAbi, functionName: "getNonce" })) as bigint;
  let maxFee = args.maxFeePerGas;
  let maxPrio = args.maxPriorityFeePerGas;
  if (maxFee === undefined) {
    const gp = await args.publicClient.getGasPrice();
    maxFee = gp * 2n;
    maxPrio = gp;
  }
  return {
    sender: args.account,
    nonce,
    initCode: "0x",
    callData: args.callData,
    accountGasLimits: packUint128(args.verificationGas ?? 1_500_000n, args.callGas ?? 2_000_000n),
    preVerificationGas: 60_000n,
    gasFees: packUint128(maxPrio ?? 0n, maxFee),
    paymasterAndData: "0x",
    signature: "0x",
  };
}

/** The digest the account's owner signs: DeleGatorCore.getPackedUserOperationTypedDataHash(userOp). */
export async function userOpDigest(publicClient: PublicClient, op: PackedUserOp): Promise<Hex> {
  return (await publicClient.readContract({
    address: op.sender,
    abi: HybridDeleGatorAbi,
    functionName: "getPackedUserOperationTypedDataHash",
    args: [op],
  })) as Hex;
}

/** Sign with 2-of-3 (or n-of-m) director EOA keys, sorted by signer address as MultiSigDeleGator requires. */
export async function multisigSign(hash: Hex, privateKeys: Hex[]): Promise<Hex> {
  const { privateKeyToAddress } = await import("viem/accounts");
  const signed = await Promise.all(
    privateKeys.map(async (pk) => ({ addr: privateKeyToAddress(pk).toLowerCase(), sig: (await ecdsaSign({ hash, privateKey: pk, to: "hex" })) as Hex })),
  );
  signed.sort((a, b) => (a.addr < b.addr ? -1 : 1));
  return concat(signed.map((s) => s.sig));
}

/**
 * Self-bundled submission: our relayer calls EntryPoint.handleOps directly (no third-party bundler). The
 * account pays its own prefund from its EntryPoint deposit or balance (0 on FISCO, where gas price is 0).
 */
export async function submitUserOp(args: {
  publicClient: PublicClient;
  relayer: WalletClient;
  entryPoint: Address;
  op: PackedUserOp;
  gasPrice?: bigint;
}): Promise<{ txHash: Hex; success: boolean }> {
  const txHash = await args.relayer.writeContract({
    address: args.entryPoint,
    abi: EntryPointAbi,
    functionName: "handleOps",
    args: [[args.op], args.relayer.account!.address],
    chain: args.relayer.chain ?? null,
    account: args.relayer.account!,
    gas: 6_000_000n,
    ...(args.gasPrice !== undefined ? { gasPrice: args.gasPrice, type: "legacy" as const } : {}),
  });
  const rcpt = await args.publicClient.waitForTransactionReceipt({ hash: txHash });
  // handleOps succeeds even if the inner call reverted; check the UserOperationEvent success flag.
  const evt = rcpt.logs.find((l) => l.topics[0] === "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f");
  const success = rcpt.status === "success" && !!evt && BigInt(`0x${evt.data.slice(2 + 64, 2 + 128)}`) === 1n;
  return { txHash, success };
}
