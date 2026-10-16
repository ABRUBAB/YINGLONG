// Renders the README banner (dark and light) and the theme-coloured signature lockups.
// Usage (from the repository root): node docs/assets/readme/render-banner.mjs
// Uses the Playwright and sharp installs of apps/web and the system Chrome channel by default
// (set PW_CHANNEL="" to use the bundled Chromium from PLAYWRIGHT_BROWSERS_PATH instead).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const brand = resolve(root, "../brand");
const require = createRequire(resolve(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");
const sharp = require("sharp");

const W = 1600;
const H = 500;
const SCALE = 1.25;

const svg = (file) =>
  readFileSync(resolve(brand, file), "utf8")
    .replace(/<\?xml[^>]*>/, "")
    .replace(/role="img"/, 'role="img" width="100%" height="100%"');
const glyph = svg("yinglong-glyph.svg");
const wordmark = svg("yinglong-wordmark.svg");
// Inlined as data URIs: a page set from a string cannot load file:// resources.
const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
const font = (f) => dataUri(resolve(root, "apps/web/public/fonts", f), "font/woff2");
const poster = dataUri(resolve(root, "apps/web/public/posters/orbit-1440.webp"), "image/webp");

const themes = {
  dark: {
    bg: "#0B0C0F", fg0: "#F6F7F9", muted: "#8A93A0", fg2: "#B3BAC4", line: "#272C34",
    chrome: "#C9CFD6", steel: "#86AEDD", brass: "#D3B46B", panel: false,
  },
  light: {
    bg: "#F3F2EE", fg0: "#0B0B0A", muted: "#6B6A63", fg2: "#46453F", line: "#DCDAD3",
    chrome: "#1D1C1A", steel: "#2E5C95", brass: "#7A5A10", panel: true,
  },
};

const html = (t) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Hubot;src:url(${font("HubotSans-Latin.woff2")}) format("woff2");font-weight:200 900;font-stretch:75% 125%}
@font-face{font-family:Geist;src:url(${font("Geist-Latin.woff2")}) format("woff2");font-weight:100 900}
@font-face{font-family:GeistMono;src:url(${font("GeistMono-Latin.woff2")}) format("woff2");font-weight:100 900}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;background:${t.bg};overflow:hidden}
.stage{position:relative;width:${W}px;height:${H}px;font-family:Geist,sans-serif;color:${t.fg0}}
.art{position:absolute;top:0;right:0;width:980px;height:${H}px;overflow:hidden}
.art img{position:absolute;width:1120px;right:-120px;top:-150px}
.art::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,${t.bg} 0%,rgba(0,0,0,0) 46%)}
${t.panel ? `.art{top:36px;right:36px;width:640px;height:${H - 72}px;border-radius:14px;background:#0B0C0F}
.art img{width:900px;right:-150px;top:-120px}
.art::after{background:linear-gradient(90deg,#0B0C0F 0%,rgba(11,12,15,0) 34%)}` : ""}
.copy{position:absolute;left:88px;top:0;height:${H}px;display:flex;flex-direction:column;justify-content:center;width:920px}
.lockup{display:flex;align-items:center;gap:22px;color:${t.chrome}}
.glyph{width:58px;height:58px}
.word{height:30px;width:250px;display:flex;align-items:center;color:${t.fg0}}
.eyebrow{margin-top:40px;font-family:Hubot;font-stretch:115%;font-weight:560;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:${t.muted}}
h1{margin-top:16px;font-family:Hubot;font-stretch:118%;font-weight:600;font-size:50px;line-height:1;letter-spacing:-.028em;white-space:nowrap}
h1 span{display:block;color:${t.muted}}
.meta{margin-top:40px;display:flex;gap:22px;font-family:GeistMono;font-size:13px;letter-spacing:.02em;color:${t.fg2};font-variant-numeric:tabular-nums slashed-zero}
.meta i{font-style:normal;display:inline-flex;align-items:center;gap:9px}
.dot{width:7px;height:7px;border-radius:999px;display:inline-block}
.rule{position:absolute;left:88px;right:88px;bottom:0;height:1px;background:${t.line}}
</style></head><body><div class="stage">
<div class="art"><img src="${poster}" alt=""></div>
<div class="copy">
  <div class="lockup"><div class="glyph">${glyph}</div><div class="word">${wordmark}</div></div>
  <div class="eyebrow">Personal agent identity and mandated finance</div>
  <h1>Always with you.<span>Never beyond your mandate.</span></h1>
  <div class="meta">
    <i><b class="dot" style="background:${t.steel}"></b>Topic F, Agent Wallet</i>
    <i><b class="dot" style="background:${t.steel}"></b>FISCO BCOS, team-run</i>
    <i><b class="dot" style="background:${t.brass}"></b>Test units only</i>
  </div>
</div>
${t.panel ? "" : '<div class="rule"></div>'}
</div></body></html>`;

mkdirSync(here, { recursive: true });
const channel = process.env.PW_CHANNEL ?? "chrome";
const browser = await chromium.launch(channel ? { channel } : {});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
for (const [name, t] of Object.entries(themes)) {
  await page.setContent(html(t), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const png = await page.screenshot({ type: "png" });
  const out = resolve(here, name === "dark" ? "banner.png" : "banner-light.png");
  await sharp(png).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(out);
  console.log("wrote", out);
}
await browser.close();

// Signature lockup in the two theme colours (an <img> on GitHub has no currentColor context).
const sig = readFileSync(resolve(brand, "signature-lockup.svg"), "utf8");
writeFileSync(resolve(here, "signature-lockup-dark.svg"), sig.replaceAll("currentColor", "#9A9A96"));
writeFileSync(resolve(here, "signature-lockup-light.svg"), sig.replaceAll("currentColor", "#66665F"));
console.log("wrote signature lockups");
