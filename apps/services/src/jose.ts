// RFC 8785 JSON canonicalisation (JCS) and compact JWS ES256 helpers built on node:crypto, used to sign
// A2A agent cards (A2A 1.0 section 8.4) and the KYB result envelope.
import { createECDH, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify, type KeyObject } from "node:crypto";
import { concat, hexToBytes, keccak256, stringToBytes, toHex, type Hex } from "viem";

/**
 * RFC 8785 canonical JSON. Object members sorted by UTF-16 code units, numbers in ECMAScript shortest form
 * (JSON.stringify), strings escaped exactly as JSON.stringify escapes them (which is what RFC 8785 requires),
 * no insignificant whitespace. Members whose value is undefined are dropped.
 */
export function jcs(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("JCS: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : jcs(v))).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`JCS: unsupported type ${typeof value}`);
  }
}

export function jcsHash(value: unknown): Hex {
  return keccak256(stringToBytes(jcs(value)));
}

export const b64url = (b: Uint8Array | Buffer | string): string =>
  Buffer.from(typeof b === "string" ? Buffer.from(b, "utf8") : b).toString("base64url");
export const fromB64url = (s: string): Buffer => Buffer.from(s, "base64url");

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export interface PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid: string;
  alg: "ES256";
  use: "sig";
}

export interface Jwks {
  keys: PublicJwk[];
}

export interface CardKey {
  kid: string;
  publicJwk: PublicJwk;
  privateKey: KeyObject;
}

/**
 * Deterministic P-256 card-signing key derived from a role's testnet key and a label, so the JWKS (and the
 * jwksHash stored in the passport registry) is stable across restarts without a second secret file.
 * Testnet-only construction; the private scalar never leaves this process.
 */
export function deriveCardKey(seed: Hex, label: string, kid: string): CardKey {
  const h = BigInt(keccak256(concat([seed, toHex(stringToBytes(`YINGLONG A2A card key v1|${label}`))])));
  const d = (h % (P256_N - 1n)) + 1n;
  const dBytes = Buffer.from(hexToBytes(`0x${d.toString(16).padStart(64, "0")}`));
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(dBytes);
  const pub = ecdh.getPublicKey(); // 0x04 || x || y
  const x = b64url(pub.subarray(1, 33));
  const y = b64url(pub.subarray(33, 65));
  const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", x, y, d: b64url(dBytes) }, format: "jwk" });
  return { kid, publicJwk: { kty: "EC", crv: "P-256", x, y, kid, alg: "ES256", use: "sig" }, privateKey };
}

export function jwksOf(keys: CardKey[]): Jwks {
  return { keys: keys.map((k) => k.publicJwk) };
}

/** keccak256 of the RFC 8785 form of the JWKS: the value YinglongPassportRegistry stores as jwksHash. */
export function jwksHash(jwks: Jwks): Hex {
  return jcsHash(jwks);
}

/** ES256 signature (raw r||s, 64 bytes) over the JWS signing input. */
export function es256Sign(key: KeyObject, signingInput: string): string {
  return b64url(nodeSign("sha256", Buffer.from(signingInput, "ascii"), { key, dsaEncoding: "ieee-p1363" }));
}

export function es256Verify(jwk: PublicJwk, signingInput: string, signatureB64url: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
    return nodeVerify("sha256", Buffer.from(signingInput, "ascii"), { key, dsaEncoding: "ieee-p1363" }, fromB64url(signatureB64url));
  } catch {
    return false;
  }
}

/** Detached-payload JWS (JSON serialisation pieces) over the canonical form of `payload`. */
export function signDetached(key: CardKey, payload: unknown, extraHeader: Record<string, string> = {}) {
  const header = { alg: "ES256", typ: "JOSE", kid: key.kid, ...extraHeader };
  const protectedB64 = b64url(JSON.stringify(header));
  const signingInput = `${protectedB64}.${b64url(jcs(payload))}`;
  return { protected: protectedB64, signature: es256Sign(key.privateKey, signingInput) };
}

export function parseProtected(protectedB64: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(fromB64url(protectedB64).toString("utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function verifyDetached(jwk: PublicJwk, sig: { protected: string; signature: string }, payload: unknown): boolean {
  return es256Verify(jwk, `${sig.protected}.${b64url(jcs(payload))}`, sig.signature);
}
