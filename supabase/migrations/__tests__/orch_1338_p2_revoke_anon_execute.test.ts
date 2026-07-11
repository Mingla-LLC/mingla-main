// ORCH-1338 [guest-read-backend] P2 amendment — migration static suite for
// 20261227000000_orch_1338_p2_revoke_anon_execute.sql (tester P2-1: anon
// retained EXECUTE on the two authed-only RPCs because Supabase default
// privileges grant per-ROLE EXECUTE on function CREATE and the applied
// migrations' `REVOKE ALL ... FROM PUBLIC` does not strip a role grant).
// Run from the REPO ROOT (CI convention):
//   deno test --allow-read --no-check \
//     supabase/migrations/__tests__/orch_1338_p2_revoke_anon_execute.test.ts
//
// FAILS-ON-REVERT: deleting either REVOKE line, dropping `anon` from a REVOKE
// role list, deleting a re-GRANT, widening a re-GRANT to anon/PUBLIC, or
// removing NOTIFY pgrst makes a named assertion FAIL.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20261227000000_orch_1338_p2_revoke_anon_execute.sql";
const migration = await Deno.readTextFile(MIGRATION_PATH);

// Strip SQL comments so prose never false-positives structural assertions.
const sql = migration.replace(/--[^\n]*/g, "");

const FN_READ = "public.peer_list_event_guests(uuid, integer, integer)";
const FN_WRITE = "public.biz_set_event_guest_privacy(uuid, boolean, boolean)";

Deno.test("§A REVOKE strips BOTH the PUBLIC path AND the anon role grant — peer_list_event_guests", () => {
  assertStringIncludes(
    sql,
    `REVOKE EXECUTE ON FUNCTION ${FN_READ} FROM PUBLIC, anon;`,
  );
});

Deno.test("§B REVOKE strips BOTH the PUBLIC path AND the anon role grant — biz_set_event_guest_privacy", () => {
  assertStringIncludes(
    sql,
    `REVOKE EXECUTE ON FUNCTION ${FN_WRITE} FROM PUBLIC, anon;`,
  );
});

Deno.test("§C intended grants re-stated explicitly — authenticated ONLY, both functions", () => {
  assertStringIncludes(sql, `GRANT EXECUTE ON FUNCTION ${FN_READ} TO authenticated;`);
  assertStringIncludes(sql, `GRANT EXECUTE ON FUNCTION ${FN_WRITE} TO authenticated;`);
});

Deno.test("§C2 no grant widening — zero GRANTs to anon or PUBLIC anywhere in the migration", () => {
  const grants = [...sql.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]+;/gi)].map(
    (m) => m[0],
  );
  assert(grants.length === 2, `exactly 2 GRANT statements, found ${grants.length}`);
  for (const g of grants) {
    // Judge only the grantee list (after TO) — `public.` in the function's
    // schema-qualified name must not false-positive the PUBLIC check.
    const grantees = g.replace(/^[\s\S]*\bTO\b/i, "");
    assert(!/\banon\b/i.test(grantees), `GRANT must not target anon: ${g}`);
    assert(!/\bPUBLIC\b/i.test(grantees), `GRANT must not target PUBLIC: ${g}`);
    assert(!/\bservice_role\b/i.test(grantees), `originals grant no service_role: ${g}`);
  }
});

Deno.test("§D grants-only migration — no CREATE/DROP FUNCTION, no table/RLS DDL (the applied files stay untouched)", () => {
  assert(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql), "no CREATE FUNCTION");
  assert(!/DROP\s+FUNCTION/i.test(sql), "no DROP FUNCTION");
  assert(!/\b(CREATE|ALTER|DROP)\s+TABLE\b/i.test(sql), "no table DDL");
  assert(!/\b(CREATE|ALTER|DROP)\s+POLICY\b/i.test(sql), "no RLS policy DDL");
});

Deno.test("§E house protocol — BEGIN before the grants, COMMIT after, NOTIFY pgrst last", () => {
  const begin = sql.indexOf("BEGIN;");
  const firstRevoke = sql.indexOf("REVOKE EXECUTE ON FUNCTION");
  const commit = sql.indexOf("COMMIT;");
  const notify = sql.indexOf("NOTIFY pgrst, 'reload schema';");
  assert(begin > -1 && firstRevoke > -1 && commit > -1 && notify > -1);
  assert(begin < firstRevoke, "BEGIN precedes the first REVOKE");
  assert(firstRevoke < commit, "grant DDL inside the transaction");
  assert(commit < notify, "NOTIFY pgrst after COMMIT");
});

Deno.test("§F anon-facing FN-A untouched — pg_public_social_proof appears nowhere (its anon grant is intentional)", () => {
  assert(
    !sql.includes("pg_public_social_proof"),
    "this migration must not touch the intentionally anon-granted FN-A",
  );
});
