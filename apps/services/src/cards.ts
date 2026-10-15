// A2A 1.0 agent cards, signed with JWS ES256 over the RFC 8785 canonical card (A2A section 8.4), bound to
// the on-chain passport: YinglongPassportRegistry stores the card key's `kid` and keccak256(JCS(JWKS)).
// Mirage's card is self-signed with a key that is NOT the one registered for its passport.
import type { Address, Hex } from "viem";
import { abi } from "@yinglong/sdk";
import { rolePrivateKey } from "@yinglong/sdk/server";
import type { Ledger } from "./chain";
import { cardKid, type ServiceAgent } from "./catalogue";
import { deriveCardKey, jwksHash, jwksOf, parseProtected, signDetached, verifyDetached, type CardKey, type Jwks, type PublicJwk } from "./jose";

export const PASSPORT_EXT_URI = "https://yinglong-agent.tech/a2a/ext/passport/v1";
export const X402_EXT_URI = "https://yinglong-agent.tech/a2a/ext/x402-erc7710/v1";
export const A2A_PROTOCOL_VERSION = "1.0";

export interface AgentCardSignature {
  protected: string;
  signature: string;
  header?: Record<string, unknown>;
}

export interface AgentExtension {
  uri: string;
  description?: string;
  required?: boolean;
  params?: Record<string, unknown>;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[];
  provider?: { url: string; organization: string };
  version: string;
  documentationUrl?: string;
  capabilities: { streaming?: boolean; pushNotifications?: boolean; extensions?: AgentExtension[]; extendedAgentCard?: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  signatures?: AgentCardSignature[];
  iconUrl?: string;
}

export interface CardKeys {
  /** The key whose kid and JWKS hash are registered on-chain. */
  registered: CardKey;
  /** The key that signs the card actually served (equal to `registered` except for Mirage). */
  served: CardKey;
}

const keyCache = new Map<string, CardKeys>();

export function cardKeysFor(svc: ServiceAgent): CardKeys {
  let k = keyCache.get(svc.slug);
  if (!k) {
    const seed = rolePrivateKey(svc.role);
    const registered = deriveCardKey(seed, svc.slug, cardKid(svc.slug));
    const served = svc.kind === "rogue" ? deriveCardKey(seed, `${svc.slug}-unregistered`, `${svc.slug}-card-2`) : registered;
    k = { registered, served };
    keyCache.set(svc.slug, k);
  }
  return k;
}

export const registeredJwks = (svc: ServiceAgent): Jwks => jwksOf([cardKeysFor(svc).registered]);
export const servedJwks = (svc: ServiceAgent): Jwks => jwksOf([cardKeysFor(svc).served]);
export const registeredJwksHash = (svc: ServiceAgent): Hex => jwksHash(registeredJwks(svc));

export const agentBaseUrl = (publicUrl: string, slug: string) => `${publicUrl}/agents/${slug}`;
export const cardUrl = (publicUrl: string, slug: string) => `${agentBaseUrl(publicUrl, slug)}/.well-known/agent-card.json`;
export const jwksUrl = (publicUrl: string, slug: string) => `${agentBaseUrl(publicUrl, slug)}/.well-known/jwks.json`;
export const registrationUrl = (publicUrl: string, slug: string) => `${agentBaseUrl(publicUrl, slug)}/registration.json`;

function skillsFor(svc: ServiceAgent, publicUrl: string, deskRoute?: string): AgentSkill[] {
  if (svc.kind === "fx-desk" || svc.kind === "rogue") {
    return [
      {
        id: "fx-quote",
        name: "Signed FX quote",
        description:
          "Returns a SignedQuoteSettlement EIP-712 quote (expiry 120 s, single-use nonce) after an x402 v2 exact payment over ERC-7710. Test units only; rates are a fixed demo table.",
        tags: ["fx", "x402", "quote", "test-units"],
        examples: [`GET ${publicUrl}/fx/${deskRoute ?? svc.slug}/quote?payer=0x...&inToken=tUSD&outToken=tHKD&amountIn=1000000000`],
      },
    ];
  }
  if (svc.kind === "kyb") {
    return [
      {
        id: "kyb-check",
        name: "KYB check",
        description: "Returns an EIP-712 signed KYB result for an address after an x402 v2 exact payment over ERC-7710. Fictional registry of demo merchants.",
        tags: ["kyb", "x402", "compliance", "test"],
        examples: [`GET ${publicUrl}/kyb/0x...`],
      },
    ];
  }
  return [
    {
      id: "receive-payment",
      name: "Receive payment",
      description: `${svc.name} receives test-unit payments as a payee. No paid endpoints.`,
      tags: ["payee", "test-units"],
    },
  ];
}

export interface CardContext {
  ledger: Ledger;
  publicUrl: string;
}

/** Unsigned card content for a service, bound to its passport (agentId read from the registry). */
export async function buildCard(cc: CardContext, svc: ServiceAgent, wallet: Address, opts: { mirageClaims?: Record<string, string> } = {}): Promise<AgentCard> {
  const registry = cc.ledger.addr("YinglongPassportRegistry");
  const agentId = await cc.ledger.read<bigint>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "agentIdOf", args: [wallet] });
  const base = agentBaseUrl(cc.publicUrl, svc.slug);
  const rogue = svc.kind === "rogue";
  const passportParams: Record<string, string> = {
    ledger: cc.ledger.name,
    chainId: String(cc.ledger.profile.chainId),
    passportRegistry: registry,
    agentWallet: wallet,
    agentId: agentId.toString(),
    identityCode: svc.identityCode,
    ownerDid: svc.did,
    registrationUri: registrationUrl(cc.publicUrl, svc.slug),
    ...(opts.mirageClaims ?? {}),
  };
  const extensions: AgentExtension[] = [
    {
      uri: PASSPORT_EXT_URI,
      description: "Binds this card to a YINGLONG passport: the registry stores the signing key's kid and keccak256 of the RFC 8785 JWKS.",
      params: passportParams,
    },
  ];
  if (svc.kind !== "merchant") {
    extensions.push({
      uri: X402_EXT_URI,
      description: "Paid endpoints use x402 v2, scheme exact, assetTransferMethod erc7710, settled by the seller before delivery.",
      params: { network: cc.ledger.network, delegationManager: cc.ledger.addr("DelegationManager") },
    });
  }
  return {
    name: svc.name,
    description: `${svc.description} Fictional service in the YINGLONG Agent City demo; test environment only.`,
    supportedInterfaces: [{ url: base, protocolBinding: "HTTP+JSON", protocolVersion: A2A_PROTOCOL_VERSION }],
    provider: rogue
      ? { organization: "Mirage (fictional rogue test agent)", url: "https://mirage.agent-city.example" }
      : { organization: "YINGLONG Agent City (fictional test services)", url: "https://yinglong-agent.tech" },
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, extensions },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: skillsFor(svc, cc.publicUrl, svc.kind === "rogue" ? "mirage" : undefined),
  };
}

/** Attach the JWS ES256 signature (detached payload = RFC 8785 card without `signatures`). */
export function signCard(card: AgentCard, key: CardKey, jku: string): AgentCard {
  const { signatures: _drop, ...content } = card;
  const sig = signDetached(key, content, { jku });
  return { ...content, signatures: [sig] };
}

// ---------------------------------------------------------------------------------------------- verify

export type CardCheckReason =
  | "NO_SIGNATURE"
  | "UNSUPPORTED_ALG"
  | "NO_PASSPORT_EXTENSION"
  | "LEDGER_MISMATCH"
  | "NO_PASSPORT"
  | "AGENT_ID_MISMATCH"
  | "PASSPORT_NOT_ACTIVE"
  | "KID_NOT_REGISTERED"
  | "JWKS_UNAVAILABLE"
  | "JWKS_HASH_MISMATCH"
  | "KEY_NOT_IN_JWKS"
  | "BAD_SIGNATURE"
  | "NO_TRUSTED_ATTESTATION";

export interface CardCheck {
  ok: boolean;
  reasons: CardCheckReason[];
  signatureValid: boolean;
  kid?: string;
  agentId?: string;
  agentWallet?: Address;
  registeredKid?: string;
  attestedBy: Address[];
}

interface PassportView {
  controller: Address;
  agentWallet: Address;
  jwksHash: Hex;
  status: number;
  kid: string;
}

/**
 * Verify an agent card against the passport registry on `ledger`: JWS signature with the key named by
 * `kid`, `kid` equal to the registered kid, keccak256(JCS(JWKS)) equal to the registered jwksHash, an
 * active passport, and (if `trustedIssuers` is given) a live attestation by one of them.
 * `jwks` may be passed in; otherwise it is fetched from the protected header's `jku`.
 */
export async function verifyAgentCard(
  ledger: Ledger,
  card: AgentCard,
  opts: { jwks?: Jwks; trustedIssuers?: Address[]; fetchJwks?: (url: string) => Promise<Jwks> } = {},
): Promise<CardCheck> {
  const reasons: CardCheckReason[] = [];
  const out: CardCheck = { ok: false, reasons, signatureValid: false, attestedBy: [] };
  const sig = card.signatures?.[0];
  if (!sig) return { ...out, reasons: ["NO_SIGNATURE"] };
  const header = parseProtected(sig.protected);
  if (!header || header.alg !== "ES256" || typeof header.kid !== "string") return { ...out, reasons: ["UNSUPPORTED_ALG"] };
  const kid = header.kid;
  out.kid = kid;
  const ext = card.capabilities?.extensions?.find((e) => e.uri === PASSPORT_EXT_URI);
  const params = (ext?.params ?? {}) as Record<string, string>;
  if (!ext || typeof params.agentWallet !== "string") return { ...out, reasons: ["NO_PASSPORT_EXTENSION"] };
  if (params.chainId !== String(ledger.profile.chainId)) reasons.push("LEDGER_MISMATCH");
  const wallet = params.agentWallet as Address;
  out.agentWallet = wallet;
  const registry = ledger.addr("YinglongPassportRegistry");

  const agentId = await ledger.read<bigint>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "agentIdOf", args: [wallet] });
  out.agentId = agentId.toString();
  let passport: PassportView | undefined;
  if (agentId === 0n) reasons.push("NO_PASSPORT");
  else {
    if (params.agentId !== undefined && params.agentId !== agentId.toString()) reasons.push("AGENT_ID_MISMATCH");
    passport = await ledger.read<PassportView>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "passportOf", args: [agentId] });
    out.registeredKid = passport.kid;
    if (Number(passport.status) !== 1) reasons.push("PASSPORT_NOT_ACTIVE");
    if (passport.kid !== kid) reasons.push("KID_NOT_REGISTERED");
  }

  let jwks = opts.jwks;
  if (!jwks && typeof header.jku === "string") {
    try {
      jwks = opts.fetchJwks ? await opts.fetchJwks(header.jku) : ((await (await fetch(header.jku, { signal: AbortSignal.timeout(10_000) })).json()) as Jwks);
    } catch {
      jwks = undefined;
    }
  }
  if (!jwks || !Array.isArray(jwks.keys)) reasons.push("JWKS_UNAVAILABLE");
  else {
    if (passport && jwksHash(jwks).toLowerCase() !== passport.jwksHash.toLowerCase()) reasons.push("JWKS_HASH_MISMATCH");
    const jwk = jwks.keys.find((k: PublicJwk) => k.kid === kid);
    if (!jwk) reasons.push("KEY_NOT_IN_JWKS");
    else {
      const { signatures: _drop, ...content } = card;
      out.signatureValid = verifyDetached(jwk, sig, content);
      if (!out.signatureValid) reasons.push("BAD_SIGNATURE");
    }
  }

  if (agentId !== 0n && opts.trustedIssuers) {
    for (const issuer of opts.trustedIssuers) {
      const ok = await ledger.read<boolean>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "isAttestedBy", args: [agentId, issuer] });
      if (ok) out.attestedBy.push(issuer);
    }
    if (out.attestedBy.length === 0) reasons.push("NO_TRUSTED_ATTESTATION");
  }
  out.ok = reasons.length === 0;
  return out;
}
