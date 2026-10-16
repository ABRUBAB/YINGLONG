// Small helpers shared by scripts/finalize and its evidence readers. Numbers in docs come only from these readers.
import { execFileSync, spawnSync, type SpawnSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export function sh(cmd: string, a: string[], cwd: string): string {
  try {
    return execFileSync(cmd, a, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? "");
  }
}

/** Run a command, never throw; returns status, stdout, stderr and wall time. */
export function run(cmd: string, a: string[], opts: SpawnSyncOptions & { cwd: string }) {
  const t0 = Date.now();
  const r = spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, shell: process.platform === "win32", ...opts });
  return { status: r.status, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), ms: Date.now() - t0, error: r.error?.message };
}

export function readJson<T = unknown>(path: string): T | undefined {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
  } catch {
    return undefined;
  }
}

export const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** Integer with thousands separators (no floats involved). */
export const int = (n: number | bigint | string) => BigInt(n).toLocaleString("en-US");

/** Seconds from integer milliseconds, three decimals, without floating-point formatting surprises. */
export function secs(ms: number): string {
  const m = Math.round(ms);
  return `${Math.floor(m / 1000)}.${String(m % 1000).padStart(3, "0")}`;
}

export const pct = (x: number, digits = 1) => `${(100 * x).toFixed(digits)}%`;

/** Wilson score interval (95%) for k successes in n trials. */
export function wilson(k: number, n: number, z = 1.959964): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function rate(k: number, n: number): string {
  const [lo, hi] = wilson(k, n);
  return `${k}/${n} = ${pct(k / n)} (Wilson 95% interval ${pct(lo)} to ${pct(hi)}, n = ${n})`;
}

/** Nearest-rank percentile of integers. */
export function quantile(xs: number[], p: number): number | undefined {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return undefined;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export const short = (h: string) => `\`${h.slice(0, 12)}...\``;

/** Escape a cell for a Markdown table. */
export const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function table(head: string[], rows: unknown[][]): string {
  const nl = String.fromCharCode(10);
  return [nl, `| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`), ""].join(nl);
}

// The repository is English only (CLAUDE.md rule 1): any generated text that would carry characters from the
// forbidden ranges (for example a third-party package description) has them replaced. Built from code points so this
// file stays plain ASCII.
const cp = (n: number) => String.fromCodePoint(n);
const FORBIDDEN = new RegExp(`[${cp(0x3000)}-${cp(0x303f)}${cp(0x3400)}-${cp(0x4dbf)}${cp(0x4e00)}-${cp(0x9fff)}${cp(0xff00)}-${cp(0xffef)}]`, "gu");
export function englishOnly(s: string): { text: string; replaced: number } {
  let replaced = 0;
  const text = s.replace(FORBIDDEN, () => {
    replaced++;
    return "?";
  });
  return { text, replaced };
}
