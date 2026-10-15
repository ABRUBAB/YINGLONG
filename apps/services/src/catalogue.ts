// The Agent City cast of service agents. All fictional; never real institutions. Identity codes are
// labelled placeholders ("YL-TEST-..."), never issued GB/Z 185 codes.
import type { Role } from "@yinglong/sdk/server";

export type ServiceKind = "fx-desk" | "kyb" | "merchant" | "rogue";

export interface Attester {
  role: Role;
  claim: string;
}

export interface ServiceAgent {
  slug: string;
  role: Role;
  name: string;
  description: string;
  kind: ServiceKind;
  /** Principal DID of the service operator (fictional did:web on the reserved .example domain). */
  did: string;
  identityCode: string;
  /** Trusted issuers that attest the passport during setup. Mirage has none. */
  attesters: Attester[];
  /** Rail the merchant is paid on (informational). */
  rail?: "hk" | "international" | "mainland";
}

const BANK: Role = "issuer-harbour-digital-bank";
const HBU: Role = "issuer-hbu";

export const SERVICE_AGENTS: ServiceAgent[] = [
  {
    slug: "pearl-river-fx",
    role: "svc-pearl-river-fx",
    name: "Pearl River FX Desk",
    description: "Fictional FX desk. Sells signed tUSD/tHKD conversion quotes over x402 (test units, no monetary value).",
    kind: "fx-desk",
    did: "did:web:pearl-river-fx.agent-city.example",
    identityCode: "YL-TEST-0101",
    attesters: [{ role: BANK, claim: "Harbour Digital Bank (fictional): KYB-verified FX desk, test environment" }],
    rail: "hk",
  },
  {
    slug: "victoria-fx",
    role: "svc-victoria-fx",
    name: "Victoria FX",
    description: "Fictional second FX desk. Sells signed tUSD/tHKD conversion quotes over x402 (test units, no monetary value).",
    kind: "fx-desk",
    did: "did:web:victoria-fx.agent-city.example",
    identityCode: "YL-TEST-0102",
    attesters: [{ role: BANK, claim: "Harbour Digital Bank (fictional): KYB-verified FX desk, test environment" }],
    rail: "hk",
  },
  {
    slug: "kyb-verifier",
    role: "svc-kyb-verifier",
    name: "KYB Verifier",
    description: "Fictional know-your-business verifier. Sells signed KYB results over x402 and attests demo merchants (test environment).",
    kind: "kyb",
    did: "did:web:kyb-verifier.agent-city.example",
    identityCode: "YL-TEST-0103",
    attesters: [{ role: BANK, claim: "Harbour Digital Bank (fictional): recognised KYB verifier, test environment" }],
    rail: "international",
  },
  {
    slug: "harbour-homes",
    role: "svc-harbour-homes",
    name: "Harbour Homes",
    description: "Fictional landlord agent in Hong Kong (receives rent in tHKD test units).",
    kind: "merchant",
    did: "did:web:harbour-homes.agent-city.example",
    identityCode: "YL-TEST-0201",
    attesters: [{ role: BANK, claim: "Harbour Digital Bank (fictional): KYB-verified merchant (landlord), test environment" }],
    rail: "hk",
  },
  {
    slug: "hbu-bursar",
    role: "svc-hbu-bursar",
    name: "HBU Bursar",
    description: "Bursar agent of the fictional Harbour Bay University (receives tuition deposits in tHKD test units).",
    kind: "merchant",
    did: "did:web:bursar.hbu.agent-city.example",
    identityCode: "YL-TEST-0202",
    attesters: [{ role: HBU, claim: "Harbour Bay University (fictional): official bursar agent, test environment" }],
    rail: "hk",
  },
  {
    slug: "shenzhen-components",
    role: "svc-shenzhen-components",
    name: "Shenzhen Components",
    description: "Fictional mainland supplier paid by conditional payment instructions on the coin-free rail.",
    kind: "merchant",
    did: "did:web:shenzhen-components.agent-city.example",
    identityCode: "YL-TEST-0301",
    attesters: [{ role: BANK, claim: "Harbour Digital Bank (fictional): KYB-verified supplier, test environment" }],
    rail: "mainland",
  },
  {
    slug: "kowloon-forwarders",
    role: "svc-kowloon-forwarders",
    name: "Kowloon Forwarders",
    description: "Fictional Hong Kong freight forwarder (receives tHKD test units).",
    kind: "merchant",
    did: "did:web:kowloon-forwarders.agent-city.example",
    identityCode: "YL-TEST-0302",
    attesters: [{ role: BANK, claim: "Harbour Digital Bank (fictional): KYB-verified supplier, test environment" }],
    rail: "hk",
  },
  {
    slug: "scholarship-foundation",
    role: "svc-scholarship-foundation",
    name: "Scholarship Foundation",
    description: "Fictional scholarship foundation agent that pays Nadia's stipend in tUSD test units.",
    kind: "merchant",
    did: "did:web:scholarship-foundation.agent-city.example",
    identityCode: "YL-TEST-0401",
    attesters: [{ role: BANK, claim: "Harbour Digital Bank (fictional): KYB-verified foundation, test environment" }],
    rail: "international",
  },
  {
    slug: "mirage",
    role: "mirage",
    name: "Mirage",
    description:
      "FICTIONAL ROGUE AGENT FOR SECURITY TESTING. Self-registered identity with no trusted-issuer attestation; its agent card is signed with a key that is not registered.",
    kind: "rogue",
    did: "did:web:mirage.agent-city.example",
    identityCode: "YL-TEST-0666",
    attesters: [],
  },
];

export function serviceBySlug(slug: string): ServiceAgent | undefined {
  return SERVICE_AGENTS.find((s) => s.slug === slug);
}

export function serviceByRole(role: Role): ServiceAgent | undefined {
  return SERVICE_AGENTS.find((s) => s.role === role);
}

/** FX desk route names: `/fx/:desk/quote` accepts the short or the full slug. */
export const DESK_ALIASES: Record<string, string> = {
  "pearl-river": "pearl-river-fx",
  "pearl-river-fx": "pearl-river-fx",
  victoria: "victoria-fx",
  "victoria-fx": "victoria-fx",
  mirage: "mirage",
};

export const cardKid = (slug: string) => `${slug}-card-1`;
