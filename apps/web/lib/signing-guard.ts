/**
 * Signing-domain guard (master plan 9.6): the only code path that may hand a challenge to the user's
 * passkey. It accepts exactly the typed messages in the allowlist and only when the 32-byte digest it
 * is asked to sign equals hashTypedData(typedData) recomputed here. EIP-3009 transfers, ERC-2612
 * Permit, Permit2, raw personal_sign and unknown EIP-712 domains are refused with a typed reason.
 */
import { hashTypedData, type Hex, type TypedDataDomain } from "viem";
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

export type GuardResult =
  | { ok: true; primaryType: string; computed: Hex }
  | { ok: false; code: "UnknownMessageType" | "KindMismatch" | "DigestMismatch" | "MalformedTypedData"; reason: string; computed?: Hex };

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
  if (!KIND_TYPES[req.kind].includes(pt)) {
    return { ok: false, code: "KindMismatch", reason: `A ${req.kind} request cannot carry a ${pt} message.` };
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
