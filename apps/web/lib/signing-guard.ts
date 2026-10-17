/**
 * Signing-domain guard: the only code path that may hand a challenge to the user's
 * passkey. It accepts exactly the typed messages in the allowlist and only when the 32-byte digest it
 * is asked to sign equals hashTypedData(typedData) recomputed here. EIP-3009 transfers, ERC-2612
 * Permit, Permit2, raw personal_sign and unknown EIP-712 domains are refused with a typed reason.
 * A user operation is decoded too: it must send no value and may only call the account-management
 * functions its kind needs (publish a mandate, set payees and guardian, revoke, resume).
 */
import { hashTypedData, toFunctionSelector, type AbiFunction, type Hex, type TypedDataDomain } from "viem";
import { decodeExecuteCallData, DELEGATION_MANAGER_ABI, KILL_SWITCH_ABI, MANDATE_REGISTRY_ABI, PAYEE_BOOK_ABI } from "./account-ops";
import type { SigningRequest, TypedData } from "./api/view";

export const ALLOWED_PRIMARY_TYPES = [
  "Delegation", // DelegationManager: seal a mandate
  "Approval", // CoSignEnforcer: approve a T2 action
  "Receipt", // AccountabilityLedger: co-sign a receipt
  "Trip", // KillSwitchRegistry: one-tap pause
  "Untrip", // KillSwitchRegistry: owner resume
  "Veto", // VetoTimelockEnforcer
  "PackedUserOperation", // ERC-4337 user operation (EntryPoint EIP-712 domain)
] as const;

const KIND_TYPES: Record<SigningRequest["kind"], readonly string[]> = {
  seal: ["Delegation", "PackedUserOperation"],
  cosign: ["Approval"],
  pause: ["Trip"],
  resume: ["Untrip", "PackedUserOperation"],
  veto: ["Veto"],
  // MandateRegistry.revoke + DelegationManager.disableDelegation, one user operation of the account.
  revoke: ["PackedUserOperation"],
};

/** The functions a user operation of each kind may call (the account's own management, never a transfer). */
const KIND_CALLS: Partial<Record<SigningRequest["kind"], readonly string[]>> = {
  seal: ["publish", "supersede", "revoke", "setPayees", "setGuardian"],
  revoke: ["revoke", "disableDelegation"],
  resume: ["untrip"],
};

let selectors: Map<string, string> | undefined;
/** 4-byte selector -> function name, from the contract interfaces this page knows. */
function knownSelectors(): Map<string, string> {
  if (!selectors) {
    selectors = new Map();
    for (const abi of [MANDATE_REGISTRY_ABI, DELEGATION_MANAGER_ABI, PAYEE_BOOK_ABI, KILL_SWITCH_ABI] as readonly (readonly unknown[])[]) {
      for (const item of abi as readonly AbiFunction[]) if (item.type === "function") selectors.set(toFunctionSelector(item).toLowerCase(), item.name);
    }
  }
  return selectors;
}

/** Null when every call of the user operation is allowed for this kind, otherwise the reason it is not. */
function userOpCallsProblem(kind: SigningRequest["kind"], td: TypedData): string | null {
  const allowed = KIND_CALLS[kind];
  if (!allowed) return `A ${kind} request never carries a user operation.`;
  const callData = (td.message as Record<string, unknown>).callData;
  if (typeof callData !== "string") return "The user operation has no call data.";
  let calls;
  try {
    calls = decodeExecuteCallData(callData as Hex).calls;
  } catch (e) {
    return `The user operation's calls could not be decoded: ${(e as Error).message}`;
  }
  if (!calls.length) return "The user operation makes no call.";
  for (const c of calls) {
    if (c.value !== 0n) return "The user operation would send value; this account never signs a transfer this way.";
    const name = knownSelectors().get(c.data.slice(0, 10).toLowerCase());
    if (!name || !allowed.includes(name)) return `A ${kind} request may not call ${name ?? `the unknown function ${c.data.slice(0, 10)}`}.`;
  }
  return null;
}

export type GuardResult =
  | { ok: true; primaryType: string; computed: Hex }
  | { ok: false; code: "UnknownMessageType" | "KindMismatch" | "UnknownCall" | "DigestMismatch" | "MalformedTypedData"; reason: string; computed?: Hex };

function isIntType(t: string) {
  return /^u?int\d*$/.test(t);
}

/** JSON numbers and decimal strings -> bigint for integer fields, recursively through structs and arrays. */
function normalise(value: unknown, type: string, types: TypedData["types"]): unknown {
  if (type.endsWith("]")) {
    const inner = type.slice(0, type.lastIndexOf("["));
    return Array.isArray(value) ? value.map((v) => normalise(v, inner, types)) : value;
  }
  if (isIntType(type)) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    if (typeof value === "string") return BigInt(value);
    return value;
  }
  const struct = types[type];
  if (struct && value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const f of struct) out[f.name] = normalise((value as Record<string, unknown>)[f.name], f.type, types);
    return out;
  }
  return value;
}

export function typedDataDigest(td: TypedData): Hex {
  const types = Object.fromEntries(Object.entries(td.types).filter(([k]) => k !== "EIP712Domain"));
  const domain = { ...td.domain } as Record<string, unknown>;
  if (typeof domain.chainId === "string" || typeof domain.chainId === "number") domain.chainId = BigInt(domain.chainId as string);
  const message = normalise(td.message, td.primaryType, types) as Record<string, unknown>;
  return (hashTypedData as (a: unknown) => Hex)({ domain: domain as TypedDataDomain, types, primaryType: td.primaryType, message });
}

export function guardSigningRequest(req: Pick<SigningRequest, "kind" | "digest" | "typedData">): GuardResult {
  const pt = req.typedData.primaryType;
  if (!(ALLOWED_PRIMARY_TYPES as readonly string[]).includes(pt)) {
    return { ok: false, code: "UnknownMessageType", reason: `This account never signs "${pt}" messages.` };
  }
  // A kind this page does not know (from a newer or compromised service) is refused, never thrown.
  const kindTypes = (KIND_TYPES as Partial<Record<string, readonly string[]>>)[req.kind];
  if (!kindTypes || !kindTypes.includes(pt)) {
    return { ok: false, code: "KindMismatch", reason: `A ${req.kind} request cannot carry a ${pt} message.` };
  }
  if (pt === "PackedUserOperation") {
    const problem = userOpCallsProblem(req.kind, req.typedData);
    if (problem) return { ok: false, code: "UnknownCall", reason: problem };
  }
  let computed: Hex;
  try {
    computed = typedDataDigest(req.typedData);
  } catch (e) {
    return { ok: false, code: "MalformedTypedData", reason: `The typed data could not be hashed: ${(e as Error).message}` };
  }
  if (computed.toLowerCase() !== req.digest.toLowerCase()) {
    return { ok: false, code: "DigestMismatch", reason: "The digest to sign does not match the typed data shown.", computed };
  }
  return { ok: true, primaryType: pt, computed };
}
