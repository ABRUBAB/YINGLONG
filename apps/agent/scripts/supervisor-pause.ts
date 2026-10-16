// Supervisor pause on the live ledger, on a FRESH visitor's agent created for this purpose (never a demo agent).
// Usage (repo root): npx tsx apps/agent/scripts/supervisor-pause.ts [--api https://api.yinglong-agent.tech] [--ledger fisco]
//                    [--rpc https://api.yinglong-agent.tech/rpc/fisco] [--keep-halted]
// Steps: sign up and seal a visitor with a software passkey; read the agent's passport status (registry route) and
// the kill-switch state; POST /v1/supervisor/agents/<agentId>/halt {halted: true, ledger} with the operator token
// (YinglongPassportRegistry.supervisorSetStatus); read the status again; ask the agent for a small in-mandate payment
// and record that it is refused; then lift the halt (supervisorSetStatus false) unless --keep-halted, and read again.
// Writes docs/evidence/drills/supervisor-pause-<ledger>.json. The operator token is read from ../.secrets, never printed.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { repoRoot } from "@yinglong/sdk/server";
import { Api, freshPasskey, operatorToken, opt, Rpc, signUpAndSeal, type ReceiptView } from "./lib/visitor";

const args = process.argv.slice(2);
const API = opt(args, "--api", "https://api.yinglong-agent.tech");
const LEDGER = opt(args, "--ledger", "fisco");
const RPC = opt(args, "--rpc", `${API}/rpc/fisco`);
const KEEP = args.includes("--keep-halted");

interface RegistryRow {
  agentId: string;
  ledger: string;
  principal: string;
  status: string;
}

async function main() {
  const token = operatorToken();
  if (!token) throw new Error("operator token file ../.secrets/agent-admin-token.txt not found");
  const api = new Api(API, token);
  const rpc = new Rpc(RPC);

  const v = await signUpAndSeal(api, freshPasskey());
  const agentId = v.agent.agentId;
  const status = async () => {
    const rows = await api.call<RegistryRow[]>("GET", "/v1/registry/agents", undefined, { visitor: false });
    const row = rows.find((r) => r.principal === v.visitorId && r.agentId === agentId);
    const st = await api.call<{ principal: { paused: boolean; agent: { passportStatus: string } } }>("GET", `/v1/principals/${v.visitorId}/state`, undefined, { visitor: false });
    return { registryStatus: row?.status, passportStatus: st.principal.agent.passportStatus, accountPausedFlag: st.principal.paused };
  };
  const before = await status();
  console.log(JSON.stringify({ visitorId: v.visitorId, agentId, sealTx: v.publishTx, before }));

  const t0 = Date.now();
  const halt = await api.call<{ ok: boolean; txHash: Hex; halted: boolean; note: string }>("POST", `/v1/supervisor/agents/${agentId}/halt`, { halted: true, ledger: LEDGER }, { admin: true, visitor: false });
  const haltMs = Date.now() - t0;
  const haltRcpt = await rpc.receipt(halt.txHash);
  const during = await status();

  // The agent asks for a small payment inside its mandate while halted: it must not move anything.
  const tryPay = await api.call<{ tier: string; decision?: string; scales?: { name: string; status: string; reason: string; typedError?: string }[]; receipt?: ReceiptView }>(
    "POST",
    `/v1/principals/${v.visitorId}/ask`,
    { text: "Buy a coffee at Arena Cafe for 5 HKD", autoExecute: true },
  );
  const stoppedBy = tryPay.scales?.find((s) => s.status === "stopped" || s.typedError);

  let lift: { txHash: Hex; ms: number; status?: string } | undefined;
  let after = during;
  if (!KEEP) {
    const t1 = Date.now();
    const l = await api.call<{ ok: boolean; txHash: Hex }>("POST", `/v1/supervisor/agents/${agentId}/halt`, { halted: false, ledger: LEDGER }, { admin: true, visitor: false });
    const r = await rpc.receipt(l.txHash);
    lift = { txHash: l.txHash, ms: Date.now() - t1, status: r?.status };
    after = await status();
  }

  const out = {
    schema: "yinglong.supervisor-pause/1",
    generatedBy: "apps/agent/scripts/supervisor-pause.ts",
    api: API,
    ledger: LEDGER,
    at: new Date(t0).toISOString(),
    principal: { visitorId: v.visitorId, account: v.account, agentId, agentWallet: v.agent.wallet, sealTx: v.publishTx, sealedBy: v.signer },
    method:
      "Operator route POST /v1/supervisor/agents/:agentId/halt (YinglongPassportRegistry.supervisorSetStatus) on a fresh visitor's agent; status read from GET /v1/registry/agents (passportOf) and GET /v1/principals/:id/state before and after; transaction receipts read through the public read-only RPC. The supervisor role is played by the team.",
    halt: { txHash: halt.txHash, ok: halt.ok, clientMs: haltMs, onChainStatus: haltRcpt?.status, block: haltRcpt ? Number(BigInt(haltRcpt.blockNumber)) : undefined, note: halt.note },
    before,
    duringHalt: during,
    paymentWhileHalted: { tier: tryPay.tier, decision: tryPay.decision, outcome: tryPay.receipt?.outcome, txHash: tryPay.receipt?.txHash, stoppedBy: stoppedBy ? `${stoppedBy.name}: ${stoppedBy.typedError ?? stoppedBy.reason}` : undefined },
    lift: lift ?? "kept halted (--keep-halted)",
    after,
  };
  const dir = resolve(repoRoot(), "docs/evidence/drills");
  mkdirSync(dir, { recursive: true });
  const f = resolve(dir, `supervisor-pause-${LEDGER}.json`);
  writeFileSync(f, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
  console.log(`wrote ${f}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
