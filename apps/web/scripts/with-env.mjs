#!/usr/bin/env node
// Cross-platform "KEY=value -- command args" runner (Windows shells cannot prefix env vars).
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 1) {
  console.error("usage: with-env.mjs KEY=value [KEY=value ...] -- command [args]");
  process.exit(2);
}
const env = { ...process.env };
for (const pair of argv.slice(0, sep)) {
  const i = pair.indexOf("=");
  env[pair.slice(0, i)] = pair.slice(i + 1);
}
const [cmd, ...args] = argv.slice(sep + 1);
const child = spawn(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
