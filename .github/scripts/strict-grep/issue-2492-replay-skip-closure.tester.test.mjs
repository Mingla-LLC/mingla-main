// #2492 adversarial suite for the filtered-replay skip-closure guard.
//
// This suite attacks the guard from a different angle than the implementor's:
// the implementor proves the guard SEES the real fault; this one tries to make
// the guard blind, make it lie, and make it pass while protecting nothing.
//
// T-4  error   synthetic CREATE VIEW over a table only a skipped migration
//              creates                                                 -> non-zero
// T-6  negative the same identifier inside `--`, `/* */`, `'…'`,
//              `$tag$…$tag$` and `E'don\'t …'`                          -> exit 0 (all five)
// T-7  edge    a skip glob matching zero files                          -> C-2
// T-8  edge    a #1931 skip branch deleted                              -> C-3
// T-9  edge    an unparseable skip construct                            -> C-4a
// T-11 negative a `LANGUAGE sql` body under `check_function_bodies = false` -> exit 0
// T-12 REVERT  an INDEPENDENT fails-on-revert, built by a different
//              mechanism from the implementor's T-2 and asserting the
//              other limb of the fault                                  -> non-zero
// T-13 blind   a lane rewritten to the `basename` nested-quote form —
//              still discovered, inventory still 4                      (R-2)
// T-14 blind   a `#1647`-style alternation branch — all globs extracted (R-3)
// T-15 silent  a lane whose loop continues but carries no parseable
//              case construct                                           -> C-4b,
//              never "unfiltered"
//
// T-13/T-14/T-15 exist because the failure this guard is most likely to have
// is not a wrong answer — it is a SILENT partial answer. A parser blind to two
// of the four lanes analyses two lanes, finds nothing and exits 0.
//
// Every fixture is a FULL COPY of the real directory with ONE mutation, driven
// through the exported `analyseLanes({workflowsDir, migrationsDir})` seam. No
// test mutates a real repository file, and no test drives the guard's own
// internal mutation mode — this suite is registered selfTest:"none".

import assert from "node:assert/strict";
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

const LANE = "issue-1931-private-event-access.yml";
const LANE_1644 = "issue-1644-storage-guardrail-collage-fill-tests.yml";
const SKIPPED_MIGRATION = "20270522002462_issue_2462_checkout_determinism.sql";
/** A table created ONLY by 20270413001931, which the #1931 lane skips. */
const SKIPPED_TABLE = "private_event_access_grants";
/** A column added ONLY by 20270420002160, which the #1931 lane skips. */
const SKIPPED_COLUMN = "multi_date_pricing_mode";
const FIXTURE_MIGRATION = "29990101000002_issue_2492_adversarial.sql";

function fullCopyFixture(t, { editWorkflow, addMigration } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2492-tester-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const workflowsDir = path.join(root, "workflows");
  const migrationsDir = path.join(root, "migrations");
  fs.cpSync(REAL_WORKFLOWS, workflowsDir, { recursive: true });
  fs.cpSync(REAL_MIGRATIONS, migrationsDir, { recursive: true });

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

const checksIn = (violations) => [...new Set(violations.map((v) => v.check))].sort();

test("T-4 — a CREATE VIEW over a table only a skipped migration creates reds C-1", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    addMigration: [
      FIXTURE_MIGRATION,
      [
        "CREATE OR REPLACE VIEW public.issue_2492_adversarial_view AS",
        `  SELECT g.id FROM public.${SKIPPED_TABLE} g;`,
        "",
      ].join("\n"),
    ],
  });

  const { violations } = analyseLanes({ workflowsDir, migrationsDir });
  const c1 = violations.filter((v) => v.check === "C-1" && v.message.includes(FIXTURE_MIGRATION));
  assert.ok(c1.length >= 1, "a view body is resolved at CREATE time and must flag");
  assert.ok(c1.some((v) => v.message.includes(SKIPPED_TABLE)));
});

test("T-6 — the identifier inside all five literal/comment spellings does NOT flag", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    addMigration: [
      FIXTURE_MIGRATION,
      [
        `-- line comment mentioning ${SKIPPED_COLUMN} and ${SKIPPED_TABLE}`,
        `/* block comment mentioning ${SKIPPED_COLUMN}`,
        `   and ${SKIPPED_TABLE} across two lines */`,
        "CREATE TABLE IF NOT EXISTS public.issue_2492_adversarial_notes (",
        "  id uuid PRIMARY KEY,",
        "  note text",
        ");",
        `COMMENT ON TABLE public.issue_2492_adversarial_notes IS 'ordinary literal naming ${SKIPPED_COLUMN}';`,
        `COMMENT ON COLUMN public.issue_2492_adversarial_notes.note IS $doc$dollar-quoted literal naming ${SKIPPED_TABLE}$doc$;`,
        `INSERT INTO public.issue_2492_adversarial_notes (id, note) VALUES (gen_random_uuid(), E'don\\'t read ${SKIPPED_COLUMN} out of an escape string');`,
        "",
      ].join("\n"),
    ],
  });

  const { violations } = analyseLanes({ workflowsDir, migrationsDir });
  assert.deepEqual(
    violations.map((v) => `[${v.check}] ${v.message}`),
    [],
    "comments and string literals are never code. The E'…' case is the sharp one: mis-end it and the tail " +
      "of the file is read as statement-level DDL",
  );
});

test("T-11 — a `LANGUAGE sql` body under check_function_bodies = false does NOT flag", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    addMigration: [
      FIXTURE_MIGRATION,
      [
        "SET check_function_bodies = false;",
        "CREATE OR REPLACE FUNCTION public.issue_2492_adversarial_unchecked()",
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
  assert.deepEqual(
    violations.map((v) => `[${v.check}] ${v.message}`),
    [],
    "with check_function_bodies off the body is stored, not resolved — exactly one real migration does this " +
      "and it is first in the chain, which is why the omission would never have been noticed",
  );
});

test("T-7 — a skip glob matching zero files reds C-2", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      LANE,
      (src) =>
        src.replace(
          "*_issue_1931_*) continue ;;",
          "*_issue_1931_*) continue ;;\n              *_issue_9999_renamed_away_*) continue ;;",
        ),
    ],
  });

  const { violations } = analyseLanes({ workflowsDir, migrationsDir });
  assert.ok(violations.some((v) => v.check === "C-2" && v.message.includes("issue_9999_renamed_away")));
});

test("T-8 — deleting a pinned #1931 skip branch reds C-3", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [LANE, (src) => src.replace(/^.*\*_issue_1931_\*\) continue ;;\n/m, "")],
  });

  const { violations } = analyseLanes({ workflowsDir, migrationsDir });
  assert.ok(
    violations.some((v) => v.check === "C-3" && v.message.includes("*_issue_1931_*")),
    "a skip entry is never removed to green a lane, and the guard must say so by name",
  );
});

test("T-9 — an unparseable skip construct reds C-4a", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [LANE, (src) => src.replace(/^(\s*)esac\n/m, "")],
  });

  const { violations } = analyseLanes({ workflowsDir, migrationsDir });
  assert.ok(violations.some((v) => v.check === "C-4a"), "a case the parser cannot close must fail closed, not be ignored");
});

test("T-15 — a lane that continues but yields zero globs reds C-4b, never 'unfiltered'", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      LANE,
      (src) => {
        const caseStart = src.indexOf('case "$f" in');
        const esacEnd = src.indexOf("esac", caseStart);
        assert.ok(caseStart !== -1 && esacEnd !== -1, "the #1931 lane must carry a case block to replace");
        return `${src.slice(0, caseStart)}[ -n "\${MINGLA_SKIP:-}" ] && continue${src.slice(esacEnd + "esac".length)}`;
      },
    ],
  });

  const { violations, lanes } = analyseLanes({ workflowsDir, migrationsDir });
  const lane = lanes.find((l) => l.workflow === LANE);
  assert.ok(lane, "the lane must still be REPORTED — silently dropping it is the failure mode this test exists for");
  assert.equal(lane.globs.length, 0);
  assert.ok(
    violations.some((v) => v.check === "C-4b"),
    "a filtered lane the parser cannot read must be an error. Treating it as unfiltered analyses it with an " +
      "empty skip set and protects nothing, with no error raised",
  );
});

test("T-13 — a lane rewritten to the basename nested-quote form is still discovered (R-2)", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      LANE,
      (src) =>
        src
          .split('case "$f" in')
          .join('case "$(basename "$f")" in')
          // The globs must follow the subject, or C-2 correctly reds (see T-14's sibling, M-7).
          .split("*20270522002462_issue_2462_checkout_determinism.sql)")
          .join("20270522002462_issue_2462_checkout_determinism.sql)"),
    ],
  });

  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  const lane = lanes.find((l) => l.workflow === LANE);
  assert.ok(lane, "the nested quote in `case \"$(basename \"$migration\")\" in` must not hide the lane");
  assert.equal(lane.subjectKind, "basename");
  assert.equal(lane.globs.length, 4);
  assert.equal(lane.skipped.length, 4, "subject-correct matching (R-4) must still resolve all four files");
  assert.equal(lanes.length, 4, "the inventory must not collapse when a lane changes spelling");
  assert.deepEqual(checksIn(violations), [], "a semantics-preserving rewrite must stay green");
});

test("T-14 — a #1647-style alternation branch yields every glob (R-3)", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      "issue-1647-admin-mv-and-db-reclaim-tests.yml",
      (src) =>
        src.replace(
          "20270222001647_*|20270222001648_*|20270222001649_*) continue ;;",
          "20270222001647_*|20270222001648_*|20270222001649_*|20270221001644_*) continue ;;",
        ),
    ],
  });

  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  const lane = lanes.find((l) => l.workflow === "issue-1647-admin-mv-and-db-reclaim-tests.yml");
  assert.equal(lane.branchCount, 1, "still ONE branch");
  assert.equal(lane.globs.length, 4, "read one-glob-per-branch and this lane silently under-skips three files");
  assert.equal(lane.skipped.length, 4);
  assert.deepEqual(checksIn(violations), [], "the widened alternation is still internally consistent");

  // And the #1644 lane, whose file is now also skipped here, is untouched.
  const untouched = lanes.find((l) => l.workflow === LANE_1644);
  assert.equal(untouched.globs.length, 1);
});

test("T-12 — independent fails-on-revert, built differently from the implementor's fixture", (t) => {
  // Deliberately NOT the implementor's regex-delete. This reconstructs the case
  // block line by line and drops the branch by exact filename match, so a bug in
  // one fixture's construction cannot green both suites.
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      LANE,
      (src) =>
        src
          .split("\n")
          .filter((line) => !(line.includes(SKIPPED_MIGRATION) && line.includes("continue ;;")))
          .join("\n"),
    ],
  });

  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });

  // The lane is still fully parsed — the red is the closure failure, not a parse failure.
  const lane = lanes.find((l) => l.workflow === LANE);
  assert.equal(lane.globs.length, 3);
  assert.deepEqual(checksIn(violations), ["C-1"], "reverting the fix must red C-1 and ONLY C-1");

  // Assert the OTHER limb from the implementor's T-2: the column, which is the
  // error PostgreSQL reports first and which masked the guard error in CI.
  assert.ok(
    violations.some((v) => v.message.includes(SKIPPED_MIGRATION) && v.message.includes(SKIPPED_COLUMN)),
    "C-1 must name the column added only by the skipped #2160",
  );
  assert.ok(
    violations.some((v) => v.message.includes("issue_1931_event_ordinary_read_blocked")),
    "and the #1931 guard function, which is the governing fault behind the masked column error",
  );
  assert.ok(
    violations.every((v) => !v.message.includes("20270522002463_issue_2462_phone_backfill.sql")),
    "...002463 must never be implicated — it is healthy and deliberately not skipped",
  );
});
