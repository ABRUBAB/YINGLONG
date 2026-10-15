import { serve } from "@hono/node-server";
import { createApp, makeSim } from "./app";

async function main(): Promise<void> {
  const deps = makeSim();
  const app = createApp(deps);
  await deps.sim.postOpeningBalances().catch((e) => process.stderr.write(`[ecny-sim] opening balances: ${String((e as Error).message ?? e)}\n`));
  deps.sim.start(deps.config.pollIntervalMs);
  serve({ fetch: app.fetch, hostname: deps.config.host, port: deps.config.port }, (info) => {
    process.stdout.write(`yinglong-ecny-sim on http://${deps.config.host}:${info.port} (ledger ${deps.ledger.name})\n`);
    process.stdout.write("e-CNY-style simulator. Not the PBoC sandbox; no connection to PBoC or operator-bank systems.\n");
  });
}

main().catch((e) => {
  process.stderr.write(`${String((e as Error).stack ?? e)}\n`);
  process.exit(1);
});
