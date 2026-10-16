// Timing drills against a running agent API: one-tap pause (Trip signed by the principal, relayed as a plain
// transaction) and revoke (one user operation: MandateRegistry.revoke + DelegationManager.disableDelegation,
// submitted straight to the EntryPoint), each followed by its undo (resume; re-seal).
// Usage: npx tsx apps/agent/scripts/drills.ts [--api https://api.yinglong-agent.tech] [--pause 7] [--revoke 5]
//        [--pause-principal nadia] [--revoke-principal guest]
// Server-side times (msToConfirmed) run from submitting the signed message to its receipt; client times add the
// scripted passkey signature and the network round trip. The operator token is read from ../.secrets (never printed).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "@yinglong/sdk/server";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1]! : d);
const API = opt("--api", "https://api.yinglong-agent.tech");
const N_PAUSE = Number(opt("--pause", "7"));
const N_REVOKE = Number(opt("--revoke", "5"));
const PAUSE_PID = opt("--pause-principal", "nadia");
const REVOKE_PID = opt("--revoke-principal", "guest");
const tokenFile = resolve(repoRoot(), "..", ".secrets", "agent-admin-token.txt");
const TOKEN = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "";

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", "x-admin-token": TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${method} ${path}: ${String(j.error ?? r.status)}`);
  return j;
}

interface Row {
  action: string;
  principal: string;
  ledger: string;
  txHash: string;
  outcome: string;
  serverMs: number;
  clientMs: number;
  headAtSubmit: number;
  inclusionBlock: number;
  blocks: number;
  at: string;
}

async function head(ledger: string): Promise<number> {
  // The agent's own health endpoint reports the head block of every ledger it serves.
  const h = (await call("GET", "/v1/health")) as { ledgers: { name: string; block: string }[] };
  return Number(h.ledgers.find((l) => l.name === ledger)?.block ?? 0);
}

const ledgerOf = new Map<string, string>();
async function principalLedger(pid: string): Promise<string> {
  if (!ledgerOf.has(pid)) {
    const all = (await call("GET", "/v1/principals")) as unknown as { id: string; ledger: string }[];
    for (const p of all) ledgerOf.set(p.id, p.ledger);
  }
  return ledgerOf.get(pid) ?? "fisco";
}

async function signed(pid: string, action: "pause" | "resume" | "revoke"): Promise<Row> {
  const { approvalId } = (await call("POST", `/v1/principals/${pid}/${action}`)) as { approvalId: string };
  const h0 = await head(await principalLedger(pid));
  const t0 = Date.now();
  const { receipt } = (await call("POST", `/v1/approvals/${approvalId}/demo-sign`)) as { receipt: Record<string, unknown> };
  const clientMs = Date.now() - t0;
  const text = String((receipt.explanation as { text: string }).text);
  const m = text.match(/confirmed in (\d+) ms, block (\d+)/);
  const inclusion = m ? Number(m[2]) : 0;
  return {
    action,
    principal: pid,
    ledger: String(receipt.ledger),
    txHash: String(receipt.txHash),
    outcome: String(receipt.outcome),
    serverMs: m ? Number(m[1]) : NaN,
    clientMs,
    headAtSubmit: h0,
    inclusionBlock: inclusion,
    blocks: inclusion && h0 ? inclusion - h0 : NaN,
    at: new Date(t0).toISOString(),
  };
}

const q = (xs: number[], p: number) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const summary = (rows: Row[]) => ({
  n: rows.length,
  confirmed: rows.filter((r) => r.outcome === "confirmed").length,
  serverMs: { p50: q(rows.map((r) => r.serverMs), 50), p95: q(rows.map((r) => r.serverMs), 95), max: q(rows.map((r) => r.serverMs), 100) },
  clientMs: { p50: q(rows.map((r) => r.clientMs), 50), p95: q(rows.map((r) => r.clientMs), 95) },
  blocks: { p50: q(rows.map((r) => r.blocks), 50), max: q(rows.map((r) => r.blocks), 100) },
});

async function main() {
  const rows: Row[] = [];
  const pauses: Row[] = [];
  const revokes: Row[] = [];
  const reseals: { principal: string; ms: number; mandateHash?: string }[] = [];
  await call("POST", `/v1/principals/${PAUSE_PID}/onboard`, {});
  for (let i = 0; i < N_PAUSE; i++) {
    const p = await signed(PAUSE_PID, "pause");
    pauses.push(p);
    rows.push(p);
    console.log(JSON.stringify(p));
    const blocked = (await call("POST", `/v1/principals/${PAUSE_PID}/ask`, { text: "Pay Kowloon Food Mart 10 HKD" })) as { tier: string; scales?: { name: string; status: string; typedError?: string }[] };
    const stop = blocked.scales?.find((s) => s.typedError)?.typedError;
    console.log(JSON.stringify({ check: "agent while paused", tier: blocked.tier, stoppedBy: stop }));
    const r = await signed(PAUSE_PID, "resume");
    rows.push(r);
    console.log(JSON.stringify(r));
  }
  for (let i = 0; i < N_REVOKE; i++) {
    await call("POST", `/v1/principals/${REVOKE_PID}/onboard`, {});
    const v = await signed(REVOKE_PID, "revoke");
    revokes.push(v);
    rows.push(v);
    console.log(JSON.stringify(v));
    const t0 = Date.now();
    await call("POST", `/v1/principals/${REVOKE_PID}/onboard`, {});
    reseals.push({ principal: REVOKE_PID, ms: Date.now() - t0 });
  }
  const health = (await call("GET", "/v1/health")) as { ledgers: { name: string }[] };
  const out = {
    generatedBy: "apps/agent/scripts/drills.ts",
    api: API,
    at: new Date().toISOString(),
    ledgers: health.ledgers.map((l) => l.name),
    method:
      "serverMs: from submitting the signed Trip (pause) or the signed user operation (revoke) to its receipt, measured by the agent API next to the ledger; clientMs adds the scripted passkey signature and the network round trip from the drill client; blocks = inclusion block minus the head block read just before submission.",
    signer: "scripted passkey (software P-256 key)",
    pause: summary(pauses),
    revoke: summary(revokes),
    reseal: { n: reseals.length, ms: { p50: q(reseals.map((r) => r.ms), 50) } },
    rows,
  };
  const dir = resolve(repoRoot(), "docs/evidence/drills");
  mkdirSync(dir, { recursive: true });
  const ledger = pauses[0]?.ledger ?? revokes[0]?.ledger ?? "unknown";
  const f = resolve(dir, `timing-${API.includes("127.0.0.1") ? "local" : ledger}.json`);
  writeFileSync(f, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${f}`);
  console.log(JSON.stringify({ pause: out.pause, revoke: out.revoke, reseal: out.reseal }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
