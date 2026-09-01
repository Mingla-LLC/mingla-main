#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fail,
  postgresEnvFromUrl,
  requiredEnv,
  safeCliFailure,
  SitesOpsError,
} from "./lib/sites-ops.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = resolve(SCRIPT_DIR, "bootstrap-sites-cms.sql");

function projectRef(env) {
  const value = requiredEnv(env, "SITES_CMS_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/.test(value)) fail("INVALID_PROJECT_REF");
  return value;
}

function storageEndpoint(env, ref) {
  const expected = `https://${ref}.storage.supabase.co/storage/v1/s3`;
  if (requiredEnv(env, "SUPABASE_S3_ENDPOINT") !== expected) {
    fail("S3_PROJECT_MISMATCH");
  }
}

function adminUrl(env, ref) {
  const raw = requiredEnv(env, "SITES_CMS_ADMIN_DATABASE_URL");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("INVALID_ADMIN_DATABASE_URL");
  }
  const isDirect =
    decodeURIComponent(url.username) === "postgres" &&
    url.hostname === `db.${ref}.supabase.co` &&
    url.port === "5432";
  const isSessionPooler =
    decodeURIComponent(url.username) === `postgres.${ref}` &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    url.port === "5432";
  if (
    url.protocol !== "postgresql:" ||
    (!isDirect && !isSessionPooler) ||
    decodeURIComponent(url.password).length < 32 ||
    url.pathname !== "/postgres" ||
    url.hash || url.searchParams.size !== 1 ||
    url.searchParams.get("sslmode") !== "require"
  ) fail("INVALID_ADMIN_DATABASE_URL");
  return raw;
}

export function bootstrapSitesCms({ env = process.env, spawn = spawnSync } = {}) {
  for (const name of [
    "SITES_CMS_MIGRATOR_PASSWORD",
    "SITES_CMS_APP_PASSWORD",
    "SITES_RUNTIME_READER_SUBJECT",
    "SITES_PILOT_SITE_ID",
  ]) requiredEnv(env, name);
  const ref = projectRef(env);
  storageEndpoint(env, ref);
  const directAdminUrl = adminUrl(env, ref);
  const result = spawn(
    "psql",
    ["-X", "--no-psqlrc", "--file", SQL_PATH],
    {
      encoding: "utf8",
      env: {
        ...postgresEnvFromUrl(directAdminUrl, env),
        PGAPPNAME: "mingla-sites-bootstrap-v1",
        PGCONNECT_TIMEOUT: "15",
      },
    },
  );
  if (result.error || result.status !== 0) {
    throw new SitesOpsError("BOOTSTRAP_SQL_FAILED");
  }
  if (!String(result.stdout).includes("SITES_BOOTSTRAP_OK")) {
    throw new SitesOpsError("BOOTSTRAP_READBACK_MISSING");
  }
  process.stdout.write("SITES_BOOTSTRAP_OK\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    bootstrapSitesCms();
  } catch (error) {
    safeCliFailure(error);
  }
}
