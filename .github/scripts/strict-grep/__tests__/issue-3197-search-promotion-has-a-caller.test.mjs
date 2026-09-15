// #3197 — node --test companion for issue-3197-search-promotion-has-a-caller.mjs.
//
// The gate's --self-test proves its detector on synthetic SQL. This file proves
// it on the REAL migration chain: green as shipped, and red — naming the right
// function — for each in-memory reversion of the #3197 migration.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { cronReachability } from "../issue-2290-queue-worker-has-cron-caller.mjs";
import { analyze, loadMigrations } from "../issue-3197-search-promotion-has-a-caller.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "..", "issue-3197-search-promotion-has-a-caller.mjs");
const MIGRATION = "20270706003197_issue_3197_public_search_auto_promotion.sql";

// Read the chain once; every test below analyses an in-memory copy.
const MIGRATIONS = loadMigrations();

const withMigration = (mutate) =>
  MIGRATIONS.map((m) => (m.file === MIGRATION ? { ...m, sql: mutate(m.sql) } : m));

const removeExactLine = (sql, line) => {
  const lines = sql.split("\n");
  const hits = lines.filter((l) => l === line).length;
  assert.equal(hits, 1, `expected exactly one line ${JSON.stringify(line)}`);
  return lines.filter((l) => l !== line).join("\n");
};

test("the real chain is green: the reconciler writes search_ready and a live cron job calls it", () => {
  const migrations = MIGRATIONS;
  assert.ok(migrations.some((m) => m.file === MIGRATION), "anti-vacuity: the #3197 migration must be on disk");
  const result = analyze(migrations);
  assert.deepEqual(result.violations, []);
  const [surface] = result.report;
  assert.equal(surface.surface.table, "public_search_documents");
  const writer = surface.writers.find((w) => w.name === "issue_3197_reconcile_public_search");
  assert.ok(writer, "the reconciler must be discovered as a search_ready writer");
  assert.equal(writer.caller, "cron job issue_3197_public_search_reconcile");
  assert.ok(result.reachable.has("issue_3197_assert_public_search_converged"), "the monitor must have a caller");
  assert.ok(
    !surface.writers.some((w) => w.name === "upsert_public_search_document"),
    "the parameterised #2986 RPC is a door, not a literal writer",
  );
  assert.ok(result.replay.functions.size > 100 && result.replay.scheduleCalls > 0, "anti-vacuity");
});

test("deleting the reconcile cron.schedule turns the gate red, naming the writer", () => {
  const result = analyze(
    withMigration((sql) =>
      removeExactLine(
        removeExactLine(sql, "SELECT cron.schedule('issue_3197_public_search_reconcile', '* * * * *',"),
        "  $cron$SELECT public.issue_3197_reconcile_public_search();$cron$);",
      ),
    ),
  );
  assert.ok(
    result.violations.some(
      (v) => v.rule === "B" && v.message.includes("writer issue_3197_reconcile_public_search has no live cron or trigger caller"),
    ),
    JSON.stringify(result.violations),
  );
});

test("deleting the convergence cron.schedule turns the gate red, naming the monitor", () => {
  const result = analyze(
    withMigration((sql) =>
      removeExactLine(
        removeExactLine(sql, "SELECT cron.schedule('issue_3197_public_search_converged', '*/10 * * * *',"),
        "  $cron$SELECT public.issue_3197_assert_public_search_converged();$cron$);",
      ),
    ),
  );
  assert.ok(
    result.violations.some((v) => v.rule === "B" && v.message.includes("issue_3197_assert_public_search_converged")),
    JSON.stringify(result.violations),
  );
});

test("the tree before #3197 is red: a reader with no writer", () => {
  const result = analyze(MIGRATIONS.filter((m) => m.file !== MIGRATION));
  assert.ok(
    result.violations.some((v) => v.rule === "A" && v.message.includes("NO function ever writes")),
    JSON.stringify(result.violations),
  );
});

test("a migration that promotes at apply time is red", () => {
  const result = analyze(
    withMigration((sql) => sql.replace("\nCOMMIT;", "\nSELECT public.issue_3197_reconcile_public_search();\nCOMMIT;")),
  );
  assert.ok(
    result.violations.some((v) => v.rule === "D" && v.message.includes("executes promotion writer issue_3197_reconcile_public_search")),
    JSON.stringify(result.violations),
  );
});

test("the #3197 migration adds no dynamic cron.unschedule to the frozen #2290 count", () => {
  const own = MIGRATIONS.filter((m) => m.file === MIGRATION);
  const reach = cronReachability(own);
  assert.equal(reach.dynamicUnschedules, 0);
  assert.equal(reach.scheduleCalls, 2);
  assert.deepEqual([...reach.jobs.keys()].sort(), [
    "issue_3197_public_search_converged",
    "issue_3197_public_search_reconcile",
  ]);
});

test("--self-test exits 0", () => {
  const run = spawnSync(process.execPath, [GATE, "--self-test"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /#3197 self-test PASS/);
});
