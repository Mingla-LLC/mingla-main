/**
 * #4238 media-buyer — the targeting compiler: each app's distance limits,
 * a distance per place, regions, pins, left-out places and languages, with
 * the exact shape each app's create path receives. Earlier plans compile
 * byte-identically (frozen snapshots stay valid).
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileProviderTargeting,
  providerExecutionTargeting,
} from "../adTargetingCompiler.ts";

const LAGOS = { name: "Lagos", countryCode: "NG" };

Deno.test("SC-A5 Meta refuses a city distance under 17 km in plain words", () => {
  const row = compileProviderTargeting(
    "meta",
    { countries: ["NG"], cities: [{ ...LAGOS, radiusKm: 15 }] },
    { locationIds: { "NG:lagos": "1630653" } },
  );
  assertEquals(row.verdict, "check_required");
  assertStringIncludes(
    row.checksRequired.join(" "),
    "Facebook & Instagram needs at least 17 km around a city.",
  );
  const ok = compileProviderTargeting(
    "meta",
    { countries: ["NG"], cities: [{ ...LAGOS, radiusKm: 17 }] },
    { locationIds: { "NG:lagos": "1630653" } },
  );
  assertEquals(ok.verdict, "exact");
});

Deno.test("SC-B1 each place keeps its own distance on Meta and Snapchat", () => {
  const intent = {
    countries: ["NG"],
    cities: [{ ...LAGOS, radiusKm: 20 }, {
      name: "Lekki",
      countryCode: "NG",
      radiusKm: 30,
    }],
  };
  const meta = compileProviderTargeting("meta", intent, {
    locationIds: { "NG:lagos": "1", "NG:lekki": "2" },
  });
  assertEquals(
    (meta.compiledTargeting.geo_locations as Record<string, unknown>).cities,
    [
      { key: "1", radius: 20, distance_unit: "kilometer" },
      { key: "2", radius: 30, distance_unit: "kilometer" },
    ],
  );
  const snap = compileProviderTargeting("snapchat", intent, {
    locationCoordinates: {
      "NG:lagos": { latitude: 6.5, longitude: 3.4 },
      "NG:lekki": { latitude: 6.4, longitude: 3.5 },
    },
  });
  assertEquals(
    (snap.compiledTargeting.geo_circles as Record<string, unknown>[]).map((c) =>
      c.radius
    ),
    [20, 30],
  );
});

Deno.test("SC-B2/B3 regions and pins: Meta regions + custom_locations, TikTok wider", () => {
  const intent = {
    countries: ["NG"],
    cities: [
      { name: "Lagos State", countryCode: "NG", kind: "region" as const },
      {
        name: "Beach club, Lekki",
        countryCode: "NG",
        kind: "pin" as const,
        radiusKm: 2,
      },
    ],
  };
  const meta = compileProviderTargeting("meta", intent, {
    locationIds: { "region:NG:lagos state": "2532" },
    locationCoordinates: {
      "pin:NG:beach club, lekki": { latitude: 6.43, longitude: 3.47 },
    },
  });
  assertEquals(meta.verdict, "exact");
  const geo = meta.compiledTargeting.geo_locations as Record<string, unknown>;
  assertEquals(geo.regions, [{ key: "2532" }]);
  assertEquals(geo.custom_locations, [{
    latitude: 6.43,
    longitude: 3.47,
    radius: 2,
    distance_unit: "kilometer",
  }]);
  const exec = providerExecutionTargeting(
    "meta",
    meta.audienceIntent,
    meta.compiledTargeting,
  );
  assertEquals(exec.regions, [{ key: "2532" }]);
  assert(Array.isArray(exec.custom_locations));

  const tiktok = compileProviderTargeting("tiktok", intent, {
    locationIds: {
      "region:NG:lagos state": "2332453",
      "pin:NG:beach club, lekki": "2332453",
    },
  });
  assertEquals(tiktok.verdict, "broader");
  assertStringIncludes(
    tiktok.wideningSummary.join(" "),
    "TikTok uses the wider area around your pin.",
  );
  const google = compileProviderTargeting("google", intent, {
    locationIds: { "region:NG:lagos state": "20010" },
  });
  assertEquals(google.compiledTargeting.location_ids, ["20010"]);
  const gExec = providerExecutionTargeting(
    "google",
    google.audienceIntent,
    google.compiledTargeting,
  );
  assertEquals(
    (gExec.resolved_locations as Record<string, unknown>[])[0].target_type,
    "Region",
  );
});

Deno.test("SC-B4 left-out places: Meta and Snapchat send them; TikTok, Google, Reddit say they can't", () => {
  const intent = {
    countries: ["NG"],
    cities: [{ ...LAGOS, radiusKm: 40 }],
    excludedPlaces: [{ name: "Ikorodu", countryCode: "NG" }],
  };
  const meta = compileProviderTargeting("meta", intent, {
    locationIds: { "NG:lagos": "1", "NG:ikorodu": "9" },
  });
  assertEquals(meta.compiledTargeting.excluded_geo_locations, {
    cities: [{ key: "9" }],
  });
  const snap = compileProviderTargeting("snapchat", intent, {
    locationCoordinates: {
      "NG:lagos": { latitude: 6.5, longitude: 3.4 },
      "NG:ikorodu": { latitude: 6.6, longitude: 3.5 },
    },
  });
  assertEquals(
    (snap.compiledTargeting.exclude_circles as unknown[]).length,
    1,
  );
  const snapExec = providerExecutionTargeting(
    "snapchat",
    snap.audienceIntent,
    snap.compiledTargeting,
  );
  assert(Array.isArray(snapExec.excluded_circles));
  for (const platform of ["tiktok", "google", "reddit"] as const) {
    const row = compileProviderTargeting(platform, intent, {
      locationIds: { "NG:lagos": "1" },
    });
    assertStringIncludes(row.wideningSummary.join(" "), "can't leave out places");
  }
});

Deno.test("SC-B5 languages: Meta locales from its own keys, TikTok and Reddit codes", () => {
  const intent = { countries: ["NG"], languages: ["en"] };
  const meta = compileProviderTargeting("meta", intent, {
    languageIds: { en: "1001" },
  });
  assertEquals(meta.compiledTargeting.locales, [1001]);
  const missing = compileProviderTargeting("meta", intent, {});
  assertEquals(missing.verdict, "check_required");
  const tiktok = compileProviderTargeting("tiktok", intent, {});
  assertEquals(tiktok.compiledTargeting.languages, ["en"]);
  const reddit = compileProviderTargeting("reddit", intent, {});
  const redditExec = providerExecutionTargeting(
    "reddit",
    reddit.audienceIntent,
    reddit.compiledTargeting,
  );
  assertEquals(redditExec.passthrough, { reddit: { languages: ["EN"] } });
});

Deno.test("old intents compile byte-identically (no new keys appear)", () => {
  const intent = {
    countries: ["GB"],
    cities: [{ name: "London", countryCode: "GB" }],
    radiusKm: 20,
    gender: "all" as const,
  };
  const meta = compileProviderTargeting("meta", intent, {
    locationIds: { "GB:london": "2643743" },
  });
  assertEquals(meta.compiledTargeting, {
    geo_locations: {
      countries: ["GB"],
      cities: [{ key: "2643743", radius: 20, distance_unit: "kilometer" }],
    },
  });
  assertEquals(Object.keys(meta.audienceIntent).sort(), [
    "cities",
    "countries",
    "gender",
    "radiusKm",
  ]);
});
