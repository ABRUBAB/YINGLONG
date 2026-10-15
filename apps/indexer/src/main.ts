import { serve } from "@hono/node-server";
import { createApp, makeIndexer } from "./app";

function main(): void {
  const deps = makeIndexer();
  const app = createApp(deps);
  if (deps.config.autoStart) deps.anchorer.start();
  serve({ fetch: app.fetch, hostname: deps.config.host, port: deps.config.port }, (info) => {
    process.stdout.write(`yinglong-indexer on http://${deps.config.host}:${info.port}\n`);
    process.stdout.write(`anchor ledgers: ${deps.config.anchorLedgers.join(", ")}; FISCO read-only proxy ${deps.config.fiscoRpcUrl ? "enabled" : "disabled (no upstream)"}\n`);
  });
}

main();
