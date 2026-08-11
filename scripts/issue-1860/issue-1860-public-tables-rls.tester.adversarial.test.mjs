/**
 * Issue #1860 — TESTER adversarial suite for the public-tables RLS gate.
 *
 * This attacks a DIFFERENT ANGLE from the implementor's in-gate `--self-test`.
 * That suite drives fifteen hand-built fixtures through `runChecks`. Every one of
 * its assertions is about SYNTHETIC sql, so all fifteen would still pass if the
 * real migration chain were reverted tomorrow — the gate's own exit code is the
 * only thing tying it to this repo. A gate that is only ever exercised against
 * fixtures it ships with is a gate that has never been asked a question it did
 * not already know the answer to.
 *
 * So this suite asks about the REAL chain, and it anchors the answer:
 *
 *   A — the real chain leaves no public table without RLS, AND the #1860
 *       migration is provably the thing making that true (replay the chain with
 *       that one file removed and the same assertion must FAIL). Without the
 *       anchor, "zero violations" is equally consistent with a parser that has
 *       stopped seeing tables — which is exactly the failure mode that let the
 *       predecessor audit sit green for months.
 *   B — the exemption cannot be laundered. Exact-match only, no prefix / case /
 *       substring variant, and — the one that matters most — the allowlist JSON
 *       is NOT consulted when deciding whether a table is in violation. Writing
 *       a name into that file cannot excuse a table; it can only fail C2.
 *   C — an enable cannot be FAKED at statement level. A table is not laundered
 *       green by prose that merely contains the enable text.
 *   D — the suite itself is falsifiable and is reading a real chain.
 *
 * Scope note recorded deliberately: this suite asserts what the STATIC half can
 * see. `pg_class.relrowsecurity` on the applied schema is the live half's job
 * (`supabase/migrations/__tests__/issue_1860_public_rls_coverage.test.sql`), and
 * neither half is a substitute for the other.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  replayChain,
  runChecks,
} from "../../.github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const ALLOWLIST_PATH = join(ROOT, "scripts", "audit", "rls-allowlist.json");
/**
 * #1860 REWORK, [TEST-MOD-APPROVED #1860] — INVERTED PIN, not a weakened one.
 *
 * This suite was written against a gate whose C6 rule policed the CONTENTS of
 * the predecessor audit for one spelling of its prefix-skip laundering channel
 * (finding F-4: a regex spelling walked straight past it). On this suite's own
 * recommendation, and with the orchestrator's approval, that file was RETIRED
 * AND DELETED at REWORK, and C6 was restated as "it must not come back."
 *
 * So the pin flips with it: where this suite required the audit's source to be
 * READ and to be load-bearing, it now requires the file to be ABSENT and its
 * RESURRECTION to fail the gate. That is strictly stronger — no spelling can
 * walk past a file that does not exist — and it is the same assertion pointed
 * the other way, not a removed one.
 */
const RETIRED_AUDIT_PATH = join(ROOT, "scripts", "audit", "rls-coverage.mjs");
const WORKFLOW_PATH = join(
  ROOT,
  ".github",
  "workflows",
  "supabase-migrations-and-stripe-deno.yml",
);

/** The forward-only migration this issue shipped. Identified by name, not by index. */
const FIX_MIGRATION_MARKER = "_issue_1860_enable_rls_on_unprotected_public_tables.sql";

/** Floors. These are anti-vacuity anchors, not targets. Never lower one to clear a red. */
const MIN_MIGRATION_FILES = 400;
const MIN_LIVE_TABLES = 300;
const MIN_TABLES_THE_FIX_COVERS = 10;

function loadMigrations({ includeFix = true } = {}) {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (includeFix ? true : !f.endsWith(FIX_MIGRATION_MARKER)))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
}

function realInputs(over = {}) {
  return {
    files: loadMigrations(),
    allowlistJson: JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")),
    workflowText: readFileSync(WORKFLOW_PATH, "utf8"),
    // null is the CORRECT state: the retired audit is gone (see the note above).
    retiredAuditSource: existsSync(RETIRED_AUDIT_PATH)
      ? readFileSync(RETIRED_AUDIT_PATH, "utf8")
      : null,
    enforceFloor: true,
    ...over,
  };
}

/** Tables the replay leaves alive in `public` with no RLS enable anywhere. */
function unprotected(files) {
  const { live, rlsOn } = replayChain(files);
  return [...live].filter((t) => !rlsOn.has(t)).sort();
}

/** A minimal well-formed chain, used as the carrier for statement-level probes. */
function carrier(extraSql) {
  return [
    {
      name: "001_carrier.sql",
      sql:
        `CREATE TABLE public.carrier_anchor (id uuid);\n` +
        `ALTER TABLE public.carrier_anchor ENABLE ROW LEVEL SECURITY;\n` +
        extraSql,
    },
  ];
}

const FIXTURE_INPUTS = {
  allowlistJson: { tables: ["spatial_ref_sys"] },
  workflowText: "supabase/migrations/__tests__/issue_1860_public_rls_coverage.test.sql",
  retiredAuditSource: null,
  enforceFloor: false,
};

// ---------------------------------------------------------------------------
// A — the real chain, anchored to the fix.
// ---------------------------------------------------------------------------

test("#1860 adversarial A1: the real migration chain leaves NO public table without RLS", () => {
  const files = loadMigrations();
  assert.ok(
    files.length >= MIN_MIGRATION_FILES,
    `read only ${files.length} migrations; the suite is not looking at the real chain`,
  );

  const { live, rlsOn, createCount, enableCount } = replayChain(files);
  assert.ok(createCount > 0, "replayed zero CREATE TABLE statements — parser regression, not a pass");
  assert.ok(enableCount > 0, "replayed zero ENABLE statements — parser regression, not a pass");
  assert.ok(
    live.size >= MIN_LIVE_TABLES,
    `chain replayed to only ${live.size} live public tables; below the anti-vacuity floor`,
  );
  assert.ok(rlsOn.size >= MIN_LIVE_TABLES, `only ${rlsOn.size} tables carry an RLS enable`);

  assert.deepEqual(
    unprotected(files),
    [],
    "at least one public table is created by the chain and never gets ENABLE ROW LEVEL SECURITY",
  );
});

test("#1860 adversarial A2: the real repo satisfies every rule of the gate, not just C1", () => {
  assert.deepEqual(runChecks(realInputs()), []);
});

test("#1860 adversarial A3 [ANCHOR]: remove the #1860 migration and A1 must FAIL", () => {
  // The point of this test. A1 passing is only meaningful if it is capable of
  // failing on this chain — if the same replay reports zero violations with the
  // fix removed, then A1 is measuring the parser's blindness, not the schema.
  const withFix = loadMigrations({ includeFix: true });
  const withoutFix = loadMigrations({ includeFix: false });

  assert.equal(
    withFix.length - withoutFix.length,
    1,
    `expected exactly one migration matching ${FIX_MIGRATION_MARKER}`,
  );

  const before = unprotected(withoutFix);
  const after = unprotected(withFix);

  assert.ok(
    before.length >= MIN_TABLES_THE_FIX_COVERS,
    `with the #1860 migration removed only ${before.length} tables report unprotected; ` +
      `the fix is not load-bearing, so A1 proves nothing`,
  );
  assert.deepEqual(after, [], "with the fix applied the chain must be clean");

  // Every table the removal exposes must be one the fix itself covers — no more,
  // no fewer. This is what stops the anchor from being satisfied by an unrelated
  // regression somewhere else in the chain.
  const fixFile = withFix.find((f) => f.name.endsWith(FIX_MIGRATION_MARKER));
  const { rlsOn: enabledByFix } = replayChain([
    { name: "000_seed.sql", sql: before.map((t) => `CREATE TABLE public.${t} (id uuid);`).join("\n") },
    fixFile,
  ]);
  for (const t of before) {
    assert.ok(enabledByFix.has(t), `public.${t} is exposed by removing the fix but the fix does not enable it`);
  }
});

// ---------------------------------------------------------------------------
// B — the exemption cannot be laundered.
// ---------------------------------------------------------------------------

test("#1860 adversarial B1: exemption matching is EXACT — no prefix, suffix, case or substring variant is excused", () => {
  // The predecessor audit excused an unbounded family of tables via a prefix
  // test. Prove the replacement excuses exactly one literal name and nothing
  // that merely resembles it.
  const nearMisses = [
    "spatial_ref_sys_backup",
    "my_spatial_ref_sys",
    "spatial_ref_sy",
    "spatial_ref_syss",
    "SPATIAL_REF_SYS",
    "Spatial_Ref_Sys",
    "spatial_ref__sys",
  ];

  for (const name of nearMisses) {
    const failures = runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(`CREATE TABLE public.${name} (id uuid);`),
    });
    assert.ok(
      failures.some((f) => f.includes(`C1: public.${name}`)),
      `public.${name} was excused by the exemption; only the exact reviewed name may be`,
    );
  }
});

test("#1860 adversarial B2 [LAUNDERING]: writing a table into the allowlist JSON does NOT excuse it", () => {
  // The sharpest version of "the exemption cannot be quietly grown". The
  // allowlist file is checked for equality against the reviewed set; it is never
  // consulted when deciding whether a table is in violation. So the obvious
  // laundering move — add the name to the JSON — cannot work even for the one
  // commit before review notices. It fails C2 AND the table is still reported.
  const failures = runChecks({
    ...FIXTURE_INPUTS,
    allowlistJson: { tables: ["spatial_ref_sys", "laundered_table"] },
    files: carrier(`CREATE TABLE public.laundered_table (id uuid);`),
  });

  assert.ok(
    failures.some((f) => f.includes("C1: public.laundered_table")),
    "a table named in the allowlist JSON escaped the rule; the JSON must not be able to excuse anything",
  );
  assert.ok(
    failures.some((f) => f.startsWith("C2:")),
    "growing the allowlist JSON must also fail C2",
  );
});

test("#1860 adversarial B3: the reviewed exemption set is exactly one name, and the JSON agrees with it", () => {
  const declared = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")).tables;
  assert.ok(Array.isArray(declared), "rls-allowlist.json must carry a tables array");
  assert.equal(declared.length, 1, `the exemption list holds ${declared.length} names; exactly one is reviewed`);

  // Any drift between the file and the gate's constant is a failure in BOTH
  // directions — shrinking it to nothing is as much a change as growing it.
  assert.deepEqual(runChecks(realInputs({ allowlistJson: { tables: [] } })).filter((f) => f.startsWith("C2:")).length, 1);
  assert.deepEqual(
    runChecks(realInputs({ allowlistJson: { tables: [...declared, "another_name"] } })).filter((f) =>
      f.startsWith("C2:"),
    ).length,
    1,
  );
});

// ---------------------------------------------------------------------------
// C — an enable cannot be faked at statement level.
// ---------------------------------------------------------------------------

test("#1860 adversarial C1: prose containing the enable text does not launder a table green", () => {
  // The mirror of the trap the gate was built for. The predecessor audit read
  // DDL out of a COMMENT body; the inverse mistake — reading an ENABLE out of
  // prose — would let anyone turn a red green by writing a sentence.
  const probes = [
    ["line comment", `-- ALTER TABLE public.faked ENABLE ROW LEVEL SECURITY;`],
    ["block comment", `/* ALTER TABLE public.faked ENABLE ROW LEVEL SECURITY; */`],
    [
      "table COMMENT body",
      `COMMENT ON TABLE public.faked IS 'ALTER TABLE public.faked ENABLE ROW LEVEL SECURITY';`,
    ],
    [
      "column COMMENT body",
      `COMMENT ON COLUMN public.faked.id IS 'see ALTER TABLE public.faked ENABLE ROW LEVEL SECURITY';`,
    ],
  ];

  for (const [label, prose] of probes) {
    const failures = runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(`CREATE TABLE public.faked (id uuid);\n${prose}`),
    });
    assert.ok(
      failures.some((f) => f.includes("C1: public.faked")),
      `an enable written as ${label} was counted as a real enable`,
    );
  }
});

test("#1860 adversarial C2: a real statement-level enable IS counted, in both spellings the chain uses", () => {
  // The necessary other half of C1: proving prose is ignored is worthless if
  // genuine DDL is ignored too. Both quoting styles, plus the ONLY / IF EXISTS
  // spellings, must resolve.
  const spellings = [
    `ALTER TABLE public.real_one ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE "public"."real_one" ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ONLY public.real_one ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE IF EXISTS public.real_one ENABLE ROW LEVEL SECURITY;`,
  ];

  for (const spelling of spellings) {
    const failures = runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(`CREATE TABLE public.real_one (id uuid);\n${spelling}`),
    });
    assert.deepEqual(failures, [], `a genuine enable spelled "${spelling}" was not counted`);
  }
});

// ---------------------------------------------------------------------------
// D — the suite is falsifiable.
// ---------------------------------------------------------------------------

test("#1860 adversarial D1 [VACUITY]: the harness reports failures when handed a broken chain", () => {
  // If this ever passes an obviously broken input, every green above is noise.
  const failures = runChecks({
    ...FIXTURE_INPUTS,
    files: carrier(`CREATE TABLE public.definitely_unprotected (id uuid);`),
  });
  assert.ok(failures.length > 0, "the harness reported no failures on a table with no RLS enable");
  assert.ok(failures.some((f) => f.includes("C1: public.definitely_unprotected")));
});

test("#1860 adversarial D2 [VACUITY]: the real-input harness is wired to real files, not defaults", () => {
  const inputs = realInputs();
  assert.ok(inputs.files.length >= MIN_MIGRATION_FILES);
  assert.ok(inputs.workflowText.includes("issue_1860_public_rls_coverage.test.sql"), "live half not wired");
  assert.equal(typeof inputs.allowlistJson, "object");

  // INVERTED at #1860 REWORK, [TEST-MOD-APPROVED #1860]. The retired audit must
  // be ABSENT, and its return must fail the gate. Previously this required the
  // file to be READ and nulling it to fail — the exact opposite, because C6 then
  // policed one spelling inside a file that has since been deleted (F-4).
  assert.equal(
    inputs.retiredAuditSource,
    null,
    "scripts/audit/rls-coverage.mjs is back on disk; it was retired at #1860 and must stay retired",
  );
  assert.ok(
    runChecks(realInputs({ retiredAuditSource: "anything at all" })).some((f) => f.startsWith("C6:")),
    "resurrecting the retired audit does not fail the gate; C6 is not actually enforced",
  );

  // And prove the remaining real input is load-bearing: nulling it must produce
  // a failure, so a future refactor cannot quietly stop reading it.
  for (const key of ["workflowText"]) {
    assert.ok(
      runChecks(realInputs({ [key]: null })).length > 0,
      `${key} can be null without failing the gate; it is not actually enforced`,
    );
  }
});

// ---------------------------------------------------------------------------
// E — the REWORK surface (appended at #1860 RETEST, pure additions).
//
// F-1/F-2/F-3 were closed by rebuilding the parser around one structural claim:
// a string is DDL when Postgres is told to run it, and at no other time. These
// cases lock that claim and the two rules it rests on, so the fixes cannot
// silently regress the way the guarantee they replaced did. Every case below is
// a defect this file has actually had.
// ---------------------------------------------------------------------------

import { stripYamlComments } from "../../.github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs";

/** This file, as the gate and the workflow name it. */
const SUITE_REL = "scripts/issue-1860/issue-1860-public-tables-rls.tester.adversarial.test.mjs";
const ADVERSARIAL_WORKFLOW_PATH = join(ROOT, ".github", "workflows", "issue-1860-rls-coverage-tests.yml");

test("#1860 adversarial E1 [R2]: prose inside a DO body cannot fake an enable or hide a table, in EITHER quoting form", () => {
  // The F-1 defect. Literals inside DO bodies were handed to the DDL regexes
  // raw, so this failed both ways at once. Both spellings are covered because
  // the chain really does use dollar-quoted EXECUTE arguments — a masker that
  // knew only about single quotes would have left the hole open behind the fix.
  const fakeEnable = [
    ["single-quoted RAISE NOTICE", `DO $b$ BEGIN RAISE NOTICE 'ALTER TABLE public.naked ENABLE ROW LEVEL SECURITY'; END $b$;`],
    ["dollar-quoted RAISE NOTICE", `DO $b$ BEGIN RAISE NOTICE $m$ALTER TABLE public.naked ENABLE ROW LEVEL SECURITY$m$; END $b$;`],
    ["variable assignment", `DO $b$ DECLARE s text; BEGIN s := 'ALTER TABLE public.naked ENABLE ROW LEVEL SECURITY'; END $b$;`],
    ["RAISE EXCEPTION that never fires", `DO $b$ BEGIN IF false THEN RAISE EXCEPTION 'ALTER TABLE public.naked ENABLE ROW LEVEL SECURITY'; END IF; END $b$;`],
  ];
  for (const [label, prose] of fakeEnable) {
    const failures = runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(`CREATE TABLE public.naked (id uuid);\n${prose}`),
    });
    assert.ok(
      failures.some((f) => f.includes("C1: public.naked")),
      `${label} laundered an unprotected table green`,
    );
  }

  const hideTable = [
    ["single-quoted", `DO $b$ BEGIN RAISE NOTICE 'operator runs DROP TABLE public.ghost; later'; END $b$;`],
    ["dollar-quoted", `DO $b$ BEGIN RAISE NOTICE $m$operator runs DROP TABLE public.ghost; later$m$; END $b$;`],
  ];
  for (const [label, prose] of hideTable) {
    const failures = runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(`CREATE TABLE public.ghost (id uuid);\n${prose}`),
    });
    assert.ok(
      failures.some((f) => f.includes("C1: public.ghost")),
      `a ${label} drop sentence removed a live table from scrutiny`,
    );
  }
});

test("#1860 adversarial E2 [R3]: a dynamic enable counts from an EXECUTE position and only from there", () => {
  const loopBody = `FOREACH v IN ARRAY ARRAY['looped'] LOOP %BODY% END LOOP;`;
  const wrap = (inner) =>
    `CREATE TABLE public.looped (id uuid);\nDO $b$ DECLARE v text; BEGIN ${loopBody.replace("%BODY%", inner)} END $b$;`;

  // Executed: resolves against the loop's array, so the table is protected.
  assert.deepEqual(
    runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(wrap(`EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v);`)),
    }),
    [],
    "a FOREACH-driven EXECUTE enable did not resolve; this is ~a third of the schema",
  );

  // Identical text, never executed: must NOT count.
  assert.ok(
    runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(wrap(`RAISE NOTICE '%', format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v);`)),
    }).some((f) => f.includes("C1: public.looped")),
    "a format() template that is only logged was counted as an executed enable",
  );

  // R4: the same loop inside a stored function body is not executed by the migration.
  assert.ok(
    runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(
        `CREATE TABLE public.dormant (id uuid);\n` +
          `CREATE OR REPLACE FUNCTION public.someday() RETURNS void LANGUAGE plpgsql AS $fn$\n` +
          `DECLARE v text; BEGIN FOREACH v IN ARRAY ARRAY['dormant'] LOOP\n` +
          `EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v); END LOOP; END $fn$;`,
      ),
    }).some((f) => f.includes("C1: public.dormant")),
    "a stored CREATE FUNCTION body was treated as executed DDL",
  );
});

test("#1860 adversarial E3 [R5/C7]: unresolvable dynamic DDL fails CLOSED, and the drop asymmetry is deliberate", () => {
  const c7 = (sql) =>
    runChecks({ ...FIXTURE_INPUTS, files: carrier(sql) }).filter((f) => f.startsWith("C7:"));

  // An EXECUTE with no literal at all — the statement was built up elsewhere.
  assert.ok(
    c7(`DO $b$ DECLARE s text; BEGIN EXECUTE s; END $b$;`).length > 0,
    "an opaque EXECUTE did not fail closed; a statement built in a variable could create an unseen table",
  );

  // A placeholder create with no FOREACH binding to resolve it.
  assert.ok(
    c7(`DO $b$ DECLARE v text; BEGIN EXECUTE format('CREATE TABLE public.%I (id uuid)', v); END $b$;`).length > 0,
    "an unresolvable dynamic CREATE did not fail closed — that is a false green on an unprotected schema",
  );
  assert.ok(
    c7(`DO $b$ DECLARE v text; BEGIN EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v); END $b$;`)
      .length > 0,
    "an unresolvable dynamic ENABLE did not fail closed",
  );

  // The asymmetry, asserted rather than assumed: an unresolvable DROP does NOT
  // fail, because leaving a table in scope only risks a false RED. Pinned so the
  // asymmetry stays a decision instead of drifting into an accident.
  assert.deepEqual(
    c7(`DO $b$ DECLARE v text; BEGIN EXECUTE format('DROP TABLE public.%I', v); END $b$;`),
    [],
    "an unresolvable dynamic DROP failed closed; R5 documents the opposite",
  );
});

test("#1860 adversarial E4 [R6]: a later DISABLE re-opens a table, but a DISABLE written as prose does not", () => {
  assert.ok(
    runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(
        `CREATE TABLE public.reopened (id uuid);\n` +
          `ALTER TABLE public.reopened ENABLE ROW LEVEL SECURITY;\n` +
          `ALTER TABLE public.reopened DISABLE ROW LEVEL SECURITY;`,
      ),
    }).some((f) => f.includes("C1: public.reopened")),
    "a table whose RLS was turned back off still reports as protected",
  );

  // Across files, not just within one — the replay is ordered, not a set union.
  assert.ok(
    runChecks({
      ...FIXTURE_INPUTS,
      files: [
        { name: "001.sql", sql: `CREATE TABLE public.later (id uuid);\nALTER TABLE public.later ENABLE ROW LEVEL SECURITY;` },
        { name: "002.sql", sql: `ALTER TABLE public.later DISABLE ROW LEVEL SECURITY;` },
      ],
    }).some((f) => f.includes("C1: public.later")),
    "a DISABLE in a later migration did not clear an earlier ENABLE",
  );

  // And the inverse: prose must not be able to re-open a protected table either.
  assert.deepEqual(
    runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(
        `CREATE TABLE public.safe (id uuid);\n` +
          `ALTER TABLE public.safe ENABLE ROW LEVEL SECURITY;\n` +
          `DO $b$ BEGIN RAISE NOTICE 'never run: ALTER TABLE public.safe DISABLE ROW LEVEL SECURITY'; END $b$;`,
      ),
    }),
    [],
    "a DISABLE written as prose re-opened a protected table",
  );
});

test("#1860 adversarial E5 [REAL CHAIN ANCHOR]: the real chain contains ZERO unresolvable dynamic DDL", () => {
  // C7's clean state on this repo, pinned. If someone introduces an opaque
  // EXECUTE or an unresolvable dynamic create, this reds here as well as in the
  // gate — and unlike a fixture, it is a statement about the real schema.
  const { unresolved, live } = replayChain(loadMigrations());
  assert.ok(live.size >= MIN_LIVE_TABLES, "vacuity: the chain did not replay");
  assert.deepEqual(
    unresolved.map((u) => `${u.file}: ${u.kind}`),
    [],
    "the real chain now contains dynamic DDL this parser cannot resolve",
  );
});

test("#1860 adversarial E6 [C8]: this suite cannot go dark — the gate reds if it is deleted or un-wired", () => {
  // Self-referential on purpose. This file sits outside .github/scripts/strict-grep/,
  // so MANIFEST.json does not sweep it and run-batch.mjs does not run it: without
  // C8 it would be a gate on disk that no CI job executes, which is the exact
  // shape everything in #1860 is about.
  const wired = `      - name: suite\n        run: node --test ${SUITE_REL}\n`;

  assert.deepEqual(
    runChecks({ ...FIXTURE_INPUTS, files: carrier(""), adversarialSuiteExists: true, adversarialWorkflowText: wired }),
    [],
    "a correctly wired suite should not fail C8",
  );
  assert.ok(
    runChecks({ ...FIXTURE_INPUTS, files: carrier(""), adversarialSuiteExists: false, adversarialWorkflowText: wired })
      .some((f) => f.startsWith("C8:")),
    "deleting this suite does not fail the gate",
  );
  assert.ok(
    runChecks({ ...FIXTURE_INPUTS, files: carrier(""), adversarialSuiteExists: true, adversarialWorkflowText: null })
      .some((f) => f.startsWith("C8:")),
    "deleting the workflow that runs this suite does not fail the gate",
  );
  // The one that matters: a commented-out step reads as wired to a plain
  // substring match. C8 is checked on comment-stripped yaml.
  assert.ok(
    runChecks({
      ...FIXTURE_INPUTS,
      files: carrier(""),
      adversarialSuiteExists: true,
      adversarialWorkflowText: `      # - name: disabled\n      #   run: node --test ${SUITE_REL}\n`,
    }).some((f) => f.startsWith("C8:")),
    "a commented-out step still reads as wired; C8 is not comment-stripped",
  );

  // And the real workflow must genuinely invoke this file.
  assert.ok(
    existsSync(ADVERSARIAL_WORKFLOW_PATH),
    "the workflow that runs this suite is missing",
  );
  assert.ok(
    stripYamlComments(readFileSync(ADVERSARIAL_WORKFLOW_PATH, "utf8")).includes(SUITE_REL),
    "the real workflow does not invoke this suite in executable yaml",
  );
});
