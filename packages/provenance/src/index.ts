import { createHash, randomBytes } from "node:crypto";

/**
 * Provenance for every value the agent handles (CaMeL-style privileged planner + quarantined readers).
 * Untrusted bytes (emails, invoices, 402 descriptions, agent cards, memory) never reach the planner's prompt:
 * readers return a closed schema of enums, numbers, verified ids and OPAQUE HANDLES, each value tagged with
 * its source and taint. The planner can refer to a handle but cannot read what is behind it.
 */
export type Source =
  | "user"
  | "mandate"
  | "payee-book"
  | "chain"
  | "agent"
  | "untrusted:email"
  | "untrusted:invoice"
  | "untrusted:x402"
  | "untrusted:agent-card"
  | "untrusted:chat"
  | "memory";

export interface Tagged<T> {
  value: T;
  source: Source;
  tainted: boolean;
  /** Hash of the reader model and prompt that produced the value, when a model produced it. */
  reader?: string;
}

export function tag<T>(value: T, source: Source, reader?: string): Tagged<T> {
  return { value, source, tainted: source.startsWith("untrusted:") || source === "memory", reader };
}

export function isTainted(...values: Tagged<unknown>[]): boolean {
  return values.some((v) => v.tainted);
}

/** Opaque handle store: raw untrusted text lives here, addressable by a handle the planner may mention. */
export class HandleStore {
  private raw = new Map<string, { text: string; source: Source }>();

  put(text: string, source: Source): string {
    const handle = `h_${randomBytes(6).toString("hex")}`;
    this.raw.set(handle, { text, source });
    return handle;
  }

  /** Only quarantined readers and the display layer may resolve handles; never the planner. */
  resolve(handle: string): { text: string; source: Source } | undefined {
    return this.raw.get(handle);
  }

  /**
   * Guard for every planner prompt: throws if any quarantined text (or a long substring of it) appears in
   * the prompt. Unit tests snapshot this property for every bench family.
   */
  assertClean(prompt: string, minOverlap = 24): void {
    for (const [handle, { text }] of this.raw) {
      const t = text.trim();
      if (!t) continue;
      if (t.length <= minOverlap ? prompt.includes(t) : slidingContains(prompt, t, minOverlap)) {
        throw new Error(`quarantined text from ${handle} reached a planner prompt`);
      }
    }
  }
}

function slidingContains(haystack: string, needle: string, window: number): boolean {
  for (let i = 0; i + window <= needle.length; i += Math.max(1, Math.floor(window / 2))) {
    if (haystack.includes(needle.slice(i, i + window))) return true;
  }
  return false;
}

/** SHA-256 hex of a string (used to pin prompts, schemas and models into a fail-closed registry). */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
