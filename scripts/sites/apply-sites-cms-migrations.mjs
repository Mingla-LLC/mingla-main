#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrapSitesCms } from "./bootstrap-sites-cms.mjs";
import { fail, requiredEnv, safeCliFailure } from "./lib/sites-ops.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ANSI_CONTROL_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g",
);

function migratorUrl(env) {
  const projectRef = requiredEnv(env, "SITES_CMS_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/.test(projectRef)) fail("INVALID_PROJECT_REF");
  const raw = requiredEnv(env, "SITES_CMS_MIGRATOR_DATABASE_URL");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("INVALID_MIGRATOR_DATABASE_URL");
  }
  const isDirect =
    decodeURIComponent(url.username) === "sites_cms_migrator" &&
    url.hostname === `db.${projectRef}.supabase.co` &&
    url.port === "5432";
  const isSessionPooler =
    decodeURIComponent(url.username) === `sites_cms_migrator.${projectRef}` &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    url.port === "5432";
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    (!isDirect && !isSessionPooler) ||
    decodeURIComponent(url.password).length < 32 ||
    url.pathname !== "/postgres" ||
    url.hash || url.searchParams.size !== 1 ||
    url.searchParams.get("sslmode") !== "require"
  ) fail("INVALID_MIGRATOR_DATABASE_URL");
  if (
    decodeURIComponent(url.password) !==
    requiredEnv(env, "SITES_CMS_MIGRATOR_PASSWORD")
  ) fail("MIGRATOR_CREDENTIAL_MISMATCH");
  return raw;
}

export function applySitesCmsMigrations({
  env = process.env,
  spawn = spawnSync,
  bootstrap = bootstrapSitesCms,
} = {}) {
  const directUrl = migratorUrl(env);
  bootstrap({ env });
  const {
    SITES_CMS_ADMIN_DATABASE_URL: _adminUrl,
    SITES_CMS_MIGRATOR_DATABASE_URL: _migratorUrl,
    SITES_CMS_MIGRATOR_PASSWORD: _migratorPassword,
    SITES_CMS_APP_PASSWORD: _appPassword,
    SITES_RUNTIME_READER_SUBJECT: _runtimeSubject,
    ...baseChildEnv
  } = env;
  const result = spawn(
    "npm",
    ["--prefix", "mingla-site-cms", "run", "migrate"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...baseChildEnv,
        DATABASE_URL: directUrl,
        NODE_ENV: "production",
        PAYLOAD_LOCAL_SCHEMA_PUSH: "false",
        SITES_DATABASE_CONNECTION_MODE: "migration",
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) fail("PAYLOAD_MIGRATION_FAILED");
  const receipt = `${String(result.stdout || "")}\n${String(result.stderr || "")}`
    .replace(ANSI_CONTROL_SEQUENCE, "");
  if (!/(?:^|\s)Done\.(?:\s|$)/.test(receipt)) {
    fail("PAYLOAD_MIGRATION_RECEIPT_MISSING");
  }
  bootstrap({ env });
  process.stdout.write("SITES_CMS_MIGRATIONS_OK bootstrap_passes=2\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    applySitesCmsMigrations();
  } catch (error) {
    safeCliFailure(error);
  }
}
