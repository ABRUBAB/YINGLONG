"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { getApi } from "@/lib/api";
import type { Ping, ProofBundle } from "@/lib/api/view";
import { WireHealth } from "@/lib/api/types";
import { CloseIcon } from "@/components/ui/button";

type Faq = {
  question: string;
  terms: string[];
  answer: string;
  href: string;
  link: string;
  audience?: "judge";
};

type Message = { id: number; from: "visitor" | "assistant"; text: string; faq?: Faq; answeredAt?: string; suggestions?: Faq[]; pending?: boolean };

const FAQS: Faq[] = [
  {
    question: "What is YINGLONG?",
    terms: ["what is yinglong", "what does yinglong do", "product overview", "agent wallet", "about yinglong"],
    answer: "YINGLONG is an AI agent wallet. You set a spending mandate; the agent can propose payments, while code enforces the mandate and records evidence.",
    href: "/about",
    link: "How it works",
  },
  {
    question: "Does the AI decide whether a payment is allowed?",
    terms: ["ai decide", "who decides", "decision maker", "does ai choose", "ai pay", "ai spend", "without approval", "without permission", "rules enforced", "on chain rule"],
    answer: "No. The AI can interpret a request and propose an action. Deterministic checks and the on-chain rule enforcers decide whether that action is allowed.",
    href: "/judge",
    link: "See the walkthrough",
  },
  {
    question: "Can I try it without signing up?",
    terms: ["try without", "demo", "sign up", "signup", "create an agent", "get started"],
    answer: "Yes. The guided walkthrough is designed to run without typing. Creating your own test agent is optional.",
    href: "/judge",
    link: "Start the walkthrough",
  },
  {
    question: "Does this use real money?",
    terms: ["real money", "real funds", "test units", "testnet", "production funds"],
    answer: "No. The demos use test units on Base Sepolia and a team-run FISCO BCOS network. They are not production funds.",
    href: "/proof#labels",
    link: "Read the full limitations",
  },
  {
    question: "How can I verify a payment or receipt?",
    terms: ["verify", "proof", "receipt", "transaction", "hash", "audit"],
    answer: "Open the proof page to inspect recorded transactions and receipt evidence. Transaction links open the relevant public explorer or YINGLONG's read-only decoder.",
    href: "/proof#transactions",
    link: "Inspect transaction records",
  },
  {
    question: "Can I try to bypass the rules?",
    terms: ["hack", "attack", "bypass", "trick", "security", "challenge"],
    answer: "Yes. The security challenge lets you try requests against the demo agent and see which check or contract rejects them.",
    href: "/challenge",
    link: "Open the security challenge",
  },
  {
    question: "Which blockchains does it support?",
    terms: ["chain", "blockchain", "ledger", "fisco", "base", "network"],
    answer: "This demo uses Base Sepolia, a public testnet, and a team-run FISCO BCOS consortium network.",
    href: "/proof#chain",
    link: "See the chain evidence",
  },
  {
    question: "How does a payment move through YINGLONG?",
    terms: ["how does it work", "payment flow", "payment process", "request", "propose", "checks", "signer", "execution", "send a payment"],
    answer: "A request is interpreted into a proposed action. Nine checks evaluate it; the action may proceed, ask for the owner’s approval, or be refused. The contract enforcers check the mandate again when a transaction reaches the chain, and the result is recorded in a receipt.",
    href: "/judge",
    link: "See the full payment walkthrough",
  },
  {
    question: "What are the nine payment checks?",
    terms: ["nine checks", "nine scales", "normalise", "sentinel", "quarantine", "ground", "policy", "counterparty", "simulate", "anomaly", "chain check"],
    answer: "The checks are Normalise, Sentinel, Quarantine, Ground, Policy, Counterparty, Simulate, Anomaly, and Chain. They inspect the request, trusted data, mandate and recipient before the chain enforces the rules.",
    href: "/#rules-lab",
    link: "Explore the Rules Lab",
  },
  {
    question: "What happens when a request exceeds the mandate?",
    terms: ["over limit", "exceeds", "exceed", "above the cap", "budget limit", "spending limit", "not allowed", "refused", "blocked", "revert"],
    answer: "The policy checks can refuse a request before it is sent. If a raw transaction bypasses the agent, the smart-contract enforcer checks the mandate and can revert it with a typed reason. The demo shows which rule stopped the action and links to the available evidence.",
    href: "/challenge",
    link: "See an attack get blocked",
  },
  {
    question: "How do I create my own agent and mandate?",
    terms: ["create agent", "make agent", "own agent", "new mandate", "write rules", "sign up", "signup", "passkey registration"],
    answer: "Open Create your agent, sign up with a device passkey, describe your rules, review the compiled mandate, then seal it. The account uses test units on the team-run FISCO BCOS chain.",
    href: "/start",
    link: "Create your agent",
  },
  {
    question: "How are company payments approved?",
    terms: ["company", "business", "treasury", "board", "directors", "2 of 3", "cosign", "co sign", "supplier payment"],
    answer: "The company demo has a director approval queue. Company authority is controlled by the board: high-authority actions require two of three directors, and the same mandate checks still apply to payments.",
    href: "/treasury",
    link: "Open the company demo",
  },
  {
    question: "What can the supervisor or regulator do?",
    terms: ["supervisor", "regulator", "pause", "halt", "monitor", "registry", "inspect agent"],
    answer: "The supervisor view can inspect registered agents and pause an agent identity. It cannot spend money or expand an agent’s mandate.",
    href: "/supervisor",
    link: "Open the supervisor view",
  },
  {
    question: "Does YINGLONG use real money or connect to a bank?",
    terms: ["real money", "real funds", "bank", "bank connection", "bank partnership", "license", "licence", "production", "test units", "testnet"],
    answer: "No. The demos use test units and test networks. The mainland settlement flow is an e-CNY-style simulator, not a PBoC sandbox or bank integration. The project claims no bank partnership, licence, third-party audit, or production readiness.",
    href: "/proof#labels",
    link: "Read the honest labels",
  },
  {
    question: "What is real and what is simulated?",
    terms: ["real or simulated", "simulated", "fictional", "fake", "what is real", "real data", "sample data", "fixture"],
    answer: "Base Sepolia is a public testnet and the FISCO BCOS network is team-run. Anvil and the e-CNY-style settlement flow are simulations. The people and companies in the demo are fictional, and all balances are test units. Pages label sample data when they are using fixtures.",
    href: "/proof#labels",
    link: "See the full breakdown",
  },
  {
    question: "How do receipts and proof work?",
    terms: ["receipt hash", "receipt chain", "merkle", "anchor", "audit proof", "proof of payment", "verify receipt", "evidence"],
    answer: "Receipts record the decision and its result. They are hash-chained, and batches can be committed to Merkle roots anchored on the ledgers. The Proof page exposes transaction records and verification details; its links open a public explorer or a read-only transaction decoder.",
    href: "/proof#certificate",
    link: "Inspect receipt verification",
  },
  {
    question: "How does YINGLONG protect against prompt injection?",
    terms: ["prompt injection", "injection", "hidden instruction", "malicious invoice", "untrusted text", "trick the ai", "security"],
    answer: "Untrusted text is checked and quarantined before it can influence the payment plan. The privileged planner does not receive raw untrusted text, and the model cannot choose an arbitrary payee address. The security challenge lets you try attacks and inspect the result.",
    href: "/challenge",
    link: "Try the security challenge",
  },
  {
    question: "What do the payment tiers mean?",
    terms: ["tier", "t0", "t1", "t2", "t3", "t4", "approval level", "authority level"],
    answer: "The tiers control how much authority an action needs. T1 can act inside the mandate; T2 needs the owner’s passkey approval; T3 is reserved for the user or company board; T4 is refused by deterministic rules. The AI can raise an action’s required tier, never lower it.",
    href: "/proof#transactions",
    link: "See tiers on recorded transactions",
  },
  {
    question: "Is the source code public?",
    terms: ["source code", "open source", "github", "repository", "license", "licence"],
    answer: "Yes. The project source and documentation are public on GitHub. The Proof page also reports the running build commit when the service provides it.",
    href: "https://github.com/ABRUBAB/YINGLONG",
    link: "Open the source repository",
  },
  {
    question: "How do I contact the team?",
    terms: ["contact", "support", "report a bug", "feedback", "issue", "team"],
    answer: "Questions and bug reports go through the project’s GitHub issues page.",
    href: "https://github.com/ABRUBAB/YINGLONG/issues",
    link: "Contact the team on GitHub",
  },
  {
    question: "Does YINGLONG publish pricing?",
    terms: ["price", "pricing", "cost", "subscription", "fee", "paid", "how much"],
    answer: "I can’t find a published subscription price on this site. The current experience is a hackathon demo that uses test units and is not presented as a production financial service.",
    href: "/proof#labels",
    link: "Review the product limitations",
  },
  {
    question: "Can I set limits on what the agent spends?",
    terms: ["spending limit", "daily limit", "category budget", "spending cap", "budget", "allowance", "reserve floor", "how much can it spend", "rent", "food", "tuition"],
    answer: "Yes. A mandate can set rules such as spending caps, category budgets, verified payees, and a reserve floor. The owner reviews the compiled rules before sealing them; code enforces them when the agent proposes a payment.",
    href: "/#rules-lab",
    link: "Try setting rules in the Rules Lab",
  },
  {
    question: "What information does the agent trust?",
    terms: ["privacy", "data", "trusted data", "untrusted", "invoice", "email", "attachment", "payee address", "personal information"],
    answer: "The system treats incoming requests and attachments as untrusted input. It checks their contents before planning and resolves recipients against the owner’s verified payee book, rather than letting a model provide an arbitrary payment address.",
    href: "/challenge",
    link: "Inspect input security challenges",
  },
  {
    question: "Where should I start if I’m new to YINGLONG?",
    terms: ["where start", "new user", "first time", "start here", "where begin", "how to explore", "what should i try first"],
    answer: "Start with the guided Judge walkthrough to see a payment request move through its checks and reach a result. You can explore it without signing up; creating your own agent is a separate, optional step.",
    href: "/judge",
    link: "Start the guided walkthrough",
  },
  {
    question: "What is a spending mandate?",
    terms: ["what is a mandate", "mandate meaning", "spending mandate", "agent rules", "rules for agent", "permission limits"],
    answer: "A mandate is the set of rules you give an agent, such as spending caps, category budgets, approved payees, and a reserve floor. YINGLONG compiles those rules for you to review, then code enforces them when a payment is proposed.",
    href: "/#rules-lab",
    link: "Explore the Rules Lab",
  },
  {
    question: "Do I need a crypto wallet to explore the demo?",
    terms: ["need crypto wallet", "need a wallet", "connect wallet", "existing wallet", "crypto account", "wallet to try", "sign up to explore"],
    answer: "No crypto wallet or sign-up is needed for the guided walkthroughs. To create and control your own agent, use the passkey setup on the Start page; it creates the demo account for you and uses test units.",
    href: "/start",
    link: "See the optional setup",
  },
  {
    question: "What does it mean when a payment needs approval?",
    terms: ["needs approval", "why approval", "who approves", "approve payment", "approval required", "waiting for approval", "human approval"],
    answer: "It means a rule requires a person to decide before the payment can proceed—for example, the amount is above the agent’s self-pay limit or the recipient is new. The owner approves with their passkey; company payments can require the configured director co-signers.",
    href: "/judge",
    link: "See an approval in the walkthrough",
  },
  {
    question: "What happens if a payment is refused?",
    terms: ["payment refused", "payment rejected", "payment blocked", "what if blocked", "failed payment", "did it charge", "money deducted"],
    answer: "A refusal means the rule check stopped the request. If it is refused before submission, no transaction is sent; if a transaction reaches a contract and violates an enforced rule, it can revert. The demo uses test units, not real funds, and the result explains the available evidence.",
    href: "/proof#transactions",
    link: "Inspect transaction outcomes",
  },
  {
    question: "Can the agent change its own mandate?",
    terms: ["change its own rules", "agent change mandate", "agent edit rules", "who can change rules", "can ai change limits", "update mandate"],
    answer: "No. The agent cannot expand or rewrite its own authority. The owner reviews and seals the mandate, and only the owner can change its rules.",
    href: "/start",
    link: "See how the owner seals the mandate",
  },
  {
    question: "What is the core problem YINGLONG is trying to solve?",
    audience: "judge",
    terms: ["core problem", "problem solve", "why yinglong", "why build this", "what problem", "agent wallet problem", "product value"],
    answer: "AI agents can interpret instructions and act quickly, but a model should not be the authority that decides how much money it may spend or who it may pay. YINGLONG puts a user reviewed mandate between an agent and payment execution: deterministic checks evaluate requests, contracts enforce the mandate at execution, and receipts make outcomes inspectable. The demo is designed to show that control and evidence together.",
    href: "/about",
    link: "Read the product and architecture overview",
  },
  {
    question: "What is enforced on-chain, and what is only checked by the app?",
    audience: "judge",
    terms: ["on chain enforcement", "what is on chain", "app checks", "off chain checks", "enforced by contract", "can backend bypass", "on chain rules"],
    answer: "The app runs a nine check pipeline to interpret and screen a request, including trusted data, policy, recipient and simulation checks. That helps explain or stop an action early, but it is not the final authority: the compiled mandate is represented by contract caveats, and the contracts check the rules again when a transaction is executed. Some context checks, such as quarantining untrusted text, happen before the transaction and are not themselves blockchain guarantees. The walkthrough and Proof page show which layer produced a result.",
    href: "/proof#chain",
    link: "Inspect the contract evidence",
  },
  {
    question: "How can I verify that a payment actually happened?",
    audience: "judge",
    terms: ["judge verify payment", "prove payment happened", "verify on blockchain", "transaction evidence", "independently verify", "audit a transaction", "receipt evidence"],
    answer: "Open the Proof page and follow a receipt to its ledger record. When a transaction hash is present, the page links to the relevant explorer or a read only decoder so you can inspect the transaction and receipt details. A receipt records the decision and outcome and is hash chained; batches can also be anchored through Merkle roots. A refused request may correctly have no payment transaction, so check the recorded outcome and rule explanation instead of expecting every receipt to contain a hash.",
    href: "/proof#transactions",
    link: "Inspect transaction evidence",
  },
  {
    question: "What happens if someone bypasses the agent API and submits a transaction directly?",
    audience: "judge",
    terms: ["bypass api", "direct transaction", "raw transaction", "bypass agent", "call contract directly", "skip backend", "agent api bypass"],
    answer: "The demo is built so that a direct contract call still meets the mandate's contract enforcers; an action that violates an enforced caveat can revert even if it did not come through the normal agent flow. The Judge’s Challenge includes bypass attempts and shows the check or contract error responsible. This demonstrates the tested contract boundary in this project; it is not a claim that every possible production integration or deployment has been independently audited.",
    href: "/challenge",
    link: "Try the bypass challenge",
  },
  {
    question: "How is YINGLONG’s architecture separated into components?",
    audience: "judge",
    terms: ["architecture", "system components", "backend architecture", "request path", "where does model run", "services and contracts", "technical design"],
    answer: "At a high level, the web app collects requests and presents the walkthrough, evidence and owner controls. The agent service interprets a request and runs the nine checks; its policy mirror helps explain contract rules before submission. The owner’s passkey signs account or approval actions, and smart account contracts with caveat enforcers validate authority at execution. Ledger events and service receipts feed the Proof views and receipt verification tools. The About and Proof pages provide the project’s stack, deployments and evidence details.",
    href: "/about",
    link: "Read the architecture overview",
  },
  {
    question: "Why does the demo use both Base Sepolia and FISCO BCOS?",
    audience: "judge",
    terms: ["why two chains", "why two blockchains", "why base and fisco", "purpose of each chain", "public testnet consortium", "ledger choice"],
    answer: "They demonstrate the same mandate enforcement idea across two different ledger settings: Base Sepolia is a public testnet, while FISCO BCOS is a team run consortium ledger. The Proof page lets you inspect records and deployment evidence for the available rails. Neither is a production funds claim: balances are test units, and the FISCO network is operated by the team.",
    href: "/proof#chain",
    link: "Inspect chain evidence",
  },
  {
    question: "What are the important limitations of this hackathon demo?",
    audience: "judge",
    terms: ["limitations", "production ready", "security audit", "independent audit", "what is not production", "risks and caveats", "demo caveats"],
    answer: "This is a hackathon demonstration, not a production financial service. It uses test units and test networks; some flows, including Anvil and the e-CNY-style settlement experience, are simulations, and sample data is labelled where used. The project does not claim a bank integration, financial licence, third party security audit, or production readiness. The Proof and About pages distinguish deployed evidence from simulated or sample material so you can assess each claim at the right level.",
    href: "/proof#labels",
    link: "Review the limitations and labels",
  },
  {
    question: "How do you stop an AI model from choosing an arbitrary recipient or obeying an invoice attack?",
    audience: "judge",
    terms: ["arbitrary recipient", "payee address chosen by ai", "invoice attack", "malicious prompt", "prompt injection defense", "model choose address", "untrusted invoice"],
    answer: "The model is not given authority to invent a payment address. Recipient selection is resolved against the owner's verified payee information, while incoming invoice or request text is treated as untrusted and checked or quarantined before planning. The agent then passes the proposed action through deterministic policy checks, with contract enforcement at execution. These controls reduce specific attack paths; the challenge page lets you test the documented cases and see where they are stopped.",
    href: "/challenge",
    link: "Test the documented attacks",
  },
  {
    question: "How should I interpret the live numbers and activity on the homepage?",
    audience: "judge",
    terms: ["homepage live numbers", "live activity", "numbers live", "are metrics real", "what does ticker show", "current data source", "live feed meaning"],
    answer: "The homepage reads current service data for its live status and receipt views when the configured service is reachable. Some displayed scenarios, especially the recorded Base Sepolia run, are historical evidence rather than newly submitted transactions; fixture mode is labelled as sample data. Use each section's label and the Proof page to distinguish a polled live feed, a recorded run, and sample data. A moving animation by itself is not proof that a new payment was submitted.",
    href: "/proof#transactions",
    link: "Inspect the live transaction feed",
  },
  {
    question: "What should a judge try during the live demo?",
    audience: "judge",
    terms: ["judge try", "judge demo script", "what should test", "demo walkthrough", "test the project", "judge questions", "live demonstration"],
    answer: "A useful sequence is: follow a normal request in the Judge walkthrough, change a limit in the Rules Lab and observe a refusal or approval request, then use the Challenge to try a direct bypass or malicious input. Finish by opening the corresponding receipt or transaction evidence on Proof. That sequence tests the user-facing explanation, the policy decision, and the evidence trail as one connected story. It uses demo/test data and does not move production funds.",
    href: "/judge",
    link: "Begin the judge walkthrough",
  },
];

const POPULAR = [faq("What is YINGLONG?"), faq("Can I try it without signing up?"), faq("How can I verify a payment or receipt?"), faq("Does the AI decide whether a payment is allowed?")];
const JUDGE_FAQS = FAQS.filter((faq) => faq.audience === "judge");
const FEATURED_JUDGE_FAQS = JUDGE_FAQS.slice(0, 3);
const FEATURED_COMMON_FAQS = POPULAR.slice(0, 2);
const COMMON_FAQS = FAQS.filter((faq) => !faq.audience);
const MORE_COMMON_FAQS = COMMON_FAQS.filter((faq) => !FEATURED_COMMON_FAQS.includes(faq));
const MORE_JUDGE_FAQS = JUDGE_FAQS.filter((faq) => !FEATURED_JUDGE_FAQS.includes(faq));

function faq(question: string): Faq {
  const match = FAQS.find((entry) => entry.question === question);
  if (!match) throw new Error(`FAQ reference does not exist: ${question}`);
  return match;
}

function suggestionsFor(current?: Faq, question = ""): Faq[] {
  const related: Record<string, Faq[]> = {
    "What is YINGLONG?": [faq("Does the AI decide whether a payment is allowed?"), faq("Can I try it without signing up?"), faq("How can I verify a payment or receipt?")],
    "Does the AI decide whether a payment is allowed?": [faq("Can I try to bypass the rules?"), faq("How can I verify a payment or receipt?"), faq("What is YINGLONG?")],
    "Can I try it without signing up?": [faq("Where should I start if I’m new to YINGLONG?"), faq("How does a payment move through YINGLONG?"), faq("What should a judge try during the live demo?")],
    "Does this use real money?": [faq("What is real and what is simulated?"), faq("How can I verify a payment or receipt?"), faq("Do I need a crypto wallet to explore the demo?")],
    "How can I verify a payment or receipt?": [faq("Which blockchains does it support?"), faq("Can I try to bypass the rules?"), faq("What is YINGLONG?")],
    "Can I try to bypass the rules?": [faq("Does the AI decide whether a payment is allowed?"), faq("How can I verify a payment or receipt?"), faq("What should a judge try during the live demo?")],
    "Which blockchains does it support?": [faq("How can I verify a payment or receipt?"), faq("Does this use real money?"), faq("What is real and what is simulated?")],
    "How does a payment move through YINGLONG?": [faq("What are the nine payment checks?"), faq("What does it mean when a payment needs approval?"), faq("How can I verify a payment or receipt?")],
    "What are the nine payment checks?": [faq("What happens when a request exceeds the mandate?"), faq("Can I set limits on what the agent spends?"), faq("How does a payment move through YINGLONG?")],
    "What happens when a request exceeds the mandate?": [faq("What is a spending mandate?"), faq("Can I try to bypass the rules?"), faq("What happens if a payment is refused?")],
    "How do I create my own agent and mandate?": [faq("Can I try it without signing up?"), faq("Do I need a crypto wallet to explore the demo?"), faq("What is a spending mandate?")],
    "How are company payments approved?": [faq("What does it mean when a payment needs approval?"), faq("What do the payment tiers mean?"), faq("What is a spending mandate?")],
    "What can the supervisor or regulator do?": [faq("What happens if someone bypasses the agent API and submits a transaction directly?"), faq("How are company payments approved?"), faq("What happens if a payment is refused?")],
    "Does YINGLONG use real money or connect to a bank?": [faq("Does this use real money?"), faq("What is real and what is simulated?"), faq("Which blockchains does it support?")],
    "What is real and what is simulated?": [faq("Does YINGLONG use real money or connect to a bank?"), faq("Which blockchains does it support?"), faq("How do receipts and proof work?")],
    "How do receipts and proof work?": [faq("How can I verify a payment or receipt?"), faq("Which blockchains does it support?"), faq("How can I verify that a payment actually happened?")],
    "How does YINGLONG protect against prompt injection?": [faq("What is enforced on-chain, and what is only checked by the app?"), faq("What happens if someone bypasses the agent API and submits a transaction directly?"), faq("What information does the agent trust?")],
    "What do the payment tiers mean?": [faq("What does it mean when a payment needs approval?"), faq("What is a spending mandate?"), faq("How are company payments approved?")],
    "Is the source code public?": [faq("How is YINGLONG’s architecture separated into components?"), faq("How can I verify that a payment actually happened?"), faq("What is the core problem YINGLONG is trying to solve?")],
    "How do I contact the team?": [faq("Is the source code public?"), faq("What are the important limitations of this hackathon demo?"), faq("What is YINGLONG?")],
    "Does YINGLONG publish pricing?": [faq("Does this use real money?"), faq("What is real and what is simulated?"), faq("Can I try it without signing up?")],
    "Can I set limits on what the agent spends?": [faq("What is a spending mandate?"), faq("What happens when a request exceeds the mandate?"), faq("What does it mean when a payment needs approval?")],
    "What information does the agent trust?": [faq("How does YINGLONG protect against prompt injection?"), faq("What is enforced on-chain, and what is only checked by the app?"), faq("What happens if someone bypasses the agent API and submits a transaction directly?")],
    "Where should I start if I’m new to YINGLONG?": [faq("What is YINGLONG?"), faq("Can I try it without signing up?"), faq("How can I verify a payment or receipt?")],
    "What is a spending mandate?": [faq("Can I set limits on what the agent spends?"), faq("What happens when a request exceeds the mandate?"), faq("What is enforced on-chain, and what is only checked by the app?")],
    "Do I need a crypto wallet to explore the demo?": [faq("Can I try it without signing up?"), faq("Where should I start if I’m new to YINGLONG?"), faq("What is YINGLONG?")],
    "What does it mean when a payment needs approval?": [faq("What do the payment tiers mean?"), faq("How does a payment move through YINGLONG?"), faq("How are company payments approved?")],
    "What happens if a payment is refused?": [faq("How can I verify a payment or receipt?"), faq("What happens when a request exceeds the mandate?"), faq("Can I try to bypass the rules?")],
    "Can the agent change its own mandate?": [faq("Does the AI decide whether a payment is allowed?"), faq("What is a spending mandate?"), faq("How do I create my own agent and mandate?")],
    "What is the core problem YINGLONG is trying to solve?": [faq("Does the AI decide whether a payment is allowed?"), faq("How is YINGLONG’s architecture separated into components?"), faq("What is enforced on-chain, and what is only checked by the app?")],
    "What is enforced on-chain, and what is only checked by the app?": [faq("What are the nine payment checks?"), faq("What happens if someone bypasses the agent API and submits a transaction directly?"), faq("How can I verify that a payment actually happened?")],
    "How can I verify that a payment actually happened?": [faq("How can I verify a payment or receipt?"), faq("Which blockchains does it support?"), faq("How do receipts and proof work?")],
    "What happens if someone bypasses the agent API and submits a transaction directly?": [faq("Can I try to bypass the rules?"), faq("How does YINGLONG protect against prompt injection?"), faq("What happens if a payment is refused?")],
    "How is YINGLONG’s architecture separated into components?": [faq("What is the core problem YINGLONG is trying to solve?"), faq("What is enforced on-chain, and what is only checked by the app?"), faq("Why does the demo use both Base Sepolia and FISCO BCOS?")],
    "Why does the demo use both Base Sepolia and FISCO BCOS?": [faq("Which blockchains does it support?"), faq("What is enforced on-chain, and what is only checked by the app?"), faq("How can I verify that a payment actually happened?")],
    "What are the important limitations of this hackathon demo?": [faq("What is real and what is simulated?"), faq("Does YINGLONG use real money or connect to a bank?"), faq("How should I interpret the live numbers and activity on the homepage?")],
    "How do you stop an AI model from choosing an arbitrary recipient or obeying an invoice attack?": [faq("What information does the agent trust?"), faq("How does YINGLONG protect against prompt injection?"), faq("What happens if someone bypasses the agent API and submits a transaction directly?")],
    "How should I interpret the live numbers and activity on the homepage?": [faq("Why does the demo use both Base Sepolia and FISCO BCOS?"), faq("How can I verify that a payment actually happened?"), faq("What is real and what is simulated?")],
    "What should a judge try during the live demo?": [faq("Where should I start if I’m new to YINGLONG?"), faq("What happens if someone bypasses the agent API and submits a transaction directly?"), faq("How can I verify that a payment actually happened?")],
  };
  const curated = current ? related[current.question] : undefined;
  if (curated) return curated.slice(0, 4);
  if (/status|online|health|block/i.test(question)) return [faq("Which blockchains does it support?"), faq("How can I verify a payment or receipt?"), faq("Can I try it without signing up?")];
  if (/model|contract|build|commit/i.test(question)) return [faq("What is enforced on-chain, and what is only checked by the app?"), faq("How can I verify that a payment actually happened?"), faq("Why does the demo use both Base Sepolia and FISCO BCOS?")];
  if (/latest|recent|transaction|receipt|payment/i.test(question)) return [faq("Does the AI decide whether a payment is allowed?"), faq("Can I try to bypass the rules?"), faq("Which blockchains does it support?")];
  return POPULAR;
}

function findFaq(input: string): Faq | undefined {
  const query = input.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!query) return undefined;
  const exact = FAQS.find((faq) => faq.question.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim() === query);
  if (exact) return exact;
  const root = (word: string) => word.length > 5 && word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.length > 5 && word.endsWith("ing") ? word.slice(0, -3) : word.length > 4 && word.endsWith("es") ? word.slice(0, -2) : word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
  const stop = new Set(["a", "an", "and", "are", "can", "do", "does", "for", "how", "i", "is", "it", "me", "my", "of", "on", "or", "the", "to", "what", "when", "where", "which", "who", "why", "with", "you"]);
  const words = query.split(" ").filter((word) => word.length > 1 && !stop.has(word)).map(root);
  const scored = FAQS.map((faq) => {
    const termWords = faq.terms.flatMap((term) => term.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)).filter(Boolean).map(root);
    const vocabulary = new Set(termWords);
    const overlap = words.reduce((total, word) => total + (vocabulary.has(word) ? (word.length > 5 ? 2 : 1) : 0), 0);
    const phrase = faq.terms.reduce((total, term) => {
      const normalized = term.toLocaleLowerCase();
      return total + (normalized.includes(" ") && query.includes(normalized) ? 3 : 0);
    }, 0);
    return { faq, score: overlap + phrase };
  });
  const best = scored.sort((a, b) => b.score - a.score)[0];
  return best?.score ? best.faq : undefined;
}

function needsProof(question: string): boolean {
  return /receipt|transaction|payment|blockchain|\bchain\b|ledger|contract|bytecode|build|commit|model|benchmark|latest|recent/i.test(question);
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

function currentFacts(ping: Ping | null, proof: ProofBundle | null, sample: boolean, question: string): string | null {
  const freshness = sample ? "Sample data" : "Live update";
  if (!ping) return /status|online|health|service|running|block|ledger|chain/i.test(question) ? "The service status check did not complete, so I can’t confirm current availability." : null;
  const parsed = WireHealth.safeParse(ping.body);
  const health = parsed.success ? parsed.data : null;
  const status = ping.ok ? `the service is online (HTTP ${ping.status}, ${ping.ms} ms)` : `the service did not respond successfully (HTTP ${ping.status || "no response"})`;
  const asksStatus = /status|online|health|service|running/i.test(question);
  const asksLedger = /block|ledger|chain|fisco|base sepolia/i.test(question);
  const asksModel = /model/i.test(question);
  const facts: string[] = [];
  if (asksStatus) facts.push(`${freshness}: ${status}.`);
  if (asksLedger) facts.push(health?.ledgers.length
    ? `${freshness}: current ledger blocks are ${health.ledgers.map((ledger) => `${ledger.badge} ${ledger.block}`).join("; ")}.`
    : `${freshness}: current ledger block details are unavailable.`);
  if (asksModel && health) facts.push(`${freshness}: the service reports intent model ${health.models.intent} and safety model ${health.models.sentinel}.`);
  if (needsProof(question)) {
    if (proof) {
      const proofSource = sample ? "Sample data" : "Current proof data";
      const txs = proof.transactions.latest;
      if (/receipt|transaction|payment|latest|recent/i.test(question)) {
        const latest = txs[0];
        const total = proof.transactions.counts.reduce((sum, count) => sum + count.total, 0);
        facts.push(latest
          ? `${proofSource}: the latest public record is ${latest.title || "Untitled record"}, ${latest.outcome.replace(/_/g, " ")} on ${latest.ledger}${latest.at ? ` at ${timeLabel(latest.at)}` : ""}${latest.txHash ? `, transaction ${latest.txHash.slice(0, 10)}…` : ", no transaction hash"}. The snapshot reports ${total} records across the ledgers.`
          : `${proofSource} contains no transaction records.`);
      }
      if (/contract|bytecode|build|commit/i.test(question)) {
        const bytecode = proof.chain.bytecode;
        facts.push(bytecode
          ? `${proofSource}: ${bytecode.identical} of ${bytecode.compared} compared contracts have identical bytecode${proof.build.commit ? `; build ${proof.build.commit.slice(0, 7)}` : ""}.`
          : `${proofSource}: build ${proof.build.commit?.slice(0, 7) ?? "commit not reported"}; bytecode comparison is unavailable.`);
      }
      if (/model|benchmark/i.test(question)) facts.push(`${proofSource} was generated ${proof.generatedAt ? timeLabel(proof.generatedAt) : "at an unreported time"}.`);
    } else if (!sample && ping.ok) {
      facts.push("Current proof data is unavailable, so transaction or build details could not be refreshed.");
    }
  }
  if (!facts.length && !ping.ok) facts.push("The site’s live service is currently unavailable.");
  return facts.length ? facts.join(" ") : null;
}

async function readCurrentData(question: string) {
  const api = getApi();
  const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms))]);
  const [pingResult, proofResult] = await Promise.allSettled([
    withTimeout(api.ping(), 7000),
    needsProof(question) ? withTimeout(Promise.resolve(api.proof()), 7000) : Promise.resolve(null),
  ]);
  return {
    sample: api.mode === "fixtures",
    ping: pingResult.status === "fulfilled" ? pingResult.value : null,
    proof: proofResult.status === "fulfilled" ? proofResult.value : null,
  };
}

export function FaqChat() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<"everyone" | "judges">("everyone");
  const [showQuestionList, setShowQuestionList] = useState(false);
  const [askedInJudgeSection, setAskedInJudgeSection] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: "assistant", text: "Hi! I can answer common questions about YINGLONG, the demos, and the proof. What would you like to know?" },
  ]);
  const [askedFaqQuestions, setAskedFaqQuestions] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const availableFeaturedJudgeFaqs = FEATURED_JUDGE_FAQS.filter((faq) => !askedFaqQuestions.has(faq.question));
  const availableFeaturedCommonFaqs = POPULAR.filter((faq) => !askedFaqQuestions.has(faq.question));
  const availableCommonFaqs = COMMON_FAQS.filter((faq) => !askedFaqQuestions.has(faq.question));
  const availableMoreJudgeFaqs = MORE_JUDGE_FAQS.filter((faq) => !askedFaqQuestions.has(faq.question));
  const availableMoreCommonFaqs = MORE_COMMON_FAQS.filter((faq) => !askedFaqQuestions.has(faq.question));
  const hasMoreQuestions = section === "judges"
    ? availableMoreJudgeFaqs.length + availableCommonFaqs.length > 0
    : availableMoreCommonFaqs.length > 0;
  const latestSuggestions = [...messages].reverse().find((message) =>
    message.from === "assistant" && message.suggestions?.some((suggestion) => !askedFaqQuestions.has(suggestion.question)),
  )?.id;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, open]);

  async function ask(question: string) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setShowQuestionList(false);
    if (section === "judges") setAskedInJudgeSection(true);
    const faq = findFaq(question);
    if (faq) setAskedFaqQuestions((current) => new Set(current).add(faq.question));
    const visitor: Message = { id: nextId.current++, from: "visitor", text: question };
    const answerId = nextId.current++;
    const pending: Message = { id: answerId, from: "assistant", text: "Checking the current service and site evidence…", pending: true };
    setMessages((current) => [...current, visitor, pending]);
    setInput("");
    setLoading(true);
    try {
      const live = await readCurrentData(question);
      const answer: Message = {
        id: answerId,
        from: "assistant",
        faq,
        text: [faq?.answer, currentFacts(live.ping, live.proof, live.sample, question)].filter(Boolean).join("\n\n") || "I don’t have a verified answer for that exact topic in the site information yet. Try one of the suggested questions for a grounded answer.",
        answeredAt: timeLabel(new Date().toISOString()),
        suggestions: suggestionsFor(faq, question),
      };
      setMessages((current) => current.map((message) => message.id === answerId ? answer : message));
    } catch {
      const answer: Message = {
        id: answerId,
        from: "assistant",
        text: faq?.answer ?? "I couldn’t match that question to verified site information.",
        faq,
        answeredAt: timeLabel(new Date().toISOString()),
        suggestions: suggestionsFor(faq, question),
      };
      setMessages((current) => current.map((message) => message.id === answerId ? answer : message));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (question) void ask(question);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="yl-faq-trigger fixed right-4 bottom-20 z-[65] inline-flex h-12 items-center gap-2 rounded-pill border border-line-2 bg-bg-1 px-4 text-13 font-semibold text-fg-0 shadow-lg hover:bg-bg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:bottom-5">
        <ChatIcon />
        Ask a question
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/35" />
        <Dialog.Popup className="fixed inset-x-3 bottom-20 z-[71] mx-auto flex max-h-[min(74dvh,38rem)] w-auto max-w-[430px] flex-col overflow-hidden rounded-sheet border border-line-2 bg-bg-1 text-fg-1 shadow-2xl outline-none sm:inset-x-auto sm:right-5 sm:bottom-20 sm:w-[min(430px,calc(100vw-2rem))]">
          <header className="flex items-start justify-between gap-4 border-b border-line-1 px-4 py-4 sm:px-5">
            <div>
              <Dialog.Title className="m-0 text-15 font-semibold text-fg-0">YINGLONG help</Dialog.Title>
              <Dialog.Description className="mt-1 mb-0 text-12 text-fg-muted">Choose a question set, or ask anything about the site.</Dialog.Description>
            </div>
            <Dialog.Close className="inline-flex size-9 shrink-0 items-center justify-center rounded-control text-fg-2 hover:bg-bg-3 hover:text-fg-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" aria-label="Close help">
              <CloseIcon />
            </Dialog.Close>
          </header>

          <div className="flex gap-2 border-b border-line-1 px-4 py-2.5 sm:px-5" role="group" aria-label="Question sections">
            <button type="button" aria-pressed={section === "everyone"} onClick={() => { setSection("everyone"); setShowQuestionList(false); }} className={`min-h-9 rounded-control px-3 text-12 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${section === "everyone" ? "bg-bg-3 text-fg-0" : "text-fg-muted hover:bg-bg-2 hover:text-fg-1"}`}>
              Everyone
            </button>
            <button type="button" aria-pressed={section === "judges"} onClick={() => { setSection("judges"); setShowQuestionList(false); }} className={`min-h-9 rounded-control px-3 text-12 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${section === "judges" ? "bg-bg-3 text-fg-0" : "text-fg-muted hover:bg-bg-2 hover:text-fg-1"}`}>
              For judges
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-label="Conversation">
            <ol className="m-0 grid list-none gap-3 p-0" aria-live="polite" aria-relevant="additions text">
              {messages.map((message) => (
                <li key={message.id} className={message.from === "visitor" ? "ml-8 grid justify-items-end gap-2" : "mr-5 grid justify-items-start gap-2"}>
                  <div className={message.from === "visitor" ? "rounded-card bg-accent-tint px-3 py-2.5 text-13 text-fg-0" : "rounded-card border border-line-1 bg-bg-2 px-3 py-2.5 text-13 leading-relaxed text-fg-1"}>
                    <p className="m-0">{message.text}</p>
                    {message.faq ? message.faq.href.startsWith("http") ? (
                      <a href={message.faq.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="mt-2 inline-flex text-12 font-medium text-fg-0 underline decoration-line-3 underline-offset-4 hover:decoration-fg-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                        {message.faq.link}
                      </a>
                    ) : (
                      <Link href={message.faq.href} onClick={() => setOpen(false)} className="mt-2 inline-flex text-12 font-medium text-fg-0 underline decoration-line-3 underline-offset-4 hover:decoration-fg-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                        {message.faq.link}
                      </Link>
                    ) : null}
                  </div>
                  {message.answeredAt ? <p className="m-0 max-w-[38ch] text-11 leading-relaxed text-fg-muted">{message.answeredAt}</p> : null}
                  {!loading && message.id === latestSuggestions && message.suggestions?.some((suggestion) => !askedFaqQuestions.has(suggestion.question)) ? (
                    <section aria-label="Suggested next questions" className="grid gap-1.5">
                      <p className="m-0 text-11 font-medium text-fg-muted">Suggested next questions</p>
                      <div className="flex max-w-full flex-wrap gap-1.5">
                        {message.suggestions.filter((suggestion) => !askedFaqQuestions.has(suggestion.question)).map((suggestion) => (
                          <button key={suggestion.question} type="button" disabled={loading} onClick={() => void ask(suggestion.question)} className="min-h-9 rounded-control border border-line-2 bg-bg-1 px-2.5 py-1.5 text-left text-12 text-fg-1 hover:border-focus hover:bg-bg-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50">
                            {suggestion.question}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </li>
              ))}
            </ol>
            <div ref={endRef} />
            <section className="mt-2 border-t border-line-1 pt-2" aria-label={section === "judges" ? "Judge questions" : "Common questions"}>
              {section === "judges" ? (
                <div className="grid gap-1.5">
                  {!askedInJudgeSection && availableFeaturedJudgeFaqs.length ? <div className="grid gap-1.5">
                    <p className="m-0 text-11 font-medium text-fg-muted">Judge questions</p>
                    {availableFeaturedJudgeFaqs.map((faq) => (
                      <button key={faq.question} type="button" disabled={loading} onClick={() => void ask(faq.question)} className="min-h-10 rounded-control border border-line-2 px-3 py-2 text-left text-12 text-fg-1 hover:border-focus hover:bg-bg-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">
                        {faq.question}
                      </button>
                    ))}
                  </div> : null}
                </div>
              ) : (
                <div className="grid gap-1.5">
                  {availableFeaturedCommonFaqs.map((faq) => (
                    <button key={faq.question} type="button" disabled={loading} onClick={() => void ask(faq.question)} className="min-h-10 rounded-control border border-line-2 px-3 py-2 text-left text-12 text-fg-1 hover:border-focus hover:bg-bg-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">
                      {faq.question}
                    </button>
                  ))}
                </div>
              )}
              {hasMoreQuestions ? <button type="button" aria-expanded={showQuestionList} aria-controls="yl-faq-question-list" onClick={() => setShowQuestionList((shown) => !shown)} className="min-h-8 rounded-control px-2 text-left text-12 font-medium text-fg-1 hover:bg-bg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                {showQuestionList ? "Show fewer questions" : "More suggested questions"}
              </button> : null}
              {showQuestionList && hasMoreQuestions ? (
                <div id="yl-faq-question-list" className="mt-1.5 grid gap-1.5">
                  {section === "judges" ? (
                    <div className="grid gap-1.5">
                      {availableMoreJudgeFaqs.length ? <div className="grid gap-1.5">
                        <p className="m-0 text-11 font-medium text-fg-muted">More questions judges may ask</p>
                        {availableMoreJudgeFaqs.map((faq) => (
                          <button key={faq.question} type="button" disabled={loading} onClick={() => void ask(faq.question)} className="min-h-10 rounded-control border border-line-2 px-3 py-2 text-left text-12 text-fg-1 hover:border-focus hover:bg-bg-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">{faq.question}</button>
                        ))}
                      </div> : null}
                      {availableCommonFaqs.length ? <div className="grid gap-1.5">
                        <p className="m-0 text-11 font-medium text-fg-muted">More common questions</p>
                        {availableCommonFaqs.map((faq) => (
                          <button key={faq.question} type="button" disabled={loading} onClick={() => void ask(faq.question)} className="min-h-10 rounded-control border border-line-2 px-3 py-2 text-left text-12 text-fg-1 hover:border-focus hover:bg-bg-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">{faq.question}</button>
                        ))}
                      </div> : null}
                    </div>
                  ) : (
                    <div className="grid gap-1.5">
                      <p className="m-0 text-11 font-medium text-fg-muted">More common questions</p>
                      {availableMoreCommonFaqs.map((faq) => (
                        <button key={faq.question} type="button" disabled={loading} onClick={() => void ask(faq.question)} className="min-h-10 rounded-control border border-line-2 px-3 py-2 text-left text-12 text-fg-1 hover:border-focus hover:bg-bg-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">{faq.question}</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          </div>

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-line-1 p-3 sm:p-4">
            <label className="sr-only" htmlFor="yl-faq-question">Ask a question</label>
            <input
              id="yl-faq-question"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type a question..."
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-control border border-line-2 bg-bg-0 px-3 text-13 text-fg-0 placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            />
            <button type="submit" disabled={!input.trim() || loading} className="h-10 rounded-control bg-accent px-3 text-13 font-medium text-accent-fg hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? "Checking…" : "Send"}
            </button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M3 4.5h14v10H9l-4.5 3v-3H3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 8h7M6.5 11h4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
