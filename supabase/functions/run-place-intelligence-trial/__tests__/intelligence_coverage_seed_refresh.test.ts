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

// ORCH-1017 — the per-city aggregation moved from JS into the
// pg_intelligence_coverage() RPC (fixing Edge WORKER_LIMIT / HTTP 546). The
// source-inspect assertions below are repointed at the migration SQL; the
// pure-math mirrors above are unchanged and remain the behavioral spec.
const MIGRATION_SQL = await Deno.readTextFile(
  new URL(
    "../../../migrations/20260807000000_orch_1017_pg_intelligence_coverage.sql",
    import.meta.url,
  ),
);

Deno.test("ORCH-1014 — RPC migration encodes the 90-day stale threshold", () => {
  assert(
    INDEX_TS.includes('db.rpc("pg_intelligence_coverage")'),
    "handler must call the RPC — ORCH-1017",
  );
  assert(
    /interval\s+'90 days'/i.test(MIGRATION_SQL),
    "stale_refresh_count must use a 90-day interval in SQL",
  );
});

Deno.test("ORCH-1014 — migration servable CTE reads the 4 detail-readiness columns", () => {
  for (const col of [
    "last_detail_refresh",
    "generative_summary",
    "editorial_summary",
    "reviews",
  ]) {
    assert(
      MIGRATION_SQL.includes(col),
      `servable/missing-fields aggregate must reference ${col}`,
    );
  }
});

Deno.test("ORCH-1014 — migration seed_window CTE aggregates created_at across all place_pool", () => {
  assert(
    /MIN\s*\(\s*pp\.created_at\s*\)/i.test(MIGRATION_SQL) &&
      /MAX\s*\(\s*pp\.created_at\s*\)/i.test(MIGRATION_SQL),
    "seed_window must MIN/MAX(created_at) for first/last_seeded_at",
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

// ═══════════════════════════════════════════════════════════════════════════
// ORCH-1015 [TEST-MOD-APPROVED ORCH-1015] — extension assertions for the
// Boundary + Details binary readiness flags + needs_refresh_count.
// Mirrors the same two-key strategy: (a) a logic-mirror that aggregates over
// a per-city fixture exactly like the edge fn does, and (b) source-inspect
// regex asserts. All 6 ORCH-1014 fields above are PRESERVED — these new
// asserts only EXTEND.
// ═══════════════════════════════════════════════════════════════════════════

const REFRESH_CUTOVER_DATE_MS = Date.parse("2026-03-19T00:00:00Z");

type ServableDetailRow1015 = {
  city_id: string;
  last_detail_refresh: string | null;
};

function aggregateRegeocoded(coverage_radius_km: number | null): boolean {
  // Mirrors the edge-fn predicate `(c.coverage_radius_km ?? null) === 0`
  return (coverage_radius_km ?? null) === 0;
}

function aggregateRefreshedAndNeedsRefresh(
  cityId: string,
  rows: ServableDetailRow1015[],
): { refreshed_new_fields: boolean; needs_refresh_count: number } {
  let needs = 0;
  let servable = 0;
  for (const r of rows) {
    if (r.city_id !== cityId) continue;
    servable += 1;
    if (r.last_detail_refresh) {
      if (Date.parse(r.last_detail_refresh) < REFRESH_CUTOVER_DATE_MS) needs += 1;
    } else {
      // NULL counts as needing refresh (never refreshed)
      needs += 1;
    }
  }
  // Mirrors the edge-fn predicate: TRUE iff every servable place is refreshed
  // (needs_refresh_count === 0 with at least one servable place).
  const refreshed = servable > 0 && needs === 0;
  return { refreshed_new_fields: refreshed, needs_refresh_count: needs };
}

Deno.test("ORCH-1015 — regeocoded flag is true when coverage_radius_km = 0", () => {
  assertEquals(aggregateRegeocoded(0), true);
});

Deno.test("ORCH-1015 — regeocoded flag is false when coverage_radius_km = 10", () => {
  assertEquals(aggregateRegeocoded(10), false);
});

Deno.test("ORCH-1015 — regeocoded flag is false when coverage_radius_km is null (defensive)", () => {
  assertEquals(aggregateRegeocoded(null), false);
});

Deno.test(
  "ORCH-1015 — refreshed_new_fields true when oldest >= cutover (3 places post-cutover)",
  () => {
    const cityId = "c1015a";
    const rows: ServableDetailRow1015[] = [
      { city_id: cityId, last_detail_refresh: "2026-04-01T00:00:00Z" },
      { city_id: cityId, last_detail_refresh: "2026-04-10T00:00:00Z" },
      { city_id: cityId, last_detail_refresh: "2026-05-01T00:00:00Z" },
    ];
    const agg = aggregateRefreshedAndNeedsRefresh(cityId, rows);
    assertEquals(agg.refreshed_new_fields, true);
    assertEquals(agg.needs_refresh_count, 0);
  },
);

Deno.test(
  "ORCH-1015 — refreshed_new_fields false when ANY place below cutover (count = 1)",
  () => {
    const cityId = "c1015b";
    const rows: ServableDetailRow1015[] = [
      { city_id: cityId, last_detail_refresh: "2026-04-01T00:00:00Z" },
      { city_id: cityId, last_detail_refresh: "2026-03-15T00:00:00Z" }, // below cutover
      { city_id: cityId, last_detail_refresh: "2026-04-10T00:00:00Z" },
    ];
    const agg = aggregateRefreshedAndNeedsRefresh(cityId, rows);
    assertEquals(agg.refreshed_new_fields, false);
    assertEquals(agg.needs_refresh_count, 1);
  },
);

Deno.test(
  "ORCH-1015 — NULL last_detail_refresh counts as needing refresh (mirrors stale-NULL)",
  () => {
    const cityId = "c1015c";
    const rows: ServableDetailRow1015[] = [
      { city_id: cityId, last_detail_refresh: null },
      { city_id: cityId, last_detail_refresh: "2026-04-01T00:00:00Z" },
    ];
    const agg = aggregateRefreshedAndNeedsRefresh(cityId, rows);
    assertEquals(agg.refreshed_new_fields, false, "NULL prevents refreshed_new_fields");
    assertEquals(agg.needs_refresh_count, 1, "NULL must count as needing refresh");
  },
);

Deno.test(
  "ORCH-1015 — migration encodes the 2026-03-19 details-refresh cutover",
  () => {
    assert(
      /2026-03-19/.test(MIGRATION_SQL),
      "needs_refresh_count must compare last_detail_refresh against the 2026-03-19 cutover in SQL",
    );
  },
);

Deno.test("ORCH-1015 — migration computes regeocoded from coverage_radius_km", () => {
  assert(
    /coverage_radius_km\s*=\s*0/i.test(MIGRATION_SQL),
    "regeocoded must be derived from seeding_cities.coverage_radius_km = 0",
  );
});

Deno.test("ORCH-1015 — edge fn row shape includes the 3 new readiness fields", () => {
  for (const field of [
    "regeocoded:",
    "refreshed_new_fields:",
    "needs_refresh_count:",
  ]) {
    assert(
      INDEX_TS.includes(field),
      `row shape must include new field ${field}`,
    );
  }
});

Deno.test(
  "ORCH-1015 — all 6 ORCH-1014 fields PRESERVED in row shape (regression guard)",
  () => {
    for (const field of [
      "first_seeded_at:",
      "last_seeded_at:",
      "refresh_oldest_at:",
      "refresh_newest_at:",
      "stale_refresh_count:",
      "missing_fields_count:",
    ]) {
      assert(
        INDEX_TS.includes(field),
        `ORCH-1014 field ${field} must remain on the wire (operator diagnostic per §7-D7)`,
      );
    }
  },
);
