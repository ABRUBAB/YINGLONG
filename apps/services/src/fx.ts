// FX desks: a fixed demo rate table (integers only), SignedQuoteSettlement EIP-712 quotes signed by the desk
// key, and a liquidity keeper that tops up desk liquidity from the test-unit minter on test ledgers.
import { randomBytes } from "node:crypto";
import { encodeAbiParameters, erc20Abi, maxUint256, type Address, type Hex } from "viem";
import { sign } from "viem/accounts";
import { abi } from "@yinglong/sdk";
import { rolePrivateKey, type Role } from "@yinglong/sdk/server";
import type { Ledger } from "./chain";

export type Pair = "tUSD/tHKD" | "tHKD/tUSD";

export interface Rate {
  numerator: bigint;
  denominator: bigint;
  display: string;
}

/** Demo rates (base units in, base units out; both tokens have 6 decimals). Not market prices. */
export const RATE_TABLE: Record<string, Record<Pair, Rate>> = {
  "pearl-river-fx": {
    "tUSD/tHKD": { numerator: 781n, denominator: 100n, display: "1 tUSD = 7.81 tHKD" },
    "tHKD/tUSD": { numerator: 1279n, denominator: 10_000n, display: "1 tHKD = 0.1279 tUSD" },
  },
  "victoria-fx": {
    "tUSD/tHKD": { numerator: 779n, denominator: 100n, display: "1 tUSD = 7.79 tHKD" },
    "tHKD/tUSD": { numerator: 1281n, denominator: 10_000n, display: "1 tHKD = 0.1281 tUSD" },
  },
  // Mirage (fictional rogue test agent): an unattested desk; its quotes must be refused at the counterparty check.
  mirage: {
    "tUSD/tHKD": { numerator: 820n, denominator: 100n, display: "1 tUSD = 8.20 tHKD" },
    "tHKD/tUSD": { numerator: 1350n, denominator: 10_000n, display: "1 tHKD = 0.1350 tUSD" },
  },
};

export const MAX_AMOUNT_IN = 10_000_000_000_000n; // 10,000,000 units with 6 decimals

export function pairOf(ledger: Ledger, inToken: Address, outToken: Address): Pair | undefined {
  const usd = ledger.addr("TestUSD").toLowerCase();
  const hkd = ledger.addr("TestHKD").toLowerCase();
  const i = inToken.toLowerCase();
  const o = outToken.toLowerCase();
  if (i === usd && o === hkd) return "tUSD/tHKD";
  if (i === hkd && o === usd) return "tHKD/tUSD";
  return undefined;
}

export function resolveToken(ledger: Ledger, t: string): Address | undefined {
  const s = t.trim();
  if (/^tusd$/i.test(s)) return ledger.addr("TestUSD");
  if (/^thkd$/i.test(s)) return ledger.addr("TestHKD");
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s as Address;
  return undefined;
}

export interface Quote {
  desk: Address;
  payer: Address;
  inToken: Address;
  outToken: Address;
  amountIn: bigint;
  amountOut: bigint;
  expiry: bigint;
  nonce: bigint;
}

const QUOTE_COMPONENTS = [
  { name: "desk", type: "address" },
  { name: "payer", type: "address" },
  { name: "inToken", type: "address" },
  { name: "outToken", type: "address" },
  { name: "amountIn", type: "uint256" },
  { name: "amountOut", type: "uint256" },
  { name: "expiry", type: "uint256" },
  { name: "nonce", type: "uint256" },
] as const;

export interface SignedQuote {
  quote: Quote;
  quoteHash: Hex;
  signature: Hex;
  /** `data` for tokenIn.transferAndCall(SignedQuoteSettlement, amountIn, data). */
  transferAndCallData: Hex;
}

export function amountOutFor(rate: Rate, amountIn: bigint): bigint {
  return (amountIn * rate.numerator) / rate.denominator;
}

/**
 * Build and sign a quote. The digest comes from SignedQuoteSettlement.quoteHash (an eth_call), so the EIP-712
 * domain (chain id, salt) is always exactly what the contract checks, on every ledger.
 */
export async function signQuote(ledger: Ledger, deskRole: Role, q: Omit<Quote, "expiry" | "nonce">, ttlSeconds: number): Promise<SignedQuote> {
  const expiry = (await ledger.now()) + ledger.span(ttlSeconds);
  const nonce = BigInt(`0x${randomBytes(24).toString("hex")}`);
  const quote: Quote = { ...q, expiry, nonce };
  const settlement = ledger.addr("SignedQuoteSettlement");
  const quoteHash = await ledger.read<Hex>({ address: settlement, abi: abi.SignedQuoteSettlementAbi, functionName: "quoteHash", args: [quote] });
  const signature = (await sign({ hash: quoteHash, privateKey: rolePrivateKey(deskRole), to: "hex" })) as Hex;
  const transferAndCallData = encodeAbiParameters(
    [{ type: "address" }, { type: "tuple", components: QUOTE_COMPONENTS }, { type: "bytes" }],
    [quote.desk, quote, signature],
  );
  return { quote, quoteHash, signature, transferAndCallData };
}

export function quoteJson(q: Quote) {
  return {
    desk: q.desk,
    payer: q.payer,
    inToken: q.inToken,
    outToken: q.outToken,
    amountIn: q.amountIn.toString(),
    amountOut: q.amountOut.toString(),
    expiry: q.expiry.toString(),
    nonce: q.nonce.toString(),
  };
}

export async function liquidityOf(ledger: Ledger, desk: Address, token: Address): Promise<bigint> {
  return ledger.read<bigint>({ address: ledger.addr("SignedQuoteSettlement"), abi: abi.SignedQuoteSettlementAbi, functionName: "liquidity", args: [desk, token] });
}

/**
 * Keep `target` of `token` deposited for the desk in SignedQuoteSettlement. Tops up when below half the
 * target, minting from the test-unit minter (the deployer role) when the desk's own balance is short.
 * Returns the transactions sent. Test ledgers only: refuses if the token's minter is not the deployer.
 */
export async function ensureLiquidity(ledger: Ledger, deskRole: Role, token: Address, target: bigint): Promise<{ deposited: bigint; txs: Hex[] }> {
  const desk = ledger.roleAddress(deskRole);
  const settlement = ledger.addr("SignedQuoteSettlement");
  const current = await liquidityOf(ledger, desk, token);
  if (current * 2n >= target) return { deposited: 0n, txs: [] };
  const need = target - current;
  const txs: Hex[] = [];
  await ledger.ensureGas(desk);
  const balance = await ledger.read<bigint>({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [desk] });
  if (balance < need) {
    const minter = await ledger.read<Address>({ address: token, abi: abi.TestUnitsAbi, functionName: "minter" });
    if (minter.toLowerCase() !== ledger.roleAddress("deployer").toLowerCase()) throw new Error(`cannot top up ${token}: minter is not the deployer role`);
    await ledger.ensureGas(minter);
    txs.push((await ledger.write("deployer", { address: token, abi: abi.TestUnitsAbi, functionName: "mint", args: [desk, need - balance] })).hash);
  }
  const allowance = await ledger.read<bigint>({ address: token, abi: erc20Abi, functionName: "allowance", args: [desk, settlement] });
  if (allowance < need) txs.push((await ledger.write(deskRole, { address: token, abi: erc20Abi, functionName: "approve", args: [settlement, maxUint256] })).hash);
  txs.push((await ledger.write(deskRole, { address: settlement, abi: abi.SignedQuoteSettlementAbi, functionName: "depositLiquidity", args: [token, need] })).hash);
  return { deposited: need, txs };
}
