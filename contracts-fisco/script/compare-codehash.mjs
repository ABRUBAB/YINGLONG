#!/usr/bin/env node
// Compares the runtime code of the framework contracts deployed on FISCO BCOS with the same compiled
// contracts deployed on local anvil chains (chain id 31337 and, if present, 20200), contract by
// contract: address, EXTCODEHASH, and the code hash with every immutable slot zeroed. Differing
// immutables are classified (cached chain id, cached domain separator, address).
//
// Usage (from contracts-fisco/): node script/compare-codehash.mjs
// Reads deployments/fisco-spike.json and deployments/anvil-spike-*.json; writes
// reports/codehash-compare-<date>.json and an `anvilComparison` summary into fisco-spike.json.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_DIR, padHex, strip0x, toQuantity } from "./lib/chain.mjs";

const dep = (f) => join(PROJECT_DIR, "deployments", f);
const fiscoFile = dep("fisco-spike.json");
const fisco = JSON.parse(readFileSync(fiscoFile, "utf8"));
const anvils = ["anvil-spike-31337.json", "anvil-spike-20200.json"]
  .filter((f) => existsSync(dep(f)))
  .map((f) => ({ file: f, doc: JSON.parse(readFileSync(dep(f), "utf8")) }));
if (!anvils.length) throw new Error("no anvil-spike-*.json found; run script/spike.mjs --target anvil first");

const lc = (s) => (s || "").toLowerCase();

// AST id -> "Contract.variable" for every immutable, from the forge artifacts (foundry.toml: ast = true).
const astNames = (() => {
  const names = {};
  const walk = (node, owner) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, owner));
    const nextOwner = node.nodeType === "ContractDefinition" ? node.name : owner;
    if (node.nodeType === "VariableDeclaration" && node.mutability === "immutable") names[node.id] = `${owner}.${node.name}`;
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, nextOwner);
  };
  const outDir = join(PROJECT_DIR, "out");
  for (const dir of readdirSync(outDir)) {
    if (!dir.endsWith(".sol")) continue;
    for (const f of readdirSync(join(outDir, dir))) {
      const a = JSON.parse(readFileSync(join(outDir, dir, f), "utf8"));
      if (a.ast) walk(a.ast, null);
    }
  }
  return names;
})();

function classify(id, fiscoValue, anvilValue, fCtx, aCtx) {
  const name = astNames[id] || `ast id ${id}`;
  const isChainId = (val, cid) => lc(strip0x(val)) === lc(strip0x(padHex(toQuantity(cid))));
  if (isChainId(fiscoValue, fCtx.chainId) && isChainId(anvilValue, aCtx.chainId)) {
    return `${name} (chain id: FISCO ${fCtx.chainId}, anvil ${aCtx.chainId})`;
  }
  if (lc(strip0x(fiscoValue)) === lc(strip0x(padHex(fCtx.address)))) return `${name} (own address)`;
  return name;
}

function compare(name, f, a, fCtx, aCtx) {
  const row = {
    contract: name,
    fiscoAddress: f.address,
    anvilAddress: a.address,
    sameAddress: lc(f.address) === lc(a.address),
    fiscoExtcodehash: f.extcodehash,
    anvilExtcodehash: a.extcodehash,
    extcodehashEqual: lc(f.extcodehash) === lc(a.extcodehash),
    immutableSlots: f.immutableSlots ?? 0,
  };
  if (f.maskedCodeHash && a.maskedCodeHash) row.codeHashWithImmutablesZeroedEqual = lc(f.maskedCodeHash) === lc(a.maskedCodeHash);
  if (!row.extcodehashEqual && f.immutableValues && a.immutableValues) {
    row.differingImmutables = Object.keys(f.immutableValues)
      .filter((id) => lc(f.immutableValues[id]) !== lc(a.immutableValues[id]))
      .map((id) => ({
        astId: id,
        fisco: f.immutableValues[id],
        anvil: a.immutableValues[id],
        meaning: classify(id, f.immutableValues[id], a.immutableValues[id], { ...fCtx, address: f.address }, aCtx),
      }));
  }
  if (row.extcodehashEqual) row.explanation = "identical runtime bytecode";
  else if (row.codeHashWithImmutablesZeroedEqual && row.differingImmutables?.length)
    row.explanation = `identical except immutables set in the constructor: ${[...new Set(row.differingImmutables.map((d) => d.meaning))].join(", ")}`;
  else row.explanation = "runtime differs beyond immutables (investigate)";
  return row;
}

const comparisons = anvils.map(({ file, doc }) => {
  const fCtx = { chainId: fisco.chain.ethChainId, domainHash: fisco.checks?.delegationManager?.domainHash };
  const aCtx = { chainId: doc.chain.ethChainId, domainHash: doc.checks?.delegationManager?.domainHash };
  const rows = Object.keys(fisco.contracts)
    .filter((n) => doc.contracts[n])
    .map((n) => compare(n, fisco.contracts[n], doc.contracts[n], fCtx, aCtx));
  return {
    anvilFile: `deployments/${file}`,
    anvilChainId: doc.chain.ethChainId,
    fiscoChainId: fisco.chain.ethChainId,
    anvilHardfork: "london",
    allAddressesEqual: rows.every((r) => r.sameAddress),
    identicalRuntime: rows.filter((r) => r.extcodehashEqual).map((r) => r.contract),
    differOnlyInImmutables: rows.filter((r) => !r.extcodehashEqual && r.codeHashWithImmutablesZeroedEqual).map((r) => r.contract),
    differOtherwise: rows.filter((r) => !r.extcodehashEqual && !r.codeHashWithImmutablesZeroedEqual).map((r) => r.contract),
    perContract: rows,
  };
});

const d = new Date();
const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const report = {
  schema: "yinglong.codehash-compare/1",
  generatedAt: d.toISOString(),
  method:
    "Same forge artifacts (solc 0.8.23, london, 200 runs, no metadata hash) deployed by the same deployer key from nonce 0 on each chain. EXTCODEHASH read on-chain with the opcode; masked hash zeroes every immutable slot listed in the artifact's immutableReferences.",
  comparisons,
};
writeFileSync(join(PROJECT_DIR, "reports", `codehash-compare-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);

fisco.anvilComparison = comparisons.map((c) => ({
  anvilFile: c.anvilFile,
  anvilChainId: c.anvilChainId,
  allAddressesEqual: c.allAddressesEqual,
  identicalRuntime: c.identicalRuntime,
  differOnlyInImmutables: c.differOnlyInImmutables,
  differOtherwise: c.differOtherwise,
  perContract: Object.fromEntries(c.perContract.map((r) => [r.contract, { extcodehashEqual: r.extcodehashEqual, explanation: r.explanation }])),
}));
fisco.anvilComparisonReport = `reports/codehash-compare-${date}.json`;
writeFileSync(fiscoFile, `${JSON.stringify(fisco, null, 2)}\n`);

for (const c of comparisons) {
  console.log(`anvil chain ${c.anvilChainId}: identical ${c.identicalRuntime.length}, immutables-only ${c.differOnlyInImmutables.length}, other ${c.differOtherwise.length}`);
  for (const r of c.perContract) console.log(`  ${r.contract.padEnd(28)} ${r.extcodehashEqual ? "EQUAL" : "DIFF "} ${r.explanation}`);
}
