#!/usr/bin/env node
/**
 * Issue #1860 — NO TABLE IN `public` MAY HAVE ROW-LEVEL SECURITY DISABLED.
 *
 * Row-level security is the only effective constraint on this schema. The
 * baseline squash carries the platform-standard `ALTER DEFAULT PRIVILEGES … IN
 * SCHEMA public GRANT ALL ON TABLES` for the standard roles (#1827), so a
 * table's own GRANT lines cannot narrow what it already holds. A table with RLS
 * off carries no constraint at all — which is why this is a gate and not a
 * convention. Convention already failed here once: tables accumulated in that
 * state over months and nothing said a word.
 *
 * WHAT THIS GATE PROVES, AND WHAT IT CANNOT
 * -----------------------------------------
 * This half is STATIC: it replays the migration chain in filename order and
 * asserts every table it leaves alive in `public` has an RLS enable. That is
 * the half that can run on every PR with no database.
 *
 * The LIVE half — `pg_class.relrowsecurity` against the real applied schema —
 * is `supabase/migrations/__tests__/issue_1860_public_rls_coverage.test.sql`,
 * run by the containerised Postgres job in
 * `.github/workflows/supabase-migrations-and-stripe-deno.yml`. Neither half is
 * sufficient alone: source can lie about what the catalog holds, and a catalog
 * assertion cannot run on a PR that never reaches the container. So C5 below
 * asserts the live half is still WIRED. Deleting it fails this gate.
 *
 * THE EXEMPTION IS EXACTLY ONE TABLE
 * ----------------------------------
 * `public.spatial_ref_sys` is owned by the PostGIS extension, not by us, and
 * holds published coordinate-system reference data. It is the only exemption,
 * it lives in exactly one reviewed place (`scripts/audit/rls-allowlist.json`),
 * and C2 pins that file to that one name. Adding a second entry fails the gate;
 * the only way to add one is to edit this file, in a reviewed diff, on purpose.
 * That list previously held nine names and every one of them was a real hole.
 *
 * THE TWO PARSING TRAPS THIS GATE EXISTS BECAUSE OF
 * -------------------------------------------------
 *  1. A `DROP TABLE public.x;` sentence inside a COMMENT string body is not a
 *     drop. The predecessor audit (`scripts/audit/rls-coverage.mjs`) matched one
 *     and silently classified a live table as dropped, which removed it from
 *     scrutiny entirely. String literals and comments are masked before any
 *     DDL regex runs.
 *  2. Roughly a third of this schema enables RLS from inside a `DO $block$`
 *     with `FOREACH v IN ARRAY ARRAY[…] LOOP EXECUTE format('ALTER TABLE
 *     public.%I ENABLE ROW LEVEL SECURITY', v)`. A gate that only reads literal
 *     `ALTER TABLE` statements reports ~45 false positives, gets muted, and is
 *     then worth nothing. Those loops are resolved.
 *     The mirror hazard is resolved in the other direction: the same `format()`
 *     text inside a `CREATE FUNCTION` body is NOT executed by the migration, so
 *     only `DO` blocks are treated as executed DDL.
 *
 * Deliberately NOT resolved: dynamic `format('DROP TABLE public.%I', …)`. A
 * mis-resolved drop makes a live table invisible to this gate, so drops are
 * counted only in their literal, statement-level form. Erring toward "still
 * live" is the safe direction.
 *
 * Supports `--self-test` (no repo scan; GOOD plus one BAD fixture per rule,
 * including a fixture that proves the gate FAILS when a table has RLS off).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const MIGRATIONS_DIR = "supabase/migrations";
const ALLOWLIST_PATH = "scripts/audit/rls-allowlist.json";
const COVERAGE_AUDIT_PATH = "scripts/audit/rls-coverage.mjs";
const LIVE_TEST_PATH = "supabase/migrations/__tests__/issue_1860_public_rls_coverage.test.sql";
const LIVE_TEST_WORKFLOW = ".github/workflows/supabase-migrations-and-stripe-deno.yml";

/**
 * The ONE reviewed exemption. Changing this constant is the only way to change
 * the exemption set, and it is a visible diff in a reviewed file — which is the
 * entire point. See the header for why `spatial_ref_sys` qualifies and why
 * nothing else does.
 */
const EXEMPT = ["spatial_ref_sys"];

/**
 * Anti-vacuity floor. This schema has ~350 tables. If a parser regression makes
 * the chain look tiny, the gate would pass by asking about almost nothing — the
 * "green because it checked nothing" mode. Raise this when the schema grows;
 * never lower it to make a red go away.
 */
const MIN_LIVE_TABLES = 300;

// ---------------------------------------------------------------------------
// SQL lexing. Everything here exists to stop a regex reading DDL out of prose.
// ---------------------------------------------------------------------------

const DOLLAR_TAG_RE = /^\$[A-Za-z_0-9]*\$/;

/**
 * Replace `--` line comments and C-style block comments with spaces,
 * preserving byte offsets so later match positions stay meaningful. String
 * literals and dollar-quoted bodies are left intact here; `segment()` handles
 * them, because a dollar-quoted body may be executable DDL.
 */
export function maskComments(sql) {
  const out = Array.from(sql);
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      blank(i, end);
      i = end;
    } else if (two === "/*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql.slice(j, j + 2) === "/*") { depth++; j += 2; }
        else if (sql.slice(j, j + 2) === "*/") { depth--; j += 2; }
        else j++;
      }
      blank(i, j);
      i = j;
    } else if (sql[i] === "'") {
      i = skipSingleQuoted(sql, i);
    } else if (sql[i] === "$") {
      const m = DOLLAR_TAG_RE.exec(sql.slice(i));
      if (!m) { i++; continue; }
      const end = sql.indexOf(m[0], i + m[0].length);
      i = end === -1 ? sql.length : end + m[0].length;
    } else {
      i++;
    }
  }
  return out.join("");
}

function skipSingleQuoted(sql, start) {
  let j = start + 1;
  while (j < sql.length) {
    if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
    if (sql[j] === "'") return j + 1;
    j++;
  }
  return sql.length;
}

/**
 * Split comment-masked SQL into:
 *   - `top`: the same string with every string literal and every dollar-quoted
 *     body blanked out (offsets preserved). This is statement-level DDL only.
 *   - `doBodies`: the bodies of `DO $tag$ … $tag$` blocks, which Postgres
 *     EXECUTES at migration time. Function bodies are NOT included — a
 *     `CREATE FUNCTION` body is stored, not run.
 */
export function segment(sql) {
  const top = Array.from(sql);
  const doBodies = [];
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (top[k] !== "\n") top[k] = " ";
  };
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const end = skipSingleQuoted(sql, i);
      blank(i, end);
      i = end;
      continue;
    }
    const m = DOLLAR_TAG_RE.exec(sql.slice(i));
    if (m) {
      const tag = m[0];
      const close = sql.indexOf(tag, i + tag.length);
      const bodyStart = i + tag.length;
      const bodyEnd = close === -1 ? sql.length : close;
      // Is the statement opening this dollar-quote a bare `DO`? Look back over
      // the already-emitted top text to the previous statement boundary.
      const before = top.slice(0, i).join("");
      const boundary = Math.max(before.lastIndexOf(";"), before.lastIndexOf("$"));
      const head = before.slice(boundary + 1);
      if (/(^|[\s)])DO\s*$/i.test(head)) {
        doBodies.push({ start: bodyStart, text: sql.slice(bodyStart, bodyEnd) });
      }
      blank(i, close === -1 ? sql.length : close + tag.length);
      i = close === -1 ? sql.length : close + tag.length;
      continue;
    }
    i++;
  }
  return { top: top.join(""), doBodies };
}

// ---------------------------------------------------------------------------
// DDL extraction.
// ---------------------------------------------------------------------------

const CREATE_RE =
  /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?public"?\s*\.\s*"?([A-Za-z0-9_]+)"?/gi;
const DROP_RE =
  /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?public"?\s*\.\s*"?([A-Za-z0-9_]+)"?/gi;
const ENABLE_RE =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?public"?\s*\.\s*"?([A-Za-z0-9_]+)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
const FOREACH_RE =
  /FOREACH\s+(\w+)\s+IN\s+ARRAY\s+ARRAY\s*\[([^\]]*)\]\s*LOOP([\s\S]*?)END\s+LOOP/gi;

/** Blank out `//` line comments and C-style block comments in JS source. */
export function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function matches(re, text) {
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m);
  return out;
}

/** Ordered create/drop/enable events for ONE migration file. */
export function eventsForFile(rawSql) {
  const clean = maskComments(rawSql);
  const { top, doBodies } = segment(clean);
  const events = [];

  for (const m of matches(CREATE_RE, top)) events.push({ at: m.index, kind: "create", table: m[1] });
  for (const m of matches(DROP_RE, top)) events.push({ at: m.index, kind: "drop", table: m[1] });
  for (const m of matches(ENABLE_RE, top)) events.push({ at: m.index, kind: "enable", table: m[1] });

  for (const body of doBodies) {
    for (const m of matches(CREATE_RE, body.text)) {
      events.push({ at: body.start + m.index, kind: "create", table: m[1] });
    }
    for (const m of matches(DROP_RE, body.text)) {
      events.push({ at: body.start + m.index, kind: "drop", table: m[1] });
    }
    for (const m of matches(ENABLE_RE, body.text)) {
      events.push({ at: body.start + m.index, kind: "enable", table: m[1] });
    }
    // The dynamic form: FOREACH over a literal array, enabling RLS by %I.
    for (const m of matches(FOREACH_RE, body.text)) {
      const [, loopVar, arrayLiteral, loopBody] = m;
      const dynamicEnable = new RegExp(
        `ALTER\\s+TABLE\\s+public\\.%I\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY[\\s\\S]{0,120}?\\b${loopVar}\\b`,
        "i",
      );
      if (!dynamicEnable.test(loopBody)) continue;
      for (const lit of arrayLiteral.match(/'([^']*)'/g) ?? []) {
        events.push({ at: body.start + m.index, kind: "enable", table: lit.slice(1, -1) });
      }
    }
  }

  events.sort((a, b) => a.at - b.at);
  return events;
}

/**
 * Replay the whole chain in filename order.
 * A re-CREATE resets the table's RLS state — a fresh table starts with RLS off,
 * so a drop-then-recreate must re-enable or it is a hole.
 */
export function replayChain(files) {
  const live = new Set();
  const rlsOn = new Set();
  let createCount = 0;
  let enableCount = 0;
  for (const file of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    for (const ev of eventsForFile(file.sql)) {
      if (ev.kind === "create") {
        live.add(ev.table);
        rlsOn.delete(ev.table);
        createCount++;
      } else if (ev.kind === "drop") {
        live.delete(ev.table);
        rlsOn.delete(ev.table);
      } else {
        rlsOn.add(ev.table);
        enableCount++;
      }
    }
  }
  return { live, rlsOn, createCount, enableCount };
}

// ---------------------------------------------------------------------------
// The rules.
// ---------------------------------------------------------------------------

/**
 * Pure checker; all I/O injected so `--self-test` drives every failure mode
 * from fixtures instead of mutating the repo.
 *
 * @param {{name:string, sql:string}[]} a.files          migration files
 * @param {unknown}                     a.allowlistJson  parsed rls-allowlist.json
 * @param {string|null}                 a.workflowText   the live-half workflow, or null
 * @param {string|null}                 a.coverageSource scripts/audit/rls-coverage.mjs, or null
 * @param {boolean}                     [a.enforceFloor] apply MIN_LIVE_TABLES (real repo only)
 * @returns {string[]} failures
 */
export function runChecks({ files, allowlistJson, workflowText, coverageSource, enforceFloor = true }) {
  const failures = [];

  // C4 — anti-vacuity. Discovering nothing is a FAILURE, never a pass.
  if (!files.length) {
    failures.push(
      `C4 [vacuity]: discovered ZERO .sql files under ${MIGRATIONS_DIR}. A gate that ` +
        `matches nothing must fail, not pass.`,
    );
    return failures;
  }

  const { live, rlsOn, createCount, enableCount } = replayChain(files);

  if (createCount === 0) {
    failures.push(
      `C4 [vacuity]: parsed ${files.length} migration file(s) and found ZERO ` +
        `CREATE TABLE … public.<name> statements. The parser is broken, not the schema.`,
    );
    return failures;
  }
  if (enableCount === 0) {
    failures.push(
      `C4 [vacuity]: found ZERO ENABLE ROW LEVEL SECURITY statements across ` +
        `${files.length} migration file(s). Every table would report as a violation ` +
        `for the wrong reason.`,
    );
    return failures;
  }
  if (enforceFloor && live.size < MIN_LIVE_TABLES) {
    failures.push(
      `C4 [vacuity]: the chain replayed to only ${live.size} live public tables, below ` +
        `the floor of ${MIN_LIVE_TABLES}. Either the parser regressed or the schema ` +
        `shrank by a third; both need a human, neither is a pass.`,
    );
    return failures;
  }

  // C2 — the exemption list is EXACTLY the reviewed one.
  const declared = Array.isArray(allowlistJson?.tables) ? allowlistJson.tables : null;
  if (declared === null) {
    failures.push(`C2: ${ALLOWLIST_PATH} has no "tables" array. It is the only exemption list; it must exist.`);
  } else {
    const got = [...declared].sort();
    const want = [...EXEMPT].sort();
    if (got.length !== want.length || got.some((t, i) => t !== want[i])) {
      failures.push(
        `C2: ${ALLOWLIST_PATH} lists [${got.join(", ")}] but the reviewed exemption set is ` +
          `[${want.join(", ")}]. Every extra name is a table nobody is constraining. ` +
          `Widening this list means editing EXEMPT in ${"issue-1860-public-tables-rls-enabled.mjs"} ` +
          `too — deliberately, in a reviewed diff, with a reason.`,
      );
    }
  }

  // C3 — the exemption cannot be repurposed for a table we own. `spatial_ref_sys`
  // is exempt precisely because the PostGIS extension creates it, not us.
  for (const t of EXEMPT) {
    if (live.has(t)) {
      failures.push(
        `C3: "${t}" is exempt because it is extension-owned, but a migration in this ` +
          `repo CREATEs it. An exemption for a table we create is an exemption for ` +
          `nothing — enable RLS on it or remove it from EXEMPT.`,
      );
    }
  }

  // C1 — the rule itself.
  const exempt = new Set(EXEMPT);
  const violations = [...live].filter((t) => !exempt.has(t) && !rlsOn.has(t)).sort();
  for (const t of violations) {
    failures.push(
      `C1: public.${t} is created by the migration chain and never gets ENABLE ROW ` +
        `LEVEL SECURITY. RLS is the only constraint on this schema — without it the ` +
        `table has none. Add the ALTER in a forward-only migration.`,
    );
  }

  // C5 — the live half must stay wired, or this static half is all that is left.
  if (workflowText === null) {
    failures.push(`C5: ${LIVE_TEST_WORKFLOW} is missing. The live catalog half of #1860 runs there.`);
  } else if (!workflowText.includes(LIVE_TEST_PATH)) {
    failures.push(
      `C5: ${LIVE_TEST_WORKFLOW} no longer invokes ${LIVE_TEST_PATH}. Source parsing ` +
        `cannot see pg_class; that file is the only thing asserting the REAL applied ` +
        `schema. Un-wiring it makes this gate the whole of #1860, which it is not.`,
    );
  }

  // C6 — no blanket prefix laundering in the predecessor audit. The nine-name
  // allowlist was only half the hole; the other half was `if
  // (table.startsWith("_archive_")) continue;`, an exemption channel with no
  // list, no review and no record.
  // Comments are stripped first: a comment SAYING `.startsWith(` (this rule is
  // documented at the removal site) is not a code path, and a gate that cannot
  // tell the two apart is a gate nobody can explain themselves to.
  if (coverageSource === null) {
    failures.push(`C6: ${COVERAGE_AUDIT_PATH} is missing; it is the predecessor audit C2 pins the allowlist for.`);
  } else if (/\.startsWith\(/.test(stripJsComments(coverageSource))) {
    failures.push(
      `C6: ${COVERAGE_AUDIT_PATH} contains a .startsWith( prefix test. A prefix skip is ` +
        `an unbounded, unreviewed exemption list — exactly how two archive tables sat ` +
        `outside RLS without ever appearing on one. Exemptions go in ${ALLOWLIST_PATH}.`,
    );
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Self-test.
// ---------------------------------------------------------------------------

function selfTest() {
  const results = [];
  const check = (label, failures, shouldFail, needle) => {
    const failed = failures.length > 0;
    const ok = failed === shouldFail && (!shouldFail || failures.some((f) => f.includes(needle)));
    results.push({ label, ok, failures });
  };

  const GOOD_ALLOWLIST = { tables: ["spatial_ref_sys"] };
  const GOOD_WORKFLOW = `        run: |\n          psql -f ${LIVE_TEST_PATH}\n`;
  const GOOD_COVERAGE = `const allow = JSON.parse(readFileSync("${ALLOWLIST_PATH}"));\n`;

  const base = (over = {}) => ({
    files: [
      {
        name: "001_base.sql",
        sql: `
CREATE TABLE "public"."ok_literal" (id uuid primary key);
ALTER TABLE "public"."ok_literal" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.ok_unquoted (id uuid primary key);
ALTER TABLE public.ok_unquoted ENABLE ROW LEVEL SECURITY;
`,
      },
    ],
    allowlistJson: GOOD_ALLOWLIST,
    workflowText: GOOD_WORKFLOW,
    coverageSource: GOOD_COVERAGE,
    enforceFloor: false,
    ...over,
  });

  // T-1 GOOD — a clean chain passes.
  check("T-1 clean chain passes", runChecks(base()), false);

  // T-2 THE CORE. A table created without RLS must FAIL. A gate that passes on a
  // broken schema is worse than no gate, and this repo has shipped that before.
  check(
    "T-2 a table with RLS off FAILS",
    runChecks(
      base({
        files: [
          {
            name: "001.sql",
            sql: `CREATE TABLE "public"."ok" (id uuid);
ALTER TABLE "public"."ok" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."naked" (id uuid);`,
          },
        ],
      }),
    ),
    true,
    "C1: public.naked",
  );

  // T-3 The comment-poisoning trap: a DROP inside a COMMENT body is not a drop,
  // so the table stays in scope and its missing RLS is still reported.
  check(
    "T-3 a DROP inside a COMMENT string does not hide a table",
    runChecks(
      base({
        files: [
          {
            name: "001.sql",
            sql: `CREATE TABLE "public"."ok" (id uuid);
ALTER TABLE "public"."ok" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."ghost" (id uuid);
COMMENT ON TABLE "public"."ghost" IS 'after this date the operator runs: DROP TABLE public.ghost;';`,
          },
        ],
      }),
    ),
    true,
    "C1: public.ghost",
  );

  // T-4 A real statement-level DROP does remove the table from scope.
  check(
    "T-4 a real DROP removes the table from scope",
    runChecks(
      base({
        files: [
          {
            name: "001.sql",
            sql: `CREATE TABLE "public"."ok" (id uuid);
ALTER TABLE "public"."ok" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."temp_thing" (id uuid);
DROP TABLE "public"."temp_thing";`,
          },
        ],
      }),
    ),
    false,
  );

  // T-5 The DO-block FOREACH loop counts as enabling RLS (else ~45 false positives).
  check(
    "T-5 a DO-block FOREACH loop enables RLS",
    runChecks(
      base({
        files: [
          {
            name: "001.sql",
            sql: `CREATE TABLE public.loop_a (id uuid);
CREATE TABLE public.loop_b (id uuid);
DO $block$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'loop_a',
    'loop_b'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      v_table
    );
  END LOOP;
END;
$block$;`,
          },
        ],
      }),
    ),
    false,
  );

  // T-6 The mirror: the SAME text inside a CREATE FUNCTION body is stored, not
  // executed, and must NOT count.
  check(
    "T-6 the same loop inside a CREATE FUNCTION body does NOT count",
    runChecks(
      base({
        files: [
          {
            name: "001.sql",
            sql: `CREATE TABLE "public"."ok" (id uuid);
ALTER TABLE "public"."ok" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.dormant (id uuid);
CREATE OR REPLACE FUNCTION public.someday() RETURNS void LANGUAGE plpgsql AS $function$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['dormant'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END;
$function$;`,
          },
        ],
      }),
    ),
    true,
    "C1: public.dormant",
  );

  // T-7 Drop-then-recreate resets RLS; the second table must re-enable.
  check(
    "T-7 a re-CREATE after a DROP resets RLS state",
    runChecks(
      base({
        files: [
          {
            name: "001.sql",
            sql: `CREATE TABLE "public"."recycled" (id uuid);
ALTER TABLE "public"."recycled" ENABLE ROW LEVEL SECURITY;`,
          },
          {
            name: "002.sql",
            sql: `DROP TABLE "public"."recycled";
CREATE TABLE "public"."recycled" (id uuid, extra text);`,
          },
        ],
      }),
    ),
    true,
    "C1: public.recycled",
  );

  // T-8 Growing the exemption list FAILS.
  check(
    "T-8 a second exemption FAILS",
    runChecks(base({ allowlistJson: { tables: ["spatial_ref_sys", "seed_map_presence"] } })),
    true,
    "C2:",
  );

  // T-9 Emptying the exemption list also FAILS — it must be exactly the reviewed set.
  check("T-9 an empty exemption list FAILS", runChecks(base({ allowlistJson: { tables: [] } })), true, "C2:");

  // T-10 An exemption for a table WE create is meaningless and FAILS.
  check(
    "T-10 exempting a table this repo creates FAILS",
    runChecks(
      base({
        files: [
          {
            name: "001.sql",
            sql: `CREATE TABLE "public"."ok" (id uuid);
ALTER TABLE "public"."ok" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."spatial_ref_sys" (srid integer);
ALTER TABLE "public"."spatial_ref_sys" ENABLE ROW LEVEL SECURITY;`,
          },
        ],
      }),
    ),
    true,
    "C3:",
  );

  // T-11 Un-wiring the live catalog half FAILS.
  check(
    "T-11 un-wiring the live SQL test FAILS",
    runChecks(base({ workflowText: "jobs:\n  migrations:\n    steps: []\n" })),
    true,
    "C5:",
  );

  // T-12 Re-adding a blanket prefix skip to the predecessor audit FAILS.
  check(
    "T-12 a .startsWith( prefix skip in the audit FAILS",
    runChecks(base({ coverageSource: `if (table.startsWith("_archive_")) continue;` })),
    true,
    "C6:",
  );

  // T-13 Vacuity: zero files must FAIL.
  check("T-13 zero migration files FAILS", runChecks(base({ files: [] })), true, "C4 [vacuity]");

  // T-14 Vacuity: files with no CREATE TABLE must FAIL.
  check(
    "T-14 a chain with no CREATE TABLE FAILS",
    runChecks(base({ files: [{ name: "001.sql", sql: "SELECT 1;" }] })),
    true,
    "C4 [vacuity]",
  );

  // T-15 Vacuity: the live-table floor fires when enforced.
  check(
    "T-15 the live-table floor FAILS a tiny chain",
    runChecks(base({ enforceFloor: true })),
    true,
    "C4 [vacuity]",
  );

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
    if (!r.ok) for (const f of r.failures) console.log(`        ${f}`);
  }
  if (failed.length) {
    console.error(`issue-1860 self-test FAILED: ${failed.length}/${results.length}`);
    process.exit(1);
  }
  console.log(`issue-1860 self-test passed (${results.length}/${results.length}).`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Repo scan.
// ---------------------------------------------------------------------------

function main() {
  const migrationsAbs = join(root, MIGRATIONS_DIR);
  const files = existsSync(migrationsAbs)
    ? readdirSync(migrationsAbs)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => ({ name: f, sql: readFileSync(join(migrationsAbs, f), "utf8") }))
    : [];

  const readOrNull = (rel) => {
    const abs = join(root, rel);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  };

  let allowlistJson = null;
  const allowlistRaw = readOrNull(ALLOWLIST_PATH);
  if (allowlistRaw !== null) {
    try {
      allowlistJson = JSON.parse(allowlistRaw);
    } catch (err) {
      console.error(`issue-1860 gate failed: ${ALLOWLIST_PATH} is not valid JSON — ${err.message}`);
      process.exit(1);
    }
  }

  if (!existsSync(join(root, LIVE_TEST_PATH))) {
    console.error(
      `issue-1860 gate failed:\n- C5: ${LIVE_TEST_PATH} does not exist. The live catalog half of ` +
        `#1860 is the only assertion against the REAL applied schema.`,
    );
    process.exit(1);
  }

  const failures = runChecks({
    files,
    allowlistJson,
    workflowText: readOrNull(LIVE_TEST_WORKFLOW),
    coverageSource: readOrNull(COVERAGE_AUDIT_PATH),
    enforceFloor: true,
  });

  if (failures.length > 0) {
    console.error("issue-1860 public-tables-RLS gate failed:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }

  const { live } = replayChain(files);
  console.log(
    `issue-1860 public-tables-RLS gate passed (${files.length} migrations, ${live.size} live public ` +
      `tables, ${EXEMPT.length} reviewed exemption: ${EXEMPT.join(", ")}).`,
  );
}

// Entry-point guard, and it MUST use pathToFileURL. A naive
// `file://${process.argv[1]}` comparison silently fails whenever the checkout
// path contains characters the URL spec percent-encodes — e.g. the `[` `]` in
// the per-issue worktree `1860-[rls-disabled-tables]` this gate was written in.
// ORCH-1383's runner was bitten by exactly that and exited 0 having run nothing.
// The guard also keeps `runChecks` importable by an adversarial suite without
// the import triggering a full repo scan and a process.exit.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry !== null && import.meta.url === entry) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
