// ORCH-1014 ADVERSARIAL — edge fn handleIntelligenceCoverage contracts.
//
// Source-inspect the edge fn for invariants the implementor's tests don't lock:
//   1. The 90-day stale constant is exact: 90 * 24 * 60 * 60 * 1000 ms (not a
//      typo'd 9 days, not seconds, not a Date object).
//   2. NULL last_detail_refresh is counted as stale ONLY ONCE (not 0×, not 2×).
//   3. Seed window query scope = ALL place_pool rows for the city (NOT scoped to
//      is_servable=true). This matters because "first seeded" should reflect when
//      the city seed pipeline first ran, not when the first servable place was
//      classified.
//   4. Missing-fields check uses OR (any missing) not AND (all missing).
//   5. The 6 new per-row fields are emitted in the rows[].
//   6. Coverage uses Math.min(100, ...) clamp (ORCH-1013 invariant preserved).
//   7. The .filter((r) => r.servable_count > 0) line still excludes zero-servable
//      cities from the response (existing ORCH-1013 contract preserved).
//
// Fails-on-revert: tampering with any of the above conditions FAILS this test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const EDGE_FN = path.join(
  REPO_ROOT,
  "supabase",
  "functions",
  "run-place-intelligence-trial",
  "index.ts",
);
const SRC = fs.readFileSync(EDGE_FN, "utf8");

describe("ORCH-1014 ADVERSARIAL — edge fn intelligence_coverage extensions", () => {
  it("ORCH_1014_STALE_THRESHOLD_MS = exactly 90 * 24 * 60 * 60 * 1000", () => {
    // Defensive: catch a typo'd 9-day or seconds-based constant.
    assert.ok(
      /ORCH_1014_STALE_THRESHOLD_MS\s*=\s*90\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(
        SRC,
      ),
      "stale threshold must be 90 * 24 * 60 * 60 * 1000 (90 days in ms)",
    );
    // Also confirm it's not redefined later with a different value.
    const matches = SRC.match(/ORCH_1014_STALE_THRESHOLD_MS\s*=/g) || [];
    assert.equal(
      matches.length,
      1,
      "stale threshold must be defined exactly once (no shadow definitions)",
    );
  });

  it("NULL last_detail_refresh is counted as stale (exactly once per row)", () => {
    // Locate the for-loop over servableDetailsRes and confirm the `else` branch
    // increments staleRefreshByCity. If someone removes the else, NULL rows
    // would silently NOT count as stale.
    assert.ok(
      /} else \{\s*\n\s*\/\/[^\n]*\n\s*staleRefreshByCity\.set\(cityId, \(staleRefreshByCity\.get\(cityId\) \|\| 0\) \+ 1\);/.test(
        SRC,
      ),
      "the `else` branch (NULL last_detail_refresh) must increment staleRefreshByCity",
    );
  });

  it("seedWindow fetch scope is ALL place_pool rows (NO is_servable=true filter)", () => {
    // Find the second `.from("place_pool")` block (seedWindowRes), confirm
    // it does NOT include `.eq("is_servable", true)`. The seed window must
    // span servable + Bouncer-rejected rows per SPEC §3 B.1.
    const seedComment = SRC.indexOf("ORCH-1014 NEW — seed window");
    assert.ok(seedComment > 0, "seedWindowRes comment marker must be present");
    // Read the next 400 chars and confirm there's no is_servable filter
    const slice = SRC.slice(seedComment, seedComment + 400);
    assert.ok(
      !/\.eq\("is_servable"/.test(slice),
      "seedWindowRes must NOT filter by is_servable (must include Bouncer rejects)",
    );
    assert.ok(
      /select\("city_id, created_at"\)/.test(slice),
      "seedWindowRes must select city_id + created_at",
    );
  });

  it("missing-fields predicate uses OR (any missing), not AND (all missing)", () => {
    // The predicate is on row.generative_summary == null || ... || reviewsLen === 0.
    // If someone flips to &&, only rows with EVERY field missing would count.
    const m = SRC.match(
      /const missingAny =\s*\n\s*row\.generative_summary == null \|\|\s*\n\s*row\.editorial_summary == null \|\|\s*\n\s*row\.reviews == null \|\|\s*\n\s*reviewsLen === 0;/,
    );
    assert.ok(
      m,
      "missing-fields predicate must use OR across 4 conditions (any missing)",
    );
  });

  it("rows[] emits ALL 6 new ORCH-1014 fields", () => {
    const expectedFields = [
      "first_seeded_at",
      "last_seeded_at",
      "refresh_oldest_at",
      "refresh_newest_at",
      "stale_refresh_count",
      "missing_fields_count",
    ];
    // Find the return object at the end of handleIntelligenceCoverage
    for (const field of expectedFields) {
      assert.ok(
        new RegExp(`${field}:`).test(SRC),
        `edge fn rows[] must emit field ${field}`,
      );
    }
  });

  it("preserves ORCH-1013 coverage clamp Math.min(100, …)", () => {
    assert.ok(
      /Math\.min\(100, \+\(\(evaluated \/ servable\) \* 100\)\.toFixed\(1\)\)/.test(
        SRC,
      ),
      "ORCH-1013 coverage clamp must still wrap the coverage calculation",
    );
  });

  it("preserves ORCH-1013 zero-servable filter (.filter((r) => r.servable_count > 0))", () => {
    assert.ok(
      /\.filter\(\(r\) => r\.servable_count > 0\)/.test(SRC),
      "zero-servable cities must remain filtered out before response",
    );
  });

  it("preserves 6 parallel fetches in Promise.all (servable, completed, runs, details, seed) + cities", () => {
    // Locate the Promise.all destructure — should have 6 names.
    const m = SRC.match(
      /const \[\s*\n\s*citiesRes,\s*\n\s*servableRes,\s*\n\s*completedRes,\s*\n\s*runsRes,\s*\n\s*servableDetailsRes,\s*\n\s*seedWindowRes,\s*\n\s*\] = await Promise\.all\(/,
    );
    assert.ok(
      m,
      "Promise.all must destructure 6 results: cities, servable, completed, runs, servableDetails, seedWindow",
    );
  });
});
