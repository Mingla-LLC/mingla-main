// ORCH-1359 [guest-list-sheet-identity-display] — implementor-owned happy-path
// structural regression test for the additive `location` column on Function B
// (peer_list_event_guests) in migration 20261229000000_orch_1359_peer_guest_location.sql.
//
// Pins that location is EMITTED on named rows only (SPEC §4.1 / §5 SC-2/SC-4 /
// §6 I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED), sourced from
// profiles.location via the SAME identity CASE guard as the other named fields,
// added to BOTH branches (RSVP + ticketed), while every ORCH-1338 guard, the
// hard row-cap, the anon-revoke + authenticated-only grant, and the whitelist
// discipline are preserved.
//
// FAILS-ON-REVERT (SPEC §9): deleting the migration file, dropping either
// `named_location` CASE projection, dropping the `'location', n.named_location`
// payload key, loosening the CASE guard so location leaks onto non-named rows,
// widening the profiles whitelist beyond the six allowed columns, or weakening a
// guard makes this suite FAIL; restoring the contract makes it PASS.
//
// Sibling contract: the ORCH-1338 anti-scrape suite still pins the FN-B guards
// on the untouched 20261225000000 file — this file adds only the location facet.
//
// Run locally (repo root):
//   deno test --allow-read supabase/migrations/__tests__/orch_1359_peer_guest_location.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION_PATH =
  "supabase/migrations/20261229000000_orch_1359_peer_guest_location.sql";

const migration = await Deno.readTextFile(MIGRATION_PATH);

function fnBody(name: string): string {
  const re = new RegExp(
    `CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
  );
  const m = migration.match(re);
  assert(m !== null, `function body found for ${name}`);
  return m[0];
}

const fnB = fnBody("peer_list_event_guests");

/** The [begin,end) span between two marker strings inside a body. */
function span(body: string, beginMarker: string, endMarker: string): string {
  const begin = body.indexOf(beginMarker);
  const end = body.indexOf(endMarker);
  assert(begin >= 0, `marker present: ${beginMarker}`);
  assert(end > begin, `marker present + after begin: ${endMarker}`);
  return body.slice(begin, end);
}

const B_RSVP = span(
  fnB,
  "[ORCH-1338 FN-B RSVP-BRANCH-BEGIN]",
  "[ORCH-1338 FN-B RSVP-BRANCH-END]",
);
const B_TICKETED = span(
  fnB,
  "[ORCH-1338 FN-B TICKETED-BRANCH-BEGIN]",
  "[ORCH-1338 FN-B TICKETED-BRANCH-END]",
);

const countOf = (hay: string, needle: string): number =>
  hay.split(needle).length - 1;

// ── T-1 — this migration replaces ONLY Function B (Function A untouched) ─────

Deno.test("T-1 migration is a single CREATE-OR-REPLACE of peer_list_event_guests only", () => {
  assertEquals(
    countOf(migration, "CREATE FUNCTION"),
    1,
    "exactly one CREATE FUNCTION (Function B only)",
  );
  assert(
    migration.includes(
      "DROP FUNCTION IF EXISTS public.peer_list_event_guests(uuid, integer, integer);",
    ),
    "DROP IF EXISTS the exact FN-B signature before CREATE",
  );
  assert(
    !/CREATE FUNCTION public\.pg_public_social_proof/.test(migration),
    "Function A (pg_public_social_proof) is NOT re-declared here (comment may name it)",
  );
});

// ── T-2 — location projected on named rows in BOTH branches, same guard ─────

Deno.test("T-2 named_location CASE (identity-gated) present in BOTH branches", () => {
  // Exactly one identity-gated location projection per branch = 2 total.
  assertEquals(
    countOf(fnB, "THEN p.location END"),
    2,
    "named_location CASE in RSVP + ticketed branch",
  );
  assertEquals(
    countOf(fnB, "AS named_location"),
    2,
    "named_location aliased in both branches",
  );
  assert(
    B_RSVP.includes("THEN p.location END") &&
      B_RSVP.includes("AS named_location"),
    "RSVP branch projects named_location",
  );
  assert(
    B_TICKETED.includes("THEN p.location END") &&
      B_TICKETED.includes("AS named_location"),
    "ticketed branch projects named_location",
  );
});

Deno.test("T-3 location uses the EXACT identity guard — never emitted ungated", () => {
  // Every reference to profiles.location must sit inside a CASE guarded by the
  // identity predicate (linked AND visibility public/friends). Any bare
  // p.location (outside `THEN p.location END`) would leak location on
  // anon/private rows — forbidden.
  assertEquals(
    countOf(fnB, "p.location"),
    2,
    "profiles.location referenced exactly twice — both inside the CASE guard",
  );
  // The guard immediately precedes each THEN p.location END projection.
  const guarded =
    /CASE WHEN b\.linked_user_id IS NOT NULL\s*\n\s*AND p\.visibility_mode IN \('public', 'friends'\)\s*\n\s*THEN p\.location END/g;
  assertEquals(
    (fnB.match(guarded) ?? []).length,
    2,
    "each named_location CASE carries the linked + public/friends identity guard",
  );
});

// ── T-4 — location key wired into the payload, both branches, right slot ────

Deno.test("T-4 'location' payload key emitted in both json_build_object calls", () => {
  assertEquals(
    countOf(fnB, "'location',     n.named_location,"),
    2,
    "location key present in RSVP + ticketed payload",
  );
  // Positional contract (SPEC §4.1): location sits after avatarUrl, before
  // isMinglaUser, in BOTH branch payloads.
  const ordered =
    /'avatarUrl',\s+n\.named_avatar_url,\s*\n\s*'location',\s+n\.named_location,\s*\n\s*'isMinglaUser',/g;
  assertEquals(
    (fnB.match(ordered) ?? []).length,
    2,
    "location key sits after avatarUrl and before isMinglaUser in both branches",
  );
});

// ── T-5 — the profiles column whitelist widened by EXACTLY one (location) ───

Deno.test("T-5 whitelist: only the six allowed profiles columns are touched", () => {
  const allowed = new Set([
    "id",
    "display_name",
    "username",
    "avatar_url",
    "location",
    "visibility_mode",
  ]);
  const cols = new Set(
    (fnB.match(/\bp\.[a-z_]+/g) ?? []).map((s) => s.slice(2)),
  );
  for (const col of cols) {
    assert(
      allowed.has(col),
      `profiles column '${col}' is outside the ORCH-1359 whitelist`,
    );
  }
  assert(cols.has("location"), "location is now inside the whitelist");
});

// ── T-6 — every ORCH-1338 guard + posture preserved (nothing weakened) ──────

Deno.test("T-6 guard order auth → event(scheduled|live) → private → clamp preserved", () => {
  const idxAuth = fnB.indexOf("RAISE EXCEPTION 'authentication_required'");
  const idxEvent = fnB.indexOf("RAISE EXCEPTION 'event_not_available'");
  const idxPrivate = fnB.indexOf("RAISE EXCEPTION 'guest_list_private'");
  const idxClamp = fnB.indexOf("LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)");
  const idxFirstRead = Math.min(
    ...["FROM public.event_rsvps", "FROM public.orders"]
      .map((t) => fnB.indexOf(t))
      .filter((i) => i >= 0),
  );
  assert(idxAuth >= 0 && idxEvent >= 0 && idxPrivate >= 0 && idxClamp >= 0);
  assert(idxAuth < idxEvent, "auth gate first");
  assert(idxEvent < idxPrivate, "event availability before privacy");
  assert(idxPrivate < idxClamp, "privacy before clamp");
  assert(idxClamp < idxFirstRead, "ALL guards precede any guest-row read");
  assert(
    fnB.includes("ARRAY['scheduled'::text, 'live'::text]"),
    "FN-B restricted to scheduled/live",
  );
});

Deno.test("T-7 block exclusion (both directions) preserved in both branches", () => {
  assertEquals(
    countOf(fnB, "NOT public.is_blocked_by(b.linked_user_id, v_viewer)"),
    2,
    "guest→viewer block exclusion in both branches",
  );
  assertEquals(
    countOf(fnB, "NOT public.is_blocked_by(v_viewer, b.linked_user_id)"),
    2,
    "viewer→guest block exclusion in both branches",
  );
});

Deno.test("T-8 posture: DEFINER + STABLE + pinned search_path, anon-revoke, authenticated-only grant, pgrst reload", () => {
  assert(
    /LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = public/
      .test(fnB),
    "STABLE SECURITY DEFINER + pinned search_path",
  );
  assert(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) FROM PUBLIC;",
    ),
    "REVOKE FROM PUBLIC pairs with SECURITY DEFINER",
  );
  const grants = migration.match(
    /GRANT EXECUTE ON FUNCTION public\.peer_list_event_guests\([^)]*\) TO ([^;]+);/g,
  ) ?? [];
  assertEquals(grants.length, 1, "exactly one GRANT for FN-B");
  assert(/TO authenticated;$/.test(grants[0] ?? ""), "grant is authenticated only");
  assert(!/\banon\b/.test(grants[0] ?? ""), "no anon in the FN-B grant");
  assert(
    migration.includes("NOTIFY pgrst, 'reload schema';"),
    "PostgREST reload present",
  );
});

Deno.test("T-9 no typed contact data of non-users leaks anywhere in the migration", () => {
  assert(
    !/guest_email|guest_phone|guest_name|buyer_name|buyer_email|buyer_phone|attendee_/
      .test(migration),
    "no guest_*/buyer-contact/attendee_* token in any expression OR comment",
  );
});
