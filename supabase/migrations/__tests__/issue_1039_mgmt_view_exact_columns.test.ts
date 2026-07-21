/**
 * issue #1039 — TESTER adversarial regression test (migration contract).
 *
 * DIFFERENT ANGLE from the implementor's `issue_1039_management_view_theme_columns.test.ts`:
 * that suite only asserts a 14-column REPRESENTATIVE subset is present (via
 * substring `assertStringIncludes`) plus the 3 new columns. A non-additive edit
 * that DROPPED, REORDERED, or RENAMED one of the OTHER 27 pre-existing output
 * columns — while leaving the 14 representatives intact — would pass the
 * implementor's test but (a) break `CREATE OR REPLACE VIEW` at apply time
 * (Postgres forbids changing the name/type/order of existing view output
 * columns) and/or (b) silently shift positional consumers.
 *
 * This test parses the migration's SELECT list, derives the ORDERED list of
 * OUTPUT column names, and asserts it EXACTLY equals the full 41-column live
 * `business_management_events_view` contract + the 3 appended theme override
 * columns — nothing dropped, nothing reordered, nothing renamed, in exact order.
 *
 * The 41-column expected contract was re-derived INDEPENDENTLY by the tester,
 * read-only, from prod (gqnoajqerqhnvulmnyvv, 2026-07-21):
 *   SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
 *   FROM information_schema.columns
 *   WHERE table_schema='public' AND table_name='business_management_events_view';
 *
 * fails-on-revert: deleting the 3 `e.theme_*_override` lines drops the last 3
 * expected names -> the exact-sequence assertion fails. A non-additive middle
 * edit fails the same assertion.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20270110000000_issue_1039_mgmt_view_theme_columns.sql",
    import.meta.url,
  ),
);

// The exact ORDERED output-column contract of the live management view (41),
// re-derived read-only from prod, PLUS the three issue-1039 appended columns.
const EXPECTED_COLUMNS = [
  "id",
  "brand_id",
  "created_by",
  "brand_slug",
  "brand_name",
  "brand_profile_photo_url",
  "brand_display_attendee_count",
  "title",
  "description",
  "slug",
  "location_text",
  "online_url",
  "is_online",
  "is_recurring",
  "is_multi_date",
  "recurrence_rules",
  "cover_media_url",
  "cover_media_type",
  "visibility",
  "show_on_discover",
  "status",
  "published_at",
  "timezone",
  "created_at",
  "updated_at",
  "management_theme",
  "currency",
  "cover_media_provider",
  "cover_media_source_url",
  "cover_media_credit",
  "cover_media_credit_url",
  "cover_media_alt",
  "master_start_at",
  "master_end_at",
  "master_timezone",
  "master_event_date_id",
  "city",
  "party_types",
  "vibe_tags",
  "music_genres",
  "location_geo",
  // issue #1039 appended:
  "theme_color_override",
  "theme_font_override",
  "theme_animation_override",
];

/**
 * Extract the ordered OUTPUT column names from the migration's
 * `SELECT ... FROM public.events e` block.
 */
function parseSelectOutputColumns(sql: string): string[] {
  // Isolate the CREATE OR REPLACE VIEW ... AS SELECT <list> FROM ... block.
  const selMatch = sql.match(
    /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.business_management_events_view[\s\S]*?\bAS\b\s*SELECT([\s\S]*?)\bFROM\s+public\.events\s+e/i,
  );
  assert(selMatch, "could not locate the management-view SELECT ... FROM block");
  const body = selMatch[1];

  return body
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim()) // strip line comments
    .filter((line) => line.length > 0)
    .join(" ")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      // `<expr> AS <alias>` -> alias; else the bare column after the last dot.
      const asMatch = item.match(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
      if (asMatch) return asMatch[1];
      const dotted = item.split(".");
      return dotted[dotted.length - 1].trim();
    });
}

Deno.test("issue-1039 (tester): view exposes the EXACT 41 live columns in order + 3 appended", () => {
  const actual = parseSelectOutputColumns(migration);
  assertEquals(
    actual,
    EXPECTED_COLUMNS,
    "management-view output columns must reproduce the full live 41-column contract in exact order, then append the 3 theme override columns — nothing dropped, reordered, or renamed",
  );
});

Deno.test("issue-1039 (tester): the 3 theme override columns are the LAST three (appended, not interleaved)", () => {
  const actual = parseSelectOutputColumns(migration);
  const lastThree = actual.slice(-3);
  assertEquals(lastThree, [
    "theme_color_override",
    "theme_font_override",
    "theme_animation_override",
  ]);
  // location_geo (the prior last column) must sit immediately before them.
  assertEquals(actual[actual.length - 4], "location_geo");
});

Deno.test("issue-1039 (tester): no pre-existing column was dropped (count is exactly 41 + 3)", () => {
  const actual = parseSelectOutputColumns(migration);
  assertEquals(
    actual.length,
    44,
    "expected 41 pre-existing + 3 appended = 44 output columns",
  );
});
