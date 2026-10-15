// Indexer against the live Anvil deployment: the anchoring relayer batches 5 fake receipts, anchors the root
// on-chain, and a proof verifies via AccountabilityLedger.verifyReceipt; the read-only FISCO RPC proxy
// forwards an allowed read method and rejects eth_sendRawTransaction and an over-wide eth_getLogs range.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { keccak256, stringToBytes, type Hex } from "viem";
import { OUTCOMES, SOURCES, TIERS, ZERO32, type Receipt } from "@yinglong/sdk";
import { makeIndexer, type IndexerDeps } from "../src/app";
import { leafOf } from "../src/receipts";
import { FiscoRpcProxy } from "../src/rpc-proxy";

const RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8645";
const dataDir = mkdtempSync(join(tmpdir(), "indexer-test-"));
const receiptsFile = join(dataDir, "receipts.jsonl");

function fakeReceipt(i: number): Receipt {
  const now = BigInt(Math.floor(Date.now() / 1000)) + BigInt(i);
  const h = (s: string) => keccak256(stringToBytes(`${s}:${i}`));
  return {
    receiptId: keccak256(stringToBytes(`receipt:${i}:${now}`)),
    chainId: 31337,
    agentId: BigInt(100 + i),
    mandateHash: h("mandate"),
    delegationHash: h("delegation"),
    intentHash: h("intent"),
    planHash: h("plan"),
    policyDecisionHash: h("policy"),
    stateReadsHash: h("state"),
    counterpartyCheckHash: h("counterparty"),
    simulationHash: h("simulation"),
    tier: TIERS[1]!, // T1
    approvalSigHash: ZERO32,
    txHash: h("tx"),
    outcome: OUTCOMES[0]!, // confirmed
    explanationHash: h("explanation"),
    aigcHash: h("aigc"),
    source: SOURCES[2]!, // anvil-bench
    prevReceiptHash: i === 0 ? ZERO32 : keccak256(stringToBytes(`receipt:${i - 1}`)),
    timestamp: now,
  };
}

function writeReceiptsFile(): Receipt[] {
  const receipts = Array.from({ length: 5 }, (_, i) => fakeReceipt(i));
  const lines = receipts.map((r) => JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  writeFileSync(receiptsFile, `${lines.join("\n")}\n`);
  return receipts;
}

let deps: IndexerDeps;
let receipts: Receipt[];

beforeAll(async () => {
  receipts = writeReceiptsFile();
  deps = makeIndexer({
    LEDGER: "anvil",
    ANVIL_RPC_URL: RPC,
    ANCHOR_LEDGERS: "anvil",
    INDEXER_DATA_DIR: dataDir,
    RECEIPTS_FILE: receiptsFile,
    BATCH_MAX_RECEIPTS: "5",
    INDEXER_AUTOSTART: "0",
  } as NodeJS.ProcessEnv);
}, 120_000);

describe("anchoring relayer", () => {
  it("anchors 5 receipts into one batch and a proof verifies on-chain", async () => {
    const pulled = await deps.anchorer.pull();
    expect(pulled).toBe(5);
    expect(deps.anchorer.shouldAnchor()).toBe(true);
    const batch = await deps.anchorer.anchorPending();
    expect(batch?.count).toBe(5);
    expect(batch?.anchors.length).toBe(1);
    expect(batch?.anchors[0]?.ledger).toBe("anvil");

    // A proof for the middle receipt verifies both off-chain and on-chain.
    const target = receipts[2]!;
    const proof = deps.anchorer.proofFor(target.receiptId);
    expect(proof?.valid).toBe(true);
    expect(proof?.receiptHash.toLowerCase()).toBe(leafOf(target).toLowerCase());
    const onChain = await deps.anchorer.verifyOnChain(target.receiptId, "anvil");
    expect(onChain?.valid).toBe(true);
  });

  it("verifies every anchored receipt via AccountabilityLedger.verifyReceipt", async () => {
    for (const r of receipts) {
      const onChain = await deps.anchorer.verifyOnChain(r.receiptId, "anvil");
      expect(onChain?.valid).toBe(true);
    }
  });
});

describe("read-only FISCO RPC proxy", () => {
  const upstream = "http://127.0.0.1:9/never"; // not called for rejected methods
  const proxy = new FiscoRpcProxy({ upstreamUrl: upstream, ratePerMin: 1000, maxBlockRange: 5000 });

  it("rejects eth_sendRawTransaction without contacting the upstream", async () => {
    const res = await proxy.handle({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0xdeadbeef"] }, "1.2.3.4");
    expect(res.status).toBe(200);
    expect((res.body as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("rejects other write/admin/debug methods", () => {
    for (const m of ["eth_sendTransaction", "personal_unlockAccount", "debug_traceTransaction", "miner_start", "admin_addPeer", "txpool_content"]) {
      expect(proxy.validate({ method: m }).ok).toBe(false);
    }
  });

  it("allows read methods and bounds eth_getLogs", () => {
    expect(proxy.validate({ method: "eth_blockNumber", params: [] }).ok).toBe(true);
    expect(proxy.validate({ method: "eth_getLogs", params: [{ fromBlock: "0x0", toBlock: "0x100" }] }).ok).toBe(true);
    expect(proxy.validate({ method: "eth_getLogs", params: [{ fromBlock: "0x0", toBlock: "0xffff" }] }).ok).toBe(false);
    expect(proxy.validate({ method: "eth_getLogs", params: [{ blockHash: "0xabc" }] }).ok).toBe(false);
  });

  it("forwards an allowed method to the upstream (eth_chainId against Anvil)", async () => {
    const live = new FiscoRpcProxy({ upstreamUrl: RPC, ratePerMin: 1000, maxBlockRange: 5000 });
    const res = await live.handle({ jsonrpc: "2.0", id: 7, method: "eth_chainId", params: [] }, "5.6.7.8");
    expect(res.status).toBe(200);
    expect((res.body as { result: string }).result).toBe("0x7a69"); // 31337
  });

  it("applies a per-IP rate limit", async () => {
    const rl = new FiscoRpcProxy({ upstreamUrl: RPC, ratePerMin: 2, maxBlockRange: 5000 });
    await rl.handle({ method: "eth_blockNumber", params: [] }, "9.9.9.9");
    await rl.handle({ method: "eth_blockNumber", params: [] }, "9.9.9.9");
    const third = await rl.handle({ method: "eth_blockNumber", params: [] }, "9.9.9.9");
    expect(third.status).toBe(429);
  });
});
