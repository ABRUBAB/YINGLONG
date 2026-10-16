/**
 * "Verify it yourself": everything a judge needs to check that the service is real, in one response
 * (GET /v1/proof). Build and repository, both ledgers with their contracts and the bytecode comparison,
 * the newest transactions with explorer links, and the ML and bench results copied from the runs that
 * produced them (apps/agent/generated/proof-data.json, written by scripts/proof-data.mjs).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LEDGERS, type LedgerName } from "@yinglong/sdk";
import { repoRoot } from "@yinglong/sdk/server";
import { ledgerContext } from "./chain/ledger";
import { receiptLog } from "./receipts";

export const REPO_URL = "https://github.com/ABRUBAB/YINGLONG";
const startedAt = new Date();

function proofData(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(resolve(repoRoot(), "apps/agent/generated/proof-data.json"), "utf8"));
  } catch {
    return null;
  }
}

function ledgers() {
  const out: Record<string, unknown>[] = [];
  const hashes: Partial<Record<LedgerName, Record<string, string>>> = {};
  for (const l of ["fisco", "base-sepolia"] as const) {
    try {
      const ctx = ledgerContext(l);
      const all = { ...ctx.deployment.contracts, ...ctx.deployment.optional };
      const contracts = Object.entries(all)
        .filter(([, v]) => v)
        .map(([name, v]) => ({ name, address: v!.address, codeHash: v!.codeHash, explorerUrl: LEDGERS[l].explorerAddress?.(v!.address) ?? null }));
      hashes[l] = Object.fromEntries(contracts.map((c) => [c.name, c.codeHash.toLowerCase()]));
      out.push({ ledger: l, label: LEDGERS[l].label, chainId: ctx.profile.chainId, contractCount: contracts.length, contracts });
    } catch {
      out.push({ ledger: l, label: LEDGERS[l].label, deployed: false });
    }
  }
  const a = hashes.fisco ?? {};
  const b = hashes["base-sepolia"] ?? {};
  const both = Object.keys(a).filter((n) => n in b);
  const identical = both.filter((n) => a[n] === b[n]);
  return { ledgers: out, bytecode: { compared: both.length, identical: identical.length, differ: both.filter((n) => a[n] !== b[n]) } };
}

function transactions() {
  const all = receiptLog.all().filter((r) => r.ledger !== "anvil");
  const counts: Record<string, Record<string, number>> = {};
  for (const r of all) {
    const byLedger = (counts[r.ledger] ??= {});
    byLedger[r.receipt.outcome] = (byLedger[r.receipt.outcome] ?? 0) + 1;
  }
  const latest = all
    .filter((r) => r.receipt.txHash && !/^0x0{60}/.test(r.receipt.txHash))
    .slice(-12)
    .reverse()
    .map((r) => ({
      receiptId: r.receipt.receiptId,
      ledger: r.ledger,
      outcome: r.receipt.outcome,
      tier: r.receipt.tier,
      title: r.explanation.text,
      txHash: r.receipt.txHash,
      explorerUrl: r.explorerUrl ?? LEDGERS[r.ledger]?.explorerTx?.(r.receipt.txHash as `0x${string}`) ?? null,
      revertError: r.revertError?.message ?? null,
      at: r.createdAt,
      auditUrl: `/v1/receipts/${r.receipt.receiptId}/audit`,
    }));
  return { counts, latest };
}

export function proofBundle() {
  const commit = process.env.GIT_COMMIT ?? "";
  const data = proofData();
  return {
    schema: "yinglong.proof/1",
    generatedAt: new Date().toISOString(),
    build: { repo: REPO_URL, commit, commitUrl: commit ? `${REPO_URL}/commit/${commit}` : null },
    service: { startedAt: startedAt.toISOString(), uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000), health: "/v1/health", evidence: "/v1/evidence" },
    chain: ledgers(),
    transactions: transactions(),
    ml: data?.ml ?? null,
    bench: data?.bench ?? null,
    sources: { results: data ? ((data.sources as string[]) ?? []) : [], resultsGeneratedAt: data?.generatedAt ?? null },
  };
}
