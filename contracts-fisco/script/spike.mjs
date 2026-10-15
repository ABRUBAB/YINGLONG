#!/usr/bin/env node
// Go/no-go spike: MetaMask Delegation Framework v1.3.0 on FISCO BCOS 3.17.1 (and, for comparison,
// on a local anvil). Deploys the framework from the unmodified submodule build (contracts-fisco/out),
// creates a HybridDeleGator account owned by an EOA, signs a delegation with three stock caveats,
// redeems it, then attempts a redemption above the cap that must revert, and records everything.
//
// Usage (from contracts-fisco/, after `forge build`):
//   node script/spike.mjs --target fisco --rpc http://127.0.0.1:8545 [--force]
//   node script/spike.mjs --target anvil --rpc http://127.0.0.1:28545
// Output: deployments/fisco-spike.json, or deployments/anvil-spike-<chainId>.json.
//
// Role keys are read at runtime from ../../.secrets/testnet-keys.json (outside the repository) and
// passed only to `cast wallet sign`; they are never printed or written anywhere.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROJECT_DIR, Rpc, Signer, abiDecode, abiEncode, calldata, checksum, concatHex, createAddress, decodeRevert,
  keccak256, link, loadArtifact, loadRoleKeys, maskImmutables, padHex, signDigest, strip0x, toQuantity, utf8Hex,
} from "./lib/chain.mjs";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const TARGET = arg("target", "fisco");
const RPC_URL = arg("rpc", process.env.FISCO_RPC_URL || "http://127.0.0.1:8545");
const FORCE = argv.includes("--force");
const rpc = new Rpc(RPC_URL);

const ROOT_AUTHORITY = `0x${"ff".repeat(32)}`;
const SINGLE_DEFAULT_MODE = padHex("0x0");
const ERC1271_MAGIC = "0x1626ba7e";
const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const UNIT = 10n ** 18n;
const SUPPLY = 1_000_000n * UNIT;
const CAP = 1_000n * UNIT;
const FIRST = 250n * UNIT;
const OVER = 800n * UNIT; // 250 + 800 = 1050 > 1000
const BOUNDARY = 750n * UNIT; // 250 + 750 = 1000 = cap

// Framework contracts whose runtime code hash is compared across ledgers.
const FRAMEWORK = [
  ["EntryPoint", "EntryPoint.sol", "EntryPoint"],
  ["SCL_RIP7212", "libSCL_RIP7212.sol", "SCL_RIP7212"],
  ["DelegationManager", "DelegationManager.sol", "DelegationManager"],
  ["HybridDeleGatorImpl", "HybridDeleGator.sol", "HybridDeleGator"],
  ["MultiSigDeleGatorImpl", "MultiSigDeleGator.sol", "MultiSigDeleGator"],
  ["AllowedTargetsEnforcer", "AllowedTargetsEnforcer.sol", "AllowedTargetsEnforcer"],
  ["AllowedMethodsEnforcer", "AllowedMethodsEnforcer.sol", "AllowedMethodsEnforcer"],
  ["ValueLteEnforcer", "ValueLteEnforcer.sol", "ValueLteEnforcer"],
  ["TimestampEnforcer", "TimestampEnforcer.sol", "TimestampEnforcer"],
  ["LimitedCallsEnforcer", "LimitedCallsEnforcer.sol", "LimitedCallsEnforcer"],
  ["NonceEnforcer", "NonceEnforcer.sol", "NonceEnforcer"],
  ["RedeemerEnforcer", "RedeemerEnforcer.sol", "RedeemerEnforcer"],
  ["ERC20TransferAmountEnforcer", "ERC20TransferAmountEnforcer.sol", "ERC20TransferAmountEnforcer"],
];

const out = {
  schema: "yinglong.delegation-spike/1",
  generatedAt: new Date().toISOString(),
  target: TARGET,
  rpc: TARGET === "fisco" ? "FISCO BCOS 3.17.1 Web3 JSON-RPC (node0) through an SSH tunnel" : `local anvil ${RPC_URL}`,
  framework: {
    source: "contracts/lib/delegation-framework (git submodule, tag v1.3.0, commit bfbdf97), unmodified",
    entryPoint: "account-abstraction v0.7.0 from the framework's lib/",
    compiler: { solc: "0.8.23", evmVersion: "london", optimizer: true, optimizerRuns: 200, viaIR: false, bytecodeHash: "none", cborMetadata: false },
  },
  chain: {},
  roles: {},
  contracts: {},
  account: {},
  token: {},
  checks: {},
  delegation: {},
  redemptions: [],
  transactions: [],
  verdict: {},
};

const log = (m) => process.stdout.write(`[spike:${TARGET}] ${m}\n`);

function record(label, t, extra = {}) {
  const rec = {
    label,
    hash: t.hash,
    from: t.from,
    nonce: Number(t.nonce),
    status: t.receipt.status,
    blockNumber: Number(BigInt(t.receipt.blockNumber)),
    gasUsed: Number(BigInt(t.receipt.gasUsed)),
    ...extra,
  };
  out.transactions.push(rec);
  return rec;
}

async function call(to, data, from) {
  const tx = { to, data };
  if (from) tx.from = from;
  const r = await rpc.raw("eth_call", [tx, "latest"]);
  if (r.error) throw new Error(`eth_call to ${to} failed: ${JSON.stringify(r.error).slice(0, 300)}`);
  return r.result;
}
const callDecode = async (to, sig, outTypes, ...args) => abiDecode(`f()(${outTypes})`, await call(to, calldata(sig, ...args)));
// First decoded value as printed by cast: strips quotes from strings and the "[1e18]" hint from numbers.
const first = (v) => (v[0].startsWith('"') ? v[0].replace(/^"|"$/g, "") : v[0].split(" ")[0]);

async function main() {
  const file = TARGET === "fisco" ? join(PROJECT_DIR, "deployments", "fisco-spike.json") : null;
  if (file && existsSync(file) && !FORCE) {
    throw new Error(`${file} exists; pass --force to deploy a fresh set (addresses will change)`);
  }

  const roles = loadRoleKeys();
  const need = ["deployer", "supervisor", "director-1", "agent-treasurer", "svc-shenzhen-components"];
  for (const r of need) if (!roles[r]) throw new Error(`role ${r} missing from keys file`);
  out.roles = {
    deployer: roles.deployer.address,
    delegationManagerOwner: { role: "supervisor", address: roles.supervisor.address },
    accountOwner: { role: "director-1", address: roles["director-1"].address },
    delegate: { role: "agent-treasurer", address: roles["agent-treasurer"].address },
    recipient: { role: "svc-shenzhen-components", address: roles["svc-shenzhen-components"].address },
  };

  const chainId = BigInt(await rpc.call("eth_chainId"));
  out.chain = { ethChainId: Number(chainId), clientVersion: await rpc.call("web3_clientVersion").catch(() => null) };
  if (TARGET === "anvil") {
    for (const r of ["deployer", "agent-treasurer", "director-1"]) {
      await rpc.call("anvil_setBalance", [roles[r].address, toQuantity(100n * UNIT)]);
    }
  }

  const deployer = await new Signer(rpc, roles.deployer.privateKey, "deployer").init();
  const agent = await new Signer(rpc, roles["agent-treasurer"].privateKey, "agent-treasurer").init();
  out.chain.deployerStartNonce = Number(deployer.nonce);
  log(`chainId ${chainId}, deployer nonce ${deployer.nonce}`);

  // ---------------------------------------------------------------------------------------------
  // Deploy
  // ---------------------------------------------------------------------------------------------
  const libs = {};
  const artifacts = {};
  const deploy = async (name, file, contract, ctorTypes, ctorArgs) => {
    const art = loadArtifact(file, contract);
    artifacts[name] = art;
    let code = Object.keys(art.linkReferences).length ? link(art.bytecode, art.linkReferences, libs) : art.bytecode;
    if (ctorTypes) code = concatHex(code, abiEncode(`f(${ctorTypes})`, ...ctorArgs));
    const predicted = createAddress(deployer.address, deployer.nonce);
    const t = await deployer.send({ data: code, type: 0 });
    t.from = deployer.address;
    if (t.receipt.status !== "0x1") throw new Error(`deploy ${name} failed: ${t.hash}`);
    const address = checksum(t.receipt.contractAddress);
    const rec = record(`deploy ${name}`, t, { contract: address });
    out.contracts[name] = {
      address,
      txHash: t.hash,
      blockNumber: rec.blockNumber,
      gasUsed: rec.gasUsed,
      deployNonce: rec.nonce,
      addressMatchesCreateFormula: predicted.toLowerCase() === address.toLowerCase(),
    };
    log(`${name} ${address} (${t.hash})`);
    return address;
  };

  const ep = await deploy("EntryPoint", "EntryPoint.sol", "EntryPoint");
  const scl = await deploy("SCL_RIP7212", "libSCL_RIP7212.sol", "SCL_RIP7212");
  libs.SCL_RIP7212 = scl;
  const dm = await deploy("DelegationManager", "DelegationManager.sol", "DelegationManager", "address", [roles.supervisor.address]);
  const hybridImpl = await deploy("HybridDeleGatorImpl", "HybridDeleGator.sol", "HybridDeleGator", "address,address", [dm, ep]);
  await deploy("MultiSigDeleGatorImpl", "MultiSigDeleGator.sol", "MultiSigDeleGator", "address,address", [dm, ep]);
  const enf = {};
  for (const [name, f, c] of FRAMEWORK.slice(5)) enf[name] = await deploy(name, f, c);

  const initData = calldata("initialize(address,string[],uint256[],uint256[])", roles["director-1"].address, "[]", "[]", "[]");
  const account = await deploy("HybridDeleGatorProxy", "ERC1967Proxy.sol", "ERC1967Proxy", "address,bytes", [hybridImpl, initData]);
  const token = await deploy("SpikeTestToken", "SpikeTestToken.sol", "SpikeTestToken", "address,uint256", [account, SUPPLY]);

  // SenderCreator is created by the EntryPoint constructor (contract nonce 1).
  const senderCreator = createAddress(ep, 1);
  out.contracts.SenderCreator = { address: senderCreator, createdBy: "EntryPoint constructor (CREATE, nonce 1)" };
  artifacts.SenderCreator = loadArtifact("SenderCreator.sol", "SenderCreator");

  // A probe contract, deployed from a throwaway key so the deployer's nonce sequence (and hence every
  // framework address) stays identical across ledgers, reads EXTCODEHASH with the opcode itself.
  const tmpKey = `0x${randomBytes(32).toString("hex")}`;
  if (TARGET === "anvil") {
    const tmpAddr = (await new Signer(rpc, tmpKey).init()).address;
    await rpc.call("anvil_setBalance", [tmpAddr, toQuantity(10n * UNIT)]);
  }
  const tmp = await new Signer(rpc, tmpKey, "throwaway").init();
  const probeArt = loadArtifact("FiscoProbe.sol", "FiscoProbe");
  const tp = await tmp.send({ data: probeArt.bytecode, type: 0 });
  const probe = checksum(tp.receipt.contractAddress);
  out.codehashReader = { address: probe, note: "FiscoProbe deployed from a throwaway key; codeInfo(x, 0) returns x.codehash via EXTCODEHASH" };

  // ---------------------------------------------------------------------------------------------
  // Code hashes, artifact match, immutables
  // ---------------------------------------------------------------------------------------------
  const linkedRuntime = (name) => {
    const a = artifacts[name];
    let rt = Object.keys(a.deployedLinkReferences).length ? link(a.deployedBytecode, a.deployedLinkReferences, libs) : a.deployedBytecode;
    // Solidity libraries start with PUSH20 <own address> (call protection), filled in at deployment.
    if (strip0x(rt).startsWith(`73${"00".repeat(20)}`)) {
      rt = `0x73${strip0x(out.contracts[name].address).toLowerCase()}${strip0x(rt).slice(42)}`;
    }
    return rt;
  };
  for (const [name, entry] of Object.entries(out.contracts)) {
    const code = await rpc.call("eth_getCode", [entry.address, "latest"]);
    const [, , opcodeHash] = abiDecode("f()(bytes32,uint256,bytes32,uint256,bytes32)", await call(probe, calldata("codeInfo(address,address)", entry.address, entry.address)));
    entry.extcodehash = opcodeHash;
    entry.keccakOfEthGetCode = keccak256(code);
    entry.codeSize = strip0x(code).length / 2;
    const art = artifacts[name];
    if (art) {
      const imm = art.immutableReferences;
      entry.immutableSlots = Object.values(imm).reduce((n, refs) => n + refs.length, 0);
      entry.maskedCodeHash = keccak256(maskImmutables(code, imm));
      entry.runtimeMatchesArtifactModuloImmutables =
        maskImmutables(code, imm).toLowerCase() === maskImmutables(linkedRuntime(name), imm).toLowerCase();
      // Distinct immutable values embedded in the deployed runtime (by AST id).
      const vals = {};
      for (const [id, refs] of Object.entries(imm)) {
        const { start, length } = refs[0];
        vals[id] = `0x${strip0x(code).slice(start * 2, (start + length) * 2)}`;
      }
      if (Object.keys(vals).length) entry.immutableValues = vals;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Post-deploy checks
  // ---------------------------------------------------------------------------------------------
  const domainHash = first(await callDecode(dm, "getDomainHash()", "bytes32"));
  const eip712 = await callDecode(dm, "eip712Domain()", "bytes1,string,string,uint256,address,bytes32,uint256[]");
  const domainFor = (cid) =>
    keccak256(
      abiEncode(
        "f(bytes32,bytes32,bytes32,uint256,address)",
        keccak256(utf8Hex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        keccak256(utf8Hex("DelegationManager")),
        keccak256(utf8Hex("1")),
        cid,
        dm,
      ),
    );
  const implSlot = await rpc.call("eth_getStorageAt", [account, ERC1967_IMPL_SLOT, "latest"]);
  out.checks = {
    delegationManager: {
      owner: checksum(first(await callDecode(dm, "owner()", "address"))),
      ownerIsSupervisor: first(await callDecode(dm, "owner()", "address")).toLowerCase() === roles.supervisor.address.toLowerCase(),
      paused: first(await callDecode(dm, "paused()", "bool")),
      version: first(await callDecode(dm, "VERSION()", "string")),
      domainHash,
      eip712DomainChainId: eip712[3].split(" ")[0],
      domainHashIfChainIdIsEthChainId: domainFor(chainId),
      domainHashIfChainIdIsZero: domainFor(0),
      domainUsesChainId:
        domainHash.toLowerCase() === domainFor(chainId).toLowerCase() ? Number(chainId) : domainHash.toLowerCase() === domainFor(0).toLowerCase() ? 0 : "unknown",
    },
    account: {
      address: account,
      implementationSlot: checksum(`0x${implSlot.slice(26)}`),
      implementationIsHybridImpl: `0x${implSlot.slice(26)}`.toLowerCase() === hybridImpl.toLowerCase(),
      owner: checksum(first(await callDecode(account, "owner()", "address"))),
      ownerIsDirector1: first(await callDecode(account, "owner()", "address")).toLowerCase() === roles["director-1"].address.toLowerCase(),
      delegationManager: checksum(first(await callDecode(account, "delegationManager()", "address"))),
      entryPoint: checksum(first(await callDecode(account, "entryPoint()", "address"))),
      passkeys: "none (initialize called with empty key arrays)",
    },
    token: {
      address: token,
      name: first(await callDecode(token, "name()", "string")),
      accountBalance: first(await callDecode(token, "balanceOf(address)", "uint256", account)),
      label: "test unit, no value",
    },
  };
  out.account = { address: account, implementation: hybridImpl, owner: roles["director-1"].address };
  out.token = { address: token, supply: SUPPLY.toString(), decimals: 18, holder: account };

  // ---------------------------------------------------------------------------------------------
  // Delegation: account -> agent-treasurer, three stock caveats
  // ---------------------------------------------------------------------------------------------
  const transferSel = keccak256(utf8Hex("transfer(address,uint256)")).slice(0, 10);
  const caveats = [
    { enforcer: enf.AllowedTargetsEnforcer, terms: token.toLowerCase(), args: "0x" },
    { enforcer: enf.AllowedMethodsEnforcer, terms: transferSel, args: "0x" },
    { enforcer: enf.ERC20TransferAmountEnforcer, terms: concatHex(token.toLowerCase(), padHex(toQuantity(CAP))), args: "0x" },
  ];
  const salt = BigInt(`0x${randomBytes(8).toString("hex")}`);
  const delegate = roles["agent-treasurer"].address;
  const tuple = (sig) =>
    `(${delegate},${account},${ROOT_AUTHORITY},[${caveats.map((c) => `(${c.enforcer},${c.terms},${c.args})`).join(",")}],${salt},${sig})`;
  const DELEGATION_T = "(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes)";

  const onchainDelegationHash = first(abiDecode("f()(bytes32)", await call(dm, calldata(`getDelegationHash(${DELEGATION_T})`, tuple("0x")))));
  const caveatHashes = caveats.map((c) =>
    strip0x(keccak256(abiEncode("f(bytes32,address,bytes32)", keccak256(utf8Hex("Caveat(address enforcer,bytes terms)")), c.enforcer, keccak256(c.terms)))),
  );
  const offchainDelegationHash = keccak256(
    abiEncode(
      "f(bytes32,address,address,bytes32,bytes32,uint256)",
      keccak256(utf8Hex("Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)")),
      delegate,
      account,
      ROOT_AUTHORITY,
      keccak256(`0x${caveatHashes.join("")}`),
      salt,
    ),
  );
  const typedDataHash = keccak256(concatHex("0x1901", domainHash, onchainDelegationHash));
  const sig = signDigest(roles["director-1"].privateKey, typedDataHash);
  const erc1271 = await call(account, calldata("isValidSignature(bytes32,bytes)", typedDataHash, sig.hex));
  out.delegation = {
    delegate,
    delegator: account,
    authority: ROOT_AUTHORITY,
    salt: salt.toString(),
    caveats: [
      { enforcer: "AllowedTargetsEnforcer", address: enf.AllowedTargetsEnforcer, terms: caveats[0].terms, meaning: "only the test token" },
      { enforcer: "AllowedMethodsEnforcer", address: enf.AllowedMethodsEnforcer, terms: caveats[1].terms, meaning: "only transfer(address,uint256)" },
      { enforcer: "ERC20TransferAmountEnforcer", address: enf.ERC20TransferAmountEnforcer, terms: caveats[2].terms, meaning: `cumulative cap ${CAP} base units` },
    ],
    signer: { role: "director-1", address: roles["director-1"].address, scheme: "EIP-712 over the DelegationManager domain, ECDSA, verified by the account through ERC-1271" },
    domainHash,
    delegationHashOnchain: onchainDelegationHash,
    delegationHashOffchain: offchainDelegationHash,
    delegationHashesMatch: onchainDelegationHash.toLowerCase() === offchainDelegationHash.toLowerCase(),
    typedDataHash,
    signature: sig.hex,
    erc1271Result: erc1271.slice(0, 10),
    erc1271Valid: erc1271.slice(0, 10).toLowerCase() === ERC1271_MAGIC,
  };
  const permissionContext = abiEncode(`f(${DELEGATION_T}[])`, `[${tuple(sig.hex)}]`);
  const recipient = roles["svc-shenzhen-components"].address;
  const execution = (amount) => concatHex(token, padHex("0x0"), calldata("transfer(address,uint256)", recipient, amount));
  const redeemData = (amount) =>
    calldata("redeemDelegations(bytes[],bytes32[],bytes[])", `[${permissionContext}]`, `[${SINGLE_DEFAULT_MODE}]`, `[${execution(amount)}]`);
  const balances = async () => ({
    account: first(await callDecode(token, "balanceOf(address)", "uint256", account)),
    recipient: first(await callDecode(token, "balanceOf(address)", "uint256", recipient)),
    spent: first(await callDecode(enf.ERC20TransferAmountEnforcer, "spentMap(address,bytes32)", "uint256", dm, onchainDelegationHash)),
  });

  // Redemption 1: within the cap.
  const b0 = await balances();
  const r1 = await agent.send({ to: dm, data: redeemData(FIRST), type: 0 });
  r1.from = agent.address;
  const b1 = await balances();
  const topics1 = r1.receipt.logs.map((l) => l.topics[0]);
  out.redemptions.push({
    description: "redemption 1: 250 units, within cap",
    ...record("redeemDelegations 250", r1),
    amount: FIRST.toString(),
    balancesBefore: b0,
    balancesAfter: b1,
    recipientReceived: (BigInt(b1.recipient) - BigInt(b0.recipient)).toString(),
    emitted: {
      RedeemedDelegation: topics1.includes(keccak256(utf8Hex(`RedeemedDelegation(address,address,${DELEGATION_T})`))),
      Transfer: topics1.includes(keccak256(utf8Hex("Transfer(address,address,uint256)"))),
      logCount: r1.receipt.logs.length,
    },
  });
  log(`redemption 1 ${r1.hash} status ${r1.receipt.status}`);

  // Redemption 2: above the cap. Estimate first (expected to fail), then force it on-chain with a
  // fixed gas limit so the revert is mined, then replay with eth_call at the parent block.
  const data2 = redeemData(OVER);
  const est2 = await rpc.raw("eth_estimateGas", [{ from: agent.address, to: dm, data: data2 }]);
  const r2 = await agent.send({ to: dm, data: data2, gas: 3_000_000n, type: 0 });
  r2.from = agent.address;
  const parent = toQuantity(BigInt(r2.receipt.blockNumber) - 1n);
  const replayParent = await rpc.raw("eth_call", [{ from: agent.address, to: dm, data: data2 }, parent]);
  const replayLatest = await rpc.raw("eth_call", [{ from: agent.address, to: dm, data: data2 }, "latest"]);
  const b2 = await balances();
  const decode = (r) => (r.error ? { rpcError: { code: r.error.code, message: r.error.message }, revert: r.error.data ? decodeRevert(r.error.data) : null } : { result: r.result });
  out.redemptions.push({
    description: "redemption 2: 800 units, cumulative 1050 above the 1000 cap, must revert",
    ...record("redeemDelegations 800 (over cap)", r2),
    amount: OVER.toString(),
    estimateGas: decode(est2),
    replayAtParentBlock: decode(replayParent),
    replayAtLatest: decode(replayLatest),
    balancesAfter: b2,
    stateUnchanged: b2.account === b1.account && b2.recipient === b1.recipient && b2.spent === b1.spent,
  });
  log(`redemption 2 ${r2.hash} status ${r2.receipt.status}`);

  // Redemption 3: exactly up to the cap (boundary).
  const r3 = await agent.send({ to: dm, data: redeemData(BOUNDARY), type: 0 });
  r3.from = agent.address;
  const b3 = await balances();
  out.redemptions.push({
    description: "redemption 3: 750 units, cumulative exactly 1000 = cap",
    ...record("redeemDelegations 750 (boundary)", r3),
    amount: BOUNDARY.toString(),
    balancesAfter: b3,
  });
  log(`redemption 3 ${r3.hash} status ${r3.receipt.status}`);

  const revertReason = out.redemptions[1].replayAtParentBlock.revert?.reason ?? out.redemptions[1].replayAtLatest.revert?.reason ?? null;
  out.verdict = {
    allFrameworkContractsDeployed: FRAMEWORK.every(([n]) => out.contracts[n]?.address),
    runtimeMatchesArtifactForAll: Object.entries(out.contracts)
      .filter(([, c]) => c.runtimeMatchesArtifactModuloImmutables !== undefined)
      .every(([, c]) => c.runtimeMatchesArtifactModuloImmutables),
    extcodehashEqualsKeccakOfCodeForAll: Object.values(out.contracts).every((c) => c.extcodehash?.toLowerCase() === c.keccakOfEthGetCode?.toLowerCase()),
    delegationSignatureValidViaErc1271: out.delegation.erc1271Valid,
    redemptionWithinCapSucceeded: r1.receipt.status === "0x1" && BigInt(b1.recipient) - BigInt(b0.recipient) === FIRST,
    redemptionAboveCapReverted: r2.receipt.status === "0x0" && out.redemptions[1].stateUnchanged,
    revertReason,
    revertReasonIsCapExceeded: revertReason === "ERC20TransferAmountEnforcer:allowance-exceeded",
    boundaryRedemptionSucceeded: r3.receipt.status === "0x1" && b3.spent === CAP.toString(),
  };
  out.verdict.go =
    out.verdict.allFrameworkContractsDeployed &&
    out.verdict.runtimeMatchesArtifactForAll &&
    out.verdict.delegationSignatureValidViaErc1271 &&
    out.verdict.redemptionWithinCapSucceeded &&
    out.verdict.redemptionAboveCapReverted &&
    out.verdict.revertReasonIsCapExceeded &&
    out.verdict.boundaryRedemptionSucceeded;

  const dest = file || join(PROJECT_DIR, "deployments", `anvil-spike-${chainId}.json`);
  mkdirSync(join(PROJECT_DIR, "deployments"), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  log(`verdict go=${out.verdict.go}; wrote ${dest}`);
}

main().catch((e) => {
  console.error(`[spike:${TARGET}] fatal: ${e.message}`);
  process.exit(1);
});
