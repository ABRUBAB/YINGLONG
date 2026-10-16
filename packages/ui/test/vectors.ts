import { keccak_256 } from "@noble/hashes/sha3.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

export function toHex(b: Uint8Array): string {
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** The three fixed golden inputs (docs/HASH_RING.md, section "Golden vectors"). */
export const GOLDEN_VECTORS = [
  { name: "zero", H: `0x${"00".repeat(32)}`, revoked: false },
  { name: "ones", H: `0x${"ff".repeat(32)}`, revoked: false },
  {
    name: "phrase",
    H: toHex(keccak_256(utf8ToBytes("YINGLONG Hash Ring golden vector 3"))),
    revoked: false,
  },
  {
    name: "phrase-revoked",
    H: toHex(keccak_256(utf8ToBytes("YINGLONG Hash Ring golden vector 3"))),
    revoked: true,
  },
] as const;
