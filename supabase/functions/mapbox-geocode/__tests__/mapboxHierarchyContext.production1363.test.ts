import {
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  featureToHierarchyDetails,
  hierarchyQueryContainsName,
  savedHierarchyContextForQuery,
  type MapboxFeature,
} from "../index.ts";

Deno.test("issue #1363 production: unrelated nonsense cannot inherit saved city context", () => {
  assertEquals(
    hierarchyQueryContainsName(
      "zzzzzz-not-a-place-998877",
      "Port Harcourt",
    ),
    false,
  );
  assertEquals(
    hierarchyQueryContainsName(
      "1 Fortune Avenue, Port Harcourt",
      "Port Harcourt",
    ),
    true,
  );
  assertEquals(
    savedHierarchyContextForQuery("zzzzzz-not-a-place-998877", {
      city: "Port Harcourt",
      country_code: "NG",
    }),
    { city: null, countryIso: null },
  );
});

Deno.test("issue #1363 production: top-level Lagos place supplies its own city", () => {
  const feature: MapboxFeature = {
    geometry: { coordinates: [3.38975, 6.453928] },
    properties: {
      name: "Lagos",
      feature_type: "place",
      context: {
        region: { name: "Lagos" },
        country: { name: "Nigeria", country_code: "NG" },
      },
    },
  };
  assertEquals(featureToHierarchyDetails(feature, "place"), {
    lat: 6.453928,
    lng: 3.38975,
    city: "Lagos",
    region: "Lagos",
    countryCode: "NG",
  });
});
