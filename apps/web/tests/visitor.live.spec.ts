/**
 * LIVE (gated): signs up for real against the agent service with a CDP virtual authenticator.
 * Runs only with AGENT_API_IT set and a live build of the web app (playwright.config.ts then serves
 * `.next` instead of the fixtures build):
 *
 *   NEXT_PUBLIC_AGENT_API=$AGENT_API_IT pnpm build
 *   AGENT_API_IT=https://api.yinglong-agent.tech pnpm test:e2e tests/visitor.live.spec.ts
 *
 * It creates a real account on the team-run FISCO chain (test units only), seals the mandate with
 * the virtual passkey, pays a sample merchant 4 tHKD through the agent, and revokes the mandate.
 * The same path is used to record the demo video.
 */
import { test, expect } from "@playwright/test";
import { addVirtualPasskey } from "./passkey";

test.skip(!process.env.AGENT_API_IT, "set AGENT_API_IT to run against a live agent service");
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
test.setTimeout(240_000);

test("live visitor: passkey sign-up, seal on FISCO, act, revoke", async ({ page, context }) => {
  const passkey = await addVirtualPasskey(context, page);
  await page.goto("/start", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Skip and use simple ready-made rules" }).click();
  await page.getByRole("button", { name: /Fingerprint or face/ }).click();

  // Account deployment, passport and test units take 5 to 15 s on FISCO.
  await expect(page.getByRole("heading", { name: "Confirm twice with your fingerprint" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/: no$/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Step 1 of 2: Save my rules" })).toBeEnabled();
  await page.getByRole("button", { name: "Step 1 of 2: Save my rules" }).click();
  await page.getByRole("button", { name: "Step 2 of 2: Give my agent permission" }).click();
  await expect(page.getByRole("heading", { name: /Done. Your agent is ready/ })).toBeVisible({ timeout: 90_000 });
  expect((await passkey.credentials())[0]!.signCount).toBeGreaterThanOrEqual(2);
  const publish = await page.locator('main a[href^="/proof/tx/fisco/0x"]').getAttribute("href");
  expect(publish).toMatch(/^\/proof\/tx\/fisco\/0x[0-9a-f]{64}$/);

  await page.getByRole("button", { name: "Open my agent" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Visitor [0-9A-F]{4}$/, { timeout: 30_000 });
  await expect(page.getByText(/acts inside mandate/)).toBeVisible({ timeout: 30_000 });

  // A T1 payment inside the mandate (4 tHKD to Arena Cafe), executed with the visitor token.
  await page.getByLabel("Ask Ying to pay, check or explain").fill("Buy a coffee at Arena Cafe for 4 HKD");
  await page.getByRole("button", { name: "Ask Ying" }).click();
  await expect(page.getByRole("list", { name: "Nine scales, in order" }).getByRole("listitem")).toHaveCount(9, { timeout: 90_000 });

  // Revoke with the same passkey; the page decodes the user operation before signing.
  await page.getByRole("button", { name: "Revoke mandate" }).click();
  await page.getByRole("button", { name: "Revoke with passkey" }).click();
  await expect(page.getByText(/^Revoked with your passkey/)).toBeVisible({ timeout: 90_000 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("No live mandate").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/screens/live-visitor-console-1440.png", fullPage: true });
});
