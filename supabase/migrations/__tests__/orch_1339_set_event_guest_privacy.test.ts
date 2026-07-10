// ORCH-1339 [momentum-card-cross-entity] — migration static suite for
// biz_set_event_guest_privacy (SPEC §4.2 / §9: guard order, grant-to-
// authenticated-only, leaf-write-only jsonb_set paths). Run from the REPO ROOT
// (CI convention):
//   deno test --allow-env --allow-net --allow-read --no-check \
//     supabase/migrations/__tests__/orch_1339_set_event_guest_privacy.test.ts
//
// FAILS-ON-REVERT: deleting the host-gate RAISE (GUARD 3), reordering a guard
// after the UPDATE, widening the grants, or jsonb_set-ing any key beyond the
// two owned leaves makes a named assertion FAIL.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20261226000000_orch_1339_set_event_guest_privacy.sql";
const migration = await Deno.readTextFile(MIGRATION_PATH);

// Strip SQL comments so prose never false-positives structural assertions.
const sql = migration.replace(/--[^\n]*/g, "");

Deno.test("§A house protocol — DROP IF EXISTS before CREATE; $function$ before grants; NOTIFY pgrst", () => {
  const drop = sql.indexOf(
    "DROP FUNCTION IF EXISTS public.biz_set_event_guest_privacy(uuid, boolean, boolean);",
  );
  const create = sql.indexOf("CREATE FUNCTION public.biz_set_event_guest_privacy(");
  const terminator = sql.indexOf("$function$;");
  const revoke = sql.indexOf("REVOKE ALL ON FUNCTION public.biz_set_event_guest_privacy");
  const notify = sql.indexOf("NOTIFY pgrst, 'reload schema';");
  assert(drop > -1 && create > -1 && terminator > -1 && revoke > -1 && notify > -1);
  assert(drop < create, "DROP IF EXISTS precedes CREATE");
  assert(terminator < revoke, "$function$; terminator precedes the grants");
  assert(revoke < notify, "grants precede NOTIFY pgrst");
});

Deno.test("§B signature + volatility — (uuid, boolean DEFAULT NULL, boolean DEFAULT NULL) RETURNS jsonb, VOLATILE SECURITY DEFINER, search_path pinned", () => {
  assertStringIncludes(sql, "p_event_id uuid");
  assertStringIncludes(sql, "p_private_guest_list boolean DEFAULT NULL");
  assertStringIncludes(sql, "p_hide_remaining_count boolean DEFAULT NULL");
  assertStringIncludes(sql, "RETURNS jsonb");
  assertStringIncludes(sql, "VOLATILE");
  assertStringIncludes(sql, "SECURITY DEFINER");
  assertStringIncludes(sql, "SET search_path = public");
});

Deno.test("§C guard-FIRST ordering — auth → event load → host gate → write (each RAISE precedes the UPDATE)", () => {
  const auth = sql.indexOf("RAISE EXCEPTION 'authentication_required'");
  const notFound = sql.indexOf("RAISE EXCEPTION 'event_not_found'");
  const notAuthorized = sql.indexOf("RAISE EXCEPTION 'not_authorized'");
  const update = sql.indexOf("UPDATE public.events");
  assert(auth > -1 && notFound > -1 && notAuthorized > -1 && update > -1);
  assert(auth < notFound, "auth guard precedes event resolve");
  assert(notFound < notAuthorized, "event resolve precedes host gate");
  assert(notAuthorized < update, "ALL guards precede the write");
});

Deno.test("§C2 host gate — the exact 1334/1150 event_manager predicate", () => {
  assertStringIncludes(sql, "public.biz_brand_effective_rank(v_event.brand_id, v_uid)");
  assertStringIncludes(sql, "public.biz_role_rank('event_manager'::text)");
});

Deno.test("§C3 event load — verbatim spec SQL (id + deleted_at IS NULL; any event_type)", () => {
  assertStringIncludes(sql, "FROM public.events");
  assertStringIncludes(sql, "WHERE id = p_event_id");
  assertStringIncludes(sql, "AND deleted_at IS NULL");
  assert(!/event_type\s*=/.test(sql), "entity-agnostic: no event_type filter");
});

Deno.test("§D leaf-write ONLY — jsonb_set touches exactly the two owned leaves + the containers", () => {
  const setCalls = [...sql.matchAll(/jsonb_set\(\s*([^,]+),\s*'(\{[^}]*\})'/g)].map(
    (m) => m[2],
  );
  assertEquals(
    setCalls.sort(),
    [
      "{business_event,settings}",
      "{business_event}",
      "{hideRemainingCount}",
      "{privateGuestList}",
    ].sort(),
    "jsonb_set paths are EXACTLY the two leaves + their containers (ORCH-1172/1296 no-clobber)",
  );
  // The no-clobber ingredients: COALESCE param → existing leaf → false.
  assertStringIncludes(sql, "p_private_guest_list,");
  assertStringIncludes(sql, "(v_theme #>> '{business_event,settings,privateGuestList}')::boolean");
  assertStringIncludes(sql, "p_hide_remaining_count,");
  assertStringIncludes(sql, "(v_theme #>> '{business_event,settings,hideRemainingCount}')::boolean");
  // Never re-emits the big edit RPCs.
  for (const banned of [
    "biz_update_live_trip",
    "biz_update_live_experience",
    "business_publish_trip_draft",
    "biz_publish_experience",
  ]) {
    assert(!sql.includes(banned), `migration must not touch ${banned} (COMMS-0029 class)`);
  }
});

Deno.test("§E the UPDATE writes theme + updated_at ONLY", () => {
  const update = /UPDATE public\.events\s+SET([\s\S]*?)WHERE id = p_event_id;/.exec(sql);
  assert(update !== null, "UPDATE statement found");
  const setClause = update[1];
  assertStringIncludes(setClause, "theme = v_theme");
  assertStringIncludes(setClause, "updated_at = now()");
  // No other column assignment sneaks in.
  const assignments = setClause
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  assertEquals(assignments.length, 2, "exactly two SET assignments (theme, updated_at)");
});

Deno.test("§F echo return — the FINAL persisted values", () => {
  assertStringIncludes(sql, "jsonb_build_object(");
  assertStringIncludes(sql, "'privateGuestList', v_private");
  assertStringIncludes(sql, "'hideRemainingCount', v_hide");
});

Deno.test("§G grants — REVOKE PUBLIC + GRANT authenticated ONLY (no anon: this is a write)", () => {
  assertStringIncludes(
    sql,
    "REVOKE ALL ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean) FROM PUBLIC;",
  );
  assertStringIncludes(
    sql,
    "GRANT EXECUTE ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean) TO authenticated;",
  );
  assert(!/GRANT[^;]*\banon\b/.test(sql), "NO anon grant on a write RPC");
  assert(!/GRANT[^;]*service_role/.test(sql), "no service_role grant needed");
});

Deno.test("§H no table DDL / no RLS change — the write is RPC-mediated", () => {
  assert(!/CREATE POLICY|DROP POLICY|ALTER POLICY/.test(sql), "RLS untouched");
  assert(!/ALTER TABLE/.test(sql), "no table DDL");
  assert(!/CREATE TABLE/.test(sql), "no table DDL");
});

Deno.test("§I version monotonic — strictly greater than ORCH-1338's 20261225000000", () => {
  const version = MIGRATION_PATH.split("/").pop()?.split("_")[0] ?? "";
  assert(
    version > "20261225000000",
    `migration version ${version} must be strictly greater than 20261225000000`,
  );
});
