// ORCH-1027 [Launch Cities admin control] — check-launch-city tests.
//
// Two layers:
//  (1) BEHAVIORAL — import the pure resolver/predicate exported from index.ts and
//      exercise the EXACT determination logic the handler ships (point-in-bbox,
//      matched-city, none-live, overlap tiebreak). These FAIL on revert (Step-0.5
//      regression proof) because they assert real computed values, not source text.
//  (2) SOURCE-CONTRACT — assert the HTTP-layer guards the behavioral layer can't
//      reach without spinning a server (405 wrong-method, 400 validation body,
//      500 no-leak, verify_jwt=false config). Mirrors the in-repo waitlist-signup
//      test style.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { handler, isInsideBbox, resolveLaunchCity } from "../index.ts";

// --- Fixtures: two live cities, one overlapping pair to test the tiebreak. ----
const LAGOS = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Lagos",
  center_lat: 6.5244,
  center_lng: 3.3792,
  bbox_sw_lat: 6.3,
  bbox_sw_lng: 3.1,
  bbox_ne_lat: 6.7,
  bbox_ne_lng: 3.6,
};
const ABUJA = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Abuja",
  center_lat: 9.0765,
  center_lng: 7.3986,
  bbox_sw_lat: 8.9,
  bbox_sw_lng: 7.2,
  bbox_ne_lat: 9.2,
  bbox_ne_lng: 7.6,
};
// Two overlapping bboxes around the same area; centers differ so nearest-center
// resolves deterministically.
const OVERLAP_A = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  name: "Acity",
  center_lat: 0.1,
  center_lng: 0.1,
  bbox_sw_lat: 0.0,
  bbox_sw_lng: 0.0,
  bbox_ne_lat: 1.0,
  bbox_ne_lng: 1.0,
};
const OVERLAP_B = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  name: "Bcity",
  center_lat: 0.9,
  center_lng: 0.9,
  bbox_sw_lat: 0.5,
  bbox_sw_lng: 0.5,
  bbox_ne_lat: 1.5,
  bbox_ne_lng: 1.5,
};

// === (1) BEHAVIORAL =========================================================

Deno.test("isInsideBbox: inclusive bounds — interior, edge, and outside", () => {
  // interior
  assert(isInsideBbox(6.5244, 3.3792, LAGOS));
  // on the SW corner (inclusive)
  assert(isInsideBbox(LAGOS.bbox_sw_lat, LAGOS.bbox_sw_lng, LAGOS));
  // on the NE corner (inclusive)
  assert(isInsideBbox(LAGOS.bbox_ne_lat, LAGOS.bbox_ne_lng, LAGOS));
  // just outside in lat
  assertEquals(isInsideBbox(6.71, 3.3792, LAGOS), false);
  // just outside in lng
  assertEquals(isInsideBbox(6.5244, 3.61, LAGOS), false);
});

Deno.test("resolveLaunchCity: point inside a live city → inLaunchCity:true, matchedCity set", () => {
  const r = resolveLaunchCity(6.5244, 3.3792, [LAGOS, ABUJA]);
  assertEquals(r.inLaunchCity, true);
  assertEquals(r.matchedCity, {
    id: LAGOS.id,
    name: LAGOS.name,
    center_lat: LAGOS.center_lat,
    center_lng: LAGOS.center_lng,
  });
  // liveCities returns the FULL set, name-asc (Abuja before Lagos), bbox included.
  assertEquals(r.liveCities.map((c) => c.name), ["Abuja", "Lagos"]);
  assertEquals(r.liveCities[0].bbox_sw_lat, ABUJA.bbox_sw_lat);
});

Deno.test("resolveLaunchCity: point outside all live cities → inLaunchCity:false, matchedCity:null, full liveCities", () => {
  const r = resolveLaunchCity(51.5074, -0.1278, [LAGOS, ABUJA]); // London
  assertEquals(r.inLaunchCity, false);
  assertEquals(r.matchedCity, null);
  assertEquals(r.liveCities.length, 2);
});

Deno.test("resolveLaunchCity: no live cities → inLaunchCity:false, matchedCity:null, liveCities:[]", () => {
  const r = resolveLaunchCity(6.5244, 3.3792, []);
  assertEquals(r, { inLaunchCity: false, matchedCity: null, liveCities: [] });
});

Deno.test("resolveLaunchCity: overlapping bboxes → deterministic nearest-center match", () => {
  // Point (0.55,0.55) is inside BOTH OVERLAP_A and OVERLAP_B. Nearest center is
  // A (0.1,0.1)? dist to A center = (0.45²+0.45²); to B (0.9,0.9) = (0.35²+0.35²)
  // → B is nearer. Assert B, and assert it's stable across input ordering.
  const r1 = resolveLaunchCity(0.55, 0.55, [OVERLAP_A, OVERLAP_B]);
  const r2 = resolveLaunchCity(0.55, 0.55, [OVERLAP_B, OVERLAP_A]);
  assertEquals(r1.inLaunchCity, true);
  assertEquals(r1.matchedCity?.id, OVERLAP_B.id);
  assertEquals(r2.matchedCity?.id, OVERLAP_B.id); // order-independent / deterministic
});

Deno.test("resolveLaunchCity: matchedCity exposes ONLY id/name/center (no bbox/PII leak)", () => {
  const r = resolveLaunchCity(6.5244, 3.3792, [LAGOS]);
  assertEquals(Object.keys(r.matchedCity ?? {}).sort(), [
    "center_lat",
    "center_lng",
    "id",
    "name",
  ]);
});

// === (1b) HANDLER-LEVEL (real Request/Response, no DB) =======================

Deno.test("handler: GET → 405 Method not allowed", async () => {
  const res = await handler(
    new Request("http://x/check-launch-city", { method: "GET" }),
  );
  assertEquals(res.status, 405);
  assertEquals(await res.json(), { error: "Method not allowed" });
});

Deno.test("handler: OPTIONS → CORS preflight ok", async () => {
  const res = await handler(
    new Request("http://x/check-launch-city", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handler: invalid body → 400 with exact frozen error", async () => {
  const cases: unknown[] = [
    { lat: "x", lng: 3 }, // non-number
    { lat: 6.5 }, // missing lng
    { lat: 200, lng: 3 }, // lat out of range
    { lat: 6.5, lng: 400 }, // lng out of range
    { lat: Number.NaN, lng: 3 }, // NaN
  ];
  for (const body of cases) {
    const res = await handler(
      new Request("http://x/check-launch-city", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assertEquals(res.status, 400, `body ${JSON.stringify(body)} should be 400`);
    assertEquals(await res.json(), {
      error: "lat and lng are required finite numbers in range",
    });
  }
});

Deno.test("handler: malformed JSON → 400", async () => {
  const res = await handler(
    new Request("http://x/check-launch-city", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    }),
  );
  assertEquals(res.status, 400);
});

// === (2) SOURCE-CONTRACT (HTTP-layer guards) ================================

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("source: wrong method → 405 Method not allowed", () => {
  assertStringIncludes(source, 'req.method !== "POST"');
  assertStringIncludes(source, '{ error: "Method not allowed" }, 405');
});

Deno.test("source: invalid lat/lng → 400 with the exact frozen error body", () => {
  assertStringIncludes(
    source,
    'lat and lng are required finite numbers in range',
  );
  assertStringIncludes(source, "validCoord(lat, -90, 90)");
  assertStringIncludes(source, "validCoord(lng, -180, 180)");
  assertStringIncludes(source, "INVALID_LATLNG_MSG }, 400");
});

Deno.test("source: DB error → 500 Internal error, no internal detail leaked", () => {
  assertStringIncludes(source, '{ error: "Internal error" }, 500');
  // The leaked-detail guard: errors are logged server-side, never returned.
  assert(!source.includes("error: error.message"));
});

Deno.test("source: reads ONLY the live subset, selects only geometry columns (no PII)", () => {
  assertStringIncludes(source, '.eq("is_live_for_consumers", true)');
  assert(
    !/select\([^)]*(email|stripe|contact|admin)/i.test(source),
    "live-city select must not include PII/auth columns",
  );
});

Deno.test("config: check-launch-city is verify_jwt=false (callable pre-auth)", async () => {
  const config = await Deno.readTextFile(
    new URL("../../../config.toml", import.meta.url),
  );
  const idx = config.indexOf("[functions.check-launch-city]");
  assert(idx >= 0, "config.toml must declare [functions.check-launch-city]");
  const block = config.slice(idx, idx + 120);
  assertStringIncludes(block, "verify_jwt = false");
});
