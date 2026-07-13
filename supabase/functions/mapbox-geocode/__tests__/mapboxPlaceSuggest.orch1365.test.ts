// ORCH-1365 [location-search-relevance] — consumer place-builder + BUSINESS
// byte-identical guard (implementor-owned; SPEC §7 T-1/T-2/T-5, §9). The URL
// builders are pure; the isolation checks read index.ts (--allow-read).
//
// PROTECTIVE COMMENT — the CONSUMER place search (`buildPlaceSuggestUrl`) applies
// `types=place,locality,neighborhood,region,district` + a derived `country` ISO
// bias to drop POI noise and surface the real place (evidence probe B/G/N). This
// is a SEPARATE code path from the BUSINESS venue-name search
// (`buildSuggestUrl`/`handleSuggest`), which MUST stay byte-identical + filter-
// free so a brand can search a venue BY NAME (POIs must resolve — INV-3 /
// ORCH-1079 gate `i-mapbox-suggest-no-types-filter.mjs`).
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - T-5: add ANY types/country to buildSuggestUrl → the byte-identical
//     assertion FAILS (also caught by the scoped ORCH-1079 gate);
//   - T-5: point handleSuggest at buildPlaceSuggestUrl → the isolation
//     source-structure assertion FAILS (business borrows the filtered builder);
//   - T-1: remove the `&types=` append from buildPlaceSuggestUrl → the place
//     types assertion FAILS.
//
// Run: deno test --allow-read \
//   supabase/functions/mapbox-geocode/__tests__/mapboxPlaceSuggest.orch1365.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildPlaceSuggestUrl,
  buildSuggestUrl,
  PLACE_SUGGEST_TYPES,
} from "../index.ts";

const BASE = "https://api.mapbox.com/search/searchbox/v1";
const TOKEN = "sk-server-secret";
const SESSION = "sess-uuid-0001";

// The EXACT pre-1365 business string — identical to the ORCH-1361 baseline. Any
// drift here is a real business-search regression (SC-5).
const PRE_1365_BUSINESS_SUGGEST =
  `${BASE}/suggest?q=lekki&session_token=${SESSION}&access_token=${TOKEN}&limit=5`;

// ── T-1: place builder adds types + country + limit, NO proximity ─────────────
Deno.test("T-1: buildPlaceSuggestUrl adds types + country + limit (Preferences shape)", () => {
  const url = buildPlaceSuggestUrl(BASE, TOKEN, "lekki", SESSION, {
    country: "ng",
    limit: 8,
  });
  assertStringIncludes(
    url,
    "&types=place,locality,neighborhood,region,district&country=ng&limit=8",
  );
  // Preferences sends no proximity (OQ-4).
  assert(!url.includes("&proximity="), "Preferences place search sends no proximity");
});

Deno.test("T-1: PLACE_SUGGEST_TYPES is the doc-verified place set", () => {
  assertEquals(PLACE_SUGGEST_TYPES, "place,locality,neighborhood,region,district");
});

// ── T-2: place builder omits country when absent ──────────────────────────────
Deno.test("T-2: buildPlaceSuggestUrl omits country when not provided", () => {
  const url = buildPlaceSuggestUrl(BASE, TOKEN, "lekki", SESSION, { limit: 8 });
  assertStringIncludes(url, "&types=place,locality,neighborhood,region,district");
  assertStringIncludes(url, "&limit=8");
  assert(!url.includes("&country="), "no country when the query has no trailing country");
});

Deno.test("T-2: place builder shares q/session/access encoding with the business builder", () => {
  const url = buildPlaceSuggestUrl(BASE, TOKEN, "a b", SESSION, {});
  assertStringIncludes(url, "?q=a%20b");
  assertStringIncludes(url, `&session_token=${SESSION}`);
  assertStringIncludes(url, `&access_token=${TOKEN}`);
  assertStringIncludes(url, "&limit=5"); // default clamp
});

Deno.test("T-2: forward-compat proximity appends only when present (Preferences omits it)", () => {
  const withProx = buildPlaceSuggestUrl(BASE, TOKEN, "lekki", SESSION, {
    country: "ng",
    proximity: "3.4,6.45",
  });
  assertStringIncludes(withProx, "&proximity=3.4%2C6.45");
});

// ── T-5: BUSINESS byte-identical + isolation (fails-on-revert) ─────────────────
Deno.test("T-5: buildSuggestUrl (business) is BYTE-IDENTICAL to pre-1365 (SC-5)", () => {
  const url = buildSuggestUrl(BASE, TOKEN, "lekki", SESSION, {});
  assertEquals(url, PRE_1365_BUSINESS_SUGGEST);
  assert(!url.includes("&types="), "business suggest must never add a types filter");
  assert(!url.includes("&country="), "business suggest must never add a country filter");
});

Deno.test("T-5: the two builders are DIFFERENT (the code-level isolation wall)", () => {
  const business = buildSuggestUrl(BASE, TOKEN, "lekki", SESSION, {});
  const place = buildPlaceSuggestUrl(BASE, TOKEN, "lekki", SESSION, {});
  assert(business !== place, "business + place builders must produce different URLs");
  assert(!business.includes("&types="), "business is filter-free");
  assert(place.includes("&types="), "place is type-filtered");
});

// Strip // + /* */ comments so a JSDoc mention of a symbol never counts as a
// call-site (the `[^:]` guard protects `https://` doc URLs).
function stripComments(src: string): string {
  return src
    .replace(/([^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

Deno.test("T-5: SOURCE isolation — handleSuggest uses buildSuggestUrl, NOT buildPlaceSuggestUrl", async () => {
  const src = stripComments(
    await Deno.readTextFile(new URL("../index.ts", import.meta.url).pathname),
  );
  // Extract the handleSuggest body (up to the next handler declaration).
  const startIdx = src.indexOf("async function handleSuggest(");
  assert(startIdx !== -1, "handleSuggest must exist");
  const nextIdx = src.indexOf("async function handleSuggestPlaces(", startIdx);
  assert(nextIdx !== -1, "handleSuggestPlaces must exist");
  const handleSuggestBody = src.slice(startIdx, nextIdx);
  assertStringIncludes(
    handleSuggestBody,
    "buildSuggestUrl(",
    "business handler must call the filter-free business builder",
  );
  assert(
    !handleSuggestBody.includes("buildPlaceSuggestUrl"),
    "business handler must NOT borrow the filtered consumer place builder (isolation wall)",
  );

  // And the consumer handler DOES use the place builder + strip.
  const placeStart = src.indexOf("async function handleSuggestPlaces(");
  const placeBody = src.slice(placeStart);
  assertStringIncludes(placeBody, "buildPlaceSuggestUrl(", "consumer handler uses the place builder");
  assertStringIncludes(placeBody, "parseTrailingCountry(", "consumer handler strips the trailing country");
});
