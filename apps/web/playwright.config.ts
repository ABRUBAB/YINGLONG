import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the fixtures build (`pnpm --filter web build:e2e` first; output in .next-e2e).
 * Browser: the system Chrome by default (PW_CHANNEL=chrome) so no download is needed on machines
 * that cannot reach the Playwright CDN; set PW_CHANNEL= (empty) to use the bundled Chromium.
 */
const channel = process.env.PW_CHANNEL ?? "chrome";
/**
 * AGENT_API_IT=<agent service URL>: run only the live specs (*.live.spec.ts) against a live build in
 * .next (build it with NEXT_PUBLIC_AGENT_API set to the same URL). Otherwise the fixtures build runs
 * every other spec. The page is served on localhost, a valid WebAuthn RP ID (127.0.0.1 is not).
 */
const LIVE = Boolean(process.env.AGENT_API_IT);
// Separate ports so a running fixtures server is never reused for the live specs (and vice versa).
const PORT = Number(process.env.E2E_PORT || (LIVE ? 3220 : 3210));
// The fixtures build to serve (pnpm build:e2e writes .next-e2e). Parallel work uses its own E2E_DIST and E2E_PORT,
// so two builds never overwrite each other and a test never runs against someone else's server.
const DIST = process.env.E2E_DIST || ".next-e2e";

export default defineConfig({
  testDir: "tests",
  testMatch: LIVE ? /.*\.live\.spec\.ts$/ : /.*\.spec\.ts$/,
  testIgnore: LIVE ? [] : [/.*\.live\.spec\.ts$/],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/artifacts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    channel: channel || undefined,
    trace: "off",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: LIVE
          ? `next start --port ${PORT}`
          : `node scripts/with-env.mjs NEXT_PUBLIC_DATA_MODE=fixtures NEXT_DIST_DIR=${DIST} -- next start --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
