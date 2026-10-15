// Cross-implementation vectors for tools/verify-py, produced by the TypeScript reference itself.
// Run from the repository root:  npx tsx tools/verify-py/scripts/ts-vectors.ts
// Writes tools/verify-py/tests/vectors/ts-vectors.json (consumed by tests/test_ts_vectors.py).
// Every value below is computed by packages/sdk and packages/mandate; nothing is hand-written.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildMerkle, docHash, merkleProof, receiptDomain, receiptHash, verifyMerkle, type Receipt } from "../../../packages/sdk/src/index";
import { loadDeployment } from "../../../packages/sdk/src/server";
import {
  canonicalHash,
  canonicalJson,
  caveatHash,
  compileMandate,
  decompile,
  delegationHash,
  formatUnits,
  hashRingAscii,
  hashRingGeometry,
  lotusShenzhenMandate,
  nadiaMandate,
  namesFor,
  sentence,
  textHash,
  tickDifference,
  type Caveat,
  type DecodedRule,
  type Mandate,
  type Names,
} from "../../../packages/mandate/src/index";

type Hex = `0x${string}`;
type Address = `0x${string}`;
const big = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const H = (s: string) => textHash(s) as Hex;
const NOW = 1_792_000_000;

// ---------------------------------------------------------------- canonical JSON
const cp = (...xs: number[]) => String.fromCodePoint(...xs);
const canonicalInputs: unknown[] = [
  { b: 1, a: [2, { d: "x", c: null }] },
  { z: true, y: false, x: null, w: [], v: {}, u: 0, t: -7, s: 9007199254740991 },
  { [cp(0xe000)]: "private use key", [cp(0x1f600)]: "astral key", a: "ascii", [cp(0xe9)]: "latin" },
  { s: `quote " backslash \\ slash / nl \n cr \r tab \t bs \b ff \f ctl ${cp(1)}${cp(0x1f)} del ${cp(0x7f)} ls ${cp(0x2028)} ps ${cp(0x2029)}` },
  { s: cp(0x0986, 0x09ae, 0x09be, 0x09b0), e: cp(0x1f409), lone: "\ud800x" },
  { nested: { k2: [{ b: "2", a: "1" }], k1: { y: [1, [2, [3]]], x: "" } } },
];
const canonical = canonicalInputs.map((value) => ({ value, canonicalJson: canonicalJson(value), hash: canonicalHash(value) }));

// ---------------------------------------------------------------- docHash (JSON.stringify, insertion order)
const storeJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? { $n: x.toString() } : x)));
const docInputs: unknown[] = [
  { a: 1e-7, b: 0.1, c: 1e21, d: 123.456, e: -0, f: 5e-324, g: 1.7976931348623157e308, h: 100, i: 0.000001, j: 123e20, k: -1.5e-10, l: 2 ** 53 + 2 },
  { big: 5n, nested: [{ z: 2n ** 70n, y: "text" }], t: true, u: null, order: { b: 1, a: 2 } },
  { s: `bangla ${cp(0x0986, 0x09ae)} quote " nl 
 tab 	`, e: cp(0x1f409), arr: [1, "2", [3.25]] },
];
const docs = docInputs.map((v) => ({ value: storeJson(v), hash: docHash(v) }));

// ---------------------------------------------------------------- delegation hashes
const caveatSets: Caveat[][] = [
  [],
  [{ enforcer: A(0xe1), terms: "0x", args: "0x" }],
  [
    { enforcer: A(0xe1), terms: "0x00", args: "0xdeadbeef" },
    { enforcer: "0xdD08Ffa06fDCCf17b3E3Be6bd3cEe55ce46b89F7", terms: H("terms-1"), args: "0x" },
    { enforcer: A(0xe3), terms: `0x${"ab".repeat(333)}`, args: `0x${"01".repeat(64)}` },
  ],
];
const delegations = caveatSets.map((caveats, i) => {
  const d = { delegate: A(0x100 + i), delegator: A(0xa11ce + i), authority: (i === 2 ? H("parent") : `0x${"ff".repeat(32)}`) as Hex, caveats, salt: i === 2 ? 2n ** 255n + 7n : BigInt(i) };
  return { ...d, caveatHashes: caveats.map(caveatHash), delegationHash: delegationHash(d) };
});

// ---------------------------------------------------------------- mandate variants (compiler + decompiler)
const anvil = loadDeployment("anvil");
const decks = [anvil];
let fisco: ReturnType<typeof loadDeployment> | undefined;
try {
  fisco = loadDeployment("fisco");
  decks.push(fisco);
} catch {
  /* no FISCO deployment yet */
}
const nadiaParties = { account: A(0xa11ce), agent: A(1), harbourHomes: A(0x101), hbuBursar: A(0x102), foodMart: A(0x103), issuerHbu: A(0x201), issuerBank: A(0x202) };
function variants(d: typeof anvil): { name: string; mandate: Mandate }[] {
  const base = nadiaMandate(d, nadiaParties, { now: NOW });
  const out: { name: string; mandate: Mandate }[] = [{ name: `${d.ledger}:nadia`, mandate: base }];
  const v1 = structuredClone(base);
  v1.facilitator = A(0xfac);
  v1.velocity = null;
  v1.suitability = null;
  v1.payees[0]!.label = `Harbour Homes ${cp(0x0986, 0x09ae)}`;
  out.push({ name: `${d.ledger}:nadia-facilitator-no-velocity`, mandate: v1 });
  const v2 = structuredClone(base);
  v2.budgets[0]!.periodLength = 7 * 3600;
  v2.budgets[1]!.periodLength = 90;
  v2.velocity!.window = 3600;
  v2.trustedIssuers = [];
  v2.intermediaries = [];
  v2.methods = ["transfer"];
  out.push({ name: `${d.ledger}:nadia-short-periods`, mandate: v2 });
  const v3 = structuredClone(base) as Mandate & { extraField?: string };
  v3.extraField = "stripped by the schema, so the hash is unchanged";
  out.push({ name: `${d.ledger}:nadia-extra-key`, mandate: v3 });
  out.push({
    name: `${d.ledger}:lotus`,
    mandate: lotusShenzhenMandate(d, { account: A(0xb0b), agent: A(2), shenzhenComponents: A(0x301), payroll: A(0x302), issuerBank: A(0x202) }, { now: NOW, salt: "42" }),
  });
  return out;
}
const mandates = decks.flatMap((d) =>
  variants(d).map(({ name, mandate }) => {
    const c = compileMandate(mandate, d);
    const { rules, sentences } = decompile(c.caveats, d, namesFor(d, c.mandate));
    const ms = decompile(c.caveats, d, namesFor(d, c.mandate), "ms").sentences;
    return {
      name,
      deployment: d.ledger,
      mandate,
      mandateHash: c.mandateHash,
      caveats: c.caveats,
      delegationHash: c.delegationHash,
      rules: JSON.parse(JSON.stringify(rules, big)),
      sentences,
      sentencesMs: ms,
    };
  }),
);
const compileErrors: { name: string; mandate: Mandate }[] = [];
{
  const wrongLedger = structuredClone(nadiaMandate(anvil, nadiaParties, { now: NOW }));
  wrongLedger.ledger = "base-sepolia";
  compileErrors.push({ name: "ledger mismatch", mandate: wrongLedger });
  const overlap = structuredClone(nadiaMandate(anvil, nadiaParties, { now: NOW }));
  overlap.assets[1]!.address = anvil.contracts.PayeeBook.address;
  compileErrors.push({ name: "allowlist overlaps forbidden set", mandate: overlap });
}

// ---------------------------------------------------------------- sentences for synthetic rules
const names: Names = {
  label: new Map([[A(0xa1).toLowerCase(), "tTEST"], [A(0xf1).toLowerCase(), "Facilitator One"]]),
  decimals: new Map([[A(0xa1).toLowerCase(), 3]]),
};
const synthetic: DecodedRule[] = [
  { kind: "valueLte", max: 12345n },
  { kind: "agentLineage", passport: A(9), ownerDidHash: H("did"), facilitator: A(0xf1) },
  { kind: "agentLineage", passport: A(9), ownerDidHash: H("did"), facilitator: A(0xf2) },
  { kind: "verifiedPayee", payeeBook: A(5), passport: A(9), issuers: [], intermediaries: [] },
  { kind: "verifiedPayee", payeeBook: A(5), passport: A(9), issuers: [A(0x77)], intermediaries: [A(0x78), A(0x79), A(0x7a)] },
  { kind: "categoryBudget", payeeBook: A(5), asset: A(0xa1), periodStart: 0n, periodLength: 86400n, unlistedCategory: "other", caps: [{ category: "food", amount: 1234567n }] },
  { kind: "categoryBudget", payeeBook: A(5), asset: A(0xa1), periodStart: 0n, periodLength: 3600n, unlistedCategory: "other", caps: [] },
  { kind: "categoryBudget", payeeBook: A(5), asset: A(0xa2), periodStart: 0n, periodLength: 7200n, unlistedCategory: "other", caps: [{ category: "rent", amount: 10n ** 30n }] },
  { kind: "velocity", asset: A(0xa1), window: 120n, maxCount: 3, maxOutflow: 1000n },
  { kind: "velocity", asset: A(0xa1), window: 90n, maxCount: 3, maxOutflow: 1n },
  { kind: "velocity", asset: A(0xa1), window: 2592000000n, maxCount: 1, maxOutflow: 999999999n },
  { kind: "reserveFloor", asset: A(0xa3), amount: 0n },
  { kind: "unknown", enforcer: A(0xbad), terms: "0x1234" },
];
const sentences = synthetic.map((rule) => ({ rule: JSON.parse(JSON.stringify(rule, big)), s: sentence(rule, names, "s"), ms: sentence(rule, names, "ms") }));
const units = [
  [0n, 0], [5n, 0], [1234567n, 0], [1n, 6], [1000000n, 6], [1500000n, 6], [123456789012345678901234567890n, 18],
  [-2500n, 2], [10n, 1], [100n, 2], [99n, 2], [1234500n, 3],
].map(([v, dd]) => ({ amount: (v as bigint).toString(), decimals: dd as number, text: formatUnits(v as bigint, dd as number) }));

// ---------------------------------------------------------------- Hash Ring
const ringHashes = ["ring-a", "ring-b", "ring-c"].map(H).concat([`0x${"00".repeat(32)}` as Hex, `0x${"ff".repeat(32)}` as Hex]);
const rings = ringHashes.map((h) => ({ hash: h, geometry: hashRingGeometry(h), revoked: hashRingGeometry(h, { revoked: true }), radius2: hashRingGeometry(h, { radius: 2.5 }), ascii: hashRingAscii(h) }));
const tickDiffs = [[0, 1], [1, 2], [3, 4]].map(([i, j]) => ({ a: ringHashes[i!]!, b: ringHashes[j!]!, diff: tickDifference(ringHashes[i!]!, ringHashes[j!]!) }));

// ---------------------------------------------------------------- receipts and Merkle trees
const tiers = ["T0", "T1", "T2", "T3", "T4", "ASK"] as const;
const outcomes = ["confirmed", "reverted", "rejected_policy", "awaiting_approval", "expired", "unknown", "asked"] as const;
const sources = ["live-base", "live-fisco", "anvil-bench"] as const;
const mkReceipt = (i: number, chainId: number, prev: Hex): Receipt => ({
  receiptId: H(`receipt-${i}`),
  chainId,
  agentId: BigInt(i + 1),
  mandateHash: H(`mandate-${i % 2}`),
  delegationHash: H(`delegation-${i % 2}`),
  intentHash: H(`intent-${i}`),
  planHash: H(`plan-${i}`),
  policyDecisionHash: H(`policy-${i}`),
  stateReadsHash: H(`state-${i}`),
  counterpartyCheckHash: H(`counterparty-${i}`),
  simulationHash: H(`simulation-${i}`),
  tier: tiers[i % tiers.length]!,
  approvalSigHash: i % 3 === 0 ? (`0x${"00".repeat(32)}` as Hex) : H(`approval-${i}`),
  txHash: H(`tx-${i}`),
  outcome: outcomes[i % outcomes.length]!,
  explanationHash: H(`explanation-${i}`),
  aigcHash: H(`aigc-${i}`),
  source: sources[i % sources.length]!,
  prevReceiptHash: prev,
  timestamp: BigInt(NOW + i * 17),
});
const receiptSets = decks.map((d) => {
  const domain = receiptDomain(d.contracts.AccountabilityLedger.address, d.chainId, d.domainSalt as Hex);
  const receipts: Receipt[] = [];
  const hashes: Hex[] = [];
  let prev = `0x${"00".repeat(32)}` as Hex;
  for (let i = 0; i < 9; i++) {
    const r = mkReceipt(i, d.chainId, prev);
    receipts.push(r);
    prev = receiptHash(r, domain);
    hashes.push(prev);
  }
  return { ledger: d.ledger, domain, receipts: JSON.parse(JSON.stringify(receipts, big)), hashes };
});
const merkle = [1, 2, 3, 4, 5, 7, 8, 9].map((n) => {
  const leaves = receiptSets[0]!.hashes.slice(0, n);
  const tree = buildMerkle(leaves);
  const proofs = leaves.map((_, i) => merkleProof(tree, i));
  if (!leaves.every((l, i) => verifyMerkle(l, proofs[i]!, tree.root))) throw new Error("merkle self-check failed");
  return { leaves, root: tree.root, layers: tree.layers, proofs };
});

const out = {
  description: "Generated by tools/verify-py/scripts/ts-vectors.ts from packages/sdk and packages/mandate; do not edit by hand.",
  deployments: decks.map((d) => d.ledger),
  canonical,
  docs,
  delegations: JSON.parse(JSON.stringify(delegations, big)),
  mandates: JSON.parse(JSON.stringify(mandates, big)),
  compileErrors,
  sentences,
  units,
  rings,
  tickDiffs,
  receipts: receiptSets,
  merkle,
};
const dir = resolve(import.meta.dirname, "..", "tests", "vectors");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "ts-vectors.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${resolve(dir, "ts-vectors.json")}: ${canonical.length} canonical, ${delegations.length} delegations, ${mandates.length} mandates, ${rings.length} rings, ${receiptSets.length} receipt sets, ${merkle.length} trees`);
