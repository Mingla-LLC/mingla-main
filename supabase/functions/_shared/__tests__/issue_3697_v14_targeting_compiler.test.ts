import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  compileProviderTargeting,
  compileTargetingPlan,
} from "../adTargetingCompiler.ts";

const exactIntent = {
  countries: ["NG"],
  cities: [{
    name: "Lagos",
    countryCode: "NG",
    latitude: 6.5244,
    longitude: 3.3792,
  }],
  radiusKm: 15,
  ageMin: 25,
  ageMax: 34,
  gender: "women" as const,
  interests: [{ name: "Live music" }],
};

Deno.test("v1.4 targeting compiler freezes an explicit result for all five providers", () => {
  const refs = {
    locationIds: { "NG:lagos": "loc-lagos" },
    interestIds: { "live music": "interest-live-music" },
  };
  const rows = compileTargetingPlan({
    platforms: ["meta", "tiktok", "snapchat", "google", "reddit"],
    intent: exactIntent,
    refsByPlatform: { meta: refs, tiktok: refs, snapchat: refs, google: refs },
  });
  assertEquals(rows.length, 5);
  assertEquals(rows.find((row) => row.platform === "meta")?.verdict, "exact");
  assertEquals(
    rows.find((row) => row.platform === "snapchat")?.verdict,
    "exact",
  );
  assertEquals(rows.find((row) => row.platform === "google")?.verdict, "exact");
  assertEquals(
    rows.find((row) => row.platform === "tiktok")?.verdict,
    "broader",
  );
  assertEquals(
    rows.find((row) => row.platform === "tiktok")?.compiledTargeting
      .gender,
    "GENDER_FEMALE",
  );
  assertEquals(
    rows.find((row) => row.platform === "snapchat")?.compiledTargeting
      .geo_circles,
    [{
      country_code: "NG",
      latitude: 6.5244,
      longitude: 3.3792,
      radius: 15,
      unit: "kilometer",
    }],
  );
  assertEquals(
    rows.find((row) => row.platform === "reddit")?.verdict,
    "broader",
  );
  for (const row of rows) {
    assertEquals(row.compilerVersion, "v1.4.0");
    assert(Object.keys(row.compiledTargeting).length > 0);
    assert(!("currency" in row.audienceIntent));
    assert(!("currency" in row.compiledTargeting));
  }
});

Deno.test("Google native App targeting names every unavoidable widening", () => {
  const result = compileProviderTargeting(
    "google",
    exactIntent,
    {
      locationIds: { "NG:lagos": "100001" },
      interestIds: { "live music": "200001" },
    },
    "native_app",
  );
  assertEquals(result.verdict, "broader");
  assertEquals(result.compiledTargeting.location_ids, ["100001"]);
  assertEquals(result.compiledTargeting.age_ranges, undefined);
  assertEquals(result.compiledTargeting.gender_types, undefined);
  assertEquals(result.compiledTargeting.audience_ids, undefined);
  assertStringIncludes(result.wideningSummary.join(" "), "age");
  assertStringIncludes(result.wideningSummary.join(" "), "gender");
  assertStringIncludes(result.wideningSummary.join(" "), "audience signals");
});

Deno.test("unresolved provider ids are check_required, never silently dropped", () => {
  const result = compileProviderTargeting("meta", exactIntent);
  assertEquals(result.verdict, "check_required");
  assertStringIncludes(result.checksRequired.join(" "), "Meta city keys");
  assertStringIncludes(result.checksRequired.join(" "), "Meta interest IDs");
});

Deno.test("Reddit exposes city, radius and age widening explicitly", () => {
  const result = compileProviderTargeting("reddit", exactIntent);
  assertEquals(result.verdict, "broader");
  assertEquals(result.wideningSummary.length, 3);
  assertStringIncludes(result.wideningSummary.join(" "), "city");
  assertStringIncludes(result.wideningSummary.join(" "), "radius");
  assertStringIncludes(result.wideningSummary.join(" "), "age");
});

Deno.test("an empty country intent is unavailable on every provider", () => {
  for (
    const platform of [
      "meta",
      "tiktok",
      "snapchat",
      "google",
      "reddit",
    ] as const
  ) {
    const result = compileProviderTargeting(platform, { countries: [] });
    assertEquals(result.verdict, "unavailable");
  }
});

Deno.test("malformed or out-of-range audience input fails closed before provider compilation", () => {
  const malformed = compileProviderTargeting(
    "meta",
    {
      countries: ["NG", "Nigeria"],
      ageMin: 45,
      ageMax: 21,
      radiusKm: -10,
      cities: [{
        name: "Lagos",
        countryCode: "NG",
        latitude: 120,
        longitude: 3.3792,
      }],
    },
  );
  assertEquals(malformed.verdict, "unavailable");
  assertEquals(malformed.compiledTargeting, {});
  assertStringIncludes(malformed.wideningSummary.join(" "), "ISO code");
  assertStringIncludes(malformed.wideningSummary.join(" "), "positive");
  assertStringIncludes(malformed.wideningSummary.join(" "), "coordinates");
  assertStringIncludes(malformed.wideningSummary.join(" "), "cannot exceed");

  const hostileRuntimeShape = compileProviderTargeting(
    "tiktok",
    { countries: "NG" } as unknown as { countries: string[] },
  );
  assertEquals(hostileRuntimeShape.verdict, "unavailable");
  assertEquals(hostileRuntimeShape.compiledTargeting, {});
});

Deno.test("targeting is independent of brand/provider money currency", async () => {
  const source = await Deno.readTextFile(
    new URL("../adTargetingCompiler.ts", import.meta.url),
  );
  assert(!source.includes("hostDefaultCountriesForCurrency"));
  assert(!source.includes("currency: string"));
});
