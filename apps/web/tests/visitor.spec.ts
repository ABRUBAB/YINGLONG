/**
 * Sign up with your own passkey, against the fixtures build, with a CDP virtual authenticator: the
 * passkey is created and signs for real (ES256, user verification), and the fixture service verifies
 * both WebAuthn signatures against the public key before it seals. Then the console acts for the
 * visitor: revoke with the same passkey, and seal a new mandate with it again.
 */
import { test, expect } from "@playwright/test";
import { addVirtualPasskey } from "./passkey";

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

test("visitor: create a passkey, read both messages, seal, act, revoke, seal again", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const passkey = await addVirtualPasskey(context, page);

  await page.goto("/start", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Your agent, your mandate, your key/);
  await page.getByRole("button", { name: "Create a passkey" }).click();

  // Both messages decoded on this page and passed by the signing guard before anything is signed.
  await expect(page.getByRole("heading", { name: "The two messages your passkey signs" })).toBeVisible();
  await expect(page.getByText(/Signing guard: PackedUserOperation message, digest recomputed/)).toBeVisible();
  await expect(page.getByText(/Signing guard: Delegation message, digest recomputed/)).toBeVisible();
  await expect(page.getByText("It publishes exactly this mandate for your own agent")).toBeVisible();
  await expect(page.getByText("Its rules are exactly the rules being published")).toBeVisible();
  await expect(page.getByText(/: no$/)).toHaveCount(0);
  await page.screenshot({ path: "test-results/screens/start-review-1440.png", fullPage: true });

  await page.getByRole("button", { name: "Sign both with your passkey" }).click();
  await expect(page.getByRole("heading", { name: /Sealed with your passkey/ })).toBeVisible();
  const creds = await passkey.credentials();
  expect(creds).toHaveLength(1);
  expect(creds[0]!.signCount).toBeGreaterThanOrEqual(2);
  // The publish transaction opens in our FISCO ledger decoder.
  await expect(page.locator('main a[href^="/proof/tx/fisco/0x"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Open your console" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Visitor [0-9A-F]{4}$/);
  await expect(page.getByText("Your passkey account")).toBeVisible();
  await expect(page.getByText(/Mandate sealed with your passkey/).first()).toBeVisible();

  // Revoke with the same passkey; the page decodes the operation before signing.
  await page.getByRole("button", { name: "Revoke mandate" }).click();
  await page.getByRole("button", { name: "Revoke with passkey" }).click();
  await expect(page.getByText("No live mandate").first()).toBeVisible();
  const reseal = page.getByRole("link", { name: "Seal a new mandate" });
  await expect(reseal).toHaveAttribute("href", "/start?again=1");
  expect((await passkey.credentials())[0]!.signCount).toBeGreaterThanOrEqual(3);

  // The same passkey seals a new mandate (same visitor id).
  await reseal.click();
  await page.getByRole("button", { name: "Prepare a new mandate" }).click();
  await page.getByRole("button", { name: "Sign both with your passkey" }).click();
  await expect(page.getByRole("heading", { name: /Sealed with your passkey/ })).toBeVisible();
  expect(await passkey.credentials()).toHaveLength(1);

  await page.getByRole("button", { name: "Open your console" }).click();
  await expect(page.getByText(/acts inside mandate v2/)).toBeVisible();
  await page.screenshot({ path: "test-results/screens/visitor-console-1440.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("visitor: a dismissed passkey prompt creates nothing and says so", async ({ page, context }) => {
  const passkey = await addVirtualPasskey(context, page);
  await passkey.cdp.send("WebAuthn.setUserVerified", { authenticatorId: passkey.authenticatorId, isUserVerified: false });
  await page.goto("/start", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await expect(page.getByText(/The passkey prompt was dismissed\. Nothing was created or signed\./)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("yinglong.visitor.v1"))).toBeNull();
});
