// scripts/finalize: generate every evidence number and hash in the docs from the code's own outputs.
// Never hand-write evidence. Usage (repo root):
//   npx tsx apps/agent/scripts/finalize.ts [--tests] [--reach] [--final] [--api https://api.yinglong-agent.tech]
//     --tests  run every test suite (forge, vitest per package, pytest, circuits prover, nargo if installed, Playwright)
//     --reach  measure HTTPS reachability from mainland China probes (Globalping)
//     --final  release run: any marker still without a metric reads "not measured in this release", and a marker whose
//              key is not defined in docs/GENERATED_KEYS.md stops the run
// Writes docs/EXECUTION_EVIDENCE.md, PROOF.md, docs/evidence/bundle.json, docs/evidence/sbom.cdx.json and fills every
// <!-- gen:key --> marker in docs/*.md and README.md. Without --tests the previous bundle's tests.*, invariants.* and
// verify.* metrics and its per-suite test results are carried over.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { getAddress, type Address } from "viem";
import { LEDGERS, type LedgerName } from "@yinglong/sdk";
import { repoRoot } from "@yinglong/sdk/server";
import { accountOwner, gasUsed, liveCodeHashes, ReadRpc, scanDeployerRoles } from "./evidence/chain";
import { runAllSuites, vitestKey, type SuiteResult } from "./evidence/tests";
import { datasetsTable, modelsTable, npmTable, privateDatasetsTable, pythonTable, writeSbom } from "./evidence/thirdparty";
import { englishOnly, int, pct, quantile, rate, readJson, secs, sh, sha256File, table, wilson } from "./evidence/util";

const root = repoRoot();
const args = process.argv.slice(2);
const API = args.includes("--api") ? args[args.indexOf("--api") + 1]! : (process.env.AGENT_API ?? "https://api.yinglong-agent.tech");
const FISCO_RPC = process.env.FISCO_READ_RPC ?? `${API}/rpc/fisco`;
const TESTS = args.includes("--tests");
const FINAL = args.includes("--final");
const UNMEASURED = FINAL ? "not measured in this release" : "not yet measured";
const now = new Date().toISOString();
const p = (...s: string[]) => resolve(root, ...s);
const NOT_ON_BASE = "not deployed on Base Sepolia yet";
/** GET JSON from the live services, retried (the indexer and the agent can be briefly unavailable). */
async function getJson<T>(url: string): Promise<T | undefined> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (r.ok) return (await r.json()) as T;
    } catch {
      /* retry */
    }
    await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
  }
  return undefined;
}

interface Bundle {
  generatedAt: string;
  metrics: Record<string, string>;
  testRuns?: SuiteResult[];
  [k: string]: unknown;
}
const prevBundle = readJson<Bundle>(p("docs/evidence/bundle.json"));
const metrics: Record<string, string> = {};
// Start from the previous bundle so a quick run without --tests keeps the last measured test-derived numbers.
if (!TESTS && prevBundle) for (const [k, v] of Object.entries(prevBundle.metrics ?? {})) if (/^(tests|invariants|verify)\./.test(k)) metrics[k] = v;
const set = (k: string, v: string | undefined) => {
  if (v !== undefined && v !== "") metrics[k] = v;
};

// ---------------------------------------------------------------- meta
const dirty = sh("git", ["status", "--porcelain"], root).trim() !== "";
metrics["meta.generated_at"] = now;
metrics["meta.commit"] = `${sh("git", ["rev-parse", "HEAD"], root).trim()}${dirty ? " (working tree had uncommitted changes)" : ""}`;
metrics["meta.release_tag"] = sh("git", ["describe", "--tags", "--always"], root).trim();

// ---------------------------------------------------------------- deployments and bytecode equality
type Entry = { address: string; codeHash: string; txHash?: string };
type Dep = Record<string, Entry | string | number>;
const deps: Partial<Record<LedgerName, Dep>> = {};
for (const f of readdirSync(p("contracts/deployments"))) {
  const m = f.match(/^(anvil|fisco|base-sepolia)\.json$/);
  if (m) deps[m[1] as LedgerName] = JSON.parse(readFileSync(p("contracts/deployments", f), "utf8"));
}
const entry = (d: Dep | undefined, name: string) => {
  const v = d?.[name];
  return v && typeof v === "object" && "address" in v ? v : undefined;
};
const contractRows: { name: string; ledger: string; chainId: number; address: string; codeHash: string }[] = [];
for (const [ledger, d] of Object.entries(deps)) {
  for (const [name, v] of Object.entries(d!)) if (v && typeof v === "object" && "address" in v) contractRows.push({ name, ledger, chainId: Number(d!.chainId), address: v.address, codeHash: v.codeHash });
}
function equality(a: LedgerName, b: LedgerName, only?: string[]) {
  const A = deps[a];
  const B = deps[b];
  if (!A || !B) return undefined;
  let same = 0;
  let total = 0;
  const differ: string[] = [];
  for (const name of only ?? Object.keys(A)) {
    const v = entry(A, name);
    const w = entry(B, name);
    if (!v || !w) continue;
    total++;
    if (v.codeHash === w.codeHash) same++;
    else differ.push(name);
  }
  return { same, total, differ };
}
const BASE = !!deps["base-sepolia"];
const liveLedgers = (["base-sepolia", "fisco"] as LedgerName[]).filter((l) => deps[l]);
const LIVE: LedgerName = BASE ? "base-sepolia" : "fisco";
const pair: [LedgerName, LedgerName] = BASE ? ["base-sepolia", "fisco"] : ["anvil", "fisco"];
const pairLabel = `${LEDGERS[pair[0]].label} vs ${LEDGERS[pair[1]].label}`;
const eq = equality(pair[0], pair[1]);
if (eq) {
  metrics["chain.bytecode.equal"] = String(eq.same);
  metrics["chain.bytecode.total"] = String(eq.total);
  metrics["chain.bytecode.pair"] = BASE ? "Base Sepolia vs FISCO BCOS" : "Anvil vs FISCO BCOS";
  metrics["chain.bytecode.differ"] = eq.differ.join(", ") || "none";
}
metrics["deploy.base.status"] = BASE
  ? `deployed (${Object.values(deps["base-sepolia"]!).filter((v) => v && typeof v === "object").length} contracts)`
  : "rehearsed end to end on a local fork of Base Sepolia; live deployment pending testnet ETH";
metrics["chain.ledgers"] = liveLedgers.map((l) => LEDGERS[l].label).join(", ") || "none yet";

// YINGLONG custom enforcers only (contracts/src/enforcers, abstract bases excluded).
const ENFORCERS = readdirSync(p("contracts/src/enforcers"))
  .filter((f) => f.endsWith(".sol") && !/^\s*abstract contract/m.test(readFileSync(p("contracts/src/enforcers", f), "utf8")))
  .map((f) => f.replace(/\.sol$/, ""))
  .sort();
const rpc = new ReadRpc(FISCO_RPC);
const enfEq = equality(pair[0], pair[1], ENFORCERS);
let fiscoLive: (string | undefined)[] = [];
try {
  fiscoLive = deps.fisco ? await liveCodeHashes(rpc, ENFORCERS.map((n) => (entry(deps.fisco, n)?.address ?? "0x0000000000000000000000000000000000000000") as Address)) : [];
} catch {
  /* RPC unreachable: the table says so */
}
const fiscoLiveOk = ENFORCERS.every((n, i) => !entry(deps.fisco, n) || fiscoLive[i]?.toLowerCase() === entry(deps.fisco, n)!.codeHash.toLowerCase());
if (enfEq && enfEq.total) {
  metrics["bytecode.equal"] = String(enfEq.same);
  metrics["bytecode.total"] = String(enfEq.total);
  metrics["bytecode.pair"] = pairLabel;
  const allEq = enfEq.same === enfEq.total;
  metrics["bytecode.ledgers"] = allEq
    ? `${pair.length} (${pair.map((l) => LEDGERS[l].label).join(" and ")}${BASE ? "" : "; Base Sepolia not deployed"})`
    : `none: ${enfEq.differ.join(", ")} differ between ${pairLabel}`;
  metrics["bytecode.table"] = `${pairLabel}; ${pair[0] === "anvil" ? "Anvil hashes as recorded at deployment" : "hashes as recorded at deployment"}; FISCO BCOS hashes ${fiscoLive.length ? (fiscoLiveOk ? "re-read live (keccak256 of eth_getCode) at generation and equal to the deployment file" : "re-read live at generation: MISMATCH with the deployment file, see bundle") : "from the deployment file (live read unavailable)"}:${table(
    ["Enforcer", `${LEDGERS[pair[0]].label} address`, `${LEDGERS[pair[1]].label} address`, "Code hash", "Equal"],
    ENFORCERS.map((n) => {
      const a = entry(deps[pair[0]], n);
      const b = entry(deps[pair[1]], n);
      return [`\`${n}\``, a ? `\`${a.address}\`` : "-", b ? `\`${b.address}\`` : "-", a && b && a.codeHash === b.codeHash ? `\`${a.codeHash}\`` : `${a ? `\`${a.codeHash}\`` : "-"} / ${b ? `\`${b.codeHash}\`` : "-"}`, a && b ? (a.codeHash === b.codeHash ? "yes" : "no") : "not deployed on both"];
    }),
  )}`;
}
const dm = entry(deps.fisco, "DelegationManager");
metrics["fisco.dm.status"] = dm ? `deployed (DelegationManager \`${dm.address}\` in contracts/deployments/fisco.json)` : "not deployed: PolicyVault fallback";
const cmpFile = readdirSync(p("contracts-fisco/reports")).filter((f) => /^codehash-compare-.*\.json$/.test(f)).sort().pop();
if (cmpFile) {
  const c = readJson<{ comparisons: { anvilChainId: number; identicalRuntime: string[]; differOnlyInImmutables: string[]; differOtherwise: string[]; allAddressesEqual: boolean }[] }>(p("contracts-fisco/reports", cmpFile))!;
  metrics["bytecode.framework.masked_equal"] = `${c.comparisons
    .map((x) => {
      const n = x.identicalRuntime.length + x.differOnlyInImmutables.length + x.differOtherwise.length;
      return `against Anvil chain id ${x.anvilChainId}: ${x.identicalRuntime.length + x.differOnlyInImmutables.length} of ${n} identical once immutables are zeroed (${x.identicalRuntime.length} identical as deployed${x.differOnlyInImmutables.length ? `; ${x.differOnlyInImmutables.join(", ")} differ only in immutables` : ""}${x.differOtherwise.length ? `; ${x.differOtherwise.join(", ")} differ otherwise` : ""})`;
    })
    .join("; ")} (framework spike, contracts-fisco/reports/${cmpFile}); the full DeployYinglong deployment has not been compared with immutables masked`;
}

// ---------------------------------------------------------------- receipts (live API)
interface RView {
  receiptId: string;
  principal: string;
  ledger: LedgerName;
  tier: string;
  outcome: string;
  txHash?: string;
  explorerUrl?: string;
  revertError?: { name: string; message: string };
  explanation: { text: string };
  payment?: { symbol: string; amount: string; decimals: number; payeeLabel: string; method?: string };
  aigc?: { model: string };
  timestamp: string;
}
const receipts: RView[] = (await getJson<RView[]>(`${API}/v1/receipts?limit=500`)) ?? [];
metrics["evidence.receipts"] = String(receipts.length);
metrics["evidence.reverts"] = String(receipts.filter((r) => r.outcome === "reverted").length);
metrics["evidence.refused_offchain"] = String(receipts.filter((r) => r.outcome === "rejected_policy").length);

const e2e: Record<string, unknown>[] = [];
for (const f of readdirSync(p("apps/agent/data")).filter((x) => /^e2e-.*\.json$/.test(x))) for (const row of JSON.parse(readFileSync(p("apps/agent/data", f), "utf8")) as Record<string, unknown>[]) e2e.push(row);

// ---------------------------------------------------------------- tests
let testRuns: SuiteResult[] | undefined = TESTS ? runAllSuites(root) : prevBundle?.testRuns;
if (testRuns && !testRuns.length) testRuns = undefined;
const suite = (s: string) => testRuns?.find((r) => r.suite === s);
const passedNamed = (s: SuiteResult | undefined, re: RegExp) => (s?.tests ?? []).filter((t) => t.status === "passed" && re.test(t.name));
const failedNamed = (s: SuiteResult | undefined, re: RegExp) => (s?.tests ?? []).filter((t) => t.status === "failed" && re.test(t.name));
const countText = (r: SuiteResult) => (r.ran ? `${r.passed}${r.failed ? ` passed, ${r.failed} failed` : ""}${r.skipped ? ` (${r.skipped} skipped)` : ""}` : r.note ?? "not run");
if (testRuns) {
  for (const k of Object.keys(metrics)) if (/^(tests|invariants|verify)\./.test(k)) delete metrics[k];
  const ran = testRuns.filter((r) => r.ran);
  for (const r of testRuns) metrics[r.key] = countText(r);
  const forge = suite("forge");
  if (forge?.ran) {
    metrics["tests.contracts"] = String(forge.passed);
    metrics["tests.contracts.failed"] = String(forge.failed);
    metrics["tests.forge.nadia"] = String(passedNamed(forge, /NadiaMandateTest::/).length);
  }
  const vit = testRuns.filter((r) => r.suite.startsWith("vitest:") && r.ran);
  metrics["tests.ts"] = String(vit.reduce((a, r) => a + r.passed, 0));
  const py = suite("pytest:verify_py");
  if (py?.ran) metrics["tests.py"] = String(py.passed);
  const failed = ran.filter((r) => r.failed);
  metrics["tests.failed"] = failed.length ? `${failed.reduce((a, r) => a + r.failed, 0)} (${failed.map((r) => `${r.label}: ${r.failed}`).join("; ")})` : "0";
  metrics["tests.total"] = String(ran.reduce((a, r) => a + r.passed, 0));
  metrics["tests.suites"] = testRuns.map((r) => `${r.label}: ${countText(r)}`).join("; ");
  metrics["tests.run_at"] = TESTS ? now : (prevBundle?.metrics?.["tests.run_at"] ?? prevBundle?.generatedAt ?? "");

  // Monotonic-safety property test: counts read from the test source, result from the run.
  const agent = suite("vitest:apps/agent");
  const tiers = (agent?.tests ?? []).filter((t) => t.file === "apps/agent/test/tiers.test.ts");
  if (tiers.length) {
    const src = readFileSync(p("apps/agent/test/tiers.test.ts"), "utf8");
    const exhaustive = src.match(/expect\(cases\)\.toBe\((\d+)\)/)?.[1];
    const random = src.match(/for \(let i = 0; i < (\d+); i\+\+\)/)?.[1];
    const ok = tiers.every((t) => t.status === "passed");
    metrics["tests.monotonic.status"] = `${ok ? "passing" : "FAILING"}: ${tiers.length} property tests, exhaustive ${exhaustive ?? "?"} cases and ${random ? int(random) : "?"} random escalation chains (apps/agent/test/tiers.test.ts)`;
  }
  // Signing-domain guard tests (apps/web).
  const guard = passedNamed(suite("vitest:apps/web"), /signing-domain guard/);
  const guardFail = failedNamed(suite("vitest:apps/web"), /signing-domain guard/);
  if (guard.length || guardFail.length) metrics["tests.guard"] = `${guard.length} passed, ${guardFail.length} failed (apps/web/lib/api/contract.test.ts, "signing-domain guard")`;
}

// Invariants: from this run (or the carried-over run), else from the last recorded forge run report.
{
  const src = readFileSync(p("contracts/test/invariants/MandateInvariants.t.sol"), "utf8");
  const plan = [...src.matchAll(/\/\/\/ Invariant (\d+):[^\n]*\n\s*function (invariant_\w+)/g)].map((m) => ({ n: Number(m[1]), fn: m[2]! }));
  const toml = readFileSync(p("contracts/foundry.toml"), "utf8");
  const inv = toml.match(/\[profile\.default\.invariant\][^[]*/)?.[0] ?? "";
  const runs = inv.match(/runs\s*=\s*(\d+)/)?.[1];
  const depth = inv.match(/depth\s*=\s*(\d+)/)?.[1];
  const forge = suite("forge");
  const fuzzRep = readJson<{ campaigns?: { test: string; kind: string; status: string; calls?: number; reverts?: number; invariantsChecked?: { name: string; status: string }[] }[]; generatedAt?: string }>(p("contracts/reports/fuzz.json"));
  let campaign: { ok: boolean; source: string } | undefined;
  if (forge?.ran) {
    const t = forge.tests.filter((x) => x.name.includes("MandateInvariantsTest::invariant_"));
    if (t.length) campaign = { ok: t.every((x) => x.status === "passed"), source: "forge test in this finalize run" };
  } else if (!metrics["invariants.passing"] && fuzzRep?.campaigns) {
    const c = fuzzRep.campaigns.find((x) => x.kind === "invariant campaign");
    if (c) campaign = { ok: c.status === "Success" && (c.invariantsChecked ?? []).every((x) => x.status === "Success"), source: `contracts/reports/fuzz.json (${fuzzRep.generatedAt})` };
  }
  if (campaign && plan.length) {
    const held = campaign.ok ? plan.map((x) => x.n) : [];
    metrics["invariants.passing"] = `${held.length}/10 (invariants ${plan.map((x) => x.n).join(", ")} ${campaign.ok ? "held" : "did NOT all hold"} in one Foundry stateful-fuzz campaign of ${runs ?? "?"} runs x ${depth ?? "?"} calls; ${10 - plan.length} of the 10 have no fuzz campaign; source: ${campaign.source})`;
    const sym = readJson<{ version?: string; bounds?: { loop?: number }; properties?: { invariant: number; status: string }[] }>(p("contracts/reports/symbolic.json"));
    const unit8 = forge?.ran ? passedNamed(forge, /invariant8/i).length : 0;
    const rows: string[][] = [];
    for (let n = 1; n <= 10; n++) {
      const f = plan.find((x) => x.n === n);
      const props = (sym?.properties ?? []).filter((x) => x.invariant === n);
      rows.push([
        String(n),
        f ? `${campaign.ok ? "held" : "failed"} (\`${f.fn}\`)` : n === 8 && unit8 ? `no campaign; ${unit8} unit tests \`*invariant8*\` pass` : "no campaign",
        props.length ? `${props.filter((x) => x.status === "proved within bounds").length} of ${props.length} properties proved within bounds (${sym?.version}, loop ${sym?.bounds?.loop})` : "not run",
        "not run",
        "not run",
        "not run",
      ]);
    }
    metrics["invariants.table"] = `Foundry campaign ${runs} runs x ${depth} calls; symbolic results from contracts/reports/symbolic.json:${table(["#", "Foundry invariant fuzzing", "Halmos (bounded)", "Medusa", "Echidna", "Kontrol"], rows)}`;
  }
}

// Verifier agreement (TypeScript packages/mandate vs Python tools/verify-py) from the test runs.
if (testRuns) {
  const mand = suite("vitest:packages/mandate");
  const py = suite("pytest:verify_py");
  const golden = readdirSync(p("packages/mandate/golden")).filter((f) => f.endsWith(".json"));
  const vec = readJson<Record<string, unknown>>(p("tools/verify-py/tests/vectors/ts-vectors.json"));
  const vecCases = vec ? Object.entries(vec).filter(([k, v]) => Array.isArray(v) && k !== "deployments").reduce((a, [, v]) => a + (v as unknown[]).length, 0) : 0;
  const profiles = vec && Array.isArray(vec.deployments) ? (vec.deployments as string[]) : [];
  const pyGolden = (py?.tests ?? []).filter((t) => t.file?.endsWith("test_golden.py"));
  const pyVec = (py?.tests ?? []).filter((t) => t.file?.endsWith("test_ts_vectors.py"));
  const mandOk = !!mand?.ran && mand.failed === 0;
  const goldenOk = mandOk && pyGolden.length > 0 && pyGolden.every((t) => t.status !== "failed");
  const vecOk = pyVec.length > 0 && pyVec.every((t) => t.status !== "failed");
  if (goldenOk) metrics["verify.golden.n"] = String(golden.length);
  if (vecOk) metrics["verify.property.n"] = String(vecCases);
  if (py?.ran && mand?.ran) {
    metrics["verify.agreement"] =
      goldenOk && vecOk
        ? `agree: ${golden.length} golden files (packages/mandate vitest and ${pyGolden.length} pytest cases) and ${vecCases} cross-implementation vector cases generated by the TypeScript reference and checked by the Python verifier (${pyVec.length} pytest cases) for the ledger profiles ${profiles.join(", ")}; 0 disagreements; the base-sepolia profile is not in the shared vectors`
        : `DISAGREE or failing: golden ${goldenOk ? "ok" : "failing"}, vectors ${vecOk ? "ok" : "failing"}`;
  }
}

// ---------------------------------------------------------------- static analysis, coverage, gas, symbolic, fuzz (contracts/reports)
{
  const sl = readJson<{ version: string; detectorsRun: number; rawCountsByImpact: Record<string, number>; openAfterTriage: Record<string, number>; triage: { impact: string; verdict: string }[]; generatedAt: string }>(p("contracts/reports/slither.json"));
  if (sl) {
    const fp = (imp: string) => sl.triage.filter((t) => t.impact === imp && /false positive/i.test(t.verdict)).length;
    metrics["static.slither.high"] = `${sl.openAfterTriage.High ?? 0} (raw high ${sl.rawCountsByImpact.High ?? 0}; Slither ${sl.version}, ${sl.detectorsRun} detectors over contracts/src)`;
    metrics["static.slither.medium"] = `${sl.openAfterTriage.Medium ?? 0} (raw medium ${sl.rawCountsByImpact.Medium ?? 0}, of which ${fp("Medium")} triaged as false positives with reasons in contracts/reports/slither.json)`;
  }
  const ad = readJson<{ tool?: string; version?: string; openAfterTriage?: Record<string, number>; rawCountsByImpact?: Record<string, number> }>(p("contracts/reports/aderyn.json"));
  const adTries = readJson<{ attempt: string; result: string }[]>(p("contracts/reports/aderyn.attempts.json"));
  if (ad?.openAfterTriage) metrics["static.aderyn.high"] = `${ad.openAfterTriage.High ?? 0} (Aderyn ${ad.version})`;
  else if (adTries) metrics["static.aderyn.high"] = `not run: no Aderyn build could be produced on the evidence host (${adTries.length} attempts recorded in contracts/reports/aderyn.attempts.json)`;
  const cov = readJson<{ version: string; total: Record<string, { hit: number; found: number; pct: number }> }>(p("contracts/reports/coverage.json"));
  if (cov) {
    const t = cov.total;
    const f = (k: string) => (t[k] ? `${k} ${t[k]!.pct}% (${t[k]!.hit}/${t[k]!.found})` : "");
    metrics["coverage.contracts"] = `${["lines", "statements", "branches", "functions"].map(f).filter(Boolean).join(", ")} of contracts/src (${cov.version.replace(/^forge Version: /, "forge ")} coverage)`;
  }
  const gas = readJson<{ headline?: { median: number; p95: number; n: number }; configs?: Record<string, string> }>(p("contracts/reports/gas.json"));
  if (gas?.headline) metrics["gas.overhead.median"] = `${int(gas.headline.median)} gas per payment (p95 ${int(gas.headline.p95)}, n = ${gas.headline.n}): the sealed 15-caveat mandate vs 4 stock caveats for the same 1 tHKD transfer, paired samples a day apart (contracts/reports/gas.json)`;
  const sym = readJson<{ version: string; bounds: { loop: number; solverTimeoutAssertionMs: number }; summary: { provedWithinBounds: number; total: number; invariantsCovered: number[] }; kontrol?: string }>(p("contracts/reports/symbolic.json"));
  if (sym?.summary) {
    metrics["proofs.symbolic.status"] = `${sym.summary.provedWithinBounds} of ${sym.summary.total} properties proved within bounds for invariants ${sym.summary.invariantsCovered.join(", ")} (${sym.version}, loops unrolled to ${sym.bounds.loop}, solver timeout ${sym.bounds.solverTimeoutAssertionMs / 1000} s; enforcer hooks executed symbolically, the DelegationManager and the account are not; Kontrol ${sym.kontrol ?? "not run"})`;
  }
  const fz = readJson<{ calls?: { invariantHandlerCalls: number; invariantRuns: number; fuzzRuns: number; total: number }; settings?: Record<string, number> }>(p("contracts/reports/fuzz.json"));
  if (fz?.calls) metrics["fuzz.calls"] = `${int(fz.calls.total)} (${int(fz.calls.invariantHandlerCalls)} invariant handler calls in ${fz.calls.invariantRuns} runs, plus ${fz.calls.fuzzRuns} fuzz-test runs; contracts/reports/fuzz.json)`;
  const versions: string[] = [];
  for (const [f, label] of [["slither.json", "Slither"], ["coverage.json", "forge"], ["symbolic.json", "Halmos"]] as const) {
    const j = readJson<{ version?: string }>(p("contracts/reports", f));
    if (j?.version) versions.push(`${label}: ${j.version.replace(/^forge Version: /, "forge ")}`);
  }
  if (metrics["static.aderyn.high"]?.startsWith("not run")) versions.push("Aderyn: not run (see contracts/reports/aderyn.attempts.json)");
  if (versions.length) metrics["review.tools.versions"] = versions.join("; ");
}

// ---------------------------------------------------------------- ZK, anchoring, FISCO facts, passkeys
const zkManifest = readJson<{ gas?: Record<string, number> }>(p("circuits/MANIFEST.json"));
const zkFiles = (["fisco", "base-sepolia", "anvil"] as LedgerName[]).filter((l) => existsSync(p("apps/agent/data", `zk-${l}.json`)));
if (zkManifest) {
  metrics["zk.mode"] = zkFiles.length
    ? `live private-mandate payments with real proofs recorded in ${zkFiles.map((l) => `zk-${l}.json`).join(", ")}`
    : entry(deps.fisco, "ZKMandateEnforcer")
      ? "verifier stack deployed on FISCO BCOS and Anvil; fixture proofs verify through the router (eth_call)"
      : "built and tested";
  const g = zkManifest.gas?.["honkVerifier.verify"];
  if (g) metrics["zk.verify.gas"] = `${int(g)} gas for HonkVerifier.verify (Foundry, circuits/MANIFEST.json)`;
}
const anchorTxs: { ledger: string; txHash: string; count: number }[] = [];
let anchoredReceipts: number | undefined;
{
  const b = await getJson<{ batches: { batchId: number; count: number; anchors: { ledger: string; txHash: string }[] }[] }>(`${API}/batches`);
  if (b) {
    for (const x of b.batches) for (const a of x.anchors) anchorTxs.push({ ...a, count: x.count });
    anchoredReceipts = b.batches.reduce((n, x) => n + x.count, 0);
    metrics["evidence.anchored_receipts"] = String(anchoredReceipts);
  }
}
const facts = readJson<{ consensus?: { minSealTimeMs?: string; sealers?: string[]; observers?: string[] }; binary?: { version?: string } }>(p("infra/fisco/chain-facts.json"));
if (facts?.consensus) {
  metrics["fisco.nodes"] = `${facts.consensus.sealers?.length ?? "?"} consensus nodes (PBFT) + ${facts.consensus.observers?.length ?? 0} observer node, FISCO BCOS ${facts.binary?.version ?? "?"} standard (non-SM) build (infra/fisco/chain-facts.json)`;
  if (facts.consensus.observers?.length) metrics["fisco.regulator_node"] = "running: observer node4 (Web3 RPC 127.0.0.1:8549) serves the public read-only RPC at https://api.yinglong-agent.tech/rpc/fisco; run by the team";
}
const sealedBy = new Set(e2e.filter((r) => r.step === "seal").map((r) => String(r.sealedBy)).filter((s) => s !== "undefined"));
const webauthnSeals = receipts.filter((r) => r.outcome === "confirmed" && r.explanation.text.startsWith("Mandate sealed (passkey (WebAuthn))"));
const scriptedSeals = receipts.filter((r) => r.outcome === "confirmed" && r.explanation.text.startsWith("Mandate sealed (scripted passkey"));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
metrics["passkey.mode"] = `${plural(webauthnSeals.length, "seal")} by a WebAuthn passkey and ${scriptedSeals.length} by a scripted passkey (software P-256 key) in the live receipts${sealedBy.size ? `; ${[...sealedBy].join("; ")} in the scripted e2e runs` : ""}`;
metrics["x402.mode"] = "seller-settled through ERC-7710 permission contexts with single-use exact-amount child delegations (no third-party facilitator); tested in apps/services/test";

// ---------------------------------------------------------------- mainland reachability (--reach)
if (args.includes("--reach")) {
  try {
    const start = await fetch("https://api.globalping.io/v1/measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "http", target: "api.yinglong-agent.tech", measurementOptions: { protocol: "HTTPS", request: { method: "GET", path: "/healthz" } }, locations: [{ country: "CN" }], limit: 8 }),
    });
    const { id } = (await start.json()) as { id: string };
    let res: { status: string; results: { probe: { city: string; network: string }; result: { statusCode?: number; timings?: { total?: number } } }[] } | undefined;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      res = (await (await fetch(`https://api.globalping.io/v1/measurements/${id}`)).json()) as typeof res;
      if (res?.status === "finished") break;
    }
    if (res) {
      const ok = res.results.filter((x) => x.result.statusCode === 200);
      const ms = ok.map((x) => x.result.timings?.total ?? 0);
      metrics["reach.mainland"] = `HTTPS 200 from ${ok.length} of ${res.results.length} mainland China probes (${[...new Set(ok.map((x) => x.probe.city))].join(", ")}); median ${quantile(ms, 50) ?? "?"} ms; Globalping measurement ${id} at ${now}`;
    }
  } catch {
    /* unreachable measurement service */
  }
}

// ---------------------------------------------------------------- transactions per ledger (live receipts, scripted runs, drills)
const lk = (l: LedgerName) => (l === "base-sepolia" ? "base" : l);
const txLink = (l: LedgerName | string, h: string) => {
  const url = LEDGERS[l as LedgerName]?.explorerTx?.(h as `0x${string}`);
  return url ? `[\`${h.slice(0, 12)}...\`](${url})` : `\`${h}\``;
};
const latest = (pred: (r: RView) => boolean) => [...receipts].reverse().find((r) => !!r.txHash && pred(r));
const txByLedger: Record<string, Partial<Record<LedgerName, { hash: string; note?: string }>>> = {};
const putTx = (kind: string, l: LedgerName, hash: string | undefined, note?: string) => {
  if (!hash) return;
  (txByLedger[kind] ??= {})[l] ??= { hash, note };
};
for (const l of ["base-sepolia", "fisco"] as LedgerName[]) {
  const on = (r: RView) => r.ledger === l;
  putTx("x402", l, latest((r) => on(r) && r.outcome === "confirmed" && r.payment?.method === "x402/erc7710")?.txHash, "seller-settled x402 payment through an ERC-7710 child delegation");
  const rp = latest((r) => on(r) && r.outcome === "reverted" && r.revertError?.name === "PayeeNotVerified");
  putTx("revert_payee", l, rp?.txHash, rp?.revertError?.name);
  const seal = latest((r) => on(r) && webauthnSeals.includes(r)) ?? latest((r) => on(r) && scriptedSeals.includes(r));
  putTx("seal", l, seal?.txHash, seal ? seal.explanation.text.match(/^Mandate sealed \(([^)]*\)?)\)/)?.[1] : undefined);
  if (!seal) {
    const s = [...e2e].reverse().find((r) => r.step === "seal" && r.ledger === l && typeof r.publishTx === "string");
    putTx("seal", l, s?.publishTx as string | undefined, "scripted e2e run");
  }
  const z = readJson<{ payments?: { ok: boolean; tx: string; gasUsed: string; proveMs: number }[] }>(p("apps/agent/data", `zk-${l}.json`));
  const pay = z?.payments?.find((x) => x.ok);
  if (pay) putTx("zk", l, pay.tx, `gas ${int(pay.gasUsed)}, proof ${int(pay.proveMs)} ms`);
  const an = anchorTxs.find((a) => a.ledger === l);
  if (an) putTx("anchor", l, an.txHash, `${an.count} receipts in one Merkle root`);
}
// refusal on FISCO: the most recent typed on-chain revert other than the payee check used above
const refused = latest((r) => r.ledger === "fisco" && r.outcome === "reverted" && !!r.revertError && r.revertError.name !== "Error" && r.revertError.name !== "PayeeNotVerified") ?? latest((r) => r.ledger === "fisco" && r.outcome === "reverted");
if (refused) metrics["tx.refused.fisco"] = `${txLink("fisco", refused.txHash!)} (${refused.revertError?.name ?? "reverted"})`;
// Hong Kong re-seal of the company agent
let hk: { principal?: { ledger: LedgerName; agent?: { agentId: string } }; mandate?: { publishTx?: string } } | undefined;
let sz: typeof hk;
hk = await getJson<NonNullable<typeof hk>>(`${API}/v1/principals/lotus-hk/state`);
sz = await getJson<NonNullable<typeof hk>>(`${API}/v1/principals/lotus-sz/state`);
if (hk?.mandate?.publishTx && hk.principal) putTx("reseal_hk", hk.principal.ledger, hk.mandate.publishTx, `lotus-hk mandate for agent ${hk.principal.agent?.agentId}`);
const sameAgentHk = !!hk?.principal?.agent && hk.principal.agent.agentId === sz?.principal?.agent?.agentId;
for (const [kind, byL] of Object.entries(txByLedger)) {
  for (const [l, t] of Object.entries(byL)) metrics[`tx.${kind}.${lk(l as LedgerName)}`] = `${txLink(l, t!.hash)}${t!.note ? ` (${t!.note})` : ""}`;
  const t = byL[LIVE] ?? byL.fisco;
  const l = byL[LIVE] ? LIVE : "fisco";
  if (t) metrics[`tx.${kind}.live`] = `${txLink(l, t.hash)} on ${LEDGERS[l].badge}${t.note ? ` (${t.note})` : ""}`;
}
if (!BASE) for (const kind of ["seal", "x402", "zk", "revert_payee", "anchor", "reseal_hk"]) metrics[`tx.${kind}.base`] = NOT_ON_BASE;

// supervisor pause on FISCO (apps/agent/scripts/supervisor-pause.ts)
const sup = readJson<{ at: string; ledger: string; principal: { visitorId: string; agentId: string }; halt: { txHash: string; onChainStatus?: string }; before: { registryStatus?: string }; duringHalt: { registryStatus?: string }; paymentWhileHalted?: { tier?: string; stoppedBy?: string }; lift?: { txHash?: string } | string; after: { registryStatus?: string } }>(p("docs/evidence/drills/supervisor-pause-fisco.json"));
if (sup?.halt?.txHash) {
  const lift = typeof sup.lift === "object" && sup.lift.txHash ? `; lifted by the supervisor in ${txLink("fisco", sup.lift.txHash)}, status ${sup.after.registryStatus}` : "";
  metrics["tx.supervisor_pause.fisco"] = `${txLink("fisco", sup.halt.txHash)} (agent ${sup.principal.agentId} of fresh visitor ${sup.principal.visitorId}: passport ${sup.before.registryStatus} to ${sup.duringHalt.registryStatus}; a payment request while halted was stopped${sup.paymentWhileHalted?.stoppedBy ? ` at ${sup.paymentWhileHalted.stoppedBy}` : ""}${lift}; ${sup.at})`;
}

// ---------------------------------------------------------------- timings (docs/evidence/drills/timing-<ledger>.json)
const timingLedger = (["base-sepolia", "fisco"] as LedgerName[]).find((l) => existsSync(p("docs/evidence/drills", `timing-${l}.json`)));
type Sum = { n: number; confirmed: number; serverMs: { p50: number; p95: number }; clientMs: { p50: number; p95: number }; blocks: { p50: number } };
if (timingLedger) {
  const t = readJson<{ at: string; signer: string; pause: Sum; revoke: Sum; reseal: { n: number; ms: { p50: number } } }>(p("docs/evidence/drills", `timing-${timingLedger}.json`))!;
  metrics["time.ledger"] = LEDGERS[timingLedger].badge;
  metrics["time.method"] = `server-side times, from submitting the passkey-signed message to its transaction receipt, measured by the agent API next to the ledger; ${t.signer}; the drill client's own medians add the signature and the network round trip (pause ${secs(t.pause.clientMs.p50)} s, revoke ${secs(t.revoke.clientMs.p50)} s); docs/evidence/drills/timing-${timingLedger}.json, ${t.at}`;
  metrics["time.pause.p50"] = secs(t.pause.serverMs.p50);
  metrics["time.pause.p95"] = secs(t.pause.serverMs.p95);
  metrics["time.pause.n"] = t.pause.confirmed === t.pause.n ? String(t.pause.n) : `${t.pause.n} (${t.pause.confirmed} confirmed)`;
  metrics["time.pause.blocks_p50"] = `${t.pause.blocks.p50} block${t.pause.blocks.p50 === 1 ? "" : "s"}`;
  metrics["time.revoke.p50"] = secs(t.revoke.serverMs.p50);
  metrics["time.revoke.n"] = t.revoke.confirmed === t.revoke.n ? String(t.revoke.n) : `${t.revoke.n} (${t.revoke.confirmed} confirmed)`;
  metrics["time.rotate.p50"] = `${secs(t.reseal.ms.p50)} s to re-seal the mandate with the same agent key (n = ${t.reseal.n}, measured at the drill client; no agent-key rotation is drilled)`;
  if (timingLedger === "fisco") metrics["time.block.ledger"] = `no fixed block time: FISCO BCOS seals a block when transactions arrive (PBFT, minimum seal time ${facts?.consensus?.minSealTimeMs ?? "?"} ms per infra/fisco/chain-facts.json); median ${t.pause.blocks.p50} block from submission to inclusion`;
}
if (!BASE) metrics["time.block.base"] = "not applicable: Base Sepolia not deployed";

// ---------------------------------------------------------------- incident-response drills (docs/evidence/drills/pbN.json)
for (let n = 1; n <= 5; n++) {
  const f = p("docs/evidence/drills", `pb${n}.json`);
  const d = readJson<{ drillId: string; ledger: string; t0: string; principal: { visitorId: string; sealedBy: string }; timesMs: Record<string, number | null>; transactions: Record<string, string | undefined>; notify?: string; rotate?: string; exposure?: { actualLoss: string; remainingCapsAtT0: Record<string, string>; attemptedAmount: string; asset: string } }>(f);
  const keys = ["detect", "pause", "revoke", "rotate", "notify", "evidence"];
  if (!d) {
    metrics[`ir.pb${n}.drill`] = "not drilled";
    for (const k of keys) metrics[`ir.pb${n}.${k}`] = "not drilled";
    continue;
  }
  const L = d.ledger as LedgerName;
  const at = (ms: number | null | undefined) => (ms === null || ms === undefined ? undefined : `+${secs(ms)} s`);
  metrics[`ir.pb${n}.drill`] = `${d.drillId} on ${LEDGERS[L]?.badge ?? d.ledger}: fresh visitor principal ${d.principal.visitorId} (${d.principal.sealedBy}), times from t0 = the leaked-key attack (${basename(f)})`;
  metrics[`ir.pb${n}.detect`] = `${at(d.timesMs.detect)} (watcher saw the on-chain revert ${d.transactions.attackRevert ? txLink(L, d.transactions.attackRevert) : ""})`;
  metrics[`ir.pb${n}.pause`] = `${at(d.timesMs.pause)} (${d.transactions.pause ? txLink(L, d.transactions.pause) : "no tx"})`;
  metrics[`ir.pb${n}.revoke`] = `${at(d.timesMs.revoke)} (user operation ${d.transactions.revoke ? txLink(L, d.transactions.revoke) : "no tx"})`;
  metrics[`ir.pb${n}.rotate`] = `${at(d.timesMs.rotate)} (re-seal with the same passkey ${d.transactions.reseal ? txLink(L, d.transactions.reseal) : ""}, then resume ${d.transactions.resume ? txLink(L, d.transactions.resume) : ""}; the agent key itself is not rotated in this drill)`;
  metrics[`ir.pb${n}.notify`] = d.timesMs.notify === null ? "not automated" : (at(d.timesMs.notify) ?? "not automated");
  const shaFile = p("docs/evidence/drills", `pb${n}.sha256`);
  if (existsSync(shaFile)) {
    const s = readFileSync(shaFile, "utf8");
    const want = s.split(/\s+/)[0]!;
    const ms = Number(s.match(/at \+(\d+) ms/)?.[1]);
    const ok = sha256File(f) === want;
    metrics[`ir.pb${n}.evidence`] = `${at(ms)} (pb${n}.json SHA-256 \`${want}\`${ok ? ", verified at generation" : ", DOES NOT MATCH the file at generation"})`;
  }
  if (d.exposure) metrics[`ir.pb${n}.exposure`] = `actual loss ${d.exposure.actualLoss} vs max at risk ${Object.entries(d.exposure.remainingCapsAtT0).map(([k, v]) => `${v} ${k}`).join(", ")} (base units, remaining period caps at t0); attempted ${d.exposure.attemptedAmount} ${d.exposure.asset}`;
}

// ---------------------------------------------------------------- deployer roles, challenge gas, seal account owner (read-only RPC)
let roleScan: Awaited<ReturnType<typeof scanDeployerRoles>> | undefined;
if (deps.fisco) {
  try {
    roleScan = await scanDeployerRoles(rpc, "fisco", deps.fisco);
    metrics["deploy.deployer_roles"] = roleScan.held.length
      ? `${roleScan.held.length} roles still held by the deployer key ${roleScan.deployers.map((a) => `\`${a}\``).join(", ")} on FISCO BCOS: ${roleScan.held.join(", ")} (scan of ${roleScan.contracts} contracts, ${roleScan.getterCalls} getter calls, block ${roleScan.block}); Base Sepolia not deployed`
      : `none (scan of ${roleScan.contracts} contracts on FISCO BCOS, ${roleScan.getterCalls} getter calls, block ${roleScan.block})`;
    const dmOwner = roleScan.other.find((o) => o.contract === "DelegationManager" && o.getter === "owner()");
    if (dmOwner) metrics["fisco.dm.owner"] = `\`${dmOwner.holder}\` (single key; also ${roleScan.other.filter((o) => o.holder === dmOwner.holder && o.contract !== "DelegationManager").map((o) => `${o.contract}.${o.getter}`).join(", ")})`;
  } catch (e) {
    console.warn(`finalize: deployer role scan failed: ${(e as Error).message}`);
  }
}
{
  const src = readFileSync(p("apps/agent/src/challenge.ts"), "utf8");
  const perDay = Number(src.match(/CHALLENGE_PER_DAY \?\? (\d+)/)?.[1]);
  const bypassPerDay = Number(src.match(/CHALLENGE_BYPASS_PER_DAY \?\? (\d+)/)?.[1]);
  const guestTx = receipts.filter((r) => r.principal === "guest" && r.ledger === "fisco" && r.txHash);
  const attacks = guestTx.filter((r) => r.outcome === "reverted");
  if (attacks.length && bypassPerDay) {
    try {
      const g = (await gasUsed(rpc, attacks.map((r) => r.txHash!))).filter((x): x is bigint => x !== undefined);
      if (g.length) {
        const max = g.reduce((a, b) => (a > b ? a : b));
        const med = quantile(g.map(Number), 50)!;
        metrics["challenge.gas_budget"] = `${int(BigInt(bypassPerDay) * max)} gas per day on FISCO BCOS = ${bypassPerDay} on-chain attack submissions per day (CHALLENGE_BYPASS_PER_DAY default in apps/agent/src/challenge.ts) x ${int(max)} gas, the largest measured guest attack (median ${int(med)}, n = ${g.length}); gas price on the team-run chain is 0; plus ${perDay} attempts per client IP per day`;
      }
    } catch {
      /* RPC unreachable */
    }
  }
}
let sealOwner: string | undefined;
let sealAccount: string | undefined;
{
  const s = txByLedger.seal?.[LIVE] ?? txByLedger.seal?.fisco;
  const r = s ? receipts.find((x) => x.txHash === s.hash) : undefined;
  if (r) {
    try {
      const st = (await getJson<{ principal?: { account: Address } }>(`${API}/v1/principals/${r.principal}/state`)) ?? {};
      sealAccount = st.principal?.account;
      if (sealAccount) sealOwner = await accountOwner(rpc, getAddress(sealAccount));
    } catch {
      /* skip */
    }
  }
}

// ---------------------------------------------------------------- signing guard, compliance paths, scrubber
{
  const g = readFileSync(p("apps/web/lib/signing-guard.ts"), "utf8");
  const body = g.match(/ALLOWED_PRIMARY_TYPES\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1];
  if (body) {
    const kinds = [...body.matchAll(/"([A-Za-z0-9]+)"/g)].map((m) => m[1]!);
    metrics["guard.allowlist.count"] = String(kinds.length);
    metrics["guard.allowlist.names"] = kinds.join(", ");
  }
}
{
  const cm = readFileSync(p("docs/COMPLIANCE_MATRIX.md"), "utf8");
  const cited = [...new Set([...cm.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]!))];
  const paths = cited.filter((t) => /^[A-Za-z0-9_.-]+\//.test(t) && !t.startsWith("/"));
  const contracts = cited.filter((t) => /^[A-Z][A-Za-z0-9]+(Registry|Enforcer|Ledger|Instructions|Book|Payment|Settlement)$/.test(t));
  const solFiles: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(resolve(d, e.name)) : e.name.endsWith(".sol") && solFiles.push(e.name.replace(/\.sol$/, ""));
  };
  walk(p("contracts/src"));
  const findByBase = (b: string) => {
    const hits: string[] = [];
    const w = (d: string, rel: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "lib") continue;
        if (e.isDirectory()) w(resolve(d, e.name), `${rel}${e.name}/`);
        else if (e.name.replace(/\.[^.]+$/, "") === b) hits.push(`${rel}${e.name}`);
      }
    };
    for (const top of ["apps", "packages", "tools", "scripts"]) if (existsSync(p(top))) w(p(top), `${top}/`);
    return hits;
  };
  const missing = paths.filter((x) => !existsSync(p(x.replace(/\/$/, ""))));
  const missingC = contracts.filter((c) => !solFiles.includes(c));
  const all = [...missing.map((m) => `\`${m}\`${(() => {
    const h = findByBase(basename(m));
    return h.length ? ` (found as ${h.map((x) => `\`${x}\``).join(", ")})` : "";
  })()}`), ...missingC.map((c) => `\`${c}\` (no contracts/src/**/${c}.sol)`)];
  metrics["compliance.paths_missing"] = `${all.length} of ${paths.length + contracts.length} cited repository paths and contract names missing${all.length ? `: ${all.join(", ")}` : ""}`;
}
{
  const s = readJson<{ n: number; detected: number; perKind: Record<string, { n: number; detected: number; missedFormats: string[] }>; negatives: { n: number; falsePositives: string[] } }>(p("docs/evidence/scrubber-recall.json"));
  if (s) {
    const missed = Object.entries(s.perKind).flatMap(([k, v]) => v.missedFormats.map((f) => `${k} ${f}`));
    metrics["pia.scrubber.recall"] = `${rate(s.detected, s.n)} on a labelled synthetic set; by kind: ${Object.entries(s.perKind).map(([k, v]) => `${k} ${v.detected}/${v.n}`).join(", ")}${missed.length ? `; formats missed: ${missed.join("; ")}` : ""}; false positives on ${s.negatives.falsePositives.length} of ${s.negatives.n} benign strings${s.negatives.falsePositives.length ? ` (${[...new Set(s.negatives.falsePositives)].join("; ")})` : ""} (apps/agent/test/scrubber.test.ts)`;
  }
}

// ---------------------------------------------------------------- SBOM and third-party register
{
  const sb = writeSbom(root, p("docs/evidence/sbom.cdx.json"));
  if ("sha256" in sb) metrics["sbom.sha256"] = `\`${sb.sha256}\` (docs/evidence/sbom.cdx.json, ${sb.components} components; ${sb.tools}${sb.replaced ? `; ${sb.replaced} characters outside the English-only rule replaced` : ""})`;
  else console.warn(`finalize: SBOM not written: ${sb.error}`);
  set("thirdparty.npm.table", npmTable(root).md);
  set("thirdparty.python.table", pythonTable(root).md);
  set("thirdparty.models.table", modelsTable(root));
  set("thirdparty.datasets.table", datasetsTable(root));
  set("thirdparty.private_datasets.table", privateDatasetsTable(root));
}

// ---------------------------------------------------------------- bench and sentinel
{
  const heldFile = p("bench/HELDOUT_SHA256.txt");
  const man = readJson<{ attack_counts?: Record<string, number>; heldout_family?: string; attacks_total?: number }>(p("bench/MANIFEST.json"));
  if (existsSync(heldFile)) {
    const [want, file] = readFileSync(heldFile, "utf8").split(/\s+/);
    const actual = file && existsSync(p("bench", file)) ? sha256File(p("bench", file)) : undefined;
    const items = man?.heldout_family ? man.attack_counts?.[man.heldout_family] : undefined;
    metrics["bench.heldout.sha256"] = `\`${want}\` (${man?.heldout_family ?? "held-out family"}${items ? `, ${items} items` : ""}, bench/${file}; ${actual === want ? "recomputed at generation: matches" : `recomputed at generation: DIFFERS (${actual})`})`;
  }
  const benchReports = existsSync(p("bench/reports")) ? readdirSync(p("bench/reports")).filter((f) => f.endsWith(".json")) : [];
  if (man?.attack_counts && !benchReports.length) {
    metrics["bench.family_table"] = `Items generated per family (bench/MANIFEST.json); no bench run results exist in this release, so outcome and intervals are not measured:${table(
      ["Family", "Items", "Held out", "Outcome"],
      Object.entries(man.attack_counts).map(([f, n]) => [`\`${f}\``, n, f === man.heldout_family ? "yes" : "no", "not run"]),
    )}`;
  }
  const sent = readJson<{ hf_repo?: string; hf_revision?: string; at_selected_threshold?: { threshold: number; bench_heldout_family?: { n: number; positives: number; recall: number } } }>(p("ml/results/m1_sentinel_mmbert.json"));
  const h = sent?.at_selected_threshold?.bench_heldout_family;
  if (h && h.positives) {
    const detected = Math.round(h.recall * h.positives);
    const missed = h.positives - detected;
    const [lo, hi] = wilson(missed, h.positives);
    let live = "";
    const hl = await getJson<{ models?: { sentinel?: { url?: boolean } } }>(`${API}/v1/health`);
    live = !hl ? "live deployment state not read" : hl.models?.sentinel?.url ? "the live agent reports a sentinel URL configured" : "not deployed: the live agent reports no sentinel URL configured";
    metrics["sentinel.fnr"] = `${missed}/${h.positives} = ${pct(missed / h.positives)} (Wilson 95% interval ${pct(lo)} to ${pct(hi)}) on the held-out bench family, offline evaluation of \`${sent!.hf_repo}@${sent!.hf_revision?.slice(0, 7)}\` at its validation-selected threshold ${sent!.at_selected_threshold!.threshold} (ml/results/m1_sentinel_mmbert.json); ${live}`;
  }
}

// ---------------------------------------------------------------- controls (docs/evidence/controls.json + test results)
interface ControlMap {
  controls: { id: string; paths: string[]; tests: { file: string; match?: string }[]; note?: string }[];
}
const controlRows: { id: string; status: string; evidence: string; tests: string; note: string }[] = [];
{
  const cm = readJson<ControlMap>(p("docs/evidence/controls.json"));
  const sa = readFileSync(p("docs/SECURITY_SELF_ASSESSMENT.md"), "utf8");
  const ids = [...new Set([...sa.matchAll(/^\| (C-[A-Z]{2}-\d{2}) \|/gm)].map((m) => m[1]!))];
  const suiteOf = (file: string) => {
    if (file.startsWith("contracts/test/")) return "forge";
    if (file.startsWith("tools/verify-py/")) return "pytest:verify_py";
    if (file.startsWith("circuits/prover/")) return "node:prover";
    if (file.startsWith("apps/web/tests/")) return "playwright";
    const m = file.match(/^((?:apps|packages)\/[^/]+)\//);
    return m ? `vitest:${m[1]}` : "";
  };
  for (const id of ids) {
    const c = cm?.controls.find((x) => x.id === id);
    if (!c) {
      controlRows.push({ id, status: "designed", evidence: "-", tests: "-", note: "not mapped in docs/evidence/controls.json" });
      continue;
    }
    const pathsOk = c.paths.length > 0 && c.paths.every((x) => existsSync(p(x)));
    const testResults = c.tests.map((t) => {
      const s = suite(suiteOf(t.file));
      if (!existsSync(p(t.file))) return { t, ok: false, why: "missing file" };
      if (!s?.ran) return { t, ok: false, why: "suite not run" };
      const inFile = s.tests.filter((x) => (x.file ?? "").replace(/\\/g, "/").includes(t.file) || (s.suite === "forge" && x.name.startsWith(t.file.replace(/^contracts\//, ""))));
      const scope = inFile.length ? inFile : s.tests;
      const re = t.match ? new RegExp(t.match) : undefined;
      const hit = scope.filter((x) => !re || re.test(x.name));
      const ok = hit.some((x) => x.status === "passed") && !hit.some((x) => x.status === "failed");
      return { t, ok, why: ok ? "" : hit.length ? "failing" : "no matching test" };
    });
    const tested = pathsOk && testResults.some((r) => r.ok);
    const status = tested ? "tested" : pathsOk ? "implemented" : "designed";
    const missingPaths = c.paths.filter((x) => !existsSync(p(x)));
    controlRows.push({
      id,
      status,
      evidence: c.paths.length ? c.paths.map((x) => `\`${x}\``).join(", ") + (missingPaths.length ? ` (missing: ${missingPaths.join(", ")})` : "") : "-",
      tests: c.tests.length ? testResults.map((r) => `\`${r.t.file}\`${r.t.match ? ` /${r.t.match}/` : ""}: ${r.ok ? "pass" : r.why}`).join("; ") : "-",
      note: c.note ?? "",
    });
  }
  const n = (s: string) => controlRows.filter((r) => r.status === s).length;
  metrics["controls.total"] = String(controlRows.length);
  metrics["controls.implemented"] = `${n("tested") + n("implemented")} (${n("tested")} of them tested)`;
  metrics["controls.status_table"] = `Status derived at generation from docs/evidence/controls.json (paths checked for existence, tests against the most recent test run${metrics["tests.run_at"] ? ` at ${metrics["tests.run_at"]}` : ""}): tested ${n("tested")}, implemented ${n("implemented")}, designed ${n("designed")}, not started ${n("not started")}.${table(
    ["Control", "Status", "Evidence path", "Tests", "Note"],
    controlRows.map((r) => [r.id, r.status, r.evidence, r.tests, r.note]),
  )}`;
}

// ---------------------------------------------------------------- internal review record (docs/evidence/review.json)
{
  const rv = readJson<{ commit: string; date: string; tools?: { name: string; version: string }[]; findings: { id: string; title: string; severity: string; component: string; status: string; fixCommit?: string; description?: string; impact?: string; recommendation?: string; resolution?: string; wontfixReason?: string }[] }>(p("docs/evidence/review.json"));
  if (rv) {
    metrics["review.commit"] = rv.commit;
    metrics["review.date"] = rv.date;
    if (rv.tools?.length) metrics["review.tools.versions"] = rv.tools.map((t) => `${t.name} ${t.version}`).join("; ");
    for (const s of ["critical", "high", "medium", "low", "info"]) metrics[`review.count.${s}`] = String(rv.findings.filter((f) => f.severity === s).length);
    const by = (s: string) => rv.findings.filter((f) => f.status === s);
    metrics["review.fixed"] = `${by("fixed").length}${by("fixed").length ? ` (${by("fixed").map((f) => `${f.id}${f.fixCommit ? ` in \`${f.fixCommit.slice(0, 10)}\`` : ""}`).join(", ")})` : ""}`;
    metrics["review.open"] = `${by("open").length}${by("open").length ? ` (${by("open").map((f) => f.id).join(", ")})` : ""}`;
    metrics["review.wontfix"] = String(by("wontfix").length);
    metrics["review.findings.table"] = rv.findings.length ? table(["ID", "Title", "Severity", "Component", "Status", "Fix commit"], rv.findings.map((f) => [f.id, f.title, f.severity, f.component, f.status, f.fixCommit ? `\`${f.fixCommit.slice(0, 10)}\`` : "-"])) : "no findings recorded";
    const nl = String.fromCharCode(10);
    metrics["review.findings.details"] = rv.findings.length
      ? nl + rv.findings.map((f) => [`**${f.id}. ${f.title}** (${f.severity}, ${f.status})`, "", `- Description: ${f.description ?? "-"}`, `- Impact: ${f.impact ?? "-"}`, `- Recommendation: ${f.recommendation ?? "-"}`, `- Resolution: ${f.resolution ?? "-"}`, ""].join(nl)).join(nl)
      : "no findings recorded";
    metrics["review.wontfix.table"] = by("wontfix").length ? table(["ID", "Title", "Severity", "Reason"], by("wontfix").map((f) => [f.id, f.title, f.severity, f.wontfixReason ?? "-"])) : "none";
  }
}

// ---------------------------------------------------------------- release manifest (video link)
{
  const rel = readJson<{ video60s?: string }>(p("docs/evidence/release.json"));
  if (rel?.video60s) metrics["links.video_60s"] = rel.video60s;
}

// ---------------------------------------------------------------- distinct live transaction hashes
const liveTx = new Set<string>();
for (const r of receipts) if (r.txHash && r.ledger !== "anvil") liveTx.add(r.txHash.toLowerCase());
for (const r of e2e) if (r.ledger !== "anvil") for (const k of ["tx", "publishTx"]) if (typeof r[k] === "string") liveTx.add(String(r[k]).toLowerCase());
for (const l of ["fisco", "base-sepolia"] as LedgerName[]) {
  const z = readJson<{ payments?: { tx?: string }[]; forged?: { tx?: string }; replayed?: { tx?: string }; publishTx?: string; sealTx?: string }>(p("apps/agent/data", `zk-${l}.json`));
  if (!z) continue;
  for (const t of [...(z.payments ?? []).map((x) => x.tx), z.forged?.tx, z.replayed?.tx, z.publishTx, z.sealTx]) if (typeof t === "string") liveTx.add(t.toLowerCase());
}
for (const a of anchorTxs) liveTx.add(a.txHash.toLowerCase());
const drillTxs: { what: string; ledger: string; tx: string }[] = [];
{
  const pb1 = readJson<{ ledger: string; transactions: Record<string, string | undefined> }>(p("docs/evidence/drills/pb1.json"));
  for (const [k, v] of Object.entries(pb1?.transactions ?? {})) if (v) drillTxs.push({ what: `incident drill playbook 1: ${k}`, ledger: pb1!.ledger, tx: v });
  if (sup?.halt?.txHash) drillTxs.push({ what: "supervisor pause (halt)", ledger: sup.ledger, tx: sup.halt.txHash });
  if (sup && typeof sup.lift === "object" && sup.lift.txHash) drillTxs.push({ what: "supervisor pause lifted", ledger: sup.ledger, tx: sup.lift.txHash });
}
for (const d of drillTxs) if (d.ledger !== "anvil") liveTx.add(d.tx.toLowerCase());
metrics["evidence.tx_count"] = String(liveTx.size);

// ---------------------------------------------------------------- claim wording decisions
// A team working file kept outside the repository: with CLAIMS_DIR set, the decisions computed from the
// evidence are written to CLAIMS_DIR/claims-decisions.json; they are not part of the public bundle.
const CLAIMS_DIR = process.env.CLAIMS_DIR;
if (CLAIMS_DIR) {
  const input = readJson<{ decisions?: Record<string, { decision: string; reason: string }> }>(resolve(CLAIMS_DIR, "claims-input.json"));
  const dec: Record<string, string> = {};
  const has = (k: string) => metrics[k] !== undefined;
  const notBase = BASE ? "" : "; Base Sepolia not deployed";

  // CL-01 identical enforcer bytecode
  const allEnfEq = !!enfEq && enfEq.total > 0 && enfEq.same === enfEq.total;
  if (!dm) dec["CL-01"] = "B2: DelegationManager not deployed on FISCO BCOS";
  else if (BASE) dec["CL-01"] = allEnfEq ? `A: ${enfEq!.same} of ${enfEq!.total} enforcers identical on Base Sepolia and FISCO BCOS` : `B1: ${enfEq?.same} of ${enfEq?.total} identical; differ: ${enfEq?.differ.join(", ")}`;
  else dec["CL-01"] = allEnfEq ? `F: measured Anvil vs FISCO BCOS, ${enfEq!.same} of ${enfEq!.total} YINGLONG enforcers identical${fiscoLive.length && fiscoLiveOk ? " (FISCO hashes re-read live)" : ""}${notBase}` : `B1: measured Anvil vs FISCO BCOS, ${enfEq?.same} of ${enfEq?.total} identical${notBase}`;

  // CL-03 passkey-sealed mandates
  const sealL = txByLedger.seal?.[LIVE] ? LIVE : txByLedger.seal?.fisco ? "fisco" : undefined;
  const ownerZero = sealOwner !== undefined && BigInt(sealOwner) === 0n;
  if (sealL === "base-sepolia" && webauthnSeals.some((r) => r.ledger === "base-sepolia") && ownerZero) dec["CL-03"] = "A: WebAuthn seal on Base Sepolia on an account with owner() = address(0)";
  else if (sealL === "fisco" && ownerZero) dec["CL-03"] = `F: P-256 passkey seal on FISCO BCOS on an account with owner() = address(0) (read live); ${plural(webauthnSeals.filter((r) => r.ledger === "fisco").length, "WebAuthn seal")} and ${plural(scriptedSeals.filter((r) => r.ledger === "fisco").length, "scripted-passkey seal")} in the live receipts${notBase}`;
  else dec["CL-03"] = `B: no passkey seal with a verified owner-less account found${notBase}`;

  // CL-04 x402 through ERC-7710 (seller-settled in this build)
  if (txByLedger.x402?.["base-sepolia"]) dec["CL-04"] = "B1: seller-settled x402 settlement on Base Sepolia (no third-party facilitator)";
  else if (txByLedger.x402?.fisco) dec["CL-04"] = `B1-F: seller-settled x402 settlement through an ERC-7710 child delegation on FISCO BCOS (no third-party facilitator)${notBase}`;
  else dec["CL-04"] = "B2: no ERC-7710 x402 settlement recorded";

  // CL-05 stateful ZK private mandate; invariant 8 by the Foundry unit tests
  const inv8 = passedNamed(suite("forge"), /invariant8/i).length;
  const inv8Fail = failedNamed(suite("forge"), /invariant8/i).length;
  const zkL = txByLedger.zk?.["base-sepolia"] ? "base-sepolia" : txByLedger.zk?.fisco ? "fisco" : undefined;
  if (zkL && inv8 && !inv8Fail) dec["CL-05"] = `${zkL === "base-sepolia" ? "A" : "A-F"}: ZK-enforced payments with the running commitment on ${LEDGERS[zkL].label}; invariant 8 by ${inv8} passing Foundry unit tests (no fuzz campaign)${zkL === "fisco" ? notBase : ""}`;
  else if (zkL) dec["CL-05"] = `B1: ZK payments recorded on ${LEDGERS[zkL].label} but invariant 8 tests ${testRuns ? "not passing" : "not run"}`;
  else dec["CL-05"] = "B2: no ZK-enforced payment recorded on a live ledger";

  // CL-06 two verifiers agree
  dec["CL-06"] = metrics["verify.agreement"]?.startsWith("agree") ? `A: TypeScript and Python verifiers agree on ${metrics["verify.golden.n"]} golden files and ${metrics["verify.property.n"]} vector cases (ledger profiles anvil and fisco; base-sepolia not in the shared vectors)` : "B: agreement not measured in the most recent test run";

  // CL-07 regulator node and supervisor pause
  if (metrics["fisco.regulator_node"]?.startsWith("running") && sup?.halt?.txHash) dec["CL-07"] = `A-F: team-run observer node plays the regulator node; supervisor pause on FISCO BCOS recorded; receipts anchored on FISCO BCOS only${notBase}`;
  else dec["CL-07"] = "B: no separate regulator node or no supervisor pause recorded";

  // CL-08 time-to-pause
  const tp = timingLedger ? readJson<{ pause: Sum; revoke: Sum }>(p("docs/evidence/drills", `timing-${timingLedger}.json`)) : undefined;
  if (tp && tp.pause.confirmed >= 5) dec["CL-08"] = `A: ${tp.pause.confirmed} confirmed pause runs on ${LEDGERS[timingLedger!].label} (at least 5), inclusion blocks recorded per run; "in the next block" allowed (median ${tp.pause.blocks.p50} block)${timingLedger === "fisco" ? notBase : ""}`;
  else if (metrics["ir.pb1.pause"]?.startsWith("+")) dec["CL-08"] = "B: fewer than five timed pause runs; drill time used";
  else dec["CL-08"] = "withheld: no pause timing measured";

  // CL-09 signing-domain guard
  const guardSrc = existsSync(p("apps/web/lib/api/contract.test.ts")) ? readFileSync(p("apps/web/lib/api/contract.test.ts"), "utf8") : "";
  const refusedTypes = { "EIP-3009": /TransferWithAuthorization/, Permit: /"Permit"/, Permit2: /PermitSingle|PermitBatch/, personal_sign: /personal_sign/ };
  const uncovered = Object.entries(refusedTypes).filter(([, re]) => !re.test(guardSrc)).map(([k]) => k);
  const guardOk = /^\d+ passed, 0 failed/.test(metrics["tests.guard"] ?? "");
  if (guardOk && has("guard.allowlist.count") && !uncovered.length) dec["CL-09"] = `A: guard tests pass for every refused type; allowlist of ${metrics["guard.allowlist.count"]} kinds`;
  else if (guardOk) dec["CL-09"] = `B: guard tests pass (${metrics["tests.guard"]}) but ${uncovered.join(", ")} ${uncovered.length === 1 ? "has" : "have"} no dedicated refusal test`;
  else dec["CL-09"] = "B: guard tests not passing in the most recent run";

  // CL-10 tests, invariants and proofs
  dec["CL-10"] = metrics["proofs.symbolic.status"] && /proved within bounds/.test(metrics["proofs.symbolic.status"]) && !/^0 of/.test(metrics["proofs.symbolic.status"]) ? "A: bounded symbolic execution completed (Halmos)" : "B: no symbolic proof completed";

  // CL-11 real transaction hashes, including reverts
  const reverts = receipts.filter((r) => r.outcome === "reverted" && r.ledger !== "anvil");
  if (BASE && receipts.some((r) => r.ledger === "base-sepolia" && r.outcome === "reverted") && reverts.some((r) => r.ledger === "fisco")) dec["CL-11"] = "A: reverts recorded on Base Sepolia and FISCO BCOS";
  else if (reverts.some((r) => r.ledger === "fisco")) dec["CL-11"] = `F: ${metrics["evidence.tx_count"] ?? "?"} live transaction hashes on FISCO BCOS only, ${reverts.filter((r) => r.ledger === "fisco").length} typed reverts${notBase}`;
  else dec["CL-11"] = "withheld: no reverted transaction recorded";

  // CL-02, CL-12, CL-15 bench
  const benchRun = existsSync(p("bench/reports")) && readdirSync(p("bench/reports")).some((f) => f.endsWith(".json"));
  dec["CL-02"] = benchRun && has("bench.oom.count") ? (metrics["bench.oom.count"]!.startsWith("0") ? "A: zero out-of-mandate movements" : "B: movement observed") : "withheld: no bench run results in this release (bench/reports absent); the 300-item attack set exists but has not been run";
  dec["CL-12"] = has("bench.wmm.rate") ? "A: within-mandate manipulation rate measured" : "B: rate not measured; bounded by the remaining caps by construction";
  dec["CL-15"] = has("bench.baselines.table") ? "A: baselines measured" : "withheld: no baseline runs in this release";

  // CL-13 Hong Kong re-seal of the same agent
  const hkL = hk?.principal?.ledger;
  if (txByLedger.reseal_hk && hkL && sameAgentHk) dec["CL-13"] = `${hkL === "base-sepolia" ? "A" : "A-F"}: lotus-hk mandate sealed for the same agent identity (agentId ${hk!.principal!.agent!.agentId}, as lotus-sz) on ${LEDGERS[hkL].label}${hkL === "fisco" ? notBase : ""}`;
  else dec["CL-13"] = "B: no Hong Kong re-seal of the same agent found on a live ledger";

  // CL-14 more ledgers
  dec["CL-14"] = BASE && allEnfEq && liveLedgers.length >= 3 ? "A: identical enforcer bytecode on three or more ledgers" : "B: two ledgers compared; CL-01 wording only";
  dec["CL-16"] = "A: wording A and B are the same; no condition";
  for (const id of ["CL-17", "CL-18"]) {
    const d = input?.decisions?.[id];
    dec[id] = d ? `${d.decision}: ${d.reason}` : "B: no decision recorded";
  }
  // CL-19 time-to-revoke
  if (tp && tp.revoke.confirmed >= 5) dec["CL-19"] = `A: ${tp.revoke.confirmed} confirmed revoke runs (one user operation each) on ${LEDGERS[timingLedger!].label}${timingLedger === "fisco" ? notBase : ""}`;
  else if (metrics["ir.pb1.revoke"]?.startsWith("+")) dec["CL-19"] = "B: drill time used";
  else dec["CL-19"] = "withheld: no revoke timing measured";
  // HL headline
  const code = (id: string) => dec[id]!.split(":")[0]!;
  if (code("CL-01") === "B2") dec.HL = "B: CL-01 is B2";
  else if (code("CL-01") === "A" && code("CL-03") === "A" && code("CL-06") === "A") dec.HL = "A: CL-01, CL-03 and CL-06 are A";
  else if (code("CL-01") === "F" && ["A", "F"].includes(code("CL-03")) && code("CL-06") === "A") dec.HL = `F: CL-01 ${code("CL-01")}, CL-03 ${code("CL-03")}, CL-06 ${code("CL-06")}${notBase}`;
  else dec.HL = `B: CL-01 ${code("CL-01")}, CL-03 ${code("CL-03")}, CL-06 ${code("CL-06")}`;
  writeFileSync(resolve(CLAIMS_DIR, "claims-decisions.json"), JSON.stringify(dec, null, 2) + "\n");
}

// ---------------------------------------------------------------- write EXECUTION_EVIDENCE.md
const nl = String.fromCharCode(10);
const fmtAmount = (r: RView) => (r.payment ? `${(Number(BigInt(r.payment.amount)) / 10 ** r.payment.decimals).toLocaleString("en-US")} ${r.payment.symbol} to ${r.payment.payeeLabel}` : "");
const link = (r: { ledger: string; txHash?: string; explorerUrl?: string }) => {
  if (!r.txHash) return "none (refused before signing)";
  const url = LEDGERS[r.ledger as LedgerName]?.explorerTx?.(r.txHash as `0x${string}`) ?? r.explorerUrl;
  return url ? `[\`${r.txHash.slice(0, 12)}...\`](${url})` : `\`${r.txHash}\``;
};
const rows = receipts
  .filter((r) => r.ledger !== "anvil")
  .map((r) => `| ${r.timestamp.slice(0, 19)}Z | ${r.principal} | ${LEDGERS[r.ledger]?.badge ?? r.ledger} | ${r.tier} | ${r.outcome}${r.revertError ? ` (${r.revertError.name})` : ""} | ${fmtAmount(r)} | ${link(r)} | ${r.aigc?.model ?? ""} |`);
const e2eRows = e2e
  .filter((r) => typeof r.tx === "string" || typeof r.publishTx === "string")
  .map((r) => `| ${r.ledger} | ${String(r.step)} | ${r.ok === false ? "reverted" : "ok"}${r.revert ? ` (${String(r.revert)})` : ""} | \`${String(r.tx ?? r.publishTx)}\` |`);
mkdirSync(p("docs/evidence"), { recursive: true });
const write = (f: string, s: string) => {
  const { text, replaced } = englishOnly(s);
  if (replaced) console.warn(`finalize: replaced ${replaced} characters outside the English-only rule in ${f}`);
  writeFileSync(f, text);
};
write(
  p("docs/EXECUTION_EVIDENCE.md"),
  [
    "# Execution evidence",
    "",
    `Generated by \`apps/agent/scripts/finalize.ts\` at ${now} from commit \`${metrics["meta.commit"]}\`. Do not edit by hand.`,
    "",
    "Every row is a real transaction or a recorded refusal. FISCO BCOS is a team-run consortium ledger (KR-04); its hashes are checkable with `yinglong verify-tx <hash> --chain fisco` and through the read-only RPC. All amounts are test units with no monetary value.",
    "",
    "## Agent actions (live API receipts)",
    "",
    "| Time (UTC) | Principal | Ledger | Tier | Outcome | Payment | Transaction | Executor model |",
    "|---|---|---|---|---|---|---|---|",
    ...(rows.length ? rows : ["| - | - | - | - | no live receipts were reachable at generation time | - | - | - |"]),
    "",
    "## Scripted end-to-end runs (apps/agent/scripts/e2e.ts)",
    "",
    "| Ledger | Step | Result | Transaction |",
    "|---|---|---|---|",
    ...e2eRows,
    "",
    "## Drills (apps/agent/scripts/ir-drill.ts, supervisor-pause.ts, drills.ts)",
    "",
    "| What | Ledger | Transaction |",
    "|---|---|---|",
    ...drillTxs.map((d) => `| ${d.what} | ${LEDGERS[d.ledger as LedgerName]?.badge ?? d.ledger} | ${txLink(d.ledger, d.tx)} |`),
    "",
    "## Contracts and code hashes",
    "",
    `Bytecode equality (${metrics["chain.bytecode.pair"] ?? "n/a"}): ${metrics["chain.bytecode.equal"] ?? "?"} of ${metrics["chain.bytecode.total"] ?? "?"} contracts identical; different: ${metrics["chain.bytecode.differ"] ?? "n/a"} (framework contracts with deployment-time immutables: chain id, domain separator, linked addresses).`,
    "",
    "| Contract | Ledger | Address | Runtime code hash |",
    "|---|---|---|---|",
    ...contractRows.filter((c) => c.ledger !== "anvil").map((c) => `| ${c.name} | ${c.ledger} | \`${c.address}\` | \`${c.codeHash}\` |`),
    "",
  ].join(nl),
);

// ---------------------------------------------------------------- PROOF.md (one page)
const pick = (pred: (r: RView) => boolean) => [...receipts].reverse().find((r) => r.ledger !== "anvil" && r.txHash && pred(r));
const isCompany = (r: RView) => r.principal.startsWith("lotus");
const ok = (r: RView) => r.outcome === "confirmed";
const proofItems = [
  ["Allowed payment inside the mandate (T1)", pick((r) => ok(r) && r.tier === "T1" && !!r.payment && r.payment.method !== "x402/erc7710" && !isCompany(r))],
  ["Payment approved on the user's passkey (T2; the signature is checked on-chain through ERC-1271)", pick((r) => ok(r) && r.tier === "T2" && !isCompany(r))],
  ["Company payment approved by 2 of 3 directors (T2)", pick((r) => ok(r) && r.tier === "T2" && isCompany(r))],
  ["Service fee paid over x402: single-use, exact-amount ERC-7710 child delegation, settled by the seller", pick((r) => ok(r) && r.payment?.method === "x402/erc7710")],
  ["Attack reverted on-chain: PayeeNotVerified", pick((r) => r.revertError?.name === "PayeeNotVerified")],
  ["Budget enforced on-chain: CategoryBudgetExceeded", pick((r) => r.revertError?.name === "CategoryBudgetExceeded")],
  ["Unsuitable product refused on-chain: UnsuitableProduct", pick((r) => r.revertError?.name === "UnsuitableProduct")],
  ["Velocity breach trips the circuit breaker", pick((r) => ok(r) && r.explanation.text.startsWith("Circuit breaker tripped"))],
  ["Board resolution executed by 2 of 3 directors (T3)", pick((r) => r.tier === "T3" && ok(r) && r.explanation.text.startsWith("Board resolution") && !/Resume/.test(r.explanation.text))],
  ["One-tap pause signed by the principal and relayed (T3)", pick((r) => r.tier === "T3" && ok(r) && r.explanation.text.startsWith("Paused"))],
  ["Mandate revoked and delegation disabled in one user operation (T3)", pick((r) => ok(r) && r.explanation.text.startsWith("Revoked the mandate"))],
  ["Mandate sealed by a visitor's own passkey (WebAuthn) on a fresh account", pick((r) => ok(r) && r.explanation.text.startsWith("Mandate sealed (passkey (WebAuthn))"))],
  ["Company payment on the coin-free rail (FISCO)", pick((r) => r.ledger === "fisco" && ok(r) && r.principal === "lotus-sz" && r.tier === "T1")],
  ["Same treasurer agent re-sealed for Hong Kong: payment on the HK rail", pick((r) => ok(r) && r.principal === "lotus-hk" && r.tier === "T1" && !!r.payment)],
] as const;
const proofLines = proofItems.map(([title, r]) => `| ${title} | ${r ? `${LEDGERS[r.ledger].badge}` : "-"} | ${r ? link(r) : "not yet recorded"} |`);
const anchorF = anchorTxs.find((a) => a.ledger === "fisco");
if (anchorF) proofLines.push(`| Receipts anchored on-chain as one Merkle root (indexer) | ${LEDGERS.fisco.badge} | ${link({ ledger: "fisco", txHash: anchorF.txHash })} |`);
if (sup?.halt?.txHash) proofLines.push(`| Supervisor pause of an agent identity (pause only, never spend) | ${LEDGERS.fisco.badge} | ${txLink("fisco", sup.halt.txHash)} |`);
const zkRows: string[] = [];
for (const l of ["fisco", "base-sepolia"] as LedgerName[]) {
  const z = readJson<{ payments?: { ok: boolean; tx: string }[]; forged?: { tx?: string; revert?: string }; replayed?: { tx?: string; revert?: string } }>(p("apps/agent/data", `zk-${l}.json`));
  if (!z) continue;
  const ex = (h: string) => LEDGERS[l].explorerTx?.(h as `0x${string}`) ?? "";
  const pay = (z.payments ?? []).find((x) => x.ok);
  if (pay) zkRows.push(`| Private mandate: payment verified by a zero-knowledge proof at redemption (hidden cap and payees) | ${LEDGERS[l].badge} | [\`${pay.tx.slice(0, 12)}...\`](${ex(pay.tx)}) |`);
  if (z.forged?.tx) zkRows.push(`| Private mandate: forged proof reverts ${z.forged.revert ?? "InvalidMandateProof"} | ${LEDGERS[l].badge} | [\`${z.forged.tx.slice(0, 12)}...\`](${ex(z.forged.tx)}) |`);
  if (z.replayed?.tx) zkRows.push(`| Private mandate: replayed proof reverts ${z.replayed.revert ?? "NonceAlreadyUsed"} | ${LEDGERS[l].badge} | [\`${z.replayed.tx.slice(0, 12)}...\`](${ex(z.replayed.tx)}) |`);
}
const sealRows = e2e.filter((r) => r.step === "seal" && r.ledger !== "anvil").map((r) => `| Mandate sealed and published with its full caveat array (${r.ledger}) | ${String(r.ledger)} | \`${String(r.publishTx)}\` |`);
const pauseRows = e2e.filter((r) => String(r.step).startsWith("pause") && r.ledger !== "anvil").map((r) => `| One-tap pause, passkey signature relayed (${r.ledger}) | ${String(r.ledger)} | \`${String(r.tx)}\` |`);
write(
  p("PROOF.md"),
  [
    "# PROOF",
    "",
    `Generated at ${now} (commit \`${metrics["meta.commit"]}\`). Test units only; no monetary value.`,
    "",
    "| What it proves | Ledger | Transaction |",
    "|---|---|---|",
    ...sealRows,
    ...proofLines,
    ...zkRows,
    ...pauseRows,
    "",
    "Verify any mandate yourself (Python, independent of our TypeScript):",
    "",
    "```bash",
    "uvx --from 'git+https://github.com/ABRUBAB/YINGLONG#subdirectory=tools/verify-py' yinglong verify nadia --chain anvil --offline",
    "```",
    "",
    "Judge's Challenge: https://app.yinglong-agent.tech/challenge",
    "",
  ].join(nl),
);
metrics["proof.table"] = ["", "| What it proves | Ledger | Transaction |", "|---|---|---|", ...sealRows, ...proofLines, ...zkRows, ...pauseRows, ""].join(nl);

// ---------------------------------------------------------------- check keys, write the bundle, fill gen markers
const MARKER = /<!-- gen:([a-zA-Z0-9_.\-]+) -->([\s\S]*?)<!-- \/gen -->/g;
const docsDir = p("docs");
const files = [...readdirSync(docsDir).filter((f) => f.endsWith(".md")).map((f) => resolve(docsDir, f)), p("README.md")];
const defined = new Set([...readFileSync(p("docs/GENERATED_KEYS.md"), "utf8").matchAll(/^\| `([a-zA-Z0-9_.\-]+)` \|/gm)].map((m) => m[1]!));
for (let n = 1; n <= 5; n++) for (const k of ["drill", "detect", "pause", "revoke", "rotate", "notify", "evidence"]) defined.add(`ir.pb${n}.${k}`);
const undefinedKeys = new Set<string>();
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(MARKER)) if (!defined.has(m[1]!)) undefinedKeys.add(`${m[1]} (${basename(f)})`);
if (undefinedKeys.size) {
  console.warn(`finalize: keys used in documents but not defined in docs/GENERATED_KEYS.md: ${[...undefinedKeys].join(", ")}`);
  if (FINAL) {
    console.error("finalize --final: stopping; define every key in docs/GENERATED_KEYS.md first");
    process.exit(1);
  }
}
const bundle = {
  generatedAt: now,
  final: FINAL,
  metrics,
  testRuns,
  controls: controlRows,
  deployerRoles: roleScan,
  drills: { pb1: readJson(p("docs/evidence/drills/pb1.json")), supervisorPause: sup, transactions: drillTxs },
  contracts: contractRows,
  receipts: receipts.slice(-200),
  e2e,
};
write(p("docs/evidence/bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
let filled = 0;
const unmeasured: Record<string, string[]> = {};
for (const f of files) {
  const s = readFileSync(f, "utf8");
  const t = s.replace(MARKER, (_m, key: string) => {
    filled++;
    if (metrics[key] === undefined) (unmeasured[basename(f)] ??= []).push(key);
    return `<!-- gen:${key} -->${metrics[key] ?? UNMEASURED}<!-- /gen -->`;
  });
  if (t !== s) write(f, t);
}
console.log(`finalize: ${Object.keys(metrics).length} metrics, ${receipts.length} receipts, ${e2e.length} e2e rows, ${filled} markers filled${FINAL ? " (final)" : ""}`);
for (const [f, ks] of Object.entries(unmeasured)) console.log(`finalize: ${f}: ${ks.length} markers without a metric: ${[...new Set(ks)].join(", ")}`);
