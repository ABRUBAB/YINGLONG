import { Hono, type Context } from "hono";
import { getAddress } from "viem";
import type { LedgerName } from "@yinglong/sdk";
import { Anchorer } from "./anchoring";
import { BreakerWatcher } from "./breaker";
import { loadConfig, type IndexerConfig } from "./config";
import { ALLOWED_METHODS, FiscoRpcProxy, LOCAL_METHODS } from "./rpc-proxy";
import { makeNativeRevertReader, nativeConfigFromEnv } from "./fisco-native";

export interface IndexerDeps {
  config: IndexerConfig;
  anchorer: Anchorer;
  breaker: BreakerWatcher;
  proxy: FiscoRpcProxy;
}

export function makeIndexer(env: NodeJS.ProcessEnv = process.env): IndexerDeps {
  const config = loadConfig(env);
  return {
    config,
    anchorer: new Anchorer(config),
    breaker: new BreakerWatcher(config),
    proxy: new FiscoRpcProxy({
      upstreamUrl: config.fiscoRpcUrl,
      ratePerMin: config.proxyRateLimitPerMin,
      maxBlockRange: config.proxyMaxBlockRange,
      nativeRevert: (() => {
        const n = nativeConfigFromEnv(process.env);
        return n ? makeNativeRevertReader(n) : undefined;
      })(),
    }),
  };
}

function adminGuard(config: IndexerConfig) {
  return async (c: Context, next: () => Promise<void>) => {
    if (config.adminToken && c.req.header("x-admin-token") !== config.adminToken) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}

function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "local";
}

export function createApp(deps: IndexerDeps): Hono {
  const app = new Hono();
  const { anchorer, breaker, proxy, config } = deps;

  app.get("/", (c) =>
    c.json({
      service: "yinglong-indexer",
      anchorLedgers: config.anchorLedgers,
      breakerLedgers: config.breakerLedgers,
      accountabilityLedgers: anchorer.addresses(),
      source: config.receiptsFile ? { kind: "file", path: config.receiptsFile } : { kind: "agent-api", url: config.agentApiUrl },
      endpoints: {
        proof: "GET /proof/:receiptId",
        status: "GET /status",
        batches: "GET /batches",
        anchorNow: "POST /anchor-now",
        trip: "POST /breaker/trip { account, reason, ledger? }",
        breakerStatus: "GET /breaker/status/:account",
        fiscoProxy: "POST /rpc/fisco (read-only)",
      },
    }),
  );
  app.get("/healthz", (c) => c.json({ ok: true }));

  // ---- anchoring relayer --------------------------------------------------------------------------
  app.get("/status", (c) => {
    const s = anchorer.snapshot();
    return c.json({
      cursor: s.cursor,
      pending: s.pending.length,
      batches: s.batches.length,
      anchoredReceipts: s.batches.reduce((n, b) => n + b.count, 0),
      anchorLedgers: config.anchorLedgers,
      latestBatch: s.batches.at(-1) ? { batchId: s.batches.at(-1)!.batchId, root: s.batches.at(-1)!.root, count: s.batches.at(-1)!.count, anchors: s.batches.at(-1)!.anchors } : null,
    });
  });

  app.get("/batches", (c) => c.json({ batches: anchorer.snapshot().batches.map((b) => ({ batchId: b.batchId, root: b.root, count: b.count, createdAt: b.createdAt, anchors: b.anchors, crossAnchors: b.crossAnchors })) }));

  app.get("/proof/:receiptId", async (c) => {
    const p = anchorer.proofFor(c.req.param("receiptId"));
    if (!p) return c.json({ error: "receipt not found in any anchored batch" }, 404);
    let onChain;
    if (c.req.query("verify") === "1" || c.req.query("onchain") === "1") {
      onChain = await anchorer.verifyOnChain(c.req.param("receiptId")).catch(() => undefined);
    }
    return c.json({ ...p, onChain });
  });

  app.post("/anchor-now", adminGuard(config), async (c) => {
    await anchorer.pull().catch(() => 0);
    const batch = await anchorer.anchorPending();
    return c.json({ anchored: batch ? { batchId: batch.batchId, root: batch.root, count: batch.count, anchors: batch.anchors, crossAnchors: batch.crossAnchors } : null });
  });

  app.post("/pull", adminGuard(config), async (c) => c.json({ pulled: await anchorer.pull() }));

  // ---- breaker watcher ----------------------------------------------------------------------------
  app.post("/breaker/trip", adminGuard(config), async (c) => {
    let body: { account?: string; reason?: string; ledger?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "expected JSON { account, reason, ledger? }" }, 400);
    }
    if (!body.account) return c.json({ error: "missing account" }, 400);
    let account;
    try {
      account = getAddress(body.account);
    } catch {
      return c.json({ error: "account is not a valid address" }, 400);
    }
    const results = await breaker.trip(account, body.reason ?? "unspecified", body.ledger as LedgerName | undefined);
    const any = results.some((r) => r.tripped);
    return c.json({ ok: any, results }, any ? 200 : 409);
  });

  app.get("/breaker/status/:account", async (c) => {
    let account;
    try {
      account = getAddress(c.req.param("account"));
    } catch {
      return c.json({ error: "invalid account address" }, 400);
    }
    return c.json({ account, status: await breaker.status(account) });
  });

  // ---- read-only FISCO RPC proxy ------------------------------------------------------------------
  app.post("/rpc/fisco", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    }
    const res = await proxy.handle(body, clientIp(c));
    return c.json(res.body as never, res.status as never);
  });
  app.get("/rpc/fisco", (c) => c.json({ note: "POST only; read-only FISCO JSON-RPC proxy", allowed: [...ALLOWED_METHODS, ...LOCAL_METHODS], local: { yinglong_getRevertData: "params [txHash]: exact revert data of a FISCO transaction from the native receipt {status, output, message}" } }));

  return app;
}
