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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Get your own AI agent in three steps/);
  await page.getByRole("button", { name: "Skip and use simple ready-made rules" }).click();
  await page.getByRole("button", { name: /Fingerprint or face/ }).click();

  // Both messages decoded on this page and passed by the signing guard before anything is signed.
  await expect(page.getByRole("heading", { name: "Confirm twice with your fingerprint" })).toBeVisible();
  for (const d of await page.getByText("Technical details (for checking)").all()) await d.click();
  await expect(page.getByText(/Checked on this device: a PackedUserOperation message, nothing else/)).toBeVisible();
  await expect(page.getByText(/Checked on this device: a Delegation message, nothing else/)).toBeVisible();
  await expect(page.getByText("It publishes exactly this mandate for your own agent")).toBeVisible();
  await expect(page.getByText("Its rules are exactly the rules being published")).toBeVisible();
  await expect(page.getByText(/: no$/)).toHaveCount(0);
  await page.screenshot({ path: "test-results/screens/start-review-1440.png", fullPage: true });

  await page.getByRole("button", { name: "Step 1 of 2: Save my rules" }).click();
  await page.getByRole("button", { name: "Step 2 of 2: Give my agent permission" }).click();
  await expect(page.getByRole("heading", { name: /Done. Your agent is ready/ })).toBeVisible();
  const creds = await passkey.credentials();
  expect(creds).toHaveLength(1);
  expect(creds[0]!.signCount).toBeGreaterThanOrEqual(2);
  // The publish transaction opens in our FISCO ledger decoder.
  await expect(page.locator('main a[href^="/proof/tx/fisco/0x"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Open my agent" }).click();
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
  await page.getByRole("button", { name: "Skip and use simple ready-made rules" }).click();
  // A logged-in visitor reuses the same passkey: no method choice the second time.
  await expect(page.getByRole("button", { name: /Fingerprint or face/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Step 1 of 2: Save my rules" }).click();
  await page.getByRole("button", { name: "Step 2 of 2: Give my agent permission" }).click();
  await expect(page.getByRole("heading", { name: /Done. Your agent is ready/ })).toBeVisible();
  expect(await passkey.credentials()).toHaveLength(1);

  await page.getByRole("button", { name: "Open my agent" }).click();
  await expect(page.getByText(/acts inside mandate v2/)).toBeVisible();
  await page.screenshot({ path: "test-results/screens/visitor-console-1440.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("visitor: a dismissed passkey prompt creates nothing and says so", async ({ page, context }) => {
  const passkey = await addVirtualPasskey(context, page);
  await passkey.cdp.send("WebAuthn.setUserVerified", { authenticatorId: passkey.authenticatorId, isUserVerified: false });
  await page.goto("/start", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Skip and use simple ready-made rules" }).click();
  await page.getByRole("button", { name: /Fingerprint or face/ }).click();
  await expect(page.getByText(/The fingerprint prompt was closed, so nothing was saved\./)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("yinglong.visitor.v1"))).toBeNull();
});

test("visitor: say, see, seal: own words compile to caveats, clamped and unmapped rows are flagged, the draft is sealed", async ({ page, context }) => {
  const passkey = await addVirtualPasskey(context, page);
  await page.goto("/start", { waitUntil: "networkidle" });
  await page.getByLabel("Your rules, in plain English").fill(
    "Only Arena Cafe and Kowloon Food Mart. Food at most 1500 a day. Ask me above 25, never more than 300 in one payment. Keep 150. Also tip the barista sometimes.",
  );
  await page.getByRole("button", { name: "Check my rules" }).click();
  await expect(page.getByRole("heading", { name: "These are the exact rules your agent will follow" })).toBeVisible();
  const decoded = page.getByRole("list", { name: "Decoded caveats, in order" });
  await expect(decoded.getByText("It may pay only Arena Cafe and Kowloon Food Mart (your PayeeBook).")).toBeVisible();
  await expect(page.getByText("Clamped").first()).toBeVisible();
  await expect(page.getByText("Not enforced").first()).toBeVisible();
  await expect(page.getByText("Your rules fingerprint (it changes if any rule changes)")).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Your rules, in plain English")).toHaveValue(/Food at most 1500 a day/);
  await page.getByRole("button", { name: "Check my rules" }).click();
  await page.getByRole("button", { name: "Looks right: lock it with my fingerprint" }).click();
  await page.getByRole("button", { name: /Fingerprint or face/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm twice with your fingerprint" })).toBeVisible();
  await page.getByRole("button", { name: "Step 1 of 2: Save my rules" }).click();
  await page.getByRole("button", { name: "Step 2 of 2: Give my agent permission" }).click();
  await expect(page.getByRole("heading", { name: /Done. Your agent is ready/ })).toBeVisible();
  expect(await passkey.credentials()).toHaveLength(1);
});
