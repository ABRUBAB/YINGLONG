/**
 * WebAuthn P-256 signature encoding for the MetaMask Delegation Framework v1.3.0 HybridDeleGator.
 *
 * HybridDeleGator._isValidSignature(hash, signature): a signature longer than 96 bytes is decoded by
 * P256VerifierLib._decodeWebAuthnP256Signature as
 *
 *   abi.decode(signature, (bytes32 keyIdHash, uint256 r, uint256 s, bytes authenticatorData,
 *                          bool requireUserVerification, string clientDataJSONPrefix,
 *                          string clientDataJSONSuffix, uint256 responseTypeLocation))
 *
 * and verified by WebAuthn.verifySignature with challenge = abi.encodePacked(hash) (the 32 raw bytes):
 *   - authenticatorData.length >= 37, UP flag set, UV flag set when requireUserVerification,
 *     BS not set unless BE is set;
 *   - clientDataJSON = prefix ++ Base64URL(hash) (no padding) ++ suffix;
 *   - '"type":"webauthn.get"' found at byte offset responseTypeLocation;
 *   - P-256 verify of sha256(authenticatorData ++ sha256(clientDataJSON)) with (r, s), where
 *     P256SCLVerifierLib rejects s > n / 2 (so s must be low-s normalised).
 * keyIdHash = keccak256(abi.encodePacked(keyId)) where keyId is the string given to addKey(); we use
 * the credential id in base64url as keyId.
 */
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { b64urlEncode, bytesToBigInt, bytesToHex, hexToBytes, indexOfBytes, utf8 } from "./bytes";

/** secp256r1 group order n. */
export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export const P256_N_DIV_2 = P256_N / 2n;

export const WEBAUTHN_SIGNATURE_ABI = [
  { name: "keyIdHash", type: "bytes32" },
  { name: "r", type: "uint256" },
  { name: "s", type: "uint256" },
  { name: "authenticatorData", type: "bytes" },
  { name: "requireUserVerification", type: "bool" },
  { name: "clientDataJSONPrefix", type: "string" },
  { name: "clientDataJSONSuffix", type: "string" },
  { name: "responseTypeLocation", type: "uint256" },
] as const;

export const RESPONSE_TYPE = '"type":"webauthn.get"';
const CHALLENGE_KEY = '"challenge":"';

export class PasskeyEncodingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "challenge_mismatch"
      | "wrong_type"
      | "bad_der"
      | "user_presence_missing"
      | "user_verification_missing"
      | "bad_authenticator_data"
      | "bad_challenge",
  ) {
    super(message);
    this.name = "PasskeyEncodingError";
  }
}

/** keccak256(abi.encodePacked(keyId)) as HybridDeleGator stores it. */
export function keyIdHash(keyId: string): Hex {
  return keccak256(utf8.encode(keyId));
}

/** Parses an ASN.1 DER ECDSA signature into (r, s). */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let p = 0;
  if (der[p++] !== 0x30) throw new PasskeyEncodingError("Signature is not a DER sequence", "bad_der");
  let seqLen = der[p++]!;
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let k = 0; k < n; k++) seqLen = (seqLen << 8) | der[p++]!;
  }
  if (p + seqLen !== der.length) throw new PasskeyEncodingError("DER sequence length mismatch", "bad_der");
  const int = () => {
    if (der[p++] !== 0x02) throw new PasskeyEncodingError("DER integer expected", "bad_der");
    const len = der[p++]!;
    if (len === 0 || len > 33) throw new PasskeyEncodingError("DER integer length out of range", "bad_der");
    const v = bytesToBigInt(der.slice(p, p + len));
    p += len;
    return v;
  };
  const r = int();
  const s = int();
  if (p !== der.length) throw new PasskeyEncodingError("Trailing bytes after DER signature", "bad_der");
  if (r <= 0n || r >= P256_N || s <= 0n || s >= P256_N) throw new PasskeyEncodingError("Signature scalar out of range", "bad_der");
  return { r, s };
}

/** Low-s normalisation: (r, s) and (r, n - s) are both valid; the verifier accepts only s <= n / 2. */
export function normaliseS(s: bigint): bigint {
  return s > P256_N_DIV_2 ? P256_N - s : s;
}

export interface WebAuthnAssertion {
  keyId: string;
  /** The 32-byte hash that was passed as the WebAuthn challenge. */
  challenge: Hex;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** DER signature from AuthenticatorAssertionResponse.signature. */
  derSignature: Uint8Array;
  /** Default true: the ceremony requested userVerification "required". */
  requireUserVerification?: boolean;
}

export interface EncodedWebAuthnSignature {
  signature: Hex;
  keyId: string;
  keyIdHash: Hex;
  r: bigint;
  s: bigint;
  sWasHigh: boolean;
  authenticatorData: Hex;
  requireUserVerification: boolean;
  clientDataJSONPrefix: string;
  clientDataJSONSuffix: string;
  responseTypeLocation: number;
}

/** Splits clientDataJSON around Base64URL(challenge) exactly as WebAuthn.sol re-assembles it. */
export function splitClientDataJSON(clientDataJSON: Uint8Array, challenge: Hex) {
  const hash = hexToBytes(challenge);
  if (hash.length !== 32) throw new PasskeyEncodingError("Challenge must be 32 bytes", "bad_challenge");
  const b64 = b64urlEncode(hash);
  const marker = utf8.encode(`${CHALLENGE_KEY}${b64}"`);
  const at = indexOfBytes(clientDataJSON, marker);
  if (at < 0) {
    throw new PasskeyEncodingError("clientDataJSON does not carry Base64URL(hash) as its challenge", "challenge_mismatch");
  }
  // A second occurrence would make the split ambiguous; WebAuthn clients never produce one.
  if (indexOfBytes(clientDataJSON, marker, at + 1) >= 0) {
    throw new PasskeyEncodingError("clientDataJSON carries the challenge twice", "challenge_mismatch");
  }
  const start = at + CHALLENGE_KEY.length;
  const prefix = utf8.decode(clientDataJSON.slice(0, start));
  const suffix = utf8.decode(clientDataJSON.slice(start + b64.length));
  const typeAt = indexOfBytes(clientDataJSON, utf8.encode(RESPONSE_TYPE));
  if (typeAt < 0) throw new PasskeyEncodingError('clientDataJSON is not of type "webauthn.get"', "wrong_type");
  return { prefix, suffix, responseTypeLocation: typeAt, challengeB64: b64 };
}

export function encodeWebAuthnSignature(a: WebAuthnAssertion): EncodedWebAuthnSignature {
  const requireUV = a.requireUserVerification ?? true;
  if (a.authenticatorData.length < 37) throw new PasskeyEncodingError("authenticatorData is shorter than 37 bytes", "bad_authenticator_data");
  const flags = a.authenticatorData[32]!;
  if (!(flags & 0x01)) throw new PasskeyEncodingError("The authenticator did not report user presence", "user_presence_missing");
  if (requireUV && !(flags & 0x04)) {
    throw new PasskeyEncodingError("The authenticator did not verify the user (PIN or biometric)", "user_verification_missing");
  }
  const { prefix, suffix, responseTypeLocation } = splitClientDataJSON(a.clientDataJSON, a.challenge);
  const { r, s: rawS } = parseDerSignature(a.derSignature);
  const s = normaliseS(rawS);
  const kh = keyIdHash(a.keyId);
  const authenticatorData = bytesToHex(a.authenticatorData);
  const signature = encodeAbiParameters(WEBAUTHN_SIGNATURE_ABI, [
    kh,
    r,
    s,
    authenticatorData,
    requireUV,
    prefix,
    suffix,
    BigInt(responseTypeLocation),
  ]);
  return {
    signature,
    keyId: a.keyId,
    keyIdHash: kh,
    r,
    s,
    sWasHigh: rawS !== s,
    authenticatorData,
    requireUserVerification: requireUV,
    clientDataJSONPrefix: prefix,
    clientDataJSONSuffix: suffix,
    responseTypeLocation,
  };
}
