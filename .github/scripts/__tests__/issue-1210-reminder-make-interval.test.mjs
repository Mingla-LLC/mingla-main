/**
 * #1210 — source guard: tip migration must not pass numeric into make_interval(mins).
 * Fails if the fix migration is missing or still divides by 2.0.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = path.join(
  root,
  "supabase/migrations/20271026001210_issue_1210_reminder_make_interval_int.sql",
);

test("#1210 tip migration exists and uses integer half-window", () => {
  assert.ok(fs.existsSync(migration), "missing #1210 migration file");
  const src = fs.readFileSync(migration, "utf8");
  assert.match(src, /CREATE OR REPLACE FUNCTION public\.pg_notify_reminders_enqueue/);
  assert.doesNotMatch(
    src,
    /make_interval\(\s*mins\s*=>\s*[^)]*\/\s*2\.0/,
    "migration still passes numeric mins to make_interval",
  );
  assert.match(
    src,
    /\(p_window_minutes\s*\/\s*2\)\s*::\s*int|v_half_mins\s*:=\s*\(p_window_minutes\s*\/\s*2\)\s*::\s*int/,
    "migration missing integer half-window cast",
  );
  assert.match(src, /mingla_e164_country/, "#1529 country helper must remain");
});

test("#1210 SQL suites are registered on disk", () => {
  for (const name of [
    "issue_1210_reminder_make_interval.implementor.happy.pg17.test.sql",
    "issue_1210_reminder_make_interval.tester.adversarial.pg17.test.sql",
  ]) {
    const p = path.join(root, "supabase/migrations/__tests__", name);
    assert.ok(fs.existsSync(p), `missing ${name}`);
  }
});
