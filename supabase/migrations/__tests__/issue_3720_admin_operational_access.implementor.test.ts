import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  new URL("../20271028003720_issue_3720_admin_operational_access.sql", import.meta.url),
);
const normalized = sql.replace(/\s+/g, " ").trim();

Deno.test("adds a separate scoped operational-access RPC", () => {
  assertStringIncludes(normalized, "CREATE OR REPLACE FUNCTION public.admin_team_my_operational_areas()");
  assertStringIncludes(normalized, "public.admin_team_role() IS NULL");
  assertStringIncludes(normalized, "FROM public.support_staff s");
  assertStringIncludes(normalized, "FROM public.community_staff s");
  assertStringIncludes(normalized, "s.enabled = true");
  assertStringIncludes(normalized, "'community_support_support'");
  assertStringIncludes(normalized, "'community_support_community'");
});

Deno.test("does not widen or replace any full-admin authority", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_admin_user\s*\(/i.test(sql));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_team_role_areas\s*\(/i.test(sql));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_team_my_access\s*\(/i.test(sql));
  assert(!/['"]admin_console['"]/.test(sql));
  assertStringIncludes(normalized, "issue3720_is_admin_user_changed");
  assertStringIncludes(normalized, "issue3720_admin_team_role_areas_changed");
  assertStringIncludes(normalized, "issue3720_admin_team_my_access_changed");
});

Deno.test("the RPC is authenticated-only and reloads PostgREST", () => {
  assertStringIncludes(normalized, "REVOKE ALL ON FUNCTION public.admin_team_my_operational_areas() FROM PUBLIC, anon, authenticated");
  assertStringIncludes(normalized, "GRANT EXECUTE ON FUNCTION public.admin_team_my_operational_areas() TO authenticated, service_role");
  assertStringIncludes(normalized, "NOTIFY pgrst, 'reload schema'");
});
