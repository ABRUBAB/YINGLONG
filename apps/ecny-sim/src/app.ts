import { Hono, type Context } from "hono";
import { getAddress, type Hex } from "viem";
import { Ledger } from "./chain";
import { loadConfig, type EcnySimConfig } from "./config";
import { Simulator, SIM_LABEL, type Condition } from "./simulator";

export interface SimDeps {
  config: EcnySimConfig;
  ledger: Ledger;
  sim: Simulator;
}

export function makeSim(env: NodeJS.ProcessEnv = process.env): SimDeps {
  const config = loadConfig(env);
  const ledger = new Ledger(config.ledger, { rpcUrl: config.rpcUrl });
  const sim = new Simulator({
    ledger,
    statePath: config.statePath,
    knownAccounts: config.knownAccounts,
    conditions: config.conditions,
    allowedPurposes: config.allowedPurposes,
  });
  return { config, ledger, sim };
}

function adminGuard(config: EcnySimConfig) {
  return async (c: Context, next: () => Promise<void>) => {
    if (config.adminToken && c.req.header("x-admin-token") !== config.adminToken) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}

export function createApp(deps: SimDeps): Hono {
  const app = new Hono();
  const { sim, ledger, config } = deps;

  app.use("*", async (c, next) => {
    c.header("X-Yinglong-Label", SIM_LABEL);
    await next();
  });

  app.get("/", (c) =>
    c.json({
      service: "yinglong-ecny-sim",
      label: SIM_LABEL,
      ledger: ledger.name,
      network: `eip155:${ledger.profile.chainId}`,
      operatorRole: "relayer",
      contract: ledger.addr("ConditionalPaymentInstructions"),
      endpoints: { status: "GET /status", statement: "GET /statement/:account", poll: "POST /poll", conditions: "GET /conditions" },
    }),
  );
  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/status", async (c) => {
    const s = sim.snapshot();
    const head = await ledger.blockNumber();
    const processed = Object.values(s.processed);
    return c.json({
      label: SIM_LABEL,
      ledger: ledger.name,
      contract: ledger.addr("ConditionalPaymentInstructions"),
      operator: ledger.roleAddress("relayer"),
      head: head.toString(),
      cursorId: s.cursorId,
      counts: {
        processed: processed.length,
        executed: processed.filter((p) => p.decision === "executed").length,
        rejected: processed.filter((p) => p.decision === "rejected").length,
      },
      knownAccounts: sim.knownAccounts(),
      recent: processed.slice(-20),
    });
  });

  app.get("/statement/:account", async (c) => {
    let account;
    try {
      account = getAddress(c.req.param("account"));
    } catch {
      return c.json({ error: "invalid account address" }, 400);
    }
    const st = await sim.statement(account);
    return c.json({ ...st, label: SIM_LABEL });
  });

  app.get("/conditions", (c) => c.json({ label: SIM_LABEL, conditions: sim.listConditions() }));

  app.get("/instruction/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id < 0) return c.json({ error: "invalid id" }, 400);
    return c.json({ label: SIM_LABEL, processed: sim.snapshot().processed[String(id)] ?? null });
  });

  // ---- admin / demo-control -----------------------------------------------------------------------
  app.post("/poll", adminGuard(config), async (c) => {
    const processed = await sim.poll();
    return c.json({ label: SIM_LABEL, processed });
  });

  app.post("/open-balances", adminGuard(config), async (c) => {
    const posted = await sim.postOpeningBalances();
    return c.json({ label: SIM_LABEL, posted });
  });

  app.post("/conditions/satisfy", adminGuard(config), async (c) => {
    let body: { conditionHash?: string; satisfied?: boolean };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "expected JSON { conditionHash, satisfied }" }, 400);
    }
    if (!body.conditionHash) return c.json({ error: "missing conditionHash" }, 400);
    const ok = sim.setConditionSatisfied(body.conditionHash as Hex, body.satisfied ?? true);
    return c.json({ ok, conditions: sim.listConditions() });
  });

  app.post("/conditions", adminGuard(config), async (c) => {
    let body: Condition;
    try {
      body = (await c.req.json()) as Condition;
    } catch {
      return c.json({ error: "expected a Condition JSON body" }, 400);
    }
    if (!body.conditionHash) return c.json({ error: "missing conditionHash" }, 400);
    sim.addCondition(body);
    return c.json({ ok: true, conditions: sim.listConditions() });
  });

  return app;
}
