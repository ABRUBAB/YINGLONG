/**
 * The proof page on sample data: the live status card measures a round trip and shows the raw
 * answer on demand, every section renders from the proof bundle, and nothing scrolls sideways on a
 * phone (tables scroll inside their own box).
 */
import { test, expect } from "@playwright/test";

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("live status, build, bytecode, transactions, ML and bench all come from the bundle", async ({ page }) => {
    await page.goto("/proof", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Real blockchain records you can check yourself/);

    // Live status: measured on this device, then the raw JSON on demand.
    await expect(page.getByRole("heading", { name: "The service is live" })).toBeVisible();
    await expect(page.getByText(/GET \/v1\/health answered 200 in \d+ ms/)).toBeVisible();
    await page.getByRole("button", { name: "Try it live" }).click();
    const raw = page.getByLabel("Raw response");
    await expect(raw).toBeVisible();
    await expect(raw).toContainText('"ok": true');

    // Build and the bytecode comparison, enforcers first.
    await expect(page.getByRole("link", { name: /github\.com\/ABRUBAB\/YINGLONG/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Same code on both blockchains" })).toBeVisible();
    await expect(page.getByRole("img", { name: /38 of 46 contracts deployed on both ledgers have identical code; 23 of 23 rule enforcers/ })).toBeVisible();
    const contracts = page.getByRole("region", { name: /Contracts on both ledgers/ });
    await expect(contracts.getByRole("row")).toHaveCount(24);
    await expect(contracts.getByRole("row").nth(1)).toContainText(/Enforcer/);
    await page.getByRole("button", { name: "Show all 46 contracts" }).click();
    await expect(contracts.getByRole("row")).toHaveCount(47);
    await expect(contracts.getByText("Differs").first()).toBeVisible();

    // Transactions: ledger, outcome, hash and the audit link slot.
    await expect(page.getByRole("heading", { name: "Every transaction, checkable" })).toBeVisible();
    await expect(page.getByText("Audit proof: live service only").first()).toBeVisible();

    // The two heaviest sections are folded until opened.
    await page.locator("#ml > summary").click();
    await page.locator("#bench > summary").click();

    // ML: tiles with intervals, the confusion matrix and the real training log drawn as a chart.
    await expect(page.getByRole("heading", { name: "How good is the AI safety model?" })).toBeVisible();
    await expect(page.getByText("96.7%").first()).toBeVisible();
    await expect(page.getByText("Was an attack")).toBeVisible();
    await expect(page.getByRole("img", { name: /training loss .* evaluation macro-F1/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /Forecast methods/ }).getByRole("row")).toHaveCount(4);

    // Bench: the Markdown family table rendered as a real table.
    await expect(page.getByRole("heading", { name: "Did any attack move money?" })).toBeVisible();
    await expect(page.getByRole("region", { name: /Bench results by attack family/ }).getByRole("row")).toHaveCount(14);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

  test("fits 390 px with no horizontal page scroll; tables scroll inside their own box", async ({ page }) => {
    await page.goto("/proof", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "The service is live" })).toBeVisible();
    await page.waitForTimeout(600);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scroll, "no horizontal page scroll").toBeLessThanOrEqual(0);
    const region = page.getByRole("region", { name: /Contracts on both ledgers/ });
    await region.scrollIntoViewIfNeeded();
    expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});
