#!/usr/bin/env node
// ORBIT colour tokens: the single source of truth.
// `node scripts/tokens.mjs` writes app/tokens.css with OKLCH values and the hex in comments.
// scripts/contrast.mjs imports TOKENS and fails CI if a required pair drops below its ratio.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TOKENS = {
  // ORBIT Volt (17 Oct 2026). Dark: a lime-yellow green (#CBFF3C). Light: a separate design, deep ultramarine with a burnt-orange highlight on warm paper.
  // ORBIT Volt (17 Oct 2026): the dark and ash base stays. On top of it, an electric green accent
  // (#3DE35B) and a small family of supporting colours, used only for actions, states and highlights. Colour still carries state: electric green = brand, action and "inside the
  // rules"; cyan = written on a ledger; amber = waiting on a person; coral = the seal; violet = the
  // AI screen; lime = highlights; the inverted chip = refused.
  dark: {
    "bg-0": "#0B0C0F", // green obsidian
    "bg-1": "#121418",
    "bg-2": "#171A1F",
    "bg-3": "#1E2228",
    "line-1": "#272C34", // decorative hairline
    "line-2": "#353B45", // decorative hairline
    "line-3": "#6A7280", // UI boundary, >= 3:1
    "fg-faint": "#5C6470", // disabled only
    "fg-muted": "#8A93A0",
    "fg-2": "#B3BAC4",
    "fg-1": "#E7E9EC",
    "fg-0": "#F6F7F9",
    "chrome-0": "#FFFFFF", // seal and logo material only
    "chrome-1": "#C9CFD6",
    "chrome-2": "#9AA3AE",
    accent: "#CBFF3C", // brand and action: electric green
    "accent-tint": "#242C0A",
    "accent-fg": "#0F1503", // text on the accent
    "accent-glow": "#CBFF3C", // lights, glows and fills (never text)
    lime: "#E6FF7A", // highlights and gradients
    "lime-tint": "#2A3008",
    violet: "#A394FF", // the AI screen, gradients
    "violet-tint": "#1B1840",
    steel: "#3CD3F0", // written on a ledger (cyan)
    "steel-tint": "#0A2630",
    brass: "#FFB84D", // waiting on a person (amber)
    "brass-tint": "#2D2008",
    jade: "#3DE35B", // inside the rules, settled
    "jade-tint": "#0E2A14",
    seal: "#FF5A5F", // the owner's seal, the pearl (coral)
    "seal-tint": "#301214",
    canvas: "#0E1014", // behind live charts
    grid: "#1A1E24", // chart grid lines
    "refused-bg": "#E7E9EC", // inverted chip
    "refused-fg": "#0B0C0F",
    focus: "#CBFF3C",
    "ink-mark": "#F4F3F0",
    signature: "#9A9A96",
  },
  light: {
    "bg-0": "#F3F2EE", // pale green ivory
    "bg-1": "#FAFAF7",
    "bg-2": "#FFFFFF",
    "bg-3": "#ECEBE6",
    "line-1": "#DCDAD3",
    "line-2": "#C3C1B9",
    "line-3": "#82807A",
    "fg-faint": "#A3A199",
    "fg-muted": "#6B6A63",
    "fg-2": "#46453F",
    "fg-1": "#1D1C1A",
    "fg-0": "#0B0B0A",
    "chrome-0": "#0B0B0A",
    "chrome-1": "#46453F",
    "chrome-2": "#6B6A63",
    accent: "#2B3AE0",
    "accent-tint": "#E3E6FC",
    "accent-fg": "#FFFFFF",
    "accent-glow": "#5565FF",
    lime: "#C2410C",
    "lime-tint": "#FDEBDD",
    violet: "#8B2FD6",
    "violet-tint": "#F1E4FB",
    steel: "#0B6E85",
    "steel-tint": "#D8EEF3",
    brass: "#7A5A10",
    "brass-tint": "#F6EFD9",
    jade: "#0F766E",
    "jade-tint": "#DDF1EE",
    seal: "#B3262B",
    "seal-tint": "#F8E3E3",
    canvas: "#FFFFFF",
    grid: "#ECEBE6",
    "refused-bg": "#1D1C1A",
    "refused-fg": "#FAFAF7",
    focus: "#0B0B0A",
    "ink-mark": "#0B0B0C",
    signature: "#66665F",
  },
};

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
export function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}
function oklchCss(hex) {
  const { L, C, H } = hexToOklch(hex);
  const h = C < 0.0005 ? 0 : H;
  return `oklch(${(L * 100).toFixed(2)}% ${C.toFixed(4)} ${h.toFixed(2)})`;
}

function indent(css) {
  return css
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n");
}

function block(selector, set) {
  const lines = Object.entries(set).map(([k, v]) => `  --${k}: ${oklchCss(v)}; /* ${v} */`);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const css =
    `/* Generated by scripts/tokens.mjs from the ORBIT hex table. Do not edit by hand. */\n` +
    `/* Dark is the default. Light follows the device setting unless the visitor chose a theme (data-theme), and applies in print. */\n` +
    block(":root,\n:root[data-theme=\"dark\"]", TOKENS.dark) +
    `@media (prefers-color-scheme: light) {\n` +
    indent(block(":root:not([data-theme=\"dark\"])", TOKENS.light)) +
    `}\n` +
    block(":root[data-theme=\"light\"]", TOKENS.light) +
    `/* Opt-in dark surface for poster and video captures only (?poster=1); pages follow the theme. */\n` +
    block("[data-surface=\"obsidian\"]", TOKENS.dark) +
    `@media print {\n` +
    indent(block(":root:root", TOKENS.light)) +
    `}\n`;
  writeFileSync(join(root, "app/tokens.css"), css);
  console.log("wrote app/tokens.css");
}
