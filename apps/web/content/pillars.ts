/** The five pillars (master plan section 4). Shared by the landing page and /about. */
export interface Pillar {
  id: "pearl" | "seal" | "scales" | "vein" | "gate";
  name: string;
  role: string;
  question: string;
  answer: string;
}

export const PILLARS: Pillar[] = [
  {
    id: "pearl",
    name: "Pearl",
    role: "Trusted identity",
    question: "Who is this agent, and who does it act for?",
    answer:
      "An ERC-8004 passport bound to a verified owner, attested by issuers the owner trusts, with a matching DID document on FISCO BCOS. A self-issued passport is refused at the counterparty scale.",
  },
  {
    id: "seal",
    name: "Seal",
    role: "Controlled authority",
    question: "What may it do, and who decides?",
    answer:
      "Rules in plain words, compiled into caveat enforcers, decoded back for you to compare, and sealed with your passkey. Tiers decide who acts: the agent alone, you on your phone, or only your own account.",
  },
  {
    id: "scales",
    name: "Scales",
    role: "Defended execution",
    question: "Can it be tricked, or go rogue?",
    answer:
      "Nine ordered checks and a signing-domain guard stand between any request and the chain. Only deterministic rules refuse; an AI signal can raise a tier, never lower one.",
  },
  {
    id: "vein",
    name: "Vein",
    role: "Traceable evidence",
    question: "Can anyone check what it did, and why?",
    answer:
      "Every action writes an accountability receipt: hash-chained, anchored on a public and a consortium ledger, and verifiable with one command in TypeScript or Python.",
  },
  {
    id: "gate",
    name: "Gate",
    role: "Compliant settlement",
    question: "Is it lawful where the user lives?",
    answer:
      "The mandate's jurisdiction profile picks the rail: Hong Kong test rails on Base Sepolia, a coin-free rail on FISCO BCOS for the mainland. A forbidden rail cannot be enabled by any mandate.",
  },
];
