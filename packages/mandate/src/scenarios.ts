import type { Address } from "viem";
import { addr, type Deployment } from "@yinglong/sdk";
import type { Mandate } from "./schema";

const U = (n: number | bigint) => (BigInt(n) * 1_000_000n).toString(); // 6-decimal test units
const FEN = (n: number | bigint) => (BigInt(n) * 100n).toString(); // 2-decimal CNY instruction units

export interface NadiaParties {
  account: Address;
  agent: Address;
  harbourHomes: Address;
  hbuBursar: Address;
  foodMart: Address;
  issuerHbu: Address;
  issuerBank: Address;
}

/**
 * Nadia's Hong Kong mandate, as she says it: "Pay my rent, 9,500, to Harbour Homes on the 1st. Keep food
 * under 3,000 a month. Never let my balance drop below 1,500. Pay the tuition deposit to HBU before 1 November.
 * Ask me above 2,000 or for anyone new. Only put idle cash into low-risk products."
 */
export function nadiaMandate(d: Deployment, p: NadiaParties, opts: { now: number; periodLength?: number; salt?: string }): Mandate {
  const tHKD = addr(d, "TestHKD");
  const tUSD = addr(d, "TestUSD");
  return {
    schema: "yinglong.mandate/v1",
    title: "Nadia: daily life in Hong Kong",
    ledger: d.ledger,
    jurisdiction: "hk",
    principal: { kind: "person", name: "Nadia Rahman", did: `did:pkh:eip155:${d.chainId}:${p.account.toLowerCase()}`, account: p.account },
    agent: { wallet: p.agent, label: "Ying" },
    lineageId: "nadia-daily",
    salt: opts.salt ?? "1",
    validity: { from: opts.now - 60, until: opts.now + 365 * 86400 },
    assets: [
      { symbol: "tHKD", address: tHKD, decimals: 6 },
      { symbol: "tUSD", address: tUSD, decimals: 6 },
    ],
    methods: ["transfer", "transferAndCall"],
    payees: [
      { id: "harbour_homes", label: "Harbour Homes", address: p.harbourHomes, category: "rent" },
      { id: "hbu_bursar", label: "HBU Bursar", address: p.hbuBursar, category: "tuition" },
      { id: "kowloon_food_mart", label: "Kowloon Food Mart", address: p.foodMart, category: "food" },
      { id: "test_mmf", label: "Test Money Market Fund", address: addr(d, "TestMoneyMarketFund"), category: "treasury" },
    ],
    trustedIssuers: [
      { label: "Harbour Bay University", address: p.issuerHbu },
      { label: "Harbour Digital Bank", address: p.issuerBank },
    ],
    intermediaries: [
      { label: "escrow (ProtectedPayment)", address: addr(d, "ProtectedPayment") },
      { label: "quote settlement", address: addr(d, "SignedQuoteSettlement") },
    ],
    tiers: [
      {
        asset: "tHKD",
        defaultT1Cap: U(2_000),
        newPayeeT1Cap: U(50),
        t2Ceiling: U(12_000),
        maxApprovalWindow: 600,
        categoryT1Caps: [{ category: "rent", amount: U(9_500) }],
      },
      {
        asset: "tUSD",
        defaultT1Cap: U(300),
        newPayeeT1Cap: U(1_500),
        t2Ceiling: U(2_500),
        maxApprovalWindow: 600,
        categoryT1Caps: [],
      },
    ],
    budgets: [
      {
        asset: "tHKD",
        periodStart: 0,
        periodLength: opts.periodLength ?? 30 * 86400,
        unlistedCategory: "services",
        caps: [
          { category: "rent", amount: U(9_500) },
          { category: "food", amount: U(3_000) },
          { category: "tuition", amount: U(12_000) },
          { category: "treasury", amount: U(5_000) },
          { category: "services", amount: U(200) },
        ],
      },
      {
        asset: "tUSD",
        periodStart: 0,
        periodLength: opts.periodLength ?? 30 * 86400,
        unlistedCategory: "services",
        caps: [{ category: "services", amount: U(2_500) }],
      },
    ],
    reserveFloors: [{ asset: "tHKD", amount: U(1_500) }],
    velocity: { asset: "tHKD", window: 86400, maxCount: 8, maxOutflow: U(15_000) },
    suitability: { maxRiskClass: 2 },
    reputation: null,
    facilitator: null,
    sentences: [
      "Pay my rent, 9,500, to Harbour Homes on the 1st.",
      "Keep food under 3,000 a month.",
      "Never let my balance drop below 1,500.",
      "Pay the tuition deposit to HBU before 1 November.",
      "Ask me above 2,000 or for anyone new.",
      "Only put idle cash into low-risk products.",
    ],
  };
}

export interface LotusParties {
  account: Address; // MultiSigDeleGator 2-of-3 directors
  agent: Address;
  shenzhenComponents: Address;
  payroll: Address;
  issuerBank: Address;
}

/** Lotus Lane Trading (Shenzhen): board-mandated treasurer agent on the coin-free consortium rail (FISCO). */
export function lotusShenzhenMandate(d: Deployment, p: LotusParties, opts: { now: number; salt?: string }): Mandate {
  const cpi = addr(d, "ConditionalPaymentInstructions");
  return {
    schema: "yinglong.mandate/v1",
    title: "Lotus Lane Trading (Shenzhen): board treasury mandate",
    ledger: d.ledger,
    jurisdiction: "mainland",
    principal: {
      kind: "company",
      name: "Lotus Lane Trading (Shenzhen) Co. (fictional)",
      did: `did:pkh:eip155:${d.chainId}:${p.account.toLowerCase()}`,
      account: p.account,
    },
    agent: { wallet: p.agent, label: "Lotus Lane treasurer" },
    lineageId: "lotus-shenzhen-treasury",
    salt: opts.salt ?? "1",
    validity: { from: opts.now - 60, until: opts.now + 180 * 86400 },
    assets: [{ symbol: "CNY", address: cpi, decimals: 2 }],
    methods: ["instruct"],
    payees: [
      { id: "shenzhen_components", label: "Shenzhen Components", address: p.shenzhenComponents, category: "supplier" },
      { id: "staff_payroll", label: "Staff payroll account", address: p.payroll, category: "payroll" },
    ],
    trustedIssuers: [{ label: "Harbour Digital Bank", address: p.issuerBank }],
    intermediaries: [],
    tiers: [
      {
        asset: "CNY",
        defaultT1Cap: FEN(50_000),
        newPayeeT1Cap: FEN(1_000),
        t2Ceiling: FEN(200_000),
        maxApprovalWindow: 600,
        categoryT1Caps: [{ category: "payroll", amount: FEN(120_000) }],
      },
    ],
    budgets: [
      {
        asset: "CNY",
        periodStart: 0,
        periodLength: 30 * 86400,
        unlistedCategory: "services",
        caps: [
          { category: "supplier", amount: FEN(300_000) },
          { category: "payroll", amount: FEN(120_000) },
          { category: "services", amount: FEN(5_000) },
        ],
      },
    ],
    reserveFloors: [{ asset: "CNY", amount: FEN(100_000) }],
    velocity: { asset: "CNY", window: 86400, maxCount: 6, maxOutflow: FEN(250_000) },
    suitability: null,
    reputation: null,
    facilitator: null,
    sentences: [
      "Pay approved suppliers up to 300,000 a month and run payroll up to 120,000.",
      "Keep at least 100,000 in the account at all times.",
      "Anything above 50,000 to a supplier needs a director's approval; above 200,000 the board decides.",
      "No more than six payments a day.",
    ],
  };
}

export interface GuestParties {
  account: Address;
  agent: Address;
  cafe: Address;
  issuerBank: Address;
}

/** Judge's Challenge guest mandate: tiny caps, one payee, everything else must be refused or held. */
export function guestMandate(d: Deployment, p: GuestParties, opts: { now: number; salt?: string }): Mandate {
  const tHKD = addr(d, "TestHKD");
  return {
    schema: "yinglong.mandate/v1",
    title: "Judge's Challenge guest agent",
    ledger: d.ledger,
    jurisdiction: "hk",
    principal: { kind: "person", name: "Guest (Judge's Challenge)", did: `did:pkh:eip155:${d.chainId}:${p.account.toLowerCase()}`, account: p.account },
    agent: { wallet: p.agent, label: "Arena agent" },
    lineageId: "judges-challenge",
    salt: opts.salt ?? "1",
    validity: { from: opts.now - 60, until: opts.now + 60 * 86400 },
    assets: [{ symbol: "tHKD", address: tHKD, decimals: 6 }],
    methods: ["transfer"],
    payees: [{ id: "arena_cafe", label: "Arena Cafe", address: p.cafe, category: "food" }],
    trustedIssuers: [{ label: "Harbour Digital Bank", address: p.issuerBank }],
    intermediaries: [],
    tiers: [{ asset: "tHKD", defaultT1Cap: U(10), newPayeeT1Cap: U(1), t2Ceiling: U(50), maxApprovalWindow: 600, categoryT1Caps: [] }],
    budgets: [
      {
        asset: "tHKD",
        periodStart: 0,
        periodLength: 86400,
        unlistedCategory: "services",
        caps: [
          { category: "food", amount: U(40) },
          { category: "services", amount: U(2) },
        ],
      },
    ],
    reserveFloors: [{ asset: "tHKD", amount: U(400) }],
    velocity: { asset: "tHKD", window: 3600, maxCount: 20, maxOutflow: U(40) },
    suitability: { maxRiskClass: 1 },
    reputation: null,
    facilitator: null,
    sentences: ["Buy coffee at Arena Cafe, at most 10 at a time and 40 a day.", "Never let the balance drop below 400.", "Nothing else."],
  };
}

export interface LotusHkParties {
  account: Address;
  agent: Address;
  kowloonForwarders: Address;
  issuerBank: Address;
}

/**
 * Lotus Lane (HK) Ltd: the same treasurer agent identity, re-sealed for Hong Kong. HK test rail (tHKD),
 * supplier payments, and sweeps of idle cash into suitable (risk class <= 2) test money-market products.
 */
export function lotusHkMandate(d: Deployment, p: LotusHkParties, opts: { now: number; salt?: string; did?: string }): Mandate {
  const tHKD = addr(d, "TestHKD");
  return {
    schema: "yinglong.mandate/v1",
    title: "Lotus Lane (HK) Ltd: treasury mandate re-sealed for Hong Kong",
    ledger: d.ledger,
    jurisdiction: "hk",
    principal: { kind: "company", name: "Lotus Lane (HK) Ltd (fictional)", did: opts.did ?? "did:web:lotus-lane.example", account: p.account },
    agent: { wallet: p.agent, label: "Lotus Lane treasurer" },
    lineageId: "lotus-hk-treasury",
    salt: opts.salt ?? "1",
    validity: { from: opts.now - 60, until: opts.now + 180 * 86400 },
    assets: [{ symbol: "tHKD", address: tHKD, decimals: 6 }],
    methods: ["transfer", "transferAndCall"],
    payees: [
      { id: "kowloon_forwarders", label: "Kowloon Forwarders", address: p.kowloonForwarders, category: "supplier" },
      { id: "test_mmf", label: "Test Money Market Fund", address: addr(d, "TestMoneyMarketFund"), category: "treasury" },
      { id: "test_growth", label: "Test Growth Fund", address: addr(d, "TestGrowthFund"), category: "treasury" },
    ],
    trustedIssuers: [{ label: "Harbour Digital Bank", address: p.issuerBank }],
    intermediaries: [{ label: "escrow (ProtectedPayment)", address: addr(d, "ProtectedPayment") }],
    tiers: [{ asset: "tHKD", defaultT1Cap: U(20_000), newPayeeT1Cap: U(100), t2Ceiling: U(150_000), maxApprovalWindow: 600, categoryT1Caps: [] }],
    budgets: [
      {
        asset: "tHKD",
        periodStart: 0,
        periodLength: 30 * 86400,
        unlistedCategory: "services",
        caps: [
          { category: "supplier", amount: U(200_000) },
          { category: "treasury", amount: U(300_000) },
          { category: "services", amount: U(2_000) },
        ],
      },
    ],
    reserveFloors: [{ asset: "tHKD", amount: U(50_000) }],
    velocity: { asset: "tHKD", window: 86400, maxCount: 10, maxOutflow: U(250_000) },
    suitability: { maxRiskClass: 2 },
    reputation: null,
    facilitator: null,
    sentences: [
      "Same treasurer, Hong Kong rules: pay Kowloon Forwarders up to 200,000 a month.",
      "Sweep idle cash into low-risk money-market products only; ask me before the first sweep.",
      "Keep at least 50,000 in the account.",
    ],
  };
}
