// #2492 implementor happy-path suite for the filtered-replay skip-closure guard.
//
// T-1  happy      repo as shipped                                   -> exit 0
// T-2  REVERT     full-copy workflows fixture minus the #2462 branch -> non-zero,
//                 naming 20270522002462 and the object it cannot resolve
// T-3  error      synthetic migration reading a skipped column from
//                 a `LANGUAGE sql` body                              -> non-zero
// T-5  negative   the SAME reference inside a plpgsql body           -> exit 0
// T-10 INVENTORY  exactly 4 filtered lanes, glob counts 4/1/3/1,
//                 zero violations
//
// T-10 is the non-vacuous one. "Real chain -> exit 0" passes just as happily
// when the parser is BLIND to two of the four lanes: it analyses two lanes,
// finds nothing, and exits 0. Asserting the inventory is what makes a blind
// parser red instead of quietly green. Two independent reviewers' own
// classifiers hit exactly that blindness on the nested quote in
// `case "$(basename "$migration")" in`.
//
// Every fixture is a FULL COPY of the real directory with ONE mutation, driven
// through the exported `analyseLanes({workflowsDir, migrationsDir})` seam (and,
// for T-2, through the CLI's `--workflows-dir` / `--migrations-dir` flags). No
// test mutates a real repository file, and no test drives the guard's own
// internal mutation mode — that mode belongs to the guard, and this suite is
// registered selfTest:"none".
//
// Partial or synthetic fixture directories are forbidden here: they make the
// real lanes' globs match zero files, firing C-2 and C-3 on tests that expect
// a clean result. Measured cost of a full copy: 14 MB + 1.4 MB.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyseLanes } from "./issue-2492-replay-skip-closure.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const REAL_WORKFLOWS = path.join(REPO_ROOT, ".github/workflows");
const REAL_MIGRATIONS = path.join(REPO_ROOT, "supabase/migrations");
const GUARD = path.join(HERE, "issue-2492-replay-skip-closure.mjs");

const LANE = "issue-1931-private-event-access.yml";
const SKIPPED_MIGRATION = "20270522002462_issue_2462_checkout_determinism.sql";
/** A column added ONLY by 20270420002160, which the #1931 lane skips. */
const SKIPPED_COLUMN = "multi_date_pricing_mode";
/** Sorts after every real migration, so it replays last on every lane. */
const FIXTURE_MIGRATION = "29990101000001_issue_2492_fixture.sql";

/**
 * Digest of the real `.github/workflows` and `supabase/migrations` directories:
 * every filename plus the content of the four lanes this suite mutates. Used as
 * a teardown post-condition so a fixture that escapes its temp directory is
 * caught by the very test that did it, not discovered later in `git status`.
 */
function realTreeDigest() {
  const hash = crypto.createHash("sha256");
  for (const [dir, pattern] of [[REAL_WORKFLOWS, /\.ya?ml$/], [REAL_MIGRATIONS, /\.sql$/]]) {
    for (const name of fs.readdirSync(dir).filter((n) => pattern.test(n)).sort()) hash.update(`${dir}/${name}\n`);
  }
  for (const name of fs.readdirSync(REAL_WORKFLOWS).filter((n) => /^issue-(1644|1647|1931|2117)-/.test(n)).sort()) {
    hash.update(fs.readFileSync(path.join(REAL_WORKFLOWS, name)));
  }
  return hash.digest("hex");
}

/**
 * Full copy of both real directories, then exactly one mutation.
 * `editWorkflow` is `[filename, fn(text) -> text]`; `addMigration` is
 * `[filename, sql]`. Pass one, never both.
 */
function fullCopyFixture(t, { editWorkflow, addMigration } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2492-implementor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const workflowsDir = path.join(root, "workflows");
  const migrationsDir = path.join(root, "migrations");
  fs.cpSync(REAL_WORKFLOWS, workflowsDir, { recursive: true });
  fs.cpSync(REAL_MIGRATIONS, migrationsDir, { recursive: true });

  // Belt-and-braces containment. A fixture must never be able to reach a real
  // repository directory: assert the resolved fixture paths sit outside the
  // repo BEFORE anything is written, and assert on teardown that the real
  // directories were not touched. A test harness that can write to the tree it
  // inspects is a test harness that can manufacture its own green.
  assert.ok(
    !path.resolve(workflowsDir).startsWith(REPO_ROOT + path.sep) &&
      !path.resolve(migrationsDir).startsWith(REPO_ROOT + path.sep),
    `fixture directories resolved INSIDE the repository (${workflowsDir}, ${migrationsDir}) — refusing to write`,
  );
  const realBefore = realTreeDigest();
  t.after(() => {
    assert.equal(realTreeDigest(), realBefore, "a fixture mutated the real repository directories");
  });

  if (editWorkflow) {
    const [name, edit] = editWorkflow;
    const file = path.join(workflowsDir, name);
    const before = fs.readFileSync(file, "utf8");
    const after = edit(before);
    assert.notEqual(after, before, `fixture mutation of ${name} was a NO-OP — the fixture would prove nothing`);
    fs.writeFileSync(file, after);
  }
  if (addMigration) {
    const [name, sql] = addMigration;
    const file = path.join(migrationsDir, name);
    assert.equal(fs.existsSync(file), false, `${name} already exists — pick a filename that cannot collide`);
    fs.writeFileSync(file, sql);
  }
  return { workflowsDir, migrationsDir };
}

test("T-1 — the guard is clean on the repository as shipped", () => {
  const { violations } = analyseLanes();
  assert.deepEqual(
    violations.map((v) => `[${v.check}] ${v.message}`),
    [],
    "the guard must exit 0 on main; a guard that reds on its own repository gets weakened, not fixed",
  );
});

test("T-10 — lane inventory is exactly 4 lanes at 4/1/3/1 (a blind parser reds here)", () => {
  const { lanes, violations } = analyseLanes();
  assert.equal(violations.length, 0);

  const inventory = Object.fromEntries(lanes.map((l) => [l.workflow, l.globs.length]));
  assert.deepEqual(inventory, {
    "issue-1644-storage-guardrail-collage-fill-tests.yml": 1,
    "issue-1647-admin-mv-and-db-reclaim-tests.yml": 3,
    [LANE]: 4,
    "issue-2117-offering-visibility-gate-tests.yml": 1,
  });
  assert.equal(lanes.length, 4, "exactly four filtered replay lanes exist on this base");

  // R-2 / R-4: the two subject forms must BOTH be read, and read correctly.
  const bySubject = Object.fromEntries(lanes.map((l) => [l.workflow, l.subjectKind]));
  assert.equal(bySubject[LANE], "path");
  assert.equal(bySubject["issue-2117-offering-visibility-gate-tests.yml"], "path");
  assert.equal(bySubject["issue-1644-storage-guardrail-collage-fill-tests.yml"], "basename");
  assert.equal(bySubject["issue-1647-admin-mv-and-db-reclaim-tests.yml"], "basename");

  // R-3: #1647 carries three globs on ONE branch.
  const alternation = lanes.find((l) => l.workflow === "issue-1647-admin-mv-and-db-reclaim-tests.yml");
  assert.equal(alternation.branchCount, 1);
  assert.equal(alternation.globs.length, 3);

  // SC-2: the #1931 lane skips exactly four files, and ...002463 is NOT one.
  const pinned = lanes.find((l) => l.workflow === LANE);
  assert.equal(pinned.skipped.length, 4);
  assert.ok(pinned.skipped.includes(SKIPPED_MIGRATION));
  assert.equal(
    pinned.skipped.includes("20270522002463_issue_2462_phone_backfill.sql"),
    false,
    "...002463 is healthy and must keep applying — this is why the skip is by exact filename, not *_issue_2462_*",
  );
});

test("T-2 — fails on revert: removing the #2462 skip branch reds C-1", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [LANE, (src) => src.replace(new RegExp(`^.*${SKIPPED_MIGRATION.replace(/\./g, "\\.")}\\) continue ;;\\n`, "m"), "")],
  });

  const { violations } = analyseLanes({ workflowsDir, migrationsDir });
  const c1 = violations.filter((v) => v.check === "C-1");
  assert.ok(c1.length >= 1, "C-1 must fire once the skip entry is reverted");
  assert.ok(
    c1.some((v) => v.message.includes(SKIPPED_MIGRATION) && v.message.includes("issue_1931_event_ordinary_read_blocked")),
    "C-1 must name the offending migration AND the #1931 guard function it cannot resolve",
  );
  assert.ok(
    c1.some((v) => v.message.includes(SKIPPED_COLUMN)),
    "C-1 must also name the column, which is the error PostgreSQL reports first and which masks the guard error",
  );

  // Same revert through the CLI seam: a real non-zero exit, not just a return value.
  const run = () => execFileSync("node", [GUARD, `--workflows-dir=${workflowsDir}`, `--migrations-dir=${migrationsDir}`], { encoding: "utf8", stdio: "pipe" });
  assert.throws(run, (err) => {
    assert.equal(err.status, 1, "the guard must exit non-zero on a reverted skip list");
    assert.match(err.stderr, /C-1/);
    return true;
  });
});

test("T-3 — a `LANGUAGE sql` body reading a skipped column reds C-1", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    addMigration: [
      FIXTURE_MIGRATION,
      [
        "CREATE OR REPLACE FUNCTION public.issue_2492_fixture_sql_reader()",
        "RETURNS text",
        "LANGUAGE sql",
        "STABLE",
        "AS $fn$",
        `  SELECT e.${SKIPPED_COLUMN} FROM public.events e LIMIT 1;`,
        "$fn$;",
        "",
      ].join("\n"),
    ],
  });

  const { violations } = analyseLanes({ workflowsDir, migrationsDir });
  const c1 = violations.filter((v) => v.check === "C-1" && v.message.includes(FIXTURE_MIGRATION));
  assert.ok(c1.length >= 1, "a LANGUAGE sql body is validated at CREATE time and must flag");
  assert.ok(c1.some((v) => v.message.includes(SKIPPED_COLUMN)));
});

test("T-5 — the identical reference inside a plpgsql body does NOT flag", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    addMigration: [
      FIXTURE_MIGRATION,
      [
        "CREATE OR REPLACE FUNCTION public.issue_2492_fixture_plpgsql_reader()",
        "RETURNS text",
        "LANGUAGE plpgsql",
        "STABLE",
        "AS $fn$",
        "BEGIN",
        `  RETURN (SELECT e.${SKIPPED_COLUMN} FROM public.events e LIMIT 1);`,
        "END;",
        "$fn$;",
        "",
      ].join("\n"),
    ],
  });

  const { violations } = analyseLanes({ workflowsDir, migrationsDir });
  assert.deepEqual(
    violations.map((v) => `[${v.check}] ${v.message}`),
    [],
    "a plpgsql body is not name-checked at CREATE time — flagging it would make the guard unusable, " +
      "and it is exactly why ...002333 replays clean today",
  );
});
