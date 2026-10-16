/**
 * Formatting for amounts, hashes and times. Amounts are bigint base units end to end; nothing here
 * ever converts money to a float (CLAUDE.md rule 4).
 */
import type { Amount, Ledger, Jurisdiction, Tier } from "./api/view";

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

/** "9500000000", 6 decimals, 2 fraction digits -> "9,500.00" (truncates, never rounds up). */
export function formatUnits(value: string | bigint, decimals: number, fractionDigits = 2): string {
  const v = typeof value === "bigint" ? value : BigInt(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let fracStr = decimals > 0 ? frac.toString().padStart(decimals, "0") : "";
  fracStr = fractionDigits >= decimals ? fracStr.padEnd(fractionDigits, "0") : fracStr.slice(0, fractionDigits);
  const wholeStr = whole.toString().replace(GROUP, ",");
  return `${neg ? "-" : ""}${wholeStr}${fractionDigits > 0 ? `.${fracStr}` : ""}`;
}

export function formatAmount(a: Amount, opts: { symbol?: boolean; fractionDigits?: number } = {}): string {
  const n = formatUnits(a.value, a.decimals, opts.fractionDigits ?? 2);
  return opts.symbol === false ? n : `${n} ${a.symbol}`;
}

/** Parses a user-typed decimal ("3,000.50") into base units; returns null when invalid. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const t = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  return BigInt(w!) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0");
}

export function remaining(cap: Amount, spent: Amount): bigint {
  const r = BigInt(cap.value) - BigInt(spent.value);
  return r < 0n ? 0n : r;
}

export function shortHash(hash: string | null | undefined, head = 6, tail = 4): string {
  if (!hash) return "";
  if (hash.length <= head + tail + 2) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

const TZ = "Asia/Hong_Kong";

/** "16 Oct 2026, 02:13" in Hong Kong time (the demo's home time zone), English only. */
export function formatTime(iso: string, opts: { seconds?: boolean; date?: boolean } = {}): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: opts.seconds ? "2-digit" : undefined,
    hour12: false,
    timeZone: TZ,
  }).format(d);
  return opts.date === false ? time : `${date}, ${time}`;
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: TZ }).format(new Date(iso));
}

export const LEDGER_LABEL: Record<Ledger, string> = {
  "base-sepolia": "Base Sepolia (testnet)",
  fisco: "FISCO BCOS (consortium)",
  "anvil-bench": "Bench (Anvil fork)",
};

export const LEDGER_SHORT: Record<Ledger, string> = {
  "base-sepolia": "Base Sepolia",
  fisco: "FISCO BCOS",
  "anvil-bench": "Anvil fork",
};

export const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  hk: "Hong Kong",
  international: "International",
  mainland: "Mainland",
};

export const RAIL_LABEL: Record<Jurisdiction, string> = {
  hk: "HK test rail · test units on Base Sepolia",
  international: "International test rail · testnet assets, no monetary value",
  mainland: "Coin-free rail · FISCO BCOS · e-CNY-style simulator",
};

/** The rail a principal actually runs on: its ledger badge from the service wins over the jurisdiction default. */
export function railLabel(j: Jurisdiction, ledgerBadge?: string | null): string {
  return ledgerBadge ? `${JURISDICTION_LABEL[j]} · test units on ${ledgerBadge}` : RAIL_LABEL[j];
}

export const TIER_LABEL: Record<Tier, string> = {
  T0: "Observe",
  T1: "Act",
  T2: "Confirm",
  T3: "Reserved",
  T4: "Refuse",
  ASK: "Ask",
};

export const TIER_WHO: Record<Tier, string> = {
  T0: "Ying, read only",
  T1: "Ying alone, you are notified",
  T2: "You approve with a passkey",
  T3: "Only your own account",
  T4: "Nobody, ever",
  ASK: "Ying stops and asks",
};
