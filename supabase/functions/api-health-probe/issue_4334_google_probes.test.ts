// #4334 §8 — the four Google probes test the endpoints we actually call, and
// every verdict is a BODY verdict (matrix R-HEALTH-2).
// Invariant I-4334-GOOGLE-PROBES-BODY-VERDICT.
//
// Fails-on-revert:
//   B-1 any Google probe's status expression changed away from bodyVerdict(...)
//   B-2 googleGeocodingProbeOk accepting a 200 without status OK
//   B-3 googleStaticProbeOk ignoring content-type (error image passes)
//   B-5 the retired map vendor's probe or tile coming back

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bodyVerdict,
  CLASS_B_DEPLETION,
  GOOGLE_PROBE_URLS,
  googleAutocompleteProbeOk,
  googleGeocodingProbeOk,
  googlePlaceDetailsProbeOk,
  googleStaticProbeOk,
  matchClassBDepletion,
  STATUS_PAGE_URLS,
} from "./logic.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

function probeBody(name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  assert(start > -1, `${name} missing`);
  const end = src.indexOf("\nasync function ", start + 10);
  return src.slice(start, end);
}

Deno.test("B-1 every Google probe reports status: bodyVerdict(ok, res.status)", () => {
  for (const name of ["probeGooglePlaces", "probeGooglePlaceDetails", "probeGoogleGeocoding", "probeGoogleStaticMaps"]) {
    const body = probeBody(name);
    assert(body.includes("status: bodyVerdict(ok, res.status)"), `${name} must use bodyVerdict`);
    assert(!body.includes("httpToStatus"), `${name} must not fall back to httpToStatus`);
  }
  for (const key of ["google_places", "google_place_details", "google_geocoding", "google_static_maps"]) {
    assert(src.includes(`["${key}", probe`), `${key} not wired into Layer B`);
  }
});

Deno.test("B-2 a 200 that carries REQUEST_DENIED is down, never healthy", () => {
  const ok = googleGeocodingProbeOk(200, { status: "REQUEST_DENIED" });
  assertEquals(ok, false);
  assertEquals(bodyVerdict(ok, 200), "down");
  assertEquals(googleGeocodingProbeOk(200, { status: "OK" }), true);
  assertEquals(googleAutocompleteProbeOk(200, { suggestions: [] }), false);
  assertEquals(googleAutocompleteProbeOk(200, { suggestions: [{}] }), true);
  assertEquals(googleAutocompleteProbeOk(403, { error: { status: "PERMISSION_DENIED" } }), false);
  assertEquals(googlePlaceDetailsProbeOk(200, { location: { latitude: 37.4, longitude: -122.08 } }), true);
  assertEquals(googlePlaceDetailsProbeOk(200, {}), false);
});

Deno.test("B-3 Static Maps: Google's 403 error image and a 200 non-image are down (red before ops step 1)", () => {
  assertEquals(bodyVerdict(googleStaticProbeOk(403, "image/png"), 403), "down");
  assertEquals(bodyVerdict(googleStaticProbeOk(200, "text/html"), 200), "down");
  assertEquals(googleStaticProbeOk(200, "image/png"), true);
});

Deno.test("B-4 probe URLs are the exact endpoints the product calls", () => {
  assertEquals(GOOGLE_PROBE_URLS.autocomplete, "https://places.googleapis.com/v1/places:autocomplete");
  assert(GOOGLE_PROBE_URLS.placeDetails.startsWith("https://places.googleapis.com/v1/places/"));
  assert(GOOGLE_PROBE_URLS.geocoding.startsWith("https://maps.googleapis.com/maps/api/geocode/json?"));
  assert(GOOGLE_PROBE_URLS.staticMap.startsWith("https://maps.googleapis.com/maps/api/staticmap?"));
  assert(!src.includes("place/textsearch/json"), "the legacy Places probe is gone");
});

Deno.test("B-5 no retired map-vendor probe, tile, feed or matcher remains", () => {
  assert(!/probe[A-Z][a-z]+box\b/.test(src));
  assertEquals(Object.keys(STATUS_PAGE_URLS).some((k) => k.includes("box")), false);
  assertEquals(Object.keys(CLASS_B_DEPLETION).some((k) => k.includes("box")), false);
});

Deno.test("B-6 reactive matchers: a burst of user-path refusals flips the Google tiles", () => {
  const row = (http: number, code: string) => ({ http_status: http, error_code: code, error_text: null, observed_at: "2026-11-08T00:00:00Z" });
  // deno-lint-ignore no-explicit-any
  const m = (k: string, r: unknown[]) => matchClassBDepletion(CLASS_B_DEPLETION[k] as any, r as any);
  assertEquals(m("google_geocoding", [row(200, "provider_denied")]).depleted, true);
  assertEquals(m("google_geocoding", [row(200, "provider_quota")]).depleted, true);
  assertEquals(m("google_place_details", [row(403, "provider_denied")]).depleted, true);
  assertEquals(m("google_static_maps", [row(403, "map_unavailable")]).depleted, true);
  assertEquals(m("google_place_refresh", [row(429, "provider_quota")]).depleted, true);
  assertEquals(m("google_places", [row(403, "provider_denied")]).depleted, true);
  assertEquals(m("google_places", [row(500, "provider_unavailable")]).depleted, false);
});
