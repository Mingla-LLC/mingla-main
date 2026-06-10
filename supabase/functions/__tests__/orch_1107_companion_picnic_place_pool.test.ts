// ORCH-1107 — companion-stops + picnic-grocery off live Google Places onto the
// scored, servable place_pool via the `query_servable_places_by_signal` RPC.
//
// Happy-path regression (implementor-owned). The tester adds the adversarial
// angle separately. These assertions FAIL ON REVERT of the core change:
//   * the RPC params are built correctly (signal id + filter_min + radius from
//     maxDistance + lat/lng) — proves the new RPC source, not Google;
//   * a returned row maps to the existing client response shape with imageUrl
//     drawn from stored_photo_urls[0] (the Unsplash placeholder is gone);
//   * NEITHER edge function references Google (no googleapis.com call, no
//     GOOGLE_MAPS_API_KEY read, no Unsplash placeholder), and the ONLY data
//     source is query_servable_places_by_signal.
//
// The handler-level helpers (buildRpcParams, mapServableRow…, handleRequest) are
// EXPORTED from each function module and exercised directly. The module reads env
// + may call serve() at load, so we set dummy env first and DYNAMICALLY import it
// (see HERMETIC SETUP below) rather than statically — keeping the suite runnable
// with zero ambient env.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// HERMETIC SETUP (ORCH-1107 rework). Both edge modules read SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY and call createClient() at module load — createClient
// THROWS "supabaseUrl is required" when SUPABASE_URL is unset. Static ES imports
// are hoisted above any in-body code, so we cannot set env before a static import
// runs. Instead we set the dummy creds FIRST, then DYNAMICALLY import the SUT
// modules so construction happens after the env exists. The dummy creds only
// satisfy createClient() construction — no network call is made (the tests
// exercise the exported pure helpers + the 400 validation branch only). This
// makes the test pass on a clean `deno test --allow-all <path>` with ZERO ambient
// env (no shell exports required).
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
// Suppress the listening socket each module starts at load (both guard serve()
// behind this flag); without it the dynamic import would bind a server and leave
// a dangling resource, failing the runner on a clean no-env invocation.
Deno.env.set("ORCH_TEST_NO_SERVE", "1");

const {
  buildCompanionRpcParams,
  handleRequest: handleCompanion,
  mapServableRowToCompanionStop,
} = await import("../get-companion-stops/index.ts");
const {
  buildGroceryRpcParams,
  handleRequest: handleGrocery,
  mapServableRowToGroceryStore,
} = await import("../get-picnic-grocery/index.ts");

// Let any construction-time timer the Supabase client schedules during the
// dynamic imports above settle BEFORE the first test registers; otherwise Deno's
// leak sanitizer attributes that timer's completion to the first test and fails
// it. A short real-timer wait drains it deterministically.
await new Promise<void>((resolve) => setTimeout(resolve, 50));

// A representative servable place_pool row, shaped like the RPC return.
const SERVABLE_ROW = {
  place_id: "11111111-1111-1111-1111-111111111111",
  google_place_id: "ChIJ_companion_abc",
  name: "Corner Bakery",
  address: "12 Stroll Lane",
  lat: 40.7128,
  lng: -74.006,
  rating: 4.6,
  review_count: 233,
  price_level: 1,
  opening_hours: null,
  website: "https://corner.example",
  stored_photo_urls: [
    "https://cdn.example/real-photo-1.jpg",
    "https://cdn.example/real-photo-2.jpg",
  ],
  types: ["bakery", "cafe"],
  primary_type: "bakery",
  signal_score: 187,
};

const ANCHOR = { lat: 40.713, lng: -74.0061 };

// ── Companion RPC params ─────────────────────────────────────────────────────
Deno.test("CP-01 companion RPC params: casual_food signal, filter_min 120, radius from maxDistance", () => {
  const params = buildCompanionRpcParams(ANCHOR, 500);
  assertEquals(params.p_signal_id, "casual_food");
  assertEquals(params.p_filter_min, 120);
  assertEquals(params.p_radius_m, 500);
  assertEquals(params.p_lat, ANCHOR.lat);
  assertEquals(params.p_lng, ANCHOR.lng);
  assert(params.p_limit >= 1, "limit must over-fetch (we pick top 1)");
});

Deno.test("CP-02 companion RPC radius tracks a non-default maxDistance", () => {
  const params = buildCompanionRpcParams(ANCHOR, 900);
  assertEquals(params.p_radius_m, 900);
});

// ── Companion row → response shape ───────────────────────────────────────────
Deno.test("CP-03 companion row maps to client shape with imageUrl from stored_photo_urls[0]", () => {
  const stop = mapServableRowToCompanionStop(SERVABLE_ROW, ANCHOR);
  assertEquals(stop.id, SERVABLE_ROW.place_id);
  assertEquals(stop.name, "Corner Bakery");
  assertEquals(stop.location, { lat: 40.7128, lng: -74.006 });
  assertEquals(stop.address, "12 Stroll Lane");
  assertEquals(stop.rating, 4.6);
  assertEquals(stop.reviewCount, 233);
  assertEquals(stop.placeId, "ChIJ_companion_abc");
  assertEquals(stop.type, "bakery");
  // The load-bearing assertion: real photo, NOT the killed Unsplash placeholder.
  assertEquals(stop.imageUrl, "https://cdn.example/real-photo-1.jpg");
  assert(
    !String(stop.imageUrl).includes("unsplash"),
    "imageUrl must NOT be an Unsplash placeholder",
  );
});

Deno.test("CP-04 companion row with no stored photos yields null imageUrl (no fabricated placeholder)", () => {
  const stop = mapServableRowToCompanionStop(
    { ...SERVABLE_ROW, stored_photo_urls: [] },
    ANCHOR,
  );
  assertEquals(stop.imageUrl, null);
});

// ── Grocery RPC params ───────────────────────────────────────────────────────
Deno.test("GR-01 grocery RPC params: groceries signal, filter_min 120, radius from maxDistance", () => {
  const params = buildGroceryRpcParams(ANCHOR, 2000);
  assertEquals(params.p_signal_id, "groceries");
  assertEquals(params.p_filter_min, 120);
  assertEquals(params.p_radius_m, 2000);
  assertEquals(params.p_lat, ANCHOR.lat);
  assertEquals(params.p_lng, ANCHOR.lng);
  assert(params.p_limit >= 1, "limit must over-fetch");
});

// ── Grocery row → response shape ─────────────────────────────────────────────
Deno.test("GR-02 grocery row maps to client shape with imageUrl from stored_photo_urls[0] + distance", () => {
  const store = mapServableRowToGroceryStore(SERVABLE_ROW, ANCHOR);
  assertEquals(store.id, SERVABLE_ROW.place_id);
  assertEquals(store.name, "Corner Bakery");
  assertEquals(store.address, "12 Stroll Lane");
  assertEquals(store.placeId, "ChIJ_companion_abc");
  assertEquals(store.type, "bakery");
  assertEquals(store.imageUrl, "https://cdn.example/real-photo-1.jpg");
  assert(
    !String(store.imageUrl).includes("unsplash"),
    "imageUrl must NOT be an Unsplash placeholder",
  );
  // picnic response shape preserves types[] + a numeric distance.
  assertEquals(store.types, ["bakery", "cafe"]);
  assert(typeof store.distance === "number" && store.distance >= 0);
});

// ── Handler wiring (no RPC / no Google needed) ───────────────────────────────
Deno.test("HW-01 companion handler rejects a missing anchor location with 400", async () => {
  const res = await handleCompanion(
    new Request("http://x", { method: "POST", body: JSON.stringify({}) }),
  );
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, "Anchor location is required");
});

Deno.test("HW-02 picnic handler rejects a missing picnic location with 400", async () => {
  const res = await handleGrocery(
    new Request("http://x", { method: "POST", body: JSON.stringify({}) }),
  );
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, "Picnic location is required");
});

// ── No-Google + graceful-empty source guards (fail-on-revert anchor) ─────────
const COMPANION_SRC = await Deno.readTextFile(
  "supabase/functions/get-companion-stops/index.ts",
);
const GROCERY_SRC = await Deno.readTextFile(
  "supabase/functions/get-picnic-grocery/index.ts",
);

for (const [name, src] of [
  ["companion-stops", COMPANION_SRC],
  ["picnic-grocery", GROCERY_SRC],
] as const) {
  Deno.test(`NG-01 ${name} has ZERO Google references`, () => {
    assert(!src.includes("GOOGLE_MAPS_API_KEY"), `${name} must not read GOOGLE_MAPS_API_KEY`);
    assert(!src.includes("googleapis"), `${name} must not call googleapis`);
    assert(!src.includes("batchSearchPlaces"), `${name} must not import batchSearchPlaces`);
    assert(!src.includes("unsplash"), `${name} must not embed an Unsplash placeholder`);
    assert(
      !/Google Maps API key is not configured/.test(src),
      `${name} must not retain the Google API-key 500 guard`,
    );
  });

  Deno.test(`NG-02 ${name} sources only query_servable_places_by_signal`, () => {
    assert(
      src.includes("query_servable_places_by_signal"),
      `${name} must call query_servable_places_by_signal`,
    );
  });

  Deno.test(`NG-03 ${name} returns a graceful-empty body when the RPC yields no rows`, () => {
    const emptyKey = name === "companion-stops" ? "strollData: null" : "picnicData: null";
    assert(
      src.includes(emptyKey),
      `${name} must return ${emptyKey} (graceful empty, no Google fallback)`,
    );
  });
}
