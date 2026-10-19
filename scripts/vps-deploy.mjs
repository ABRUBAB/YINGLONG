#!/usr/bin/env node
// Ship the committed repository to the VPS and restart the stack:
//   git bundle -> scp -> reset /opt/yinglong/src -> docker compose up --build (app) -> reload edge.
// Usage: node scripts/vps-deploy.mjs [--edge] [--secrets] [--videos <folder>]
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.VPS_HOST ?? "azureuser@20.239.152.146";
const KEY = process.env.VPS_KEY ?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "yinglong-vps_key.pem");
const win = process.platform === "win32";
const SSH = win ? join(process.env.WINDIR ?? "C:/Windows", "System32", "OpenSSH", "ssh.exe") : "ssh";
const SCP = win ? join(process.env.WINDIR ?? "C:/Windows", "System32", "OpenSSH", "scp.exe") : "scp";
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed`);
};
const ssh = (c) => run(SSH, ["-i", KEY, "-o", "BatchMode=yes", HOST, c]);
const scp = (from, to) => run(SCP, ["-i", KEY, "-o", "BatchMode=yes", from, `${HOST}:${to}`]);

const tmp = mkdtempSync(join(process.env.TEMP ?? tmpdir(), "yl-"));
const bundle = join(tmp, "yinglong.bundle");
run("git", ["bundle", "create", bundle, "--all"], { cwd: root });
scp(bundle, "/tmp/yinglong.bundle");
ssh("set -e; cd /opt/yinglong/src && git fetch -q /tmp/yinglong.bundle '+refs/heads/*:refs/remotes/bundle/*' && git reset -q --hard bundle/main && git log --oneline -1");

if (process.argv.includes("--secrets")) {
  const admin = resolve(root, "..", ".secrets", "agent-admin-token.txt");
  if (existsSync(admin)) {
    scp(admin, "/tmp/admin-token.txt");
    ssh("sudo mv /tmp/admin-token.txt /opt/yinglong/secrets/admin-token.txt && sudo chown 1000:1000 /opt/yinglong/secrets/admin-token.txt && sudo chmod 600 /opt/yinglong/secrets/admin-token.txt");
  }
  // DashScope (Alibaba Cloud Model Studio) key: taken from the key export next to the repository (found by
  // pattern, never by name), written as the bare key value to a private temp file, copied, then deleted. The
  // value is never printed.
  const parent = resolve(root, "..");
  const csv = readdirSync(parent).find((n) => /apiKey-\d+\.csv$/.test(n));
  const row = csv
    ? readFileSync(join(parent, csv), "utf8")
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((l) => l.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1")))
        .find((c) => c[0] === "apiKey")
    : undefined;
  const dsKey = row?.[1] && /^sk-[A-Za-z0-9._-]{8,}$/.test(row[1]) ? row[1] : undefined;
  if (dsKey) {
    const f = join(tmp, "dashscope.txt");
    writeFileSync(f, dsKey, { mode: 0o600 });
    scp(f, "/tmp/dashscope.txt");
    rmSync(f, { force: true });
    ssh("sudo mv /tmp/dashscope.txt /opt/yinglong/secrets/dashscope.txt && sudo chown 1000:1000 /opt/yinglong/secrets/dashscope.txt && sudo chmod 600 /opt/yinglong/secrets/dashscope.txt");
    console.log("DashScope key file installed on the VPS");
  } else {
    console.log("no DashScope key export found next to the repository: skipped");
  }
  // Cerebras key: the csk- key in the LLM key file next to the repository (found by pattern), written as the bare
  // value to a private temp file, copied, then deleted. Never printed.
  const llmFile = resolve(root, "..", "AI_LLM_API_KEY.txt");
  const cbKey = existsSync(llmFile) ? readFileSync(llmFile, "utf8").match(/csk-[A-Za-z0-9]+/)?.[0] : undefined;
  if (cbKey) {
    const f = join(tmp, "cerebras.txt");
    writeFileSync(f, cbKey, { mode: 0o600 });
    scp(f, "/tmp/cerebras.txt");
    rmSync(f, { force: true });
    ssh("sudo mv /tmp/cerebras.txt /opt/yinglong/secrets/cerebras.txt && sudo chown 1000:1000 /opt/yinglong/secrets/cerebras.txt && sudo chmod 600 /opt/yinglong/secrets/cerebras.txt");
    console.log("Cerebras key file installed on the VPS");
  } else {
    console.log("no Cerebras key in AI_LLM_API_KEY.txt: skipped");
  }
  // HuggingFace READ token for the ml service (private model repos): the file next to the repository is copied as is
  // (never read, printed or logged here) to a root-owned-by-uid-1000 file that the ml container mounts read-only.
  const hf = resolve(root, "..", "HF_AC_token.txt");
  if (existsSync(hf)) {
    scp(hf, "/tmp/hf-token.txt");
    ssh("sudo mv /tmp/hf-token.txt /opt/yinglong/secrets/hf-token.txt && sudo chown 1000:1000 /opt/yinglong/secrets/hf-token.txt && sudo chmod 600 /opt/yinglong/secrets/hf-token.txt");
    console.log("HuggingFace token file installed on the VPS");
  } else {
    console.log("no HF_AC_token.txt next to the repository: skipped");
  }
}
// The agent mounts the DashScope key file; make sure the path exists as a file (an absent bind source would
// become a directory). An empty file means "not configured".
ssh("sudo test -f /opt/yinglong/secrets/dashscope.txt || (sudo touch /opt/yinglong/secrets/dashscope.txt && sudo chown 1000:1000 /opt/yinglong/secrets/dashscope.txt && sudo chmod 600 /opt/yinglong/secrets/dashscope.txt)");
ssh("sudo test -f /opt/yinglong/secrets/cerebras.txt || (sudo touch /opt/yinglong/secrets/cerebras.txt && sudo chown 1000:1000 /opt/yinglong/secrets/cerebras.txt && sudo chmod 600 /opt/yinglong/secrets/cerebras.txt)");
// The ml service mounts the HuggingFace token file; keep the path a file (empty = no token; the models volume may
// already hold the verified files).
ssh("sudo test -f /opt/yinglong/secrets/hf-token.txt || (sudo touch /opt/yinglong/secrets/hf-token.txt && sudo chown 1000:1000 /opt/yinglong/secrets/hf-token.txt && sudo chmod 600 /opt/yinglong/secrets/hf-token.txt)");
// The film and demo clips (yinglong-film.mp4, student-demo.mp4, hack-demo.mp4) are not in git: copied to the edge,
// which serves /videos/* as plain files.
const vi = process.argv.indexOf("--videos");
if (vi > 0) {
  const dir = resolve(process.argv[vi + 1] ?? "");
  const files = readdirSync(dir).filter((n) => /^(yinglong-film|student-demo|hack-demo)\.mp4$/.test(n));
  ssh("set -e; sudo mkdir -p /opt/yinglong/edge/videos && sudo chown $(id -u):$(id -g) /opt/yinglong/edge/videos");
  for (const f of files) scp(join(dir, f), `/opt/yinglong/edge/videos/${f}`);
  console.log(`videos uploaded: ${files.join(", ") || "none found"}`);
}
if (process.argv.includes("--edge")) {
  ssh("set -e; mkdir -p /opt/yinglong/edge && cp -r /opt/yinglong/src/infra/edge/. /opt/yinglong/edge/ && cd /opt/yinglong/edge && docker compose up -d --force-recreate 2>&1 | tail -2");
}
// The services report the commit they run (the Proof Center shows it next to the evidence).
ssh("set -e; set -o pipefail; cd /opt/yinglong/src/infra/app && GIT_COMMIT=$(git -C /opt/yinglong/src rev-parse --short HEAD) docker compose up -d --build 2>&1 | tail -3");
rmSync(tmp, { recursive: true, force: true });
console.log("deployed");
