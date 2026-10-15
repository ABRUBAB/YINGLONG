#!/usr/bin/env node
// Export ABIs from Foundry build output into packages/sdk/src/abi/*.ts (typed `as const` for viem).
// Run after `forge build` in contracts/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "contracts", "out");
const dest = resolve(root, "packages", "sdk", "src", "abi");
mkdirSync(dest, { recursive: true });

const CONTRACTS = [
  ["DelegationManager.sol", "DelegationManager"],
  ["HybridDeleGator.sol", "HybridDeleGator"],
  ["MultiSigDeleGator.sol", "MultiSigDeleGator"],
  ["EntryPoint.sol", "EntryPoint"],
  ["SimpleFactory.sol", "SimpleFactory"],
  ["PayeeBook.sol", "PayeeBook"],
  ["MandateRegistry.sol", "MandateRegistry"],
  ["KillSwitchRegistry.sol", "KillSwitchRegistry"],
  ["YinglongPassportRegistry.sol", "YinglongPassportRegistry"],
  ["AccountabilityLedger.sol", "AccountabilityLedger"],
  ["CategoryBudgetEnforcer.sol", "CategoryBudgetEnforcer"],
  ["VelocityEnforcer.sol", "VelocityEnforcer"],
  ["CoSignEnforcer.sol", "CoSignEnforcer"],
  ["VetoTimelockEnforcer.sol", "VetoTimelockEnforcer"],
  ["JurisdictionEnforcer.sol", "JurisdictionEnforcer"],
  ["MandateBindingEnforcer.sol", "MandateBindingEnforcer"],
  ["TestUnits.sol", "TestUnits"],
  ["ProductRegistry.sol", "ProductRegistry"],
  ["TestMoneyMarketFund.sol", "TestMoneyMarketFund"],
  ["ProtectedPayment.sol", "ProtectedPayment"],
  ["SignedQuoteSettlement.sol", "SignedQuoteSettlement"],
  ["ConditionalPaymentInstructions.sol", "ConditionalPaymentInstructions"],
  ["Errors.sol", null],
];

const index = [];
const errorAbi = new Map();
for (const [file, name] of CONTRACTS) {
  if (!name) continue;
  const p = resolve(out, file, `${name}.json`);
  if (!existsSync(p)) {
    console.error(`missing ${p}`);
    process.exit(1);
  }
  const abi = JSON.parse(readFileSync(p, "utf8")).abi;
  for (const item of abi) if (item.type === "error") errorAbi.set(`${item.name}(${item.inputs.map((i) => i.type).join(",")})`, item);
  writeFileSync(resolve(dest, `${name}.ts`), `export const ${name}Abi = ${JSON.stringify(abi, null, 2)} as const;\n`);
  index.push(`export { ${name}Abi } from "./${name}";`);
}
// One combined error ABI so any revert from any YINGLONG contract can be decoded by name.
writeFileSync(resolve(dest, "YinglongErrors.ts"), `export const YinglongErrorsAbi = ${JSON.stringify([...errorAbi.values()], null, 2)} as const;\n`);
index.push(`export { YinglongErrorsAbi } from "./YinglongErrors";`);
writeFileSync(resolve(dest, "index.ts"), `${index.join("\n")}\n`);
console.log(`exported ${index.length} ABI modules to packages/sdk/src/abi`);
