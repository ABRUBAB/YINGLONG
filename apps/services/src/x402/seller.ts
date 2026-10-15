// Seller side of x402 v2 (HTTP transport) with the `exact` scheme and the `erc7710` asset-transfer method.
// Flow (default `authorization` flow): verify (structure + simulation) -> produce the resource (kept back)
// -> settle (redeemDelegations, wait for the receipt, check the Transfer event) -> respond. Nothing is
// delivered before a successful settle; `settlement_pending` means unpaid.
import type { Context } from "hono";
import { erc20Abi, getAddress, keccak256, parseEventLogs, type Address, type Hex } from "viem";
import type { Role } from "@yinglong/sdk/server";
import type { Ledger } from "../chain";
import type { ServicesConfig } from "../config";
import type { SettlementLog } from "../state";
import {
  checkX402Child,
  erc20TransferAmountTerms,
  limitedCallsTerms,
  redeemCall,
  simulateRedemption,
  transferExecution,
} from "./erc7710";
import { facilitatorSettle, facilitatorVerify } from "./facilitator";
import {
  decodeX402Header,
  encodeX402Header,
  Erc7710PayloadSchema,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  PaymentPayloadSchema,
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type ResourceInfo,
  type SettlementResponse,
  type X402ErrorCode,
} from "./types";

export interface FeeAsset {
  address: Address;
  symbol: string;
  name: string;
  version: string;
  decimals: number;
}

export interface SellerContext {
  config: ServicesConfig;
  ledger: Ledger;
  settlements: SettlementLog;
  feeAsset: FeeAsset;
}

export interface Offer {
  /** Service slug (for the settlement log). */
  service: string;
  payTo: Address;
  amount: bigint;
  resource: ResourceInfo;
  /** Role that submits redeemDelegations (seller and yinglong-facilitator modes). */
  redeemerRole: Role;
  /** Leaf delegate the payer must name. */
  redeemer: Address;
  /** Extra scheme-specific keys (Mirage abuses this with an injected memo). */
  extra?: Record<string, unknown>;
}

export interface PaymentInfo {
  transaction: Hex;
  network: string;
  payer: Address;
  amount: string;
  asset: Address;
  payTo: Address;
  contextHash: Hex;
  blockNumber: string;
  explorer?: string;
}

export interface ProduceResult {
  body: Record<string, unknown>;
}

const lower = (a: string) => a.toLowerCase();

export function paymentRequirements(ctx: SellerContext, offer: Offer): PaymentRequirements {
  const l = ctx.ledger;
  return {
    scheme: "exact",
    network: l.network,
    amount: offer.amount.toString(),
    asset: ctx.feeAsset.address,
    payTo: offer.payTo,
    maxTimeoutSeconds: ctx.config.maxChildWindowSeconds,
    extra: {
      assetTransferMethod: "erc7710",
      name: ctx.feeAsset.name,
      version: ctx.feeAsset.version,
      // YINGLONG scheme-specific hints (not protocol-reserved keys):
      delegationManager: l.addr("DelegationManager"),
      redeemer: offer.redeemer,
      settlement: ctx.config.settlement,
      childCaveats: {
        erc20TransferAmount: { enforcer: l.addr("ERC20TransferAmountEnforcer"), terms: erc20TransferAmountTerms(ctx.feeAsset.address, offer.amount) },
        limitedCalls: { enforcer: l.addr("LimitedCallsEnforcer"), terms: limitedCallsTerms(1n) },
        timestamp: { enforcer: l.addr("TimestampEnforcer"), maxWindowSeconds: ctx.config.maxChildWindowSeconds, timeUnit: l.profile.timeUnit },
      },
      ...(offer.extra ?? {}),
    },
  };
}

export function paymentRequired(ctx: SellerContext, offer: Offer, error: string): PaymentRequired {
  return { x402Version: X402_VERSION, error, resource: offer.resource, accepts: [paymentRequirements(ctx, offer)], extensions: {} };
}

function respond402(c: Context, ctx: SellerContext, offer: Offer, error: string, failure?: { code: X402ErrorCode; payer?: string; transaction?: string; detail?: unknown }, status: 400 | 402 = 402) {
  const pr = paymentRequired(ctx, offer, error);
  c.header(HEADER_PAYMENT_REQUIRED, encodeX402Header(pr));
  if (failure) {
    const sr: SettlementResponse = {
      success: false,
      errorReason: failure.code,
      transaction: failure.transaction ?? "",
      network: ctx.ledger.network,
      ...(failure.payer ? { payer: failure.payer } : {}),
    };
    c.header(HEADER_PAYMENT_RESPONSE, encodeX402Header(sr));
  }
  c.header("Access-Control-Expose-Headers", `${HEADER_PAYMENT_REQUIRED}, ${HEADER_PAYMENT_RESPONSE}`);
  return c.json({ ...pr, ...(failure ? { errorReason: failure.code, detail: failure.detail } : {}) }, status);
}

function sameRequirements(a: PaymentRequirements, b: PaymentRequirements): string | undefined {
  if (a.scheme !== b.scheme) return "scheme";
  if (a.network !== b.network) return "network";
  if (a.amount !== b.amount) return "amount";
  if (lower(a.asset) !== lower(b.asset)) return "asset";
  if (lower(a.payTo) !== lower(b.payTo)) return "payTo";
  if ((a.extra?.assetTransferMethod ?? "eip3009") !== "erc7710") return "extra.assetTransferMethod";
  return undefined;
}

function codeForMismatch(field: string): X402ErrorCode {
  if (field === "scheme") return "invalid_scheme";
  if (field === "network") return "invalid_network";
  if (field === "amount") return "invalid_exact_evm_payload_authorization_value_mismatch";
  if (field === "payTo") return "invalid_exact_evm_payload_recipient_mismatch";
  return "invalid_payment_requirements";
}

/**
 * Serve an x402-protected resource. `produce` runs after verification and before settlement; its result is
 * only returned once the payment has settled on-chain.
 */
export async function x402Serve(c: Context, ctx: SellerContext, offer: Offer, produce: () => Promise<ProduceResult>): Promise<Response> {
  const header = c.req.header(HEADER_PAYMENT_SIGNATURE);
  if (!header) return respond402(c, ctx, offer, `${HEADER_PAYMENT_SIGNATURE} header is required`);

  // 1. Decode and validate the PaymentPayload.
  let payload: PaymentPayload;
  try {
    payload = PaymentPayloadSchema.parse(decodeX402Header(header));
  } catch {
    return respond402(c, ctx, offer, "malformed payment payload", { code: "invalid_payload" }, 400);
  }
  if (payload.x402Version !== X402_VERSION) return respond402(c, ctx, offer, "x402 version 2 required", { code: "invalid_x402_version" }, 400);
  const want = paymentRequirements(ctx, offer);
  const mismatch = sameRequirements(payload.accepted, want);
  if (mismatch) return respond402(c, ctx, offer, `accepted requirements differ in ${mismatch}`, { code: codeForMismatch(mismatch) });
  const p = Erc7710PayloadSchema.safeParse(payload.payload);
  if (!p.success) return respond402(c, ctx, offer, "payload must be {delegationManager, permissionContext, delegator}", { code: "invalid_payload" }, 400);
  const { delegationManager, permissionContext, delegator } = p.data;
  const payer = getAddress(delegator);
  if (lower(delegationManager) !== lower(ctx.ledger.addr("DelegationManager"))) {
    return respond402(c, ctx, offer, "unknown DelegationManager", { code: "invalid_payload", payer });
  }
  const contextHash = keccak256(permissionContext as Hex);
  if (ctx.settlements.isUsed(contextHash)) {
    return respond402(c, ctx, offer, "this permission context was already settled", { code: "invalid_payload", payer });
  }

  // 2. Structural checks of the single-use, exact-amount child.
  const now = await ctx.ledger.now();
  const check = await checkX402Child(ctx.ledger, permissionContext as Hex, {
    delegator: payer,
    redeemer: offer.redeemer,
    asset: ctx.feeAsset.address,
    amount: offer.amount,
    now,
    maxWindow: ctx.ledger.span(ctx.config.maxChildWindowSeconds),
    slack: ctx.ledger.span(30),
  });
  if (!check.ok) return respond402(c, ctx, offer, check.reason ?? "invalid delegation", { code: check.code ?? "invalid_payload", payer });

  // 3. Funds, then simulation (the sole authoritative verification for ERC-7710).
  const balance = await ctx.ledger.read<bigint>({ address: ctx.feeAsset.address, abi: erc20Abi, functionName: "balanceOf", args: [payer] });
  if (balance < offer.amount) return respond402(c, ctx, offer, "insufficient funds", { code: "insufficient_funds", payer });
  const execution = transferExecution(ctx.feeAsset.address, offer.payTo, offer.amount);
  if (ctx.config.settlement === "metamask-facilitator") {
    const v = await facilitatorVerify(ctx.config, payload, want);
    if (!v.isValid) return respond402(c, ctx, offer, "facilitator rejected the payment", { code: (v.invalidReason as X402ErrorCode) ?? "unexpected_verify_error", payer });
  } else {
    const sim = await simulateRedemption(ctx.ledger, offer.redeemer, permissionContext as Hex, execution);
    if (!sim.ok) {
      return respond402(c, ctx, offer, `redemption would revert: ${sim.revert?.message}`, {
        code: "invalid_transaction_state",
        payer,
        detail: { revert: sim.revert?.name, message: sim.revert?.message },
      });
    }
  }

  // 4. Produce the resource (kept back until the payment settles).
  let produced: ProduceResult;
  try {
    produced = await produce();
  } catch (e) {
    return c.json({ error: "resource_unavailable", detail: String((e as Error).message ?? e) }, 503);
  }

  // 5. Settle.
  if (!ctx.settlements.claim(contextHash)) {
    return respond402(c, ctx, offer, "this permission context is being settled", { code: "invalid_payload", payer });
  }
  let txHash: Hex | undefined;
  try {
    if (ctx.config.settlement === "metamask-facilitator") {
      const s = await facilitatorSettle(ctx.config, payload, want);
      if (!s.success || !s.transaction) {
        ctx.settlements.release(contextHash);
        return respond402(c, ctx, offer, "facilitator settlement failed", { code: (s.errorReason as X402ErrorCode) ?? "unexpected_settle_error", payer, transaction: s.transaction });
      }
      txHash = s.transaction as Hex;
    } else {
      const sim = await simulateRedemption(ctx.ledger, offer.redeemer, permissionContext as Hex, execution);
      const gas = sim.gas ? (sim.gas * 3n) / 2n + 50_000n : 1_500_000n;
      txHash = await ctx.ledger.send(offer.redeemerRole, { ...redeemCall(ctx.ledger, permissionContext as Hex, execution), gas, skipSimulation: true });
    }
  } catch (e) {
    ctx.settlements.release(contextHash);
    return respond402(c, ctx, offer, "settlement could not be broadcast", { code: "unexpected_settle_error", payer, detail: String((e as Error).message ?? e).slice(0, 300) });
  }

  const base = {
    at: new Date().toISOString(),
    service: offer.service,
    network: ctx.ledger.network,
    contextHash,
    transaction: txHash,
    payer,
    payTo: offer.payTo,
    asset: ctx.feeAsset.address,
    amount: offer.amount.toString(),
  };
  let receipt;
  try {
    receipt = (await ctx.ledger.wait(txHash, ctx.config.settleTimeoutMs)).receipt;
  } catch {
    ctx.settlements.record({ ...base, status: "pending" });
    return respond402(c, ctx, offer, "settlement broadcast but not yet confirmed; nothing delivered", {
      code: "settlement_pending",
      payer,
      transaction: txHash,
    });
  }
  const paid =
    receipt.status === "success" &&
    parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).some(
      (l) =>
        lower(l.address) === lower(ctx.feeAsset.address) &&
        lower(l.args.from) === lower(payer) &&
        lower(l.args.to) === lower(offer.payTo) &&
        l.args.value === offer.amount,
    );
  if (!paid) {
    ctx.settlements.record({ ...base, status: "failed" });
    const revert = receipt.status === "success" ? undefined : await ctx.ledger.replayRevert(txHash);
    return respond402(c, ctx, offer, "settlement transaction did not pay the exact amount", {
      code: "invalid_transaction_state",
      payer,
      transaction: txHash,
      detail: revert ? { revert: revert.name, message: revert.message } : undefined,
    });
  }
  ctx.settlements.record({ ...base, status: "settled" });

  // 6. Respond with the resource and the settlement response header.
  const sr: SettlementResponse = { success: true, transaction: txHash, network: ctx.ledger.network, payer, amount: offer.amount.toString() };
  const payment: PaymentInfo = {
    transaction: txHash,
    network: ctx.ledger.network,
    payer,
    amount: offer.amount.toString(),
    asset: ctx.feeAsset.address,
    payTo: offer.payTo,
    contextHash,
    blockNumber: receipt.blockNumber.toString(),
    explorer: ctx.ledger.explorerTx(txHash),
  };
  c.header(HEADER_PAYMENT_RESPONSE, encodeX402Header(sr));
  c.header("X-Settlement-Tx", txHash);
  c.header("Access-Control-Expose-Headers", `${HEADER_PAYMENT_RESPONSE}, X-Settlement-Tx`);
  return c.json({ ...produced.body, payment }, 200);
}
