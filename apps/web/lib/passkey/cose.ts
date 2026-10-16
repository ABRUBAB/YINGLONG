/**
 * Extracts the P-256 public key (x, y) from a WebAuthn registration.
 * attestationObject = CBOR map { fmt, attStmt, authData }; authData carries the attested credential
 * data whose COSE_Key is { 1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y }.
 */
import { bytesToHex } from "./bytes";

type Cbor = number | bigint | string | boolean | null | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

/** Minimal CBOR decoder (RFC 8949 major types 0-5 and simple values); returns [value, nextOffset]. */
export function decodeCbor(buf: Uint8Array, offset = 0): [Cbor, number] {
  const ib = buf[offset];
  if (ib === undefined) throw new Error("CBOR: unexpected end of input");
  const major = ib >> 5;
  const info = ib & 0x1f;
  let pos = offset + 1;
  let len: number | bigint;
  if (info < 24) len = info;
  else if (info === 24) len = buf[pos++]!;
  else if (info === 25) {
    len = (buf[pos]! << 8) | buf[pos + 1]!;
    pos += 2;
  } else if (info === 26) {
    len = ((buf[pos]! << 24) >>> 0) + (buf[pos + 1]! << 16) + (buf[pos + 2]! << 8) + buf[pos + 3]!;
    pos += 4;
  } else if (info === 27) {
    let v = 0n;
    for (let k = 0; k < 8; k++) v = (v << 8n) | BigInt(buf[pos + k]!);
    pos += 8;
    len = v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  } else throw new Error(`CBOR: unsupported additional info ${info}`);

  const n = typeof len === "bigint" ? Number(len) : len;
  switch (major) {
    case 0:
      return [len, pos];
    case 1:
      return [typeof len === "bigint" ? -1n - len : -1 - len, pos];
    case 2:
      return [buf.slice(pos, pos + n), pos + n];
    case 3:
      return [new TextDecoder().decode(buf.slice(pos, pos + n)), pos + n];
    case 4: {
      const arr: Cbor[] = [];
      for (let k = 0; k < n; k++) {
        const [v, next] = decodeCbor(buf, pos);
        arr.push(v);
        pos = next;
      }
      return [arr, pos];
    }
    case 5: {
      const map = new Map<Cbor, Cbor>();
      for (let k = 0; k < n; k++) {
        const [key, p1] = decodeCbor(buf, pos);
        const [val, p2] = decodeCbor(buf, p1);
        map.set(key, val);
        pos = p2;
      }
      return [map, pos];
    }
    case 7:
      if (info === 20) return [false, pos];
      if (info === 21) return [true, pos];
      if (info === 22) return [null, pos];
      throw new Error(`CBOR: unsupported simple value ${info}`);
    default:
      throw new Error(`CBOR: unsupported major type ${major}`);
  }
}

export interface P256PublicKey {
  x: `0x${string}`;
  y: `0x${string}`;
}

/** Parses authenticator data with attested credential data (registration). */
export function parseAuthData(authData: Uint8Array) {
  if (authData.length < 37) throw new Error("authenticatorData too short");
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32]!;
  const signCount = ((authData[33]! << 24) >>> 0) + (authData[34]! << 16) + (authData[35]! << 8) + authData[36]!;
  const out: {
    rpIdHash: Uint8Array;
    flags: number;
    signCount: number;
    aaguid?: Uint8Array;
    credentialId?: Uint8Array;
    publicKey?: P256PublicKey;
  } = { rpIdHash, flags, signCount };
  if (flags & 0x40) {
    let p = 37;
    out.aaguid = authData.slice(p, p + 16);
    p += 16;
    const idLen = (authData[p]! << 8) | authData[p + 1]!;
    p += 2;
    out.credentialId = authData.slice(p, p + idLen);
    p += idLen;
    const [cose] = decodeCbor(authData, p);
    out.publicKey = coseToP256(cose);
  }
  return out;
}

export function coseToP256(cose: unknown): P256PublicKey {
  if (!(cose instanceof Map)) throw new Error("COSE key is not a map");
  const kty = cose.get(1);
  const alg = cose.get(3);
  const crv = cose.get(-1);
  const x = cose.get(-2);
  const y = cose.get(-3);
  if (kty !== 2 || alg !== -7 || crv !== 1) throw new Error("Passkey is not an ES256 (P-256) key");
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) {
    throw new Error("COSE key has malformed coordinates");
  }
  return { x: bytesToHex(x), y: bytesToHex(y) };
}

/** attestationObject (bytes) -> { x, y, credentialId }. */
export function publicKeyFromAttestation(attestationObject: Uint8Array): P256PublicKey & { credentialId: Uint8Array } {
  const [obj] = decodeCbor(attestationObject);
  if (!(obj instanceof Map)) throw new Error("attestationObject is not a CBOR map");
  const authData = obj.get("authData");
  if (!(authData instanceof Uint8Array)) throw new Error("attestationObject has no authData");
  const parsed = parseAuthData(authData);
  if (!parsed.publicKey || !parsed.credentialId) throw new Error("authData carries no attested credential");
  return { ...parsed.publicKey, credentialId: parsed.credentialId };
}

/** SubjectPublicKeyInfo DER (AuthenticatorAttestationResponse.getPublicKey()) -> { x, y }. */
export function publicKeyFromSpki(spki: Uint8Array): P256PublicKey {
  // The uncompressed point 0x04 || x || y is the last 65 bytes of a P-256 SPKI.
  const point = spki.slice(spki.length - 65);
  if (point[0] !== 0x04) throw new Error("SPKI does not end with an uncompressed P-256 point");
  return { x: bytesToHex(point.slice(1, 33)), y: bytesToHex(point.slice(33, 65)) };
}
