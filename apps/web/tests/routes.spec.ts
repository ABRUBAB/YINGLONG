/**
 * Smoke + accessibility + screenshot matrix: every route at 375, 768 and 1440 px.
 * - the route renders its heading and a <main> landmark, with no page errors;
 * - axe finds no serious or critical violations (WCAG 2.1 A/AA rules);
 * - no horizontal scroll at any width;
 * - a full-page screenshot is written to test-results/screens/<route>-<width>.png
 *   (reduced motion, so the hero shows its poster and screenshots are deterministic).
 */
import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { IGNORED_CONSOLE, ROUTES, WIDTHS } from "./routes";

mkdirSync("test-results/screens", { recursive: true });

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    for (const r of ROUTES) {
      test(`${r.name} renders, passes axe, fits the viewport`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => {
          if (m.type() === "error" && !IGNORED_CONSOLE.some((re) => re.test(m.text()))) errors.push(m.text());
        });
        await page.goto(r.path, { waitUntil: "networkidle" });
        await expect(page.locator("main")).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(r.heading);
        await page.waitForTimeout(600);

        const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(scroll, "no horizontal page scroll").toBeLessThanOrEqual(0);

        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);

        await page.screenshot({ path: `test-results/screens/${r.name}-${width}.png`, fullPage: true });
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe("themes and print", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  test("theme switch updates the page and saves the selected theme", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("yl-theme", "dark");
    });
    await page.goto("/", { waitUntil: "networkidle" });

    const switchButton = page.getByRole("button", { name: "Dark theme" }).first();
    await expect(switchButton).toBeVisible();
    await expect(switchButton).toHaveAttribute("aria-pressed", "true");
    await switchButton.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(switchButton).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("yl-theme"))).toBe("light");

    await switchButton.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(switchButton).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("yl-theme"))).toBe("dark");
  });

  test("light theme (paper by day) on the console passes axe", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("yl-theme", "light");
      } catch {
        /* ignore */
      }
    });
    await page.goto("/app", { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: "test-results/screens/app-1440-light.png", fullPage: true });
  });

  test("proof prints as an A4 light document", async ({ page }) => {
    await page.goto("/proof", { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
    await expect(page.getByRole("button", { name: /Print or save as PDF/ })).toBeHidden();
    await page.screenshot({ path: "test-results/screens/proof-print.png", fullPage: true });
  });
});
