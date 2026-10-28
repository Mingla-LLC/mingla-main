#!/usr/bin/env node
// #2829 W0 — run a command with the LOCAL Sites CMS environment:
// mingla-site-cms/.env.local + .state/cms-ops.env, plus SITES_LOCAL_MODE=1.
// Usage: cms-env.mjs --exec -- <command> [args...]
// Refuses to run if any database or storage target in that environment is
// not loopback, so a stray hosted value can never be reached from here.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CMS_OPS_ENV_PATH, REPO_ROOT, assertLoopbackUrl, parseEnvFile } from "./lib/local-state.mjs";

const separator = process.argv.indexOf("--");
if (!process.argv.includes("--exec") || separator < 0 || separator === process.argv.length - 1) {
  process.stderr.write("usage: cms-env.mjs --exec -- <command> [args...]\n");
  process.exit(2);
}

const files = [resolve(REPO_ROOT, "mingla-site-cms/.env.local"), CMS_OPS_ENV_PATH];
const env = { ...process.env };
for (const file of files) {
  if (!existsSync(file)) {
    process.stderr.write(`FAIL cms-env: ${file} is missing; run generate-local-keys.mjs\n`);
    process.exit(2);
  }
  Object.assign(env, parseEnvFile(readFileSync(file, "utf8")));
}
env.SITES_LOCAL_MODE = "1";
for (const name of [
  "DATABASE_URL",
  "SITES_CMS_ADMIN_DATABASE_URL",
  "SITES_CMS_MIGRATOR_DATABASE_URL",
  "SUPABASE_S3_ENDPOINT",
  "SITES_CORE_BASE_URL",
]) {
  try {
    assertLoopbackUrl(env[name], name);
  } catch {
    process.stderr.write(`FAIL cms-env: ${name} is not a loopback target\n`);
    process.exit(2);
  }
}

const [command, ...args] = process.argv.slice(separator + 1);
const result = spawnSync(command, args, { cwd: REPO_ROOT, env, stdio: "inherit" });
process.exit(result.status ?? 1);
