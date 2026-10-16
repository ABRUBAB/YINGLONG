#!/usr/bin/env node
// Sums the gzip size of the JavaScript a route loads before any lazy chunk (budget:
// home blocking JS < 180 kB gz). Usage: node scripts/bundle-size.mjs [baseUrl] [path...]
import { gzipSync } from "node:zlib";

const base = process.argv[2] || "http://localhost:3210";
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ["/"];
for (const p of paths) {
  const html = await (await fetch(base + p)).text();
  const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))];
  let raw = 0;
  let gz = 0;
  for (const s of srcs) {
    const buf = Buffer.from(await (await fetch(new URL(s, base))).arrayBuffer());
    raw += buf.length;
    gz += gzipSync(buf, { level: 9 }).length;
  }
  console.log(`${p}: ${srcs.length} scripts, ${(raw / 1024).toFixed(1)} kB raw, ${(gz / 1024).toFixed(1)} kB gzip`);
}
