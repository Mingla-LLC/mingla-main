// MINGLA-INVARIANT: I-SITES-CMS-MIGRATIONS-NOT-BEHIND | issue #2830 | Twice a day, after a verified backup, what the CMS code expects is compared with what its database has applied. Behind, or unable to check, alerts on #2830; it never reds the run and never deactivates the pilot.
/**
 * Issue #2830 — Studio's migrations cannot silently lag its code again.
 *
 * Invariant I-SITES-CMS-MIGRATIONS-NOT-BEHIND (declared on line 1).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkCmsMigrations,
  expectedMigrations,
  missingMigrations,
} from "../check-cms-migrations.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = readFileSync(join(REPO, [".github", "workflows", "sites-backup-restore.yml"].join("/")), "utf8");
const ENV = {
  SITES_CMS_DATABASE_URL: "postgresql://sites_cms_migrator:pw@db.example.supabase.co:5432/postgres?sslmode=require",
  PATH: process.env.PATH,
};
const INDEX = "export const migrations = [\n  {\n    up: a.up,\n    name: 'one',\n  },\n  {\n    name: 'two',\n  },\n];\n";
const read = () => INDEX;
const answer = (stdout, status = 0) => () => ({ status, stdout });

test("reads the real index: every migration in the code has a name", () => {
  const names = expectedMigrations(readFileSync(join(REPO, "mingla-site-cms/src/migrations/index.ts"), "utf8"));
  assert.ok(names.length >= 16);
  assert.ok(names.includes("20261025_190000_issue_2829_w9b_work_log"));
});

test("current, behind, and exactly which", () => {
  assert.deepEqual(missingMigrations(["a", "b"], ["b"]), ["a"]);
  assert.deepEqual(checkCmsMigrations(ENV, { read, spawn: answer("one\ntwo\n") }), { code: "CMS_MIGRATIONS_CURRENT", missing: [] });
  assert.deepEqual(checkCmsMigrations(ENV, { read, spawn: answer("one\n") }), { code: "CMS_MIGRATIONS_BEHIND", missing: ["two"] });
});

test("anything it cannot check is said, never read as current", () => {
  const unavailable = { code: "CMS_MIGRATIONS_CHECK_UNAVAILABLE", missing: [] };
  assert.deepEqual(checkCmsMigrations(ENV, { read, spawn: answer("", 2) }), unavailable);
  assert.deepEqual(checkCmsMigrations(ENV, { read, spawn: () => ({ error: new Error("no docker") }) }), unavailable);
  assert.deepEqual(checkCmsMigrations(ENV, { read: () => "nothing here", spawn: answer("one\n") }), unavailable);
  assert.deepEqual(checkCmsMigrations({}, { read, spawn: answer("one\ntwo\n") }), unavailable);
});

test("wired as housekeeping: can't red the run, can't reach deactivate, does alert", () => {
  const job = (name) => {
    const at = WORKFLOW.indexOf(`\n  ${name}:\n`);
    assert.ok(at > 0, name);
    const next = WORKFLOW.slice(at + 3).search(/\n {2}[a-z_]+:\n/);
    return WORKFLOW.slice(at, at + 3 + next);
  };
  const check = job("cms_migrations");
  assert.match(check, /id: check\n\s+continue-on-error: true/);
  assert.match(check, /run: node scripts\/sites\/check-cms-migrations\.mjs/);
  assert.match(check, /needs: \[backup_restore\]/);
  for (const other of ["backup_restore", "deactivate", "alert", "retention"]) {
    assert.equal(job(other).includes("cms_migrations"), false, other);
  }
  const alert = job("cms_migrations_alert");
  assert.match(alert, /needs\.cms_migrations\.outputs\.code != 'CMS_MIGRATIONS_CURRENT'/);
  assert.match(alert, /kind=CMS_MIGRATIONS/);
  assert.equal(alert.includes("environment:"), false);
  assert.equal(alert.includes("secrets."), false);
  assert.match(WORKFLOW, /issue_2830_cms_migrations_guard\.test\.mjs/);
});
