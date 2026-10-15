// The anchoring relayer (plan section 9.8 / Vein pillar): pulls accountability receipts, batches them,
// builds a sorted-pair Merkle tree, anchors each batch root on every configured ledger
// (AccountabilityLedger.anchorBatch), then cross-anchors each ledger with the others' latest root, block
// number and block hash. Batches and per-receipt proofs are kept in a local JSON store, and a proof verifies
// on-chain via AccountabilityLedger.verifyReceipt.
import { resolve } from "node:path";
import { buildMerkle, merkleProof, verifyMerkle, abi, type LedgerName } from "@yinglong/sdk";
import type { Address, Hex } from "viem";
import { Ledger } from "./chain";
import type { IndexerConfig } from "./config";
import { fetchReceiptsApi, readReceiptsFile, type IncomingReceipt } from "./receipts";
import { readJson, writeJsonAtomic } from "./state";

const ANCHORER_ROLE = "anchoring-relayer" as const;

export interface AnchorRecord {
  ledger: LedgerName;
  txHash: Hex;
  blockNumber: string;
  batchId: number; // AccountabilityLedger batch index on that ledger
  root: Hex;
}

export interface CrossAnchorRecord {
  onLedger: LedgerName;
  remoteLedger: LedgerName;
  remoteChainId: number;
  remoteBlockNumber: string;
  remoteBlockHash: Hex;
  remoteRoot: Hex;
  remoteBatchId: number;
  txHash: Hex;
}

export interface StoredReceipt {
  receiptId: Hex;
  receiptHash: Hex;
  index: number;
  principal?: string;
  sourceLedger: LedgerName;
  receipt: Record<string, string | number>;
}

export interface StoredBatch {
  batchId: number; // local store id
  root: Hex;
  count: number;
  createdAt: string;
  leaves: Hex[];
  receipts: StoredReceipt[];
  anchors: AnchorRecord[];
  crossAnchors: CrossAnchorRecord[];
  uri: string;
}

export interface IndexerStore {
  cursor: number;
  pending: StoredReceipt[];
  seen: Hex[];
  batches: StoredBatch[];
}

const receiptToStrings = (r: IncomingReceipt["receipt"]): Record<string, string | number> =>
  JSON.parse(JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export class Anchorer {
  private store: IndexerStore;
  private readonly storePath: string;
  private readonly ledgers = new Map<LedgerName, Ledger>();
  private firstPendingAt?: number;
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly config: IndexerConfig) {
    this.storePath = resolve(config.dataDir, "anchors.json");
    this.store = readJson<IndexerStore>(this.storePath) ?? { cursor: 0, pending: [], seen: [], batches: [] };
    for (const name of config.anchorLedgers) this.ledgers.set(name, new Ledger(name, { rpcUrl: config.rpcUrls[name] }));
  }

  ledger(name: LedgerName): Ledger {
    const l = this.ledgers.get(name);
    if (!l) throw new Error(`ledger ${name} is not configured for anchoring`);
    return l;
  }

  snapshot(): IndexerStore {
    return this.store;
  }

  private persist(): void {
    writeJsonAtomic(this.storePath, this.store);
  }

  /** Pull new receipts from the configured source and queue the unseen ones. */
  async pull(): Promise<number> {
    let incoming: IncomingReceipt[];
    if (this.config.receiptsFile) incoming = readReceiptsFile(this.config.receiptsFile, this.store.cursor);
    else if (this.config.agentApiUrl) incoming = await fetchReceiptsApi(this.config.agentApiUrl, this.store.cursor, this.config.principal);
    else return 0;
    this.store.cursor += incoming.length;
    const seen = new Set(this.store.seen.map((s) => s.toLowerCase()));
    let added = 0;
    for (const r of incoming) {
      if (seen.has(r.receiptHash.toLowerCase())) continue;
      seen.add(r.receiptHash.toLowerCase());
      this.store.seen.push(r.receiptHash);
      this.store.pending.push({
        receiptId: r.receipt.receiptId,
        receiptHash: r.receiptHash,
        index: -1,
        principal: r.principal,
        sourceLedger: r.ledger,
        receipt: receiptToStrings(r.receipt),
      });
      added++;
    }
    if (added > 0 && this.firstPendingAt === undefined) this.firstPendingAt = Date.now();
    this.persist();
    return added;
  }

  shouldAnchor(): boolean {
    if (this.store.pending.length === 0) return false;
    if (this.store.pending.length >= this.config.batchMaxReceipts) return true;
    return this.firstPendingAt !== undefined && Date.now() - this.firstPendingAt >= this.config.batchMaxAgeMs;
  }

  /** Anchor all pending receipts as one batch on every configured ledger, then cross-anchor. */
  async anchorPending(): Promise<StoredBatch | undefined> {
    if (this.store.pending.length === 0) return undefined;
    const pending = this.store.pending;
    const leaves = pending.map((p) => p.receiptHash);
    const tree = buildMerkle(leaves);
    const batchId = this.store.batches.length;
    const uri = `yinglong://indexer/batch/${batchId}`;
    pending.forEach((p, i) => (p.index = i));

    const anchors: AnchorRecord[] = [];
    for (const name of this.config.anchorLedgers) {
      const ledger = this.ledger(name);
      await ledger.ensureGas(ledger.roleAddress(ANCHORER_ROLE));
      const res = await ledger.write(ANCHORER_ROLE, {
        address: ledger.addr("AccountabilityLedger"),
        abi: abi.AccountabilityLedgerAbi,
        functionName: "anchorBatch",
        args: [tree.root, BigInt(leaves.length), uri],
      });
      const onchainBatchId = await ledger.read<bigint>({ address: ledger.addr("AccountabilityLedger"), abi: abi.AccountabilityLedgerAbi, functionName: "batchIdOfRoot", args: [tree.root] });
      anchors.push({ ledger: name, txHash: res.hash, blockNumber: res.receipt.blockNumber.toString(), batchId: Number(onchainBatchId) - 1, root: tree.root });
    }

    const batch: StoredBatch = { batchId, root: tree.root, count: leaves.length, createdAt: new Date().toISOString(), leaves, receipts: pending, anchors, crossAnchors: [], uri };
    this.store.batches.push(batch);
    this.store.pending = [];
    this.firstPendingAt = undefined;
    this.persist();

    await this.crossAnchor(batch).catch((e) => process.stderr.write(`[indexer] cross-anchor: ${String((e as Error).message ?? e)}\n`));
    return batch;
  }

  /** Record each ledger's latest root/block on every other configured ledger (two-way anchoring). */
  async crossAnchor(batch: StoredBatch): Promise<void> {
    const names = this.config.anchorLedgers;
    if (names.length < 2) return;
    for (const onName of names) {
      const onLedger = this.ledger(onName);
      await onLedger.ensureGas(onLedger.roleAddress(ANCHORER_ROLE));
      for (const remoteName of names) {
        if (remoteName === onName) continue;
        const remote = this.ledger(remoteName);
        const [root, remoteBatchId] = await remote.read<[Hex, bigint]>({ address: remote.addr("AccountabilityLedger"), abi: abi.AccountabilityLedgerAbi, functionName: "latestRoot" });
        const block = await remote.pub.getBlock({ blockTag: "latest" });
        const res = await onLedger.write(ANCHORER_ROLE, {
          address: onLedger.addr("AccountabilityLedger"),
          abi: abi.AccountabilityLedgerAbi,
          functionName: "crossAnchor",
          args: [BigInt(remote.profile.chainId), block.number, block.hash as Hex, root, remoteBatchId],
        });
        batch.crossAnchors.push({
          onLedger: onName,
          remoteLedger: remoteName,
          remoteChainId: remote.profile.chainId,
          remoteBlockNumber: block.number.toString(),
          remoteBlockHash: block.hash as Hex,
          remoteRoot: root,
          remoteBatchId: Number(remoteBatchId),
          txHash: res.hash,
        });
      }
    }
    this.persist();
  }

  /** Build the public proof for a receipt id. */
  proofFor(receiptId: string): {
    receipt: Record<string, string | number>;
    receiptHash: Hex;
    batchId: number;
    index: number;
    proof: Hex[];
    root: Hex;
    anchors: { ledger: LedgerName; txHash: Hex; blockNumber: string; onchainBatchId: number }[];
    valid: boolean;
  } | undefined {
    const rid = receiptId.toLowerCase();
    for (const batch of this.store.batches) {
      const sr = batch.receipts.find((r) => r.receiptId.toLowerCase() === rid || r.receiptHash.toLowerCase() === rid);
      if (!sr) continue;
      const tree = buildMerkle(batch.leaves);
      const proof = merkleProof(tree, sr.index);
      return {
        receipt: sr.receipt,
        receiptHash: sr.receiptHash,
        batchId: batch.batchId,
        index: sr.index,
        proof,
        root: batch.root,
        anchors: batch.anchors.map((a) => ({ ledger: a.ledger, txHash: a.txHash, blockNumber: a.blockNumber, onchainBatchId: a.batchId })),
        valid: verifyMerkle(sr.receiptHash, proof, batch.root),
      };
    }
    return undefined;
  }

  /** Verify a receipt's proof on-chain via AccountabilityLedger.verifyReceipt on one anchored ledger. */
  async verifyOnChain(receiptId: string, ledgerName?: LedgerName): Promise<{ ledger: LedgerName; onchainBatchId: number; valid: boolean } | undefined> {
    const p = this.proofFor(receiptId);
    if (!p) return undefined;
    const anchor = ledgerName ? p.anchors.find((a) => a.ledger === ledgerName) : p.anchors[0];
    if (!anchor) return undefined;
    const ledger = this.ledger(anchor.ledger);
    const valid = await ledger.read<boolean>({
      address: ledger.addr("AccountabilityLedger"),
      abi: abi.AccountabilityLedgerAbi,
      functionName: "verifyReceipt",
      args: [BigInt(anchor.onchainBatchId), p.receiptHash, p.proof],
    });
    return { ledger: anchor.ledger, onchainBatchId: anchor.onchainBatchId, valid };
  }

  async tick(): Promise<{ pulled: number; batched?: StoredBatch }> {
    if (this.busy) return { pulled: 0 };
    this.busy = true;
    try {
      let pulled = 0;
      try {
        pulled = await this.pull();
      } catch (e) {
        process.stderr.write(`[indexer] pull: ${String((e as Error).message ?? e)}\n`);
      }
      const batched = this.shouldAnchor() ? await this.anchorPending() : undefined;
      return { pulled, batched };
    } finally {
      this.busy = false;
    }
  }

  start(): void {
    const run = () => void this.tick().catch((e) => process.stderr.write(`[indexer] tick: ${String((e as Error).message ?? e)}\n`));
    run();
    this.timer = setInterval(run, this.config.pollIntervalMs);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  addresses(): Record<string, Address> {
    const out: Record<string, Address> = {};
    for (const [name, l] of this.ledgers) out[name] = l.addr("AccountabilityLedger");
    return out;
  }
}
