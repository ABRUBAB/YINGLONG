#!/usr/bin/env node
/**
 * Build-time data for the home and About pages (CLAUDE.md rule 5: nothing here is typed by hand).
 * Writes content/generated/site-data.json from files the code produced:
 *   - git log                                  -> the build timeline (dates, subjects, tracks)
 *   - contracts/deployments/{base-sepolia,fisco}.json -> runtime code hash per contract per ledger
 *   - docs/evidence/bundle.json                -> the 13 YINGLONG enforcers and generated metrics
 *   - apps/agent/data/e2e-base-sepolia.json    -> the recorded Base Sepolia scenario transactions
 *   - docs/evidence/claims-input.json + docs/CLAIMS.md -> the CL-17 wording the lead decided
 *   - package manifests                        -> the technology stack with pinned versions
 * When a source is missing (the web image copies apps/web only), the previous value in the existing
 * JSON is kept, so `next build` never depends on the repository around it.
 * Usage: node scripts/site-data.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(web, "..", "..");
const outFile = join(web, "content", "generated", "site-data.json");
mkdirSync(dirname(outFile), { recursive: true });

const previous = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(join(repo, p), "utf8"));
  } catch {
    return null;
  }
};
const readText = (p) => {
  try {
    return readFileSync(join(repo, p), "utf8");
  } catch {
    return null;
  }
};
const sources = {};

/* ------------------------------------------------------------------ timeline (git log) */

// Each commit lands on one track: by the subject's leading words first, then by the first keyword
// group that matches.
const TRACKS = [
  ["web", /^(web app|redesign|readme|reading deck|video|passkey sign-up)\b/i],
  ["contracts", /^(contracts?|contract tests|contract analysis|invariant|monotonic)\b/i],
  ["ledgers", /^(fisco|base sepolia|ledger|deploy the zk|live private mandate|private mandate|stateful zk|coin-free|validity windows|writes wait)\b/i],
  ["evidence", /^(evidence|rival check|timing drills|keep the fisco deployment)\b/i],
  ["infra", /^(infra|edge|ci|stack|fix deploy|deploy fails|secret scan|services report|operator calls|indexer read routes|fix the sk-)\b/i],
  ["agent", /^(agent|signer|sdk|receipts|judge's challenge|board|mandate|pause and resume|live stack|demo setup|lotus|api|vision|x402|label|visitors|registry|breaker|exact fisco|python verifier|scenario capabilities|passkey-signed|fisco liveness|restore)\b/i],
  ["web", /\b(web|ORBIT|\/start|README|deck|video)\b/i],
  ["ledgers", /\b(FISCO|Base Sepolia|Anvil|ZK|UltraHonk|Noir)\b/i],
  ["contracts", /\b(contracts?|enforcers?|Solidity|Foundry)\b/i],
  ["evidence", /\b(evidence|PROOF|claim|drill|tests?)\b/i],
  ["agent", /\b(agent|signer|mandate|passkey|API|receipts?)\b/i],
];
// Milestones: the commits whose subject names a first (a capability going live end to end).
const MILESTONE = [
  /^Bootstrap repository/i,
  /thirteen caveat enforcers/i,
  /^FISCO BCOS .* ledger/i,
  /^Stateful ZK private mandate/i,
  /^Agent runtime: nine-scale pipeline/i,
  /^Judge's Challenge/i,
  /^Agent City services/i,
  /^Web app \(ORBIT/i,
  /^Visitors sign up with their own passkey/i,
  /^Passkey sign-up at \/start/i,
  /^Redesign:/i,
  /^Base Sepolia live/i,
  /^Private mandate on Base Sepolia/i,
];

function gitTimeline() {
  try {
    const raw = execFileSync("git", ["log", "--reverse", "--format=%h%x1f%aI%x1f%s"], { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    const commits = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, at, subject] = line.split("\x1f");
        const track = (TRACKS.find(([, re]) => re.test(subject)) ?? ["infra"])[0];
        return { hash, at, subject, track, milestone: MILESTONE.some((re) => re.test(subject)) };
      });
    if (!commits.length) return null;
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    sources.timeline = "git log";
    return { head, count: commits.length, first: commits[0].at, last: commits[commits.length - 1].at, commits };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ same rules, two chains */

function twinChains(bundle) {
  const base = readJson("contracts/deployments/base-sepolia.json");
  const fisco = readJson("contracts/deployments/fisco.json");
  if (!base || !fisco) return null;
  // The 13 YINGLONG enforcers, as the evidence generator lists them in its bytecode table.
  const table = bundle?.metrics?.["bytecode.table"] ?? "";
  const names = [...table.matchAll(/^\| `(\w+Enforcer)` \|/gm)].map((m) => m[1]);
  if (!names.length) return null;
  const rows = names.map((name) => ({
    name,
    base: base[name] ? { address: base[name].address, codeHash: base[name].codeHash } : null,
    fisco: fisco[name] ? { address: fisco[name].address, codeHash: fisco[name].codeHash } : null,
  }));
  // Every contract both deployment files list, for the "same bytecode" count.
  const both = Object.keys(base).filter((k) => base[k]?.codeHash && fisco[k]?.codeHash);
  const equal = both.filter((k) => base[k].codeHash.toLowerCase() === fisco[k].codeHash.toLowerCase());
  sources.twin = "contracts/deployments/base-sepolia.json, contracts/deployments/fisco.json, docs/evidence/bundle.json (bytecode.table)";
  return {
    enforcers: rows,
    allContracts: { compared: both.length, equal: equal.length, differ: both.filter((k) => !equal.includes(k)) },
  };
}

/* ------------------------------------------------------------------ recorded Base Sepolia scenario */

function baseScenario() {
  const steps = readJson("apps/agent/data/e2e-base-sepolia.json");
  if (!Array.isArray(steps)) return null;
  sources.baseScenario = "apps/agent/data/e2e-base-sepolia.json";
  return steps
    .map((s, i) => {
      const tx = s.tx ?? s.publishTx ?? (Array.isArray(s.attestTxs) ? s.attestTxs[0] : null) ?? null;
      const revert = typeof s.revert === "string" ? s.revert : null;
      return {
        index: i + 1,
        step: s.step,
        tx,
        ok: s.ok ?? (revert ? false : tx ? true : null),
        revert,
        msToConfirmed: typeof s.msToConfirmed === "number" ? s.msToConfirmed : null,
        block: s.block ?? null,
      };
    })
    .filter((s) => s.tx || s.revert);
}

/* ------------------------------------------------------------------ generated metrics */

const METRIC_KEYS = [
  "tests.total",
  "tests.contracts",
  "tests.failed",
  "evidence.receipts",
  "evidence.anchored_receipts",
  "evidence.reverts",
  "evidence.refused_offchain",
  "evidence.tx_count",
  "bytecode.equal",
  "bytecode.total",
  "time.pause.p50",
  "time.pause.n",
  "time.revoke.p50",
  "time.ledger",
  "controls.total",
  "fisco.nodes",
  "chain.ledgers",
];

function metrics(bundle) {
  if (!bundle?.metrics) return null;
  const out = {};
  for (const k of METRIC_KEYS) if (bundle.metrics[k] !== undefined) out[k] = String(bundle.metrics[k]);
  sources.metrics = "docs/evidence/bundle.json";
  return { generatedAt: bundle.generatedAt ?? bundle.metrics["meta.generated_at"] ?? null, values: out };
}

/* ------------------------------------------------------------------ CL-17 wording */

function novelty() {
  const input = readJson("docs/evidence/claims-input.json");
  const claims = readText("docs/CLAIMS.md");
  const decision = input?.decisions?.["CL-17"]?.decision;
  if (!decision || !claims) return null;
  const section = claims.split(/^### CL-17\.[^\n]*$/m)[1]?.split(/^### /m)[0] ?? "";
  const line = section.split("\n").find((l) => l.startsWith(`- **${decision}**`));
  const text = line?.match(/"([^"]+)"/)?.[1];
  if (!text) return null;
  sources.novelty = "docs/evidence/claims-input.json (CL-17 decision), docs/CLAIMS.md (wording)";
  return { id: "CL-17", decision, text, reason: input.decisions["CL-17"].reason ?? null };
}

/* ------------------------------------------------------------------ enforcers and typed errors (docs/ENFORCERS.md) */

function enforcerDocs() {
  const md = readText("docs/ENFORCERS.md");
  if (!md) return null;
  const enforcers = {};
  for (const block of md.split(/^### /m).slice(1)) {
    const head = block.match(/^[\d.]+\s+(\w+)(?:\s+\(position (\d+)[^)]*\))?/);
    if (!head) continue;
    const purpose = block.match(/^\| Purpose \| (.+?) \|$/m)?.[1];
    if (!purpose) continue;
    // The first sentence (or clause before a colon) is the rule in plain words.
    const clean = purpose.replace(/`/g, "");
    const first = clean.split(/(?<=[a-z0-9)"])[.:](?:\s|$)/)[0].trim();
    // What follows a "Short name: explanation" purpose, up to its first full stop.
    const after = clean.includes(": ") ? clean.slice(clean.indexOf(": ") + 2).split(/\.(?:\s|$)/)[0].trim() : null;
    enforcers[head[1]] = { position: head[2] ? Number(head[2]) : null, rule: first, detail: after && after !== first ? after : null };
  }
  const errors = {};
  const table = md.split(/^## 4\. Typed errors by enforcer/m)[1]?.split(/^## /m)[0] ?? "";
  for (const row of table.split("\n")) {
    const cells = row.split("|").map((c) => c.trim());
    if (cells.length < 4 || !cells[1].startsWith("`")) continue;
    const by = cells[2].match(/`(\w+)`/)?.[1];
    if (!by) continue;
    for (const m of cells[1].matchAll(/`(\w+)\(/g)) errors[m[1]] ??= by;
  }
  if (!Object.keys(enforcers).length) return null;
  sources.enforcerDocs = "docs/ENFORCERS.md (sections 3 and 4)";
  return { enforcers, errors };
}

/* ------------------------------------------------------------------ the nine scales (docs/TECHNICAL.md) */

function scales() {
  const md = readText("docs/TECHNICAL.md");
  if (!md) return null;
  const rows = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\| ([1-9]) \| (\w[\w ]*?) \| [^|]+ \| (.+) \| (.+?) \|$/);
    if (!m || rows.some((r) => r.n === Number(m[1]))) continue;
    const parts = m[3].replace(/`/g, "").split(/;\s/);
    // A very short first clause (a single term) reads better with the clause after it.
    const what = (parts[0].length < 20 && parts[1] ? `${parts[0]}; ${parts[1]}` : parts[0]).trim();
    rows.push({ n: Number(m[1]), name: m[2], what, refuses: m[4].replace(/[*`]/g, "").trim() });
  }
  if (rows.length !== 9) return null;
  sources.scales = "docs/TECHNICAL.md (the nine scales table)";
  return rows.sort((a, b) => a.n - b.n);
}

/* ------------------------------------------------------------------ stack */

function stack(bundle) {
  const webPkg = readJson("apps/web/package.json");
  const ws = readText("pnpm-workspace.yaml");
  const foundry = readText("contracts/foundry.toml");
  // Only with every source present: a partial checkout (the web image) keeps the previous stack.
  if (!webPkg || !ws || !foundry || !bundle?.metrics) return null;
  const cat = (name) => ws.match(new RegExp(`^\\s+"?${name.replace(/[/@]/g, (c) => `\\${c}`)}"?:\\s*([^\\s#]+)`, "m"))?.[1] ?? null;
  const dep = (name) => {
    const v = webPkg.dependencies?.[name] ?? webPkg.devDependencies?.[name] ?? null;
    return v === "catalog:" ? cat(name) : v;
  };
  const solc = foundry?.match(/^solc\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  const fisco = (bundle?.metrics?.["chain.ledgers"] ?? "").match(/FISCO BCOS ([\d.]+)/)?.[1] ?? null;
  sources.stack = "apps/web/package.json, pnpm-workspace.yaml, contracts/foundry.toml, docs/evidence/bundle.json (chain.ledgers)";
  return [
    {
      layer: "Ledgers and contracts",
      items: [
        { name: "Solidity", version: solc, note: "Foundry; caveat enforcers on the MetaMask Delegation Framework" },
        { name: "FISCO BCOS", version: fisco, note: "consortium ledger the team runs (PBFT)" },
        { name: "Base Sepolia", version: null, note: "public testnet" },
        { name: "Noir and UltraHonk", version: null, note: "the private-mandate proof" },
      ],
    },
    {
      layer: "Agent service",
      items: [
        { name: "TypeScript", version: cat("typescript"), note: "agent, signer, indexer, services" },
        { name: "Hono", version: cat("hono"), note: "HTTP API" },
        { name: "viem", version: cat("viem"), note: "chain reads, user operations, EIP-712" },
        { name: "zod", version: cat("zod"), note: "every wire format is parsed, never trusted" },
      ],
    },
    {
      layer: "Web",
      items: [
        { name: "Next.js", version: dep("next"), note: "App Router" },
        { name: "React", version: dep("react"), note: "view transitions between routes" },
        { name: "three.js", version: dep("three"), note: "with React Three Fiber " + (dep("@react-three/fiber") ?? "") },
        { name: "GSAP", version: dep("gsap"), note: "the seal and the seven verbs" },
        { name: "Paper Shaders", version: dep("@paper-design/shaders-react"), note: "the hero atmosphere" },
        { name: "Tailwind CSS", version: dep("tailwindcss"), note: "on the ORBIT tokens" },
      ],
    },
    {
      layer: "Verification",
      items: [
        { name: "TypeScript verifier", version: null, note: "packages/mandate" },
        { name: "Python verifier", version: null, note: "tools/verify-py, independent of the TypeScript code" },
        { name: "Playwright and axe", version: dep("@playwright/test"), note: "every route, three widths" },
      ],
    },
  ];
}

const bundle = readJson("docs/evidence/bundle.json");
const next = {
  schema: "yinglong.site-data/1",
  generatedAt: new Date().toISOString(),
  timeline: gitTimeline() ?? previous.timeline ?? null,
  twin: twinChains(bundle) ?? previous.twin ?? null,
  baseScenario: baseScenario() ?? previous.baseScenario ?? null,
  metrics: metrics(bundle) ?? previous.metrics ?? null,
  novelty: novelty() ?? previous.novelty ?? null,
  stack: stack(bundle) ?? previous.stack ?? null,
  enforcerDocs: enforcerDocs() ?? previous.enforcerDocs ?? null,
  scales: scales() ?? previous.scales ?? null,
};
next.sources = { ...(previous.sources ?? {}), ...sources };

// Keep the file stable when nothing changed (the timestamp alone is not a change).
const strip = (o) => JSON.stringify({ ...o, generatedAt: null });
if (previous.schema && strip(previous) === strip(next)) {
  console.log("site-data: unchanged");
} else {
  writeFileSync(outFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`site-data: wrote ${outFile} (${Object.keys(sources).join(", ") || "kept previous values"})`);
}
