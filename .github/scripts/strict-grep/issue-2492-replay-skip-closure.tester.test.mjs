import test from "node:test";
import assert from "node:assert/strict";
import { analyseTrees, discoverLanes, parseMigration } from "./issue-2492-replay-skip-closure.mjs";

const loop = 'for f in supabase/migrations/*.sql; do\n  case "$f" in\n    *002_skip.sql) continue ;;\n  esac\n  psql -v ON_ERROR_STOP=1 -f "$f"\ndone';
const migrations = {
  "001_base.sql": "CREATE TABLE public.base(id int);",
  "002_skip.sql": "CREATE TABLE public.hidden(id int);",
};
test("empty inputs and a skip matching no migration fail", () => {
  assert.ok(analyseTrees({ workflows: {}, migrations }).violations.length);
  assert.ok(analyseTrees({ workflows: { fixture: loop }, migrations: {} }).violations.length);
  assert.ok(analyseTrees({ workflows: { fixture: loop.replace("002_skip", "999_missing") }, migrations }).violations.some(v => v.check === "C-2"));
});
test("CREATE-time SQL references are checked; comments and deferred procedural bodies are excluded", () => {
  for (const sql of [
    "CREATE FUNCTION public.bad() RETURNS int LANGUAGE sql AS $$ SELECT id FROM public.hidden LIMIT 1 $$;",
    "CREATE VIEW public.bad AS SELECT id FROM public.hidden;",
  ]) assert.ok(analyseTrees({ workflows: { fixture: loop }, migrations: { ...migrations, "003_bad.sql": sql } }).violations.some(v => v.check === "C-1"));
  for (const sql of [
    "-- SELECT id FROM public.hidden\nCREATE TABLE public.safe(id int);",
    "CREATE FUNCTION public.safe() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT id FROM public.hidden LIMIT 1); END $$;",
  ]) assert.deepEqual(analyseTrees({ workflows: { fixture: loop }, migrations: { ...migrations, "003_safe.sql": sql } }).violations, []);
  assert.ok(parseMigration("unknown.sql", "CREATE FUNCTION public.bad() RETURNS int AS $$ SELECT 1 $$;").unresolved.length);
});
test("unreadable skip syntax fails instead of silently dropping a branch", () => {
  const source = loop.replace("*002_skip.sql) continue ;;", '*002_skip.sql)\n  echo ignored\n  continue ;;');
  assert.ok(analyseTrees({ workflows: { fixture: source }, migrations }).violations.some(v => v.check.startsWith("C-4")));
});
test("basename subjects, alternation, and multiple replay loops are discovered", () => {
  const source = loop.replace('case "$f" in', 'case "$(basename "$f")" in').replace("*002_skip.sql", "002_skip.sql|004_other.sql");
  const lanes = discoverLanes("fixture", source + "\n" + source);
  assert.equal(lanes.length, 2);
  assert.deepEqual(lanes[0].globs, ["002_skip.sql", "004_other.sql"]);
  assert.equal(lanes[0].subjectKind, "basename");
});
