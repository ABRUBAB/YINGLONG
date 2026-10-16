// Third-party register tables and the release SBOM, generated from the installed packages, the lockfiles and the ML
// manifests. Licences are read from each installed package's own metadata, never typed.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { englishOnly, readJson, run, sha256, table } from "./util";

// ---------------------------------------------------------------- npm (direct dependencies of every workspace package)
interface PkgJson {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function workspacePackages(root: string): string[] {
  const out = ["."];
  for (const top of ["apps", "packages"]) for (const d of readdirSync(resolve(root, top))) if (existsSync(resolve(root, top, d, "package.json"))) out.push(`${top}/${d}`);
  for (const d of ["bench", "circuits"]) if (existsSync(resolve(root, d, "package.json"))) out.push(d);
  return out;
}

const licenceOf = (p: PkgJson) => (typeof p.license === "string" ? p.license : p.license?.type) ?? p.licenses?.map((l) => l.type).join(" OR ") ?? "not declared";

export function npmTable(root: string): { rows: number; md: string } {
  const seen = new Map<string, { name: string; version: string; licence: string; usedBy: Set<string>; kinds: Set<string> }>();
  for (const pkg of workspacePackages(root)) {
    const pj = readJson<PkgJson>(resolve(root, pkg, "package.json"));
    if (!pj) continue;
    for (const [kind, deps] of [["runtime", pj.dependencies], ["dev", pj.devDependencies]] as const) {
      for (const [name, spec] of Object.entries(deps ?? {})) {
        if (spec.startsWith("workspace:")) continue;
        const inst = readJson<PkgJson>(resolve(root, pkg, "node_modules", name, "package.json")) ?? readJson<PkgJson>(resolve(root, "node_modules", name, "package.json"));
        const version = inst?.version ?? `not installed (${spec})`;
        const k = `${name}@${version}`;
        const e = seen.get(k) ?? { name, version, licence: inst ? licenceOf(inst) : "not installed", usedBy: new Set<string>(), kinds: new Set<string>() };
        e.usedBy.add(pkg === "." ? "(root)" : pkg);
        e.kinds.add(kind);
        seen.set(k, e);
      }
    }
  }
  const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return {
    rows: rows.length,
    md: `${rows.length} direct dependencies of ${workspacePackages(root).length} workspace packages (version and licence read from each installed package.json):${table(
      ["Package", "Version", "Licence", "Kind", "Used by"],
      rows.map((r) => [`\`${r.name}\``, r.version, r.licence, [...r.kinds].join(", "), [...r.usedBy].join(", ")]),
    )}`,
  };
}

// ---------------------------------------------------------------- Python (pyproject + uv.lock + installed METADATA)
const norm = (n: string) => n.toLowerCase().replace(/[-_.]+/g, "-");

function lockVersions(lock: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const block of lock.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1];
    const version = block.match(/^version = "([^"]+)"/m)?.[1];
    if (name && version) m.set(norm(name), version);
  }
  return m;
}

function directDeps(pyproject: string): { name: string; group: string }[] {
  const out: { name: string; group: string }[] = [];
  const grab = (body: string, group: string) => {
    for (const m of body.matchAll(/"([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\s*[<>=!~;,"]/g)) out.push({ name: m[1]!, group });
  };
  const deps = pyproject.match(/^dependencies\s*=\s*\[([\s\S]*?)^\]/m)?.[1];
  if (deps) grab(deps, "runtime");
  const groups = pyproject.match(/^\[dependency-groups\]([\s\S]*?)(^\[|$(?![\s\S]))/m)?.[1] ?? "";
  for (const g of groups.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*\[([\s\S]*?)\]/gm)) grab(g[2]!, g[1]!);
  return out;
}

function installedLicence(venv: string, name: string, version: string): string | undefined {
  const sp = [resolve(venv, "Lib", "site-packages"), ...(existsSync(resolve(venv, "lib")) ? readdirSync(resolve(venv, "lib")).map((d) => resolve(venv, "lib", d, "site-packages")) : [])].find((p) => existsSync(p));
  if (!sp) return undefined;
  const dir = readdirSync(sp).find((d) => d.endsWith(".dist-info") && norm(d.replace(/\.dist-info$/, "").replace(/-[^-]+$/, "")) === norm(name) && d.includes(version));
  if (!dir || !existsSync(resolve(sp, dir, "METADATA"))) return undefined;
  const meta = readFileSync(resolve(sp, dir, "METADATA"), "utf8").split(/\r?\n\r?\n/)[0]!;
  const expr = meta.match(/^License-Expression:\s*(.+)$/m)?.[1]?.trim();
  if (expr) return expr;
  const lic = meta.match(/^License:\s*(.+)$/m)?.[1]?.trim();
  if (lic && lic.length <= 40 && !/^UNKNOWN$/i.test(lic)) return lic;
  const cls = [...meta.matchAll(/^Classifier:\s*License :: (?:OSI Approved :: )?(.+)$/gm)].map((m) => m[1]!.trim());
  if (cls.length) return cls.join(" OR ");
  return lic ? `see package metadata (${lic.slice(0, 30)}...)` : "not declared";
}

export const PY_PROJECTS = ["tools/verify-py", "ml", "ml/serving"];

export function pythonTable(root: string): { rows: number; md: string } {
  const rows: string[][] = [];
  for (const p of PY_PROJECTS) {
    const pp = resolve(root, p, "pyproject.toml");
    const lk = resolve(root, p, "uv.lock");
    if (!existsSync(pp) || !existsSync(lk)) continue;
    const versions = lockVersions(readFileSync(lk, "utf8"));
    for (const d of directDeps(readFileSync(pp, "utf8"))) {
      const v = versions.get(norm(d.name)) ?? "not in uv.lock";
      const lic = installedLicence(resolve(root, p, ".venv"), d.name, v) ?? "not read (the locked version is not installed in the project environment)";
      rows.push([`\`${d.name}\``, v, lic, d.group, p]);
    }
  }
  return {
    rows: rows.length,
    md: `${rows.length} direct dependencies of ${PY_PROJECTS.length} Python projects (version from each uv.lock, licence from the installed package metadata):${table(["Package", "Version", "Licence", "Group", "Project"], rows)}`,
  };
}

// ---------------------------------------------------------------- models and datasets (ML register and manifests)
function mdTable(md: string, heading: string): string[][] {
  const sec = md.split(/^## /m).find((s) => s.startsWith(heading));
  if (!sec) return [];
  return sec
    .split(/\r?\n/)
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) => l.slice(1, -1).split("|").map((c) => c.trim()));
}

export function modelsTable(root: string): string | undefined {
  const reg = resolve(root, "ml/THIRD_PARTY.md");
  const rows: string[][] = [];
  if (existsSync(reg)) {
    for (const [model, licence, revision, role] of mdTable(readFileSync(reg, "utf8"), "Models")) {
      rows.push([model!, revision!, "not recorded", licence!, role!, "`ml/THIRD_PARTY.md`"]);
    }
  }
  const results = resolve(root, "ml/results");
  if (existsSync(results)) {
    for (const f of readdirSync(results).filter((x) => /^m1_.*\.json$/.test(x))) {
      const j = readJson<{ hf_repo?: string; hf_revision?: string; repo?: string; source_revision?: string; int8_sha256?: string; arm?: string }>(resolve(results, f));
      const repo = j?.hf_repo ?? j?.repo;
      const rev = j?.hf_revision ?? j?.source_revision;
      if (repo && rev) rows.push([`\`${repo}\` (ours)`, `\`${rev.slice(0, 12)}\``, j?.int8_sha256 ? `int8 ONNX \`${j.int8_sha256}\`` : "not recorded", "ours (see the model card)", j?.arm ? `M1 sentinel arm ${j.arm}` : "M1 sentinel ONNX export", `\`ml/results/${f}\``]);
    }
  }
  const lock = readJson<Record<string, { repo: string; revision: string; subfolder?: string; files: Record<string, string> }>>(resolve(root, "ml/serving/models.lock.json"));
  for (const [k, v] of Object.entries(lock ?? {})) {
    rows.push([`\`${v.repo}\` ${v.subfolder ?? k} (ours)`, `\`${v.revision.slice(0, 12)}\``, Object.entries(v.files).map(([n, h]) => `${n} \`${h.slice(0, 16)}...\``).join("; "), "ours (see the model card)", `${k.toUpperCase()} served by ml/serving`, "`ml/serving/models.lock.json`"]);
  }
  if (!rows.length) return undefined;
  return `Read from the ML register and manifests at generation (third-party revisions as recorded by the ML workstream; our own models with the hashes in their manifests):${table(["Model", "Revision", "SHA-256", "Licence", "Role", "Recorded in"], rows)}`;
}

export function datasetsTable(root: string): string | undefined {
  const reg = resolve(root, "ml/THIRD_PARTY.md");
  const rows: string[][] = [];
  if (existsSync(reg)) for (const [ds, licence, revision, how] of mdTable(readFileSync(reg, "utf8"), "Datasets")) rows.push([ds!, revision!, licence!, how!, "`ml/THIRD_PARTY.md`"]);
  const sent = readJson<{ sha256?: Record<string, string>; stats?: Record<string, { n: number; by_source?: Record<string, number> }> }>(resolve(root, "ml/results/sentinel_data_manifest.json"));
  if (sent?.stats) {
    const sources = new Set(Object.values(sent.stats).flatMap((s) => Object.keys(s.by_source ?? {})));
    rows.push([`Derived sentinel splits (${[...sources].join(", ")})`, "see private datasets", "per source", `rows: ${Object.entries(sent.stats).map(([k, s]) => `${k} ${s.n}`).join(", ")}`, "`ml/results/sentinel_data_manifest.json`"]);
  }
  const bench = readJson<{ attacks_total?: number; legit_total?: number; files_sha256?: Record<string, string> }>(resolve(root, "bench/MANIFEST.json"));
  if (bench) rows.push(["YINGLONG-Bench v1 (ours, synthetic)", "this repository", "Apache-2.0 with this repository", `${bench.attacks_total} attacks, ${bench.legit_total} legitimate tasks; SHA-256 per file in the manifest`, "`bench/MANIFEST.json`"]);
  if (!rows.length) return undefined;
  return `Read from the ML register and manifests at generation:${table(["Dataset", "Revision", "Licence", "Use", "Recorded in"], rows)}`;
}

export function privateDatasetsTable(root: string): string | undefined {
  const rows: string[][] = [];
  const sent = readJson<{ hf_commit?: string; sha256?: Record<string, string> }>(resolve(root, "ml/results/sentinel_data_manifest.json"));
  if (sent?.hf_commit) for (const [f, h] of Object.entries(sent.sha256 ?? {})) rows.push(["`ABRUBAB/yl-private-data` (sentinel v1)", `\`${sent.hf_commit.slice(0, 12)}\``, f, `\`${h}\``, "`ml/results/sentinel_data_manifest.json`"]);
  const intent = readJson<{ hf_dataset?: string; hf_commit?: string; private_sha256?: Record<string, string> }>(resolve(root, "ml/results/intent_data_manifest.json"));
  if (intent?.hf_commit) for (const [f, h] of Object.entries(intent.private_sha256 ?? {})) rows.push([`\`${intent.hf_dataset ?? "ABRUBAB/yl-private-data"}\` (intent v1)`, `\`${intent.hf_commit.slice(0, 12)}\``, f, `\`${h}\``, "`ml/results/intent_data_manifest.json`"]);
  if (!rows.length) return undefined;
  return `Private HuggingFace datasets (Chinese-script rows live only there), as recorded in the ML manifests; the Chinese variants of the bench (\`bench/v1/\` in the same dataset) have no revision or hash recorded in this repository:${table(["Dataset", "Revision", "File", "SHA-256", "Recorded in"], rows)}`;
}

// ---------------------------------------------------------------- SBOM (CycloneDX)
interface Bom {
  bomFormat: string;
  specVersion: string;
  serialNumber?: string;
  version: number;
  metadata: { timestamp?: string; tools?: unknown; component?: unknown; [k: string]: unknown };
  components: { "bom-ref"?: string; [k: string]: unknown }[];
  dependencies?: { ref: string; dependsOn?: string[] }[];
}

/**
 * The release SBOM: pnpm's built-in CycloneDX generator (pnpm version pinned by packageManager in package.json) for
 * the npm workspace, plus uv's CycloneDX export of each Python project's uv.lock, merged into one document. The
 * timestamp is dropped and the serial number derived from the content so the same tree gives the same hash.
 */
export function writeSbom(root: string, outPath: string): { sha256: string; tools: string; components: number; replaced: number } | { error: string } {
  const tmp = process.env.TEMP ?? process.env.TMP ?? "/tmp";
  const npmOut = resolve(tmp, "sbom-npm.cdx.json");
  const p = run("pnpm", ["sbom", "--sbom-format", "cyclonedx", "--sbom-spec-version", "1.6", "--sbom-type", "application", "-r", "--out", npmOut], { cwd: root });
  const base = readJson<Bom>(npmOut);
  if (p.status !== 0 || !base) return { error: `pnpm sbom failed (exit ${p.status}): ${(p.stderr || p.stdout).slice(-200)}` };
  const pnpmVersion = run("pnpm", ["--version"], { cwd: root }).stdout.trim();
  const tools = [`pnpm ${pnpmVersion} sbom (CycloneDX ${base.specVersion})`];
  const comps = [...base.components];
  const deps = [...(base.dependencies ?? [])];
  for (const proj of PY_PROJECTS) {
    if (!existsSync(resolve(root, proj, "uv.lock"))) continue;
    const u = run("uv", ["export", "--format", "cyclonedx1.5", "--project", proj, "--frozen", "--no-header", "--preview-features", "sbom-export"], { cwd: root });
    let bom: Bom | undefined;
    try {
      bom = JSON.parse(u.stdout) as Bom;
    } catch {
      continue;
    }
    if (tools.length === 1) tools.push(`${run("uv", ["--version"], { cwd: root }).stdout.trim()} export (CycloneDX ${bom.specVersion})`);
    const pre = (r: string) => `py:${proj}:${r}`;
    for (const c of bom.components) comps.push({ ...c, "bom-ref": c["bom-ref"] ? pre(c["bom-ref"]) : undefined, properties: [...(((c as { properties?: unknown[] }).properties ?? []) as unknown[]), { name: "yinglong:python-project", value: proj }] });
    const rootRef = (bom.metadata.component as { "bom-ref"?: string } | undefined)?.["bom-ref"];
    if (rootRef) comps.push({ ...(bom.metadata.component as object), "bom-ref": pre(rootRef), type: "application" });
    for (const d of bom.dependencies ?? []) deps.push({ ref: pre(d.ref), dependsOn: (d.dependsOn ?? []).map(pre) });
  }
  comps.sort((a, b) => String(a["bom-ref"] ?? a.name).localeCompare(String(b["bom-ref"] ?? b.name)));
  deps.sort((a, b) => a.ref.localeCompare(b.ref));
  const bom: Bom = { ...base, serialNumber: undefined, metadata: { ...base.metadata, timestamp: undefined }, components: comps, dependencies: deps };
  const body = JSON.stringify(bom);
  const h = sha256(body);
  bom.serialNumber = `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  const { text, replaced } = englishOnly(`${JSON.stringify(bom, null, 1)}\n`);
  writeFileSync(outPath, text);
  return { sha256: sha256(text), tools: tools.join(" + "), components: comps.length, replaced };
}
