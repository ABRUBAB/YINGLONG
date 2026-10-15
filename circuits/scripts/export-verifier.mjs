#!/usr/bin/env node
// Export the bb-generated verifier, compiled by circuits/verifier (solc 0.8.27, london), as a linkable
// bytecode artifact for the main Foundry project and for deployment scripts.
//
//   node circuits/scripts/export-verifier.mjs
//
// Reads  circuits/verifier/out/HonkVerifier.sol/{HonkVerifier,RelationsLib,ZKTranscriptLib}.json
// Writes contracts/src/zk/generated/mandate_compliance/HonkVerifier.artifact.json   (canonical)
//        contracts/test/vectors/zk/HonkVerifier.artifact.json                       (same bytes; tests read it)
//        contracts/src/zk/generated/mandate_compliance/{vk.hex,vk_hash.hex}         (from circuits/build, as hex)
//
// The generated verifier calls two external libraries (RelationsLib, ZKTranscriptLib). Deploy both,
// write their addresses into the verifier creation code at the listed byte offsets, then deploy the
// verifier. Link placeholders are zeroed in the exported bytecode.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanLondon } from "./opcodes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const verifierDir = join(root, "circuits/verifier");
const sourceRel = "circuits/verifier/src/mandate_compliance/HonkVerifier.sol";
const outDir = join(verifierDir, "out/HonkVerifier.sol");
const genDir = join(root, "contracts/src/zk/generated/mandate_compliance");
const vecDir = join(root, "contracts/test/vectors/zk");
const buildDir = join(root, "circuits/build/mandate_compliance");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const load = (name) => JSON.parse(readFileSync(join(outDir, `${name}.json`), "utf8"));
const EIP170 = 24576;

function strip(obj) {
  return obj.startsWith("0x") ? obj.slice(2) : obj;
}

function zeroLinks(hex, refs) {
  let h = strip(hex);
  for (const file of Object.values(refs)) {
    for (const lib of Object.values(file)) {
      for (const r of lib) {
        h = h.slice(0, r.start * 2) + "0".repeat(r.length * 2) + h.slice((r.start + r.length) * 2);
      }
    }
  }
  if (!/^[0-9a-f]*$/.test(h)) throw new Error("unresolved link placeholder left in bytecode");
  return h;
}

function offsets(refs, lib) {
  const all = Object.values(refs).flatMap((file) => file[lib] ?? []);
  for (const r of all) if (r.length !== 20) throw new Error("unexpected link length");
  return all.map((r) => r.start);
}

function immutableOffsets(refs) {
  const all = Object.values(refs ?? {}).flat();
  for (const r of all) if (r.length !== 32) throw new Error("unexpected immutable length");
  return all.map((r) => r.start).sort((a, b) => a - b);
}

const verifier = load("HonkVerifier");
const relations = load("RelationsLib");
const transcript = load("ZKTranscriptLib");

const meta = verifier.metadata;
const settings = meta.settings;
const compiler = {
  solc: meta.compiler.version,
  evmVersion: settings.evmVersion,
  optimizer: settings.optimizer.enabled,
  optimizerRuns: settings.optimizer.runs,
  viaIR: Boolean(settings.viaIR),
  bytecodeHash: settings.metadata?.bytecodeHash ?? "ipfs",
  cborMetadata: settings.metadata?.appendCBOR ?? true,
};
if (compiler.evmVersion !== "london") throw new Error(`expected evm london, got ${compiler.evmVersion}`);

const vBytecode = zeroLinks(verifier.bytecode.object, verifier.bytecode.linkReferences);
const vDeployed = zeroLinks(verifier.deployedBytecode.object, verifier.deployedBytecode.linkReferences);
const rBytecode = strip(relations.bytecode.object);
const rDeployed = strip(relations.deployedBytecode.object);
const tBytecode = strip(transcript.bytecode.object);
const tDeployed = strip(transcript.deployedBytecode.object);

const sizes = {
  HonkVerifier: { runtime: vDeployed.length / 2, initcode: vBytecode.length / 2 },
  RelationsLib: { runtime: rDeployed.length / 2, initcode: rBytecode.length / 2 },
  ZKTranscriptLib: { runtime: tDeployed.length / 2, initcode: tBytecode.length / 2 },
};
for (const [name, s] of Object.entries(sizes)) {
  if (s.runtime > EIP170) throw new Error(`${name} runtime ${s.runtime} B exceeds EIP-170 (${EIP170} B)`);
}

const london = {};
for (const [name, hex] of Object.entries({ HonkVerifier: vDeployed, RelationsLib: rDeployed, ZKTranscriptLib: tDeployed })) {
  london[name] = scanLondon(hex);
  if (london[name].forbidden.length) {
    throw new Error(`${name} uses post-london opcodes: ${JSON.stringify(london[name].forbidden)}`);
  }
}

const artifact = {
  contract: "HonkVerifier",
  circuit: "mandate_compliance",
  proofType: 1,
  source: sourceRel,
  sourceSha256: sha256(readFileSync(join(root, sourceRel))),
  compiler,
  eip170Limit: EIP170,
  sizes,
  londonOpcodeScan: Object.fromEntries(Object.entries(london).map(([k, v]) => [k, { ok: v.forbidden.length === 0, opcodes: v.count }])),
  relationsLib: { bytecode: `0x${rBytecode}`, deployedBytecode: `0x${rDeployed}` },
  transcriptLib: { bytecode: `0x${tBytecode}`, deployedBytecode: `0x${tDeployed}` },
  verifier: {
    bytecode: `0x${vBytecode}`,
    deployedBytecode: `0x${vDeployed}`,
    relationsLibOffsets: offsets(verifier.bytecode.linkReferences, "RelationsLib"),
    transcriptLibOffsets: offsets(verifier.bytecode.linkReferences, "ZKTranscriptLib"),
    deployedRelationsLibOffsets: offsets(verifier.deployedBytecode.linkReferences, "RelationsLib"),
    deployedTranscriptLibOffsets: offsets(verifier.deployedBytecode.linkReferences, "ZKTranscriptLib"),
    // The generated verifier stores N, LOG_N, VK_HASH, the public input count and the MSM size as
    // immutables set from compile-time constants, so they are the same on every chain. They are zero in
    // deployedBytecode; these 32-byte slots are filled at deployment.
    deployedImmutableOffsets: immutableOffsets(verifier.deployedBytecode.immutableReferences),
  },
};

mkdirSync(genDir, { recursive: true });
mkdirSync(vecDir, { recursive: true });
const text = `${JSON.stringify(artifact, null, 2)}\n`;
writeFileSync(join(genDir, "HonkVerifier.artifact.json"), text);
writeFileSync(join(vecDir, "HonkVerifier.artifact.json"), text);
// The binary vk is stored as hex text: raw bytes can decode as CJK code points and trip the repository's
// English-only gate. Convert back with Buffer.from(hex, "hex") (or xxd -r -p) before giving it to bb.
if (existsSync(join(buildDir, "vk"))) {
  writeFileSync(join(genDir, "vk.hex"), `${readFileSync(join(buildDir, "vk")).toString("hex")}\n`);
  writeFileSync(join(genDir, "vk_hash.hex"), `${readFileSync(join(buildDir, "vk_hash")).toString("hex")}\n`);
} else {
  console.warn("circuits/build/mandate_compliance/vk not found (run scripts/build-circuit.sh); vk.hex left unchanged");
}

console.log(JSON.stringify({ compiler, sizes, london: artifact.londonOpcodeScan }, null, 2));
