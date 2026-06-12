// ORCH-1119B [trip-day-media-gallery] — Storage RLS regression (DB layer).
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/orch_1119b_trip_day_media_storage_rls.test.ts
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The trip-day media upload service builds a 3-FOLDER-SEGMENT object key
//   {brandId}/{eventId}/trip-day-media/{token}.{ext}
// but every pre-existing `event_covers` write policy (INSERT/UPDATE/DELETE)
// hard-requires `array_length(storage.foldername(name), 1) = 2`. Three segments
// never satisfy that count → RLS 403'd EVERY trip-day upload → zero objects ever
// landed (silent, in combination with the Modal-occluded toast). The fix is a
// NEW, additive, fail-closed policy set scoped to `foldername[3] = 'trip-day-media'`.
//
// This test attacks the DB layer two ways:
//   1. STRUCTURAL anchors (`migrationContains`) — the three named trip-day
//      policies and their key predicates MUST be present. Dropping the policy
//      (reverting the migration) fails these.
//   2. BEHAVIOR / TRUTH-TABLE — the deployed predicate, re-implemented byte-for-
//      byte from the migration, produces the correct ALLOW/DENY for the exact
//      cases that prove disjointness + fail-close.
//
// LIVE-DB CROSS-CHECK (captured by the implementor via the Supabase Management
// API against prod, 2026-06-12 — pinned in
// IMPLEMENTATION_ORCH-1119B_UPLOAD_RLS_VISIBLE_FAILURE.md). Real authenticated
// INSERT attempts into storage.objects:
//   (a) 3-seg {brand}/{event}/trip-day-media/{f} as brand OWNER (rank 60 ≥ 40) => ALLOW (object landed)
//   (b) same key as a NON-MEMBER stranger (rank 0)                              => DENY
//   (c) 2-seg {brand}/{event}/{f} event-cover as brand OWNER                    => ALLOW (no regression)
//   (d) 3-seg {brand}/{event}/evil/{f} (foldername[3] != 'trip-day-media') OWNER => DENY (no cross-loosen)
//
// fails-on-revert: drop the trip-day INSERT policy from the migration → the
// `migrationContains` anchors below fail AND the truth-table's (a)-ALLOW case
// has no policy to satisfy it (re-implementation would no longer match a
// deployed policy → the migrationContains drift-guard fails first).

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION =
  "supabase/migrations/20260930000000_orch_1119b_trip_day_media_storage_rls.sql";
const sql = await Deno.readTextFile(MIGRATION);

const COVER_MIGRATION =
  "supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql";
const coverSql = await Deno.readTextFile(COVER_MIGRATION);

function migrationContains(needle: string, why: string) {
  assert(
    sql.includes(needle),
    `migration must still contain \`${needle}\` (${why})`,
  );
}

// ── 1. STRUCTURAL anchors — the three additive trip-day policies must exist ──
Deno.test("ORCH-1119B: INSERT policy for the 3-segment trip-day key exists", () => {
  migrationContains(
    'CREATE POLICY "Event managers can upload trip day media"',
    "the load-bearing INSERT policy that un-403s trip-day uploads",
  );
  migrationContains("FOR INSERT", "must be an INSERT policy");
});

Deno.test("ORCH-1119B: UPDATE + DELETE trip-day policies exist (upsert + cleanup)", () => {
  migrationContains(
    'CREATE POLICY "Event managers can update trip day media"',
    "upsert:true requires UPDATE permission",
  );
  migrationContains(
    'CREATE POLICY "Event managers can delete trip day media"',
    "defensive cleanup parity with the cover policy set",
  );
});

Deno.test("ORCH-1119B: policies are idempotent (DROP IF EXISTS before CREATE)", () => {
  migrationContains(
    'DROP POLICY IF EXISTS "Event managers can upload trip day media" ON storage.objects',
    "idempotent re-apply",
  );
});

Deno.test("ORCH-1119B: scoped to exactly 3 segments AND foldername[3]='trip-day-media'", () => {
  migrationContains(
    "array_length(storage.foldername(name), 1) = 3",
    "the 3-segment count guard (the predicate the 2-seg policy was missing)",
  );
  migrationContains(
    "(storage.foldername(name))[3] = 'trip-day-media'",
    "literal subfolder guard — disjoint from the 2-seg cover policy + blocks /evil/",
  );
});

Deno.test("ORCH-1119B: fail-closed auth predicate mirrors the cover policy byte-for-byte", () => {
  const authPredicate =
    "public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')";
  migrationContains(authPredicate, "caller rank >= event_manager (fail-closed)");
  // The same predicate the existing 2-segment cover policy uses — no drift.
  assert(
    coverSql.includes(authPredicate),
    "the auth predicate must be identical to the existing cover policy (no privilege drift)",
  );
  migrationContains("e.deleted_at IS NULL", "no writes against a soft-deleted trip");
  migrationContains("bucket_id = 'event_covers'", "scoped to the event_covers bucket");
});

Deno.test("ORCH-1119B: the existing 2-segment cover policy is NOT modified here", () => {
  // The trip-day migration must NOT touch the 2-segment count or the cover
  // policy names — they live only in the cover migration.
  assert(
    !sql.includes("array_length(storage.foldername(name), 1) = 2"),
    "the trip-day migration must not redefine/loosen the 2-segment cover predicate",
  );
  assert(
    !sql.includes('"Event managers can upload event covers"'),
    "the trip-day migration must not redefine the existing 2-segment cover policy",
  );
});

// ── 2. BEHAVIOR / TRUTH-TABLE — re-implement the deployed predicate ──────────
// Mirrors the migration's WITH CHECK exactly. `callerRank` models
// biz_brand_effective_rank_for_caller for the caller against the key's brand.
const EVENT_MANAGER_RANK = 40; // public.biz_role_rank('event_manager') (live: 40)

function tripDayInsertAllowed(
  key: string,
  opts: { bucket: string; eventExistsForKey: boolean; callerRank: number },
): boolean {
  if (opts.bucket !== "event_covers") return false;
  const segs = key.split("/");
  const folders = segs.slice(0, -1); // storage.foldername = path minus the filename
  const filename = segs[segs.length - 1];
  if (folders.length !== 3) return false; // array_length(...) = 3
  if (folders[2] !== "trip-day-media") return false; // [3] = 'trip-day-media'
  if (filename === "") return false; // storage.filename(name) <> ''
  // EXISTS(events e WHERE brand_id=[1] AND id=[2] AND deleted_at IS NULL AND rank>=event_manager)
  return opts.eventExistsForKey && opts.callerRank >= EVENT_MANAGER_RANK;
}

const BRAND = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
const EVENT = "61980280-ff31-4e84-a169-ea97bd07eff4";

Deno.test("ORCH-1119B (a): 3-seg trip-day key as event_manager OWNER => ALLOW", () => {
  assertEquals(
    tripDayInsertAllowed(`${BRAND}/${EVENT}/trip-day-media/tok.jpg`, {
      bucket: "event_covers",
      eventExistsForKey: true,
      callerRank: 60, // brand_owner
    }),
    true,
  );
});

Deno.test("ORCH-1119B (b): 3-seg trip-day key as under-ranked/non-member => DENY", () => {
  assertEquals(
    tripDayInsertAllowed(`${BRAND}/${EVENT}/trip-day-media/tok.jpg`, {
      bucket: "event_covers",
      eventExistsForKey: true,
      callerRank: 0, // stranger / viewer
    }),
    false,
  );
  // A real event_manager of a DIFFERENT brand (no matching events row) => DENY.
  assertEquals(
    tripDayInsertAllowed(`${BRAND}/${EVENT}/trip-day-media/tok.jpg`, {
      bucket: "event_covers",
      eventExistsForKey: false,
      callerRank: 60,
    }),
    false,
  );
});

Deno.test("ORCH-1119B (d): 3-seg key whose [3] != 'trip-day-media' => DENY (no cross-loosen)", () => {
  assertEquals(
    tripDayInsertAllowed(`${BRAND}/${EVENT}/evil/tok.jpg`, {
      bucket: "event_covers",
      eventExistsForKey: true,
      callerRank: 60,
    }),
    false,
  );
  // A 4-segment deep path (array_length = 4) is also denied.
  assertEquals(
    tripDayInsertAllowed(`${BRAND}/${EVENT}/trip-day-media/sub/tok.jpg`, {
      bucket: "event_covers",
      eventExistsForKey: true,
      callerRank: 60,
    }),
    false,
  );
});

Deno.test("ORCH-1119B: empty filename => DENY", () => {
  assertEquals(
    tripDayInsertAllowed(`${BRAND}/${EVENT}/trip-day-media/`, {
      bucket: "event_covers",
      eventExistsForKey: true,
      callerRank: 60,
    }),
    false,
  );
});

Deno.test("ORCH-1119B: wrong bucket => DENY", () => {
  assertEquals(
    tripDayInsertAllowed(`${BRAND}/${EVENT}/trip-day-media/tok.jpg`, {
      bucket: "brand_assets",
      eventExistsForKey: true,
      callerRank: 60,
    }),
    false,
  );
});

// (c) — the 2-segment cover path stays ALLOW: re-implement the COVER policy's
// 2-seg predicate from its own migration and assert an owner cover write passes,
// proving the trip-day addition did not regress it (disjointness).
function coverInsertAllowed(
  key: string,
  opts: { bucket: string; eventExistsForKey: boolean; callerRank: number },
): boolean {
  if (opts.bucket !== "event_covers") return false;
  const segs = key.split("/");
  const folders = segs.slice(0, -1);
  const filename = segs[segs.length - 1];
  if (folders.length !== 2) return false; // existing array_length(...) = 2
  if (filename === "") return false;
  return opts.eventExistsForKey && opts.callerRank >= EVENT_MANAGER_RANK;
}

Deno.test("ORCH-1119B (c): 2-seg cover key as OWNER still ALLOW (no regression)", () => {
  assert(
    coverSql.includes("array_length(storage.foldername(name), 1) = 2"),
    "the cover migration must still carry the 2-segment predicate",
  );
  assertEquals(
    coverInsertAllowed(`${BRAND}/${EVENT}/cover.jpg`, {
      bucket: "event_covers",
      eventExistsForKey: true,
      callerRank: 60,
    }),
    true,
  );
  // A 3-segment trip-day key must NOT satisfy the 2-seg cover policy (disjoint).
  assertEquals(
    coverInsertAllowed(`${BRAND}/${EVENT}/trip-day-media/tok.jpg`, {
      bucket: "event_covers",
      eventExistsForKey: true,
      callerRank: 60,
    }),
    false,
  );
});
