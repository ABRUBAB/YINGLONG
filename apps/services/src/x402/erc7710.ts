// ERC-7710 permission contexts for x402 `exact` payments (MetaMask Delegation Framework v1.3.0).
// The seller decodes the payer's delegation chain, checks that the leaf is the single-use, exact-amount,
// short-lived child YINGLONG requires (plan section 9.7), simulates the redemption and only then settles.
import {
  concat,
  decodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  keccak256,
  recoverAddress,
  type Address,
  type Hex,
} from "viem";
import { abi, decodeRevert, revertDataOf, type DecodedRevert } from "@yinglong/sdk";
import { delegationHash, ROOT_AUTHORITY, type Delegation } from "@yinglong/mandate";
import type { Ledger } from "../chain";

export const SINGLE_DEFAULT_MODE: Hex = `0x${"00".repeat(32)}`;
const MAX_CHAIN_DEPTH = 4;
const MAX_LEAF_CAVEATS = 8;

const DELEGATION_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    {
      name: "caveats",
      type: "tuple[]",
      components: [
        { name: "enforcer", type: "address" },
        { name: "terms", type: "bytes" },
        { name: "args", type: "bytes" },
      ],
    },
    { name: "salt", type: "uint256" },
    { name: "signature", type: "bytes" },
  ],
} as const;

/** Decode an ABI-encoded Delegation[] permission context (leaf first). */
export function decodePermissionContext(ctx: Hex): Delegation[] {
  const [chain] = decodeAbiParameters([DELEGATION_TUPLE], ctx);
  return chain.map((d) => ({
    delegate: d.delegate,
    delegator: d.delegator,
    authority: d.authority,
    caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: c.args })),
    salt: d.salt,
    signature: d.signature,
  }));
}

/** ERC-7579 single execution: abi.encodePacked(target, value, callData). */
export function singleExecution(target: Address, value: bigint, callData: Hex): Hex {
  return encodePacked(["address", "uint256", "bytes"], [target, value, callData]);
}

/** The execution x402 `exact` settles: asset.transfer(payTo, amount). */
export function transferExecution(asset: Address, payTo: Address, amount: bigint): Hex {
  return singleExecution(asset, 0n, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [payTo, amount] }));
}

/** Terms of the three caveats every YINGLONG x402 child carries. */
export function erc20TransferAmountTerms(asset: Address, amount: bigint): Hex {
  return encodePacked(["address", "uint256"], [asset, amount]);
}
export function limitedCallsTerms(limit: bigint): Hex {
  return encodePacked(["uint256"], [limit]);
}
export function timestampTerms(after: bigint, before: bigint): Hex {
  return encodePacked(["uint128", "uint128"], [after, before]);
}

/** DelegationManager EIP-712 digest of a delegation, using the on-chain domain hash (correct on FISCO too). */
export async function delegationDigest(ledger: Ledger, d: Delegation): Promise<Hex> {
  const domainHash = await domainHashOf(ledger);
  return keccak256(concat(["0x1901", domainHash, delegationHash(d)]));
}

const domainCache = new Map<string, Hex>();
async function domainHashOf(ledger: Ledger): Promise<Hex> {
  const key = `${ledger.name}|${ledger.addr("DelegationManager")}`;
  let h = domainCache.get(key);
  if (!h) {
    h = await ledger.read<Hex>({ address: ledger.addr("DelegationManager"), abi: abi.DelegationManagerAbi, functionName: "getDomainHash" });
    domainCache.set(key, h);
  }
  return h;
}

export interface ChildCheck {
  ok: boolean;
  reason?: string;
  code?: "invalid_payload" | "invalid_exact_evm_payload_signature" | "invalid_exact_evm_payload_authorization_value_mismatch" | "invalid_exact_evm_payload_authorization_valid_before";
  chain?: Delegation[];
  leafHash?: Hex;
  validBefore?: bigint;
}

export interface ExpectedPayment {
  delegator: Address;
  redeemer: Address;
  asset: Address;
  amount: bigint;
  now: bigint;
  /** Longest accepted child window, in ledger time units. */
  maxWindow: bigint;
  /** Clock tolerance, in ledger time units. */
  slack: bigint;
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Structural checks before simulation: chain links, leaf delegate, the exact-amount / single-use / short
 * window caveats, and the leaf signature when the leaf delegator is an EOA. The simulation of
 * redeemDelegations remains the final verification (x402 exact EVM, ERC-7710 phase 3).
 */
export async function checkX402Child(ledger: Ledger, ctx: Hex, want: ExpectedPayment): Promise<ChildCheck> {
  let chain: Delegation[];
  try {
    chain = decodePermissionContext(ctx);
  } catch {
    return { ok: false, code: "invalid_payload", reason: "permissionContext is not an ABI-encoded Delegation[]" };
  }
  if (chain.length === 0 || chain.length > MAX_CHAIN_DEPTH) return { ok: false, code: "invalid_payload", reason: `delegation chain depth ${chain.length}` };
  const leaf = chain[0]!;
  const root = chain[chain.length - 1]!;
  if (!eq(leaf.delegate, want.redeemer)) return { ok: false, code: "invalid_payload", reason: `leaf delegate must be ${want.redeemer}` };
  if (!eq(root.delegator, want.delegator)) return { ok: false, code: "invalid_payload", reason: "root delegator differs from payload.delegator" };
  if (!eq(root.authority, ROOT_AUTHORITY)) return { ok: false, code: "invalid_payload", reason: "last delegation is not a root delegation" };
  for (let i = 0; i < chain.length - 1; i++) {
    const d = chain[i]!;
    const parent = chain[i + 1]!;
    if (!eq(d.authority, delegationHash(parent))) return { ok: false, code: "invalid_payload", reason: `delegation ${i} does not point at its parent` };
    if (!eq(d.delegator, parent.delegate)) return { ok: false, code: "invalid_payload", reason: `delegation ${i} delegator is not the parent's delegate` };
  }
  if (leaf.caveats.length > MAX_LEAF_CAVEATS) return { ok: false, code: "invalid_payload", reason: "too many caveats on the x402 child" };

  const enforcer = (name: "ERC20TransferAmountEnforcer" | "LimitedCallsEnforcer" | "TimestampEnforcer") => ledger.addr(name);
  const amountCaveats = leaf.caveats.filter((c) => eq(c.enforcer, enforcer("ERC20TransferAmountEnforcer")));
  const limitCaveats = leaf.caveats.filter((c) => eq(c.enforcer, enforcer("LimitedCallsEnforcer")));
  const timeCaveats = leaf.caveats.filter((c) => eq(c.enforcer, enforcer("TimestampEnforcer")));
  if (amountCaveats.length !== 1 || !eq(amountCaveats[0]!.terms, erc20TransferAmountTerms(want.asset, want.amount))) {
    return {
      ok: false,
      code: "invalid_exact_evm_payload_authorization_value_mismatch",
      reason: "x402 child must carry exactly one ERC20TransferAmount(asset, exact amount) caveat",
    };
  }
  if (limitCaveats.length !== 1 || !eq(limitCaveats[0]!.terms, limitedCallsTerms(1n))) {
    return { ok: false, code: "invalid_payload", reason: "x402 child must carry LimitedCalls(1)" };
  }
  if (timeCaveats.length !== 1 || (timeCaveats[0]!.terms.length - 2) / 2 !== 32) {
    return { ok: false, code: "invalid_exact_evm_payload_authorization_valid_before", reason: "x402 child must carry one Timestamp caveat" };
  }
  const t = timeCaveats[0]!.terms;
  const before = BigInt(`0x${t.slice(34, 66)}`);
  if (before === 0n || before <= want.now) {
    return { ok: false, code: "invalid_exact_evm_payload_authorization_valid_before", reason: "x402 child has expired" };
  }
  if (before - want.now > want.maxWindow + want.slack) {
    return { ok: false, code: "invalid_exact_evm_payload_authorization_valid_before", reason: `x402 child window exceeds ${want.maxWindow}` };
  }

  // Leaf signature: an EOA delegator (the payer's agent) is checked here; contract delegators are checked
  // by ERC-1271 during simulation.
  const code = await ledger.pub.getCode({ address: leaf.delegator });
  if (!code || code === "0x") {
    try {
      const signer = await recoverAddress({ hash: await delegationDigest(ledger, leaf), signature: leaf.signature });
      if (!eq(signer, leaf.delegator)) return { ok: false, code: "invalid_exact_evm_payload_signature", reason: "leaf signature does not recover to its delegator" };
    } catch {
      return { ok: false, code: "invalid_exact_evm_payload_signature", reason: "leaf signature is malformed" };
    }
  }
  return { ok: true, chain, leafHash: delegationHash(leaf), validBefore: before };
}

export interface SimulationResult {
  ok: boolean;
  gas?: bigint;
  revert?: DecodedRevert;
}

/** Simulate redeemDelegations([ctx], [single mode], [transfer]) from the redeemer. */
export async function simulateRedemption(ledger: Ledger, redeemer: Address, ctx: Hex, execution: Hex): Promise<SimulationResult> {
  const call = {
    address: ledger.addr("DelegationManager"),
    abi: abi.DelegationManagerAbi,
    functionName: "redeemDelegations",
    args: [[ctx], [SINGLE_DEFAULT_MODE], [execution]],
    account: redeemer,
  } as const;
  try {
    await ledger.pub.simulateContract(call as never);
  } catch (e) {
    return { ok: false, revert: decodeRevert(revertDataOf(e)) };
  }
  let gas: bigint | undefined;
  try {
    gas = await ledger.pub.estimateContractGas(call as never);
  } catch {
    gas = undefined;
  }
  return { ok: true, gas };
}

export const redeemCall = (ledger: Ledger, ctx: Hex, execution: Hex) =>
  ({
    address: ledger.addr("DelegationManager"),
    abi: abi.DelegationManagerAbi,
    functionName: "redeemDelegations",
    args: [[ctx], [SINGLE_DEFAULT_MODE], [execution]],
  }) as const;
