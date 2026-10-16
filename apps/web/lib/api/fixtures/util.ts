/**
 * Sample-data helpers. Every hash below is keccak256 of a readable label, so sample values are
 * deterministic, obviously synthetic on inspection, and never confused with evidence.
 */
import { getAddress, keccak256, toHex, type Hex } from "viem";
import { parseUnits } from "../../format";
import type { Amount, TxRef } from "../view";

export const h = (label: string): Hex => keccak256(toHex(`yinglong-sample:${label}`));
export const addr = (label: string): Hex => getAddress(`0x${h(`addr:${label}`).slice(26)}`) as Hex;

export const THKD = { decimals: 6, symbol: "tHKD" } as const;
export const USDC = { decimals: 6, symbol: "USDC (testnet)" } as const;
export const CNYT = { decimals: 2, symbol: "CNY test units" } as const;

export function amt(major: string, unit: { decimals: number; symbol: string }): Amount {
  const v = parseUnits(major, unit.decimals);
  if (v === null) throw new Error(`bad sample amount ${major}`);
  return { value: v.toString(), decimals: unit.decimals, symbol: unit.symbol };
}

/** Fixed clock for sample data: 16 Oct 2026, 09:20 in Hong Kong. Screenshots stay identical. */
export const NOW = Date.parse("2026-10-16T01:20:00Z");
export const at = (iso: string) => new Date(Date.parse(iso)).toISOString();
export const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
export const daysAgo = (d: number, hhmm = "00:00") => {
  const [hh, mm] = hhmm.split(":").map(Number);
  const base = new Date(NOW - d * 86_400_000);
  // hh:mm is Hong Kong time (UTC+8)
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), (hh ?? 0) - 8, mm ?? 0)).toISOString();
};

let block = 31_884_210;
export function baseTx(label: string): TxRef {
  block += 37;
  return { ledger: "base-sepolia", chainId: 84532, txHash: h(`tx:base:${label}`), blockNumber: block };
}
let fblock = 1_204_551;
export function fiscoTx(label: string): TxRef {
  fblock += 11;
  return { ledger: "fisco", chainId: 0, txHash: h(`tx:fisco:${label}`), blockNumber: fblock };
}
