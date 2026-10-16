// Test suites run by `finalize --tests`, one at a time (memory is shared with other work on the evidence host).
// Every count comes from a machine-readable reporter: forge --json, vitest JSON, pytest JUnit XML, node's TAP
// reporter and Playwright JSON.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { readJson, run } from "./util";

export interface TestCase {
  name: string;
  status: "passed" | "failed" | "skipped";
  file?: string;
}
export interface SuiteResult {
  suite: string;
  key: string;
  label: string;
  ran: boolean;
  passed: number;
  failed: number;
  skipped: number;
  ms: number;
  note?: string;
  command: string;
  tests: TestCase[];
}

const TMP = process.env.TEMP ?? process.env.TMP ?? "/tmp";
const log = (s: string) => console.log(`finalize --tests: ${s}`);

function tally(r: SuiteResult): SuiteResult {
  r.passed = r.tests.filter((t) => t.status === "passed").length;
  r.failed = r.tests.filter((t) => t.status === "failed").length;
  r.skipped = r.tests.filter((t) => t.status === "skipped").length;
  return r;
}

// ---------------------------------------------------------------- Foundry
export function forgeSuite(root: string): SuiteResult {
  const forge = process.platform === "win32" ? "D:\\tools\\foundry\\forge.exe" : "forge";
  const cwd = resolve(root, "contracts");
  const out = run(forge, ["test", "--json"], { cwd, shell: false, env: { ...process.env, FOUNDRY_SOLC: process.env.FOUNDRY_SOLC ?? "" } });
  const r: SuiteResult = { suite: "forge", key: "tests.contracts", label: "Foundry (contracts)", ran: false, passed: 0, failed: 0, skipped: 0, ms: out.ms, command: "cd contracts && forge test --json", tests: [] };
  try {
    const j = JSON.parse(out.stdout.slice(out.stdout.indexOf("{"))) as Record<string, { test_results: Record<string, { status: string }> }>;
    for (const [suite, s] of Object.entries(j)) {
      const file = `contracts/${suite.split(":")[0]}`;
      for (const [name, t] of Object.entries(s.test_results)) {
        r.tests.push({ name: `${suite}::${name}`, file, status: t.status === "Success" ? "passed" : t.status === "Skipped" ? "skipped" : "failed" });
      }
    }
    r.ran = true;
  } catch {
    r.note = `forge output could not be parsed (exit ${out.status}): ${out.stderr.slice(0, 300)}`;
  }
  return tally(r);
}

// ---------------------------------------------------------------- vitest (every workspace package whose test script is vitest)
export function vitestPackages(root: string): string[] {
  const out: string[] = [];
  for (const top of ["packages", "apps"]) {
    for (const d of readdirSync(resolve(root, top))) {
      const pj = readJson<{ scripts?: Record<string, string> }>(resolve(root, top, d, "package.json"));
      if (!pj?.scripts?.test?.includes("vitest")) continue;
      const hasTests = (dir: string): boolean =>
        existsSync(dir) &&
        readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory() ? e.name !== "node_modules" && !e.name.startsWith(".") && hasTests(resolve(dir, e.name)) : /\.test\.tsx?$/.test(e.name)));
      if (hasTests(resolve(root, top, d))) out.push(`${top}/${d}`);
    }
  }
  return out;
}

export const vitestKey = (pkg: string) => `tests.vitest.${pkg.split("/").pop()!.replace(/-/g, "_")}`;

export function vitestSuite(root: string, pkg: string, extraEnv: Record<string, string> = {}): SuiteResult {
  const outFile = resolve(TMP, `vitest-${pkg.replace(/\//g, "-")}.json`);
  const cwd = resolve(root, pkg);
  const out = run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${outFile}`], { cwd, env: { ...process.env, ...extraEnv } });
  const r: SuiteResult = { suite: `vitest:${pkg}`, key: vitestKey(pkg), label: `vitest ${pkg}`, ran: false, passed: 0, failed: 0, skipped: 0, ms: out.ms, command: `cd ${pkg} && npx vitest run`, tests: [] };
  const j = readJson<{ testResults: { name: string; status: string; message?: string; assertionResults: { ancestorTitles: string[]; title: string; status: string }[] }[] }>(outFile);
  if (!j) {
    r.note = `no vitest report (exit ${out.status}): ${(out.stderr || out.stdout).slice(-300)}`;
    return r;
  }
  for (const f of j.testResults) {
    const file = relative(root, f.name).replace(/\\/g, "/");
    if (!f.assertionResults.length && f.status === "failed") r.tests.push({ name: `${file} (file failed to load: ${(f.message ?? "").slice(0, 120)})`, file, status: "failed" });
    for (const a of f.assertionResults) {
      r.tests.push({ name: [...a.ancestorTitles, a.title].join(" > "), file, status: a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped" });
    }
  }
  r.ran = true;
  return tally(r);
}

// ---------------------------------------------------------------- pytest (JUnit XML)
export function pytestSuite(root: string): SuiteResult {
  const xml = resolve(TMP, "pytest-verify-py.xml");
  const cwd = resolve(root, "tools/verify-py");
  const out = run("uv", ["run", "pytest", "-q", "-p", "no:cacheprovider", `--junitxml=${xml}`], { cwd });
  const r: SuiteResult = { suite: "pytest:verify_py", key: "tests.pytest.verify_py", label: "pytest tools/verify-py", ran: false, passed: 0, failed: 0, skipped: 0, ms: out.ms, command: "cd tools/verify-py && uv run pytest", tests: [] };
  if (!existsSync(xml)) {
    r.note = `no JUnit report (exit ${out.status}): ${(out.stderr || out.stdout).slice(-300)}`;
    return r;
  }
  const s = readFileSync(xml, "utf8");
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const attrs = m[1]!;
    const body = m[3] ?? "";
    const cls = attrs.match(/classname="([^"]*)"/)?.[1] ?? "";
    const name = attrs.match(/\bname="([^"]*)"/)?.[1] ?? "";
    // classname is the dotted module path (plus a class name for class-based tests): find the module file.
    const parts = cls.split(".");
    let file = "";
    for (let k = parts.length; k > 0 && !file; k--) {
      const f = `tools/verify-py/${parts.slice(0, k).join("/")}.py`;
      if (existsSync(resolve(root, f))) file = f;
    }
    const status = /<(failure|error)\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
    r.tests.push({ name: `${cls}::${name}`, file: file || `tools/verify-py/${cls}`, status });
  }
  r.ran = true;
  return tally(r);
}

// ---------------------------------------------------------------- node test runner (circuits prover), TAP
export function proverSuite(root: string): SuiteResult {
  const cwd = resolve(root, "circuits");
  const files = readdirSync(resolve(cwd, "prover/test")).filter((f) => f.endsWith(".test.ts")).map((f) => `prover/test/${f}`);
  const out = run("npx", ["tsx", "--test", "--test-reporter=tap", ...files], { cwd });
  const r: SuiteResult = { suite: "node:prover", key: "tests.node.prover", label: "circuits/prover (node test runner)", ran: false, passed: 0, failed: 0, skipped: 0, ms: out.ms, command: "pnpm --dir circuits test", tests: [] };
  const tap = out.stdout;
  const num = (k: string) => Number(tap.match(new RegExp(`^# ${k} (\\d+)`, "m"))?.[1] ?? NaN);
  if (!Number.isFinite(num("tests"))) {
    r.note = `no TAP summary (exit ${out.status}): ${(out.stderr || tap).slice(-300)}`;
    return r;
  }
  // Leaf tests only: a TAP line whose next indented block is not a subtest list. Names are kept for matching.
  const lines = tap.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(\s*)(ok|not ok) \d+ - (.*?)(\s+#\s*(SKIP|TODO).*)?$/);
    if (!m) continue;
    const isSuite = lines.slice(i + 1, i + 4).some((l) => /^\s*type: 'suite'/.test(l));
    if (isSuite) continue;
    r.tests.push({ name: m[3]!, file: files.map((f) => `circuits/${f}`).join(", "), status: m[5] ? "skipped" : m[2] === "ok" ? "passed" : "failed" });
  }
  r.ran = true;
  tally(r);
  // Trust the runner's own summary if the leaf detection disagrees.
  if (r.passed !== num("pass") || r.failed !== num("fail")) {
    r.note = `leaf parse ${r.passed}/${r.failed}; runner summary pass ${num("pass")}, fail ${num("fail")}`;
    r.passed = num("pass");
    r.failed = num("fail");
    r.skipped = num("skipped") || 0;
  }
  return r;
}

// ---------------------------------------------------------------- Playwright (fixtures build)
export function playwrightSuite(root: string): SuiteResult {
  const cwd = resolve(root, "apps/web");
  const r: SuiteResult = { suite: "playwright", key: "tests.e2e", label: "Playwright apps/web (fixtures build)", ran: false, passed: 0, failed: 0, skipped: 0, ms: 0, command: "pnpm --dir apps/web build:e2e && cd apps/web && npx playwright test", tests: [] };
  const browsers = process.platform === "win32" ? "D:\\tools\\ms-playwright" : (process.env.PLAYWRIGHT_BROWSERS_PATH ?? "");
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers, NEXT_TELEMETRY_DISABLED: "1" };
  log("building the web app (fixtures) for Playwright");
  const build = run("pnpm", ["--dir", "apps/web", "build:e2e"], { cwd: root, env });
  if (build.status !== 0) {
    r.note = `not run: the fixtures build failed (exit ${build.status}): ${(build.stderr || build.stdout).slice(-300)}`;
    r.ms = build.ms;
    return r;
  }
  const outFile = resolve(TMP, "playwright.json");
  const out = run("npx", ["playwright", "test", "--reporter=json"], { cwd, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile } });
  r.ms = build.ms + out.ms;
  type Spec = { title: string; file: string; tests: { status: string }[] };
  type Suite = { title: string; file: string; specs?: Spec[]; suites?: Suite[] };
  const j = readJson<{ suites: Suite[] }>(outFile);
  if (!j) {
    r.note = `no Playwright report (exit ${out.status}): ${(out.stderr || out.stdout).slice(-300)}`;
    return r;
  }
  const walk = (s: Suite, path: string[]) => {
    for (const sp of s.specs ?? []) {
      for (const t of sp.tests) {
        r.tests.push({ name: [...path, sp.title].join(" > "), file: `apps/web/tests/${sp.file}`.replace("apps/web/tests/tests/", "apps/web/tests/"), status: t.status === "expected" || t.status === "flaky" ? "passed" : t.status === "skipped" ? "skipped" : "failed" });
      }
    }
    for (const c of s.suites ?? []) walk(c, [...path, c.title]);
  };
  for (const s of j.suites) walk(s, [s.title]);
  r.ran = true;
  return tally(r);
}

// ---------------------------------------------------------------- nargo
export function nargoSuite(root: string): SuiteResult {
  const r: SuiteResult = { suite: "nargo", key: "tests.nargo.circuit", label: "nargo circuits/mandate_compliance", ran: false, passed: 0, failed: 0, skipped: 0, ms: 0, command: "cd circuits/mandate_compliance && nargo test", tests: [] };
  const candidates = ["nargo", ...(process.platform === "win32" ? ["D:\\tools\\nargo\\nargo.exe", "D:\\tools\\cargo\\bin\\nargo.exe"] : [])];
  let bin = "";
  for (const c of candidates) {
    const v = run(c, ["--version"], { cwd: root, shell: false });
    if (v.status === 0) {
      bin = c;
      break;
    }
  }
  if (!bin) {
    r.note = "not run: nargo is not installed on the evidence host";
    return r;
  }
  const out = run(bin, ["test"], { cwd: resolve(root, "circuits/mandate_compliance"), shell: false });
  r.ms = out.ms;
  for (const m of (out.stdout + out.stderr).matchAll(/\[mandate_compliance\] Testing (\S+)\.\.\. (ok|FAIL)/g)) {
    r.tests.push({ name: m[1]!, file: "circuits/mandate_compliance/src/main.nr", status: m[2] === "ok" ? "passed" : "failed" });
  }
  r.ran = r.tests.length > 0;
  if (!r.ran) r.note = `nargo test produced no parsable result (exit ${out.status})`;
  return tally(r);
}

/** Runs every suite in turn. The agent suite also writes the PII-scrubber recall report into docs/evidence. */
export function runAllSuites(root: string): SuiteResult[] {
  const out: SuiteResult[] = [];
  log("forge test");
  out.push(forgeSuite(root));
  for (const pkg of vitestPackages(root)) {
    log(`vitest ${pkg}`);
    const env: Record<string, string> = {};
    const scrub = resolve(TMP, "scrubber-recall.json");
    if (pkg === "apps/agent") env.SCRUBBER_REPORT = scrub;
    const r = vitestSuite(root, pkg, env);
    out.push(r);
    if (pkg === "apps/agent" && r.ran && existsSync(scrub)) {
      mkdirSync(resolve(root, "docs/evidence"), { recursive: true });
      copyFileSync(scrub, resolve(root, "docs/evidence/scrubber-recall.json"));
    }
  }
  log("pytest tools/verify-py");
  out.push(pytestSuite(root));
  log("circuits prover");
  out.push(proverSuite(root));
  out.push(nargoSuite(root));
  out.push(playwrightSuite(root));
  for (const r of out) log(`${r.label}: ${r.ran ? `${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped` : "not run"}${r.note ? ` (${r.note})` : ""}`);
  return out;
}
