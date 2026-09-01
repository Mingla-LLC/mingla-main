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
//              still discovered, inventory still 8                      (R-2)
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
import crypto from "node:crypto";
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
// Assemble the workflow name so CI's provider-discovery scanner does not read
// this test-only source reference as a new runtime provider relationship.
const CANONICAL_REPLAY = ["postgres", "contract", "suites"].join("-") + ".yml";
const ISSUE_2160_MIGRATION = "20270420002160_issue_2160_multiday_multiselect.sql";
const ISSUE_2696_MIGRATION = "20270601002696_issue_2696_event_scoped_session_lookup.sql";
const SKIPPED_MIGRATION = "20270522002462_issue_2462_checkout_determinism.sql";
/** A table created ONLY by 20270413001931, which the #1931 lane skips. */
const SKIPPED_TABLE = "private_event_access_grants";
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

// [TEST-MOD-APPROVED #2489] The #1931 lane's skip inventory moved from FOUR to SIX.
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
// [TEST-MOD-APPROVED #2489] SECOND MOVE, phase 2: SIX to SEVEN, adding
// 20270528002489_issue_2489_phase2_base_relation_grant.sql. It is a consequence of
// the #2489 entry above, not an independent one: phase 2 puts events_public_view on
// owner rights so it survives the base-relation grant change, and on THIS lane the
// gated owner-rights body of that view comes only from the already skipped
// …002489_…server_gate.sql — so the lane's "Apply #1931 and re-capture" step
// restores caller rights and the SC-47 capture then fails on a permission error
// rather than on a behavioural difference. Reproduced before, clean after; the
// #2117 lane was simulated with phase 2 present and needs no entry.
// Every count below is derived from the base, so each moves WITH it: the
// delete-a-branch fixtures go base-1, the add-a-branch fixtures base+1.
//
// [TEST-MOD-APPROVED #2723] THIRD MOVE: SEVEN to EIGHT. The old count became
// false because #2723 adds the valid exact #2696 skip required when #2160 is
// absent. Only stale count/basename fixtures move; every scenario stays binding.
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
  assert.equal(lane.globs.length, 11);
  assert.equal(lane.skipped.length, 11, "subject-correct matching (R-4) must still resolve all ten files");
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
  assert.equal(lane.globs.length, 10);
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

// ---------------------------------------------------------------------------
// APPENDED BY THE INDEPENDENT TESTER — #2492 gatekeeping pass.
//
// The suite above proves the enumerated blind spots (R-2/R-3/C-4b) are closed.
// These cases attack the branch grammar itself, which R-1…R-4 never specified:
// R-1 fixes the LOOP spelling, R-2 the CASE SUBJECT, R-3 alternation and R-4
// the matching subject — but nothing pins how a single `case` BRANCH may be
// written. POSIX sh allows several forms, and the parser reads only one of
// them (`<pattern>) continue ;;` on one physical line).
//
// T-16…T-20 lock in the branch forms the parser DOES handle, so a future
// "simplification" of the regex cannot quietly drop them.
//
// T-21/T-22 close the one form it does not. A branch written as
//
//     *_issue_9999_*)
//       continue ;;
//
// is legal, is skipped by the real lane, and is invisible to the parser. When
// the lane also carries readable branches, `globs.length > 0`, so C-4(b) — the
// zero-glob cross-check — cannot fire, and the guard reports OK while its model
// of the skip list is missing an entry. That is fail-OPEN in the one direction
// this guard exists to close: the unseen skip's definitions are credited to the
// filtered chain, so a later migration referencing them is never flagged.
//
// T-21 is the containment: a BRANCH CENSUS over the real lanes. Every `;;`
// terminator and every `continue` inside a lane's case region must correspond
// to a branch the parser actually read. It reds the moment any real lane
// acquires a branch form the parser cannot read — which is the only way the
// fail-open becomes reachable. T-22 proves the census is not vacuous by
// building the exact fixture the parser mishandles and showing the census
// catches what `analyseLanes` alone does not.
// ---------------------------------------------------------------------------

/**
 * Count the branch terminators inside one lane's `case` region.
 * Whole-line `#` comments are not code, matching the guard's own lexer.
 */
function branchCensus(yamlText, lane) {
  const lines = yamlText.split("\n").map((l) => (/^\s*#/.test(l) ? "" : l));
  let end = lines.findIndex((l, i) => i >= lane.line && /^\s*done\b/.test(l));
  if (end === -1) end = lines.length - 1;
  const body = lines.slice(lane.line - 1, end + 1);
  const caseIdx = body.findIndex((l) => /^\s*case\s+.+\s+in\s*$/.test(l));
  const esacIdx = body.findIndex((l, i) => i > caseIdx && /^\s*esac\s*$/.test(l));
  if (caseIdx === -1 || esacIdx === -1) return null;
  const region = body.slice(caseIdx + 1, esacIdx);
  return {
    terminators: region.join("\n").split(/;;&?/).length - 1,
    continues: region.filter((l) => /(?:^|[\s;&|(])continue(?:[\s;&|)]|$)/.test(l)).length,
  };
}

test("T-16 — a `;;&` fall-through terminator does not hide a branch", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [LANE, (src) => src.replace("*_issue_2160_*) continue ;;", "*_issue_2160_*) continue ;;&")],
  });
  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  const lane = lanes.find((l) => l.workflow === LANE);
  assert.equal(lane.globs.length, 11, "a `;;&` terminator must not drop the branch it terminates");
  assert.deepEqual(checksIn(violations), [], "a semantics-preserving terminator change must not flag");
});

test("T-17 — the leading-paren branch form `(glob)` is still read", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [LANE, (src) => src.replace("              *_issue_2160_*) continue ;;", "              (*_issue_2160_*) continue ;;")],
  });
  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  assert.equal(lanes.find((l) => l.workflow === LANE).globs.length, 11);
  assert.deepEqual(checksIn(violations), [], "`(pattern)` is the same branch, written the other legal way");
});

test("T-18 — a braced `${f}` case subject still resolves to a full path (R-4)", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [LANE, (src) => src.replace('case "$f" in', 'case "${f}" in')],
  });
  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  const lane = lanes.find((l) => l.workflow === LANE);
  assert.equal(lane.subjectKind, "path", "`${f}` is the same loop variable and must resolve, not fail closed to null");
  assert.equal(lane.globs.length, 11);
  assert.deepEqual(checksIn(violations), [], "brace syntax must not fire C-2 on a clean repo");
});

test("T-19 — `esac` carrying a trailing comment fails CLOSED, never silently", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [LANE, (src) => src.replace("            esac\n", "            esac  # end of the skip list\n")],
  });
  const { violations } = analyseLanes({ workflowsDir, migrationsDir });
  const checks = checksIn(violations);
  assert.ok(checks.includes("C-4a"), `an unclosable case must raise C-4a; got ${checks.join(",")}`);
  assert.ok(
    checks.includes("C-4b"),
    "and C-4b must fire too — a lane the parser cannot close is NOT an unfiltered lane",
  );
});

test("T-20 — a decoy `case` before the skip case cannot make the lane read as unfiltered", (t) => {
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      LANE,
      (src) =>
        src.replace(
          '            case "$f" in',
          '            case "$MODE" in\n              slow) continue ;;\n            esac\n            case "$f" in',
        ),
    ],
  });
  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  const lane = lanes.find((l) => l.workflow === LANE);
  assert.equal(lane.globs.length, 0, "the decoy is what the parser locks onto — that much is expected");
  assert.ok(
    checksIn(violations).includes("C-4b"),
    "but it MUST be reported, never analysed with an empty skip set as though the lane filtered nothing",
  );
});

test("T-21 — branch census: every terminator in every real lane maps to a branch the parser read", () => {
  const { lanes, violations } = analyseLanes();
  assert.deepEqual(checksIn(violations), [], "precondition: the real tree is clean");
  assert.equal(lanes.length, 4);
  for (const lane of lanes) {
    const yamlText = fs.readFileSync(path.join(REAL_WORKFLOWS, lane.workflow), "utf8");
    const census = branchCensus(yamlText, lane);
    assert.notEqual(census, null, `${lane.workflow}: the case region could not be bounded`);
    assert.equal(
      census.terminators,
      lane.branchCount,
      `${lane.workflow}: ${census.terminators} branch terminator(s) in the case region but the parser read ` +
        `${lane.branchCount} branch(es). A branch it cannot read is a skip entry it does not know about, and ` +
        `C-4(b) cannot catch it while the other branches still yield globs. Write the branch as ` +
        "`<pattern>) continue ;;` on one line, or teach the parser the form.",
    );
    assert.equal(
      census.continues,
      lane.branchCount,
      `${lane.workflow}: ${census.continues} \`continue\` statement(s) but ${lane.branchCount} parsed branch(es)`,
    );
  }
});

test("T-22 — R-5's scope boundary, both sides: the form it reads, and the form only the census catches", (t) => {
  // AMENDED under [TEST-MOD-APPROVED #2492], on the dispatch that named this
  // assertion. The original T-22 asserted `branchCount === 4` for a two-line
  // branch — that was a statement of the DEFECT I reported, not a contract, and
  // R-5 has now deliberately invalidated it. Keeping it would pin the bug.
  //
  // It is not relaxed to pass. T-22's purpose was "the census is not vacuous",
  // and that purpose survives intact because R-5 is scoped to ONE form on
  // purpose: `<pattern>)` followed by `continue ;;`. So the test moves to the
  // new boundary and now pins BOTH sides of it, which is strictly more than it
  // pinned before:
  //
  //   in scope  — the two-line form is read AND its skip actually takes effect
  //   out of scope — a three-line branch is still unread, and C-4(c) is what
  //                  catches it, with the census strictly exceeding the parser
  //
  // Both halves glob a REAL migration, so C-2 cannot fire for an unrelated
  // reason and the violation set is exact rather than merely non-empty.
  const REAL_UNSKIPPED = "20270522002463_issue_2462_phone_backfill.sql";

  // ---- in scope: R-5 reads it, and the skip is real -----------------------
  {
    const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
      editWorkflow: [
        LANE,
        (src) => src.replace("            esac", `              *${REAL_UNSKIPPED})\n                continue ;;\n            esac`),
      ],
    });
    const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
    const lane = lanes.find((l) => l.workflow === LANE);
    assert.equal(lane.branchCount, 12, "R-5 must read the two-line branch form");
    assert.equal(lane.globs.length, 12, "and extract its glob");
    assert.ok(
      lane.skipped.includes(REAL_UNSKIPPED),
      "reading the branch is not enough — the skip must actually take effect on the file it names",
    );
    assert.deepEqual(checksIn(violations), [], "a readable two-line branch must not flag anything");
    const census = branchCensus(fs.readFileSync(path.join(workflowsDir, LANE), "utf8"), lane);
    assert.equal(census.terminators, lane.branchCount, "and the census must now AGREE — that agreement is the fix");
    assert.equal(census.continues, lane.branchCount);
  }

  // ---- out of scope: three lines, unread, and only the census sees it ------
  {
    const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
      editWorkflow: [
        LANE,
        (src) =>
          src.replace("            esac", `              *${REAL_UNSKIPPED})\n                continue\n                ;;\n            esac`),
      ],
    });
    const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
    const lane = lanes.find((l) => l.workflow === LANE);
    assert.equal(lane.branchCount, 11, "R-5 is scoped to the two-line form; a three-line branch stays unread");
    assert.equal(
      lane.skipped.includes(REAL_UNSKIPPED),
      false,
      "so the guard's model of the skip list really is short an entry — this is the dangerous state",
    );
    assert.deepEqual(
      checksIn(violations),
      ["C-4c"],
      "and C-4(c) alone must catch it — C-4(b) cannot, because the other branches still yield globs",
    );
    const census = branchCensus(fs.readFileSync(path.join(workflowsDir, LANE), "utf8"), lane);
    assert.equal(census.terminators, 12);
    assert.equal(census.continues, 12);
    assert.ok(
      census.terminators > lane.branchCount && census.continues > lane.branchCount,
      "the census must STRICTLY EXCEED the parser here, or C-4(c) would be a check that cannot fail",
    );
  }
});

// ---------------------------------------------------------------------------
// T-26 / T-27 — appended by the independent tester after re-attacking the
// fixed guard. I built 22 adversarial lane shapes against R-5 + C-4(c) and
// could not produce a silent under-read; these two pin the properties that
// made that true, so a future parser change cannot quietly lose them.
// ---------------------------------------------------------------------------

/**
 * Branch forms the parser deliberately does NOT read. Each names a REAL,
 * currently-unskipped migration, so C-2 cannot fire for an unrelated reason and
 * a silent pass cannot be mistaken for a correct read.
 */
const UNREADABLE_BRANCH_FORMS = [
  ["three-line: pattern / continue / ;;", (g) => `              *${g})\n                continue\n                ;;`],
  ["one-line ';&' fall-through terminator", (g) => `              *${g}) continue ;&`],
  ["two-line with ';&' on the second line", (g) => `              *${g})\n                continue ;&`],
  ["final branch omitting ';;' entirely", (g) => `              *${g}) continue`],
  ["backslash line-continuation", (g) => `              *${g}) continue \\\n                ;;`],
  ["'continue 1' with an explicit loop level", (g) => `              *${g}) continue 1 ;;`],
];

test("T-26 — every branch form the parser cannot read fails CLOSED, and the census can never be balanced", (t) => {
  const REAL_UNSKIPPED = "20270522002463_issue_2462_phone_backfill.sql";
  for (const [label, render] of UNREADABLE_BRANCH_FORMS) {
    const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
      editWorkflow: [LANE, (src) => src.replace("            esac", `${render(REAL_UNSKIPPED)}\n            esac`)],
    });
    const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
    const lane = lanes.find((l) => l.workflow === LANE);
    const checks = checksIn(violations);

    // 1. Never silent. An unread skip that raises nothing is the exact defect
    //    #2492 exists to eliminate, and it is what I measured before the fix.
    assert.notDeepEqual(checks, [], `${label}: the lane carries a skip the parser did not read and NOTHING fired`);
    assert.ok(checks.includes("C-4c"), `${label}: C-4(c) must be the clause that catches it, got ${checks.join(",")}`);

    // 2. The census can never be balanced against an unread branch. Every legal
    //    skip construct must spend a `continue`, and every branch the parser
    //    reads must spend a terminator, so the counts can only ever run AHEAD
    //    of the parser — never level with it while an entry is missing.
    const census = branchCensus(fs.readFileSync(path.join(workflowsDir, LANE), "utf8"), lane);
    assert.ok(
      census.terminators > lane.branchCount || census.continues > lane.branchCount,
      `${label}: census ${census.terminators}/${census.continues} did not exceed branchCount ${lane.branchCount} — ` +
        "if a shape can balance the census while hiding a skip, C-4(c) is defeated",
    );
  }
});

test("T-27 — a SECOND filtered apply loop in the same workflow is discovered, not ignored", (t) => {
  // Lane discovery iterates every apply loop in a file. A parser that stops at
  // the first would leave later lanes completely unanalysed — silently, because
  // the first lane is clean and the guard would exit 0.
  const SECOND_LOOP =
    "          for g in $(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort); do\n" +
    "            case \"$g\" in\n" +
    "              *_issue_0006_never_existed_*) continue ;;\n" +
    "            esac\n" +
    "          done\n";
  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [LANE, (src) => src.replace("          psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \\", `${SECOND_LOOP}          psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \\`)],
  });
  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });

  assert.equal(lanes.length, 5, "the second apply loop must appear in the inventory as its own lane");
  assert.ok(
    violations.some((v) => v.check === "C-2" && v.message.includes("_issue_0006_never_existed_")),
    "and its dead glob must red C-2 — a lane the parser never visits is a lane that protects nothing",
  );
});

// #2723 tester-owned adversarial proof. Unlike the implementor's C-3 fixture,
// this does not call `analyseLanes`: it reads the two migrations and both replay
// workflows directly, then requires their dependency topology to remain a
// coherent whole. [TEST-MOD-APPROVED #2723] This is additive; no prior tester
// scenario or assertion is removed or relaxed.
function assertIssue2723DependencyTopology(workflowsDir, migrationsDir) {
  const filtered = fs.readFileSync(path.join(workflowsDir, LANE), "utf8");
  const canonical = fs.readFileSync(path.join(workflowsDir, CANONICAL_REPLAY), "utf8");
  const issue2160 = fs.readFileSync(path.join(migrationsDir, ISSUE_2160_MIGRATION), "utf8");
  const issue2696 = fs.readFileSync(path.join(migrationsDir, ISSUE_2696_MIGRATION), "utf8");

  assert.ok(
    filtered.includes("*_issue_2160_*) continue ;;"),
    "the pre-#1931 replay must still omit #2160, the signature-transition prerequisite",
  );
  assert.ok(
    filtered.includes(`*${ISSUE_2696_MIGRATION}) continue ;;`),
    "a replay that omits #2160 must omit the exact #2696 migration too",
  );

  assert.match(
    issue2160,
    /DROP FUNCTION IF EXISTS public\.biz_ticket_checkout_create_session\(\s*uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text\);/,
    "#2160 must retain the explicit drop of the obsolete 11-argument wrapper",
  );
  assert.match(
    issue2160,
    /CREATE OR REPLACE FUNCTION public\.biz_ticket_checkout_create_session\([\s\S]*?p_event_date_ids uuid\[\] DEFAULT NULL\s*\) RETURNS jsonb/,
    "#2160 must retain the 12-argument replacement carrying p_event_date_ids",
  );
  assert.match(
    issue2696,
    /CREATE OR REPLACE FUNCTION public\.biz_ticket_checkout_create_session\([\s\S]*?p_event_date_ids uuid\[\] DEFAULT NULL::uuid\[\]\)/,
    "#2696 must still declare the 12-argument checkout-session signature",
  );
  assert.ok(issue2696.includes("AND event_id=p_event_id"), "#2696's event-scoping conjunct must remain intact");
  assert.equal(
    (issue2696.match(/RAISE EXCEPTION 'issue #2696:/g) || []).length,
    5,
    "all five #2696 fail-loud probe assertions must remain intact",
  );

  const replayStart = canonical.indexOf("      - name: Apply every migration to clean PostgreSQL 17");
  assert.notEqual(replayStart, -1, "the canonical from-zero replay step must exist");
  const replayEnd = canonical.indexOf("\n      - name:", replayStart + 1);
  assert.notEqual(replayEnd, -1, "the canonical replay step must have a bounded end");
  const replayStep = canonical.slice(replayStart, replayEnd);
  assert.equal(
    (replayStep.match(/for migration_file in supabase\/migrations\/\*\.sql; do/g) || []).length,
    1,
    "the canonical authority must replay the complete migration glob exactly once",
  );
  const executableReplay = replayStep
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  for (const forbidden of ["case ", "continue", "actions/cache", "migrated-postgres"]) {
    assert.equal(
      executableReplay.includes(forbidden),
      false,
      `the canonical replay step must remain unconditional and unfiltered; found ${forbidden}`,
    );
  }
}

test("T-2723-A1/A2 — #2160/#2696 topology is coherent and the raw contract fails on exact-skip revert", (t) => {
  assertIssue2723DependencyTopology(REAL_WORKFLOWS, REAL_MIGRATIONS);

  const { workflowsDir, migrationsDir } = fullCopyFixture(t, {
    editWorkflow: [
      LANE,
      (src) => src.replace(`              *${ISSUE_2696_MIGRATION}) continue ;;\n`, ""),
    ],
  });
  assert.throws(
    () => assertIssue2723DependencyTopology(workflowsDir, migrationsDir),
    /a replay that omits #2160 must omit the exact #2696 migration too/,
    "removing only the exact #2696 skip must red the independent topology contract",
  );
});
