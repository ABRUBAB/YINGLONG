import { z } from "zod";
import { CATEGORIES } from "./constants";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "address");
/** Integer amount in base units, as a decimal string (no floats for money). */
const units = z.string().regex(/^[0-9]+$/, "base units (integer string)");
const category = z.enum(CATEGORIES as [string, ...string[]]);

export const AssetSchema = z.object({
  symbol: z.string().min(1),
  address,
  decimals: z.number().int().min(0).max(36),
});

export const PayeeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string().min(1),
  address,
  category,
});

export const LabelledAddress = z.object({ label: z.string().min(1), address });

/**
 * The canonical mandate document (schema "yinglong.mandate/v1"). Its keccak256 over the canonical JSON is
 * the mandate hash published in MandateRegistry and bound by MandateBindingEnforcer.
 * Times are in the ledger's own timestamp unit (seconds on Base Sepolia; see ledger profile for FISCO).
 */
export const MandateSchema = z.object({
  schema: z.literal("yinglong.mandate/v1"),
  title: z.string().min(1),
  ledger: z.enum(["anvil", "base-sepolia", "fisco"]),
  jurisdiction: z.enum(["hk", "international", "mainland"]),
  principal: z.object({
    kind: z.enum(["person", "company"]),
    name: z.string().min(1),
    did: z.string().min(1),
    account: address,
  }),
  agent: z.object({ wallet: address, label: z.string().min(1) }),
  lineageId: z.string().min(1),
  salt: units,
  validity: z.object({ from: z.number().int().nonnegative(), until: z.number().int().positive() }),
  assets: z.array(AssetSchema).min(1),
  methods: z.array(z.enum(["transfer", "transferAndCall", "instruct"])).min(1),
  payees: z.array(PayeeSchema),
  trustedIssuers: z.array(LabelledAddress),
  intermediaries: z.array(LabelledAddress),
  tiers: z.array(
    z.object({
      asset: z.string(),
      defaultT1Cap: units,
      newPayeeT1Cap: units,
      t2Ceiling: units,
      maxApprovalWindow: z.number().int().positive(),
      categoryT1Caps: z.array(z.object({ category, amount: units })),
    }),
  ),
  budgets: z.array(
    z.object({
      asset: z.string(),
      periodStart: z.number().int().nonnegative(),
      periodLength: z.number().int().positive(),
      unlistedCategory: category,
      caps: z.array(z.object({ category, amount: units })).min(1),
    }),
  ),
  reserveFloors: z.array(z.object({ asset: z.string(), amount: units })),
  velocity: z
    .object({ asset: z.string(), window: z.number().int().positive(), maxCount: z.number().int().positive(), maxOutflow: units })
    .nullable(),
  suitability: z.object({ maxRiskClass: z.number().int().min(1).max(5) }).nullable(),
  reputation: z
    .object({
      clients: z.array(address).min(1).max(10),
      minScore: z.string().regex(/^-?[0-9]+$/),
      minScoreDecimals: z.number().int().min(0).max(18),
      tag1: z.string(),
    })
    .nullable(),
  facilitator: address.nullable(),
  /** What the user said, in their own language (model input; never shown as interface copy). */
  sentences: z.array(z.string()),
});

export type Mandate = z.infer<typeof MandateSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Payee = z.infer<typeof PayeeSchema>;
