/**
 * SubjectPublicKeyInfo (DER) for a P-256 key, as AuthenticatorAttestationResponse.getPublicKey()
 * returns it:
 *
 *   SEQUENCE {
 *     SEQUENCE { OID 1.2.840.10045.2.1 (id-ecPublicKey), OID 1.2.840.10045.3.1.7 (prime256v1) }
 *     BIT STRING { 0x00 unused bits, 0x04 || x (32) || y (32) }
 *   }
 *
 * The parser walks the DER structure and checks both object identifiers and the uncompressed point
 * instead of trusting "the last 65 bytes", so an Ed25519 or P-384 key, a compressed point or a
 * truncated buffer is refused before its coordinates reach the account factory.
 */
import type { Hex } from "viem";
import { bytesToHex } from "./bytes";

export class SpkiError extends Error {
  constructor(message: string) {
    super(`Passkey public key: ${message}`);
    this.name = "SpkiError";
  }
}

const OID_EC_PUBLIC_KEY = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const OID_P256 = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];

interface Tlv {
  tag: number;
  start: number; // first content byte
  end: number; // one past the last content byte
}

function readTlv(buf: Uint8Array, at: number): Tlv {
  if (at + 2 > buf.length) throw new SpkiError("truncated DER");
  const tag = buf[at]!;
  let len = buf[at + 1]!;
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 2 || start + n > buf.length) throw new SpkiError("unsupported DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[start + i]!;
    start += n;
  }
  const end = start + len;
  if (end > buf.length) throw new SpkiError("truncated DER");
  return { tag, start, end };
}

const sameBytes = (buf: Uint8Array, t: Tlv, want: number[]) =>
  t.end - t.start === want.length && want.every((b, i) => buf[t.start + i] === b);

export function parseP256Spki(spki: Uint8Array): { x: Hex; y: Hex } {
  const outer = readTlv(spki, 0);
  if (outer.tag !== 0x30 || outer.end !== spki.length) throw new SpkiError("not a DER SEQUENCE");
  const alg = readTlv(spki, outer.start);
  if (alg.tag !== 0x30) throw new SpkiError("missing AlgorithmIdentifier");
  const oid = readTlv(spki, alg.start);
  if (oid.tag !== 0x06 || !sameBytes(spki, oid, OID_EC_PUBLIC_KEY)) throw new SpkiError("not an elliptic-curve key (ES256 is required)");
  const curve = readTlv(spki, oid.end);
  if (curve.tag !== 0x06 || !sameBytes(spki, curve, OID_P256) || curve.end !== alg.end) throw new SpkiError("not a P-256 key (ES256 is required)");
  const bits = readTlv(spki, alg.end);
  if (bits.tag !== 0x03 || bits.end !== outer.end) throw new SpkiError("missing BIT STRING");
  if (bits.end - bits.start !== 66 || spki[bits.start] !== 0x00) throw new SpkiError("expected a 65-byte uncompressed point");
  if (spki[bits.start + 1] !== 0x04) throw new SpkiError("the point is compressed");
  const x = spki.slice(bits.start + 2, bits.start + 34);
  const y = spki.slice(bits.start + 34, bits.start + 66);
  if (x.every((b) => b === 0) && y.every((b) => b === 0)) throw new SpkiError("the point is zero");
  return { x: bytesToHex(x), y: bytesToHex(y) };
}
