#!/usr/bin/env node
// WCAG 2.x contrast gate for the ORBIT tokens. Fails (exit 1) if any required pair is below its ratio.
import { TOKENS, contrast } from "./tokens.mjs";

// [foreground, background, minimum ratio, role]
const PAIRS = [
  ["fg-0", "bg-0", 7, "display text"],
  ["fg-1", "bg-0", 7, "body text"],
  ["fg-1", "bg-1", 7, "body text on panels"],
  ["fg-1", "bg-3", 7, "body text on raised rows"],
  ["fg-2", "bg-0", 4.5, "secondary text"],
  ["fg-2", "bg-1", 4.5, "secondary text on panels"],
  ["fg-2", "bg-3", 4.5, "secondary text on raised rows"],
  ["fg-muted", "bg-0", 4.5, "muted text"],
  ["fg-muted", "bg-1", 4.5, "muted text on panels"],
  ["fg-muted", "bg-2", 4.5, "muted text on cards"],
  ["line-3", "bg-0", 3, "control boundary"],
  ["line-3", "bg-1", 3, "control boundary on panels"],
  ["line-3", "bg-2", 3, "control boundary on cards"],
  ["steel", "bg-0", 4.5, "on-chain text"],
  ["steel", "bg-1", 4.5, "on-chain text on panels"],
  ["steel", "steel-tint", 4.5, "on-chain chip"],
  ["brass", "bg-0", 4.5, "waiting text"],
  ["brass", "bg-1", 4.5, "waiting text on panels"],
  ["brass", "brass-tint", 4.5, "waiting chip"],
  ["refused-fg", "refused-bg", 7, "refused chip (inverted)"],
  ["focus", "bg-0", 3, "focus ring"],
  ["focus", "bg-1", 3, "focus ring on panels"],
  ["signature", "bg-0", 4.5, "signature text"],
];

let failed = 0;
for (const theme of ["dark", "light"]) {
  const t = TOKENS[theme];
  for (const [fg, bg, min, role] of PAIRS) {
    const r = contrast(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${theme.padEnd(5)} ${fg.padEnd(10)} on ${bg.padEnd(10)} ${r.toFixed(2).padStart(5)}:1 (min ${min}) ${role}`);
  }
}
if (failed) {
  console.error(`\n${failed} contrast pair(s) below the minimum.`);
  process.exit(1);
}
console.log("\ncontrast ok");
