// #2492 implementor happy-path suite for the filtered-replay skip-closure guard.
//
// T-1  happy      repo as shipped                                   -> exit 0
// T-2  REVERT     full-copy workflows fixture minus the #2462 branch -> non-zero,
//                 naming 20270522002462 and the object it cannot resolve
// T-3  error      synthetic migration reading a skipped column from
//                 a `LANGUAGE sql` body                              -> non-zero
// T-5  negative   the SAME reference inside a plpgsql body           -> exit 0
// T-10 INVENTORY  exactly 4 filtered lanes, glob counts 11/1/3/6,
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

// [TEST-MOD-APPROVED #2879] The #1931 lane moved from TEN globs to ELEVEN and
// the #2117 lane from FIVE to SIX. #2879 re-emits
// `pg_direct_event_checkout_bundle` so the payment-redirect window counts as a
// hold; that function's body reaches objects both phases deliberately exclude,
// so the migration must be registered in each lane's skip list. The #2492 gate
// itself named the exact filename to add.
//
// ONLY the pinned counts move. No assertion is deleted, no parser scenario is
// relaxed, and the inventory stays an exact deepEqual — which is the whole
// point of T-10: a parser blind to a lane must still red here.

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
const ISSUE_2723_MIGRATION = "20270601002696_issue_2696_event_scoped_session_lookup.sql";
const ISSUE_2723_EXACT_GLOB = `*${ISSUE_2723_MIGRATION}`;
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

// [TEST-MOD-APPROVED #2489] The #1931 lane's skip inventory moved from FOUR to SIX.
//
// [TEST-MOD-APPROVED #2491] The #1931 lane moved from NINE globs to TEN and the
// #2117 lane from FOUR to FIVE. #2491 C2 steps 3+4 re-emit
// `pg_direct_event_checkout_bundle` to switch its sold subquery onto
// `ticket_types.sold_count`; that function's current body reaches
// `issue_1931_event_ordinary_read_blocked` / `multi_date_pricing_mode` on the
// first lane and `issue_2489_address_withheld` / `issue_2489_public_theme` on
// the second, none of which those phases have. The #2492 guard itself named the
// exact filename to add to each list.
//
// ONLY the pinned counts move. No parser scenario is relaxed, no assertion is
// deleted, and the inventory stays an exact deepEqual — which is the whole
// point of T-10: a parser blind to a lane must still red here.
// Two legitimate skips were added, neither of them a workaround:
//   * 20270523002489_issue_2489_address_privacy_server_gate.sql — added on this
//     gate's OWN remediation instruction, which names the exact filename form and
//     forbids removing the reference instead;
//   * 20270525002562_issue_2562_past_event_guard.sql — approved by the owner of
//     #2564, whose migration it is. On this lane the 12-argument re-emission does
//     not replace the 11-argument original, so an unfiltered probe reads the
//     guardless overload.
// ONLY the pinned counts move below. No assertion's logic, no parser case and no
// scenario was changed, so the blind-parser property these tests exist for is
// unaltered: a parser that reads fewer branches than exist still reds here.
//
// [TEST-MOD-APPROVED #2489] SECOND MOVE, phase 2: SIX to SEVEN. The added entry is
// 20270528002489_issue_2489_phase2_base_relation_grant.sql. It follows from the
// #2489 entry above rather than standing alone: phase 2 gives events_public_view
// owner rights so it survives the base-relation grant change, and on THIS lane the
// gated owner-rights definition of that view is supplied only by the already
// skipped …002489_…server_gate.sql — so the lane's own "Apply #1931 and re-capture"
// step puts the view back on caller rights and the SC-47 capture then dies on a
// permission error rather than on any behavioural difference. Reproduced before the
// entry was added, clean after. The #2117 lane was simulated with phase 2 present
// and needs no entry, so only this lane's count moves.
// Again ONLY counts move; every assertion, parser case and scenario is unchanged.
//
// [TEST-MOD-APPROVED #2723] THIRD MOVE: SEVEN to EIGHT. The old count became
// false because #2723 adds one valid exact skip for #2696 when #2160 is absent;
// the inventory assertion remains binding and no parser scenario is relaxed.
// [TEST-MOD-APPROVED #2728] The #2728 fix-forward is deliberately skipped
// before baseline and applied after corrected #2117; only the pinned inventory
// moves, and every parser, security, and containment assertion remains intact.
test("T-10 — lane inventory is exactly 4 lanes at 11/1/3/6 (a blind parser reds here)", () => {
  const { lanes, violations } = analyseLanes();
  assert.equal(violations.length, 0);

  const inventory = Object.fromEntries(lanes.map((l) => [l.workflow, l.globs.length]));
  assert.deepEqual(inventory, {
    "issue-1644-storage-guardrail-collage-fill-tests.yml": 1,
    "issue-1647-admin-mv-and-db-reclaim-tests.yml": 3,
    [LANE]: 11,
    "issue-2117-offering-visibility-gate-tests.yml": 6,
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

  // SC-2: the #1931 lane skips exactly eleven files, and ...002463 is NOT one.
  const pinned = lanes.find((l) => l.workflow === LANE);
  assert.equal(pinned.skipped.length, 11);
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

// ---------------------------------------------------------------------------
// R-5 / C-4(c) — added after the independent tester proved the two-line branch
// form is a LIVE fail-open, not a dormant spelling. Its evidence: an identical
// closure break written on one line fires C-1; written across two lines it
// produced ZERO violations while the break hid behind it. C-4(b) cannot rescue
// that — its trigger is ZERO globs, not FEWER — so a lane with four readable
// branches and one invisible one still yields globs and still reports clean.
// ---------------------------------------------------------------------------

test("T-23 — the two-line branch form is read, and its skip actually takes effect (R-5)", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      LANE,
      (src) =>
        src.replace(
          "            esac",
          "              *20270522002463_issue_2462_phone_backfill.sql)\n                continue ;;\n            esac",
        ),
    ],
  });

  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  const lane = lanes.find((l) => l.workflow === LANE);
  assert.equal(lane.branchCount, 12, "`<pattern>)` on one line and `continue ;;` on the next is one branch, not none");
  assert.equal(lane.globs.length, 12);
  assert.ok(
    lane.skipped.includes("20270522002463_issue_2462_phone_backfill.sql"),
    "reading the branch is not enough — the glob must actually resolve and skip the file",
  );
  assert.deepEqual(
    violations.map((v) => v.check),
    [],
    "a readable branch in a legal spelling must not flag",
  );
});

test("T-24 — C-4(c) reds on a branch the parser cannot read, where C-4(b) cannot", (t) => {
  // Three physical lines, so R-5's two-line matcher does not cover it either.
  // The seven readable branches still yield globs, so C-4(b) stays quiet by
  // construction — this is exactly the shape the census exists for.
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      LANE,
      (src) =>
        src.replace(
          "            esac",
          "              *_issue_0001_unreadable_*)\n                continue\n                ;;\n            esac",
        ),
    ],
  });

  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  const lane = lanes.find((l) => l.workflow === LANE);
  assert.equal(lane.branchCount, 11, "precondition: the 3-line branch really is unread");
  assert.ok(lane.globs.length > 0, "precondition: sibling branches still yield globs, so C-4(b) cannot fire");
  assert.equal(
    violations.some((v) => v.check === "C-4b"),
    false,
    "C-4(b) must NOT fire here — if it did, this test would not be exercising the gap C-4(c) closes",
  );
  assert.ok(
    violations.some((v) => v.check === "C-4c"),
    "under-counting must be detectable, not just zero-counting",
  );
});

test("T-25 — a real closure break hidden behind a two-line branch is now named", (t) => {
  // The tester's demonstration, reproduced end to end. X defines an object
  // nothing else defines; Y reads it from a `LANGUAGE sql` body; the lane skips
  // X through a two-line branch. X is not one of C-3's pinned branches, so C-3
  // cannot rescue it. Before R-5 this tree produced ZERO violations.
  const X = "29990101000003_issue_2492_demo_x.sql";
  const Y = "29990101000004_issue_2492_demo_y.sql";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2492-implementor-r5-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflowsDir = path.join(root, "workflows");
  const migrationsDir = path.join(root, "migrations");
  fs.cpSync(REAL_WORKFLOWS, workflowsDir, { recursive: true });
  fs.cpSync(REAL_MIGRATIONS, migrationsDir, { recursive: true });
  assert.ok(
    !path.resolve(workflowsDir).startsWith(REPO_ROOT + path.sep) &&
      !path.resolve(migrationsDir).startsWith(REPO_ROOT + path.sep),
    "fixture directories resolved INSIDE the repository — refusing to write",
  );
  const realBefore = realTreeDigest();
  t.after(() => assert.equal(realTreeDigest(), realBefore, "a fixture mutated the real repository directories"));

  fs.writeFileSync(
    path.join(migrationsDir, X),
    "CREATE OR REPLACE FUNCTION public.issue_2492_demo_only_here() RETURNS integer\nLANGUAGE sql IMMUTABLE AS $fn$ SELECT 1 $fn$;\n",
  );
  fs.writeFileSync(
    path.join(migrationsDir, Y),
    "CREATE OR REPLACE FUNCTION public.issue_2492_demo_reader() RETURNS integer\nLANGUAGE sql STABLE AS $fn$ SELECT public.issue_2492_demo_only_here() $fn$;\n",
  );
  const laneFile = path.join(workflowsDir, LANE);
  fs.writeFileSync(
    laneFile,
    fs.readFileSync(laneFile, "utf8").replace("            esac", `              *${X})\n                continue ;;\n            esac`),
  );

  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  const lane = lanes.find((l) => l.workflow === LANE);
  assert.ok(lane.skipped.includes(X), "the two-line skip must resolve, or the break cannot be seen at all");
  assert.ok(
    violations.some((v) => v.check === "C-1" && v.message.includes(Y) && v.message.includes("issue_2492_demo_only_here")),
    "C-1 must name the migration and the object the filtered chain cannot supply",
  );
});

// #2723 implementor-owned regression proof. This pins the real repository's
// exact skip and independently proves C-3 fails when only that branch is
// removed from a full-copy fixture. The fixture helper's digest assertion
// verifies both real directories remain byte-identical after teardown.
test("T-2723-I1/I2/I3 — exact #2696 skip is present and C-3 fails on its revert", (t) => {
  const real = analyseLanes();
  assert.deepEqual(real.violations, [], "the real repository must be clean before the revert fixture runs");

  const lane = real.lanes.find((candidate) => candidate.workflow === LANE);
  assert.ok(lane, "the #1931 filtered replay lane must exist");
  assert.equal(lane.globs.length, 11, "the #1931 lane must expose exactly eleven skip globs");
  assert.equal(lane.skipped.length, 11, "those eleven globs must resolve exactly eleven skipped migrations");
  assert.ok(lane.globs.includes(ISSUE_2723_EXACT_GLOB), "the exact #2696 filename glob must be present");
  assert.ok(lane.skipped.includes(ISSUE_2723_MIGRATION), "the exact #2696 migration must resolve as skipped");
  assert.equal(
    lane.globs.some((glob) => glob.includes("_issue_2696_") && glob !== ISSUE_2723_EXACT_GLOB),
    false,
    "a broad issue-number #2696 glob must never replace the exact filename",
  );

  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      LANE,
      (src) => src.replace(new RegExp(`^.*${ISSUE_2723_MIGRATION.replace(/\./g, "\\.")}\\) continue ;;\\n`, "m"), ""),
    ],
  });
  const reverted = analyseLanes({ workflowsDir, migrationsDir });
  const c3 = reverted.violations.filter((violation) => violation.check === "C-3");
  assert.ok(c3.length >= 1, "C-3 must fail when only the exact #2696 skip is reverted");
  assert.ok(
    c3.some((violation) => violation.message.includes(ISSUE_2723_EXACT_GLOB)),
    "C-3 must name the missing exact #2696 pattern",
  );
});
