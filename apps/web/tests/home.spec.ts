/**
 * The global menu sheet on phones, on every route, and layout guards for the home and About pages.
 * - With the menu open at 375 and 390 px: the page is never wider than the viewport
 *   (document.documentElement.scrollWidth <= innerWidth), the sheet sits inside the viewport, the
 *   page behind it cannot scroll, focus stays inside the sheet, and Escape closes it and gives focus
 *   back to the Menu button.
 * - Home and About: no element wider than the viewport escapes its clipping ancestor (the page-level
 *   overflow clip must never be what keeps a phone from zooming out), at 375, 390, 768 and 1440 px.
 * - Desktop hero: the orbit column never overlaps the text; text, actions and orbit fill the first
 *   screen and the counters sit below it.
 */
import { test, expect, type Page } from "@playwright/test";
import { ROUTES } from "./routes";

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // Wait until the sheet has finished entering (its right edge rests on the viewport's right edge).
  await expect
    .poll(async () => page.evaluate(() => Math.round(document.querySelector(".yl-navsheet")!.getBoundingClientRect().right - innerWidth)), { timeout: 5000 })
    .toBe(0);
  return sheet;
}

for (const width of [375, 390]) {
  test.describe(`menu sheet at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    for (const r of ROUTES) {
      test(`${r.name}: the open menu fits the viewport`, async ({ page }) => {
        await page.goto(r.path, { waitUntil: "networkidle" });
        await openMenu(page);
        const m = await page.evaluate(() => {
          const s = document.querySelector(".yl-navsheet")!.getBoundingClientRect();
          return { scrollWidth: document.documentElement.scrollWidth, innerWidth, left: s.left, right: s.right, width: s.width };
        });
        expect(m.scrollWidth, "no horizontal overflow with the menu open").toBeLessThanOrEqual(m.innerWidth);
        expect(m.width).toBeLessThanOrEqual(m.innerWidth);
        expect(m.left).toBeGreaterThanOrEqual(0);
        expect(m.right).toBeLessThanOrEqual(m.innerWidth);
      });
    }

    test("the sheet locks the page, traps focus and closes on Escape", async ({ page }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      const sheet = await openMenu(page);
      const before = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => scrollY), "the page behind the sheet does not scroll").toBe(before);
      // Tab through more stops than the sheet has: focus never leaves it.
      // (Base UI's focus guards hand focus back into the sheet a tick after it reaches either end.)
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press("Tab");
        await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest(".yl-navsheet"))), { timeout: 1000 }).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
    });
  });
}

/** Elements wider than the viewport whose overflow no ancestor clips (the page guard aside). */
async function unclipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const clipped = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== "visible") return true;
      return false;
    };
    for (const el of document.querySelectorAll("main *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5) && !clipped(el)) out.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "").slice(0, 60)} (${Math.round(r.left)}..${Math.round(r.right)})`);
    }
    return out.slice(0, 10);
  });
}

for (const width of [375, 390, 768, 1440]) {
  test.describe(`layout at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    for (const path of ["/", "/about"]) {
      test(`${path}: nothing overflows the viewport`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" });
        await page.addStyleTag({ content: ".yl-defer{content-visibility:visible!important}" });
        expect(await unclipped(page)).toEqual([]);
      });
    }
  });
}

for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1680, 1050],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`hero at ${width}x${height}: text and orbit share the first screen, apart`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/", { waitUntil: "networkidle" });
    const g = await page.evaluate(() => {
      const r = (e: Element) => e.getBoundingClientRect();
      const text = document.querySelector(".yl-hero-text")!;
      const textRight = Math.max(r(text).right, ...[...text.querySelectorAll("*")].map((e) => r(e).right));
      const orbit = r(document.querySelector(".yl-hero-orbit")!);
      const actions = [...text.querySelectorAll("a")].map((e) => r(e).bottom);
      const below = [...document.querySelectorAll("p")].find((p) => p.textContent === "Reading the orbit")!;
      return { textRight, orbit: orbit.toJSON(), actionsBottom: Math.max(...actions), belowTop: r(below).top, inner: innerHeight, innerWidth };
    });
    expect(g.orbit.left, "the orbit column starts right of every text block").toBeGreaterThan(g.textRight);
    expect(g.orbit.width / g.innerWidth, "the orbit column takes about 56% of the width").toBeGreaterThan(0.45);
    expect(g.orbit.bottom, "the orbit fills the first screen and no more").toBeLessThanOrEqual(g.inner + 1);
    expect(g.actionsBottom, "the actions are above the fold").toBeLessThan(g.inner);
    expect(g.belowTop, "the counters are below the first screen").toBeGreaterThanOrEqual(g.inner - 1);
  });
}
