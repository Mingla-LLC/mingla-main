#!/usr/bin/env node
// #3643 Phase 3E. One PostgreSQL service and one migration replay per routed
// batch class; every suite receives a catalog-identical database cloned from
// that migrated template. The suite/database relation is derived from the
// manifest and is therefore part of the same executed === expected contract as
// the test runner.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadManifest, expectedPrimarySuites, routeOrFail } from "./run-suite-batch.mjs";
import { POSTGRES_CLASS_PREFIX, isPostgresBatchSuite, postgresDatabaseName, postgresEvidencePath } from "./postgres-batch-contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
function psql(port, credential, database, args, { input, quiet = false, user = "postgres" } = {}) {
  const result = spawnSync("psql", ["-h", "127.0.0.1", "-p", String(port), "-U", user, "-d", database, ...args], {
    cwd: ROOT,
    env: { ...process.env, PGPASSWORD: credential, PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || "3" },
    input,
    encoding: "utf8",
    stdio: input === undefined ? (quiet ? ["ignore", "pipe", "pipe"] : "inherit") : ["pipe", quiet ? "pipe" : "inherit", "inherit"],
  });
  if (result.error || result.status !== 0) throw new Error(`psql failed for ${database}: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  return String(result.stdout || "").trim();
}

function sqlIdentifier(value) { return `"${String(value).replaceAll('"', '""')}"`; }

const FINGERPRINT_SQL = `
SELECT md5(string_agg(line, E'\\n' ORDER BY line)) FROM (
  SELECT 'database-owner|' || pg_get_userbyid(datdba) AS line FROM pg_database WHERE datname = current_database()
  UNION ALL SELECT 'schema-owner|' || nspname || '|' || pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
  UNION ALL SELECT 'table-owner|' || n.nspname || '.' || c.relname || '|' || pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S','f') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL SELECT 'policy|' || schemaname || '.' || tablename || '|' || policyname || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,'') FROM pg_policies
  UNION ALL SELECT 'index|' || schemaname || '.' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname !~ '^pg_'
  UNION ALL SELECT 'trigger|' || n.nspname || '.' || c.relname || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname !~ '^pg_'
) catalog;
`;

function fingerprint(port, credential, database) {
  return psql(port, credential, database, ["-At", "-v", "ON_ERROR_STOP=1", "-c", FINGERPRINT_SQL], { quiet: true });
}

function objectCounts(port, credential, database) {
  const sql = `SELECT concat_ws('/',
    (SELECT count(*) FROM pg_policies),
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal),
    (SELECT count(*) FROM pg_indexes WHERE schemaname !~ '^pg_'),
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'))`;
  return psql(port, credential, database, ["-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { quiet: true });
}

export function waitForTemplateDrain(
  readCount,
  {
    attempts = 10,
    delayMs = 500,
    sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  } = {},
) {
  let holders = "unknown";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    holders = String(readCount()).trim();
    if (holders === "0") return;
    if (!/^\d+$/.test(holders)) {
      throw new Error(`G-3: invalid template backend count: ${holders}`);
    }
    if (attempt < attempts) sleep(delayMs);
  }
  throw new Error(
    `G-3: ${holders} backend(s) remain attached to the closed migrated template after ${attempts} drain checks`,
  );
}

export function selectedPostgresSuites(manifest, klass, routeOptions = {}) {
  const candidates = expectedPrimarySuites(manifest, klass);
  if (!klass.startsWith(POSTGRES_CLASS_PREFIX) || !candidates.length || candidates.some((suite) => !isPostgresBatchSuite(suite))) {
    throw new Error(`class ${klass} is not a registered Phase 3E PostgreSQL class`);
  }
  return routeOrFail(manifest, klass, candidates, routeOptions).selection.suites;
}

function waitForPostgres(port, credential) {
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const result = spawnSync("psql", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-Atc", "SELECT to_regnamespace('vault') IS NOT NULL AND to_regrole('supabase_admin') IS NOT NULL"], {
      env: { ...process.env, PGPASSWORD: credential, PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || "3" }, encoding: "utf8",
    });
    if (result.status === 0 && result.stdout.trim() === "t") return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
}

export function setupPostgresBatch(manifest, klass, { port, credential, tempRoot = process.env.RUNNER_TEMP || os.tmpdir() }) {
  if (!/^\d+$/.test(String(port || ""))) throw new Error("PostgreSQL service port is missing");
  if (!credential) throw new Error("PostgreSQL batch credential is missing");
  let activePort = Number(port);
  const suites = selectedPostgresSuites(manifest, klass);
  const evidencePath = postgresEvidencePath(klass, tempRoot);
  if (fs.existsSync(evidencePath)) throw new Error(`PostgreSQL setup evidence already exists: ${evidencePath}`);
  if (!suites.length) return null;

  if (!waitForPostgres(activePort, credential)) throw new Error("PostgreSQL 17 service did not finish bootstrapping in 180 attempts");

  const migrations = execFileSync("find", ["supabase/migrations", "-maxdepth", "1", "-type", "f", "-name", "*.sql", "-print0"], { cwd: ROOT })
    .toString().split("\0").filter(Boolean).sort();
  if (!migrations.length) throw new Error("migration replay selected zero SQL files");
  const replayStarted = Date.now();
  // #1985 owns two intentionally different proof databases: the primary
  // replay creates the #3429 Vault secrets, while the vaultless replay proves
  // the advisory path with no secrets. Keep the shared template at the schema
  // immediately before #3429 on this one dedicated host; the retained origin
  // commands apply that migration once in each isolated clone.
  const templateMigrations = migrationsForPostgresTemplate(migrations, klass);
  const customReplaySuites = suites.filter((suite) => suite.templateReplay);
  if (customReplaySuites.length) {
    if (suites.length !== 1 || customReplaySuites.length !== 1) {
      throw new Error(`${klass}: a custom template replay must own a dedicated one-suite host`);
    }
    const [suite] = customReplaySuites;
    const cwd = path.resolve(ROOT, suite.templateReplay.cwd || ".");
    const relative = path.relative(ROOT, cwd);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${suite.id}: custom template replay working directory is invalid`);
    }
    console.log(`replaying the sealed custom migration plan once for ${klass}`);
    const result = spawnSync("bash", ["-c", suite.templateReplay.run], {
      cwd,
      env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: String(activePort), PGUSER: "postgres", PGDATABASE: "postgres", PGPASSWORD: credential },
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) throw new Error(`${suite.id}: custom template replay failed (${result.error?.message || `exit ${result.status}`})`);
  } else {
    console.log(`replaying ${templateMigrations.length} migration files once for ${klass}`);
    for (const migration of templateMigrations) {
      psql(activePort, credential, "postgres", ["-q", "-v", "ON_ERROR_STOP=1", "-f", migration], { quiet: true });
    }
  }

  // Close the migrated template while copying so background workers cannot
  // race CREATE DATABASE ... TEMPLATE. SQLSTATE 55006 gets a bounded retry;
  // every other failure is terminal and printed verbatim by psql.
  const templateFingerprint = fingerprint(activePort, credential, "postgres");
  const templateCounts = objectCounts(activePort, credential, "postgres");
  psql(activePort, credential, "template1", ["-v", "ON_ERROR_STOP=1", "-c", "ALTER DATABASE postgres WITH ALLOW_CONNECTIONS false"]);
  // The Supabase image intentionally keeps `postgres` non-superuser while
  // `supabase_admin` owns pg_net and pg_cron. Once new connections are refused,
  // stop those workers one at a time (simultaneous termination makes the image
  // enter recovery), then copy before either can reconnect. This preserves the
  // image's required cron.database_name=postgres setting for replay and tests.
  psql(activePort, credential, "template1", ["-v", "ON_ERROR_STOP=1", "-c", "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND pid <> pg_backend_pid() AND backend_type='client backend'"], { user: "supabase_admin" });
  psql(activePort, credential, "template1", ["-v", "ON_ERROR_STOP=1", "-c", "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND backend_type='pg_net 0.19.5 worker'"], { user: "supabase_admin" });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  psql(activePort, credential, "template1", ["-v", "ON_ERROR_STOP=1", "-c", "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND backend_type='pg_cron launcher'"], { user: "supabase_admin" });
  // pg_terminate_backend() returning true proves the signal was sent, not that
  // the process has already disappeared from pg_stat_activity. Give the
  // asynchronously exiting worker a short bounded drain window, while still
  // failing closed unless the template reaches exactly zero attached backends.
  waitForTemplateDrain(() =>
    psql(activePort, credential, "template1", ["-At", "-v", "ON_ERROR_STOP=1", "-c", "SELECT count(*) FROM pg_stat_activity WHERE datname='postgres'"], { quiet: true })
  );
  const databases = {};
  const additionalDatabases = {};
  try {
    for (const suite of suites) {
      const primary = postgresDatabaseName(suite.id);
      if (suite.databaseName !== primary) throw new Error(`${suite.id}: databaseName drifted from deterministic mapping`);
      const requested = [["primary", primary], ...Object.entries(suite.additionalDatabases || {})];
      const seen = new Set();
      for (const [alias, database] of requested) {
        if (!database || seen.has(database)) throw new Error(`${suite.id}: duplicate or empty cloned database mapping`);
        seen.add(database);
        let created = false;
        let last = "";
        for (let attempt = 1; attempt <= 10; attempt += 1) {
          const result = spawnSync("psql", ["-h", "127.0.0.1", "-p", String(activePort), "-U", "postgres", "-d", "template1", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${sqlIdentifier(database)} TEMPLATE postgres OWNER postgres`], {
            env: { ...process.env, PGPASSWORD: credential, PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || "3" }, encoding: "utf8",
          });
          last = `${result.stdout || ""}${result.stderr || ""}`;
          if (result.status === 0) { created = true; break; }
          if (!/55006|being accessed by other users/i.test(last)) throw new Error(`${suite.id}/${alias}: CREATE DATABASE failed: ${last.trim()}`);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
        }
        if (!created) throw new Error(`${suite.id}/${alias}: template stayed busy after bounded retries: ${last.trim()}`);
        const copyFingerprint = fingerprint(activePort, credential, database);
        const copyCounts = objectCounts(activePort, credential, database);
        if (copyFingerprint !== templateFingerprint || copyCounts !== templateCounts) {
          throw new Error(`G-1 ${suite.id}/${alias}: ${database} is not catalog-identical to the migrated template (${copyFingerprint}/${copyCounts} != ${templateFingerprint}/${templateCounts})`);
        }
      }
      databases[suite.id] = primary;
      if (Object.keys(suite.additionalDatabases || {}).length) additionalDatabases[suite.id] = suite.additionalDatabases;
    }
  } finally {
    psql(activePort, credential, "template1", ["-q", "-c", "ALTER DATABASE postgres WITH ALLOW_CONNECTIONS true"]);
  }

  const holders = psql(activePort, credential, "template1", ["-At", "-v", "ON_ERROR_STOP=1", "-c", "SELECT count(*) FROM pg_stat_activity WHERE datname='postgres' AND pid <> pg_backend_pid() AND backend_type='client backend'"], { quiet: true });
  if (holders !== "0") throw new Error(`G-3: ${holders} client backend(s) remain attached to the migrated template`);
  const evidence = {
    schemaVersion: 1,
    class: klass,
    selectedSuiteIds: suites.map((suite) => suite.id),
    databases,
    additionalDatabases,
    migrationFiles: templateMigrations.length,
    replayExecutions: 1,
    replayPlan: customReplaySuites.length ? "sealed-custom" : "full-history",
    replayDurationMs: Date.now() - replayStarted,
    templateFingerprint,
    templateCounts,
    port: activePort,
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  console.log(`G-1 PASS: ${suites.length} of ${suites.length} routed suite databases are catalog-identical to the one migrated template`);
  console.log(`G-3 PASS: template has zero client backends; suites map only to ${Object.values(databases).join(", ")}`);
  console.log(`G-9 PASS: per-suite selection came from each suite's originPaths (${suites.length} selected in ${klass})`);
  return evidencePath;
}

const ARI_CHAT_CONTEXT_MIGRATION = "20270712003429_issue_3429_ari_chat_context.sql";

export function migrationsForPostgresTemplate(migrations, klass) {
  if (klass !== "postgres17-deno146-node20-dualdb") return migrations;

  // The dual-database suite applies #3429 itself once with Vault fixtures and
  // once without them. Its shared template therefore has to stop immediately
  // before #3429, not merely omit that one file while replaying later migrations
  // that can legitimately depend on the tables #3429 creates.
  return migrations.filter((migration) =>
    path.basename(migration) < ARI_CHAT_CONTEXT_MIGRATION
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [mode, klass] = process.argv.slice(2);
  if (mode !== "--setup" || !klass) throw new Error("usage: postgres-batch.mjs --setup <class>");
  const manifest = loadManifest();
  const result = setupPostgresBatch(manifest, klass, { port: process.env.PG_BATCH_PORT, credential: process.env.PG_BATCH_PASSWORD });
  console.log(result ? `recorded one Postgres replay at ${result}` : `selected zero PostgreSQL suites for ${klass}; no service setup needed`);
}
