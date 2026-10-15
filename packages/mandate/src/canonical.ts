import { keccak256, stringToBytes, type Hex } from "viem";

/**
 * Canonical JSON: object keys sorted by UTF-16 code units, no whitespace, strings as JSON.stringify emits
 * them (non-ASCII kept as UTF-8). Integers only (amounts are strings). The Python twin is
 * json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`canonical JSON allows safe integers only, got ${value}`);
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") throw new Error("bigint must be encoded as a decimal string");
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new Error(`unsupported value in canonical JSON: ${typeof value}`);
}

export function canonicalHash(value: unknown): Hex {
  return keccak256(stringToBytes(canonicalJson(value)));
}

export function textHash(s: string): Hex {
  return keccak256(stringToBytes(s));
}
