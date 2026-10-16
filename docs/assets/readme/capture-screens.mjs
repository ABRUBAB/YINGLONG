// Captures the README screenshot gallery from the live app at 1440 px wide and writes WebP files.
// Usage (from the repository root): node docs/assets/readme/capture-screens.mjs [baseUrl]
// Uses the Playwright and sharp installs of apps/web and the system Chrome channel by default
// (set PW_CHANNEL="" to use the bundled Chromium from PLAYWRIGHT_BROWSERS_PATH instead).
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");
const sharp = require("sharp");

const base = (process.argv[2] ?? "https://app.yinglong-agent.tech").replace(/\/$/, "");
const shots = [
  { name: "home", path: "/" },
  { name: "console", path: "/app" },
  { name: "treasury", path: "/treasury" },
  { name: "city", path: "/city" },
  { name: "proof", path: "/proof" },
  { name: "challenge", path: "/challenge" },
];

const channel = process.env.PW_CHANNEL ?? "chrome";
const browser = await chromium.launch(channel ? { channel } : {});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
let total = 0;
for (const s of shots) {
  const page = await context.newPage();
  await page.goto(base + s.path, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3500);
  const png = await page.screenshot({ type: "png" });
  const out = resolve(here, `screen-${s.name}.webp`);
  await sharp(png).webp({ quality: 82, effort: 6 }).toFile(out);
  total += statSync(out).size;
  console.log("wrote", out);
  await page.close();
}
await browser.close();
console.log(`total ${(total / 1024).toFixed(0)} KiB`);
