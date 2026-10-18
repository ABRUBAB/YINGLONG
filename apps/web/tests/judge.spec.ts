/**
 * The 3-minute walkthrough (/judge) against the fixtures build: six steps, no typing. Step 2 creates a
 * secret-key test account in the browser (no passkey, so no virtual authenticator), the sample
 * service verifies both seal signatures against the key's address, and every later step shows what
 * the (simulated) service answered, labelled sample data.
 */
import { test, expect, type Page } from "@playwright/test";
import { IGNORED_CONSOLE } from "./routes";

const SESSION_KEY = "yinglong.visitor.v1";

async function stepIs(page: Page, n: number) {
  await expect(page.locator("section[data-step]")).toHaveAttribute("data-step", String(n));
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("runs all six steps with a secret-key test account and no typing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !IGNORED_CONSOLE.some((re) => re.test(m.text()))) errors.push(m.text());
    });
    await page.goto("/judge", { waitUntil: "networkidle" });

    // Step 1: one sentence, the live line, three numbers with their sources, the sample label.
    await stepIs(page, 1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/in three minutes/);
    await expect(page.locator("[data-live]")).toContainText(/answered in \d+ ms \(HTTP 200\)/);
    await expect(page.locator('[data-tile="transactions"]')).toContainText(/\d/);
    await expect(page.locator('[data-tile="identical"]')).toContainText(/\d+ of \d+/);
    await expect(page.locator('[data-tile="uptime"]')).toContainText(/GET \/v1\//);
    await expect(page.getByText("Sample data").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
    await page.getByRole("button", { name: "Start: create my test agent" }).click();

    // Step 2: the key's address, the account, both messages checked, the publish transaction, the rules.
    await stepIs(page, 2);
    await expect(page.locator("[data-clock]")).toHaveText(/^\d+:\d\d$/);
    await expect(page.locator("section[data-step]")).toHaveAttribute("data-run", "done", { timeout: 30_000 });
    expect(await page.getByText(/^0x[0-9a-fA-F]{40}$/).count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(/2 messages decoded here/)).toBeVisible();
    await expect(page.locator('a[href^="/proof/tx/fisco/0x"]')).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Your agent's rules" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByText(/A test account was created for you; it holds test money only/)).toBeVisible();
    const session = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), SESSION_KEY);
    expect(session?.method).toBe("key");
    expect(session?.sealedAt).toBeTruthy();
    await page.screenshot({ path: "test-results/screens/judge-account-1440.png", fullPage: true });
    await page.getByRole("button", { name: "Make a payment" }).click();

    // Step 3: the request as sent, nine checks, a receipt with a transaction.
    await stepIs(page, 3);
    await expect(page.getByText("Buy a coffee at Arena Cafe for 5 HKD")).toBeVisible();
    await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "verified", { timeout: 30_000 });
    expect(await page.getByText("Passed", { exact: true }).count()).toBeGreaterThanOrEqual(8);
    await expect(page.locator("[data-timing]")).toContainText(/Round trip from this browser: \d/);
    await expect(page.locator('section[data-step] a[href*="/tx/0x"]').first()).toBeVisible();
    await page.screenshot({ path: "test-results/screens/judge-pay-1440.png", fullPage: true });
    await page.getByRole("button", { name: "Try a trick" }).click();

    // Step 4: the trick is stopped, with the check and the reason in plain words.
    await stepIs(page, 4);
    await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "blocked", { timeout: 30_000 });
    await expect(page.locator("[data-stopped-at]")).toContainText(/Stopped at check 6 of 9, Counterparty: Not a verified payee/);
    await expect(page.getByText("Stopped", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Send a raw transaction" }).click();

    // Step 5: the raw transaction reverts on chain with a typed error and a hash.
    await stepIs(page, 5);
    await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "reverted", { timeout: 30_000 });
    await expect(page.getByText(/Not a verified payee/).first()).toBeVisible();
    await expect(page.getByText("(PayeeNotVerified)")).toBeVisible();
    await expect(page.locator('section[data-step] a[href*="/tx/0x"]').first()).toBeVisible();
    await expect(page.getByText(/Attack family/)).toBeVisible();
    await page.screenshot({ path: "test-results/screens/judge-chain-1440.png", fullPage: true });
    await page.getByRole("button", { name: "Check it yourself" }).click();

    // Step 6: same code on both chains, the commit, this session's records, the links, and the account controls.
    await stepIs(page, 6);
    await expect(page.locator("section[data-step]")).toHaveAttribute("data-run", "done");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Check it yourself/);
    await expect(page.getByText(/You did this in \d+:\d\d/)).toBeVisible();
    await expect(page.locator('[data-tile="same-code"]')).toContainText(/\d+ of \d+/);
    // The live service reports a commit hash; the sample proof says "sample".
    await expect(page.locator('[data-tile="commit"]')).toContainText(/[0-9a-f]{7}|sample/);
    const records = page.getByRole("list", { name: /This session/ }).or(page.locator("section[aria-labelledby=judge-records] ul"));
    expect(await records.getByRole("listitem").count()).toBeGreaterThanOrEqual(3);
    for (const href of ["/proof", "/app", "/treasury", "/supervisor", "/challenge"]) {
      await expect(page.locator(`[data-links] a[href="${href}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-links] a[href^="https://github.com/"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
    await page.getByRole("button", { name: "Delete this test account from this browser" }).click();
    await expect(page.getByText(/Deleted from this browser/)).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), SESSION_KEY)).toBeNull();

    // Back keeps every result: nothing re-runs.
    await page.getByRole("button", { name: "Back" }).click();
    await stepIs(page, 5);
    await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "reverted");
    expect(errors).toEqual([]);
  });

  test("the site nav lists the demo", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const link = page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Walkthrough", exact: true });
    await expect(link).toHaveAttribute("href", "/judge");
    await link.click();
    await expect(page).toHaveURL(/\/judge$/);
    await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Walkthrough", exact: true })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

  test("no horizontal scroll on the first two steps; the menu sheet lists the demo", async ({ page }) => {
    await page.goto("/judge", { waitUntil: "networkidle" });
    await stepIs(page, 1);
    await expect(page.locator('[data-tile="identical"]')).toContainText(/\d+ of \d+/);
    const widths = async () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    let w = await widths();
    expect(w.scroll).toBeLessThanOrEqual(w.inner);
    await page.getByRole("button", { name: "Start: create my test agent" }).click();
    await expect(page.locator("section[data-step]")).toHaveAttribute("data-run", "done", { timeout: 30_000 });
    w = await widths();
    expect(w.scroll).toBeLessThanOrEqual(w.inner);
    await expect(page.getByRole("button", { name: "Make a payment" })).toBeVisible();

    await page.getByRole("button", { name: "Explore" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("link", { name: /^3-minute walkthrough/ })).toHaveAttribute("href", "/judge");
  });
});
