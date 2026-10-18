#!/usr/bin/env node
/**
 * Renders the Mandate Orbit posters ("poster first"):
 *   public/posters/orbit-375.webp, orbit-768.webp, orbit-1440.webp  (hero fallback and LCP frame, 16:10, transparent, dark theme)
 *   public/posters/orbit-375-light.webp, ...-768-light, ...-1440-light (the same in the light theme)
 *   public/posters/og.webp                                              (Open Graph image, 1200x630)
 * from `/poster` (fixed state, no events) of a running fixtures server.
 * Usage: node scripts/posters.mjs [baseUrl]   (default http://localhost:3210)
 * Browser: system Chrome (PW_CHANNEL=chrome, default) with SwiftShader WebGL.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "posters");
mkdirSync(out, { recursive: true });
const base = process.argv[2] || "http://localhost:3210";
const channel = process.env.PW_CHANNEL ?? "chrome";

const browser = await chromium.launch({
  channel: channel || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function capture(width, height, target, scheme = "dark") {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: "no-preference", colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${base}/poster`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__posterReady === true, null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  // Transparent posters: the hero's atmosphere shows through them exactly as it does through the canvas.
  await page.addStyleTag({ content: "html,body,main,section{background:transparent!important}" });
  const el = page.locator("[data-hero-canvas]");
  const png = await el.screenshot({ omitBackground: true });
  const meta = await sharp(png).metadata();
  const w = Math.min(target, meta.width ?? target);
  const h = Math.round((w * 10) / 16);
  await sharp(png).resize(w, h, { fit: "cover" }).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(join(out, `orbit-${width}${scheme === "light" ? "-light" : ""}.webp`));
  console.log(`orbit-${width}${scheme === "light" ? "-light" : ""}.webp ${w}x${h}px`);
  await ctx.close();
}

for (const scheme of ["dark", "light"]) {
  await capture(375, 812, 760, scheme);
  await capture(768, 1024, 1200, scheme);
  await capture(1440, 900, 1600, scheme);
}

// Open Graph: the landing hero as a reader sees it (text + orbit), after the arrival ends.
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 694 }, deviceScaleFactor: 1, reducedMotion: "no-preference", colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(9_000);
  const png = await page.screenshot({ clip: { x: 0, y: 64, width: 1200, height: 630 } });
  await sharp(png).webp({ quality: 82 }).toFile(join(out, "og.webp"));
  console.log("og.webp 1200x630");
  await ctx.close();
}

await browser.close();
