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
