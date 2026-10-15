import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeRevert, ledger as ledgerProfile, revertDataOf, type LedgerName } from "@yinglong/sdk";
import { loadDeployment, rolePrivateKey } from "@yinglong/sdk/server";
import { guardRedemption } from "./guard";

/**
 * apps/signer: the only process that holds agent keys. Listens on 127.0.0.1 only. It signs a redemption only
 * if (1) the guard accepts its shape, (2) the agent runtime's decision record says it is allowed (T1, or T2
 * with the user's approval attached), and (3) a fresh simulation at the current head succeeds (the chain's
 * own rules are the final policy check). "chain-test" mode exists only to demonstrate that the chain refuses
 * what the policy refused (Judge's Challenge "bypass"): it accepts only T4 decisions and expects a revert.
 * When the signer refuses for a policy reason it asks the breaker watcher to pause the account.
 */
const AGENT_ROLES = ["agent-ying", "agent-treasurer", "guest-arena"] as const;

const Req = z.object({
  ledger: z.enum(["anvil", "base-sepolia", "fisco"]),
  agentRole: z.enum(AGENT_ROLES),
  calldata: z.string().regex(/^0x[0-9a-fA-F]*$/),
  decision: z.object({ tier: z.enum(["T1", "T2", "T3", "T4", "ASK"]), proposalId: z.string(), approved: z.boolean().optional() }),
  mode: z.enum(["normal", "chain-test"]).default("normal"),
  account: z.string().optional(),
});

const app = new Hono();
const log: { at: string; ledger: string; role: string; ok: boolean; reason?: string; txHash?: Hex; mode: string }[] = [];

function clients(name: LedgerName, role: (typeof AGENT_ROLES)[number]) {
  const p = ledgerProfile(name);
  const chain = defineChain({ id: p.chainId, name: p.label, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [p.rpcUrl] } } });
  const account = privateKeyToAccount(rolePrivateKey(role));
  return {
    p,
    chain,
    account,
    pub: createPublicClient({ chain, cacheTime: 0, transport: http(p.rpcUrl) }),
    wallet: createWalletClient({ chain, account, transport: http(p.rpcUrl) }),
  };
}

async function tripBreaker(account: string | undefined, reason: string) {
  const url = process.env.BREAKER_URL ?? "http://127.0.0.1:8791/breaker/trip";
  if (!account) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account, reason, by: "signer" }) });
  } catch {
    /* the breaker watcher is optional in development */
  }
}

app.get("/health", (c) => c.json({ ok: true, roles: AGENT_ROLES, signed: log.filter((l) => l.ok).length, refused: log.filter((l) => !l.ok).length }));
app.get("/v1/log", (c) => c.json(log.slice(-200)));

app.post("/v1/redeem", async (c) => {
  const parsed = Req.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ ok: false, reason: "bad request" }, 400);
  const r = parsed.data;
  const { p, chain, account, pub, wallet } = clients(r.ledger, r.agentRole);
  const deployment = loadDeployment(r.ledger);
  const refuse = async (reason: string, policy = false) => {
    log.push({ at: new Date().toISOString(), ledger: r.ledger, role: r.agentRole, ok: false, reason, mode: r.mode });
    if (policy) await tripBreaker(r.account, `signer refused: ${reason}`);
    return c.json({ ok: false, reason }, 403);
  };

  const g = guardRedemption({ deployment, agent: account.address, to: deployment.contracts.DelegationManager.address as Address, data: r.calldata as Hex, value: 0n });
  if (!g.ok) return refuse(`guard: ${g.reason}`, true);

  if (r.mode === "normal") {
    const allowed = r.decision.tier === "T1" || (r.decision.tier === "T2" && r.decision.approved === true);
    if (!allowed) return refuse(`decision ${r.decision.tier} is not signable`, true);
    try {
      await pub.call({ account: account.address, to: deployment.contracts.DelegationManager.address, data: r.calldata as Hex });
    } catch (e) {
      return refuse(`simulation at head failed: ${decodeRevert(revertDataOf(e)).message}`, true);
    }
  } else if (r.decision.tier !== "T4") {
    return refuse("chain-test mode only demonstrates refusals of T4 decisions");
  }

  const txHash = await wallet.sendTransaction({
    to: deployment.contracts.DelegationManager.address,
    data: r.calldata as Hex,
    chain,
    account,
    ...(r.mode === "chain-test" ? { gas: 1_500_000n } : {}),
    ...(p.legacyTx ? { type: "legacy" as const, gasPrice: p.gasPrice ?? 0n } : {}),
  });
  log.push({ at: new Date().toISOString(), ledger: r.ledger, role: r.agentRole, ok: true, txHash, mode: r.mode });
  return c.json({ ok: true, txHash });
});

const port = Number(process.env.SIGNER_PORT ?? 8788);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`signer listening on 127.0.0.1:${port}`);
