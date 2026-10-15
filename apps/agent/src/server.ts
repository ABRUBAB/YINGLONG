import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { abi, LEDGERS, type LedgerName } from "@yinglong/sdk";
import { compileMandate, decompile, hashRingGeometry, namesFor, verifyRoundTrip, type Mandate } from "@yinglong/mandate";
import { ledgerContext } from "./chain/ledger";
import { providerStatus } from "./llm/provider";
import { ask, bypass, declineApproval, demoApprove, execute, hijack, proposals, submitApproval } from "./pipeline";
import { receiptLog, type ReceiptRecord } from "./receipts";
import { apiJson } from "./store";
import { config, onboard, PRINCIPALS, world, type PrincipalId, type PrincipalState } from "./world";

const VERSION = "0.9.0";
const app = new Hono();
app.use("*", cors({ origin: (o) => o ?? "*", allowMethods: ["GET", "POST"], allowHeaders: ["Content-Type"] }));
app.onError((err, c) => c.json({ ok: false, error: err.message }, 400));

const isPid = (s: string): s is PrincipalId => PRINCIPALS.some((p) => p.id === s);

function mandateView(st: PrincipalState) {
  if (!st.mandate || !st.delegation) return null;
  const ctx = ledgerContext(st.ledger);
  const m = st.mandate as Mandate;
  const names = namesFor(ctx.deployment, m);
  const { rules, sentences } = decompile(st.delegation.caveats, ctx.deployment, names, ctx.profile.timeUnit);
  const rt = verifyRoundTrip({
    mandate: m,
    deployment: ctx.deployment,
    onChainCaveats: st.delegation.caveats,
    onChainDelegationHash: st.delegationHash!,
    delegator: st.account,
    delegate: st.agentWallet,
    salt: st.delegation.salt,
    timeUnit: ctx.profile.timeUnit,
  });
  return {
    mandateHash: st.mandateHash,
    delegationHash: st.delegationHash,
    lineageId: m.lineageId,
    jurisdiction: m.jurisdiction,
    validFrom: m.validity.from,
    validUntil: m.validity.until,
    publishTx: st.publishTx,
    explorerUrl: st.publishTx ? ctx.explorerTx(st.publishTx) : undefined,
    ledger: st.ledger,
    sentences,
    userSentences: m.sentences,
    rules: rules.map((r, i) => ({ enforcer: st.delegation!.caveats[i]!.enforcer, kind: r.kind, sentence: sentences[i], params: r })),
    roundTrip: rt,
    hashRing: hashRingGeometry(st.delegationHash!),
    sealedBy: st.signerLabel,
    sealedAt: st.sealedAt,
  };
}

async function principalSummary(st: PrincipalState) {
  const cfg = config(st.id);
  const ctx = ledgerContext(st.ledger);
  const [paused, info] = await Promise.all([
    ctx.read<boolean>({ address: ctx.addr("KillSwitchRegistry"), abi: abi.KillSwitchRegistryAbi, functionName: "isPaused", args: [st.account, st.agentWallet] }),
    ctx.read<[bigint, number, Hex]>({ address: ctx.addr("YinglongPassportRegistry"), abi: abi.YinglongPassportRegistryAbi, functionName: "walletInfo", args: [st.agentWallet] }),
  ]);
  return {
    id: st.id,
    kind: cfg.kind,
    name: cfg.name,
    account: st.account,
    did: st.did,
    ledger: st.ledger,
    ledgerBadge: ctx.profile.badge,
    jurisdiction: (st.mandate as Mandate | undefined)?.jurisdiction,
    signer: st.signerLabel,
    passkeyIds: [] as string[],
    agent: { label: cfg.agentLabel, wallet: st.agentWallet, agentId: st.agentId, passportStatus: ["none", "active", "halted", "revoked"][Number(info[1])], identityCode: cfg.identityCode },
    paused,
  };
}

function receiptView(r: ReceiptRecord) {
  return {
    receiptId: r.receipt.receiptId,
    principal: r.principal,
    ledger: r.ledger,
    ledgerBadge: LEDGERS[r.ledger].badge,
    chainId: r.receipt.chainId,
    source: r.receipt.source,
    tier: r.receipt.tier,
    outcome: r.receipt.outcome,
    txHash: r.receipt.txHash.startsWith("0x00000000000000000000") ? undefined : r.receipt.txHash,
    explorerUrl: r.explorerUrl,
    revertError: r.revertError,
    mandateHash: r.receipt.mandateHash,
    delegationHash: r.receipt.delegationHash,
    intentHash: r.receipt.intentHash,
    agentId: r.receipt.agentId,
    payment: r.payment,
    explanation: r.explanation,
    aigc: r.aigc,
    prevReceiptHash: r.receipt.prevReceiptHash,
    receiptHash: r.receiptHash,
    timestamp: new Date(Number(r.receipt.timestamp) * 1000).toISOString(),
    receipt: r.receipt,
  };
}

// ---------------------------------------------------------------- routes

app.get("/v1/health", async (c) => {
  const used = new Set(PRINCIPALS.map((p) => p.ledger));
  const ledgers = await Promise.all(
    [...used].map(async (n) => {
      try {
        const ctx = ledgerContext(n);
        return { name: n, chainId: ctx.profile.chainId, block: (await ctx.pub.getBlockNumber()).toString(), badge: ctx.profile.badge, ok: true };
      } catch (e) {
        return { name: n, ok: false, error: (e as Error).message };
      }
    }),
  );
  return c.json({ ok: true, version: VERSION, ledgers, models: { intent: providerStatus(), sentinel: { url: !!process.env.SENTINEL_URL } } });
});

app.get("/v1/principals", async (c) => {
  const out = [];
  for (const p of PRINCIPALS) {
    const st = world.get().principals[p.id];
    if (st) out.push(await principalSummary(st));
  }
  return c.json(apiJson(out));
});

app.post("/v1/principals/:id/onboard", async (c) => {
  const id = c.req.param("id");
  if (!isPid(id)) return c.json({ ok: false, error: "unknown principal" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { reseal?: boolean };
  const st = await onboard(id, { reseal: !!body.reseal });
  return c.json(apiJson(await principalSummary(st)));
});

app.get("/v1/principals/:id/state", async (c) => {
  const id = c.req.param("id");
  if (!isPid(id)) return c.json({ ok: false, error: "unknown principal" }, 404);
  const st = world.get().principals[id];
  if (!st?.mandate) return c.json({ ok: false, error: "not onboarded" }, 404);
  const ctx = ledgerContext(st.ledger);
  const m = st.mandate as Mandate;
  const block = await ctx.pub.getBlock();
  const balances = await Promise.all(
    m.assets.map(async (a) => ({
      symbol: a.symbol,
      address: a.address,
      decimals: a.decimals,
      amount: (await ctx.read<bigint>({ address: a.address as Address, abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [st.account] })).toString(),
    })),
  );
  const dm = ctx.addr("DelegationManager");
  const budgets = [];
  for (const b of m.budgets) {
    const asset = m.assets.find((a) => a.symbol === b.asset)!;
    for (const cap of b.caps) {
      const { CATEGORY_IDS } = await import("@yinglong/mandate");
      const spent = await ctx.read<bigint>({
        address: ctx.addr("CategoryBudgetEnforcer"),
        abi: abi.CategoryBudgetEnforcerAbi,
        functionName: "spentNow",
        args: [dm, st.account, asset.address as Address, CATEGORY_IDS[cap.category as keyof typeof CATEGORY_IDS], BigInt(b.periodStart), BigInt(b.periodLength)],
      });
      const period = (block.timestamp - BigInt(b.periodStart)) / BigInt(b.periodLength);
      const endsAt = BigInt(b.periodStart) + (period + 1n) * BigInt(b.periodLength);
      budgets.push({ symbol: asset.symbol, decimals: asset.decimals, category: cap.category, cap: cap.amount, spent: spent.toString(), periodLengthSeconds: b.periodLength, periodEndsAt: new Date(Number(endsAt) * 1000).toISOString() });
    }
  }
  const summary = await principalSummary(st);
  return c.json(
    apiJson({
      principal: summary,
      balances,
      mandate: mandateView(st),
      budgets,
      tiers: m.tiers.map((t) => ({ symbol: t.asset, defaultT1Cap: t.defaultT1Cap, newPayeeT1Cap: t.newPayeeT1Cap, t2Ceiling: t.t2Ceiling, categoryT1Caps: t.categoryT1Caps })),
      reserveFloors: m.reserveFloors.map((f) => ({ symbol: f.asset, amount: f.amount })),
      velocity: m.velocity ? { symbol: m.velocity.asset, windowSeconds: m.velocity.window, maxCount: m.velocity.maxCount, maxOutflow: m.velocity.maxOutflow } : null,
      payees: m.payees,
      paused: summary.paused,
      block: block.number.toString(),
    }),
  );
});

const AskBody = z.object({
  text: z.string().min(1).max(4000),
  attachments: z.array(z.object({ kind: z.enum(["invoice", "email", "quote"]), content: z.string().max(20_000) })).optional(),
  autoExecute: z.boolean().optional(),
});

app.post("/v1/principals/:id/ask", async (c) => {
  const id = c.req.param("id");
  if (!isPid(id)) return c.json({ ok: false, error: "unknown principal" }, 404);
  const body = AskBody.parse(await c.req.json());
  const p = await ask(id, body.text, body.attachments ?? []);
  if (body.autoExecute && p.decision === "execute") {
    const rec = await execute(p.id);
    return c.json(apiJson({ ...stripInternal(proposals.get().proposals[p.id]!), receipt: receiptView(rec) }));
  }
  return c.json(apiJson(stripInternal(p)));
});

function stripInternal(p: (typeof proposals extends { get(): { proposals: Record<string, infer P> } } ? P : never)) {
  const { calldata: _c, execution: _e, ...rest } = p as unknown as Record<string, unknown>;
  return rest;
}

app.get("/v1/proposals/:id", (c) => {
  const p = proposals.get().proposals[c.req.param("id")];
  return p ? c.json(apiJson(stripInternal(p))) : c.json({ ok: false, error: "not found" }, 404);
});
app.post("/v1/proposals/:id/execute", async (c) => c.json(apiJson({ receipt: receiptView(await execute(c.req.param("id"))) })));
app.post("/v1/proposals/:id/bypass", async (c) => c.json(apiJson({ receipt: receiptView(await bypass(c.req.param("id"))) })));

app.get("/v1/approvals", (c) => {
  const principal = c.req.query("principal");
  const list = Object.values(proposals.get().approvals).filter((a) => !principal || a.principal === principal);
  return c.json(apiJson(list.slice(-50)));
});
app.get("/v1/approvals/:id", (c) => {
  const a = proposals.get().approvals[c.req.param("id")];
  return a ? c.json(apiJson(a)) : c.json({ ok: false, error: "not found" }, 404);
});
app.post("/v1/approvals/:id/signature", async (c) => {
  const body = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }).parse(await c.req.json());
  return c.json(apiJson({ receipt: receiptView(await submitApproval(c.req.param("id"), body.signature as Hex)) }));
});
app.post("/v1/approvals/:id/decline", (c) => c.json(apiJson(declineApproval(c.req.param("id")))));
app.post("/v1/principals/:id/attack", async (c) => {
  const id = c.req.param("id");
  if (!isPid(id)) return c.json({ ok: false, error: "unknown principal" }, 404);
  const b = z.object({ to: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amount: z.string().regex(/^[0-9]+$/), symbol: z.enum(["tHKD", "tUSD", "CNY"]), family: z.string().max(64) }).parse(await c.req.json());
  const r = await hijack(id, { to: b.to as Address, amount: BigInt(b.amount), symbol: b.symbol, family: b.family });
  return c.json(apiJson({ proposal: stripInternal(r.proposal), receipt: r.receipt ? receiptView(r.receipt) : undefined }));
});
app.post("/v1/approvals/:id/demo-sign", async (c) => c.json(apiJson({ receipt: receiptView(await demoApprove(c.req.param("id"))), signer: "scripted passkey (software P-256 key)" })));

app.get("/v1/receipts", (c) => {
  const principal = c.req.query("principal");
  const since = Number(c.req.query("since") ?? 0);
  const limit = Math.min(500, Number(c.req.query("limit") ?? 200));
  const all = receiptLog.all();
  const rows = all.slice(since).filter((r) => !principal || r.principal === principal);
  return c.json(apiJson(rows.slice(-limit).map(receiptView)));
});
app.get("/v1/receipts/:id", (c) => {
  const r = receiptLog.all().find((x) => x.receipt.receiptId === c.req.param("id"));
  return r ? c.json(apiJson(receiptView(r))) : c.json({ ok: false, error: "not found" }, 404);
});

app.post("/v1/mandates/compile", async (c) => {
  const body = z.object({ principal: z.string(), mandate: z.unknown() }).parse(await c.req.json());
  if (!isPid(body.principal)) return c.json({ ok: false, error: "unknown principal" }, 404);
  const st = world.get().principals[body.principal]!;
  const ctx = ledgerContext(st.ledger);
  const m = (body.mandate ?? st.mandate) as Mandate;
  const compiled = compileMandate(m, ctx.deployment);
  const { rules, sentences } = decompile(compiled.caveats, ctx.deployment, namesFor(ctx.deployment, m), ctx.profile.timeUnit);
  return c.json(
    apiJson({
      mandate: m,
      mandateHash: compiled.mandateHash,
      delegationHash: compiled.delegationHash,
      caveats: compiled.caveats.map((x) => ({ enforcer: x.enforcer, terms: x.terms })),
      sentences,
      rules,
      hashRing: hashRingGeometry(compiled.delegationHash),
    }),
  );
});

app.get("/v1/registry/agents", async (c) => {
  const out = [];
  for (const st of Object.values(world.get().principals)) {
    if (!st) continue;
    const ctx = ledgerContext(st.ledger);
    const p = await ctx.read<{ status: number; identityCode: string; ownerDidHash: Hex; agentWallet: Address }>({
      address: ctx.addr("YinglongPassportRegistry"),
      abi: abi.YinglongPassportRegistryAbi,
      functionName: "passportOf",
      args: [st.agentId],
    });
    out.push({ agentId: st.agentId, ledger: st.ledger, wallet: p.agentWallet, label: config(st.id).agentLabel, principal: st.id, identityCode: p.identityCode, ownerDidHash: p.ownerDidHash, status: ["none", "active", "halted", "revoked"][Number(p.status)] });
  }
  return c.json(apiJson(out));
});

app.get("/v1/evidence", (c) => {
  const items = receiptLog
    .all()
    .filter((r) => r.receipt.txHash && !r.receipt.txHash.startsWith("0x0000000000"))
    .map((r) => ({ title: r.explanation.text, principal: r.principal, ledger: r.ledger, txHash: r.receipt.txHash, explorerUrl: r.explorerUrl, outcome: r.receipt.outcome, tier: r.receipt.tier, revertError: r.revertError?.message }));
  return c.json(apiJson({ generatedAt: new Date().toISOString(), items }));
});

const port = Number(process.env.AGENT_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: process.env.AGENT_HOST ?? "127.0.0.1" });
console.log(`agent API on ${process.env.AGENT_HOST ?? "127.0.0.1"}:${port} (ledgers: ${PRINCIPALS.map((p) => `${p.id}=${p.ledger as LedgerName}`).join(", ")})`);
