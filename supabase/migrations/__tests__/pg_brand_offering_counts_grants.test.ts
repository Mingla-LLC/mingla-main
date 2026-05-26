// META-ORCH-0972 Sub-D grant rework regression.
//
// Run:
//   deno test --allow-read supabase/migrations/__tests__/pg_brand_offering_counts_grants.test.ts
//
// Pins the anon-vs-authenticated privilege posture for the owner-side
// pg_brand_offering_counts RPC without requiring a live Supabase instance.

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql",
);

const privilegeProbe = await Deno.readTextFile(
  "supabase/migrations/__tests__/pg_brand_offering_counts_privilege_probe.sql",
);

const normalized = migration.replace(/\s+/g, " ").trim();

Deno.test("pg_brand_offering_counts grant repair revokes anon and keeps authenticated execute", () => {
  assertStringIncludes(
    normalized,
    "REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM PUBLIC;",
  );
  assertStringIncludes(
    normalized,
    "REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM anon;",
  );
  assertStringIncludes(
    normalized,
    "GRANT EXECUTE ON FUNCTION public.pg_brand_offering_counts(uuid) TO authenticated;",
  );
});

Deno.test("pg_brand_offering_counts grant repair does not restore anon execute", () => {
  assert(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.pg_brand_offering_counts\s*\(\s*uuid\s*\)\s+TO\s+(?:anon|PUBLIC)\b/i
      .test(migration),
    "anon/PUBLIC must not receive EXECUTE on pg_brand_offering_counts",
  );

  const grants = Array.from(
    migration.matchAll(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.pg_brand_offering_counts\s*\(\s*uuid\s*\)\s+TO\s+([^;]+);/gi,
    ),
    (match) => match[1].trim(),
  );

  assertEquals(grants, ["authenticated"]);
});

Deno.test("pg_brand_offering_counts live SQL probe shape asserts anon=false and authenticated=true", () => {
  assertMatch(privilegeProbe, /anon_can_execute = false/);
  assertMatch(privilegeProbe, /authenticated_can_execute = true/);
  assertMatch(privilegeProbe, /has_function_privilege\(\s*'anon'/);
  assertMatch(privilegeProbe, /AS anon_can_execute/);
  assertMatch(privilegeProbe, /has_function_privilege\(\s*'authenticated'/);
  assertMatch(privilegeProbe, /AS authenticated_can_execute/);
});
