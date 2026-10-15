import type { Address } from "viem";
import { abi } from "@yinglong/sdk";
import type { LedgerContext } from "../chain/ledger";

/**
 * Scale 6: counterparty. Who is being paid? A PayeeBook entry, or an agent with a passport attested by a
 * trusted issuer; plus a look-alike check against the payee book (address poisoning), a local sanctions
 * list (demo list of public entries; no addresses leave the machine), and the passport status.
 */
export interface CounterpartyResult {
  address: Address;
  inPayeeBook: boolean;
  category?: number;
  passport?: { agentId: bigint; status: number; attestedByTrusted: boolean };
  lookAlikeOf?: Address;
  sanctioned: boolean;
  verdict: "verified-payee" | "attested-agent" | "unverified" | "look-alike" | "sanctioned";
}

const DEMO_SANCTIONS = new Set<string>([
  // Public, illustrative entries only (OFAC SDN listed addresses of a sanctioned mixer, public record).
  "0x8589427373d6d84e98730d7795d8f6f8731fda16",
  "0x722122df12d4e14e13ac3b6895a86e84145b6967",
]);

export function isLookAlike(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return false;
  return x.slice(2, 6) === y.slice(2, 6) && x.slice(-4) === y.slice(-4);
}

export async function checkCounterparty(
  ctx: LedgerContext,
  account: Address,
  payee: Address,
  trustedIssuers: Address[],
  payeeBook: Address[],
): Promise<CounterpartyResult> {
  const [active, category] = await ctx.read<[boolean, number]>({
    address: ctx.addr("PayeeBook"),
    abi: abi.PayeeBookAbi,
    functionName: "lookup",
    args: [account, payee],
  });
  const [agentId, status] = await ctx.read<[bigint, number, string]>({
    address: ctx.addr("YinglongPassportRegistry"),
    abi: abi.YinglongPassportRegistryAbi,
    functionName: "walletInfo",
    args: [payee],
  });
  let attestedByTrusted = false;
  if (agentId !== 0n && trustedIssuers.length) {
    attestedByTrusted = await ctx.read<boolean>({
      address: ctx.addr("YinglongPassportRegistry"),
      abi: abi.YinglongPassportRegistryAbi,
      functionName: "isTrustedAgentWallet",
      args: [payee, trustedIssuers],
    });
  }
  const lookAlikeOf = active ? undefined : payeeBook.find((p) => isLookAlike(p, payee));
  const sanctioned = DEMO_SANCTIONS.has(payee.toLowerCase());
  const verdict: CounterpartyResult["verdict"] = sanctioned
    ? "sanctioned"
    : lookAlikeOf
      ? "look-alike"
      : active
        ? "verified-payee"
        : attestedByTrusted
          ? "attested-agent"
          : "unverified";
  return {
    address: payee,
    inPayeeBook: active,
    category: active ? Number(category) : undefined,
    passport: agentId !== 0n ? { agentId, status: Number(status), attestedByTrusted } : undefined,
    lookAlikeOf,
    sanctioned,
    verdict,
  };
}
