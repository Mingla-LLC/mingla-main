import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  new URL("../20271120003988_issue_3988_operational_permissions.sql", import.meta.url),
);
const normalized = sql.replace(/\s+/g, " ").trim();

const GUARDED = [
  ["is_admin_user_md5", "public.is_admin_user()", "issue3988_is_admin_user_changed"],
  ["role_areas_md5", "public.admin_team_role_areas(text)", "issue3988_admin_team_role_areas_changed"],
  ["my_access_md5", "public.admin_team_my_access()", "issue3988_admin_team_my_access_changed"],
  [
    "product_truth_md5",
    "public.team_agent_product_truth_call(text,text,jsonb,text)",
    "issue3988_team_agent_product_truth_call_changed",
  ],
] as const;

Deno.test("functions owned elsewhere are snapshotted at apply time, never as constants", () => {
  const firstFunction = normalized.indexOf("CREATE OR REPLACE FUNCTION");
  for (const [setting, signature, error] of GUARDED) {
    const snapshot = normalized.indexOf(`'issue3988.${setting}', (SELECT md5(p.prosrc) FROM pg_proc p`);
    assert(snapshot > 0 && snapshot < firstFunction, `${setting} must be snapshotted before any function changes`);
    assertStringIncludes(normalized, `'${signature}'::regprocedure`);
    assertStringIncludes(normalized, `current_setting('issue3988.${setting}') IS DISTINCT FROM`);
    assertStringIncludes(normalized, `RAISE EXCEPTION '${error}'`);
  }
  assertEquals(/'[0-9a-f]{32}'/.test(sql), false, "no hard-coded md5 constants");
});

Deno.test("the migration never replaces the guarded functions", () => {
  for (const name of ["is_admin_user", "admin_team_role_areas", "admin_team_my_access", "team_agent_product_truth_call"]) {
    assertEquals(
      new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "i").test(sql),
      false,
      name,
    );
  }
});

Deno.test("one transaction, and the backfill names nobody", () => {
  assertEquals(sql.match(/^BEGIN;$/gm)?.length, 1);
  assertEquals(sql.match(/^COMMIT;$/gm)?.length, 1);
  assertEquals(/@[a-z0-9-]+\.[a-z]/i.test(sql), false, "no email addresses in the migration");
  assertStringIncludes(normalized, "SELECT public.issue_3988_backfill_permissions();");
});
