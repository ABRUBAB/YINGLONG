/**
 * Off-chain re-implementation of HybridDeleGator's WebAuthn path (P256VerifierLib +
 * WebAuthn.verifySignature), used as a pre-flight self-check before a signature is sent and by the
 * unit tests. Signature verification uses WebCrypto (ECDSA P-256 / SHA-256), which hashes
 * authenticatorData ++ sha256(clientDataJSON) exactly once, matching the contract's messageHash.
 */
import { decodeAbiParameters, sha256, type Hex } from "viem";
import { bigIntTo32, b64urlEncode, concatBytes, hexToBytes, indexOfBytes, utf8 } from "./bytes";
import { P256_N_DIV_2, RESPONSE_TYPE, WEBAUTHN_SIGNATURE_ABI } from "./encode";

export interface DecodedWebAuthnSignature {
  keyIdHash: Hex;
  r: bigint;
  s: bigint;
  authenticatorData: Uint8Array;
  requireUserVerification: boolean;
  clientDataJSONPrefix: string;
  clientDataJSONSuffix: string;
  responseTypeLocation: number;
}

export function decodeWebAuthnSignature(signature: Hex): DecodedWebAuthnSignature {
  const [keyIdHash, r, s, authData, requireUV, prefix, suffix, loc] = decodeAbiParameters(WEBAUTHN_SIGNATURE_ABI, signature);
  return {
    keyIdHash,
    r,
    s,
    authenticatorData: hexToBytes(authData),
    requireUserVerification: requireUV,
    clientDataJSONPrefix: prefix,
    clientDataJSONSuffix: suffix,
    responseTypeLocation: Number(loc),
  };
}

/** Mirrors WebAuthn.checkAuthFlags. */
export function checkAuthFlags(flags: number, requireUserVerification: boolean): boolean {
  if (!(flags & 0x01)) return false;
  if (requireUserVerification && !(flags & 0x04)) return false;
  if (!(flags & 0x08) && flags & 0x10) return false;
  return true;
}

/** Everything the contract checks except the curve arithmetic; returns the 32-byte messageHash. */
export function contractMessage(hash: Hex, d: DecodedWebAuthnSignature): { ok: boolean; reason?: string; message?: Uint8Array; messageHash?: Hex } {
  if (d.authenticatorData.length < 37 || !checkAuthFlags(d.authenticatorData[32]!, d.requireUserVerification)) {
    return { ok: false, reason: "authenticator flags" };
  }
  const clientDataJSON = utf8.encode(`${d.clientDataJSONPrefix}${b64urlEncode(hexToBytes(hash))}${d.clientDataJSONSuffix}`);
  const type = utf8.encode(RESPONSE_TYPE);
  for (let i = 0; i < type.length; i++) {
    if (clientDataJSON[d.responseTypeLocation + i] !== type[i]) return { ok: false, reason: "response type location" };
  }
  if (d.s > P256_N_DIV_2) return { ok: false, reason: "high s" };
  const clientDataHash = hexToBytes(sha256(clientDataJSON));
  const message = concatBytes(d.authenticatorData, clientDataHash);
  return { ok: true, message, messageHash: sha256(message) };
}

/** Full check with WebCrypto against the passkey's public key (x, y). */
export async function verifyWebAuthnSignature(hash: Hex, signature: Hex, x: Hex, y: Hex): Promise<boolean> {
  const d = decodeWebAuthnSignature(signature);
  const m = contractMessage(hash, d);
  if (!m.ok || !m.message) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    concatBytes(new Uint8Array([0x04]), hexToBytes(x), hexToBytes(y)) as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const raw = concatBytes(bigIntTo32(d.r), bigIntTo32(d.s));
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw as BufferSource, m.message as BufferSource);
}

export { indexOfBytes };
