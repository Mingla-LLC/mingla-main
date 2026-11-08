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
