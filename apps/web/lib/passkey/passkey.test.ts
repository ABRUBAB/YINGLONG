/**
 * Passkey signature tests with a software P-256 key (@noble/curves) acting as the authenticator.
 * The "contract" side is a faithful re-implementation of P256VerifierLib + WebAuthn.sol from the
 * MetaMask Delegation Framework v1.3.0, checked with noble's verifier (prehash off, low-s enforced),
 * so a signature that passes here has the exact layout and arithmetic the HybridDeleGator accepts.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { decodeAbiParameters, keccak256, toBytes, type Hex } from "viem";
import { b64urlEncode, bigIntTo32, bytesToHex, concatBytes, hexToBytes, utf8 } from "./bytes";
import {
  encodeWebAuthnSignature,
  keyIdHash,
  normaliseS,
  P256_N,
  P256_N_DIV_2,
  parseDerSignature,
  PasskeyEncodingError,
  WEBAUTHN_SIGNATURE_ABI,
} from "./encode";
import { contractMessage, decodeWebAuthnSignature, verifyWebAuthnSignature } from "./verify";
import { decodeCbor, publicKeyFromAttestation, publicKeyFromSpki } from "./cose";
import { rpIdFor, signHash } from "./webauthn";

const RP_ID = "yinglong-agent.tech";
const ORIGIN = "https://app.yinglong-agent.tech";
const KEY_ID = "zS1aLXpH0T0n4yq8vB6m2Q";
const HASH = keccak256(toBytes("sample EIP-712 delegation digest")) as Hex;

function softwareAuthenticator(secretKey = p256.utils.randomSecretKey()) {
  const pub = p256.getPublicKey(secretKey, false); // 0x04 || x || y
  const x = bytesToHex(pub.slice(1, 33));
  const y = bytesToHex(pub.slice(33, 65));
  function assert(challenge: Hex, opts: { flags?: number; type?: string; highS?: boolean; extraJson?: string } = {}) {
    const authenticatorData = concatBytes(nobleSha256(utf8.encode(RP_ID)), new Uint8Array([opts.flags ?? 0x05]), new Uint8Array([0, 0, 0, 7]));
    const cdj =
      `{"type":"${opts.type ?? "webauthn.get"}","challenge":"${b64urlEncode(hexToBytes(challenge))}",` +
      `"origin":"${ORIGIN}","crossOrigin":false${opts.extraJson ?? ""}}`;
    const clientDataJSON = utf8.encode(cdj);
    const messageHash = nobleSha256(concatBytes(authenticatorData, nobleSha256(clientDataJSON)));
    const compact = p256.sign(messageHash, secretKey, { prehash: false, lowS: false });
    let sig = p256.Signature.fromBytes(compact, "compact");
    // Authenticators may return either s or n - s; force the high form when asked.
    if (opts.highS && sig.s <= P256_N_DIV_2) sig = new p256.Signature(sig.r, P256_N - sig.s);
    if (!opts.highS && opts.highS !== undefined && sig.s > P256_N_DIV_2) sig = new p256.Signature(sig.r, P256_N - sig.s);
    return { authenticatorData, clientDataJSON, derSignature: sig.toBytes("der"), messageHash };
  }
  return { secretKey, x, y, assert };
}

/** Solidity-faithful verification (WebAuthn.verifySignature + P256SCLVerifierLib.verifySignature). */
function contractVerify(hash: Hex, signature: Hex, x: Hex, y: Hex): boolean {
  const d = decodeWebAuthnSignature(signature);
  const m = contractMessage(hash, d);
  if (!m.ok) return false;
  const pub = concatBytes(new Uint8Array([0x04]), hexToBytes(x), hexToBytes(y));
  const compact = concatBytes(bigIntTo32(d.r), bigIntTo32(d.s));
  return p256.verify(compact, hexToBytes(m.messageHash!), pub, { prehash: false, lowS: true });
}

describe("HybridDeleGator WebAuthn signature encoding", () => {
  it("produces the abi layout (bytes32, uint256, uint256, bytes, bool, string, string, uint256)", () => {
    const a = softwareAuthenticator();
    const asr = a.assert(HASH);
    const enc = encodeWebAuthnSignature({ keyId: KEY_ID, challenge: HASH, ...asr });
    const [kh, r, s, authData, uv, prefix, suffix, loc] = decodeAbiParameters(WEBAUTHN_SIGNATURE_ABI, enc.signature);
    expect(kh).toBe(keccak256(toBytes(KEY_ID)));
    expect(kh).toBe(keyIdHash(KEY_ID));
    expect(r).toBe(enc.r);
    expect(s).toBe(enc.s);
    expect(s <= P256_N_DIV_2).toBe(true);
    expect(authData).toBe(bytesToHex(asr.authenticatorData));
    expect(uv).toBe(true);
    expect(prefix).toBe('{"type":"webauthn.get","challenge":"');
    expect(suffix).toBe(`","origin":"${ORIGIN}","crossOrigin":false}`);
    expect(loc).toBe(1n);
    // The challenge itself is not in the signature: the contract re-inserts Base64URL(hash).
    expect(prefix + b64urlEncode(hexToBytes(HASH)) + suffix).toBe(utf8.decode(asr.clientDataJSON));
    expect(b64urlEncode(hexToBytes(HASH))).toHaveLength(43);
  });

  it("verifies the way the contract does, for 50 fresh keys and hashes", () => {
    for (let k = 0; k < 50; k++) {
      const a = softwareAuthenticator();
      const hash = keccak256(toBytes(`digest ${k}`));
      const enc = encodeWebAuthnSignature({ keyId: `key-${k}`, challenge: hash, ...a.assert(hash) });
      expect(contractVerify(hash, enc.signature, a.x, a.y)).toBe(true);
      // and not for a different hash
      expect(contractVerify(keccak256(toBytes(`other ${k}`)), enc.signature, a.x, a.y)).toBe(false);
    }
  });

  it("normalises high-s signatures to low-s (P256SCLVerifierLib rejects s > n/2)", () => {
    const a = softwareAuthenticator();
    const asr = a.assert(HASH, { highS: true });
    const raw = parseDerSignature(asr.derSignature);
    expect(raw.s > P256_N_DIV_2).toBe(true);
    const enc = encodeWebAuthnSignature({ keyId: KEY_ID, challenge: HASH, ...asr });
    expect(enc.sWasHigh).toBe(true);
    expect(enc.s).toBe(P256_N - raw.s);
    expect(contractVerify(HASH, enc.signature, a.x, a.y)).toBe(true);
    expect(normaliseS(enc.s)).toBe(enc.s);
  });

  it("finds responseTypeLocation as a byte offset even when other members come first", () => {
    const a = softwareAuthenticator();
    const asr = a.assert(HASH);
    // Simulate a client that orders members differently: {"crossOrigin":false,"type":...}
    const cdj = `{"crossOrigin":false,"type":"webauthn.get","challenge":"${b64urlEncode(hexToBytes(HASH))}","origin":"${ORIGIN}"}`;
    const clientDataJSON = utf8.encode(cdj);
    const messageHash = nobleSha256(concatBytes(asr.authenticatorData, nobleSha256(clientDataJSON)));
    const sig = p256.Signature.fromBytes(p256.sign(messageHash, a.secretKey, { prehash: false }), "compact");
    const enc = encodeWebAuthnSignature({
      keyId: KEY_ID,
      challenge: HASH,
      authenticatorData: asr.authenticatorData,
      clientDataJSON,
      derSignature: sig.toBytes("der"),
    });
    expect(enc.responseTypeLocation).toBe(cdj.indexOf('"type":"webauthn.get"'));
    expect(contractVerify(HASH, enc.signature, a.x, a.y)).toBe(true);
  });

  it("refuses a clientDataJSON whose challenge is not Base64URL(hash)", () => {
    const a = softwareAuthenticator();
    const asr = a.assert(keccak256(toBytes("a different digest")));
    expect(() => encodeWebAuthnSignature({ keyId: KEY_ID, challenge: HASH, ...asr })).toThrow(PasskeyEncodingError);
  });

  it("refuses webauthn.create responses and missing user verification", () => {
    const a = softwareAuthenticator();
    expect(() => encodeWebAuthnSignature({ keyId: KEY_ID, challenge: HASH, ...a.assert(HASH, { type: "webauthn.create" }) })).toThrow(
      /webauthn.get/,
    );
    expect(() => encodeWebAuthnSignature({ keyId: KEY_ID, challenge: HASH, ...a.assert(HASH, { flags: 0x01 }) })).toThrow(/verify the user/);
    // With requireUserVerification false, UP alone is enough (and the contract agrees).
    const enc = encodeWebAuthnSignature({ keyId: KEY_ID, challenge: HASH, requireUserVerification: false, ...a.assert(HASH, { flags: 0x01 }) });
    expect(contractVerify(HASH, enc.signature, a.x, a.y)).toBe(true);
  });

  it("the contract re-implementation rejects tampering", () => {
    const a = softwareAuthenticator();
    const enc = encodeWebAuthnSignature({ keyId: KEY_ID, challenge: HASH, ...a.assert(HASH) });
    const d = decodeWebAuthnSignature(enc.signature);
    expect(contractMessage(HASH, { ...d, responseTypeLocation: 2 }).ok).toBe(false);
    expect(contractMessage(HASH, { ...d, s: P256_N - d.s }).ok).toBe(false);
    expect(contractMessage(HASH, { ...d, requireUserVerification: true, authenticatorData: Uint8Array.from(d.authenticatorData, (b, i) => (i === 32 ? 0x01 : b)) }).ok).toBe(false);
  });

  it("WebCrypto pre-flight verification agrees with the contract re-implementation", async () => {
    const a = softwareAuthenticator();
    const enc = encodeWebAuthnSignature({ keyId: KEY_ID, challenge: HASH, ...a.assert(HASH) });
    expect(await verifyWebAuthnSignature(HASH, enc.signature, a.x, a.y)).toBe(true);
    expect(await verifyWebAuthnSignature(keccak256(toBytes("x")), enc.signature, a.x, a.y)).toBe(false);
  });
});

/* ------------------------------------------------------------------ registration */

function cborHead(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  return [(major << 5) | 25, n >> 8, n & 255];
}
function cbor(v: unknown): number[] {
  if (typeof v === "number") return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === "string") {
    const b = Array.from(utf8.encode(v));
    return [...cborHead(3, b.length), ...b];
  }
  if (v instanceof Uint8Array) return [...cborHead(2, v.length), ...Array.from(v)];
  if (v instanceof Map) {
    const out = cborHead(5, v.size);
    for (const [k, val] of v) out.push(...cbor(k), ...cbor(val));
    return out;
  }
  throw new Error("unsupported");
}

describe("passkey registration: public key extraction", () => {
  it("reads x and y from the COSE key inside attestationObject.authData", () => {
    const a = softwareAuthenticator();
    const credentialId = toBytes("credential-id-0001");
    const cose = new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, hexToBytes(a.x)],
      [-3, hexToBytes(a.y)],
    ]);
    const authData = concatBytes(
      nobleSha256(utf8.encode(RP_ID)),
      new Uint8Array([0x45]), // UP | UV | AT
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array(16),
      new Uint8Array([0, credentialId.length]),
      credentialId,
      Uint8Array.from(cbor(cose)),
    );
    const attObj = Uint8Array.from(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])));
    const [decoded] = decodeCbor(attObj);
    expect(decoded).toBeInstanceOf(Map);
    const k = publicKeyFromAttestation(attObj);
    expect(k.x).toBe(a.x);
    expect(k.y).toBe(a.y);
    expect(bytesToHex(k.credentialId)).toBe(bytesToHex(credentialId));
  });

  it("reads x and y from an SPKI (getPublicKey) and rejects non-P-256 COSE keys", () => {
    const a = softwareAuthenticator();
    const spkiPrefix = hexToBytes("3059301306072a8648ce3d020106082a8648ce3d030107034200");
    const spki = concatBytes(spkiPrefix, new Uint8Array([0x04]), hexToBytes(a.x), hexToBytes(a.y));
    expect(publicKeyFromSpki(spki)).toEqual({ x: a.x, y: a.y });
    const ed = new Map<number, unknown>([
      [1, 1],
      [3, -8],
      [-1, 6],
      [-2, new Uint8Array(32)],
    ]);
    const authData = concatBytes(new Uint8Array(32), new Uint8Array([0x45]), new Uint8Array(4), new Uint8Array(16), new Uint8Array([0, 1]), new Uint8Array([9]), Uint8Array.from(cbor(ed)));
    const attObj = Uint8Array.from(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])));
    expect(() => publicKeyFromAttestation(attObj)).toThrow(/P-256/);
  });
});

/* ------------------------------------------------------------------ RP ID and the browser ceremony */

describe("RP ID", () => {
  it("uses the registrable domain under yinglong-agent.tech and the hostname elsewhere", () => {
    expect(rpIdFor("app.yinglong-agent.tech")).toBe("yinglong-agent.tech");
    expect(rpIdFor("yinglong-agent.tech")).toBe("yinglong-agent.tech");
    expect(rpIdFor("API.Yinglong-Agent.Tech")).toBe("yinglong-agent.tech");
    expect(rpIdFor("localhost")).toBe("localhost");
    expect(rpIdFor("notyinglong-agent.tech")).toBe("notyinglong-agent.tech");
  });
});

describe("signHash with a mocked navigator.credentials", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes the raw 32-byte hash as the challenge and returns a contract-valid signature", async () => {
    const a = softwareAuthenticator();
    const get = vi.fn(async (opts: CredentialRequestOptions) => {
      const pk = opts.publicKey!;
      const challenge = bytesToHex(new Uint8Array(pk.challenge as ArrayBuffer));
      expect(challenge).toBe(HASH);
      expect(pk.rpId).toBe("yinglong-agent.tech");
      expect(pk.userVerification).toBe("required");
      const asr = a.assert(challenge);
      return {
        id: KEY_ID,
        response: {
          authenticatorData: asr.authenticatorData.buffer,
          clientDataJSON: asr.clientDataJSON.buffer,
          signature: asr.derSignature.buffer,
        },
      };
    });
    vi.stubGlobal("navigator", { credentials: { get } });
    vi.stubGlobal("window", { location: { hostname: "app.yinglong-agent.tech" } });
    const enc = await signHash(HASH, { keyIds: [KEY_ID] });
    expect(get).toHaveBeenCalledOnce();
    expect(enc.keyIdHash).toBe(keyIdHash(KEY_ID));
    expect(contractVerify(HASH, enc.signature, a.x, a.y)).toBe(true);
  });
});
