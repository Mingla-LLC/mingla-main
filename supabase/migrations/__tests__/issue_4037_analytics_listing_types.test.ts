import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  "supabase/migrations/20280206004037_issue_4037_analytics_listing_types.sql",
);

Deno.test(
  "#4037 listing-type migration changes only brand_traffic_rollup",
  () => {
    assertEquals((sql.match(/CREATE OR REPLACE FUNCTION/gi) ?? []).length, 1);
    assertEquals(
      (
        sql.match(
          /CREATE OR REPLACE FUNCTION public\.brand_traffic_rollup/gi,
        ) ?? []
      ).length,
      1,
    );
    assertFalse(/\b(CREATE|ALTER|DROP)\s+TABLE\b/i.test(sql));
  },
);

Deno.test(
  "#4037 event page rows distinguish RSVP without changing entity identity",
  () => {
    assertStringIncludes(sql, "'listing_type'");
    assertStringIncludes(sql, "WHEN e.event_type = 'rsvp' THEN 'rsvp'");
    assertStringIncludes(sql, "ELSE 'event'");
    assertStringIncludes(sql, "ELSE page_row.value ->> 'entity_type'");
  },
);
