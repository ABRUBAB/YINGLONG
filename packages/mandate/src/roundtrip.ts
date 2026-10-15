import type { Deployment } from "@yinglong/sdk";
import type { Hex } from "viem";
import { canonicalHash } from "./canonical";
import { compileMandate } from "./compile";
import { decompile } from "./decompile";
import { delegationHash, rootDelegation, type Caveat } from "./delegation";
import { namesFor } from "./names";
import { MandateSchema, type Mandate } from "./schema";

export interface RoundTripCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RoundTripResult {
  ok: boolean;
  checks: RoundTripCheck[];
  sentences: string[];
  delegationHash: Hex;
}

/**
 * Round-trip mandate verification (the TypeScript implementation; tools/verify-py is the independent twin):
 *  1. the caveats published on-chain equal the caveats compiled from the mandate document, byte for byte;
 *  2. the delegation hash recomputed from the published caveats equals the hash the registry recorded
 *     (the hash the DelegationManager enforces);
 *  3. the mandate hash bound in MandateBindingEnforcer equals the hash of the document;
 *  4. every caveat decodes into a known rule and an English sentence (no unknown enforcer).
 * Code-hash checks against the signed enforcer table run in the caller, which has an RPC client.
 */
export function verifyRoundTrip(args: {
  mandate: Mandate;
  deployment: Deployment;
  onChainCaveats: Caveat[];
  onChainDelegationHash: Hex;
  delegator: Hex;
  delegate: Hex;
  salt: bigint;
  timeUnit?: "s" | "ms";
}): RoundTripResult {
  const checks: RoundTripCheck[] = [];
  const compiled = compileMandate(args.mandate, args.deployment);

  const same =
    compiled.caveats.length === args.onChainCaveats.length &&
    compiled.caveats.every(
      (c, i) =>
        c.enforcer.toLowerCase() === args.onChainCaveats[i]!.enforcer.toLowerCase() &&
        c.terms.toLowerCase() === args.onChainCaveats[i]!.terms.toLowerCase(),
    );
  checks.push({
    name: "published caveats equal the compiled mandate",
    ok: same,
    detail: `${args.onChainCaveats.length} published, ${compiled.caveats.length} compiled`,
  });

  const recomputed = delegationHash(rootDelegation(args.delegator, args.delegate, args.onChainCaveats, args.salt));
  checks.push({
    name: "delegation hash recomputed from published caveats",
    ok: recomputed.toLowerCase() === args.onChainDelegationHash.toLowerCase(),
    detail: recomputed,
  });

  const docHash = canonicalHash(MandateSchema.parse(args.mandate));
  const { rules, sentences } = decompile(args.onChainCaveats, args.deployment, namesFor(args.deployment, args.mandate), args.timeUnit);
  const binding = rules.find((r) => r.kind === "mandateBinding");
  checks.push({
    name: "bound mandate hash equals the document hash",
    ok: !!binding && binding.kind === "mandateBinding" && binding.mandateHash.toLowerCase() === docHash.toLowerCase(),
    detail: docHash,
  });

  const unknown = rules.filter((r) => r.kind === "unknown").length;
  checks.push({ name: "every rule decodes", ok: unknown === 0, detail: `${unknown} unknown` });

  return { ok: checks.every((c) => c.ok), checks, sentences, delegationHash: recomputed };
}
