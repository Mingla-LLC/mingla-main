/**
 * #4238 media-buyer — the exact request fields each app receives for
 * regions, pins, left-out places and languages (provider writes are not
 * called; these are the bodies the adapters build).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMetaGeoLocations,
  normalizeMetaCustomLocations,
  normalizeMetaExcludedGeo,
  normalizeMetaLocales,
} from "../meta.ts";
import {
  buildSnapchatAdSquadBody,
  buildSnapchatGeoTargeting,
} from "../snapchat.ts";
import { buildTikTokAdGroupBody } from "../tiktok.ts";

Deno.test("Meta geo_locations: regions and pins replace the country", () => {
  assertEquals(
    buildMetaGeoLocations(["NG"], [], {
      regions: [{ key: "2532" }],
      custom_locations: [{
        latitude: 6.43,
        longitude: 3.47,
        radius: 2,
        distance_unit: "kilometer",
      }],
    }),
    {
      regions: [{ key: "2532" }],
      custom_locations: [{
        latitude: 6.43,
        longitude: 3.47,
        radius: 2,
        distance_unit: "kilometer",
      }],
    },
  );
  // Unchanged when nothing new is set.
  assertEquals(buildMetaGeoLocations(["NG"], []), { countries: ["NG"] });
  // A broken pin is dropped, never moved.
  assertEquals(
    normalizeMetaCustomLocations([{ latitude: 200, longitude: 3, radius: 2 }]),
    [],
  );
});

Deno.test("Meta excluded_geo_locations and locales", () => {
  assertEquals(
    normalizeMetaExcludedGeo({ cities: [{ key: "9" }], regions: [] }),
    { cities: [{ key: "9" }] },
  );
  assertEquals(normalizeMetaExcludedGeo({}), null);
  assertEquals(normalizeMetaLocales([1001, "6", "x"]), [1001, 6]);
});

Deno.test("Snapchat left-out places ride an EXCLUDE location group", () => {
  const circle = {
    country_code: "NG",
    latitude: 6.5,
    longitude: 3.4,
    radius: 20,
    unit: "KILOMETERS",
  };
  const geo = buildSnapchatGeoTargeting(["NG"], [circle], [{
    ...circle,
    latitude: 6.6,
    radius: 5,
  }]);
  assertEquals(geo.locations?.map((row) => row.operation), [
    "INCLUDE",
    "EXCLUDE",
  ]);
  const body = buildSnapchatAdSquadBody("campaign-1", {
    name: "Rooftop",
    optimizationGoal: "PIXEL_PAGE_VIEW",
    countries: ["NG"],
    budgetCents: 500,
    pixelId: "pixel-1",
    circles: [circle],
    excludedCircles: [{ ...circle, latitude: 6.6 }],
    nowMs: Date.parse("2026-11-03T12:00:00Z"),
  });
  const locations = (body.targeting as Record<string, unknown>)
    .locations as Record<string, unknown>[];
  assertEquals(locations[1].operation, "EXCLUDE");
});

Deno.test("TikTok ad group sends languages only when set", () => {
  const base = {
    name: "Rooftop",
    optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW",
    billingEvent: "CPC",
    budgetCents: 5_000,
    locationIds: ["2332453"],
    nowMs: Date.parse("2026-11-03T12:00:00Z"),
  };
  assertEquals(
    buildTikTokAdGroupBody("adv", "camp", { ...base, languages: ["en"] })
      .languages,
    ["en"],
  );
  assertEquals(
    "languages" in buildTikTokAdGroupBody("adv", "camp", base),
    false,
  );
});
