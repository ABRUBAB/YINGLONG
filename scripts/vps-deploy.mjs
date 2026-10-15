#!/usr/bin/env node
// Ship the committed repository to the VPS and restart the stack:
//   git bundle -> scp -> reset /opt/yinglong/src -> docker compose up --build (app) -> reload edge.
// Usage: node scripts/vps-deploy.mjs [--edge] [--secrets]
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
ssh("set -e; cd /opt/yinglong/src && git fetch -q /tmp/yinglong.bundle 'refs/heads/*:refs/remotes/bundle/*' && git reset -q --hard bundle/main && git log --oneline -1");

if (process.argv.includes("--secrets")) {
  const admin = resolve(root, "..", ".secrets", "agent-admin-token.txt");
  if (existsSync(admin)) {
    scp(admin, "/tmp/admin-token.txt");
    ssh("sudo mv /tmp/admin-token.txt /opt/yinglong/secrets/admin-token.txt && sudo chown 1000:1000 /opt/yinglong/secrets/admin-token.txt && sudo chmod 600 /opt/yinglong/secrets/admin-token.txt");
  }
}
if (process.argv.includes("--edge")) {
  ssh("set -e; mkdir -p /opt/yinglong/edge && cp -r /opt/yinglong/src/infra/edge/. /opt/yinglong/edge/ && cd /opt/yinglong/edge && docker compose up -d --force-recreate 2>&1 | tail -2");
}
ssh("set -e; cd /opt/yinglong/src/infra/app && docker compose up -d --build 2>&1 | tail -3");
rmSync(tmp, { recursive: true, force: true });
console.log("deployed");
