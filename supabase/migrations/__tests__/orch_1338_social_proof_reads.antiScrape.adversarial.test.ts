// ORCH-1338 [guest-read-backend] — ADVERSARIAL anti-scrape/anti-leak contract
// test (SPEC §9 structural safeguard + T-14 static half).
//
// Attacks a DIFFERENT angle than orch_1338_social_proof_reads.test.ts: that
// suite pins formulas + branch separation + shapes; THIS suite pins that no
// bypass path exists for the privacy guards — per SPEC §9, in order:
//   (a) 'authentication_required' precedes ANY guest-table read in Function B;
//   (b) the 'guest_list_private' gate exists and precedes row reads;
//   (c) the LEAST(GREATEST( hard row-cap clamp is present;
//   (d) Function B's GRANT carries NO anon;
//   (e) no typed-contact-data token appears ANYWHERE in the migration;
//   (f) Function A's sample object literals carry ONLY avatarUrl/isMinglaUser.
// Plus: REVOKE-pairs-with-DEFINER, per-guest privacy predicates (visibility
// + both-direction blocks), sample LIMIT 5, and the functions-only guarantee
// (no policy/table DDL — SC-10 static half).
//
// FAILS-ON-REVERT (SPEC §9): deleting the migration file, weakening any guard
// token, adding an anon grant to Function B, or widening the sample keys makes
// this suite FAIL; restoring the contract makes it PASS.
//
// WHY (F-8): a SECURITY DEFINER RPC without a guard is an open per-event
// guest-scraper. Contract: SPEC_ORCH-1338_GUEST_READ_BACKEND +
// I-PROPOSED-1338-PEER-GUEST-READ-GUARDED.
//
// Run locally (repo root):
//   deno test --allow-read supabase/migrations/__tests__/orch_1338_social_proof_reads.antiScrape.adversarial.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION_PATH =
  "supabase/migrations/20261225000000_orch_1338_social_proof_guest_reads.sql";

const migration = await Deno.readTextFile(MIGRATION_PATH);

function fnBody(name: string): string {
  const re = new RegExp(
    `CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
  );
  const m = migration.match(re);
  assert(m !== null, `function body found for ${name}`);
  return m[0];
}

const fnA = fnBody("pg_public_social_proof");
const fnB = fnBody("peer_list_event_guests");

/** First index of any guest-table read in a body (event_rsvps/orders/tickets). */
function firstGuestRead(body: string): number {
  const idxs = [
    "FROM public.event_rsvps",
    "FROM public.orders",
    "FROM public.tickets",
    "JOIN public.tickets",
  ]
    .map((t) => body.indexOf(t))
    .filter((i) => i >= 0);
  assert(idxs.length > 0, "body reads at least one guest table");
  return Math.min(...idxs);
}

// (a) — auth gate BEFORE any guest-table read in Function B.
Deno.test("§9a FN-B: authentication_required precedes any event_rsvps/orders/tickets read", () => {
  const idxAuth = fnB.indexOf("RAISE EXCEPTION 'authentication_required'");
  assert(idxAuth >= 0, "auth guard present as a RAISE");
  assert(idxAuth < firstGuestRead(fnB), "auth guard precedes ALL row reads");
  // The guard must be reachable for EVERY anon caller: it keys on auth.uid().
  const idxUid = fnB.indexOf("auth.uid()");
  assert(idxUid >= 0 && idxUid < idxAuth, "guard keys on auth.uid()");
});

// (b) — guest_list_private gate exists and precedes row reads.
Deno.test("§9b FN-B: guest_list_private gate precedes row reads (D2 server-enforced)", () => {
  const idxGate = fnB.indexOf("RAISE EXCEPTION 'guest_list_private'");
  assert(idxGate >= 0, "privacy gate present as a RAISE");
  assert(idxGate < firstGuestRead(fnB), "privacy gate precedes ALL row reads");
  // The gate reads the HOST-stored theme leaf server-side, never a parameter.
  assert(
    fnB.includes("#>> '{business_event,settings,privateGuestList}'"),
    "gate sources events.theme server-side",
  );
});

// (c) — hard row-cap clamp present, before reads, with the 100 ceiling.
Deno.test("§9c FN-B: LEAST(GREATEST( clamp present with hard cap 100 / floor 1", () => {
  const idxClamp = fnB.indexOf("LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)");
  assert(idxClamp >= 0, "exact clamp expression present");
  assert(idxClamp < firstGuestRead(fnB), "clamp precedes row reads");
  assert(
    fnB.includes("GREATEST(COALESCE(p_offset, 0), 0)"),
    "offset floored at 0",
  );
});

// (d) — Function B is NEVER anon-callable.
Deno.test("§9d FN-B grant: authenticated ONLY — no anon, exactly one grant", () => {
  const grants = migration.match(
    /GRANT EXECUTE ON FUNCTION public\.peer_list_event_guests\([^)]*\) TO ([^;]+);/g,
  ) ?? [];
  assertEquals(grants.length, 1, "exactly one GRANT for peer_list_event_guests");
  const grantLine = grants[0] ?? "";
  assert(
    /TO authenticated;$/.test(grantLine),
    "grant is TO authenticated; (nothing else)",
  );
  assert(!/\banon\b/.test(grantLine), "no anon in the FN-B grant");
  assert(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) FROM PUBLIC;",
    ),
    "REVOKE FROM PUBLIC pairs with SECURITY DEFINER (FN-B)",
  );
});

// (e) — typed contact data of non-users NEVER appears (T-14 static half).
Deno.test("§9e migration: zero typed-contact-data tokens anywhere in the file", () => {
  assert(
    !/guest_email|guest_phone|guest_name|buyer_name|buyer_email|buyer_phone|attendee_/
      .test(migration),
    "no guest_*/buyer-contact/attendee_* token in any expression OR comment",
  );
});

// (f) — Function A's sample literal is EXACTLY {avatarUrl, isMinglaUser}.
Deno.test("§9f FN-A sample: object literals carry ONLY avatarUrl + isMinglaUser", () => {
  // Both branch samples build the same two-key literal.
  const sampleBuilds = fnA.match(
    /json_build_object\(\s*'avatarUrl', s\.avatar_url,\s*'isMinglaUser', true\s*\)/g,
  ) ?? [];
  assertEquals(sampleBuilds.length, 2, "both branches build the two-key sample");
  // No identity key/column can appear ANYWHERE in Function A (names live
  // exclusively in Function B).
  for (
    const forbidden of [
      "'profileId'",
      "'displayName'",
      "'username'",
      "display_name",
      "p.username",
      "'isAnonymous'",
    ]
  ) {
    assert(
      !fnA.includes(forbidden),
      `FN-A must not reference ${forbidden} (anon shape carries NO names — D1)`,
    );
  }
});

// Sample privacy predicates + size (SC-4 static half).
Deno.test("FN-A sample: private-profile exclusion, avatar-required, both-direction blocks, LIMIT 5", () => {
  assertEquals(
    (fnA.match(/p\.visibility_mode IN \('public', 'friends'\)/g) ?? []).length,
    2,
    "visibility_mode gate in BOTH branch samples ('private' excluded)",
  );
  assertEquals(
    (fnA.match(/p\.avatar_url IS NOT NULL/g) ?? []).length,
    2,
    "avatar-bearing only",
  );
  assertEquals(
    (fnA.match(/length\(btrim\(p\.avatar_url\)\) > 0/g) ?? []).length,
    2,
    "empty-string avatars excluded",
  );
  assertEquals(
    (fnA.match(/NOT public\.is_blocked_by\(p\.id, v_viewer\)/g) ?? []).length,
    2,
    "block exclusion guest→viewer in both branches",
  );
  assertEquals(
    (fnA.match(/NOT public\.is_blocked_by\(v_viewer, p\.id\)/g) ?? []).length,
    2,
    "block exclusion viewer→guest in both branches",
  );
  assertEquals(
    (fnA.match(/LIMIT 5/g) ?? []).length,
    2,
    "sample hard-capped at 5 (SOCIAL_PROOF_SAMPLE_MAX) in both branches",
  );
  // D2: empty sample is UNCONDITIONAL under the host gate.
  assertEquals(
    (fnA.match(/IF NOT v_private THEN/g) ?? []).length,
    2,
    "sample work only runs when privateGuestList is off",
  );
});

// FN-B per-row privacy: named-row predicate + both-direction block exclusion.
Deno.test("FN-B rows: named only for public/friends; blocked pairs excluded both directions", () => {
  assertEquals(
    (fnB.match(/p\.visibility_mode IN \('public', 'friends'\)/g) ?? []).length,
    10,
    "visibility predicate on is_named + all four identity columns × both branches",
  );
  assertEquals(
    (fnB.match(/NOT public\.is_blocked_by\(b\.linked_user_id, v_viewer\)/g) ?? [])
      .length,
    2,
    "block exclusion guest→viewer in both branches",
  );
  assertEquals(
    (fnB.match(/NOT public\.is_blocked_by\(v_viewer, b\.linked_user_id\)/g) ?? [])
      .length,
    2,
    "block exclusion viewer→guest in both branches",
  );
  // Whitelist: the only profiles columns FN-B may touch.
  const profileCols = new Set(
    (fnB.match(/\bp\.[a-z_]+/g) ?? []).map((s) => s.slice(2)),
  );
  for (const col of profileCols) {
    assert(
      ["id", "display_name", "username", "avatar_url", "visibility_mode"]
        .includes(col),
      `profiles column '${col}' is outside the SPEC whitelist`,
    );
  }
});

// Function A stays anon-callable (that is its job) — but REVOKE-paired.
Deno.test("FN-A grant: anon + authenticated, REVOKE FROM PUBLIC paired", () => {
  assert(
    migration.includes(
      "GRANT EXECUTE ON FUNCTION public.pg_public_social_proof(uuid) TO anon, authenticated;",
    ),
  );
  assert(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.pg_public_social_proof(uuid) FROM PUBLIC;",
    ),
  );
});

// Functions-only migration (SC-10 static half): table RLS/DDL untouched.
Deno.test("migration is functions-only: no policy DDL, no table DDL, no RLS toggles", () => {
  assert(!/CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(migration));
  assert(!/CREATE TABLE|ALTER TABLE|DROP TABLE/i.test(migration));
  assert(!/ROW LEVEL SECURITY/i.test(migration));
  // Exactly two functions, both SECURITY DEFINER with pinned search_path.
  assertEquals(
    (migration.match(/CREATE FUNCTION/g) ?? []).length,
    2,
    "exactly two CREATE FUNCTION statements — no unguarded wrapper",
  );
  for (const body of [fnA, fnB]) {
    assert(
      /LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = public/
        .test(body),
      "STABLE SECURITY DEFINER + pinned search_path on each function",
    );
  }
  assert(
    migration.includes("NOTIFY pgrst, 'reload schema';"),
    "PostgREST reload present (SC-9)",
  );
});
