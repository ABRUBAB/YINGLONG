import { resolve } from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import type { LedgerName } from "@yinglong/sdk";

/**
 * How an x402 ERC-7710 payment is settled.
 *  - seller: the service agent's own wallet is the leaf delegate and submits redeemDelegations itself
 *    ("seller-settled", default);
 *  - yinglong-facilitator: the leaf delegate is YINGLONG's `facilitator` role (still submitted by this
 *    process). Use this when the payer's root mandate pins that facilitator in AgentLineageEnforcer;
 *  - metamask-facilitator: Base Sepolia only. The leaf delegate is MetaMask's facilitator signer and
 *    settlement goes through its /verify and /settle API; the service still waits for the receipt itself.
 */
export type SettlementMode = "seller" | "yinglong-facilitator" | "metamask-facilitator";

export interface ServicesConfig {
  ledger: LedgerName;
  rpcUrl?: string;
  port: number;
  host: string;
  /** Base URL other agents use to reach this process (agent cards, jku, registration files). */
  publicUrl: string;
  settlement: SettlementMode;
  /** x402 fee asset: a deployment contract name or an address (USDC on Base Sepolia). */
  feeAsset: "TestUSD" | "TestHKD" | "USDC" | Address;
  fxFee: bigint;
  kybFee: bigint;
  mirageFee: bigint;
  /** Max delegation window the seller accepts on the x402 child (TimestampEnforcer), seconds. */
  maxChildWindowSeconds: number;
  quoteTtlSeconds: number;
  settleTimeoutMs: number;
  facilitatorUrl: string;
  facilitatorAddress: Address;
  adminToken?: string;
  stateDir: string;
  /** Keep FX liquidity topped up from the test-unit minter (test ledgers only). */
  liquidityKeeper: boolean;
  liquidityTarget: { tHKD: bigint; tUSD: bigint };
}

export const BASE_SEPOLIA_USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// MetaMask x402 facilitator (dev-api host) and its signer, verified live on 15 Oct 2026 (plan section 9.2).
export const METAMASK_FACILITATOR_URL = "https://tx-sentinel-base-sepolia.dev-api.cx.metamask.io/platform/v2/x402";
export const METAMASK_FACILITATOR_SIGNER: Address = "0xb4827A2a066CD2Ef88560EFdf063dD05C6c41cC7";

const appRoot = resolve(import.meta.dirname, "..");

function int(v: string | undefined, d: number): number {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`expected a non-negative integer, got ${v}`);
  return n;
}

function units(v: string | undefined, d: bigint): bigint {
  if (v === undefined || v === "") return d;
  if (!/^\d+$/.test(v)) throw new Error(`expected base units (integer), got ${v}`);
  return BigInt(v);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServicesConfig {
  const ledger = (env.LEDGER ?? env.SERVICES_LEDGER ?? "anvil") as LedgerName;
  if (!["anvil", "base-sepolia", "fisco"].includes(ledger)) throw new Error(`unknown LEDGER ${ledger}`);
  const port = int(env.SERVICES_PORT ?? env.PORT, 8790);
  const settlement = (env.X402_SETTLEMENT ?? "seller") as SettlementMode;
  if (!["seller", "yinglong-facilitator", "metamask-facilitator"].includes(settlement)) throw new Error(`unknown X402_SETTLEMENT ${settlement}`);
  if (settlement === "metamask-facilitator" && ledger !== "base-sepolia") throw new Error("metamask-facilitator settlement is Base Sepolia only");
  const rawAsset = env.X402_ASSET ?? "TestUSD";
  let feeAsset: ServicesConfig["feeAsset"];
  if (rawAsset === "TestUSD" || rawAsset === "TestHKD" || rawAsset === "USDC") feeAsset = rawAsset;
  else if (isAddress(rawAsset)) feeAsset = getAddress(rawAsset);
  else throw new Error(`X402_ASSET must be TestUSD, TestHKD, USDC or an address, got ${rawAsset}`);
  if (feeAsset === "USDC" && ledger !== "base-sepolia") throw new Error("X402_ASSET=USDC is Base Sepolia only");
  return {
    ledger,
    rpcUrl: env.RPC_URL || undefined,
    port,
    host: env.SERVICES_HOST ?? "127.0.0.1",
    publicUrl: (env.SERVICES_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
    settlement,
    feeAsset,
    fxFee: units(env.X402_FX_FEE, 250_000n), // 0.25 test units (6 decimals)
    kybFee: units(env.X402_KYB_FEE, 1_000_000n), // 1 test unit
    mirageFee: units(env.X402_MIRAGE_FEE, 100_000n), // 0.10 test units: the lure
    maxChildWindowSeconds: int(env.X402_MAX_CHILD_WINDOW, 300),
    quoteTtlSeconds: int(env.QUOTE_TTL_SECONDS, 600),
    settleTimeoutMs: int(env.X402_SETTLE_TIMEOUT_MS, 60_000),
    facilitatorUrl: (env.X402_FACILITATOR_URL ?? METAMASK_FACILITATOR_URL).replace(/\/+$/, ""),
    facilitatorAddress: getAddress(env.X402_FACILITATOR_ADDRESS ?? METAMASK_FACILITATOR_SIGNER),
    adminToken: env.SERVICES_ADMIN_TOKEN || undefined,
    stateDir: resolve(env.SERVICES_STATE_DIR ?? resolve(appRoot, "state")),
    liquidityKeeper: (env.LIQUIDITY_KEEPER ?? "1") !== "0",
    liquidityTarget: {
      tHKD: units(env.LIQUIDITY_TARGET_THKD, 500_000_000_000n), // 500,000 tHKD
      tUSD: units(env.LIQUIDITY_TARGET_TUSD, 50_000_000_000n), // 50,000 tUSD
    },
  };
}
