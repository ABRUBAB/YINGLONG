"use client";
import { privateKeyToAccount } from "viem/accounts";

/**
 * One path for every passkey signature the user gives (seal, approve, pause, resume, director
 * co-sign). The signing-domain guard runs first; nothing is signed unless the message type is
 * allowlisted and hashTypedData(typedData) equals the digest.
 *
 * Signers, always named in the UI:
 * - "passkey": the user's WebAuthn passkey (HybridDeleGator encoding, lib/passkey).
 * - "scripted": the agent service's scripted passkey (software P-256 key) for accounts that have no
 *   WebAuthn key registered yet (POST /v1/approvals/:id/demo-sign). Labelled "scripted passkey".
 * - "sample": fixtures mode only; nothing is sent anywhere.
 */
import type { Hex } from "viem";
import { ApiRequestError, getApi, DATA_MODE } from "./api";
import { isPromise } from "./api/client";
import type { ApprovalResult, SigningRequest } from "./api/view";
import { passkeysSupported, signHash, PasskeyCancelledError, PasskeyEncodingError } from "./passkey";
import { guardSigningRequest, type GuardResult } from "./signing-guard";
import { activeVisitor } from "./api/session";
import { reviewRevoke, type Check } from "./account-ops";

export type SignerKind = "passkey" | "key" | "scripted" | "sample";

export const SIGNER_LABEL: Record<SignerKind, string> = {
  passkey: "your passkey",
  key: "your secret key",
  scripted: "the scripted passkey (software P-256 key, demo)",
  sample: "a sample signature (fixtures mode, nothing sent)",
};

export class SigningRefusedError extends Error {
  constructor(readonly guard: Extract<GuardResult, { ok: false }>) {
    super(`Signing refused (${guard.code}): ${guard.reason}`);
    this.name = "SigningRefusedError";
  }
}

const SAMPLE_SIGNATURE = `0x${"00".repeat(31)}01` as Hex;

/** Which signer this session will use (for labelling buttons before the user presses them). */
export async function availableSigner(): Promise<SignerKind> {
  // A visitor signed up with their own passkey: every signature is theirs, in fixtures mode too
  // (the fixture service then verifies the WebAuthn signature against the visitor's public key).
  const v = activeVisitor();
  if (v) return v.method === "key" ? "key" : "passkey";
  if (DATA_MODE === "fixtures") return "sample";
  const me = getApi().me();
  const principal = isPromise(me) ? await me : me;
  if (principal.passkeys.length && passkeysSupported()) return "passkey";
  if (/scripted/i.test(principal.signer)) return "scripted";
  return passkeysSupported() ? "passkey" : "scripted";
}

/** Guard, sign and submit. Returns the service result and which signer was used. */
export async function signAndSubmit(req: SigningRequest, opts: { prefer?: SignerKind } = {}): Promise<{ result: ApprovalResult; signer: SignerKind; primaryType: string }> {
  const guard = guardSigningRequest(req);
  if (!guard.ok) throw new SigningRefusedError(guard);
  const api = getApi();
  const signer = opts.prefer ?? (await availableSigner());
  if (signer === "sample") {
    await new Promise((r) => setTimeout(r, 350));
    return { result: await api.submitSignature(req.id, { keyId: "sample-key", signature: SAMPLE_SIGNATURE }), signer, primaryType: guard.primaryType };
  }
  if (signer === "scripted") {
    return { result: await api.demoSign(req.id), signer, primaryType: guard.primaryType };
  }
  if (signer === "key") {
    const v = activeVisitor();
    if (!v?.secretKey) throw new Error("This device does not hold your secret key. Log in again with it.");
    const signature = await privateKeyToAccount(v.secretKey as Hex).sign({ hash: req.digest as Hex });
    return { result: await api.submitSignature(req.id, { keyId: "secret-key", signature }), signer, primaryType: guard.primaryType };
  }
  if (!passkeysSupported()) throw new Error("This browser cannot use passkeys. Open the approval link on your phone.");
  const visitor = activeVisitor();
  let keyIds: string[];
  if (visitor) keyIds = [visitor.credentialId];
  else {
    const me = api.me();
    const principal = isPromise(me) ? await me : me;
    keyIds = principal.passkeys.map((k) => k.keyId);
  }
  const enc = await signHash(req.digest as Hex, { keyIds });
  return { result: await api.submitSignature(req.id, { keyId: enc.keyId, signature: enc.signature }), signer, primaryType: guard.primaryType };
}

export class RevokeRefusedError extends Error {
  constructor(readonly checks: Check[]) {
    super(`Not signed: ${checks.filter((c) => !c.ok).map((c) => c.label).join("; ")}.`);
    this.name = "RevokeRefusedError";
  }
}

/**
 * Revoke the live mandate. The service builds the user operation; this page decodes it and signs only
 * if it is exactly MandateRegistry.revoke(live mandate) + DelegationManager.disableDelegation(its
 * delegation) from the principal's own account.
 */
export async function revokeMandate(): Promise<{ result: ApprovalResult; signer: SignerKind; checks: Check[] }> {
  const api = getApi();
  const req = await api.requestRevoke();
  const ctx = await api.revokeContext();
  const review = reviewRevoke(req.typedData, ctx);
  if (!review.ok) throw new RevokeRefusedError(review.checks);
  const { result, signer } = await signAndSubmit(req);
  return { result, signer, checks: review.checks };
}

export function describeSignError(e: unknown): string {
  if (e instanceof PasskeyCancelledError) return "The passkey prompt was dismissed. Nothing was signed.";
  if (e instanceof SigningRefusedError || e instanceof RevokeRefusedError) return e.message;
  if (e instanceof PasskeyEncodingError) return `The authenticator's response was refused: ${e.message}`;
  if (e instanceof ApiRequestError && e.status === 403 && !activeVisitor())
    return "This demo account is signed by a scripted passkey that only the operator can trigger. Nothing was signed here; sign up with your own passkey on /start to sign from this device.";
  if (e instanceof Error) return e.message;
  return "Signing failed. Nothing was signed.";
}
