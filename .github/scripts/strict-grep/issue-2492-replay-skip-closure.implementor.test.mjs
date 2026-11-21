import test from "node:test";
import assert from "node:assert/strict";
import { analyseLanes, analyseTrees, parseMigration } from "./issue-2492-replay-skip-closure.mjs";

const loop = 'for f in supabase/migrations/*.sql; do\n  case "$f" in\n    *002_skip.sql) continue ;;\n  esac\n  psql -v ON_ERROR_STOP=1 -f "$f"\ndone';
const migrations = {
  "001_base.sql": "CREATE TABLE public.base(id int);",
  "002_skip.sql": "CREATE TABLE public.hidden(id int);",
  "003_reader.sql": "CREATE VIEW public.reader AS SELECT id FROM public.base;",
};
test("live workflows and actual batch replay commands have closed migration prerequisites", () => {
  const result = analyseLanes();
  assert.deepEqual(result.violations, []);
  assert.ok(result.lanes.some(lane => lane.workflow === "issue-1931-private-event-access"));
  assert.ok(result.lanes.some(lane => lane.workflow === "issue-2117-offering-visibility-gate-tests"));
});
test("a reader of a skipped table fails while an independent reader passes", () => {
  const workflows = { fixture: loop };
  assert.deepEqual(analyseTrees({ workflows, migrations }).violations, []);
  const bad = { ...migrations, "004_bad.sql": "CREATE VIEW public.bad AS SELECT id FROM public.hidden;" };
  assert.ok(analyseTrees({ workflows, migrations: bad }).violations.some(v => v.check === "C-1" && v.message.includes("hidden")));
});
test("every ADD COLUMN clause contributes a definition", () => {
  const result = parseMigration("fixture.sql", "ALTER TABLE public.events ADD COLUMN one text, ADD COLUMN two text, ADD COLUMN three text, ADD COLUMN four text;");
  for (const name of ["one","two","three","four"]) assert.ok(result.definitions.has(`col:${name}`));
});
// #4514: CREATE TABLE columns of an APPLIED migration count as available; a skipped migration's never do.
const fn = (col, tbl = "t") => `CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT ${col} FROM public.${tbl} $$;`;
test("a column from an applied CREATE TABLE is not blamed on a skipped ADD COLUMN of another table", () => {
  const workflows = { fixture: loop };
  const m = {
    "001_base.sql": "CREATE TABLE public.t(x int, buyer_name text);",
    "002_skip.sql": "ALTER TABLE public.other ADD COLUMN buyer_name text;",
    "003_reader.sql": fn("buyer_name"),
  };
  assert.deepEqual(analyseTrees({ workflows, migrations: m }).violations, []);
});
test("real breaks still fail: skipped ADD COLUMN, skipped CREATE TABLE reader, and a skipped CREATE TABLE column that is also skipped ADD COLUMN", () => {
  const workflows = { fixture: loop };
  const viaAlter = {
    "001_base.sql": "CREATE TABLE public.t(x int);",
    "002_skip.sql": "ALTER TABLE public.t ADD COLUMN only_alter text;",
    "003_reader.sql": fn("only_alter"),
  };
  assert.ok(analyseTrees({ workflows, migrations: viaAlter }).violations.some(v => v.check === "C-1" && v.message.includes("only_alter")));
  const viaTable = {
    "001_base.sql": "CREATE TABLE public.t(x int);",
    "002_skip.sql": "CREATE TABLE public.hidden(x int, only_hidden text);",
    "003_reader.sql": fn("only_hidden", "hidden"),
  };
  assert.ok(analyseTrees({ workflows, migrations: viaTable }).violations.some(v => v.check === "C-1" && v.message.includes("hidden")));
  const both = {
    "001_base.sql": "CREATE TABLE public.t(x int);",
    "002_skip.sql": "CREATE TABLE public.hidden(dup_col text);\nALTER TABLE public.t ADD COLUMN dup_col text;",
    "003_reader.sql": fn("dup_col"),
  };
  assert.ok(analyseTrees({ workflows, migrations: both }).violations.some(v => v.check === "C-1" && v.message.includes("dup_col")));
});
test("CREATE TABLE constraints, AS and PARTITION OF are not credited as columns", () => {
  const sql = `CREATE TABLE public.a (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "Quoted Col" text,
    price numeric CHECK (price > 0 AND price < greatest(1, 2)),
    CONSTRAINT con_name CHECK (id IS NOT NULL),
    UNIQUE (id, price),
    FOREIGN KEY (id) REFERENCES public.z(id),
    EXCLUDE USING gist (price WITH =),
    LIKE public.other
  );
  CREATE TABLE public.b AS SELECT 1 AS from_as;
  CREATE TABLE public.c PARTITION OF public.a FOR VALUES IN (1);`;
  const cols = [...parseMigration("f.sql", sql).createdCols].sort();
  assert.deepEqual(cols, ["col:id", "col:price", "col:quoted col"]);
});
