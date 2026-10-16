/**
 * The app must work from mainland China: no request may leave our own origin at runtime (no Google
 * Fonts, no CDN, no drei Environment presets, no CDN Draco). In fixtures mode not even the agent API
 * is contacted. Runs with motion enabled so the lazy 3D chunks (Mandate Orbit, city) and the Paper Shaders atmosphere load too.
 */
import { test, expect } from "@playwright/test";
import { ROUTES } from "./routes";

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });

for (const r of ROUTES) {
  test(`${r.name}: every request stays on our origin`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const foreign: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      if (new URL(url).origin !== origin) foreign.push(url);
    });
    await page.goto(r.path, { waitUntil: "networkidle" });
    // Give the after-load 3D chunk and its environment map time to load.
    await page.waitForTimeout(3500);
    await page.mouse.move(900, 400);
    await page.waitForTimeout(500);
    expect(foreign).toEqual([]);
  });
}

test("fonts are self-hosted woff2 files", async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (req) => {
    if (req.resourceType() === "font") fonts.push(new URL(req.url()).pathname);
  });
  await page.goto("/", { waitUntil: "networkidle" });
  expect(fonts.length).toBeGreaterThan(0);
  for (const f of fonts) expect(f).toMatch(/^\/fonts\/[A-Za-z-]+\.woff2$/);
});
