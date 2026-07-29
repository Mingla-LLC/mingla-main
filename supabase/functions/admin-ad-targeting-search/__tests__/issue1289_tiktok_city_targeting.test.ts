// ISSUE-1289 [TikTok city targeting silently falls back to country] — the
// fails-on-revert regression suite for the tool/targeting/search city resolver.
//
// ROOT CAUSE (proven live 2026-07-29, MCP tool_targeting_search, advertiser
// 7627974536397766673): the old TikTok city path read tool/region and filtered
// level==="CITY". But in TikTok's US taxonomy the levels are COUNTRY → PROVINCE
// (state) → CITY (**county**) → DISTRICT (**the actual municipality**), and DMAs
// come back at PROVINCE level. So "New York" the city is a DISTRICT (geo_id
// 5128581), NEVER a level==="CITY" row — the search returned zero matches and the
// create path silently fell back to country. The fix resolves via
// tool/targeting/search FUZZY_SEARCH, which returns city (DISTRICT), county
// (CITY) AND DMA tags with numeric geo_ids usable directly as adgroup
// location_ids.
//
// FAILS-ON-REVERT:
//   - "New York" resolves to a DISTRICT geo_id (the municipality) as the TOP
//     match — reverting the geo-type filter to CITY-only (the old bug) drops the
//     DISTRICT and the top-match assertion fails.
//   - the honest-fallback test fails if the empty-result warning is deleted.
//   - the runtime fetch-mock test fails if the endpoint reverts off
//     tool/targeting/search / FUZZY_SEARCH, or the resolved id is widened to
//     country.
//   - the source-wiring test fails if the edge fn stops calling
//     tiktokSearchCityLocations or reverts to filterTikTokCityRegions.

// adChannel.ts owns the adapter registry and forms a cycle with tiktok.ts;
// evaluate it FIRST (as the edge-fn entrypoints do) to avoid a TDZ ReferenceError.
import "../../_shared/adChannel.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  parseTikTokTargetingSearch,
  pickTikTokCityMatches,
  TIKTOK_CITY_GEO_TYPES,
  type TikTokClient,
  type TikTokLocationTag,
  tiktokSearchCityLocations,
} from "../../_shared/tiktok.ts";

// A representative FUZZY_SEARCH targeting_tag_list for "New York" scoped to US —
// the exact shapes returned live (DISTRICT city, PROVINCE state, DMA, COUNTRY,
// CITY county), plus a GB row (scoping), a DISABLED row, and malformed entries.
function newYorkPayload() {
  return {
    parent_tags: [],
    targeting_tag_list: [
      {
        targeting_type: "GEO",
        name: "New York",
        status_info: { status: "ENABLED", reason: null },
        geo: {
          geo_type: "DISTRICT",
          geo_id: "5128581",
          region_code: "US",
          description: "City",
          parent_id: "5110302",
        },
      },
      {
        targeting_type: "GEO",
        name: "New York",
        status_info: { status: "ENABLED", reason: null },
        geo: {
          geo_type: "PROVINCE",
          geo_id: "5128638",
          region_code: "US",
          description: "State",
          parent_id: "6252001",
        },
      },
      {
        targeting_type: "GEO",
        name: "New York,DMA®",
        status_info: { status: "ENABLED", reason: null },
        geo: {
          geo_type: "DMA",
          geo_id: "501",
          region_code: "US",
          description: "DMA®",
          parent_id: "6252001",
        },
      },
      {
        targeting_type: "GEO",
        name: "United States",
        status_info: { status: "ENABLED", reason: null },
        geo: {
          geo_type: "COUNTRY",
          geo_id: "6252001",
          region_code: "US",
          description: "Country",
          parent_id: "0",
        },
      },
      {
        targeting_type: "GEO",
        name: "Kings",
        status_info: { status: "ENABLED", reason: null },
        // geo_id as a NUMBER — the parser must coerce it to a string.
        geo: {
          geo_type: "CITY",
          geo_id: 5110302,
          region_code: "US",
          description: "County",
          parent_id: "5128638",
        },
      },
      {
        targeting_type: "GEO",
        name: "New York",
        status_info: { status: "ENABLED", reason: null },
        // Same name but a GB row — must be dropped when the search is US-scoped.
        geo: {
          geo_type: "DISTRICT",
          geo_id: "2988507",
          region_code: "GB",
          description: "City",
          parent_id: "0",
        },
      },
      {
        targeting_type: "GEO",
        name: "New York (unavailable)",
        status_info: { status: "DELETED", reason: "unavailable" },
        // A DISABLED tag — never offered as targetable.
        geo: {
          geo_type: "DISTRICT",
          geo_id: "9990001",
          region_code: "US",
          description: "City",
          parent_id: "0",
        },
      },
      // Malformed entries — SKIPPED, never a TypeError.
      null,
      { name: "no geo — dropped" },
      {
        name: "bad id",
        geo: { geo_type: "CITY", geo_id: "abc", region_code: "US" },
      },
      { name: "", geo: { geo_type: "CITY", geo_id: "123", region_code: "US" } },
    ],
  };
}

// ── parseTikTokTargetingSearch — tolerant parser over the live shape ───────────
Deno.test("parseTikTokTargetingSearch extracts GEO tags, coerces numeric ids, skips junk", () => {
  const tags = parseTikTokTargetingSearch(newYorkPayload());
  // 7 well-formed GEO rows survive (2 malformed geoless/bad-id + null + empty-name dropped).
  assertEquals(tags.length, 7);
  const city = tags.find((t) => t.geoId === "5128581");
  assert(city, "the DISTRICT municipality must parse");
  assertEquals(city?.geoType, "DISTRICT");
  assertEquals(city?.description, "City");
  assertEquals(city?.status, "ENABLED");
  // number geo_id (Kings, 5110302) coerced to string
  assert(tags.some((t) => t.geoId === "5110302" && t.geoType === "CITY"));
  // non-numeric / null / geoless / empty-name are all dropped
  assert(
    !tags.some((t) => t.geoId === "abc" || t.geoId === "" || t.geoId === "123"),
  );
});

Deno.test("parseTikTokTargetingSearch is null-safe on hostile payloads", () => {
  assertEquals(parseTikTokTargetingSearch(null), []);
  assertEquals(parseTikTokTargetingSearch({}), []);
  assertEquals(parseTikTokTargetingSearch({ targeting_tag_list: "nope" }), []);
  assertEquals(
    parseTikTokTargetingSearch({ targeting_tag_list: [42, "x", null] }),
    [],
  );
});

// ── pickTikTokCityMatches — the actual city resolves (NO country fallback) ─────
Deno.test("pickTikTokCityMatches resolves 'New York' to the DISTRICT city as the TOP match", () => {
  const tags = parseTikTokTargetingSearch(newYorkPayload());
  const out = pickTikTokCityMatches(tags, { country: "US", q: "New York" });

  // FAILS-ON-REVERT: the actual municipality (a DISTRICT, description "City") is
  // the top result. The old level==="CITY"-only filter dropped DISTRICT rows, so
  // reverting collapses this to a different id (or empty → country fallback).
  assert(
    out.length > 0,
    "a supported city MUST resolve — never a silent country fallback",
  );
  assertEquals(out[0].geoId, "5128581");
  assertEquals(out[0].geoType, "DISTRICT");
  assertEquals(out[0].description, "City");

  // The DMA is offered as an additional candidate, ranked BELOW the exact city.
  assert(
    out.some((t) => t.geoId === "501" && t.geoType === "DMA"),
    "the DMA candidate is surfaced",
  );
  const cityIdx = out.findIndex((t) => t.geoId === "5128581");
  const dmaIdx = out.findIndex((t) => t.geoId === "501");
  assert(cityIdx < dmaIdx, "the actual city ranks ahead of the DMA");

  // The state (PROVINCE) and country are NEVER offered for a city search.
  assert(
    !out.some((t) => t.geoId === "5128638"),
    "the PROVINCE state is excluded",
  );
  assert(!out.some((t) => t.geoId === "6252001"), "the COUNTRY is excluded");
  // Every result is a numeric geo_id → drops straight into adgroup location_ids.
  assert(out.every((t) => /^\d+$/.test(t.geoId)));
});

Deno.test("pickTikTokCityMatches enforces ENABLED-only + country scoping", () => {
  const tags = parseTikTokTargetingSearch(newYorkPayload());
  const out = pickTikTokCityMatches(tags, { country: "US", q: "New York" });
  // DISABLED tag never offered.
  assert(
    !out.some((t) => t.geoId === "9990001"),
    "a DELETED/unavailable tag is dropped",
  );
  // GB row excluded from a US search (regionCode scoping).
  assert(out.every((t) => t.regionCode === "US"));
  assert(!out.some((t) => t.regionCode === "GB"));
});

Deno.test("TIKTOK_CITY_GEO_TYPES surfaces city-like levels only (no COUNTRY/PROVINCE/ZIP)", () => {
  assertEquals([...TIKTOK_CITY_GEO_TYPES].sort(), ["CITY", "DISTRICT", "DMA"]);
});

// ── Honest fallback — genuinely-unresolvable → EMPTY (the caller warns) ────────
Deno.test("pickTikTokCityMatches returns [] when only country/state rows exist (honest fallback)", () => {
  // GB returns no sub-country geo live (T-P2); a payload with only COUNTRY/
  // PROVINCE rows must resolve to nothing so the edge fn warns instead of widening.
  const onlyCountry = parseTikTokTargetingSearch({
    targeting_tag_list: [
      {
        name: "United Kingdom",
        status_info: { status: "ENABLED" },
        geo: {
          geo_type: "COUNTRY",
          geo_id: "2635167",
          region_code: "GB",
          description: "Country",
        },
      },
      {
        name: "England",
        status_info: { status: "ENABLED" },
        geo: {
          geo_type: "PROVINCE",
          geo_id: "6269131",
          region_code: "GB",
          description: "State",
        },
      },
    ],
  });
  assertEquals(
    pickTikTokCityMatches(onlyCountry, { country: "GB", q: "London" }),
    [],
  );
  assertEquals(pickTikTokCityMatches([], { country: "US", q: "New York" }), []);
});

// ── Runtime proof — the live resolver builds a FUZZY_SEARCH POST and returns
//    a city geo_id end-to-end (fetch mocked; no network, no create). ───────────
Deno.test("tiktokSearchCityLocations issues a FUZZY_SEARCH POST and resolves the city id", async () => {
  const client = {
    platform: "tiktok",
    token: "tok-test",
    advertiserId: "7627974536397766673",
    apiVersion: "v1.3",
    apiBase: "https://business-api.tiktok.com",
  } as unknown as TikTokClient;

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    capturedInit = init;
    return Promise.resolve(
      new Response(
        JSON.stringify({ code: 0, message: "OK", data: newYorkPayload() }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  }) as typeof fetch;

  try {
    const results: TikTokLocationTag[] = await tiktokSearchCityLocations(
      client,
      {
        q: "New York",
        country: "US",
      },
    );

    // Endpoint + method fails-on-revert.
    assert(
      capturedUrl.includes("/tool/targeting/search/"),
      "must hit tool/targeting/search",
    );
    assertEquals(capturedInit?.method, "POST");
    const body = JSON.parse(String(capturedInit?.body ?? "{}"));
    assertEquals(body.search_type, "FUZZY_SEARCH");
    assertEquals(body.keywords, ["New York"]);
    assertEquals(body.region_codes, ["US"]);
    assertEquals(body.objective_type, "TRAFFIC");
    assertEquals(body.promotion_type, "WEBSITE"); // required for TRAFFIC
    assertEquals([...body.geo_types].sort(), ["CITY", "DISTRICT", "DMA"]);

    // End-to-end: the city resolves — the create path receives a real location_id,
    // NOT a widened country.
    assert(results.length > 0, "a supported city resolves to location ids");
    assertEquals(results[0].geoId, "5128581");
    assert(results.every((t) => /^\d+$/.test(t.geoId)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Source wiring — the edge fn resolves via the new endpoint, warns honestly ──
Deno.test("admin-ad-targeting-search resolves TikTok cities via tiktokSearchCityLocations", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(
    src.includes("tiktokSearchCityLocations(client"),
    "the TikTok city branch must resolve via tool/targeting/search",
  );
  assert(
    !src.includes("filterTikTokCityRegions"),
    "the old tool/region CITY filter must be gone from the city branch (it silently fell back to country)",
  );
  assert(
    src.includes("target the country instead"),
    "an empty result must surface an HONEST country-fallback warning, not a silent widen",
  );
});

Deno.test("tiktok.ts wires tool/targeting/search FUZZY_SEARCH for city resolution", async () => {
  const src = await Deno.readTextFile(
    new URL("../../_shared/tiktok.ts", import.meta.url),
  );
  assert(
    src.includes('"tool/targeting/search/"'),
    "the FUZZY_SEARCH endpoint must be wired",
  );
  assert(
    src.includes('search_type: "FUZZY_SEARCH"'),
    "FUZZY_SEARCH mode must be used",
  );
});
