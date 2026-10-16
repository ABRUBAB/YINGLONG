import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** JSON with bigint support: bigints are stored as {"$n": "123"}. */
export function toJson(v: unknown, space?: number): string {
  return JSON.stringify(v, (_, x) => (typeof x === "bigint" ? { $n: x.toString() } : x), space);
}
export function fromJson<T>(s: string): T {
  return JSON.parse(s, (_, x) => (x && typeof x === "object" && typeof x.$n === "string" && Object.keys(x).length === 1 ? BigInt(x.$n) : x)) as T;
}
/** Plain JSON for the API: bigints become decimal strings. */
export function apiJson(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

export const DATA_DIR = process.env.AGENT_DATA_DIR ?? resolve(import.meta.dirname, "..", "data");

/** A small durable key-value document store (atomic file replace) plus an append-only JSONL log. */
export class DocStore<T extends object> {
  private cache: T;
  constructor(
    private readonly file: string,
    initial: T,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.cache = existsSync(file) ? fromJson<T>(readFileSync(file, "utf8")) : initial;
  }
  get(): T {
    return this.cache;
  }
  update(fn: (d: T) => void): T {
    fn(this.cache);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, toJson(this.cache, 2));
    renameSync(tmp, this.file);
    return this.cache;
  }
}

export class JsonlLog<T> {
  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  append(row: T): void {
    appendFileSync(this.file, `${toJson(row)}\n`);
  }
  all(): T[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => fromJson<T>(l));
  }
}
