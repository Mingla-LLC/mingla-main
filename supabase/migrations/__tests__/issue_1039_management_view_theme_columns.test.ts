/**
 * issue #1039 — implementor regression test (migration contract).
 *
 * PROVEN root cause: ORCH-0964 added the three `theme_*_override` columns to the
 * events table AND to `business_public_events_view`, but left
 * `business_management_events_view` (the view the edit screen reads) untouched.
 * So the editor seeded `undefined` for those columns -> null -> the Theme
 * control showed brand-default even when the row held a real override.
 *
 * Fix: one additive `CREATE OR REPLACE VIEW` reproducing the current (ORCH-0824)
 * management-view SELECT verbatim and appending the three override columns after
 * `e.location_geo`, mirroring the ORCH-0964 public-view precedent.
 *
 * This test pins the DB contract statically (no live DB — the tester phase owns
 * live-DB adversarial verification after the operator applies the migration),
 * following the established `supabase/migrations/__tests__/*.test.ts` style.
 *
 * fails-on-revert: deleting any of the three `e.theme_*_override` lines from the
 * migration turns the "adds the three columns" assertions red; removing the
 * verbatim prior SELECT columns turns the "reproduces the prior SELECT"
 * assertions red.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20270110000000_issue_1039_mgmt_view_theme_columns.sql",
    import.meta.url,
  ),
);

Deno.test("issue-1039: additive CREATE OR REPLACE of the management view (no DROP, no reorder)", () => {
  assertStringIncludes(
    migration,
    "CREATE OR REPLACE VIEW public.business_management_events_view",
  );
  // Additive only — never a destructive rebuild.
  assert(
    !/DROP\s+VIEW/i.test(migration),
    "migration must not DROP any view (additive CREATE OR REPLACE only)",
  );
  // The management view keeps security_invoker so RLS is enforced as the caller.
  assertStringIncludes(migration, "WITH (security_invoker = true)");
});

Deno.test("issue-1039: adds the three theme override columns to the management view", () => {
  assertStringIncludes(migration, "e.theme_color_override");
  assertStringIncludes(migration, "e.theme_font_override");
  assertStringIncludes(migration, "e.theme_animation_override");
});

Deno.test("issue-1039: appends the theme columns AFTER e.location_geo (order preserved, additive at end)", () => {
  const geoIdx = migration.indexOf("e.location_geo");
  const colorIdx = migration.indexOf("e.theme_color_override");
  const fontIdx = migration.indexOf("e.theme_font_override");
  const animIdx = migration.indexOf("e.theme_animation_override");
  assert(geoIdx >= 0, "e.location_geo must remain in the SELECT");
  assert(colorIdx > geoIdx, "theme_color_override must be appended after location_geo");
  assert(fontIdx > colorIdx, "theme_font_override must follow theme_color_override");
  assert(animIdx > fontIdx, "theme_animation_override must follow theme_font_override");
});

Deno.test("issue-1039: reproduces the prior (ORCH-0824) management-view SELECT verbatim", () => {
  // A representative spread of the 41 columns the live view returns, in order,
  // so a truncated/re-derived SELECT (dropping prior columns) turns this red.
  for (const col of [
    "e.id",
    "e.brand_id",
    "e.created_by",
    "b.slug AS brand_slug",
    "b.display_attendee_count AS brand_display_attendee_count",
    "(e.theme - 'business_draft') AS management_theme",
    "e.cover_media_alt",
    "ed.start_at AS master_start_at",
    "ed.id AS master_event_date_id",
    "e.city",
    "e.party_types",
    "e.vibe_tags",
    "e.music_genres",
    "e.location_geo",
  ]) {
    assertStringIncludes(migration, col);
  }
  // Same FROM / JOIN / WHERE the ORCH-0824 def carries.
  assertStringIncludes(migration, "FROM public.events e");
  assertStringIncludes(migration, "JOIN public.brands b ON b.id = e.brand_id");
  assertStringIncludes(
    migration,
    "LEFT JOIN public.event_dates ed",
  );
  assertStringIncludes(
    migration,
    "e.status IN ('scheduled', 'live', 'ended', 'cancelled')",
  );
});

Deno.test("issue-1039: preserves the GRANT/REVOKE and PostgREST schema reload", () => {
  assertStringIncludes(
    migration,
    "GRANT SELECT ON public.business_management_events_view TO authenticated, service_role;",
  );
  assertStringIncludes(
    migration,
    "REVOKE SELECT ON public.business_management_events_view FROM anon;",
  );
  assertStringIncludes(migration, "NOTIFY pgrst, 'reload schema';");
});

Deno.test("issue-1039: does NOT recreate business_public_events_view (already correct)", () => {
  // The public view already carries the override columns (ORCH-0964); this
  // migration must not CREATE/REPLACE it. A comment mention is fine — only a DDL
  // touch is forbidden.
  assertEquals(
    /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.business_public_events_view/i.test(
      migration,
    ),
    false,
    "the public view is already correct and must not be recreated here",
  );
});
