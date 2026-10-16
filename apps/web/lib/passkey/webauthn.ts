/**
 * Browser WebAuthn ceremonies for YINGLONG passkeys.
 *
 * RP ID: the page's hostname, except that every host under the registrable domain
 * yinglong-agent.tech uses "yinglong-agent.tech", so a passkey made on app.yinglong-agent.tech also
 * works on any sibling subdomain and the RP ID never changes.
 */
import type { Hex } from "viem";
import { b64urlDecode, b64urlEncode, hexToBytes } from "./bytes";
import { publicKeyFromAttestation, publicKeyFromSpki, type P256PublicKey } from "./cose";
import { encodeWebAuthnSignature, type EncodedWebAuthnSignature } from "./encode";

export const PRODUCTION_RP_ID = "yinglong-agent.tech";

export function rpIdFor(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === PRODUCTION_RP_ID || host.endsWith(`.${PRODUCTION_RP_ID}`)) return PRODUCTION_RP_ID;
  return host;
}

export function currentRpId(): string {
  return rpIdFor(window.location.hostname);
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
}

/** The phone's passkey service failed without the user cancelling (Android Credential Manager "unknown error"). */
export class PasskeyServiceError extends Error {
  constructor() {
    super("Your phone's passkey service did not answer.");
    this.name = "PasskeyServiceError";
  }
}

/** Android's credential manager can refuse a request that starts while its previous sheet is still closing. */
function isServiceHiccup(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "UnknownError" || e.name === "NotReadableError" || e.name === "InvalidStateError");
}

export class PasskeyCancelledError extends Error {
  constructor() {
    super("The passkey prompt was dismissed or timed out.");
    this.name = "PasskeyCancelledError";
  }
}

function wrap(e: unknown): never {
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) throw new PasskeyCancelledError();
  throw e;
}

export interface CreatedPasskey extends P256PublicKey {
  /** Credential id, base64url: the HybridDeleGator keyId. */
  keyId: string;
  attestationObject: string;
  clientDataJSON: string;
}

/**
 * Registers a new ES256 passkey and returns its public key coordinates. The key is read from
 * getPublicKey() (SPKI, P-256 checked by parseP256Spki) and cross-checked against the COSE key in the
 * attestation object when both are present; a disagreement aborts the registration.
 */
export async function createPasskey(opts: {
  challenge: string;
  user: { id: string; name: string; displayName: string };
  rpId?: string;
  residentKey?: ResidentKeyRequirement;
  signal?: AbortSignal;
}): Promise<CreatedPasskey> {
  const rpId = opts.rpId ?? currentRpId();
  const residentKey = opts.residentKey ?? "required";
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      signal: opts.signal,
      publicKey: {
        rp: { id: rpId, name: "YINGLONG" },
        user: { id: b64urlDecode(opts.user.id) as BufferSource, name: opts.user.name, displayName: opts.user.displayName },
        challenge: b64urlDecode(opts.challenge) as BufferSource,
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey, requireResidentKey: residentKey === "required", userVerification: "required" },
        attestation: "none",
        timeout: 120_000,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    if (isServiceHiccup(e)) throw new PasskeyServiceError();
    wrap(e);
  }
  const res = cred.response as AuthenticatorAttestationResponse;
  const attestationObject = new Uint8Array(res.attestationObject);
  let fromAttestation: P256PublicKey | null = null;
  try {
    fromAttestation = publicKeyFromAttestation(attestationObject);
  } catch {
    fromAttestation = null;
  }
  const spki = typeof res.getPublicKey === "function" ? res.getPublicKey() : null;
  const fromSpki = spki ? publicKeyFromSpki(new Uint8Array(spki)) : null;
  const key = fromSpki ?? fromAttestation;
  if (!key) throw new Error("The authenticator returned no readable P-256 public key.");
  if (fromSpki && fromAttestation && (fromSpki.x !== fromAttestation.x || fromSpki.y !== fromAttestation.y)) {
    throw new Error("Passkey public key mismatch between attestation and SPKI");
  }
  return {
    keyId: cred.id,
    x: key.x,
    y: key.y,
    attestationObject: b64urlEncode(attestationObject),
    clientDataJSON: b64urlEncode(new Uint8Array(res.clientDataJSON)),
  };
}

/**
 * Signs a 32-byte hash (EIP-712 digest: delegation, CoSign approval, kill-switch trip) with a passkey
 * and returns the HybridDeleGator WebAuthn signature encoding.
 */
export async function signHash(
  hash: Hex,
  opts: { keyIds?: string[]; rpId?: string; signal?: AbortSignal } = {},
): Promise<EncodedWebAuthnSignature> {
  const challenge = hexToBytes(hash);
  if (challenge.length !== 32) throw new Error("signHash expects a 32-byte hash");
  const request = () =>
    navigator.credentials.get({
      signal: opts.signal,
      publicKey: {
        challenge: challenge as BufferSource,
        rpId: opts.rpId ?? currentRpId(),
        allowCredentials: (opts.keyIds ?? []).map((id) => ({ type: "public-key" as const, id: b64urlDecode(id) as BufferSource })),
        userVerification: "required",
        timeout: 60_000,
      },
    }) as Promise<PublicKeyCredential>;
  let cred: PublicKeyCredential;
  try {
    cred = await request();
  } catch (e) {
    if (!isServiceHiccup(e)) wrap(e);
    // One retry after the previous sheet has had time to close.
    await new Promise((r) => setTimeout(r, 900));
    try {
      cred = await request();
    } catch (e2) {
      if (isServiceHiccup(e2)) throw new PasskeyServiceError();
      wrap(e2);
    }
  }
  const res = cred.response as AuthenticatorAssertionResponse;
  return encodeWebAuthnSignature({
    keyId: cred.id,
    challenge: hash,
    authenticatorData: new Uint8Array(res.authenticatorData),
    clientDataJSON: new Uint8Array(res.clientDataJSON),
    derSignature: new Uint8Array(res.signature),
    requireUserVerification: true,
  });
}
