#!/usr/bin/env node
// Write circuits/MANIFEST.json (hashes, versions, sizes, gas) from the build outputs, and refresh the
// generated block of circuits/README.md. Every number in that block comes from this script.
//
//   (cd contracts && forge test --match-path "test/zk/*" --json -vv > ../circuits/build/forge-zk-tests.json)
//   node circuits/scripts/manifest.mjs
//
// Inputs that are missing (for example no forge JSON on a fresh clone) keep their previous MANIFEST values.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanLondon } from "./opcodes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const p = (rel) => join(root, rel);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const fileSha = (rel) => sha(readFileSync(p(rel)));
const readJson = (rel) => JSON.parse(readFileSync(p(rel), "utf8"));
const maybeJson = (rel) => (existsSync(p(rel)) ? readJson(rel) : undefined);

const MANIFEST = "circuits/MANIFEST.json";
const README = "circuits/README.md";
const prev = maybeJson(MANIFEST) ?? {};

// ---- toolchain ----
const buildScript = readFileSync(p("circuits/scripts/build-circuit.sh"), "utf8");
const pin = (name) => new RegExp(`${name}="([^"]+)"`).exec(buildScript)?.[1];
const pkgVersion = (name) => maybeJson(`circuits/node_modules/${name}/package.json`)?.version ?? null;
const circuitJson = readJson("circuits/mandate_compliance/target/mandate_compliance.json");
const artifact = readJson("contracts/src/zk/generated/mandate_compliance/HonkVerifier.artifact.json");
const circuitsPkg = readJson("circuits/package.json");

const toolchain = {
  nargo: pin("NARGO_VERSION"),
  noirc: circuitJson.noir_version,
  bb: pin("BB_VERSION"),
  noir_js: circuitsPkg.dependencies["@noir-lang/noir_js"],
  "bb.js": circuitsPkg.dependencies["@aztec/bb.js"],
  installed: { noir_js: pkgVersion("@noir-lang/noir_js"), "bb.js": pkgVersion("@aztec/bb.js") },
  verifierSolc: artifact.compiler.solc,
  projectSolc: "0.8.23",
  evmVersion: artifact.compiler.evmVersion,
  foundry: "1.8.5",
};
if (toolchain.noir_js !== toolchain.nargo || toolchain["bb.js"] !== toolchain.bb) {
  throw new Error("noir_js / bb.js pins differ from nargo / bb: proofs would not match the verifier");
}

// ---- circuit ----
const gates = maybeJson("circuits/mandate_compliance/target/gates.json")?.functions?.[0];
const verifierSrc = readFileSync(p("circuits/verifier/src/mandate_compliance/HonkVerifier.sol"), "utf8");
const constant = (name) => new RegExp(`uint256 constant ${name} = (\\w+);`).exec(verifierSrc)?.[1];
const publicInputs = circuitJson.abi.parameters.filter((x) => x.visibility === "public").map((x) => x.name);

const circuit = {
  name: "mandate_compliance",
  proofType: 1,
  statement:
    "Knows (cap, allowlistRoot, expiry, salt) opening mandateCommitment, a depth-8 Poseidon2 path putting payee in the allowlist, and (oldTotal, oldBlind) opening oldRunningCommitment, with claimedTime <= expiry, oldTotal + amount <= cap (u128, no overflow) and newRunningCommitment = Poseidon2(oldTotal + amount, newBlind).",
  publicInputs,
  firstPaymentConvention: "oldRunningCommitment = Poseidon2(0, 0) = 0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1",
  hash: "Poseidon2 (barretenberg sponge, BN254, width 4, rate 3, IV = len * 2^64)",
  allowlistTreeDepth: 8,
  acirOpcodes: gates?.acir_opcodes ?? prev.circuit?.acirOpcodes,
  circuitSize: gates?.circuit_size ?? prev.circuit?.circuitSize,
  dyadicSize: Number(constant("N")),
  logN: Number(constant("LOG_N")),
  files: {
    "circuits/mandate_compliance/src/main.nr": fileSha("circuits/mandate_compliance/src/main.nr"),
    "circuits/mandate_compliance/Nargo.toml": fileSha("circuits/mandate_compliance/Nargo.toml"),
    "circuits/mandate_compliance/target/mandate_compliance.json": fileSha("circuits/mandate_compliance/target/mandate_compliance.json"),
  },
  acirBytecodeSha256: sha(Buffer.from(circuitJson.bytecode, "base64")),
  abiSha256: sha(JSON.stringify(circuitJson.abi)),
  artifactNote:
    "The compiled JSON embeds the build directory in file_map, so its file hash depends on where nargo ran; acirBytecodeSha256 and abiSha256 do not and are what a rebuild must match.",
};

// ---- verification key and verifier ----
const vkHex = readFileSync(p("contracts/src/zk/generated/mandate_compliance/vk.hex"), "utf8").trim();
const vkHashHex = readFileSync(p("contracts/src/zk/generated/mandate_compliance/vk_hash.hex"), "utf8").trim();
const vkHashConst = constant("VK_HASH");
if (`0x${vkHashHex}` !== vkHashConst) throw new Error("vk_hash differs from the verifier's VK_HASH constant");

const verificationKey = {
  flavour: "UltraHonk, zero knowledge, keccak oracle (bb write_vk --scheme ultra_honk --oracle_hash keccak; same as -t evm)",
  file: "contracts/src/zk/generated/mandate_compliance/vk.hex",
  vkBinarySha256: sha(Buffer.from(vkHex, "hex")),
  vkBinaryBytes: vkHex.length / 2,
  vkHash: `0x${vkHashHex}`,
  vkHashMatchesVerifierConstant: true,
};

const verifier = {
  source: "circuits/verifier/src/mandate_compliance/HonkVerifier.sol",
  sourceSha256: fileSha("circuits/verifier/src/mandate_compliance/HonkVerifier.sol"),
  sourceNote:
    "Verbatim bb 5.2.1 output (pragma ^0.8.27, require with custom errors). Compiled in the standalone project circuits/verifier with solc 0.8.27 for london; never edited or split.",
  artifact: "contracts/src/zk/generated/mandate_compliance/HonkVerifier.artifact.json",
  artifactSha256: fileSha("contracts/src/zk/generated/mandate_compliance/HonkVerifier.artifact.json"),
  testCopySha256: fileSha("contracts/test/vectors/zk/HonkVerifier.artifact.json"),
  compiler: artifact.compiler,
  sizes: artifact.sizes,
  eip170Limit: artifact.eip170Limit,
  londonOpcodeScan: artifact.londonOpcodeScan,
  numberOfPublicInputsInclPairingPoints: Number(constant("NUMBER_OF_PUBLIC_INPUTS")),
};
if (verifier.artifactSha256 !== verifier.testCopySha256) throw new Error("test copy of the verifier artifact is stale");

// ---- our contracts ----
const ours = ["IZKVerifierRouter", "ZKErrors", "ZKVerifierRouter", "ZKMandateEnforcer"];
const contracts = {};
for (const name of ours) {
  const src = `contracts/src/zk/${name}.sol`;
  const entry = { source: src, sourceSha256: fileSha(src) };
  const out = maybeJson(`contracts/out/${name}.sol/${name}.json`);
  const code = out?.deployedBytecode?.object;
  if (code && code.length > 2) {
    const scan = scanLondon(code);
    entry.runtimeBytes = (code.length - 2) / 2;
    entry.immutables = "none (checked by test_noImmutables_runtimeBytecodeIsChainIndependent)";
    entry.londonOpcodeScan = { ok: scan.forbidden.length === 0, opcodes: scan.count };
  } else if (prev.contracts?.[name]?.runtimeBytes) {
    Object.assign(entry, { runtimeBytes: prev.contracts[name].runtimeBytes, londonOpcodeScan: prev.contracts[name].londonOpcodeScan });
  }
  contracts[name] = entry;
}

// ---- fixtures, proving, gas ----
const fx = readJson("contracts/test/vectors/zk/mandate_compliance.fixtures.json");
const proofBytes = (fx.cases.p1.proof.length - 2) / 2;
const fixtures = {
  file: "contracts/test/vectors/zk/mandate_compliance.fixtures.json",
  sha256: fileSha("contracts/test/vectors/zk/mandate_compliance.fixtures.json"),
  cases: Object.keys(fx.cases).length + Object.keys(fx.integration?.cases ?? {}).length,
  proofBytes,
  proveMillisTotal: fx.proveMillisTotal,
  proveMillisNote: "bb.js WASM on the development PC (Windows 11, Node 22.14), including backend start-up; indicative only",
};

let gas = prev.gas;
let tests = prev.tests;
const forge = maybeJson("circuits/build/forge-zk-tests.json");
if (forge) {
  gas = {};
  let passed = 0;
  let total = 0;
  for (const suite of Object.values(forge)) {
    for (const r of Object.values(suite.test_results)) {
      total++;
      if (r.status === "Success") passed++;
      for (const line of r.decoded_logs ?? []) {
        const m = /^(gas\.zk\.[\w.]+): (\d+)$/.exec(line);
        if (m) gas[m[1].slice("gas.zk.".length)] = Number(m[2]);
      }
    }
  }
  tests = { foundry: { suites: Object.keys(forge), passed, total } };
  gas.note = "Foundry (london, solc 0.8.23 for our contracts), measured with gasleft() around the call; excludes the 21000 base and calldata cost of the outer transaction";
}

const manifest = {
  schema: 1,
  generatedBy: "circuits/scripts/manifest.mjs",
  label: "Test build. Not audited. Test units only.",
  toolchain,
  circuit,
  verificationKey,
  verifier,
  contracts,
  fixtures,
  gas,
  tests,
};
writeFileSync(p(MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

// ---- README generated block ----
if (existsSync(p(README))) {
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "n/a");
  const s = verifier.sizes;
  const lines = [
    "<!-- BEGIN GENERATED: circuits/scripts/manifest.mjs (do not edit by hand) -->",
    "| Item | Value |",
    "|---|---|",
    `| Toolchain | nargo ${toolchain.nargo}, bb ${toolchain.bb}, noir_js ${toolchain.noir_js}, bb.js ${toolchain["bb.js"]}, verifier solc ${toolchain.verifierSolc}, project solc ${toolchain.projectSolc}, evm ${toolchain.evmVersion} |`,
    `| Circuit | ${fmt(circuit.acirOpcodes)} ACIR opcodes, ${fmt(circuit.circuitSize)} gates, dyadic size 2^${circuit.logN} |`,
    `| Public inputs | ${publicInputs.length}: ${publicInputs.join(", ")} |`,
    `| Proof size | ${fmt(proofBytes)} bytes |`,
    `| HonkVerifier runtime | ${fmt(s.HonkVerifier.runtime)} B (EIP-170 limit ${fmt(verifier.eip170Limit)} B) |`,
    `| RelationsLib / ZKTranscriptLib runtime | ${fmt(s.RelationsLib.runtime)} B / ${fmt(s.ZKTranscriptLib.runtime)} B |`,
    `| ZKMandateEnforcer / ZKVerifierRouter runtime | ${fmt(contracts.ZKMandateEnforcer.runtimeBytes)} B / ${fmt(contracts.ZKVerifierRouter.runtimeBytes)} B |`,
    `| Post-london opcodes in reachable code | ${Object.values(verifier.londonOpcodeScan).every((x) => x.ok) && ours.every((n) => contracts[n].londonOpcodeScan?.ok !== false) ? "none" : "FOUND"} |`,
    `| Gas: HonkVerifier.verify | ${fmt(gas?.["honkVerifier.verify"])} |`,
    `| Gas: router.verifyProof | ${fmt(gas?.["router.verifyProof"])} |`,
    `| Gas: enforcer beforeHook (first / later payment) | ${fmt(gas?.["beforeHook.firstPayment"])} / ${fmt(gas?.["beforeHook.laterPayment"])} |`,
    `| Gas: DelegationManager.redeemDelegations with the ZK caveat (first / later) | ${fmt(gas?.["redeemDelegations.firstPayment"])} / ${fmt(gas?.["redeemDelegations.laterPayment"])} |`,
    `| Foundry tests | ${tests?.foundry ? `${tests.foundry.passed}/${tests.foundry.total} passed` : "n/a"} |`,
    `| vk hash | \`${verificationKey.vkHash}\` |`,
    `| SHA-256 main.nr | \`${circuit.files["circuits/mandate_compliance/src/main.nr"]}\` |`,
    `| SHA-256 ACIR bytecode | \`${circuit.acirBytecodeSha256}\` |`,
    `| SHA-256 vk (binary) | \`${verificationKey.vkBinarySha256}\` |`,
    `| SHA-256 HonkVerifier.sol | \`${verifier.sourceSha256}\` |`,
    "<!-- END GENERATED -->",
  ];
  const text = readFileSync(p(README), "utf8");
  const re = /<!-- BEGIN GENERATED: circuits\/scripts\/manifest\.mjs[\s\S]*?<!-- END GENERATED -->/;
  if (re.test(text)) writeFileSync(p(README), text.replace(re, lines.join("\n")));
}

console.log(`wrote ${MANIFEST}`);
