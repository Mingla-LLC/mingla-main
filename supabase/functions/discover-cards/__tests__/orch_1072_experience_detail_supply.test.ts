import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1072 [experience-detail-cover-availability] — supply regression.
//
// The deck supply must now carry the experience's REAL cover (image/video) +
// REAL description + UPCOMING OCCURRENCES (event_dates + remaining capacity)
// through the migration RPC AND both edge envelopes (discover-cards +
// generate-curated-experiences), so the consumer detail sheet renders the cover
// + description + a date picker instead of the fabricated first-stop image +
// tagline. Source-text + migration-SQL analysis (the fns call serve() at module
// load + reach a service-role client, so they can't be unit-invoked) — the same
// established pattern as orch_1065_experience_supply.test.ts.
//
// Fails-on-revert (LOCKED):
//   T-01 fails if the migration drops cover_media_url/cover_media_type/
//        description/upcoming_occurrences from the RETURNS TABLE.
//   T-02 fails if the occurrence jsonb shape (event_date_id/remaining) is removed.
//   T-03/T-04 fail if either edge envelope stops carrying the new fields.
//   T-05 fails if the migration body is missing its terminal `;` before GRANT.

const root = new URL("../../../..", import.meta.url).pathname;
const migration = await Deno.readTextFile(
  `${root}/supabase/migrations/20260908000000_orch_1072_experience_detail_cover_availability.sql`,
);
const discover = await Deno.readTextFile(
  `${root}/supabase/functions/discover-cards/index.ts`,
);
const curated = await Deno.readTextFile(
  `${root}/supabase/functions/generate-curated-experiences/index.ts`,
);

Deno.test("ORCH-1072 T-01: migration RETURNS TABLE adds cover + description + occurrences (fails-on-revert)", () => {
  // The RETURNS TABLE must expose the new additive columns.
  assertStringIncludes(migration, "cover_media_url text");
  assertStringIncludes(migration, "cover_media_type text");
  assertStringIncludes(migration, "description text");
  assertStringIncludes(migration, "upcoming_occurrences jsonb");
  // And SELECT them from the events row / aggregate.
  assertStringIncludes(migration, "e.cover_media_url");
  assertStringIncludes(migration, "COALESCE(e.description, '')");
});

Deno.test("ORCH-1072 T-02: occurrence jsonb carries the bookable shape with remaining (fails-on-revert)", () => {
  assertStringIncludes(migration, "'event_date_id', occ.id");
  assertStringIncludes(migration, "'start_at',      occ.start_at");
  assertStringIncludes(migration, "'remaining',     occ.ticket_remaining");
  // Remaining must derive from quantity_total − sold (ORCH-0946 formula), and
  // sold must count the SAME ticket statuses (valid/used/transferred).
  assertStringIncludes(migration, "tt.quantity_total - COALESCE(");
  assertStringIncludes(
    migration,
    "tk.status IN ('valid', 'used', 'transferred')",
  );
  // Bounded payload for never-ends/recurring experiences.
  assertStringIncludes(migration, "occ.rn <= 12");
});

Deno.test("ORCH-1072 T-03: discover-cards envelope carries cover/description/occurrences (fails-on-revert)", () => {
  assertStringIncludes(discover, "coverMediaUrl");
  assertStringIncludes(discover, "coverMediaType");
  assertStringIncludes(discover, "upcomingOccurrences");
  // The mapper reads the RPC's snake_case columns.
  assertStringIncludes(discover, "row.cover_media_url");
  assertStringIncludes(discover, "row.upcoming_occurrences");
  assertStringIncludes(discover, "mapExperienceOccurrences");
});

Deno.test("ORCH-1072 T-04: curated envelope carries the SAME new fields (no parallel system)", () => {
  assertStringIncludes(curated, "coverMediaUrl");
  assertStringIncludes(curated, "upcomingOccurrences");
  assertStringIncludes(curated, "row.cover_media_url");
  assertStringIncludes(curated, "mapExperienceOccurrences");
});

Deno.test("ORCH-1072 T-05: migration body ends with `;` before GRANT (CI baseline guard)", () => {
  // A prior ORCH broke CI by omitting the function-body terminator. Assert the
  // GRANT is preceded by `$function$;` (the closing + terminator).
  assert(
    /\$function\$;\s*GRANT EXECUTE ON FUNCTION public\.pg_eligible_experiences_for_deck/
      .test(migration),
    "migration must terminate the function body with `;` before the GRANT",
  );
});

Deno.test("ORCH-1072 T-06: occurrence mapper drops malformed rows (no unbookable occurrence)", () => {
  // The mapper must require event_date_id + start_at and filter nulls.
  assertStringIncludes(discover, "eventDateId.length === 0 || startAt.length === 0");
  // remaining stays null when unlimited (never fabricated to a number).
  assertEquals(
    discover.includes("typeof o?.remaining === 'number' ? o.remaining : null"),
    true,
  );
});
