// Deploy the stateful ZK private-mandate stack to one ledger and append it to contracts/deployments/<ledger>.json:
//   RelationsLib, ZKTranscriptLib -> HonkVerifier (linked) -> ZKVerifierRouter (registrar = deployer),
//   registerVerifier(0x01, HonkVerifier) -> ZKMandateEnforcer.
// Usage: npx tsx apps/agent/scripts/deploy-zk.ts <anvil|fisco|base-sepolia>
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ledger as profileOf, type LedgerName } from "@yinglong/sdk";
import { repoRoot, rolePrivateKey } from "@yinglong/sdk/server";

const name = process.argv[2] as LedgerName;
const p = profileOf(name);
const root = repoRoot();
const chain = defineChain({ id: p.chainId, name: p.label, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [p.rpcUrl] } } });
const account = privateKeyToAccount(rolePrivateKey("deployer"));
const pub = createPublicClient({ chain, cacheTime: 0, transport: http(p.rpcUrl) });
const wallet = createWalletClient({ chain, account, transport: http(p.rpcUrl) });
const txo = p.legacyTx ? { type: "legacy" as const, gasPrice: p.gasPrice ?? 0n } : {};

const artifact = JSON.parse(readFileSync(resolve(root, "contracts/test/vectors/zk/HonkVerifier.artifact.json"), "utf8"));
const forgeOut = (file: string, contract: string) => JSON.parse(readFileSync(resolve(root, "contracts/out", file, `${contract}.json`), "utf8"));

function link(bytecode: string, offsets: number[], lib: Address): Hex {
  let hex = bytecode.replace(/^0x/, "");
  for (const off of offsets) hex = hex.slice(0, off * 2) + lib.slice(2).toLowerCase() + hex.slice(off * 2 + 40);
  return `0x${hex}`;
}

async function deploy(label: string, bytecode: Hex, abi: Abi = [], args: unknown[] = []): Promise<{ address: Address; tx: Hex }> {
  const tx = await wallet.deployContract({ abi, bytecode, args, account, chain, ...txo } as never);
  const r = await pub.waitForTransactionReceipt({ hash: tx, timeout: 180_000 });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`${label} deployment failed: ${tx}`);
  console.log(`${label.padEnd(18)} ${r.contractAddress} ${tx}`);
  return { address: r.contractAddress, tx };
}

async function main() {
  const relations = await deploy("RelationsLib", artifact.relationsLib.bytecode as Hex);
  const transcript = await deploy("ZKTranscriptLib", artifact.transcriptLib.bytecode as Hex);
  let vbytecode = link(artifact.verifier.bytecode, artifact.verifier.relationsLibOffsets, relations.address);
  vbytecode = link(vbytecode, artifact.verifier.transcriptLibOffsets, transcript.address);
  const verifier = await deploy("HonkVerifier", vbytecode);
  const routerOut = forgeOut("ZKVerifierRouter.sol", "ZKVerifierRouter");
  const router = await deploy("ZKVerifierRouter", routerOut.bytecode.object as Hex, routerOut.abi, [account.address]);
  const reg = await wallet.writeContract({ address: router.address, abi: routerOut.abi, functionName: "registerVerifier", args: [1, verifier.address], account, chain, ...txo } as never);
  await pub.waitForTransactionReceipt({ hash: reg });
  console.log(`registerVerifier(0x01) ${reg}`);
  const enfOut = forgeOut("ZKMandateEnforcer.sol", "ZKMandateEnforcer");
  const enforcer = await deploy("ZKMandateEnforcer", enfOut.bytecode.object as Hex, enfOut.abi, []);

  const file = resolve(root, "contracts/deployments", `${name}.json`);
  const d = JSON.parse(readFileSync(file, "utf8"));
  for (const [k, v] of Object.entries({ ZKRelationsLib: relations, ZKTranscriptLib: transcript, HonkVerifier: verifier, ZKVerifierRouter: router, ZKMandateEnforcer: enforcer })) {
    const code = await pub.getCode({ address: v.address });
    const { keccak256 } = await import("viem");
    d[k] = { address: v.address, codeHash: keccak256(code!), txHash: v.tx };
  }
  d.zkRegisterVerifierTx = reg;
  writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`);
  console.log(`updated contracts/deployments/${name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
