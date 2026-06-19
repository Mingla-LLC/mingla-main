/**
 * ORCH-1164 (#507 regression recovery) — IMPLEMENTOR happy-path regression test.
 *
 * PROVES the anon web TRIP page (/t/{brandSlug}/{tripSlug}) can load for a
 * logged-out buyer, i.e. the trip hook's direct `brands` select lists ONLY
 * columns the `anon` Postgres role can read.
 *
 * #507 (ORCH-1138 Leg 3) added theme_color/theme_font/theme_animation to the
 * DIRECT `supabase.from("brands").select(...)` in usePublicTripBySlug.ts. The
 * `anon` role has only COLUMN-level SELECT on `public.brands` (table-level
 * SELECT is false), and those three theme columns were never granted to anon →
 * Postgres aborts the whole statement with `42501 permission denied for table
 * brands` (HTTP 401) → the entire anon trip page fails to render → all anon web
 * trip sales blocked. (Proven live: has_column_privilege('anon','brands',
 * 'theme_color') = false.)
 *
 * The fix sources brand theme from the anon-safe `business_public_events_view`
 * (COMMS-0009) and selects ONLY anon-granted columns directly off `brands`.
 *
 * FAILS-ON-REVERT: re-adding any of theme_color/theme_font/theme_animation to
 * the trip hook's brands select makes ANON_READABLE_BRAND_COLUMNS no longer a
 * superset of the requested columns → this test FAILS (exactly the #507 break).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TRIP_HOOK = resolve(__dirname, "..", "usePublicTripBySlug.ts");
const src = readFileSync(TRIP_HOOK, "utf8");

// The columns the `anon` Postgres role can SELECT off `public.brands`.
// SOURCE OF TRUTH = the live grant set (baseline column grants + ORCH-0879
// cover grant). theme_color/theme_font/theme_animation are DELIBERATELY ABSENT:
// anon has no column-SELECT on them; reading them directly off brands 401s the
// whole anon query (the #507 regression). After ORCH-1164's migration anon will
// ALSO have the three theme columns, but the trip hook must NOT depend on that —
// it sources theme from business_public_events_view (COMMS-0009). So this guard
// holds the trip hook to the columns that are safe on EVERY deploy, grant or no.
const ANON_READABLE_BRAND_COLUMNS = new Set([
  "id",
  "account_id",
  "name",
  "slug",
  "description",
  "profile_photo_url",
  "contact_email",
  "contact_phone",
  "social_links",
  "custom_links",
  "display_attendee_count",
  "default_currency",
  "cover_media_url",
  "cover_media_type",
  "cover_hue",
  "created_at",
  "updated_at",
  "deleted_at",
]);

// Extract every `.from("brands") ... .select(<literal>)` column list in the hook
// (the chain may span lines; the select string itself may be multi-line).
// Note: the select-string capture allows an OPTIONAL trailing comma + whitespace
// before the closing paren (the trip hook formats the column list with a
// trailing comma), so the lazy match terminates at the real string boundary.
const brandSelectColumnLists = Array.from(
  src.matchAll(
    /\.from\(\s*["']brands["']\s*\)[\s\S]*?\.select\(\s*([`"'])([\s\S]*?)\1\s*,?\s*\)/g,
  ),
).map((m) =>
  m[2]
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0),
);

describe("ORCH-1164 — anon can load the public trip page", () => {
  test("the trip hook DOES read brands directly (sanity — guard targets the right call)", () => {
    expect(brandSelectColumnLists.length).toBeGreaterThan(0);
  });

  test("every column the trip hook selects off brands is anon-readable (no 42501 for logged-out buyers)", () => {
    const notAnonReadable = brandSelectColumnLists
      .flat()
      .filter((col) => !ANON_READABLE_BRAND_COLUMNS.has(col));
    expect(notAnonReadable).toEqual([]);
  });

  test("brand theme is sourced from the anon-safe business_public_events_view, not brands (COMMS-0009)", () => {
    // The hook must resolve brand theme via the view helper, filtered to the
    // trip row by event_type='trip'.
    expect(src).toContain("business_public_events_view");
    expect(src).toContain('"event_type", "trip"');
    expect(src).toMatch(/fetchBrandThemeFromView\s*\(/);
  });
});
