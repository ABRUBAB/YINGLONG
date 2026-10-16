"use client";

/**
 * Visitor sign-up with the visitor's own passkey (/start).
 *
 * 1. createVisitorPasskey: navigator.credentials.create (ES256, user verification required, resident
 *    key preferred). Only the public key (x, y from getPublicKey(), SPKI) and the credential id leave
 *    the device; the private key never does, and the service never holds a key for the visitor.
 * 2. POST /v1/visitors: the service deploys a HybridDeleGator whose only signer is that passkey and
 *    returns two messages: the user operation that publishes the mandate, and the root delegation.
 * 3. reviewSignUp: the signing guard and this page's own decoding check both messages.
 * 4. signSignUp: two assertions with that credential, one per digest, HybridDeleGator encoding.
 * 5. completeSignUp: POST /v1/visitors/:id/seal; on success the session is stored on this device.
 */
import type { Hex } from "viem";
import type { AgentApi } from "./api/client";
import type { VisitorSealResult, VisitorSignUp } from "./api/view";
import { writeVisitorSession } from "./api/session";
import { reviewDelegation, reviewPublishOp, type ContractDirectory, type Review } from "./account-ops";
import { b64urlEncode, createPasskey, signHash } from "./passkey";
import { guardSigningRequest, type GuardResult } from "./signing-guard";

export interface VisitorKey {
  credentialId: string;
  publicKey: { x: Hex; y: Hex };
}

function randomB64url(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64urlEncode(b);
}

export async function createVisitorPasskey(opts: { signal?: AbortSignal } = {}): Promise<VisitorKey> {
  const tag = randomB64url(3).replace(/[-_]/g, "x").toUpperCase();
  const k = await createPasskey({
    challenge: randomB64url(32),
    user: { id: randomB64url(16), name: `yinglong-visitor-${tag}`, displayName: `YINGLONG visitor ${tag}` },
    residentKey: "preferred",
    signal: opts.signal,
  });
  return { credentialId: k.keyId, publicKey: { x: k.x, y: k.y } };
}

export interface SignUpStep {
  step: "publish" | "delegation";
  title: string;
  digest: Hex;
  guard: GuardResult;
  review: Review;
}

export interface SignUpReview {
  ok: boolean;
  steps: SignUpStep[];
  problems: string[];
}

/** Guard and decode both messages before the passkey is asked for anything. */
export function reviewSignUp(s: VisitorSignUp, dir: ContractDirectory): SignUpReview {
  const problems: string[] = [];
  const publish = s.requests.find((r) => r.step === "publish");
  const delegation = s.requests.find((r) => r.step === "delegation");
  if (s.requests.length !== 2 || !publish || !delegation) problems.push("The service must send exactly two messages: publish and delegation.");
  const facts = { account: s.account, agentWallet: s.agent.wallet, mandateHash: s.mandate.mandateHash, delegationHash: s.mandate.delegationHash };
  const steps: SignUpStep[] = [];
  let published: ReturnType<typeof reviewPublishOp>["published"] = null;
  if (publish) {
    const review = reviewPublishOp(publish.typedData, facts, dir);
    published = review.published;
    steps.push({ step: "publish", title: publish.title, digest: publish.digest as Hex, guard: guardSigningRequest({ kind: "seal", digest: publish.digest, typedData: publish.typedData }), review });
  }
  if (delegation) {
    const review = reviewDelegation(delegation.typedData, facts, dir, published);
    steps.push({ step: "delegation", title: delegation.title, digest: delegation.digest as Hex, guard: guardSigningRequest({ kind: "seal", digest: delegation.digest, typedData: delegation.typedData }), review });
  }
  for (const st of steps) {
    if (!st.guard.ok) problems.push(`${st.title}: ${st.guard.reason}`);
    for (const c of st.review.checks) if (!c.ok) problems.push(`${st.title}: ${c.label}`);
  }
  return { ok: problems.length === 0 && steps.length === 2, steps, problems };
}

export class SignUpRefusedError extends Error {
  constructor(readonly problems: string[]) {
    super(`Not signed: ${problems.join("; ")}`);
    this.name = "SignUpRefusedError";
  }
}

/**
 * One passkey assertion for one sign-up step. The page asks for each step on its own tap: Android's credential
 * manager refuses a second request that starts while the first sheet is still closing.
 */
export async function signStep(review: SignUpReview, credentialId: string, step: "publish" | "delegation"): Promise<Hex> {
  if (!review.ok) throw new SignUpRefusedError(review.problems);
  const s = review.steps.find((x) => x.step === step)!;
  const sig = await signHash(s.digest, { keyIds: [credentialId] });
  if (sig.keyId !== credentialId) throw new Error("The authenticator answered with a different passkey.");
  return sig.signature;
}

/** Two passkey assertions with this credential: the publish operation first, then the delegation. */
export async function signSignUp(
  review: SignUpReview,
  credentialId: string,
  onStep?: (step: SignUpStep["step"]) => void,
): Promise<{ userOpSignature: Hex; delegationSignature: Hex }> {
  if (!review.ok) throw new SignUpRefusedError(review.problems);
  const publish = review.steps.find((s) => s.step === "publish")!;
  const delegation = review.steps.find((s) => s.step === "delegation")!;
  onStep?.("publish");
  const a = await signHash(publish.digest, { keyIds: [credentialId] });
  onStep?.("delegation");
  const b = await signHash(delegation.digest, { keyIds: [credentialId] });
  if (a.keyId !== credentialId || b.keyId !== credentialId) throw new Error("The authenticator answered with a different passkey.");
  return { userOpSignature: a.signature, delegationSignature: b.signature };
}

/** Seal on the service, then remember the visitor on this device (losing it means signing up again). */
export async function completeSignUp(
  api: AgentApi,
  s: VisitorSignUp,
  key: VisitorKey,
  sigs: { userOpSignature: Hex; delegationSignature: Hex },
): Promise<VisitorSealResult> {
  const sealed = await api.visitorSeal(s.visitorId, s.token, sigs);
  writeVisitorSession({
    visitorId: s.visitorId,
    token: s.token,
    credentialId: key.credentialId,
    publicKey: key.publicKey,
    account: s.account,
    sealedAt: new Date().toISOString(),
  });
  return sealed;
}
