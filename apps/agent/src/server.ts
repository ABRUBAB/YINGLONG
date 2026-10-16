import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { abi, LEDGERS, type LedgerName } from "@yinglong/sdk";
import { compileMandate, decompile, hashRingGeometry, namesFor, verifyRoundTrip, type Mandate } from "@yinglong/mandate";
import { ledgerContext } from "./chain/ledger";
import { providerStatus } from "./llm/provider";
import { ask, bypass, createPauseApproval, createRevokeApproval, declineApproval, demoApprove, execute, hijack, proposals, submitApproval } from "./pipeline";
import { receiptLog, type ReceiptRecord } from "./receipts";
import { attempt, challenge, session } from "./challenge";
import { board, createBoardProposal, directorSign } from "./board";
import { explainTx } from "./explorer";
import { apiJson, DATA_DIR } from "./store";
import { config, isVisitorId, onboard, PRINCIPALS, visitorStore, world, type PrincipalId, type PrincipalState } from "./world";
import { registerVisitor, sealVisitor, visitorStatus, visitorTokenOk } from "./visitors";

const VERSION = "0.9.0";
const app = new Hono();
app.use("*", cors({ origin: (o) => o ?? "*", allowMethods: ["GET", "POST"], allowHeaders: ["Content-Type", "x-visitor-token"] }));
app.onError((err, c) => c.json({ ok: false, error: err.message }, 400));

// Per-client rate limit (in memory) and an admin token for state-changing calls on the demo principals.
const ADMIN = process.env.AGENT_ADMIN_TOKEN ?? readSecret(process.env.AGENT_ADMIN_TOKEN_FILE);
function readSecret(path?: string): string | undefined {
  try {
    return path ? readFileSync(path, "utf8").trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}
const hits = new Map<string, { n: number; at: number }>();
app.use("/v1/*", async (c, next) => {
  // The operator's own drills and demo driver are not throttled; everyone else is.
  if (ADMIN && c.req.header("x-admin-token") === ADMIN) return next();
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) hits.set(ip, { n: 1, at: now });
  else if (++h.n > Number(process.env.RATE_LIMIT_PER_MIN ?? 60)) return c.json({ ok: false, error: "rate limit" }, 429);
  await next();
});
const PROTECTED = [/\/halt$/, /\/board-proposals$/, /\/sign$/, /\/onboard$/, /\/execute$/, /\/demo-sign$/, /\/attack$/, /\/bypass$/, /\/decline$/];
// A visitor (signed up with their own passkey) may drive their own agent: execute, bypass and decline their own
// proposals and approvals, and run the attack demonstration on their own account. Never anyone else's.
const VISITOR_OK = [/^\/v1\/proposals\/([^/]+)\/(execute|bypass)$/, /^\/v1\/approvals\/([^/]+)\/decline$/, /^\/v1\/principals\/([^/]+)\/attack$/];
function visitorMayCall(path: string, token: string | undefined): boolean {
  for (const re of VISITOR_OK) {
    const m = path.match(re);
    if (!m) continue;
    const ref = m[1]!;
    const principal = path.startsWith("/v1/proposals/")
      ? proposals.get().proposals[ref]?.principal
      : path.startsWith("/v1/approvals/")
        ? proposals.get().approvals[ref]?.principal
        : ref;
    return !!principal && isVisitorId(principal) && visitorTokenOk(principal, token);
  }
  return false;
}
app.use("/v1/*", async (c, next) => {
  if (ADMIN && c.req.method === "POST" && PROTECTED.some((re) => re.test(c.req.path)) && c.req.header("x-admin-token") !== ADMIN && !visitorMayCall(c.req.path, c.req.header("x-visitor-token"))) {
    return c.json({ ok: false, error: "this action needs the operator token (judges: use the Judge's Challenge guest agent)" }, 403);
  }
  await next();
});

const isPid = (s: string): s is PrincipalId => PRINCIPALS.some((p) => p.id === s) || (isVisitorId(s) && !!world.get().principals[s]);

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
    passkeyIds: isVisitorId(st.id) ? [visitorStore.get().visitors[st.id]?.keyId].filter((k): k is string => !!k) : ([] as string[]),
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
  attachments: z
    .array(z.object({ kind: z.enum(["invoice", "email", "quote", "invoice_image"]), content: z.string().max(3_000_000) }))
    .max(3)
    .optional(),
  autoExecute: z.boolean().optional(),
});

// ---------------------------------------------------------------- visitors (sign up with your own passkey)
app.post("/v1/visitors", async (c) => {
  const b = z.object({ credentialId: z.string(), publicKey: z.object({ x: z.string(), y: z.string() }) }).parse(await c.req.json());
  return c.json(apiJson(await registerVisitor({ credentialId: b.credentialId, x: b.publicKey.x as Hex, y: b.publicKey.y as Hex })));
});
app.post("/v1/visitors/:id/seal", async (c) => {
  const b = z.object({ userOpSignature: z.string().regex(/^0x[0-9a-fA-F]+$/), delegationSignature: z.string().regex(/^0x[0-9a-fA-F]+$/) }).parse(await c.req.json());
  const st = await sealVisitor(c.req.param("id"), c.req.header("x-visitor-token"), { userOpSignature: b.userOpSignature as Hex, delegationSignature: b.delegationSignature as Hex });
  return c.json(apiJson({ principal: await principalSummary(st), mandateHash: st.mandateHash, publishTx: st.publishTx }));
});
app.get("/v1/visitors/:id", (c) => {
  const v = visitorStatus(c.req.param("id"));
  return v ? c.json(apiJson(v)) : c.json({ ok: false, error: "unknown visitor" }, 404);
});

app.post("/v1/principals/:id/ask", async (c) => {
  const id = c.req.param("id");
  if (!isPid(id)) return c.json({ ok: false, error: "unknown principal" }, 404);
  const body = AskBody.parse(await c.req.json());
  if (body.autoExecute && id !== "guest" && ADMIN && c.req.header("x-admin-token") !== ADMIN && !(isVisitorId(id) && visitorTokenOk(id, c.req.header("x-visitor-token")))) {
    return c.json({ ok: false, error: "autoExecute on this principal needs the operator token (judges: use the Judge's Challenge)" }, 403);
  }
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
app.post("/v1/principals/:id/pause", async (c) => {
  const id = c.req.param("id");
  if (!isPid(id)) return c.json({ ok: false, error: "unknown principal" }, 404);
  const a = await createPauseApproval(id, "pause");
  return c.json(apiJson({ approvalId: a.id, approval: a }));
});
app.post("/v1/principals/:id/resume", async (c) => {
  const id = c.req.param("id");
  if (!isPid(id)) return c.json({ ok: false, error: "unknown principal" }, 404);
  const a = await createPauseApproval(id, "resume");
  return c.json(apiJson({ approvalId: a.id, approval: a }));
});
app.post("/v1/principals/:id/revoke", async (c) => {
  const id = c.req.param("id");
  if (!isPid(id)) return c.json({ ok: false, error: "unknown principal" }, 404);
  const a = await createRevokeApproval(id);
  return c.json(apiJson({ approvalId: a.id, approval: a }));
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
app.get("/v1/receipts/:id", async (c) => {
  const r = receiptLog.all().find((x) => x.receipt.receiptId === c.req.param("id"));
  if (!r) return c.json({ ok: false, error: "not found" }, 404);
  let anchor: unknown;
  try {
    const res = await fetch(`${process.env.INDEXER_URL ?? "http://127.0.0.1:8791"}/proof/${r.receipt.receiptId}`);
    if (res.ok) anchor = await res.json();
  } catch {
    /* not anchored yet or indexer down */
  }
  return c.json(apiJson({ ...receiptView(r), anchor, proofPairing: "sorted" }));
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

app.get("/v1/challenge/session", (c) => c.json(apiJson(session())));
app.get("/v1/challenge/attempts", (c) => c.json(apiJson(challenge.get().attempts.slice(-200).reverse().map(({ text: _t, ...rest }) => rest))));
app.post("/v1/challenge/attempt", async (c) => {
  const b = z
    .object({ handle: z.string().max(40).optional(), text: z.string().min(1).max(1000), attachment: z.string().max(4000).optional(), bypass: z.boolean().optional() })
    .parse(await c.req.json());
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return c.json(apiJson(await attempt({ ip, ...b })));
});

app.get("/v1/board-proposals", (c) => {
  const principal = c.req.query("principal");
  return c.json(apiJson(Object.values(board.get().proposals).filter((b) => !principal || b.principal === principal)));
});
app.post("/v1/principals/:id/board-proposals", async (c) => {
  const id = c.req.param("id");
  if (!isPid(id) || config(id).kind !== "company") return c.json({ ok: false, error: "board proposals are for company principals" }, 400);
  const b = z
    .object({ kind: z.enum(["payment", "resume"]).default("payment"), payeeId: z.string().default(""), amount: z.string().regex(/^[0-9]+$/).default("0"), title: z.string().min(1).max(120) })
    .parse(await c.req.json());
  return c.json(apiJson(await createBoardProposal(id, { kind: b.kind, payeeId: b.payeeId, amount: BigInt(b.amount), title: b.title })));
});
app.post("/v1/board-proposals/:id/sign", async (c) => {
  const b = z.object({ director: z.enum(["director-1", "director-2", "director-3"]) }).parse(await c.req.json());
  return c.json(apiJson(await directorSign(c.req.param("id"), b.director)));
});

app.get("/v1/registry/agents", async (c) => {
  // Demo agents, then the most recent visitors' agents (default 20; ?visitors=<n>, at most 200).
  const nVisitors = Math.min(Number(c.req.query("visitors") ?? 20), 200);
  const all = Object.values(world.get().principals).filter((st): st is PrincipalState => !!st);
  const demo = all.filter((st) => !isVisitorId(st.id));
  const visitors = all.filter((st) => isVisitorId(st.id)).sort((a, b) => (b.sealedAt ?? "").localeCompare(a.sealedAt ?? "")).slice(0, nVisitors);
  const out = await Promise.all(
    [...demo, ...visitors].map(async (st) => {
      const ctx = ledgerContext(st.ledger);
      const p = await ctx.read<{ status: number; identityCode: string; ownerDidHash: Hex; agentWallet: Address }>({
        address: ctx.addr("YinglongPassportRegistry"),
        abi: abi.YinglongPassportRegistryAbi,
        functionName: "passportOf",
        args: [st.agentId],
      });
      return {
        agentId: st.agentId,
        ledger: st.ledger,
        wallet: p.agentWallet,
        label: config(st.id).agentLabel,
        principal: st.id,
        kind: isVisitorId(st.id) ? "visitor" : "demo",
        identityCode: p.identityCode,
        ownerDidHash: p.ownerDidHash,
        status: ["none", "active", "halted", "revoked"][Number(p.status)],
      };
    }),
  );
  return c.json(apiJson(out));
});

app.post("/v1/supervisor/agents/:agentId/halt", async (c) => {
  const b = z.object({ halted: z.boolean(), ledger: z.enum(["anvil", "base-sepolia", "fisco"]) }).parse(await c.req.json());
  const ctx = ledgerContext(b.ledger);
  const res = await ctx.write("supervisor", {
    address: ctx.addr("YinglongPassportRegistry"),
    abi: abi.YinglongPassportRegistryAbi as never,
    functionName: "supervisorSetStatus",
    args: [BigInt(c.req.param("agentId")), b.halted],
  });
  return c.json(apiJson({ ok: res.ok, txHash: res.hash, explorerUrl: ctx.explorerTx(res.hash), halted: b.halted, note: "Supervisory halt: pause only. The supervisor cannot spend, rotate keys or change mandates." }));
});
app.get("/v1/supervisor/agents/:agentId/private-mandate", (c) => {
  for (const l of ["fisco", "base-sepolia", "anvil"]) {
    const f = [resolve(DATA_DIR, `zk-${l}.json`), resolve(import.meta.dirname, "..", "data", `zk-${l}.json`)].find((x) => existsSync(x));
    if (f) {
      const j = JSON.parse(readFileSync(f, "utf8")) as { supervisorView?: { agentId?: string | number } };
      if (j.supervisorView && String(j.supervisorView.agentId) === c.req.param("agentId")) return c.json(j.supervisorView);
    }
  }
  return c.json({ ok: false, error: "no private mandate recorded for this agent" }, 404);
});

app.get("/v1/tx/:ledger/:hash", async (c) => {
  const ledger = z.enum(["anvil", "base-sepolia", "fisco"]).parse(c.req.param("ledger"));
  const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(c.req.param("hash")) as Hex;
  return c.json(apiJson(await explainTx(ledger, hash)));
});

app.get("/v1/evidence", (c) => {
  const items = receiptLog
    .all()
    .filter((r) => r.receipt.txHash && !r.receipt.txHash.startsWith("0x0000000000"))
    .map((r) => ({ title: r.explanation.text, principal: r.principal, ledger: r.ledger, txHash: r.receipt.txHash, explorerUrl: r.explorerUrl, outcome: r.receipt.outcome, tier: r.receipt.tier, revertError: r.revertError?.message }));
  const contracts: { name: string; ledger: string; chainId: number; address: string; codeHash: string }[] = [];
  for (const l of ["fisco", "base-sepolia", "anvil"] as const) {
    try {
      const ctx = ledgerContext(l);
      for (const [name, v] of Object.entries({ ...ctx.deployment.contracts, ...ctx.deployment.optional })) {
        if (v) contracts.push({ name, ledger: l, chainId: ctx.profile.chainId, address: v.address, codeHash: v.codeHash });
      }
    } catch {
      /* ledger not deployed */
    }
  }
  return c.json(apiJson({ generatedAt: new Date().toISOString(), commit: process.env.GIT_COMMIT ?? "", items, contracts }));
});

const port = Number(process.env.AGENT_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: process.env.AGENT_HOST ?? "127.0.0.1" });
console.log(`agent API on ${process.env.AGENT_HOST ?? "127.0.0.1"}:${port} (ledgers: ${PRINCIPALS.map((p) => `${p.id}=${p.ledger as LedgerName}`).join(", ")})`);
