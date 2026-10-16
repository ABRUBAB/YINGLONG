/**
 * Agent City (/city), fixtures build: the map is legible at 375, 768 and 1440 px (no overlapping
 * labels, no horizontal scroll, axe clean), sample data is labelled, and the map works from the
 * keyboard: focus shows the card, arrows move, Enter pins the element in the inspector with ledger links.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { IGNORED_CONSOLE, WIDTHS } from "./routes";

mkdirSync("test-results/screens", { recursive: true });

async function labelOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const map = document.querySelector('[aria-roledescription="map"]')!;
    const els = [...map.querySelectorAll<HTMLElement>("[data-city-item], [data-city-label]")];
    const rects = els.map((el) => ({ id: el.dataset.cityItem ?? el.dataset.cityLabel ?? "?", r: el.getBoundingClientRect() }));
    const hits: string[] = [];
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!.r;
        const b = rects[j]!.r;
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 1 && iy > 1) hits.push(`${rects[i]!.id} x ${rects[j]!.id}`);
      }
    return hits;
  });
}

for (const width of WIDTHS) {
  test.describe(`city ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: "reduce" });

    test("renders the two rails without overlapping labels, passes axe, fits the viewport", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error" && !IGNORED_CONSOLE.some((re) => re.test(m.text()))) errors.push(m.text());
      });
      await page.goto("/city", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Two rails, one engine/);
      const map = page.locator('[aria-roledescription="map"]');
      await expect(map).toBeVisible();
      await expect(page.getByText("Sample data").first()).toBeVisible();
      await expect(map.getByText("Coin-free rail")).toBeVisible();
      await expect(map.getByText("HK test rail")).toBeVisible();
      await expect(map.locator('[data-city-item="regulator"]')).toBeVisible();
      await expect(map.locator('[data-city-item="anchor:fisco"]')).toBeVisible();

      expect(await labelOverlaps(page), "no two labels overlap").toEqual([]);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(scroll, "no horizontal page scroll").toBeLessThanOrEqual(0);

      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);

      await page.screenshot({ path: `test-results/screens/city-map-${width}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  });
}

test.describe("city interaction", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("hover shows the card; keyboard moves and pins; ledger links point at the explorer", async ({ page }) => {
    await page.goto("/city", { waitUntil: "networkidle" });
    const map = page.locator('[aria-roledescription="map"]');
    const ying = map.locator('[data-city-item="a:nadia"]');
    await ying.hover();
    const card = map.locator("h3", { hasText: "Ying" });
    await expect(card).toBeVisible();
    await expect(map.getByText("Passport attested").first()).toBeVisible();

    // One tab stop for the whole map; arrows move between elements.
    // Left from the agent: its mandate glyph, then its principal.
    await ying.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(map.locator('[data-city-item="m:nadia"]')).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(map.locator('[data-city-item="p:nadia"]')).toBeFocused();
    await expect(map.locator('[data-city-item][tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press("Enter");
    const inspector = page.locator("aside");
    await expect(inspector.getByRole("heading", { name: "Nadia Rahman" })).toBeVisible();
    const link = inspector.locator('a[href^="https://sepolia.basescan.org/tx/"], a[href^="/proof/tx/"]').first();
    await expect(link).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(inspector.getByText(/Select a principal, an agent/)).toBeVisible();

    // A refused payment: inverted chip on the edge, typed error in the inspector.
    const refused = map.locator('[data-city-item^="pay:nadia>"][data-city-item$=":refused"]').first();
    await refused.click();
    await expect(inspector.getByText(/PayeeNotVerified|QuoteExpired/).first()).toBeVisible();

    // FISCO receipts link to our own read-only explorer.
    await map.locator('[data-city-item="a:lotus-sz"]').click();
    await expect(inspector.locator('a[href^="/proof/tx/fisco/0x"]').first()).toBeVisible();
    await page.screenshot({ path: "test-results/screens/city-inspector-1440.png" });
  });

  test("filter dims the other payments", async ({ page }) => {
    await page.goto("/city", { waitUntil: "networkidle" });
    await page.getByRole("group", { name: "Show payments" }).getByRole("button", { name: /Refused/ }).click();
    const map = page.locator('[aria-roledescription="map"]');
    await expect(map.locator('[data-city-item$=":settled"]')).toHaveCount(0);
    await expect(map.locator('[data-city-item$=":refused"]').first()).toBeVisible();
  });
});

test.describe("city phone", () => {
  test.use({ viewport: { width: 375, height: 800 }, reducedMotion: "reduce", hasTouch: true });

  test("tap opens the details card and the inspector", async ({ page }) => {
    await page.goto("/city", { waitUntil: "networkidle" });
    const map = page.locator('[aria-roledescription="map"]');
    await map.locator('[data-city-item="a:nadia"]').tap();
    await expect(map.getByRole("button", { name: "Close details" })).toBeVisible();
    await expect(page.locator("aside").getByRole("heading", { name: "Nadia Rahman" })).toBeVisible();
    await page.screenshot({ path: "test-results/screens/city-tap-375.png" });
  });
});
