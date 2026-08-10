import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  emitExplainSql,
  enumerateRepository,
  enumerateSource,
  manifestFor,
  quoteIdentifier,
} from "../issue-1614-onconflict-arbiter-audit.mjs";

test("discovers the post-#1614 runtime bootstrap and excludes comments/tests", () => {
  const sites = enumerateRepository();
  assert.equal(sites.length, 83);
  assert.equal(sites.some((site) => site.table === "user_stats"), false);
  assert.equal(sites.some((site) => site.table === "saved_experience_privacy"), false);
  assert.equal(sites.some((site) => site.table === "business_notification_type_preferences"), true);
});

test("discovers future literals and rejects dynamic/unresolved/duplicate targets", () => {
  assert.deepEqual(
    enumerateSource(`db.from('future_table').upsert({}, { onConflict: \`tenant,id\` })`)[0],
    { table: "future_table", columns: ["tenant", "id"], file: "fixture.ts", line: 1 },
  );
  for (const source of [
    `db.from(table).upsert({}, { onConflict: "id" })`,
    `db.from("x").upsert({}, { onConflict: target })`,
    `db.from("x").upsert({}, { onConflict: "id,id" })`,
  ]) assert.throws(() => enumerateSource(source));
});

test("deduplicates targets and emits safely quoted non-mutating EXPLAIN statements", () => {
  const sites = enumerateSource(`
    db.from('odd"table').upsert({}, { onConflict: 'a,b' });
    db.from('odd"table').upsert({}, { onConflict: 'a,b' });
  `);
  const manifest = manifestFor(sites);
  assert.equal(manifest.length, 1);
  assert.equal(quoteIdentifier('odd"table'), '"odd""table"');
  assert.match(
    emitExplainSql(manifest),
    /EXPLAIN INSERT INTO public\."odd""table" \("a", "b"\) VALUES \(NULL, NULL\) ON CONFLICT \("a", "b"\) DO NOTHING;/,
  );
});

test("always-run workflow wires every implementor and tester contract", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/issue-1614-onconflict-arbiter-audit.yml",
    "utf8",
  );
  assert.match(workflow, /pull_request:\s*\n\s*push:\s*\n\s*branches: \[main\]/);
  assert.doesNotMatch(workflow, /\n\s+paths:/);
  assert.match(workflow, /image: supabase\/postgres:17\.4\.1\.075/);
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  for (const required of [
    "issue_1614_upsert_and_notification_prefs.test.sql",
    "issue_1614_upsert_and_notification_prefs.tester_adversarial.test.sql",
    "issue_1614_person_impressions.test.ts",
    "issue_1614_person_impressions.tester_adversarial.test.ts",
    "issue_1614_business_type_preferences.test.ts",
    "issue_1614_business_type_preferences.tester_adversarial.test.ts",
    "issue1614NotificationTypePrefs.test.tsx",
    "issue1614NotificationTypePrefs.testerAdversarial.test.tsx",
    "issue-1614-onconflict-arbiter-audit.test.mjs",
    "issue-1614-onconflict-arbiter-audit.tester-adversarial.test.mjs",
  ]) assert.match(workflow, new RegExp(required.replaceAll(".", "\\.")));
});
