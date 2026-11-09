// #4334 — server forward geocode on the Google Geocoding API (_shared/placesGeocode.ts).
// Callers: personHeroCards (paired view), ad-plan, admin-ad-create-campaign.
// Matrix R-ADS-1. Successor of the META-ORCH-1060 helper test.
//
// The three-way result is kept: found / not_found (cached) / failed (not cached).
// A Geocoding body with HTTP 200 and a refusal status is FAILED, never
// "not found" (history trap H1 / #338).
//
// Fails-on-revert: treat every non-OK status as ZERO_RESULTS (drop the
// classifyGeocodingStatus error branch) → P-3 red.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.delete("SUPABASE_URL");
import {
  __clearForwardGeocodeCacheForTests,
  classifyGeocodingStatus,
  classifyPlacesHttpStatus,
  forwardGeocodeLookup,
  forwardGeocodeText,
} from "../placesGeocode.ts";

async function withFetch(impl: (url: string) => Response, run: (urls: string[]) => Promise<void>) {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string) => {
    urls.push(String(input));
    return Promise.resolve(impl(String(input)));
  }) as typeof fetch;
  try {
    await run(urls);
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("P-1 found: Geocoding lat/lng by name → {lat,lng}; English; cached", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("GOOGLE_MAPS_API_KEY", "k");
  await withFetch(
    () => new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 6.5244, lng: 3.3792 } } }] })),
    async (urls) => {
      assertEquals(await forwardGeocodeText("Lagos, NG"), { lat: 6.5244, lng: 3.3792 });
      assertEquals(await forwardGeocodeText("lagos, ng"), { lat: 6.5244, lng: 3.3792 });
      assertEquals(urls.length, 1);
      assertEquals(urls[0].startsWith("https://maps.googleapis.com/maps/api/geocode/json?address=Lagos%2C%20NG&language=en&key="), true);
    },
  );
});

Deno.test("P-2 ZERO_RESULTS → not_found and cached", async () => {
  __clearForwardGeocodeCacheForTests();
  Deno.env.set("GOOGLE_MAPS_API_KEY", "k");
  await withFetch(() => new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] })), async (urls) => {
    assertEquals(await forwardGeocodeLookup("Atlantis"), { status: "not_found" });
    assertEquals(await forwardGeocodeLookup("Atlantis"), { status: "not_found" });
    assertEquals(urls.length, 1);
  });
});

Deno.test("P-3 a refusal inside HTTP 200, a non-200, a throw and a missing key are all 'failed', never cached", async () => {
  for (const status of ["REQUEST_DENIED", "OVER_QUERY_LIMIT", "OVER_DAILY_LIMIT", "INVALID_REQUEST", "UNKNOWN_ERROR"]) {
    __clearForwardGeocodeCacheForTests();
    Deno.env.set("GOOGLE_MAPS_API_KEY", "k");
    await withFetch(() => new Response(JSON.stringify({ status })), async (urls) => {
      assertEquals(await forwardGeocodeLookup("Lagos"), { status: "failed" }, status);
      assertEquals(await forwardGeocodeLookup("Lagos"), { status: "failed" }, status);
      assertEquals(urls.length, 2, `${status} must not be cached`);
    });
  }
  __clearForwardGeocodeCacheForTests();
  await withFetch(() => new Response("x", { status: 503 }), async () => {
    assertEquals(await forwardGeocodeLookup("Lagos"), { status: "failed" });
  });
  await withFetch(() => {
    throw new TypeError("network");
  }, async () => {
    assertEquals(await forwardGeocodeLookup("Lagos"), { status: "failed" });
  });
  Deno.env.delete("GOOGLE_MAPS_API_KEY");
  assertEquals(await forwardGeocodeLookup("Lagos"), { status: "failed" });
});

Deno.test("P-4 empty text → not_found, no fetch", async () => {
  await withFetch(() => new Response("{}"), async (urls) => {
    assertEquals(await forwardGeocodeLookup("  "), { status: "not_found" });
    assertEquals(await forwardGeocodeText(null), null);
    assertEquals(urls.length, 0);
  });
});

Deno.test("P-5 error classification tables", () => {
  assertEquals(classifyPlacesHttpStatus(403), { code: "provider_denied", httpStatus: 502 });
  assertEquals(classifyPlacesHttpStatus(401), { code: "provider_denied", httpStatus: 502 });
  assertEquals(classifyPlacesHttpStatus(429), { code: "provider_quota", httpStatus: 503 });
  assertEquals(classifyPlacesHttpStatus(400), { code: "provider_invalid_request", httpStatus: 400 });
  assertEquals(classifyPlacesHttpStatus(500), { code: "provider_unavailable", httpStatus: 502 });
  assertEquals(classifyGeocodingStatus("OK"), { kind: "ok" });
  assertEquals(classifyGeocodingStatus("ZERO_RESULTS"), { kind: "zero_results" });
  assertEquals(classifyGeocodingStatus(undefined), { kind: "error", error: { code: "provider_unavailable", httpStatus: 502 } });
});
