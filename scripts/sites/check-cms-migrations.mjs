#!/usr/bin/env node

/**
 * Issue #2830 — Studio's database must not silently lag its code.
 *
 * #4148 shipped 10 Payload migrations that never reached Studio's database.
 * Every Studio request then failed with "Website tools are temporarily
 * unavailable", drafts stuck at provisioning, and nothing said why. This compares
 * what the code expects (`mingla-site-cms/src/migrations/index.ts`) with what the
 * database has applied.
 *
 * Runs as housekeeping after a verified backup. It only ever reads, it alerts
 * through `housekeeping_alert`, and it can never deactivate the pilot.
 *
 * Exit 0: nothing behind. Exit 1: behind, or the check could not run; the code is
 * on stdout as `SITES_CMS_MIGRATIONS code=… missing=…`, names only.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { postgresEnvFromUrl } from "./lib/sites-ops.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_INDEX = "mingla-site-cms/src/migrations/index.ts";
const APPLIED_SQL =
  "SELECT name FROM sites_cms.payload_migrations WHERE batch IS NOT NULL AND batch <> -1 ORDER BY name;";

/** The names the deployed code expects, read from its own index. */
export function expectedMigrations(indexSource) {
  return [...indexSource.matchAll(/^\s*name:\s*['"]([^'"]+)['"]/gm)].map((match) => match[1]);
}

export function missingMigrations(expected, applied) {
  const have = new Set(applied);
  return expected.filter((name) => !have.has(name));
}

export function checkCmsMigrations(env, { spawn = spawnSync, read = readFileSync } = {}) {
  let expected;
  try {
    expected = expectedMigrations(read(join(REPO, MIGRATIONS_INDEX), "utf8"));
  } catch {
    return { code: "CMS_MIGRATIONS_CHECK_UNAVAILABLE", missing: [] };
  }
  // An index this cannot read must never read as "nothing is behind".
  if (expected.length === 0) return { code: "CMS_MIGRATIONS_CHECK_UNAVAILABLE", missing: [] };
  let pgEnv;
  try {
    pgEnv = postgresEnvFromUrl(env.SITES_CMS_DATABASE_URL, env);
  } catch {
    return { code: "CMS_MIGRATIONS_CHECK_UNAVAILABLE", missing: [] };
  }
  const result = spawn(
    "psql",
    ["-X", "--no-psqlrc", "--tuples-only", "--no-align", "--command", APPLIED_SQL],
    {
      encoding: "utf8",
      env: { ...pgEnv, PGAPPNAME: "mingla-sites-migration-check-v1", PGCONNECT_TIMEOUT: "15" },
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    return { code: "CMS_MIGRATIONS_CHECK_UNAVAILABLE", missing: [] };
  }
  const applied = String(result.stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const missing = missingMigrations(expected, applied);
  return missing.length > 0
    ? { code: "CMS_MIGRATIONS_BEHIND", missing }
    : { code: "CMS_MIGRATIONS_CURRENT", missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = checkCmsMigrations(process.env);
  process.stdout.write(
    `SITES_CMS_MIGRATIONS code=${outcome.code} missing=${outcome.missing.join(",") || "none"}\n`,
  );
  if (process.env.SITES_CMS_MIGRATIONS_RESULT_PATH) {
    writeFileSync(process.env.SITES_CMS_MIGRATIONS_RESULT_PATH, JSON.stringify(outcome));
  }
  process.exitCode = outcome.code === "CMS_MIGRATIONS_CURRENT" ? 0 : 1;
}
