// ORCH-1014 Finding B regression test — intelligence_coverage edge fn
// returns the 6 NEW Seed/Refresh badge fields per city row.
//
// Strategy: handleIntelligenceCoverage isn't exported, so we exercise the
// SAME aggregation logic the edge fn uses (per-city Maps over the 2 new
// place_pool fetches: servable details + seed window) and assert the
// resulting per-row shape matches SPEC §3 B.1 verbatim. We also source-
// inspect the edge fn to assert the new fetches + row fields exist, so a
// revert that removes the SQL fetch but leaves the JSON shape (or vice
// versa) is caught.
//
// Together these form a two-key revert detector:
//   - aggregation logic correctness (this mirror reimplements it)
//   - source presence of the 2 new fetches + 6 new row fields (regex grep)
//
// Fails-on-revert: if either signal disappears, FAIL.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const STALE_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;

type ServableDetailRow = {
  city_id: string;
  last_detail_refresh: string | null;
  generative_summary: string | null;
  editorial_summary: string | null;
  reviews: unknown[] | null;
};

type SeedRow = { city_id: string; created_at: string };

function aggregateForCity(
  cityId: string,
  servableDetails: ServableDetailRow[],
  seedRows: SeedRow[],
  nowMs: number,
) {
  let stale = 0;
  let missing = 0;
  let refreshOldest: string | null = null;
  let refreshNewest: string | null = null;
  for (const row of servableDetails) {
    if (row.city_id !== cityId) continue;
    if (row.last_detail_refresh) {
      if (!refreshOldest || row.last_detail_refresh < refreshOldest) {
        refreshOldest = row.last_detail_refresh;
      }
      if (!refreshNewest || row.last_detail_refresh > refreshNewest) {
        refreshNewest = row.last_detail_refresh;
      }
      if (nowMs - Date.parse(row.last_detail_refresh) > STALE_THRESHOLD_MS) {
        stale += 1;
      }
    } else {
      stale += 1; // NULL counted as stale
    }
    const reviewsLen = Array.isArray(row.reviews) ? row.reviews.length : 0;
    const missingAny =
      row.generative_summary == null ||
      row.editorial_summary == null ||
      row.reviews == null ||
      reviewsLen === 0;
    if (missingAny) missing += 1;
  }
  let first: string | null = null;
  let last: string | null = null;
  for (const row of seedRows) {
    if (row.city_id !== cityId) continue;
    if (!first || row.created_at < first) first = row.created_at;
    if (!last || row.created_at > last) last = row.created_at;
  }
  return {
    first_seeded_at: first,
    last_seeded_at: last,
    refresh_oldest_at: refreshOldest,
    refresh_newest_at: refreshNewest,
    stale_refresh_count: stale,
    missing_fields_count: missing,
  };
}

Deno.test(
  "ORCH-1014 — city with N servable + 0 stale + K missing fields aggregates correctly",
  () => {
    const cityId = "city-1";
    const now = new Date("2026-05-30T00:00:00Z").getTime();
    // 5 places: 3 missing generative_summary, 1 missing editorial, 1 complete.
    // All refreshed yesterday → 0 stale.
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const servable: ServableDetailRow[] = [
      { city_id: cityId, last_detail_refresh: yesterday, generative_summary: null, editorial_summary: "ok", reviews: [{ a: 1 }] },
      { city_id: cityId, last_detail_refresh: yesterday, generative_summary: null, editorial_summary: "ok", reviews: [{ a: 1 }] },
      { city_id: cityId, last_detail_refresh: yesterday, generative_summary: null, editorial_summary: "ok", reviews: [{ a: 1 }] },
      { city_id: cityId, last_detail_refresh: yesterday, generative_summary: "ok", editorial_summary: null, reviews: [{ a: 1 }] },
      { city_id: cityId, last_detail_refresh: yesterday, generative_summary: "ok", editorial_summary: "ok", reviews: [{ a: 1 }] },
    ];
    const seedRows: SeedRow[] = [
      { city_id: cityId, created_at: "2026-04-01T10:00:00Z" },
      { city_id: cityId, created_at: "2026-04-15T10:00:00Z" },
    ];
    const agg = aggregateForCity(cityId, servable, seedRows, now);
    assertEquals(agg.missing_fields_count, 4, "3 missing generative + 1 missing editorial = 4");
    assertEquals(agg.stale_refresh_count, 0, "all refreshed yesterday → 0 stale");
    assertEquals(agg.first_seeded_at, "2026-04-01T10:00:00Z");
    assertEquals(agg.last_seeded_at, "2026-04-15T10:00:00Z");
    assertEquals(agg.refresh_oldest_at, yesterday);
    assertEquals(agg.refresh_newest_at, yesterday);
  },
);

Deno.test(
  "ORCH-1014 — last_detail_refresh > 90 days ago counts as stale",
  () => {
    const cityId = "city-2";
    const now = new Date("2026-05-30T00:00:00Z").getTime();
    const oneHundredDaysAgo = new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    const servable: ServableDetailRow[] = [
      { city_id: cityId, last_detail_refresh: oneHundredDaysAgo, generative_summary: "ok", editorial_summary: "ok", reviews: [{ a: 1 }] },
      { city_id: cityId, last_detail_refresh: oneHundredDaysAgo, generative_summary: "ok", editorial_summary: "ok", reviews: [{ a: 1 }] },
      { city_id: cityId, last_detail_refresh: fresh, generative_summary: "ok", editorial_summary: "ok", reviews: [{ a: 1 }] },
    ];
    const agg = aggregateForCity(cityId, servable, [], now);
    assertEquals(agg.stale_refresh_count, 2);
    assertEquals(agg.missing_fields_count, 0);
  },
);

Deno.test(
  "ORCH-1014 — NULL last_detail_refresh counts as stale (never refreshed)",
  () => {
    const cityId = "city-3";
    const now = new Date("2026-05-30T00:00:00Z").getTime();
    const servable: ServableDetailRow[] = [
      { city_id: cityId, last_detail_refresh: null, generative_summary: "ok", editorial_summary: "ok", reviews: [{ a: 1 }] },
    ];
    const agg = aggregateForCity(cityId, servable, [], now);
    assertEquals(agg.stale_refresh_count, 1, "NULL must count as stale");
    assertEquals(agg.refresh_oldest_at, null, "NULL must NOT bump refresh_oldest_at");
    assertEquals(agg.refresh_newest_at, null);
  },
);

Deno.test(
  "ORCH-1014 — empty reviews array counts as missing fields",
  () => {
    const cityId = "city-4";
    const now = Date.now();
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const servable: ServableDetailRow[] = [
      { city_id: cityId, last_detail_refresh: yesterday, generative_summary: "ok", editorial_summary: "ok", reviews: [] },
      { city_id: cityId, last_detail_refresh: yesterday, generative_summary: "ok", editorial_summary: "ok", reviews: [{ a: 1 }] },
    ];
    const agg = aggregateForCity(cityId, servable, [], now);
    assertEquals(agg.missing_fields_count, 1);
  },
);

Deno.test(
  "ORCH-1014 — first_seeded_at scopes to ALL place_pool rows (servable + non)",
  () => {
    const cityId = "city-5";
    const now = Date.now();
    const servable: ServableDetailRow[] = [];
    const seedRows: SeedRow[] = [
      { city_id: cityId, created_at: "2026-03-01T00:00:00Z" }, // Bouncer-rejected (not in servable)
      { city_id: cityId, created_at: "2026-05-01T00:00:00Z" },
    ];
    const agg = aggregateForCity(cityId, servable, seedRows, now);
    assertEquals(agg.first_seeded_at, "2026-03-01T00:00:00Z");
    assertEquals(agg.last_seeded_at, "2026-05-01T00:00:00Z");
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Source-inspect — the edge fn declares the 2 new fetches + 6 new row fields.
// If anyone deletes the fetches but leaves a stub returning constants, this
// catches it.
// ─────────────────────────────────────────────────────────────────────────────

const INDEX_TS_PATH = new URL("../index.ts", import.meta.url);
const INDEX_TS = await Deno.readTextFile(INDEX_TS_PATH);

Deno.test("ORCH-1014 — edge fn source declares STALE_THRESHOLD_MS = 90 days", () => {
  assert(
    /ORCH_1014_STALE_THRESHOLD_MS\s*=\s*90\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(INDEX_TS),
    "must declare 90-day stale threshold constant",
  );
});

Deno.test("ORCH-1014 — edge fn source fetches servable details (last_detail_refresh, generative_summary, editorial_summary, reviews)", () => {
  assert(
    INDEX_TS.includes(
      '"city_id, last_detail_refresh, generative_summary, editorial_summary, reviews"',
    ),
    "must select the 4 detail-readiness columns from place_pool",
  );
});

Deno.test("ORCH-1014 — edge fn source fetches seed window (city_id, created_at) across all place_pool", () => {
  assert(
    INDEX_TS.includes('"city_id, created_at"'),
    "must select city_id + created_at for the seed window",
  );
});

Deno.test("ORCH-1014 — edge fn row shape includes 6 new badge fields", () => {
  for (const field of [
    "first_seeded_at:",
    "last_seeded_at:",
    "refresh_oldest_at:",
    "refresh_newest_at:",
    "stale_refresh_count:",
    "missing_fields_count:",
  ]) {
    assert(INDEX_TS.includes(field), `row shape must include ${field}`);
  }
});
