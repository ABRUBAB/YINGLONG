/** SPKI parsing for getPublicKey(): P-256 only, uncompressed, well-formed DER. */
import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { bytesToHex, concatBytes, hexToBytes } from "./bytes";
import { parseP256Spki, SpkiError } from "./spki";
import { publicKeyFromSpki } from "./cose";
import { p256Spki } from "../testing/fake-authenticator";

describe("parseP256Spki", () => {
  it("reads x and y from a WebCrypto-exported P-256 SPKI", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const k = parseP256Spki(spki);
    expect(k.x).toBe(bytesToHex(raw.slice(1, 33)));
    expect(k.y).toBe(bytesToHex(raw.slice(33, 65)));
    expect(publicKeyFromSpki(spki)).toEqual(k);
  });

  it("matches the point for 20 fresh noble keys", () => {
    for (let i = 0; i < 20; i++) {
      const point = p256.getPublicKey(p256.utils.randomSecretKey(), false);
      expect(parseP256Spki(p256Spki(point))).toEqual({ x: bytesToHex(point.slice(1, 33)), y: bytesToHex(point.slice(33)) });
    }
  });

  it("refuses other curves, other algorithms, compressed points and malformed DER", () => {
    const point = p256.getPublicKey(p256.utils.randomSecretKey(), false);
    const good = p256Spki(point);
    // P-384 curve OID (1.3.132.0.34) in place of prime256v1: lengths change, so build it explicitly.
    const p384 = hexToBytes("3076301006072a8648ce3d020106052b81040022036200");
    expect(() => parseP256Spki(concatBytes(p384, new Uint8Array([0x04]), new Uint8Array(96).fill(7)))).toThrow(SpkiError);
    // Ed25519 SPKI.
    expect(() => parseP256Spki(hexToBytes(`302a300506032b6570032100${"11".repeat(32)}`))).toThrow(/elliptic-curve/);
    // Compressed point: 0x02 || x, BIT STRING of 34 bytes.
    const compressed = concatBytes(hexToBytes("3039301306072a8648ce3d020106082a8648ce3d030107032200"), p256.getPublicKey(p256.utils.randomSecretKey(), true));
    expect(() => parseP256Spki(compressed)).toThrow(/65-byte uncompressed/);
    // Truncated and trailing bytes.
    expect(() => parseP256Spki(good.slice(0, good.length - 1))).toThrow(/truncated|SEQUENCE/);
    expect(() => parseP256Spki(concatBytes(good, new Uint8Array([0])))).toThrow(/SEQUENCE/);
    // A point prefix other than 0x04.
    const bad = good.slice();
    bad[26] = 0x05; // 26-byte header, then 0x04 || x || y
    expect(() => parseP256Spki(bad)).toThrow(/compressed/);
  });
});
