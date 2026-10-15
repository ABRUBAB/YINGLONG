// x402 protocol v2 types and HTTP transport encoding (specs/x402-specification-v2.md and
// specs/transports-v2/http.md in the x402 repository). Header names and payload shapes follow the spec
// exactly; YINGLONG-specific hints live in scheme-specific `extra` keys (documented in the README).
import { z } from "zod";

export const X402_VERSION = 2 as const;
export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

const hexRe = /^0x[0-9a-fA-F]*$/;
export const zAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "address");
export const zHex = z.string().regex(hexRe, "hex");
export const zUint = z.string().regex(/^\d{1,78}$/, "unsigned integer string");

export const ResourceInfoSchema = z.object({
  url: z.string().max(2048),
  description: z.string().max(4096).optional(),
  mimeType: z.string().max(128).optional(),
  serviceName: z.string().max(32).optional(),
  tags: z.array(z.string().max(32)).max(5).optional(),
  iconUrl: z.string().max(2048).optional(),
});
export type ResourceInfo = z.infer<typeof ResourceInfoSchema>;

export const PaymentRequirementsSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  amount: zUint,
  asset: z.string(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().int().nonnegative(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

export const PaymentRequiredSchema = z.object({
  x402Version: z.literal(2),
  error: z.string().optional(),
  resource: ResourceInfoSchema,
  accepts: z.array(PaymentRequirementsSchema).min(1),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
export type PaymentRequired = z.infer<typeof PaymentRequiredSchema>;

export const PaymentPayloadSchema = z.object({
  x402Version: z.number().int(),
  resource: ResourceInfoSchema.optional(),
  accepted: PaymentRequirementsSchema,
  payload: z.record(z.string(), z.unknown()),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

/** `payload` of the exact scheme with the erc7710 asset-transfer method (scheme_exact_evm.md section 3). */
export const Erc7710PayloadSchema = z.object({
  delegationManager: zAddress,
  permissionContext: zHex.max(64 * 1024),
  delegator: zAddress,
});
export type Erc7710Payload = z.infer<typeof Erc7710PayloadSchema>;

export interface SettlementResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
  extensions?: Record<string, unknown>;
}

/** Error codes from section 9 of the v2 spec (plus the scheme-specific exact EVM ones). */
export type X402ErrorCode =
  | "insufficient_funds"
  | "invalid_exact_evm_payload_authorization_valid_after"
  | "invalid_exact_evm_payload_authorization_valid_before"
  | "invalid_exact_evm_payload_authorization_value_mismatch"
  | "invalid_exact_evm_payload_signature"
  | "invalid_exact_evm_payload_recipient_mismatch"
  | "invalid_network"
  | "invalid_payload"
  | "invalid_payment_requirements"
  | "invalid_scheme"
  | "unsupported_scheme"
  | "invalid_x402_version"
  | "invalid_transaction_state"
  | "unexpected_verify_error"
  | "unexpected_settle_error"
  | "settlement_pending";

const MAX_HEADER_BYTES = 96 * 1024;

export function encodeX402Header(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeX402Header(value: string): unknown {
  if (value.length > MAX_HEADER_BYTES) throw new Error("x402 header too large");
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
}
