// #4334 (tester F-9) — the #4334 migration restates the grants of every
// function it re-emits, #1023 style, plus the #3044 db-push-reachable marker,
// so nobody depends on CREATE OR REPLACE carrying an ACL over.
// Fails on revert: delete any REVOKE/GRANT line or the #3044 COMMENT below.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  new URL("../20280521004334_issue_4334_google_places.sql", import.meta.url),
);
const flat = sql.replace(/\s+/g, " ");

const OWNERS = [
  "public.business_create_event_draft(uuid,jsonb)",
  "public.business_update_event_draft(uuid,jsonb,integer)",
  "public.business_update_rsvp_graph(uuid,jsonb,text,uuid)",
  "public.business_update_live_event_atomic(uuid,jsonb,text,integer)",
  "public.business_publish_event_draft(uuid,jsonb,integer)",
  "public.admin_review_venue_details_change(uuid,uuid,text,text)",
];

Deno.test("G-1 every re-emitted authenticated-only owner has REVOKE (PUBLIC, anon) and GRANT (authenticated, service_role)", () => {
  for (const fn of OWNERS) {
    assert(flat.includes(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC,anon;`), `missing REVOKE for ${fn}`);
    assert(flat.includes(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated,service_role;`), `missing GRANT for ${fn}`);
  }
});

Deno.test("G-2 the public event read keeps its guest grant; the RSVP graph keeps its #3044 marker", () => {
  assert(flat.includes("GRANT EXECUTE ON FUNCTION public.pg_public_event_by_slug(text,text) TO anon,authenticated,service_role;"));
  assert(/COMMENT ON FUNCTION public\.business_update_rsvp_graph\(uuid,jsonb,text,uuid\) IS '#3044 db-push-reachable/.test(flat));
});

Deno.test("G-3 the N-1 regenerated public reads restate production's guest grants and stay #2489 carriers", () => {
  assert(flat.includes("REVOKE ALL ON FUNCTION public.pg_direct_event_checkout_bundle(uuid,text,text) FROM PUBLIC;"));
  assert(flat.includes("GRANT EXECUTE ON FUNCTION public.pg_direct_event_checkout_bundle(uuid,text,text) TO anon,authenticated,service_role;"));
  assert(flat.includes("GRANT EXECUTE ON FUNCTION public.pg_public_rsvp_by_slug(text,text) TO anon,authenticated,service_role;"));
  assert(flat.includes("('pg_direct_event_checkout_bundle', 'function'), ('pg_public_rsvp_by_slug', 'function') ON CONFLICT (object_name) DO NOTHING;"));
});

Deno.test("G-4 the public events view keeps production's ACL and its #2489 carrier row; the place id is appended last", () => {
  assert(flat.includes("REVOKE ALL ON TABLE public.business_public_events_view FROM PUBLIC;"));
  assert(flat.includes("GRANT SELECT ON TABLE public.business_public_events_view TO anon, authenticated;"));
  assert(flat.includes("GRANT ALL ON TABLE public.business_public_events_view TO service_role;"));
  assert(flat.includes("VALUES ('business_public_events_view', 'view') ON CONFLICT (object_name) DO NOTHING;"));
  assert(/e\.theme_gradient_override, CASE WHEN issue_2489_address_withheld\(e\.theme\) THEN NULL::text ELSE e\.location_provider_place_id END AS location_provider_place_id FROM events e/.test(flat));
});
