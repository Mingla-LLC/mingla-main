// ISSUE-989 [Campaign Builder real targeting] — HAPPY-PATH regression suite for
// the admin-ad-targeting-search resolvers + the create-path consumption shapes.
//
// These pin the PROVEN-live behavior (2026-07-20):
//   - Meta adgeolocation → {key,name,region,country_code}; adinterest → {id,name}.
//   - TikTok tool/region CITY filter → numeric location_ids (COUNTRY/PROVINCE
//     rows excluded); tool/interest_category → {interest_category_id,name}.
//   - Meta cities normalize to {key,radius,distance_unit} (clamped 1-50mi);
//     interests → flexible_spec:[{interests:[{id}]}].
//   - TikTok ad-group body carries interest_category_ids only when picked.
//   - The create fn + config wire the new fn (source assertions).
//
// FAILS-ON-REVERT: deleting `body.interest_category_ids = spec.interestCategoryIds`
// in tiktok.ts fails the ad-group test; deleting the flexible_spec builder fails
// the interest test; deleting the CITY-level filter fails the city test; deleting
// the create-campaign consumption fails the source-wiring test.

// adChannel.ts owns the adapter registry ({meta: metaAdapter, …}) and forms a
// cycle with meta.ts/tiktok.ts. Evaluate it FIRST (as the edge-fn entrypoints do)
// so the registry initializes after each adapter is defined — otherwise importing
// the leaf modules first hits a metaAdapter TDZ ReferenceError.
import "../../_shared/adChannel.ts";
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildMetaGeoLocations,
  buildMetaInterestFlexibleSpec,
  META_DEFAULT_CITY_RADIUS_MILE,
  normalizeMetaCities,
  parseMetaGeoResults,
  parseMetaInterestResults,
} from "../../_shared/meta.ts";
import {
  buildTikTokAdGroupBody,
  filterTikTokCityRegions,
  filterTikTokInterestCategories,
  normalizeTikTokInterestCategoryIds,
  parseTikTokInterestCategories,
  parseTikTokRegions,
} from "../../_shared/tiktok.ts";

// ── Meta geo parser (adgeolocation) — the London/GB disambiguation payload ─────
Deno.test("parseMetaGeoResults normalizes adgeolocation cities", () => {
  const payload = {
    data: [
      { key: "812057", name: "London", type: "city", region: "England", country_code: "GB", supports_region: true },
      { key: 2763329, name: "London", type: "city", region: "New Jersey", country_code: "US" },
      { name: "no key — dropped" },
    ],
  };
  const out = parseMetaGeoResults(payload);
  assertEquals(out.length, 2);
  assertEquals(out[0].key, "812057");
  assertEquals(out[0].country_code, "GB");
  assertEquals(out[0].supports_region, true);
  assertEquals(out[1].key, "2763329"); // numeric key coerced to string
});

Deno.test("parseMetaInterestResults normalizes adinterest ids + audience size", () => {
  const payload = {
    data: [
      { id: "6003375995381", name: "nightlife (bars, clubs and nightlife)", audience_size_lower_bound: 59515902, audience_size_upper_bound: 69990701 },
      { name: "no id — dropped" },
    ],
  };
  const out = parseMetaInterestResults(payload);
  assertEquals(out.length, 1);
  assertEquals(out[0].id, "6003375995381");
  assertEquals(out[0].audience_size_lower_bound, 59515902);
});

// ── Meta city normalize → {key, radius, distance_unit}, clamped ───────────────
Deno.test("normalizeMetaCities enforces the geo_locations.cities shape + radius bounds", () => {
  const out = normalizeMetaCities([
    { key: "812057", radius: 10, distance_unit: "mile" },
    { key: "999", radius: 500, distance_unit: "mile" }, // clamps to 50
    { key: "888" }, // default radius
    { key: "", radius: 5 }, // dropped — no key
    { radius: 5 }, // dropped — no key
  ]);
  assertEquals(out.length, 3);
  assertEquals(out[0], { key: "812057", radius: 10, distance_unit: "mile" });
  assertEquals(out[1].radius, 50); // clamped to Meta max
  assertEquals(out[2].radius, META_DEFAULT_CITY_RADIUS_MILE);
  assertEquals(out[2].distance_unit, "mile");
});

// ── Meta geo_locations — city REPLACES country (tester P1: no union) ──────────
Deno.test("buildMetaGeoLocations drops countries when a city is chosen (radius stays laser)", () => {
  const cities = [{ key: "812057", radius: 10, distance_unit: "mile" }];
  // City chosen → CITIES ONLY, countries DROPPED (Meta unions ∪; keeping both
  // made the radius inert — London 10mi ∪ US ≈ 263M instead of ~7.3M).
  const withCity = buildMetaGeoLocations(["US", "GB"], cities);
  assertEquals(withCity, { cities });
  assertEquals(withCity.countries, undefined);
  // No city → country is the fallback geo (unchanged broad targeting).
  assertEquals(buildMetaGeoLocations(["US", "GB"], []), { countries: ["US", "GB"] });
  // Multi-city support preserved.
  const two = [
    { key: "812057", radius: 10, distance_unit: "mile" },
    { key: "2418779", radius: 25, distance_unit: "mile" },
  ];
  assertEquals(buildMetaGeoLocations(["US"], two), { cities: two });
});

Deno.test("buildMetaInterestFlexibleSpec builds flexible_spec or null", () => {
  assertEquals(buildMetaInterestFlexibleSpec([]), null);
  assertEquals(buildMetaInterestFlexibleSpec(undefined), null);
  const spec = buildMetaInterestFlexibleSpec(["6003375995381", 123, "  ", ""]);
  assertEquals(spec, [{ interests: [{ id: "6003375995381" }, { id: "123" }] }]);
});

// ── TikTok region CITY filter — the level==="CITY" gate ───────────────────────
Deno.test("filterTikTokCityRegions returns CITY-level ids only, country-scoped", () => {
  const payload = {
    region_info: [
      { location_id: "6252001", name: "United States", level: "COUNTRY", region_code: "US" },
      { location_id: "5392967", name: "Santa Barbara", level: "CITY", region_code: "US" },
      { location_id: "4956199", name: "Worcester", level: "CITY", region_code: "US" },
      { location_id: "111", name: "London", level: "CITY", region_code: "GB" },
      { location_id: "222", name: "California", level: "PROVINCE", region_code: "US" },
    ],
  };
  const regions = parseTikTokRegions(payload);
  const usSanta = filterTikTokCityRegions(regions, { country: "US", q: "santa" });
  assertEquals(usSanta.length, 1);
  assertEquals(usSanta[0].locationId, "5392967");
  assertEquals(usSanta[0].level, "CITY");
  // country scoping: a GB city is excluded from a US search
  const usAll = filterTikTokCityRegions(regions, { country: "US", q: "" });
  assert(usAll.every((r) => r.regionCode === "US" && r.level === "CITY"));
  assert(!usAll.some((r) => r.locationId === "111"));
  // COUNTRY/PROVINCE rows never appear
  assert(!usAll.some((r) => r.locationId === "6252001" || r.locationId === "222"));
});

Deno.test("parseTikTokInterestCategories + filter over the live shape", () => {
  const payload = {
    data: {
      interest_categories: [
        { interest_category_id: "27", interest_category_name: "Food & Beverage", level: 1, sub_category_ids: ["27100"] },
        { interest_category_id: "23", interest_category_name: "News & Entertainment", level: 1 },
        { interest_category_name: "no id — dropped" },
      ],
    },
  };
  const cats = parseTikTokInterestCategories(payload);
  assertEquals(cats.length, 2);
  assertEquals(cats[0].id, "27");
  const food = filterTikTokInterestCategories(cats, { q: "food" });
  assertEquals(food.length, 1);
  assertEquals(food[0].id, "27");
});

Deno.test("normalizeTikTokInterestCategoryIds keeps numeric, dedupes, drops junk", () => {
  assertEquals(normalizeTikTokInterestCategoryIds(["27", "27", "23", "abc", 99, ""]), ["27", "23", "99"]);
  assertEquals(normalizeTikTokInterestCategoryIds(undefined), []);
});

// ── The create-path consumption: interest_category_ids on the ad group ────────
Deno.test("buildTikTokAdGroupBody carries interest_category_ids only when picked", () => {
  const base = {
    name: "camp — ad group",
    optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW",
    billingEvent: "CPC",
    budgetCents: 5000,
    locationIds: ["5392967"],
  };
  const withInterests = buildTikTokAdGroupBody("adv", "camp", { ...base, interestCategoryIds: ["27", "23"] });
  assertEquals(withInterests.interest_category_ids, ["27", "23"]);
  assertEquals(withInterests.location_ids, ["5392967"]); // city id survives

  const without = buildTikTokAdGroupBody("adv", "camp", { ...base });
  assertEquals(without.interest_category_ids, undefined); // omitted → broad targeting unchanged
});

// ── Source wiring — the create fn + config register the new targeting shapes ───
Deno.test("create-campaign consumes cities + interests for Meta and TikTok", async () => {
  const src = await Deno.readTextFile(new URL("../../admin-ad-create-campaign/index.ts", import.meta.url));
  assert(src.includes("normalizeMetaCities"), "Meta city normalization must be wired");
  assert(src.includes("buildMetaInterestFlexibleSpec"), "Meta interest flexible_spec must be wired");
  // tester P1: the Meta geo assembly MUST use buildMetaGeoLocations (city drops
  // country) — never the old `{ countries, cities: metaCities }` union.
  assert(
    src.includes("geo_locations: buildMetaGeoLocations(countries, metaCities)"),
    "Meta geo_locations must drop countries when a city is chosen (no union)",
  );
  assert(
    !src.includes("{ countries, cities: metaCities }"),
    "the old countries∪cities union must be gone",
  );
  assert(src.includes("normalizeTikTokInterestCategoryIds"), "TikTok interest ids must be wired");
  assert(src.includes("interest_category_ids: interestCategoryIdsT"), "TikTok ad-group interest ids must be sent");
  assert(src.includes("location_ids: cityLocationIdsT") || src.includes("locationIdsT = cityLocationIdsT"), "TikTok city ids must override country resolution");
});

Deno.test("config.toml registers admin-ad-targeting-search with verify_jwt", async () => {
  const cfg = await Deno.readTextFile(new URL("../../../config.toml", import.meta.url));
  assert(cfg.includes("[functions.admin-ad-targeting-search]"), "the edge fn must be registered");
  const idx = cfg.indexOf("[functions.admin-ad-targeting-search]");
  const after = cfg.slice(idx, idx + 120);
  assert(after.includes("verify_jwt = true"), "the fn must be admin-gated (verify_jwt=true)");
});
