// x402 round trip against the live Anvil deployment: a client holding a delegation from a HybridDeleGator
// account pays an FX desk over x402 v2 (exact / erc7710, seller-settled) and receives a desk-signed quote
// that SignedQuoteSettlement accepts; an expired replay reverts with QuoteExpired; Mirage's quote is refused
// at card verification.
import { beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import { abi, decodeRevert, revertDataOf } from "@yinglong/sdk";
import { roleAddress } from "@yinglong/sdk/server";
import { encodePermissionContext, type Delegation } from "@yinglong/mandate";
import type { Hono } from "hono";
import { createApp, makeDeps, type AppDeps } from "../src/app";
import { verifyAgentCard } from "../src/cards";
import { HEADER_PAYMENT_REQUIRED, HEADER_PAYMENT_RESPONSE, HEADER_PAYMENT_SIGNATURE } from "../src/x402/types";
import { SINGLE_DEFAULT_MODE } from "../src/x402/erc7710";
import { balanceOf, buildPaymentHeader, buildRoot, buildX402Child, decodeChallenge, deployAccount, mintTo, permissionContext, type TestAccount } from "./support";

const RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8645";
process.env.LEDGER = "anvil";
process.env.RPC_URL = RPC;
process.env.LIQUIDITY_KEEPER = "0";

let deps: AppDeps;
let app: Hono;
let account: TestAccount;
let tUSD: Address;
let tHKD: Address;

beforeAll(async () => {
  deps = makeDeps();
  app = await createApp(deps);
  tUSD = deps.ledger.addr("TestUSD");
  tHKD = deps.ledger.addr("TestHKD");
  account = await deployAccount(deps.ledger);
  await mintTo(deps.ledger, tUSD, account.address, 2_000_000_000n); // 2,000 tUSD
}, 180_000);

async function challenge(url: string): Promise<{ status: number; header: string; body: Record<string, unknown> }> {
  const res = await app.fetch(new Request(url));
  const header = res.headers.get(HEADER_PAYMENT_REQUIRED) ?? "";
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, header, body };
}

describe("x402 exact / erc7710 seller-settled round trip", () => {
  it("returns a well-formed 402 payment challenge when no payment is attached", async () => {
    const url = `http://svc/fx/pearl-river/quote?payer=${account.address}&inToken=tUSD&outToken=tHKD&amountIn=1000000000`;
    const { status, header } = await challenge(url);
    expect(status).toBe(402);
    const ch = decodeChallenge(header);
    const req = ch.accepts[0]!;
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe(deps.ledger.network);
    expect(req.extra?.assetTransferMethod).toBe("erc7710");
    expect(getAddress(req.asset)).toBe(getAddress(tUSD));
    expect(getAddress(req.payTo)).toBe(getAddress(roleAddress("svc-pearl-river-fx")));
  });

  it("pays the desk, settles on-chain, and returns a quote SignedQuoteSettlement accepts", async () => {
    const amountIn = 1_000_000_000n; // 1,000 tUSD
    const url = `http://svc/fx/pearl-river/quote?payer=${account.address}&inToken=tUSD&outToken=tHKD&amountIn=${amountIn}`;
    const { header } = await challenge(url);
    const ch = decodeChallenge(header);
    const req = ch.accepts[0]!;
    const fee = BigInt(req.amount);
    const seller = getAddress(req.payTo);
    const dm = deps.ledger.addr("DelegationManager");

    // Client delegation chain: account -> agent (root), agent -> seller (single-use x402 child).
    const root = await buildRoot(deps.ledger, account, "agent-ying", [tUSD], 101n);
    const child = await buildX402Child(deps.ledger, root, "agent-ying", seller, tUSD, fee, 300, 201n);
    const ctx = permissionContext([child, root]);
    const payHeader = buildPaymentHeader(ch, ctx, account.address, dm);

    const sellerBefore = await balanceOf(deps.ledger, tUSD, seller);
    const res = await app.fetch(new Request(url, { headers: { [HEADER_PAYMENT_SIGNATURE]: payHeader } }));
    expect(res.status).toBe(200);
    const settlement = decodeChallenge(res.headers.get(HEADER_PAYMENT_RESPONSE) ?? " e30=") as unknown as { success: boolean; transaction: string };
    expect(settlement.success).toBe(true);
    expect(settlement.transaction).toMatch(/^0x[0-9a-f]{64}$/i);

    const body = (await res.json()) as {
      quote: Record<string, string>;
      deskSignature: Hex;
      transferAndCallData: Hex;
      payment: { transaction: Hex; payer: Address };
    };
    // The desk was paid the exact fee.
    const sellerAfter = await balanceOf(deps.ledger, tUSD, seller);
    expect(sellerAfter - sellerBefore).toBe(fee);
    expect(getAddress(body.payment.payer)).toBe(getAddress(account.address));

    // The returned quote is accepted by SignedQuoteSettlement: convert through the mandate (agent redeems
    // the root executing tUSD.transferAndCall(settlement, amountIn, data)).
    const quotesAddr = deps.ledger.addr("SignedQuoteSettlement");
    const amountOut = BigInt(body.quote.amountOut!);
    await mintTo(deps.ledger, tUSD, account.address, amountIn); // fund the conversion leg
    const hkdBefore = await balanceOf(deps.ledger, tHKD, account.address);
    const convExec = singleExecution(tUSD, encodeFunctionData({ abi: TRANSFER_AND_CALL_ABI, functionName: "transferAndCall", args: [quotesAddr, amountIn, body.transferAndCallData] }));
    await deps.ledger.write("agent-ying", {
      address: dm,
      abi: abi.DelegationManagerAbi,
      functionName: "redeemDelegations",
      args: [[encodePermissionContext([root])], [SINGLE_DEFAULT_MODE], [convExec]],
    });
    const hkdAfter = await balanceOf(deps.ledger, tHKD, account.address);
    expect(hkdAfter - hkdBefore).toBe(amountOut);
  });

  it("rejects a second attempt that reuses the same permission context", async () => {
    const amountIn = 500_000_000n;
    const url = `http://svc/fx/pearl-river/quote?payer=${account.address}&inToken=tUSD&outToken=tHKD&amountIn=${amountIn}`;
    const { header } = await challenge(url);
    const ch = decodeChallenge(header);
    const req = ch.accepts[0]!;
    const fee = BigInt(req.amount);
    const seller = getAddress(req.payTo);
    const dm = deps.ledger.addr("DelegationManager");
    const root = await buildRoot(deps.ledger, account, "agent-ying", [tUSD], 301n);
    const child = await buildX402Child(deps.ledger, root, "agent-ying", seller, tUSD, fee, 300, 401n);
    const ctx = permissionContext([child, root]);
    const payHeader = buildPaymentHeader(ch, ctx, account.address, dm);
    const first = await app.fetch(new Request(url, { headers: { [HEADER_PAYMENT_SIGNATURE]: payHeader } }));
    expect(first.status).toBe(200);
    const second = await app.fetch(new Request(url, { headers: { [HEADER_PAYMENT_SIGNATURE]: payHeader } }));
    expect(second.status).toBe(402); // LimitedCalls(1) / replay guard
  });

  it("refuses an expired quote replayed against SignedQuoteSettlement with QuoteExpired", async () => {
    // Buy a quote with a very short TTL by setting QUOTE_TTL to the minimum via a direct desk signature path:
    // request a normal quote, then warp Anvil past its expiry and replay it.
    const amountIn = 100_000_000n;
    const url = `http://svc/fx/pearl-river/quote?payer=${account.address}&inToken=tUSD&outToken=tHKD&amountIn=${amountIn}`;
    const { header } = await challenge(url);
    const ch = decodeChallenge(header);
    const req = ch.accepts[0]!;
    const fee = BigInt(req.amount);
    const seller = getAddress(req.payTo);
    const dm = deps.ledger.addr("DelegationManager");
    const root = await buildRoot(deps.ledger, account, "agent-ying", [tUSD], 501n);
    const child = await buildX402Child(deps.ledger, root, "agent-ying", seller, tUSD, fee, 300, 601n);
    const payHeader = buildPaymentHeader(ch, permissionContext([child, root]), account.address, dm);
    const res = await app.fetch(new Request(url, { headers: { [HEADER_PAYMENT_SIGNATURE]: payHeader } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quote: Record<string, string>; transferAndCallData: Hex };
    const quotesAddr = deps.ledger.addr("SignedQuoteSettlement");

    // Warp past the quote expiry (120 s default + margin).
    await deps.ledger.pub.request({ method: "evm_increaseTime" as never, params: [600] as never });
    await deps.ledger.pub.request({ method: "evm_mine" as never, params: [] as never });
    await mintTo(deps.ledger, tUSD, account.address, amountIn);
    const convExec = singleExecution(tUSD, encodeFunctionData({ abi: TRANSFER_AND_CALL_ABI, functionName: "transferAndCall", args: [quotesAddr, amountIn, body.transferAndCallData] }));
    let revertName = "";
    try {
      await deps.ledger.pub.simulateContract({
        address: dm,
        abi: abi.DelegationManagerAbi,
        functionName: "redeemDelegations",
        args: [[encodePermissionContext([root])], [SINGLE_DEFAULT_MODE], [convExec]],
        account: roleAddress("agent-ying"),
      } as never);
    } catch (e) {
      revertName = decodeRevert(revertDataOf(e)).name;
    }
    expect(revertName).toBe("QuoteExpired");
  });
});

describe("counterparty scale", () => {
  it("accepts Pearl River's signed card and refuses Mirage's", async () => {
    const bank = roleAddress("issuer-harbour-digital-bank");
    const pearlCard = await (await app.fetch(new Request("http://svc/agents/pearl-river-fx/.well-known/agent-card.json"))).json();
    const pearlJwks = await (await app.fetch(new Request("http://svc/agents/pearl-river-fx/.well-known/jwks.json"))).json();
    const good = await verifyAgentCard(deps.ledger, pearlCard as never, { jwks: pearlJwks as never, trustedIssuers: [bank] });
    expect(good.ok).toBe(true);
    expect(good.signatureValid).toBe(true);

    const mirageCard = await (await app.fetch(new Request("http://svc/agents/mirage/.well-known/agent-card.json"))).json();
    const mirageJwks = await (await app.fetch(new Request("http://svc/agents/mirage/.well-known/jwks.json"))).json();
    const bad = await verifyAgentCard(deps.ledger, mirageCard as never, { jwks: mirageJwks as never, trustedIssuers: [bank] });
    expect(bad.ok).toBe(false);
    expect(bad.reasons).toContain("KID_NOT_REGISTERED");
    expect(bad.reasons).toContain("NO_TRUSTED_ATTESTATION");
  });
});

// --- helpers --------------------------------------------------------------------------------------------
import { encodePacked } from "viem";
const TRANSFER_AND_CALL_ABI = [
  { type: "function", name: "transferAndCall", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;
function singleExecution(target: Address, callData: Hex): Hex {
  return encodePacked(["address", "uint256", "bytes"], [target, 0n, callData]);
}
void decodeFunctionData;
