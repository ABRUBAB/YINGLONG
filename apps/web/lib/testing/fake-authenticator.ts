/**
 * Test-only software WebAuthn authenticator (ES256 with @noble/curves) behind a navigator.credentials
 * shaped object: create() returns a "none" attestation whose authData carries the COSE key, plus
 * getPublicKey() as DER SPKI; get() signs sha256(authenticatorData || sha256(clientDataJSON)) and
 * returns a DER signature, exactly the inputs the HybridDeleGator encoding consumes.
 * Never imported by application code.
 */
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { b64urlEncode, concatBytes, utf8 } from "../passkey/bytes";

const SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42,
  0x00,
]);

/** SubjectPublicKeyInfo DER for an uncompressed P-256 point (0x04 || x || y). */
export function p256Spki(point65: Uint8Array): Uint8Array {
  return concatBytes(SPKI_PREFIX, point65);
}

/* Minimal CBOR encoder for the attestation object (unsigned/negative ints, bytes, text, maps). */
function head(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 256) return Uint8Array.of((major << 5) | 24, n);
  return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
}
type CborIn = number | string | Uint8Array | Map<CborIn, CborIn>;
function cbor(v: CborIn): Uint8Array {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") {
    const b = utf8.encode(v);
    return concatBytes(head(3, b.length), b);
  }
  if (v instanceof Uint8Array) return concatBytes(head(2, v.length), v);
  const parts: Uint8Array[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return concatBytes(...parts);
}

const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;
const toBytes = (b: BufferSource): Uint8Array => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));

export interface FakeCredential {
  rawId: Uint8Array;
  id: string;
  secretKey: Uint8Array;
  point: Uint8Array;
  counter: number;
}

export function fakeAuthenticator(opts: { origin: string; userVerified?: boolean }) {
  const creds: FakeCredential[] = [];
  const calls = { create: 0, get: 0 };
  const flagsFor = (uv: boolean, at: boolean) => 0x01 | (uv ? 0x04 : 0) | (at ? 0x40 : 0);

  const credentials = {
    async create(o: CredentialCreationOptions) {
      calls.create++;
      const pk = o.publicKey!;
      if (!pk.pubKeyCredParams.some((p) => p.alg === -7)) throw new DOMException("ES256 not offered", "NotSupportedError");
      const secretKey = p256.utils.randomSecretKey();
      const point = p256.getPublicKey(secretKey, false);
      const rawId = crypto.getRandomValues(new Uint8Array(20));
      const cred: FakeCredential = { rawId, id: b64urlEncode(rawId), secretKey, point, counter: 0 };
      creds.push(cred);
      const rpIdHash = sha256(utf8.encode(pk.rp.id ?? new URL(opts.origin).hostname));
      const cose = cbor(
        new Map<CborIn, CborIn>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, point.slice(1, 33)],
          [-3, point.slice(33, 65)],
        ]),
      );
      const authData = concatBytes(rpIdHash, Uint8Array.of(flagsFor(opts.userVerified ?? true, true)), new Uint8Array(4), new Uint8Array(16), Uint8Array.of(rawId.length >> 8, rawId.length & 0xff), rawId, cose);
      const attestationObject = cbor(
        new Map<CborIn, CborIn>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      );
      const clientDataJSON = utf8.encode(JSON.stringify({ type: "webauthn.create", challenge: b64urlEncode(toBytes(pk.challenge)), origin: opts.origin, crossOrigin: false }));
      return {
        id: cred.id,
        rawId: buf(rawId),
        type: "public-key",
        response: { attestationObject: buf(attestationObject), clientDataJSON: buf(clientDataJSON), getPublicKey: () => buf(p256Spki(point)) },
      };
    },

    async get(o: CredentialRequestOptions) {
      calls.get++;
      const pk = o.publicKey!;
      const allowed = (pk.allowCredentials ?? []).map((c) => b64urlEncode(toBytes(c.id)));
      const cred = allowed.length ? creds.find((c) => allowed.includes(c.id)) : creds[0];
      if (!cred) throw new DOMException("No credential", "NotAllowedError");
      cred.counter++;
      const rpIdHash = sha256(utf8.encode(pk.rpId ?? new URL(opts.origin).hostname));
      const authenticatorData = concatBytes(rpIdHash, Uint8Array.of(flagsFor(opts.userVerified ?? true, false)), Uint8Array.of(0, 0, 0, cred.counter));
      const clientDataJSON = utf8.encode(`{"type":"webauthn.get","challenge":"${b64urlEncode(toBytes(pk.challenge))}","origin":"${opts.origin}","crossOrigin":false}`);
      const digest = sha256(concatBytes(authenticatorData, sha256(clientDataJSON)));
      const der = p256.Signature.fromBytes(p256.sign(digest, cred.secretKey, { prehash: false }), "compact").toBytes("der");
      return {
        id: cred.id,
        rawId: buf(cred.rawId),
        type: "public-key",
        response: { authenticatorData: buf(authenticatorData), clientDataJSON: buf(clientDataJSON), signature: buf(der), userHandle: null },
      };
    },
  };

  return { credentials, creds, calls };
}

/** An in-memory Storage for tests that touch localStorage. */
export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
