// ORCH-426 G1 — discover response cache key stability.

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildDiscoverCacheKey } from "../_cache.ts";

Deno.test("buildDiscoverCacheKey is stable for identical params", () => {
  const params = {
    cityName: "Austin",
    stateCode: "TX",
    countryCode: "US",
    page: 1,
    size: 20,
    partyTypeSlugs: [] as string[],
    vibeTagSlugs: [] as string[],
    musicGenreSlugs: [] as string[],
    dateWindowUtc: null,
    timezone: "America/Chicago",
  };
  const a = buildDiscoverCacheKey(params);
  const b = buildDiscoverCacheKey({ ...params });
  assertEquals(a, b);
});

Deno.test("buildDiscoverCacheKey differs by page", () => {
  const base = {
    cityName: "London",
    page: 1,
    size: 20,
    partyTypeSlugs: [] as string[],
    vibeTagSlugs: [] as string[],
    musicGenreSlugs: [] as string[],
    dateWindowUtc: null,
    timezone: "UTC",
  };
  assertEquals(
    buildDiscoverCacheKey(base),
    buildDiscoverCacheKey({ ...base, page: 1 }),
  );
  const page2 = buildDiscoverCacheKey({ ...base, page: 2 });
  const page1 = buildDiscoverCacheKey(base);
  if (page1 === page2) {
    throw new Error("expected different cache keys for different pages");
  }
});
