#!/usr/bin/env node
// Hard-rule gate. Fails if:
//  1. any tracked or staged text file contains a CJK character (U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+FF00-FFEF);
//  2. any commit message (or the message file passed with --msg) carries AI attribution;
//  3. any tracked file looks like it holds a private key, mnemonic or API token.
// Usage: node scripts/check-rules.mjs [--staged] [--history] [--msg <file>]
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";

const args = process.argv.slice(2);
const CJK_RANGES = [[0x3000, 0x303f], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xff00, 0xffef]];
const CJK = new RegExp(`[${CJK_RANGES.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join("")}]`, "u");
const ATTRIBUTION = [/co-authored-by/i, /generated with \[?claude/i, /claude-session/i, /noreply@anthropic\.com/i, /\bclaude code\b.*generated/i];
const SECRET_PATTERNS = [
  { name: "private key hex", re: /(?:private[_-]?key|PRIVATE_KEY)\s*[:=]\s*["']?0x[0-9a-fA-F]{64}/ },
  { name: "PEM private key", re: /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: "OpenRouter key", re: /sk-or-v1-[0-9a-f]{40,}/ },
  { name: "Alibaba Cloud DashScope key", re: /sk-ws-[0-9A-Za-z_-]{20,}/ },
  { name: "API key (sk- prefix)", re: /\bsk-[0-9a-f]{32,}\b/ },
  { name: "HuggingFace token", re: /\bhf_[A-Za-z0-9]{30,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "mnemonic", re: /\bmnemonic\b\s*[:=]\s*["']\w+(?: \w+){11,23}["']/i },
];
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|pdf|mp4|webm|zip|gz|onnx|gguf|bin|pt|safetensors)$/i;

function git(...a) {
  return execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

let failures = 0;
function fail(msg) {
  failures++;
  console.error(`RULE VIOLATION: ${msg}`);
}

const files = args.includes("--staged")
  ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR").split("\n").filter(Boolean)
  : git("ls-files").split("\n").filter(Boolean);

for (const f of files) {
  if (BINARY.test(f) || !existsSync(f) || statSync(f).isDirectory()) continue;
  let text;
  try {
    text = args.includes("--staged") ? git("show", `:${f}`) : readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (CJK.test(line)) fail(`CJK character in ${f}:${i + 1}`);
  });
  if (f !== "scripts/check-rules.mjs") {
    for (const p of SECRET_PATTERNS) if (p.re.test(text)) fail(`possible ${p.name} in ${f}`);
  }
}

const msgIdx = args.indexOf("--msg");
if (msgIdx >= 0) {
  const msg = readFileSync(args[msgIdx + 1], "utf8");
  for (const re of ATTRIBUTION) if (re.test(msg)) fail(`AI attribution in commit message (${re})`);
  if (CJK.test(msg)) fail("CJK character in commit message");
}

if (args.includes("--history")) {
  let log = "";
  try {
    log = git("log", "--all", "--format=%H%n%B%n--END--");
  } catch {
    log = "";
  }
  for (const block of log.split("--END--")) {
    const [sha, ...body] = block.trim().split("\n");
    const text = body.join("\n");
    for (const re of ATTRIBUTION) if (re.test(text)) fail(`AI attribution in commit ${sha}`);
    if (CJK.test(text)) fail(`CJK character in commit message ${sha}`);
  }
  let authors = "";
  try {
    authors = git("log", "--all", "--format=%an <%ae>%n%cn <%ce>");
  } catch {
    authors = "";
  }
  for (const a of new Set(authors.split("\n").filter(Boolean))) {
    if (/claude|anthropic/i.test(a)) fail(`AI author or committer in history: ${a}`);
  }
}

if (failures) {
  console.error(`\n${failures} rule violation(s).`);
  process.exit(1);
}
console.log(`rules ok: ${files.length} files checked${args.includes("--history") ? " + history" : ""}`);
