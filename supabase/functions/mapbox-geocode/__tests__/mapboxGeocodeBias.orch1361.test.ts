// ORCH-1361 [location-suggestions] — edge-fn additive URL-building guard
// (implementor-owned happy-path; SPEC §4.1 / §9 P-3). Deno-runnable — the URL
// builders are pure (no network, no env).
//
// Proves the ADDITIVE + backward-compatible contract for the Mapbox Search Box
// proxy's suggest/forward URL builders. The bias is a RANK-ONLY proximity (+
// limit) — there is NO `types`/`country` FILTER, because the shared suggest
// handler also serves BUSINESS venue-name search (POIs must resolve) and a
// `country` filter would over-restrict an "explore anywhere" field
// (INV-3 / ORCH-1079 gate `i-mapbox-suggest-no-types-filter.mjs`):
//   - BYTE-IDENTICAL when no bias is passed (SC-6 no-regression): the emitted
//     URL equals the pre-1361 string exactly — this guards the 7 business
//     pickers + CityPicker callers that pass nothing.
//   - proximity is appended ONLY when present and non-empty, in the doc-verified
//     format (proximity "lng,lat" url-encoded).
//   - NO `&types=` / `&country=` param is EVER appended (filter-free contract).
//   - suggest `limit` defaults to 5 (business unchanged) and honors the
//     consumer's 8; clamped to Mapbox's [1,10] range; forward stays limit=1.
//
// PROTECTIVE COMMENT — consumer location search must be multi-row +
// user-proximity-biased (RANK-only), never server-IP, and the shared suggest
// handler must stay FILTER-FREE (no types/country); see SPEC_ORCH-1361 + the
// ORCH-1079 INV-3 gate.
//
// FAILS-ON-REVERT (verified by true line deletion in the implementation report):
//   - delete the `if (opts.proximity) url += …` append line from
//     buildSuggestUrl / buildForwardUrl → the "appends when present"
//     assertions FAIL;
//   - revert the suggest limit to a hardcoded `&limit=5` → the suggestLimit=8
//     assertion FAILS;
//   - re-introduce proximity unconditionally → the byte-identical no-regression
//     assertions FAIL (dual-direction guard);
//   - re-add a `&types=`/`&country=` filter → the filter-free assertions FAIL
//     (guards INV-3 / ORCH-1079).
//
// Run: deno test --allow-none \
//   supabase/functions/mapbox-geocode/__tests__/mapboxGeocodeBias.orch1361.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildForwardUrl,
  buildSuggestUrl,
  clampSuggestLimit,
} from "../index.ts";

const BASE = "https://api.mapbox.com/search/searchbox/v1";
const TOKEN = "sk-server-secret";
const SESSION = "sess-uuid-0001";

// The EXACT pre-1361 strings — any drift here is a real no-regression break.
const PRE_1361_SUGGEST = `${BASE}/suggest?q=lekki&session_token=${SESSION}&access_token=${TOKEN}&limit=5`;
const PRE_1361_FORWARD = `${BASE}/forward?q=lekki&access_token=${TOKEN}&limit=1`;

Deno.test("suggest: no bias → BYTE-IDENTICAL to the pre-1361 URL (SC-6)", () => {
  const url = buildSuggestUrl(BASE, TOKEN, "lekki", SESSION);
  assertEquals(url, PRE_1361_SUGGEST);
  // Explicitly assert NONE of the bias params leaked in.
  assert(!url.includes("proximity="), "no proximity when unbiased");
  assert(!url.includes("country="), "no country when unbiased");
  assert(!url.includes("&types="), "no types when unbiased");
});

Deno.test("suggest: empty-object opts → still byte-identical (SC-6)", () => {
  assertEquals(buildSuggestUrl(BASE, TOKEN, "lekki", SESSION, {}), PRE_1361_SUGGEST);
});

Deno.test("suggest: proximity appended when present + NO types/country filter (the fix)", () => {
  const url = buildSuggestUrl(BASE, TOKEN, "lekki", SESSION, {
    proximity: "3.4,6.45",
    limit: 8,
  });
  // proximity "lng,lat" url-encoded (comma → %2C) — RANK-only bias.
  assertStringIncludes(url, "&proximity=3.4%2C6.45");
  // consumer opts into 8 rows.
  assertStringIncludes(url, "&limit=8");
  // FILTER-FREE contract (INV-3 / ORCH-1079): no types/country param ever.
  assert(!url.includes("&types="), "suggest must never add a types filter (POIs must resolve)");
  assert(!url.includes("&country="), "suggest must never add a country filter (explore-anywhere)");
});

Deno.test("suggest: limit defaults to 5 and is clamped to [1,10]", () => {
  assertStringIncludes(buildSuggestUrl(BASE, TOKEN, "x", SESSION, {}), "&limit=5");
  assertStringIncludes(buildSuggestUrl(BASE, TOKEN, "x", SESSION, { limit: 8 }), "&limit=8");
  assertStringIncludes(buildSuggestUrl(BASE, TOKEN, "x", SESSION, { limit: 50 }), "&limit=10");
  assertStringIncludes(buildSuggestUrl(BASE, TOKEN, "x", SESSION, { limit: 0 }), "&limit=1");
  assertEquals(clampSuggestLimit(undefined), 5);
  assertEquals(clampSuggestLimit(8), 8);
  assertEquals(clampSuggestLimit(50), 10);
  assertEquals(clampSuggestLimit(0), 1);
});

Deno.test("forward: no bias → BYTE-IDENTICAL to the pre-1361 URL (SC-6)", () => {
  const url = buildForwardUrl(BASE, TOKEN, "lekki");
  assertEquals(url, PRE_1361_FORWARD);
  assert(!url.includes("proximity="), "no proximity when unbiased");
  assert(!url.includes("country="), "no country when unbiased");
});

Deno.test("forward: proximity appended when present; limit stays 1; NO types/country filter", () => {
  const url = buildForwardUrl(BASE, TOKEN, "lekki", {
    proximity: "3.4,6.45",
  });
  assertStringIncludes(url, "&proximity=3.4%2C6.45");
  // forward is single-result — limit is never widened.
  assertStringIncludes(url, "&limit=1");
  // FILTER-FREE contract (INV-3 / ORCH-1079).
  assert(!url.includes("&types="), "forward must never add a types filter");
  assert(!url.includes("&country="), "forward must never add a country filter");
});

Deno.test("bias params are url-encoded (injection-safe)", () => {
  const url = buildSuggestUrl(BASE, TOKEN, "a b", SESSION, {
    proximity: "3.4,6.45",
  });
  // proximity CSV is encoded (comma → %2C).
  assertStringIncludes(url, "&proximity=3.4%2C6.45");
  // query is encoded too (space → %20).
  assertStringIncludes(url, "?q=a%20b");
});
