import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the fixtures build (`pnpm --filter web build:e2e` first; output in .next-e2e).
 * Browser: the system Chrome by default (PW_CHANNEL=chrome) so no download is needed on machines
 * that cannot reach the Playwright CDN; set PW_CHANNEL= (empty) to use the bundled Chromium.
 */
const PORT = Number(process.env.E2E_PORT || 3210);
const channel = process.env.PW_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "tests",
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
        command: `node scripts/with-env.mjs NEXT_PUBLIC_DATA_MODE=fixtures NEXT_DIST_DIR=.next-e2e -- next start --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
