// #2305 — unit proof for the lifecycle-resolver class guard (implementor).
//
// The guard's own built-in detection mode proves it catches the defect. These
// cases pin the PARSER decisions that mode does not reach: the shapes that must NOT
// be classified as lifecycle tables, the literal/comment handling that decides
// whether a "call" is real, and the allowlist ratchets.
//
// The tester writes a second, adversarial suite on a different angle.

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  analyze,
  findLifecycleTables,
  stripSqlComments,
  stripSqlLiterals,
  WRITE_ONLY_BY_DESIGN,
  EXPECTED_EXEMPT,
} from "../issue-2305-status-table-has-a-resolver.mjs";

const mig = (sql, file = "20270101000000_x.sql") => ({ file, sql });

const LIFECYCLE = `
CREATE TABLE public.widget_reviews (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')),
  resolved_at timestamptz NULL
);`;

test("a status column paired with a nullable terminal timestamp IS a lifecycle table", () => {
  const found = findLifecycleTables([mig(LIFECYCLE)]);
  const info = found.get("widget_reviews");
  assert.ok(info, "widget_reviews should be discovered");
  assert.equal(info.statusColumn, "status");
  assert.equal(info.initialValue, "open", "DEFAULT is the initial state");
  assert.equal(info.statusValues, 3);
  assert.equal(info.terminalTs, "resolved_at");
});

test("a status enum with NO terminal timestamp is NOT a lifecycle table", () => {
  // The pairing is the evidence that a resolution was intended. Without it this
  // is just a flag, and flagging every enum in the repo would make the gate noise.
  const found = findLifecycleTables([
    mig(`CREATE TABLE public.widget_flags (
      id uuid PRIMARY KEY,
      status text NOT NULL DEFAULT 'on' CHECK (status IN ('on','off'))
    );`),
  ]);
  assert.equal(found.size, 0);
});

test("a NOT NULL terminal timestamp is NOT a lifecycle marker", () => {
  // A non-nullable timestamp is set at insert; it cannot mean "the lifecycle
  // ended here", so the table is not modelling a resolution.
  const found = findLifecycleTables([
    mig(`CREATE TABLE public.widget_log (
      id uuid PRIMARY KEY,
      status text NOT NULL DEFAULT 'a' CHECK (status IN ('a','b')),
      completed_at timestamptz NOT NULL DEFAULT now()
    );`),
  ]);
  assert.equal(found.size, 0);
});

test("a single-value CHECK is not a lifecycle", () => {
  const found = findLifecycleTables([
    mig(`CREATE TABLE public.widget_one (
      id uuid PRIMARY KEY,
      status text NOT NULL DEFAULT 'only' CHECK (status IN ('only')),
      resolved_at timestamptz NULL
    );`),
  ]);
  assert.equal(found.size, 0);
});

test("a CHECK containing commas inside its value list is parsed, not shredded", () => {
  // Naive split(',') on the CREATE TABLE body breaks every multi-value CHECK.
  const found = findLifecycleTables([
    mig(`CREATE TABLE public.widget_many (
      id uuid PRIMARY KEY,
      brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','a','b','c','d')),
      resolved_at timestamptz NULL,
      CONSTRAINT widget_shape CHECK ((status='open' AND resolved_at IS NULL) OR (status<>'open' AND resolved_at IS NOT NULL))
    );`),
  ]);
  assert.equal(found.get("widget_many").statusValues, 5);
});

test("an UPDATE back to the INITIAL value does not count as an advance", () => {
  // A queue that can only be re-opened is still a landfill. This is the exact
  // shape of `ad_app_acquisition_canaries`, whose only UPDATEs reset to
  // 'not_started'.
  const r = analyze(
    [
      mig(LIFECYCLE),
      mig(
        `CREATE OR REPLACE FUNCTION public.reset_widget() RETURNS void LANGUAGE plpgsql AS $f$
         BEGIN
           PERFORM 1 FROM public.widget_reviews;
           UPDATE public.widget_reviews SET status='open';
         END; $f$;`,
        "20270202000000_y.sql",
      ),
    ],
    ['supabase.rpc("reset_widget");'],
  );
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].advancerCount, 0);
});

test("an advancer inside a function nothing calls is a violation (condition C)", () => {
  // The `biz_reverse_brand_person_merge` shape: fully implemented, never called.
  const r = analyze(
    [
      mig(LIFECYCLE),
      mig(
        `CREATE OR REPLACE FUNCTION public.resolve_widget() RETURNS void LANGUAGE plpgsql AS $f$
         BEGIN
           PERFORM 1 FROM public.widget_reviews;
           UPDATE public.widget_reviews SET status='resolved', resolved_at=now();
         END; $f$;`,
        "20270202000000_y.sql",
      ),
    ],
    ["// a production file that calls nothing"],
  );
  assert.equal(r.violations.length, 1);
  assert.deepEqual(r.violations[0].unreachableFns, ["resolve_widget"]);
});

test("an advancer at migration TOP LEVEL is reachable — a migration runs", () => {
  const r = analyze(
    [
      mig(LIFECYCLE),
      mig(
        `SELECT 1 FROM public.widget_reviews;
         UPDATE public.widget_reviews SET status='resolved', resolved_at=now() WHERE status='open';`,
        "20270202000000_y.sql",
      ),
    ],
    ["// nothing"],
  );
  assert.equal(r.violations.length, 0);
});

test("a function name appearing only inside a SQL string literal is not a call", () => {
  // 20270305001770 lists `'public.biz_reverse_brand_person_merge(uuid,uuid)'` in
  // a security-assertion ARRAY. Reading that as a call would launder the third
  // instance of this defect class green.
  const r = analyze(
    [
      mig(LIFECYCLE),
      mig(
        `CREATE OR REPLACE FUNCTION public.resolve_widget() RETURNS void LANGUAGE plpgsql AS $f$
         BEGIN
           PERFORM 1 FROM public.widget_reviews;
           UPDATE public.widget_reviews SET status='resolved', resolved_at=now();
         END; $f$;
         DO $assert$ DECLARE v text; BEGIN
           FOREACH v IN ARRAY ARRAY['public.resolve_widget()'] LOOP
             IF NOT has_function_privilege('service_role',v,'EXECUTE') THEN RAISE EXCEPTION 'x'; END IF;
           END LOOP;
         END; $assert$;`,
        "20270202000000_y.sql",
      ),
    ],
    ["// nothing"],
  );
  assert.equal(
    r.violations.length,
    1,
    "a signature quoted inside a DO $assert$ array must not count as a caller",
  );
});

test("stripSqlLiterals recurses into dollar-quoted bodies but keeps the code", () => {
  const out = stripSqlLiterals("DO $a$ SELECT foo('bar'), baz(); $a$;");
  assert.ok(out.includes("baz()"), "real calls survive");
  assert.ok(!out.includes("bar"), "literals inside a dollar body are blanked");
});

test("stripSqlComments does not corrupt a dollar-quoted body", () => {
  const sql = "CREATE FUNCTION f() AS $b$ -- not a comment boundary\n SELECT 1; $b$;";
  assert.ok(stripSqlComments(sql).includes("SELECT 1"));
});

test("a commented-out reader and advancer satisfy nothing", () => {
  const r = analyze(
    [
      mig(LIFECYCLE),
      mig(
        "-- SELECT 1 FROM public.widget_reviews;\n" +
          "-- UPDATE public.widget_reviews SET status='resolved';",
        "20270202000000_y.sql",
      ),
    ],
    ["// nothing"],
  );
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].hasReader, false);
  assert.equal(r.violations[0].advancerCount, 0);
});

test("the allowlist is frozen and every entry carries an issue number", () => {
  assert.equal(WRITE_ONLY_BY_DESIGN.size, EXPECTED_EXEMPT);
  for (const [table, reason] of WRITE_ONLY_BY_DESIGN) {
    assert.match(
      reason,
      /#\d{3,5}/,
      `WRITE_ONLY_BY_DESIGN entry ${table} must cite an issue number`,
    );
    assert.ok(reason.length > 80, `${table}'s exemption reason must explain itself`);
  }
});

test("a stale allowlist entry is reported rather than silently ignored", () => {
  // An exemption matching no discovered table is a gate quietly narrowing itself.
  const r = analyze([mig(LIFECYCLE)], ["// nothing"]);
  for (const table of WRITE_ONLY_BY_DESIGN.keys()) {
    assert.ok(
      r.staleExemptions.includes(table),
      `${table} should be reported stale when it is not among the parsed tables`,
    );
  }
});

test("an exemption that is no longer NEEDED is reported too", () => {
  // Once a table gains a reachable resolver its exemption stops telling the
  // truth, so it must be dropped rather than left to rot.
  const [exemptTable] = WRITE_ONLY_BY_DESIGN.keys();
  assert.ok(exemptTable, "the frozen allowlist must contain a test subject");
  const r = analyze(
    [
      mig(`CREATE TABLE public.${exemptTable} (
        id uuid PRIMARY KEY,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
        reversed_at timestamptz NULL
      );`),
      mig(
        `SELECT 1 FROM public.${exemptTable};
         UPDATE public.${exemptTable} SET status='reversed', reversed_at=now();`,
        "20270202000000_y.sql",
      ),
    ],
    ["// nothing"],
  );
  assert.ok(r.unneededExemptions.includes(exemptTable));
});
