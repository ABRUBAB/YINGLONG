// Optional second settlement mode, Base Sepolia only: MetaMask's x402 facilitator (plan section 9.2). The
// payer names the facilitator's signer as the leaf delegate; this service forwards /verify and /settle
// (x402 v2 section 7) and still waits for the receipt itself before delivering. Not exercised by the local
// tests (it needs the public testnet); labelled as such in the README.
import type { ServicesConfig } from "../config";
import type { PaymentPayload, PaymentRequirements, SettlementResponse } from "./types";

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

async function post<T>(config: ServicesConfig, path: "/verify" | "/settle", body: unknown): Promise<T> {
  const res = await fetch(`${config.facilitatorUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(path === "/settle" ? config.settleTimeoutMs : 20_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`facilitator ${path} returned HTTP ${res.status} without JSON`);
  }
}

export async function facilitatorVerify(config: ServicesConfig, paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResponse> {
  try {
    return await post<VerifyResponse>(config, "/verify", { x402Version: 2, paymentPayload, paymentRequirements });
  } catch (e) {
    return { isValid: false, invalidReason: "unexpected_verify_error", payer: String((e as Error).message ?? e).slice(0, 200) };
  }
}

export async function facilitatorSettle(config: ServicesConfig, paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettlementResponse> {
  try {
    return await post<SettlementResponse>(config, "/settle", { x402Version: 2, paymentPayload, paymentRequirements });
  } catch {
    return { success: false, errorReason: "unexpected_settle_error", transaction: "", network: paymentRequirements.network };
  }
}
