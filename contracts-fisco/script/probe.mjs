#!/usr/bin/env node
// FISCO BCOS ledger probe. Deploys contracts-fisco/probe/FiscoProbe.sol (and helpers) through the
// Web3 JSON-RPC and records what the chain actually does, as JSON, in
// contracts-fisco/reports/probe-<date>.json.
//
// Usage (from contracts-fisco/, after `forge build`):
//   FISCO_RPC_URL=http://127.0.0.1:8545 node script/probe.mjs
// The RPC is reached through an SSH tunnel (see infra/fisco/README.md). Transactions are signed
// with a throwaway key generated in memory for this run (FISCO gas price is 0, nothing is funded);
// the key is never printed or stored.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROJECT_DIR, Rpc, Signer, abiDecode, abiEncode, calldata, checksum, concatHex, create2Address, createAddress,
  decodeRevert, keccak256, link, loadArtifact, padHex, strip0x, toQuantity, utf8Hex, sleep,
} from "./lib/chain.mjs";
import { p256Vector, sm2GenerateKey, sm2SignDigest, sm2ZPreimage } from "./lib/curves.mjs";

const RPC_URL = process.env.FISCO_RPC_URL || "http://127.0.0.1:8545";
const LABEL = process.env.PROBE_LABEL || "fisco";
const rpc = new Rpc(RPC_URL);

const report = {
  schema: "yinglong.fisco-probe/1",
  generatedAt: new Date().toISOString(),
  target: LABEL,
  rpc: "Web3 JSON-RPC of node0 through an SSH tunnel (127.0.0.1 only on the server)",
  compiler: { solc: "0.8.23", evmVersion: "london", optimizerRuns: 200, bytecodeHash: "none" },
  signer: null,
  results: {},
  transactions: [],
  errors: [],
};
const R = report.results;

const short = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > 400 ? `${s.slice(0, 400)}...(${s.length} chars)` : v;
};

async function section(name, fn) {
  try {
    R[name] = await fn();
  } catch (e) {
    R[name] = { error: e.message };
    report.errors.push({ section: name, error: e.message });
  }
  process.stdout.write(`[probe] ${name}: ${JSON.stringify(R[name]).slice(0, 300)}\n`);
}

function txRecord(label, t) {
  const rec = {
    label,
    hash: t.hash,
    type: t.type,
    status: t.receipt?.status,
    blockNumber: t.receipt ? Number(BigInt(t.receipt.blockNumber)) : null,
    gasUsed: t.receipt ? Number(BigInt(t.receipt.gasUsed)) : null,
    contractAddress: t.receipt?.contractAddress ?? null,
    minedAfterMs: t.minedAfterMs,
  };
  report.transactions.push(rec);
  return rec;
}

async function ethCall(to, data, block = "latest", extra) {
  const params = [{ to, data }, block];
  if (extra) params.push(extra);
  const r = await rpc.raw("eth_call", params);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, result: r.result };
}

const main = async () => {
  const pk = `0x${randomBytes(32).toString("hex")}`;
  const signer = await new Signer(rpc, pk, "throwaway").init();
  report.signer = { address: signer.address, note: "throwaway key generated for this run, never stored" };

  // ------------------------------------------------------------------------------------------
  await section("rpcMethods", async () => {
    const probeTx = { from: signer.address, to: signer.address, data: "0x" };
    const methods = [
      ["web3_clientVersion", []],
      ["net_version", []],
      ["net_listening", []],
      ["net_peerCount", []],
      ["eth_chainId", []],
      ["eth_protocolVersion", []],
      ["eth_syncing", []],
      ["eth_blockNumber", []],
      ["eth_gasPrice", []],
      ["eth_maxPriorityFeePerGas", []],
      ["eth_feeHistory", ["0x1", "latest", [50]]],
      ["eth_accounts", []],
      ["eth_coinbase", []],
      ["eth_mining", []],
      ["eth_getBalance", [signer.address, "latest"]],
      ["eth_getTransactionCount", [signer.address, "latest"]],
      ["eth_getTransactionCount", [signer.address, "pending"]],
      ["eth_getBlockByNumber", ["latest", false]],
      ["eth_getBlockByNumber", ["pending", false]],
      ["eth_getBlockByNumber", ["safe", false]],
      ["eth_getBlockByNumber", ["finalized", false]],
      ["eth_getBlockByNumber", ["earliest", false]],
      ["eth_getBlockReceipts", ["latest"]],
      ["eth_getProof", [signer.address, [], "latest"]],
      ["eth_createAccessList", [probeTx, "latest"]],
      ["eth_estimateGas", [probeTx]],
      ["eth_simulateV1", [{ blockStateCalls: [{ calls: [probeTx] }] }, "latest"]],
      ["eth_newBlockFilter", []],
      ["eth_newPendingTransactionFilter", []],
      ["txpool_status", []],
      ["debug_traceCall", [probeTx, "latest", {}]],
    ];
    const out = {};
    for (const [m, p] of methods) {
      const key = m === "eth_getBlockByNumber" ? `${m}(${p[0]})` : m === "eth_getTransactionCount" ? `${m}(${p[1]})` : m;
      const r = await rpc.raw(m, p);
      out[key] = r.error ? { ok: false, error: short(r.error) } : { ok: true, result: short(r.result) };
    }
    return out;
  });

  // ------------------------------------------------------------------------------------------
  await section("chain", async () => {
    const chainId = await rpc.call("eth_chainId");
    const latest = await rpc.call("eth_getBlockByNumber", ["latest", false]);
    return {
      ethChainId: chainId,
      ethChainIdDecimal: Number(BigInt(chainId)),
      gasPrice: await rpc.call("eth_gasPrice"),
      latestBlock: {
        number: Number(BigInt(latest.number)),
        gasLimit: latest.gasLimit,
        gasLimitDecimal: Number(BigInt(latest.gasLimit)),
        baseFeePerGas: latest.baseFeePerGas ?? null,
        timestamp: latest.timestamp,
        miner: latest.miner,
      },
    };
  });

  // ------------------------------------------------------------------------------------------
  const sclArt = loadArtifact("libSCL_RIP7212.sol", "SCL_RIP7212");
  const probeArt = loadArtifact("FiscoProbe.sol", "FiscoProbe");
  const childArt = loadArtifact("FiscoProbe.sol", "ProbeChild");
  const p256Art = loadArtifact("FiscoProbe.sol", "ProbeP256");
  let probe;
  let p256Wrapper;

  await section("deployLegacyType0", async () => {
    const predicted = createAddress(signer.address, signer.nonce);
    const t = await signer.send({ data: probeArt.bytecode, type: 0 });
    const rec = txRecord("deploy FiscoProbe (type 0)", t);
    probe = checksum(t.receipt.contractAddress);
    const code = await rpc.call("eth_getCode", [probe, "latest"]);
    return {
      status: t.receipt.status,
      tx: rec.hash,
      predictedCreateAddress: predicted,
      receiptContractAddress: probe,
      createAddressMatchesEvmFormula: predicted.toLowerCase() === probe.toLowerCase(),
      runtimeMatchesArtifact: code.toLowerCase() === probeArt.deployedBytecode.toLowerCase(),
      runtimeSize: strip0x(code).length / 2,
    };
  });

  await section("txType2", async () => {
    const data = calldata("ping(bytes32)", padHex("0x02"));
    try {
      const t = await signer.send({ to: probe, data, type: 2, gas: 200000n });
      const tx = await rpc.call("eth_getTransactionByHash", [t.hash]);
      txRecord("ping (type 2)", t);
      return { accepted: true, status: t.receipt.status, tx: t.hash, reportedType: tx.type, receiptType: t.receipt.type ?? null };
    } catch (e) {
      signer.nonce = null;
      await signer.init();
      return { accepted: false, error: e.message };
    }
  });

  await section("txType0Details", async () => {
    const data = calldata("ping(bytes32)", padHex("0x01"));
    const t = await signer.send({ to: probe, data, type: 0 });
    txRecord("ping (type 0)", t);
    const tx = await rpc.call("eth_getTransactionByHash", [t.hash]);
    return {
      status: t.receipt.status,
      tx: t.hash,
      transaction: { type: tx.type, chainId: tx.chainId ?? null, v: tx.v, gasPrice: tx.gasPrice, nonce: tx.nonce },
      receiptFields: Object.keys(t.receipt).sort(),
      effectiveGasPrice: t.receipt.effectiveGasPrice ?? null,
    };
  });

  // ------------------------------------------------------------------------------------------
  await section("evmContext", async () => {
    const t = await signer.send({ to: probe, data: calldata("recordEnv()"), type: 0 });
    txRecord("recordEnv", t);
    const log = t.receipt.logs[0];
    const vals = abiDecode(
      "f()(uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,bytes32,uint256)",
      log.data,
    ).map((s) => s.split(" ")[0]);
    const block = await rpc.call("eth_getBlockByNumber", [t.receipt.blockNumber, false]);
    const parent = await rpc.call("eth_getBlockByNumber", [toQuantity(BigInt(t.receipt.blockNumber) - 1n), false]);
    const nowSec = Math.floor(Date.now() / 1000);
    const evmTimestamp = BigInt(vals[1]);
    const headerTimestamp = BigInt(block.timestamp);
    const callEnv = abiDecode(
      "f()(uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,bytes32,uint256)",
      (await ethCall(probe, calldata("env()"))).result,
    ).map((s) => s.split(" ")[0]);
    return {
      inTransaction: {
        chainId: vals[0],
        timestamp: vals[1],
        number: vals[2],
        gasLimit: vals[3],
        baseFee: vals[4],
        coinbase: vals[5],
        prevrandao: vals[6],
        gasPrice: vals[7],
        blockhashOfParent: vals[8],
      },
      inEthCall: { chainId: callEnv[0], timestamp: callEnv[1], number: callEnv[2], gasLimit: callEnv[3], baseFee: callEnv[4] },
      receiptBlockNumber: Number(BigInt(t.receipt.blockNumber)),
      header: { timestamp: block.timestamp, timestampDecimal: headerTimestamp.toString(), hash: block.hash, parentHash: block.parentHash },
      parentHashFromRpc: parent.hash,
      chainIdOpcodeEqualsEthChainId: BigInt(vals[0]) === BigInt(await rpc.call("eth_chainId")),
      timestampUnits:
        evmTimestamp < 10_000_000_000n ? "seconds" : "milliseconds",
      timestampVsWallClockSec: Number(evmTimestamp < 10_000_000_000n ? evmTimestamp : evmTimestamp / 1000n) - nowSec,
      headerTimestampUnits: headerTimestamp < 10_000_000_000n ? "seconds" : "milliseconds",
      blockhashOpcodeMatchesRpcParentHash: vals[8].toLowerCase() === (parent.hash || "").toLowerCase(),
    };
  });

  // ------------------------------------------------------------------------------------------
  await section("createAddress", async () => {
    const before = BigInt(await rpc.call("eth_getTransactionCount", [probe, "latest"]).catch(() => "0x0"));
    const t = await signer.send({ to: probe, data: calldata("deployCreate(uint256)", 7), type: 0 });
    txRecord("deployCreate", t);
    const child = checksum(`0x${t.receipt.logs[0].topics[1].slice(26)}`);
    const candidates = [0, 1, 2].map((n) => createAddress(probe, n));
    const tag = abiDecode("f()(uint256)", (await ethCall(child, calldata("tag()"))).result)[0];
    return {
      child,
      probeNonceBefore: before.toString(),
      evmFormulaCandidates: { nonce0: candidates[0], nonce1: candidates[1], nonce2: candidates[2] },
      matchesEvmFormulaAtNonce1: child.toLowerCase() === candidates[1].toLowerCase(),
      childTag: tag,
    };
  });

  await section("create2", async () => {
    const salt = padHex("0x59494e474c4f4e47");
    const initCode = concatHex(childArt.bytecode, abiEncode("f(uint256)", 9));
    const offchain = create2Address(probe, salt, keccak256(initCode));
    const t = await signer.send({ to: probe, data: calldata("deployCreate2(bytes32,uint256)", salt, 9), type: 0 });
    txRecord("deployCreate2", t);
    const log = t.receipt.logs[0];
    const actual = checksum(`0x${log.topics[1].slice(26)}`);
    const [predictedInContract] = abiDecode("f()(address,bool)", log.data);
    const tag = abiDecode("f()(uint256)", (await ethCall(actual, calldata("tag()"))).result)[0];
    return {
      actual,
      predictedInContract: checksum(predictedInContract),
      predictedOffchain: offchain,
      works: actual.toLowerCase() === offchain.toLowerCase() && actual.toLowerCase() === predictedInContract.toLowerCase(),
      childTag: tag,
    };
  });

  await section("extcodehash", async () => {
    const missing = checksum(`0x${randomBytes(20).toString("hex")}`);
    const r = await ethCall(probe, calldata("codeInfo(address,address)", signer.address, missing));
    const [self, selfSize, eoa, eoaSize, miss] = abiDecode("f()(bytes32,uint256,bytes32,uint256,bytes32)", r.result);
    const code = await rpc.call("eth_getCode", [probe, "latest"]);
    const emptyHash = keccak256("0x");
    return {
      self,
      keccakOfEthGetCode: keccak256(code),
      selfMatchesKeccakOfCode: self.toLowerCase() === keccak256(code).toLowerCase(),
      selfSize: Number(selfSize.split(" ")[0]),
      eoaWithNonce: eoa,
      eoaIsKeccakOfEmpty: eoa.toLowerCase() === emptyHash,
      eoaCodeSize: Number(eoaSize.split(" ")[0]),
      nonExistentAccount: miss,
      nonExistentIsZero: /^0x0+$/.test(miss),
    };
  });

  // ------------------------------------------------------------------------------------------
  let sclAddress;
  await section("p256", async () => {
    const tLib = await signer.send({ data: sclArt.bytecode, type: 0 });
    txRecord("deploy SCL_RIP7212 library", tLib);
    sclAddress = checksum(tLib.receipt.contractAddress);
    const tW = await signer.send({ data: link(p256Art.bytecode, p256Art.linkReferences, { SCL_RIP7212: sclAddress }), type: 0 });
    txRecord("deploy ProbeP256", tW);
    p256Wrapper = checksum(tW.receipt.contractAddress);

    const v = p256Vector();
    const input = concatHex(v.hash, v.r, v.s, v.x, v.y);
    const direct = await ethCall("0x0000000000000000000000000000000000000100", input);
    const raw = await ethCall(probe, calldata("rawP256(bytes)", input));
    const [rawOk, rawLen] = raw.ok ? abiDecode("f()(bool,uint256,bytes)", raw.result) : [null, null];
    const verifyData = calldata("verify(bytes32,uint256,uint256,uint256,uint256)", v.hash, v.r, v.s, v.x, v.y);
    const good = await ethCall(p256Wrapper, verifyData);
    const badS = padHex(`0x${(BigInt(v.s) - 1n).toString(16)}`);
    const bad = await ethCall(p256Wrapper, calldata("verify(bytes32,uint256,uint256,uint256,uint256)", v.hash, v.r, badS, v.x, v.y));
    const gas = await rpc.raw("eth_estimateGas", [{ from: signer.address, to: p256Wrapper, data: verifyData }]);
    return {
      precompile0x100: {
        directEthCallResult: direct.ok ? direct.result : direct.error,
        viaContract: { success: rawOk, returnLength: rawLen ? Number(rawLen) : null },
        available: direct.ok && direct.result && direct.result !== "0x",
      },
      frameworkVerifier: {
        library: sclAddress,
        wrapper: p256Wrapper,
        validSignatureAccepted: good.ok ? BigInt(good.result) === 1n : good.error,
        tamperedSignatureRejected: bad.ok ? BigInt(bad.result) === 0n : bad.error,
        estimateGasForVerify: gas.result ? Number(BigInt(gas.result)) : gas.error,
        path: "SCL Solidity verifier (fallback) unless the 0x100 precompile answers",
      },
    };
  });

  // ------------------------------------------------------------------------------------------
  await section("fiscoCryptoPrecompile0x100a", async () => {
    const pre = "0x000000000000000000000000000000000000100a";
    const abc = utf8Hex("abc");
    const SM3_ABC = "0x66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0";
    const sm3Direct = await ethCall(pre, calldata("sm3(bytes)", abc));
    const kecDirect = await ethCall(pre, calldata("keccak256Hash(bytes)", abc));
    const viaContract = await ethCall(probe, calldata("rawCrypto(bytes)", calldata("sm3(bytes)", abc)));
    let viaContractDecoded = null;
    if (viaContract.ok) {
      const [ok, ret] = abiDecode("f()(bool,bytes)", viaContract.result);
      viaContractDecoded = { success: ok, ret };
    }
    const sm3Value = sm3Direct.ok ? abiDecode("f()(bytes32)", sm3Direct.result)[0] : null;
    const kecValue = kecDirect.ok ? abiDecode("f()(bytes32)", kecDirect.result)[0] : null;

    // SM2. The precompile's first argument is a 32-byte message M; the node verifies (r, s)
    // against e = SM3(Z_A || M) with the default user ID "1234567812345678" (OpenSSL
    // sm2_do_verify). We compute Z_A and e with the precompile's own sm3 and sign e here.
    const sm3Of = async (hex) => abiDecode("f()(bytes32)", (await ethCall(pre, calldata("sm3(bytes)", hex))).result)[0];
    const key = sm2GenerateKey();
    const M = `0x${randomBytes(32).toString("hex")}`;
    const Z = await sm3Of(sm2ZPreimage(key.publicKey));
    const e = await sm3Of(concatHex(Z, M));
    const sig = sm2SignDigest(e, key);
    const verify = async (msg, s) => {
      const r = await ethCall(pre, calldata("sm2Verify(bytes32,bytes,bytes32,bytes32)", msg, key.publicKey, s.r, s.s));
      if (!r.ok) return { error: r.error };
      const [okFlag, account] = abiDecode("f()(bool,address)", r.result);
      return { verified: okFlag === "true", account };
    };
    const good = await verify(M, sig);
    const expectedAccount = checksum(`0x${strip0x(await sm3Of(key.publicKey)).slice(24)}`);
    const rawDigestSig = sm2SignDigest(M, key); // signature over M itself, without Z_A hashing
    const sm2 = {
      convention: "sm2Verify(M, pub64, r, s) checks (r, s) over e = SM3(Z_A || M), default user ID 1234567812345678",
      validSignatureVerified: good.verified ?? good,
      returnedAccount: good.account ?? null,
      expectedAccountRight160Sm3Pub: expectedAccount,
      accountMatches: good.account ? good.account.toLowerCase() === expectedAccount.toLowerCase() : false,
      localSelfCheck: sig.selfCheck,
      wrongMessageRejected: (await verify(padHex("0x01"), sig)).verified === false,
      signatureOverRawMWithoutZaRejected: (await verify(M, rawDigestSig)).verified === false,
    };
    return {
      sm3Abc: sm3Value,
      sm3MatchesGbtVector: sm3Value ? sm3Value.toLowerCase() === SM3_ABC : false,
      sm3ViaContractStaticcall: viaContractDecoded,
      keccak256HashAbc: kecValue,
      keccakMatchesOpcode: kecValue ? kecValue.toLowerCase() === keccak256(abc) : false,
      sm2Verify: sm2,
    };
  });

  // ------------------------------------------------------------------------------------------
  await section("ethGetLogs", async () => {
    const hashes = [];
    let first;
    let last;
    for (let i = 0; i < 3; i++) {
      const t = await signer.send({ to: probe, data: calldata("ping(bytes32)", padHex(`0x${(0xa0 + i).toString(16)}`)), type: 0 });
      txRecord(`ping logs ${i}`, t);
      hashes.push(t.hash);
      const bn = BigInt(t.receipt.blockNumber);
      first = first === undefined ? bn : first;
      last = bn;
    }
    const topic0 = keccak256(utf8Hex("Ping(uint256,address,bytes32)"));
    const from = toQuantity(first);
    const to = toQuantity(last);
    const senderTopic = padHex(signer.address);
    const lastReceipt = await rpc.call("eth_getTransactionReceipt", [hashes[2]]);
    // Which filter shapes does the node accept? (viem omits undefined keys.)
    const shapes = {
      "address+topics+range": { address: probe, fromBlock: from, toBlock: to, topics: [topic0] },
      "address+range (no topics key)": { address: probe, fromBlock: from, toBlock: to },
      "address+range+topics[]": { address: probe, fromBlock: from, toBlock: to, topics: [] },
      "address[]+topics+range": { address: [probe], fromBlock: from, toBlock: to, topics: [topic0] },
      "topics+range (no address key)": { fromBlock: from, toBlock: to, topics: [topic0] },
      "address:[]+topics+range": { address: [], fromBlock: from, toBlock: to, topics: [topic0] },
      "address+topics (no range)": { address: probe, topics: [topic0] },
      "null wildcard + indexed sender topic (lowercase hex)": { address: probe, fromBlock: from, toBlock: to, topics: [topic0, null, senderTopic.toLowerCase()] },
      "null wildcard + indexed sender topic (mixed-case hex)": { address: probe, fromBlock: from, toBlock: to, topics: [topic0, null, senderTopic] },
      "OR list in topic0": { address: probe, fromBlock: from, toBlock: to, topics: [[topic0, padHex("0x1234")]] },
      "blockHash only": { blockHash: lastReceipt.blockHash },
      "blockHash+address+topics": { blockHash: lastReceipt.blockHash, address: probe, topics: [topic0] },
    };
    const matrix = {};
    for (const [name, f] of Object.entries(shapes)) {
      const r = await rpc.raw("eth_getLogs", [f]);
      matrix[name] = r.error ? { ok: false, error: r.error.message } : { ok: true, count: r.result.length };
    }
    const filter = await rpc.raw("eth_newFilter", [{ address: probe, fromBlock: from, toBlock: "latest", topics: [topic0] }]);
    const filterLogs = filter.result ? await rpc.raw("eth_getFilterLogs", [filter.result]) : filter;
    const byRange = await rpc.raw("eth_getLogs", [shapes["address+topics+range"]]);
    return {
      filterShapes: matrix,
      newFilterThenGetFilterLogs: filterLogs.error ? { ok: false, error: filterLogs.error.message } : { ok: true, count: filterLogs.result.length },
      logFields: byRange.result?.[0] ? Object.keys(byRange.result[0]).sort() : null,
      works: !byRange.error && byRange.result.length === 3,
    };
  });

  // ------------------------------------------------------------------------------------------
  await section("ethCallStateOverride", async () => {
    const counterCall = calldata("counter()");
    const plain = await ethCall(probe, counterCall);
    const stateDiff = await ethCall(probe, counterCall, "latest", { [probe]: { stateDiff: { [padHex("0x0")]: padHex("0x2a") } } });
    // runtime: PUSH1 0x2a PUSH1 0 MSTORE PUSH1 0x20 PUSH1 0 RETURN
    const other = checksum(`0x${randomBytes(20).toString("hex")}`);
    const codeOverride = await ethCall(other, "0x", "latest", { [other]: { code: "0x602a60005260206000f3" } });
    const balanceOverride = await rpc.raw("eth_call", [
      { to: probe, data: calldata("balanceOfThis()") }, "latest", { [probe]: { balance: "0x64" } },
    ]);
    const plainValue = plain.ok ? BigInt(plain.result) : null;
    return {
      plainCounter: plainValue?.toString(),
      stateDiffResult: stateDiff.ok ? BigInt(stateDiff.result).toString() : stateDiff.error,
      stateDiffApplied: stateDiff.ok ? BigInt(stateDiff.result) === 42n : false,
      codeOverrideResult: codeOverride.ok ? codeOverride.result : codeOverride.error,
      codeOverrideApplied: codeOverride.ok ? codeOverride.result !== "0x" && BigInt(codeOverride.result) === 42n : false,
      balanceOverrideResult: balanceOverride.error ? balanceOverride.error : balanceOverride.result,
    };
  });

  // ------------------------------------------------------------------------------------------
  await section("estimateGas", async () => {
    const cases = {};
    const est = async (label, tx, sendIt = true) => {
      const r = await rpc.raw("eth_estimateGas", [{ from: signer.address, ...tx }]);
      const out = { estimate: r.error ? null : Number(BigInt(r.result)), error: r.error ? short(r.error) : undefined };
      if (sendIt && !r.error) {
        const t = await signer.send({ ...tx, gas: BigInt(r.result), type: 0 });
        txRecord(`estimate check: ${label}`, t);
        out.sentWithExactEstimate = { status: t.receipt.status, gasUsed: Number(BigInt(t.receipt.gasUsed)) };
        out.estimateMinusGasUsed = out.estimate - out.sentWithExactEstimate.gasUsed;
      }
      cases[label] = out;
    };
    await est("ping", { to: probe, data: calldata("ping(bytes32)", padHex("0x05")) });
    await est("burn(200)", { to: probe, data: calldata("burn(uint256)", 200) });
    await est("deploy ProbeChild", { data: concatHex(childArt.bytecode, abiEncode("f(uint256)", 3)) });
    await est("revert failWith", { to: probe, data: calldata("failWith(string)", "probe-revert") }, false);
    await est("plain transfer to EOA", { to: signer.address, data: "0x" }, false);
    return cases;
  });

  // ------------------------------------------------------------------------------------------
  await section("revertOnChainAndReplay", async () => {
    const data = calldata("failWith(string)", "probe-revert-reason");
    const t = await signer.send({ to: probe, data, gas: 300000n, type: 0 });
    txRecord("failWith (expected revert)", t);
    const parent = toQuantity(BigInt(t.receipt.blockNumber) - 1n);
    const atParent = await rpc.raw("eth_call", [{ from: signer.address, to: probe, data }, parent]);
    const atLatest = await rpc.raw("eth_call", [{ from: signer.address, to: probe, data }, "latest"]);
    const decode = (r) => (r.error ? { error: r.error, decoded: r.error.data ? decodeRevert(r.error.data) : null } : { result: r.result });
    return {
      tx: t.hash,
      receiptStatus: t.receipt.status,
      receiptHasRevertData: Object.keys(t.receipt).filter((k) => /revert|output|message/i.test(k)),
      replayAtParentBlock: decode(atParent),
      replayAtLatest: decode(atLatest),
    };
  });

  // ------------------------------------------------------------------------------------------
  await section("historicalEthCall", async () => {
    const now = await rpc.call("eth_blockNumber");
    const counterNow = BigInt((await ethCall(probe, calldata("counter()"))).result);
    const t = await signer.send({ to: probe, data: calldata("ping(bytes32)", padHex("0x77")), type: 0 });
    txRecord("ping for history check", t);
    const after = BigInt((await ethCall(probe, calldata("counter()"))).result);
    const atOld = await ethCall(probe, calldata("counter()"), now);
    const atGenesis = await ethCall(probe, calldata("counter()"), "0x0");
    return {
      counterBefore: counterNow.toString(),
      counterAfter: after.toString(),
      counterAtOldBlockTag: atOld.ok ? BigInt(atOld.result).toString() : atOld.error,
      blockTagHonoured: atOld.ok ? BigInt(atOld.result) === counterNow : false,
      atGenesis: atGenesis.ok ? atGenesis.result : atGenesis.error,
    };
  });

  // ------------------------------------------------------------------------------------------
  await section("blockTime", async () => {
    const samples = [];
    for (let i = 0; i < 6; i++) {
      const t = await signer.send({ to: probe, data: calldata("ping(bytes32)", padHex(`0x${(0xb0 + i).toString(16)}`)), type: 0 });
      const b = await rpc.call("eth_getBlockByNumber", [t.receipt.blockNumber, false]);
      samples.push({ block: Number(BigInt(t.receipt.blockNumber)), headerTimestamp: Number(BigInt(b.timestamp)), submitToReceiptMs: t.minedAfterMs });
      txRecord(`block time ping ${i}`, t);
    }
    const lat = samples.map((s) => s.submitToReceiptMs).sort((a, b) => a - b);
    const idle1 = BigInt(await rpc.call("eth_blockNumber"));
    await sleep(5000);
    const idle2 = BigInt(await rpc.call("eth_blockNumber"));
    return {
      samples,
      submitToReceiptMedianMs: lat[Math.floor(lat.length / 2)],
      submitToReceiptMinMs: lat[0],
      submitToReceiptMaxMs: lat[lat.length - 1],
      blocksProducedWhileIdle5s: Number(idle2 - idle1),
      note: "FISCO PBFT seals a block only when the txpool has transactions (min_seal_time 500 ms); there are no empty blocks.",
    };
  });

  // ------------------------------------------------------------------------------------------
  await section("contractSizeLimits", async () => {
    // initcode returning N zero bytes: PUSH3 N, PUSH1 0, RETURN
    const sized = (n) => `0x62${n.toString(16).padStart(6, "0")}6000f3`;
    const out = {};
    for (const n of [24576, 24577, 32768, 49152, 65536]) {
      try {
        const t = await signer.send({ data: sized(n), gas: 40_000_000n, type: 0 });
        txRecord(`runtime size ${n}`, t);
        const addr = t.receipt.contractAddress;
        const code = addr ? await rpc.call("eth_getCode", [addr, "latest"]) : "0x";
        out[`runtime_${n}`] = { status: t.receipt.status, deployedSize: strip0x(code).length / 2, gasUsed: Number(BigInt(t.receipt.gasUsed)) };
      } catch (e) {
        signer.nonce = null;
        await signer.init();
        out[`runtime_${n}`] = { rejected: e.message };
      }
    }
    // initcode size (EIP-3860 limit 49152): 1-byte runtime, padded with unreachable zeros.
    for (const n of [49152, 49153, 65536]) {
      const head = "600160" + "00f3"; // PUSH1 1, PUSH1 0, RETURN
      const hex = `0x${head}${"00".repeat(n - head.length / 2)}`;
      try {
        const t = await signer.send({ data: hex, gas: 40_000_000n, type: 0 });
        txRecord(`initcode size ${n}`, t);
        out[`initcode_${n}`] = { status: t.receipt.status, gasUsed: Number(BigInt(t.receipt.gasUsed)) };
      } catch (e) {
        signer.nonce = null;
        await signer.init();
        out[`initcode_${n}`] = { rejected: e.message };
      }
    }
    return out;
  });

  // ------------------------------------------------------------------------------------------
  await section("gasLimits", async () => {
    const out = {};
    for (const g of [30_000_000n, 100_000_000n, 3_000_000_000n, 3_000_000_001n]) {
      try {
        const t = await signer.send({ to: probe, data: calldata("ping(bytes32)", padHex("0x99")), gas: g, type: 0 });
        txRecord(`ping gas ${g}`, t);
        out[`txGas_${g}`] = { accepted: true, status: t.receipt.status, gasUsed: Number(BigInt(t.receipt.gasUsed)) };
      } catch (e) {
        signer.nonce = null;
        await signer.init();
        out[`txGas_${g}`] = { accepted: false, error: e.message };
      }
    }
    const big = await rpc.raw("eth_estimateGas", [{ from: signer.address, to: probe, data: calldata("burn(uint256)", 20000) }]);
    out.burn20000Estimate = big.error ? big.error : Number(BigInt(big.result));
    return out;
  });

  // ------------------------------------------------------------------------------------------
  await section("nativeValue", async () => {
    try {
      const t = await signer.send({ to: probe, data: calldata("ping(bytes32)", padHex("0x0b")), value: 1n, gas: 300000n, type: 0 });
      txRecord("ping with value 1 wei", t);
      const replay = await rpc.raw("eth_call", [
        { from: signer.address, to: probe, data: calldata("ping(bytes32)", padHex("0x0b")), value: "0x1" }, "latest",
      ]);
      return {
        accepted: true,
        status: t.receipt.status,
        replay: replay.error ? { error: replay.error.message, decoded: replay.error.data ? decodeRevert(replay.error.data) : null } : replay.result,
        balanceAfter: (await ethCall(probe, calldata("balanceOfThis()"))).result,
      };
    } catch (e) {
      signer.nonce = null;
      await signer.init();
      return { accepted: false, error: e.message };
    }
  });

  // ------------------------------------------------------------------------------------------
  await section("cancunOpcodesAtRuntime", async () => {
    // Raw runtimes, each returning 42 when the opcode works. Deployed with a CODECOPY wrapper.
    const wrap = (rt) => {
      const len = strip0x(rt).length / 2;
      const l = len.toString(16).padStart(2, "0");
      return `0x60${l}600c60003960${l}6000f3${strip0x(rt)}`;
    };
    const runtimes = {
      PUSH0: "0x602a5f5260205ff3",
      TSTORE_TLOAD: "0x602a60015d60015c60005260206000f3",
      MCOPY: "0x602a6020526020602060005e60206000f3",
      BLOBBASEFEE: "0x4a60005260206000f3",
      BASEFEE: "0x4860005260206000f3",
    };
    const out = {};
    for (const [name, rt] of Object.entries(runtimes)) {
      const t = await signer.send({ data: wrap(rt), gas: 1_000_000n, type: 0 });
      txRecord(`deploy raw ${name}`, t);
      const addr = t.receipt.contractAddress;
      const r = await ethCall(addr, "0x");
      out[name] = r.ok ? { works: true, returned: BigInt(r.result || "0x0").toString() } : { works: false, error: short(r.error) };
    }
    return out;
  });

  // ------------------------------------------------------------------------------------------
  await section("nonces", async () => {
    return {
      latest: Number(BigInt(await rpc.call("eth_getTransactionCount", [signer.address, "latest"]))),
      pending: await rpc.raw("eth_getTransactionCount", [signer.address, "pending"]).then((r) => (r.error ? r.error : Number(BigInt(r.result)))),
      localNextNonce: Number(signer.nonce),
      probeContractNonce: await rpc.raw("eth_getTransactionCount", [probe, "latest"]).then((r) => (r.error ? r.error : Number(BigInt(r.result)))),
    };
  });

  await section("debugTrace", async () => {
    const last = report.transactions.find((t) => t.label === "recordEnv");
    const r = await rpc.raw("debug_traceTransaction", [last.hash, {}]);
    return r.error ? { supported: false, error: short(r.error) } : { supported: true, sample: short(r.result) };
  });

  report.contracts = { FiscoProbe: probe, ProbeP256: p256Wrapper, SCL_RIP7212: sclAddress };
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dir = join(PROJECT_DIR, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `probe-${date}${LABEL === "fisco" ? "" : `-${LABEL}`}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[probe] wrote ${file} (${report.errors.length} section errors)`);
};

main().catch((e) => {
  console.error(`[probe] fatal: ${e.message}`);
  process.exit(1);
});
