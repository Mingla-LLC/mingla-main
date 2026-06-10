#!/usr/bin/env node
/**
 * #426 — RLS coverage audit.
 *
 * Parses supabase/migrations/*.sql and flags public tables that are created
 * (and not later dropped) without ENABLE ROW LEVEL SECURITY.
 *
 * Usage:
 *   node scripts/audit/rls-coverage.mjs
 *   node scripts/audit/rls-coverage.mjs --self-test
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EXIT,
  REPO_ROOT,
  listMigrationSqlFiles,
  parseArgs,
  reportViolations,
} from "./_shared.mjs";

const CREATE_TABLE_RE =
  /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"public"\."([^"]+)"/gi;
const DROP_TABLE_RE =
  /DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+"public"\."([^"]+)"/gi;
const ENABLE_RLS_RE =
  /ALTER\s+TABLE\s+"public"\."([^"]+)"\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;

function loadAllowlist() {
  const raw = readFileSync(join(REPO_ROOT, "scripts/audit/rls-allowlist.json"), "utf8");
  const parsed = JSON.parse(raw);
  return new Set(parsed.tables ?? []);
}

function analyzeMigrations(files) {
  const created = new Set();
  const dropped = new Set();
  const rlsEnabled = new Set();

  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    for (const re of [CREATE_TABLE_RE, DROP_TABLE_RE, ENABLE_RLS_RE]) {
      re.lastIndex = 0;
    }
    let m;
    while ((m = CREATE_TABLE_RE.exec(sql)) !== null) {
      created.add(m[1]);
    }
    while ((m = DROP_TABLE_RE.exec(sql)) !== null) {
      dropped.add(m[1]);
    }
    while ((m = ENABLE_RLS_RE.exec(sql)) !== null) {
      rlsEnabled.add(m[1]);
    }
  }

  const live = [...created].filter((t) => !dropped.has(t));
  return { live, rlsEnabled };
}

function runAudit(migrationFiles, allowlist) {
  const { live, rlsEnabled } = analyzeMigrations(migrationFiles);
  const violations = [];
  for (const table of live.sort()) {
    if (allowlist.has(table)) continue;
    if (table.startsWith("_archive_")) continue;
    if (!rlsEnabled.has(table)) {
      violations.push(`public.${table} has no ENABLE ROW LEVEL SECURITY in migrations`);
    }
  }
  return violations;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "orch-426-rls-"));
  const migrationsDir = join(dir, "supabase", "migrations");
  mkdirSync(migrationsDir, { recursive: true });

  writeFileSync(
    join(migrationsDir, "001_test.sql"),
    `
CREATE TABLE "public"."rls_test_ok" (id uuid primary key);
ALTER TABLE "public"."rls_test_ok" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."rls_test_bad" (id uuid primary key);
`,
  );

  const allowlist = new Set(["spatial_ref_sys"]);
  const violations = runAudit([join(migrationsDir, "001_test.sql")], allowlist);
  rmSync(dir, { recursive: true, force: true });

  if (violations.length !== 1 || !violations[0].includes("rls_test_bad")) {
    console.error("SELF-TEST FAIL: expected exactly one violation for rls_test_bad");
    process.exit(EXIT.ERROR);
  }
  console.log("SELF-TEST PASS: rls-coverage");
  process.exit(EXIT.OK);
}

function main() {
  const { selfTest: isSelfTest } = parseArgs(process.argv);
  if (isSelfTest) {
    selfTest();
    return;
  }

  const allowlist = loadAllowlist();
  const files = listMigrationSqlFiles();
  const violations = runAudit(files, allowlist);
  process.exit(reportViolations("RLS coverage on public tables", violations));
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(EXIT.ERROR);
}
