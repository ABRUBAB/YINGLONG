/**
 * The global shell: every route carries the site navigation (every page, Home included, with the
 * current one marked) and the passkey sign-up call to action; below 1280 px the list opens in a
 * sheet. The retired dragon mark appears nowhere.
 */
import { test, expect } from "@playwright/test";
import { ROUTES } from "./routes";

// The top bar uses short labels; the phone menu sheet uses the longer ones, grouped by intent.
const BAR = ["Home", "Walkthrough", "Student", "Company", "Regulator", "Live map", "Proof", "Challenge", "About"];
const PAGES = ["Home", "Live map", "Proof", "About", "3-minute walkthrough", "Student demo", "Company demo", "Create your agent", "Regulator view", "Security challenge"];

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  for (const r of ROUTES) {
    test(`${r.name}: site nav lists every page and the sign-up`, async ({ page }) => {
      await page.goto(r.path, { waitUntil: "networkidle" });
      const nav = page.getByRole("navigation", { name: "Site" });
      for (const label of BAR) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Create your agent" }).first()).toHaveAttribute("href", "/start");
      expect(await page.locator('img[src*="dragon"], img[src*="coin"], img[src*="yinglong-mark"]').count()).toBe(0);
    });
  }
  test("the current page is marked", async ({ page }) => {
    await page.goto("/proof", { waitUntil: "networkidle" });
    await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Proof" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  test("the menu sheet lists every page and closes on navigation", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Explore" }).click();
    const sheet = page.getByRole("dialog");
    for (const label of PAGES) await expect(sheet.getByRole("link", { name: new RegExp(`^${label}`) }).first()).toBeVisible();
    await sheet.getByRole("link", { name: /^About/ }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/An AI wallet you can check/);
  });
});
