// Entry point: start the Agent City services on one port (default 8790) and, on test ledgers, keep FX
// liquidity topped up in the background.
import { serve } from "@hono/node-server";
import { createApp, makeDeps } from "./app";
import { ensureLiquidity } from "./fx";
import type { Role } from "@yinglong/sdk/server";

async function main(): Promise<void> {
  const deps = makeDeps();
  const app = await createApp(deps);
  const { config, ledger } = deps;
  // x402 PAYMENT-SIGNATURE headers carry a full ERC-7710 permission context (the sealed mandate): allow 256 KB.
  serve({ fetch: app.fetch, hostname: config.host, port: config.port, serverOptions: { maxHeaderSize: 256 * 1024 } }, (info) => {
    process.stdout.write(`yinglong-agent-city on http://${config.host}:${info.port} (ledger ${ledger.name}, ${ledger.network}, settlement ${config.settlement})\n`);
    process.stdout.write("Test units only. All agents and institutions are fictional (hackathon demonstration).\n");
  });

  if (config.liquidityKeeper && ledger.name !== "base-sepolia") {
    const tick = async () => {
      for (const desk of ["svc-pearl-river-fx", "svc-victoria-fx"] as Role[]) {
        try {
          await ensureLiquidity(ledger, desk, ledger.addr("TestHKD"), config.liquidityTarget.tHKD);
          await ensureLiquidity(ledger, desk, ledger.addr("TestUSD"), config.liquidityTarget.tUSD);
        } catch (e) {
          process.stderr.write(`liquidity keeper (${desk}): ${String((e as Error).message ?? e)}\n`);
        }
      }
    };
    await tick().catch(() => undefined);
    setInterval(() => void tick(), 60_000).unref();
  }
}

main().catch((e) => {
  process.stderr.write(`${String((e as Error).stack ?? e)}\n`);
  process.exit(1);
});
