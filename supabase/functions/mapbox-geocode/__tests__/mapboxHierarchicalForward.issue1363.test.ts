import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildHierarchyForwardUrl,
  deriveHierarchyLocalities,
  explicitCountryIso,
  hierarchyFeatureMatches,
  normalizeHierarchyName,
} from "../index.ts";

const feature = (params: {
  name: string;
  city: string;
  countryCode?: string;
  coordinates?: [number, number];
}) => ({
  geometry: { coordinates: params.coordinates ?? [7.0498, 4.8156] },
  properties: {
    name: params.name,
    context: {
      place: { name: params.city },
      country: {
        name: "Nigeria",
        country_code: params.countryCode ?? "NG",
      },
    },
  },
});

Deno.test("issue #1363 hierarchy URL uses limit 10 and scoped filters", () => {
  const url = buildHierarchyForwardUrl({
    base: "https://api.mapbox.test/search/searchbox/v1",
    token: "token",
    query: "Port Harcourt",
    types: "place,city,locality,district,neighborhood",
    countryIso: "NG",
  });
  assertStringIncludes(url, "/forward?q=Port%20Harcourt");
  assertStringIncludes(
    url,
    "&types=place%2Ccity%2Clocality%2Cdistrict%2Cneighborhood",
  );
  assertStringIncludes(url, "&country=ng");
  assertStringIncludes(url, "&limit=10");
});

Deno.test("issue #1363 parses only explicit user country and locality suffixes", () => {
  const query =
    "1 fortune avenue off ommumah pipeline road, igwuruta, port harcourt, Nigeria";
  assertEquals(explicitCountryIso(query), "NG");
  assertEquals(deriveHierarchyLocalities(query).slice(0, 2), [
    "port harcourt",
    "igwuruta",
  ]);
  assertEquals(explicitCountryIso("1 Admiralty Way, Lagos"), null);
  assertEquals(normalizeHierarchyName(" Pórt-Harcourt! "), "port harcourt");
});

Deno.test("issue #1363 rejects Port Harcourt Street in Uyo", () => {
  const wrong = feature({
    name: "Port Harcourt Street",
    city: "Uyo",
  });
  assertEquals(
    hierarchyFeatureMatches({
      feature: wrong,
      localityCandidates: ["Port Harcourt"],
      requiredCountryIso: "NG",
      requireLocality: true,
    }),
    false,
  );
  const city = feature({ name: "Port Harcourt", city: "Port Harcourt" });
  assert(
    hierarchyFeatureMatches({
      feature: city,
      localityCandidates: ["Port Harcourt"],
      requiredCountryIso: "NG",
      requireLocality: true,
      includeFeatureName: true,
    }),
  );
});

Deno.test("issue #1363 rejects mismatched ISO and unsafe coordinates", () => {
  assertEquals(
    hierarchyFeatureMatches({
      feature: feature({
        name: "Lagos",
        city: "Lagos",
        countryCode: "GH",
      }),
      localityCandidates: ["Lagos"],
      requiredCountryIso: "NG",
      requireLocality: true,
    }),
    false,
  );
  assertEquals(
    hierarchyFeatureMatches({
      feature: feature({
        name: "Lagos",
        city: "Lagos",
        coordinates: [0, 0],
      }),
      localityCandidates: ["Lagos"],
      requiredCountryIso: "NG",
      requireLocality: true,
    }),
    false,
  );
});
