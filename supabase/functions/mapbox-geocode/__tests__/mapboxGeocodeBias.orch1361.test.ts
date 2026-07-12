// ORCH-1361 [location-suggestions] — edge-fn additive URL-building guard
// (implementor-owned happy-path; SPEC §4.1 / §9 P-3). Deno-runnable — the URL
// builders are pure (no network, no env).
//
// Proves the ADDITIVE + backward-compatible contract for the Mapbox Search Box
// proxy's suggest/forward URL builders:
//   - BYTE-IDENTICAL when no bias is passed (SC-6 no-regression): the emitted
//     URL equals the pre-1361 string exactly — this guards the 7 business
//     pickers + CityPicker callers that pass nothing.
//   - proximity/country/types are appended ONLY when present and non-empty, in
//     the doc-verified formats (proximity "lng,lat" url-encoded, country ISO
//     alpha-2 CSV, types CSV).
//   - suggest `limit` defaults to 5 (business unchanged) and honors the
//     consumer's 8; clamped to Mapbox's [1,10] range; forward stays limit=1.
//
// PROTECTIVE COMMENT — consumer location search must be multi-row +
// user-proximity-biased, never server-IP; see SPEC_ORCH-1361.
//
// FAILS-ON-REVERT (verified by true line deletion in the implementation report):
//   - delete the `if (opts.proximity) url += …` / country / types append lines
//     from buildSuggestUrl / buildForwardUrl → the "appends when present"
//     assertions FAIL;
//   - revert the suggest limit to a hardcoded `&limit=5` → the suggestLimit=8
//     assertion FAILS;
//   - re-introduce any bias param unconditionally → the byte-identical
//     no-regression assertions FAIL (dual-direction guard).
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

Deno.test("suggest: proximity + country + types appended when present (the fix)", () => {
  const url = buildSuggestUrl(BASE, TOKEN, "lekki", SESSION, {
    proximity: "3.4,6.45",
    country: "ng",
    types: "place,locality,neighborhood,address,region,district",
    limit: 8,
  });
  // proximity "lng,lat" url-encoded (comma → %2C).
  assertStringIncludes(url, "&proximity=3.4%2C6.45");
  assertStringIncludes(url, "&country=ng");
  assertStringIncludes(url, "&types=place%2Clocality%2Cneighborhood%2Caddress%2Cregion%2Cdistrict");
  // consumer opts into 8 rows.
  assertStringIncludes(url, "&limit=8");
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

Deno.test("forward: proximity/country/types appended when present; limit stays 1", () => {
  const url = buildForwardUrl(BASE, TOKEN, "lekki", {
    proximity: "3.4,6.45",
    country: "ng",
    types: "place",
  });
  assertStringIncludes(url, "&proximity=3.4%2C6.45");
  assertStringIncludes(url, "&country=ng");
  assertStringIncludes(url, "&types=place");
  // forward is single-result — limit is never widened.
  assertStringIncludes(url, "&limit=1");
});

Deno.test("bias params are url-encoded (injection-safe)", () => {
  const url = buildSuggestUrl(BASE, TOKEN, "a b", SESSION, {
    proximity: "3.4,6.45",
    country: "ng,gh",
  });
  assertStringIncludes(url, "&country=ng%2Cgh");
  // query is encoded too (space → %20).
  assertStringIncludes(url, "?q=a%20b");
});
