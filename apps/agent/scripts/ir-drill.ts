// Incident-response drill, playbook 1 (agent key leak), against the live agent API.
// Usage (repo root): npx tsx apps/agent/scripts/ir-drill.ts [--api https://api.yinglong-agent.tech] [--ledger fisco]
//                    [--rpc https://api.yinglong-agent.tech/rpc/fisco] [--no-recheck]
//
// It uses a FRESH visitor principal signed up with a software P-256 passkey (the visitor-e2e flow); it never touches
// the demo principals. Steps, all timed from t0 on the drill client's clock:
//   t0       the "leaked agent key" attack: POST /v1/principals/<visitor>/attack (visitor token) sends the raw
//            redemption a hijacked agent would send, to a fresh attacker address with no funds; it must revert on-chain
//   detect   a watcher polling GET /v1/receipts?principal=<visitor> sees the reverted receipt with its transaction hash
//   pause    the passkey signs Trip; the relayer's tripWithSig is included on-chain
//   revoke   the passkey signs the revoke user operation (MandateRegistry.revoke + disableDelegation); included
//   rotate   re-seal with the SAME passkey (POST /v1/visitors again, both requests signed, POST seal), then the passkey
//            signs Untrip. The agent key itself is NOT rotated in this drill (the agent wallet is derived by the server;
//            no route rotates it), so this step measures re-seal and resume only.
//   notify   not automated (no notification channel exists); recorded as such
//   evidence pb1.json written and its SHA-256 computed (time recorded in pb1.sha256, since a file cannot hold its own hash)
// Exposure is measured, not assumed: remaining period caps at t0 (from the state route), the account's balance before
// the attack and after the pause, and the attacker's balance before and after (read through the public read-only RPC).
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, toHex, type Address, type Hex } from "viem";
import { repoRoot } from "@yinglong/sdk/server";
import { Api, deploymentAddress, freshPasskey, opt, passkeyAction, Rpc, signUpAndSeal, type ReceiptView } from "./lib/visitor";

const args = process.argv.slice(2);
const API = opt(args, "--api", "https://api.yinglong-agent.tech");
const LEDGER = opt(args, "--ledger", "fisco");
const RPC = opt(args, "--rpc", `${API}/rpc/fisco`);
const RECHECK = !args.includes("--no-recheck");

interface State {
  principal: { paused: boolean; agent: { agentId: string; passportStatus: string } };
  balances: { symbol: string; address: Address; decimals: number; amount: string }[];
  budgets: { symbol: string; decimals: number; category: string; cap: string; spent: string; periodEndsAt: string }[];
  mandate: { mandateHash: Hex; publishTx: Hex } | null;
  block: string;
}

async function main() {
  const api = new Api(API);
  const rpc = new Rpc(RPC);
  const tHKD = deploymentAddress(LEDGER, "TestHKD");
  const steps: Record<string, unknown>[] = [];

  // ---------------------------------------------------------------- setup (before t0)
  const key = freshPasskey();
  const v = await signUpAndSeal(api, key);
  console.log(JSON.stringify({ setup: "visitor sealed", visitorId: v.visitorId, account: v.account, agentId: v.agent.agentId, publishTx: v.publishTx, signer: v.signer }));
  const st0 = await api.call<State>("GET", `/v1/principals/${v.visitorId}/state`);
  const remainingCaps: Record<string, bigint> = {};
  for (const b of st0.budgets) remainingCaps[b.symbol] = (remainingCaps[b.symbol] ?? 0n) + (BigInt(b.cap) - BigInt(b.spent) > 0n ? BigInt(b.cap) - BigInt(b.spent) : 0n);
  const attacker = getAddress(toHex(randomBytes(20))) as Address;
  const acct0 = await rpc.balanceOf(tHKD, v.account);
  const atk0 = await rpc.balanceOf(tHKD, attacker);
  const amount = 100_000_000n; // 100 tHKD (6 decimals): above every visitor cap, to a payee that is not in the book

  // ---------------------------------------------------------------- t0: the leaked key is used
  const t0 = Date.now();
  const at = (t: number) => t - t0;
  const atk = await api.call<{ proposal: { tier: string; scales: { name: string; status: string; typedError?: string }[] }; receipt?: ReceiptView }>(
    "POST",
    `/v1/principals/${v.visitorId}/attack`,
    { to: attacker, amount: amount.toString(), symbol: "tHKD", family: "leaked agent key (IR drill pb1)" },
  );
  const tAttack = Date.now();
  steps.push({ step: "attack", atMs: at(tAttack), tier: atk.proposal.tier, outcome: atk.receipt?.outcome, txHash: atk.receipt?.txHash, revert: atk.receipt?.revertError?.message });
  if (atk.receipt?.outcome !== "reverted" || !atk.receipt.txHash) throw new Error(`the attack did not produce an on-chain revert: ${JSON.stringify(atk.receipt ?? atk.proposal.tier)}`);

  // ---------------------------------------------------------------- detect: a watcher sees the revert receipt
  let detected: ReceiptView | undefined;
  let polls = 0;
  for (; polls < 40 && !detected; polls++) {
    const rows = await api.call<ReceiptView[]>("GET", `/v1/receipts?principal=${v.visitorId}&limit=20`, undefined, { visitor: false });
    detected = rows.find((r) => r.outcome === "reverted" && r.txHash?.toLowerCase() === atk.receipt!.txHash!.toLowerCase());
    if (!detected) await new Promise((r) => setTimeout(r, 500));
  }
  const tDetect = Date.now();
  if (!detected) throw new Error("the watcher never saw the reverted receipt");
  const revertRcpt = await rpc.receipt(detected.txHash!);
  steps.push({ step: "detect", atMs: at(tDetect), polls, receiptId: detected.receiptId, txHash: detected.txHash, revert: detected.revertError?.message, onChainStatus: revertRcpt?.status, block: revertRcpt ? Number(BigInt(revertRcpt.blockNumber)) : undefined });

  // ---------------------------------------------------------------- pause (passkey Trip, relayed)
  const pause = await passkeyAction(api, v, "pause");
  const tPause = Date.now();
  if (pause.receipt.outcome !== "confirmed") throw new Error(`pause not confirmed: ${pause.receipt.outcome}`);
  const stPaused = await api.call<State>("GET", `/v1/principals/${v.visitorId}/state`);
  steps.push({ step: "pause", atMs: at(tPause), txHash: pause.receipt.txHash, serverMs: pause.serverMs, block: pause.block, signed: pause.primaryType, pausedAfter: stPaused.principal.paused });
  const acctAfterPause = await rpc.balanceOf(tHKD, v.account);
  const atkAfterPause = await rpc.balanceOf(tHKD, attacker);

  // ---------------------------------------------------------------- revoke (one user operation)
  const revoke = await passkeyAction(api, v, "revoke");
  const tRevoke = Date.now();
  if (revoke.receipt.outcome !== "confirmed") throw new Error(`revoke not confirmed: ${revoke.receipt.outcome}`);
  steps.push({ step: "revoke", atMs: at(tRevoke), txHash: revoke.receipt.txHash, serverMs: revoke.serverMs, block: revoke.block, signed: revoke.primaryType, revokedMandate: v.mandateHash });

  // ---------------------------------------------------------------- rotate: re-seal with the same passkey, then resume
  const resealed = await signUpAndSeal(api, key);
  const tReseal = Date.now();
  if (resealed.visitorId !== v.visitorId) throw new Error("re-sealing with the same passkey produced a different visitor id");
  steps.push({ step: "reseal", atMs: at(tReseal), publishTx: resealed.publishTx, newMandateHash: resealed.mandateHash, sameAgentWallet: resealed.agent.wallet === v.agent.wallet, agentWallet: resealed.agent.wallet });
  const resume = await passkeyAction(api, v, "resume");
  const tRotate = Date.now();
  if (resume.receipt.outcome !== "confirmed") throw new Error(`resume not confirmed: ${resume.receipt.outcome}`);
  steps.push({ step: "resume", atMs: at(tRotate), txHash: resume.receipt.txHash, serverMs: resume.serverMs, block: resume.block, signed: resume.primaryType });

  // ---------------------------------------------------------------- evidence
  const fmt = (x: bigint) => x.toString();
  const out = {
    schema: "yinglong.ir-drill/1",
    playbook: 1,
    name: "agent key leak",
    drillId: `pb1-${new Date(t0).toISOString().replace(/[:.]/g, "-")}`,
    generatedBy: "apps/agent/scripts/ir-drill.ts",
    api: API,
    ledger: LEDGER,
    t0: new Date(t0).toISOString(),
    principal: { visitorId: v.visitorId, account: v.account, agentId: v.agent.agentId, agentWallet: v.agent.wallet, sealedBy: v.signer, sealTx: v.publishTx, mandateHash: v.mandateHash },
    method:
      "Times are milliseconds from t0 on the drill client's clock (each step ends when the API response arrives; pause, revoke and resume responses arrive after the transaction receipt). serverMs is measured by the agent API next to the ledger from submitting the signed message to its receipt. The passkey is a software P-256 key (scripted); the web app uses a WebAuthn passkey that the account verifies the same way. Detection is a client watcher polling the public receipts route every 500 ms.",
    timesMs: {
      detect: at(tDetect),
      pause: at(tPause),
      revoke: at(tRevoke),
      rotate: at(tRotate),
      notify: null as number | null,
    },
    notify: "not automated: there is no notification channel; the app shows the paused state and the receipts",
    rotate: "re-seal with the same passkey plus resume; the agent key is not rotated in this drill (no route rotates the server-derived agent wallet)",
    transactions: {
      attackRevert: atk.receipt.txHash,
      pause: pause.receipt.txHash,
      revoke: revoke.receipt.txHash,
      reseal: resealed.publishTx,
      resume: resume.receipt.txHash,
    },
    exposure: {
      asset: "tHKD",
      attacker,
      attemptedAmount: fmt(amount),
      remainingCapsAtT0: Object.fromEntries(Object.entries(remainingCaps).map(([k, x]) => [k, fmt(x)])),
      accountBalanceBefore: fmt(acct0),
      accountBalanceAfterPause: fmt(acctAfterPause),
      attackerBalanceBefore: fmt(atk0),
      attackerBalanceAfterPause: fmt(atkAfterPause),
      actualLoss: fmt(acct0 - acctAfterPause > 0n ? acct0 - acctAfterPause : 0n),
      note: "actual loss = account balance before the attack minus balance after the pause (no in-mandate redemption ran in between); max at risk = remaining period caps at t0",
    },
    steps,
  };
  const dir = resolve(repoRoot(), "docs/evidence/drills");
  mkdirSync(dir, { recursive: true });
  const f = resolve(dir, "pb1.json");
  writeFileSync(f, `${JSON.stringify(out, null, 2)}\n`);
  const sha = createHash("sha256").update(readFileSync(f)).digest("hex");
  const tEvidence = Date.now();
  writeFileSync(resolve(dir, "pb1.sha256"), `${sha}  pb1.json\n# evidence written and hashed at +${at(tEvidence)} ms from t0 (${out.drillId})\n`);
  console.log(JSON.stringify({ wrote: f, sha256: sha, timesMs: { ...out.timesMs, evidence: at(tEvidence) }, transactions: out.transactions, exposure: out.exposure }, null, 2));

  // ---------------------------------------------------------------- after the drill: the agent works again under the new mandate
  // Kept out of pb1.json so the evidence time is not inflated by this optional check (it runs the intent model).
  if (RECHECK) {
    const r = await api.call<{ tier: string; receipt?: ReceiptView }>("POST", `/v1/principals/${v.visitorId}/ask`, { text: "Buy a coffee at Arena Cafe for 5 HKD", autoExecute: true });
    const recheck = { drillId: out.drillId, generatedBy: "apps/agent/scripts/ir-drill.ts", what: "T1 payment under the re-sealed mandate after resume", atMs: at(Date.now()), tier: r.tier, outcome: r.receipt?.outcome, txHash: r.receipt?.txHash };
    writeFileSync(resolve(dir, "pb1-recheck.json"), `${JSON.stringify(recheck, null, 2)}\n`);
    console.log(JSON.stringify(recheck));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
