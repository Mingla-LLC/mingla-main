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
  // Census counter, not a behavioural pin — the same class as MANIFEST.json's
  // expectedStrictGrepMjsFiles, and designed to move when the census genuinely
  // moves. It is computed FROM THE REPO, so it is also the one line two
  // concurrent branches will always collide on; the house rule is
  // `origin + delta`, never carrying an absolute number across a rebase.
  //
  // Current derivation:
  //     83  pre-#679 targets
  //   +  1  #679  brand_follows (user_id,brand_id)
  //          — app-mobile/src/services/brandFollowsService.ts
  //   +  2  #1789 menu_modifier_groups (id) + menu_modifiers (id)
  //          — mingla-business/src/hooks/useMenuModifiers.ts:206 and :232
  //   = 86
  //
  // [TEST-MOD-APPROVED #1789] Both #1789 sites resolve to a real, non-partial
  // arbiter — `PRIMARY KEY (id)` on each table, created at
  // supabase/migrations/20270305001789_issue_1789_qr_spots_menu_depth_and_ordering_settings.sql:544
  // and :565. Verified on PostgreSQL 17, which reported
  // `Conflict Arbiter Indexes: menu_modifier_groups_pkey` and
  // `Conflict Arbiter Indexes: menu_modifiers_pkey` for this audit's own
  // EXPLAIN. Every other assertion in this file is untouched.
  assert.equal(sites.length, 86);
  assert.equal(sites.some((site) => site.table === "user_stats"), false);
  assert.equal(sites.some((site) => site.table === "saved_experience_privacy"), false);
  assert.equal(sites.some((site) => site.table === "business_notification_type_preferences"), true);
  assert.equal(sites.some((site) => site.table === "brand_follows"), true);
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

test("enumerates every exact literal key spelling without scanning string contents", () => {
  const fixture = `
    const documentation = '\"onConflict\": \"not_a_property\"';
    // db.from("commented").upsert({}, { "onConflict": "ignored" });
    /* db.from("commented_computed").upsert({}, { ["onConflict"]: "ignored" }); */
    db.from("future_identifier").upsert({}, { onConflict: "tenant,id" });
    db.from("future_quoted").upsert({}, { "onConflict": "tenant,id" });
    db.from("future_single_quoted").upsert({}, { 'onConflict': 'tenant,id' });
    db.from("future_computed").upsert({}, { ["onConflict"]: "tenant,id" });
    db.from("future_computed_single").upsert({}, { ['onConflict']: 'tenant,id' });
    db.from("future_computed_backtick").upsert({}, { [\`onConflict\`]: \`tenant,id\` });
  `;
  const sites = enumerateSource(fixture, "future-key-spellings.ts");
  assert.equal(sites.length, 6);
  assert.deepEqual(
    sites.map((site) => site.table),
    [
      "future_identifier",
      "future_quoted",
      "future_single_quoted",
      "future_computed",
      "future_computed_single",
      "future_computed_backtick",
    ],
  );

  const manifest = manifestFor(sites);
  const sql = emitExplainSql(manifest);
  assert.equal(manifest.length, 6);
  assert.match(sql, /future-key-spellings\.ts:\d+/);
  assert.match(sql, /public\."future_quoted" \("tenant", "id"\)/);
  assert.match(sql, /public\."future_computed" \("tenant", "id"\)/);

  assert.throws(() =>
    enumerateSource(`db.from("dynamic").upsert({}, { "onConflict": target })`)
  );
  assert.throws(() =>
    enumerateSource(`db.from(table).upsert({}, { ["onConflict"]: "id" })`)
  );
});

test("scans template expressions and semantic escaped keys while excluding regex bodies", () => {
  const fixture = [
    'const receipt = `${db.from("template_expression").upsert({}, { onConflict: "id" })}`;',
    String.raw`db.from("escaped_unicode").upsert({}, { ["on\u0043onflict"]: "tenant,id" });`,
    String.raw`db.from("escaped_hex").upsert({}, { ["on\x43onflict"]: "id" });`,
    String.raw`const regex = /db\.from\("ignored"\)\.upsert\(\{\}, \{ "onConflict": "id" \}\)/;`,
  ].join("\n");
  assert.deepEqual(
    enumerateSource(fixture, "lexical-completeness.ts").map(({ table, columns }) => ({
      table,
      columns,
    })),
    [
      { table: "template_expression", columns: ["id"] },
      { table: "escaped_unicode", columns: ["tenant", "id"] },
      { table: "escaped_hex", columns: ["id"] },
    ],
  );
});
