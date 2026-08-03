// Issue #1363 (amendment G1 + G2) — implementor regression test.
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/issue_1363_publish_precision_g1_g2.test.ts
//
// The worktree has no live SQL harness (read-only MCP cannot run a write
// transaction), so — following the established Mingla pattern
// (orch_1075_paid_publish_integrity_guards.test.ts, pg_public_trips_by_brand.test.ts)
// — this pins the SQL contract by reading the migration files and asserting each
// RPC body carries the intended (and ONLY the intended) delta. The behavioral
// live-DB exercise is hand-run by the orchestrator/tester after `db push`.
//
// Covers the amendment's three required proofs:
//   G1  — biz_publish_experience stop-address guard now requires lat + lng ONLY
//         (place_id no longer required) AND the experience_stops INSERT writes
//         coordinate_precision.
//   Trip — business_publish_trip_draft has NO server-side place_id / coordinate
//         guard (only free-text destination) — documented finding, not loosened.
//   G2  — business_patch_event_taxonomy gains p_coordinate_precision, writes it
//         to events.coordinate_precision, and preserves city_required + the
//         conditional location_geo write.
//
// fails-on-revert (verified by the implementor by TRUE LINE DELETION, then
// re-run): restoring the `place_id` null check to the experience guard makes the
// "guard no longer gates on place_id" assertions fail; deleting the
// `coordinate_precision = v_coordinate_precision` UPDATE line fails the G2 write
// assertion; deleting the INSERT `coordinate_precision` column fails G1's INSERT
// assertion.

import { assert } from "jsr:@std/assert@1";

const G1_MIGRATION =
  "supabase/migrations/20270121001363_orch_1363_experience_publish_loosen.sql";
const G0_MIGRATION =
  "supabase/migrations/20270120001363_orch_1363_coordinate_precision.sql";
const G2_MIGRATION =
  "supabase/migrations/20270121001364_orch_1363_event_precision_persist.sql";
// The trip publish RPC's latest definition lives in the #868 migration; the trip
// path is NOT re-published by G1 (no server guard to loosen) — this asserts that
// current-state fact directly against its canonical source.
const TRIP_SOURCE =
  "supabase/migrations/20270116000871_issue_868_cover_gallery_trip_exp_publish.sql";

const g1Sql = await Deno.readTextFile(G1_MIGRATION);
const g0Sql = await Deno.readTextFile(G0_MIGRATION);
const g2Sql = await Deno.readTextFile(G2_MIGRATION);
const tripSql = await Deno.readTextFile(TRIP_SOURCE);

Deno.test("G0: venue location_required guard and nullable precision enum remain", () => {
  const body = fnBody(g0Sql, "biz_create_venue_listing");
  assert(
    /RAISE EXCEPTION 'location_required'/.test(body),
    "venue RPC still rejects missing coordinates",
  );
  assert(
    /CHECK \(coordinate_precision IN \('exact', 'approximate'\)\)/.test(
      g0Sql,
    ),
    "legacy exact and new approximate values remain readable",
  );
});

Deno.test("Amendment 2 migrations contain no manual-placement semantics", () => {
  const combined = `${g0Sql}\n${g1Sql}\n${g2Sql}`.toLocaleLowerCase("en");
  assert(!combined.includes("pin-drop"), "migration comments do not name pin-drop");
  assert(!combined.includes("drop a pin"), "migration comments do not name pin copy");
  assert(!combined.includes("satellite"), "migration comments do not name imagery");
});

/**
 * Slice the body of a named CREATE OR REPLACE FUNCTION, bounded by its own
 * dollar-quote terminator so trailing statements (other functions, GRANTs)
 * never bleed into the slice.
 */
function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert(start !== -1, `migration defines public.${name}`);
  const fnTagIdx = sql.indexOf("$function$", start);
  const dollarIdx = sql.indexOf("$$", start);
  const useFunctionTag =
    fnTagIdx !== -1 && (dollarIdx === -1 || fnTagIdx < dollarIdx);
  const tag = useFunctionTag ? "$function$" : "$$";
  const open = sql.indexOf(tag, start);
  const close = sql.indexOf(tag, open + tag.length);
  assert(close !== -1, `public.${name} body is dollar-quote balanced`);
  return sql.slice(start, close + tag.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// G1 — experience publish guard loosened to lat/lng-only
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("G1: single-mode guard requires lat + lng ONLY (no place_id)", () => {
  const body = fnBody(g1Sql, "biz_publish_experience");
  // Positive: the single-location first-stop guard checks lat + lng and raises
  // stop_address_unvalidated.
  assert(
    /IF\s*\(v_stops->0->>'lat'\)\s*IS NULL\s*OR\s*\(v_stops->0->>'lng'\)\s*IS NULL\s*THEN\s*RAISE EXCEPTION 'stop_address_unvalidated'/m
      .test(body),
    "single-mode guard raises stop_address_unvalidated on null lat/lng",
  );
  // Negative (fails-on-revert): the guard must NOT gate on a null place_id.
  assert(
    !/NULLIF\(v_stops->0->>'place_id',\s*''\)\s*IS NULL/.test(body),
    "single-mode guard no longer requires a non-null place_id",
  );
});

Deno.test("G1: per_stop-mode guard requires lat + lng ONLY (no place_id)", () => {
  const body = fnBody(g1Sql, "biz_publish_experience");
  assert(
    /IF\s*\(v_stop->>'lat'\)\s*IS NULL\s*OR\s*\(v_stop->>'lng'\)\s*IS NULL\s*THEN\s*RAISE EXCEPTION 'stop_address_unvalidated'/m
      .test(body),
    "per_stop guard raises stop_address_unvalidated on null lat/lng",
  );
  assert(
    !/NULLIF\(v_stop->>'place_id',\s*''\)\s*IS NULL/.test(body),
    "per_stop guard no longer requires a non-null place_id",
  );
  // Sanity: exactly the two stop-address guards survive (single + per_stop).
  const hits = body.match(/stop_address_unvalidated/g) ?? [];
  assert(hits.length === 2, `two stop-address guards remain (got ${hits.length})`);
});

Deno.test("G1: experience_stops INSERT persists coordinate_precision", () => {
  const body = fnBody(g1Sql, "biz_publish_experience");
  const insertStart = body.indexOf("INSERT INTO public.experience_stops (");
  assert(insertStart !== -1, "experience_stops INSERT present");
  const insertEnd = body.indexOf(");", insertStart);
  assert(insertEnd !== -1, "experience_stops INSERT terminates");
  const insert = body.slice(insertStart, insertEnd);
  assert(
    /coordinate_precision/.test(insert),
    "INSERT column list includes coordinate_precision",
  );
  assert(
    /v_s_precision/.test(insert),
    "INSERT VALUES supplies v_s_precision",
  );
  // The per-stop precision is normalized (empty/unrecognised → NULL) before use.
  assert(
    /v_s_precision NOT IN \('exact', 'approximate'\)/.test(body),
    "precision token is normalized to exact|approximate|NULL",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Trip finding — business_publish_trip_draft has NO server place_id / coord guard
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("Trip: publish requires only free-text destination, no place_id/coord guard", () => {
  const body = fnBody(tripSql, "business_publish_trip_draft");
  // The ONLY location requirement is a non-null free-text destination.
  assert(
    /RAISE EXCEPTION 'trip_destination_required'/.test(body),
    "trip requires a free-text destinationLocationText",
  );
  assert(
    /destinationLocationText/.test(body),
    "trip destination is validated via free-text, not a place_id",
  );
  // There is NO experience-style coordinate guard, and NO RAISE gated on a null
  // destination place_id / lat / lng. (destinationPlaceId appears ONLY in the
  // post-publish theme-strip, never in an IS NULL guard.)
  assert(
    !/stop_address_unvalidated/.test(body),
    "trip has no experience-style stop_address_unvalidated guard",
  );
  assert(
    !/destination(PlaceId|Lat|Lng)[^\n]*IS NULL/.test(body),
    "trip does not gate publish on a null destination place_id / lat / lng",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// G2 — event taxonomy RPC persists coordinate_precision
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("G2: business_patch_event_taxonomy gains p_coordinate_precision + writes it", () => {
  const body = fnBody(g2Sql, "business_patch_event_taxonomy");
  // New trailing param.
  assert(
    /p_coordinate_precision text DEFAULT ''/.test(body),
    "signature gains p_coordinate_precision text DEFAULT ''",
  );
  // Writes precision to the column (fails-on-revert if this line is deleted).
  assert(
    /coordinate_precision = v_coordinate_precision/.test(body),
    "UPDATE writes events.coordinate_precision",
  );
  // Normalized to exact|approximate|NULL.
  assert(
    /v_coordinate_precision NOT IN \('exact', 'approximate'\)/.test(body),
    "precision token is normalized",
  );
  // Precision preserved when no new coordinate is supplied (mirrors location_geo).
  assert(
    /v_coordinate_precision := v_event\.coordinate_precision/.test(body),
    "existing precision preserved when no new coordinate is supplied",
  );
});

Deno.test("G2: city_required + conditional location_geo write PRESERVED", () => {
  const body = fnBody(g2Sql, "business_patch_event_taxonomy");
  assert(
    /RAISE EXCEPTION 'city_required'/.test(body),
    "city_required guard preserved",
  );
  // Conditional coordinate write: new point when lat+lng present, else keep prior.
  assert(
    /v_location_geo := point\(p_location_lng, p_location_lat\)/.test(body),
    "writes a new point when lat+lng supplied",
  );
  assert(
    /v_location_geo := v_event\.location_geo/.test(body),
    "keeps the existing location_geo when no new coordinate is supplied",
  );
});
