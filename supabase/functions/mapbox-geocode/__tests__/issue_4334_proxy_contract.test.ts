// MINGLA-INVARIANT: I-4334-PROVIDER-ERRORS-ARE-LOUD | issue #4334 | No upstream provider failure becomes an empty suggestion list; the proxy returns a typed error code the client shows as search unavailable.
// MINGLA-INVARIANT: I-4334-RETIRED-IDS-FAIL-LOUD | issue #4334 | A pre-Google place id sent to the proxy returns 410 provider_id_retired without any upstream call.
// #4334 — the address proxy's request and error contract, driven through the
// exported `handler` with a stubbed fetch (no network). Matrix rows R-RETIRE-1,
// R-SRCH-1/3/4/5/6/8, R-PREF-1/4/5/6, R-HIER-1.
//
// Invariants:
//   I-4334-RETIRED-IDS-FAIL-LOUD      a pre-#4334 id → 410, no upstream call.
//   I-4334-PROVIDER-ERRORS-ARE-LOUD   no upstream failure becomes an empty list.
//
// Fails-on-revert (line deleted → test red):
//   C-1  the RETIRED_PLACE_ID_PREFIX branch in index.ts
//   C-2  `includedPrimaryTypes` added to buildSuggestBody
//   C-3  proximityToCenter returning {latitude: parts[0], ...} (no swap)
//   C-4  `.slice(0, MAX_SUGGESTIONS)` in mapAutocompleteRows
//   C-5  the classifyGeocodingStatus error branch (REQUEST_DENIED → 200 [])
//   C-6  the ORCH-1365 fallback in handleSuggestPlaces
//   C-7  the fallback's own error now loud (returning [] instead)
//   C-8  the jwtSubject check / checkRateLimit call
//   C-9  `lookup === "geocoding"` routing

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("GOOGLE_MAPS_API_KEY", "test-google-key-not-real");
Deno.env.delete("SUPABASE_URL"); // recordApiCall becomes log-only
Deno.env.delete("SENTRY_DSN");

import { __resetRateLimitForTests, handler, RATE_LIMIT_MAX } from "../index.ts";

const SUB_JWT = `x.${btoa(JSON.stringify({ sub: "user-1", role: "authenticated" }))}.y`;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

async function call(
  body: Record<string, unknown>,
  respond: (c: Call) => Response,
  auth: string | null = `Bearer ${SUB_JWT}`,
): Promise<{ status: number; json: Record<string, unknown>; calls: Call[] }> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const c: Call = {
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(c);
    return respond(c);
  }) as typeof fetch;
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (auth) headers.authorization = auth;
    const res = await handler(new Request("http://localhost/mapbox-geocode", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const prediction = (placeId: string, main: string, secondary: string) => ({
  placePrediction: {
    placeId,
    text: { text: `${main}, ${secondary}` },
    structuredFormat: { mainText: { text: main }, secondaryText: { text: secondary } },
  },
});

Deno.test("C-1 R-RETIRE-1: a retired pre-#4334 id → 410 provider_id_retired, no upstream call", async () => {
  __resetRateLimitForTests();
  for (const key of ["place_id", "mapbox_id"]) {
    const r = await call({ action: "retrieve", [key]: "dXJuOm1ieHBvaTpkaWRp" }, () => ok({}));
    assertEquals(r.status, 410);
    assertEquals(r.json, { error: "provider_id_retired" });
    assertEquals(r.calls.length, 0);
  }
});

Deno.test("C-2 R-SRCH-1: business suggest is filter-free, English, session-bound, masked", async () => {
  __resetRateLimitForTests();
  const r = await call(
    { action: "suggest", query: "Didi Museum", session_token: "sess-1" },
    () => ok({ suggestions: [prediction("ChIJdidi", "Didi Museum", "Akin Adesola Street, Lagos, Nigeria")] }),
  );
  assertEquals(r.status, 200);
  const c = r.calls[0];
  assertEquals(c.url, "https://places.googleapis.com/v1/places:autocomplete");
  assertEquals(c.method, "POST");
  assertEquals(c.body?.input, "Didi Museum");
  assertEquals(c.body?.sessionToken, "sess-1");
  assertEquals(c.body?.languageCode, "en");
  assertEquals("includedPrimaryTypes" in (c.body ?? {}), false);
  assertEquals("includedRegionCodes" in (c.body ?? {}), false);
  assertEquals(c.headers["X-Goog-Api-Key"], "test-google-key-not-real");
  assert(c.headers["X-Goog-FieldMask"].includes("suggestions.placePrediction.placeId"));
  assertEquals(r.json.suggestions, [{
    placeId: "ChIJdidi",
    displayName: "Didi Museum",
    fullAddress: "Akin Adesola Street, Lagos, Nigeria",
    provider: "google",
  }]);
});

Deno.test("C-3 R-SRCH-3: proximity 'lng,lat' becomes a lat/lng circle (Lagos bias stays in Lagos)", async () => {
  __resetRateLimitForTests();
  const r = await call(
    { action: "suggest", query: "Lagos", proximity: "3.3792,6.5244" },
    () => ok({ suggestions: [] }),
  );
  const bias = r.calls[0].body?.locationBias as { circle: { center: { latitude: number; longitude: number }; radius: number } };
  assertEquals(bias.circle.center, { latitude: 6.5244, longitude: 3.3792 });
  assertEquals(bias.circle.radius, 50000);
  const bad = await call({ action: "suggest", query: "Lagos", proximity: "nonsense" }, () => ok({ suggestions: [] }));
  assertEquals("locationBias" in (bad.calls[0].body ?? {}), false);
});

Deno.test("C-4 R-SRCH-4: at most 5 rows whatever `limit` asks; no limit sent upstream", async () => {
  __resetRateLimitForTests();
  const many = Array.from({ length: 7 }, (_, i) => prediction(`ChIJrow${i}`, `Row ${i}`, "Lagos, Nigeria"));
  const r = await call({ action: "suggest", query: "Lagos", limit: 10 }, () => ok({ suggestions: many }));
  assertEquals((r.json.suggestions as unknown[]).length, 5);
  assertEquals("limit" in (r.calls[0].body ?? {}), false);
});

Deno.test("C-4b empty answer is an honest empty list (HTTP 200)", async () => {
  __resetRateLimitForTests();
  const r = await call({ action: "suggest", query: "zzzzzz" }, () => ok({}));
  assertEquals(r.status, 200);
  assertEquals(r.json.suggestions, []);
});

Deno.test("C-5 R-SRCH-5 error contract: Places and Geocoding failures are coded, never empty", async () => {
  const cases: Array<[Record<string, unknown>, Response, number, string]> = [
    [{ action: "suggest", query: "Lagos" }, new Response("{}", { status: 403 }), 502, "provider_denied"],
    [{ action: "suggest", query: "Lagos" }, new Response("{}", { status: 401 }), 502, "provider_denied"],
    [{ action: "suggest", query: "Lagos" }, new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 }), 503, "provider_quota"],
    [{ action: "suggest", query: "Lagos" }, new Response("{}", { status: 400 }), 400, "provider_invalid_request"],
    [{ action: "suggest", query: "Lagos" }, new Response("{}", { status: 503 }), 502, "provider_unavailable"],
    [{ action: "forward", query: "Lagos" }, ok({ status: "REQUEST_DENIED" }), 502, "provider_denied"],
    [{ action: "forward", query: "Lagos" }, ok({ status: "OVER_QUERY_LIMIT" }), 503, "provider_quota"],
    [{ action: "forward", query: "Lagos" }, ok({ status: "OVER_DAILY_LIMIT" }), 503, "provider_quota"],
    [{ action: "forward", query: "Lagos" }, ok({ status: "INVALID_REQUEST" }), 400, "provider_invalid_request"],
    [{ action: "forward", query: "Lagos" }, ok({ status: "UNKNOWN_ERROR" }), 502, "provider_unavailable"],
    [{ action: "reverse", latitude: 6.5, longitude: 3.4 }, ok({ status: "REQUEST_DENIED" }), 502, "provider_denied"],
    [{ action: "forward", query: "zzzz" }, ok({ status: "ZERO_RESULTS", results: [] }), 500, "no_location"],
    [{ action: "retrieve", place_id: "ChIJgone_place_0001" }, new Response("{}", { status: 404 }), 500, "no_location"],
    [{ action: "retrieve", place_id: "ChIJdenied_000001" }, new Response("{}", { status: 403 }), 502, "provider_denied"],
  ];
  for (const [body, response, status, code] of cases) {
    __resetRateLimitForTests();
    const r = await call(body, () => response.clone());
    assertEquals(r.status, status, `${JSON.stringify(body)} → ${status}`);
    assertEquals(r.json.error, code, JSON.stringify(body));
  }
});

Deno.test("C-5b R-SRCH-8: a thrown fetch / timeout → <action>_exception 502", async () => {
  for (const [body, code] of [
    [{ action: "suggest", query: "Lagos" }, "suggest_exception"],
    [{ action: "retrieve", place_id: "ChIJtimeout_0001" }, "retrieve_exception"],
    [{ action: "reverse", latitude: 6.5, longitude: 3.4 }, "reverse_exception"],
    [{ action: "forward", query: "Lagos" }, "forward_exception"],
  ] as Array<[Record<string, unknown>, string]>) {
    __resetRateLimitForTests();
    const r = await call(body, () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    assertEquals(r.status, 502);
    assertEquals(r.json.error, code);
  }
});

Deno.test("C-6 R-PREF-5: 'lekki nigeria' strips the country into includedRegionCodes, one call", async () => {
  __resetRateLimitForTests();
  const r = await call(
    { action: "suggest_places", query: "lekki nigeria", session_token: "s" },
    () => ok({ suggestions: [prediction("ChIJlekki", "Lekki", "Lagos, Nigeria")] }),
  );
  assertEquals(r.calls.length, 1);
  assertEquals(r.calls[0].body?.input, "lekki");
  assertEquals(r.calls[0].body?.includedRegionCodes, ["ng"]);
  assertEquals(r.calls[0].body?.includedPrimaryTypes, [
    "locality", "sublocality", "neighborhood", "administrative_area_level_1", "administrative_area_level_2",
  ]);
  assertEquals((r.json.suggestions as Array<{ displayName: string }>)[0].displayName, "Lekki");
});

Deno.test("C-6b R-PREF-4: 'atlanta georgia' empty in Georgia-the-country → one retry, full query, same session", async () => {
  __resetRateLimitForTests();
  const r = await call(
    { action: "suggest_places", query: "atlanta georgia", session_token: "sess-ga" },
    (c) => c.body?.includedRegionCodes
      ? ok({ suggestions: [] })
      : ok({ suggestions: [prediction("ChIJatl", "Atlanta", "GA, USA")] }),
  );
  assertEquals(r.calls.length, 2);
  assertEquals(r.calls[0].body?.includedRegionCodes, ["ge"]);
  assertEquals(r.calls[1].body?.input, "atlanta georgia");
  assertEquals("includedRegionCodes" in (r.calls[1].body ?? {}), false);
  assertEquals(r.calls[1].body?.sessionToken, "sess-ga");
  assertEquals((r.json.suggestions as Array<{ fullAddress: string }>)[0].fullAddress, "GA, USA");
});

Deno.test("C-7 a failing fallback is loud (no longer swallowed to an empty list)", async () => {
  __resetRateLimitForTests();
  const r = await call(
    { action: "suggest_places", query: "atlanta georgia" },
    (c) => c.body?.includedRegionCodes ? ok({ suggestions: [] }) : new Response("{}", { status: 403 }),
  );
  assertEquals(r.status, 502);
  assertEquals(r.json.error, "provider_denied");
});

Deno.test("C-8 auth and per-user rate limit (F-8)", async () => {
  __resetRateLimitForTests();
  const noAuth = await call({ action: "suggest", query: "Lagos" }, () => ok({ suggestions: [] }), null);
  assertEquals(noAuth.status, 401);
  assertEquals(noAuth.json.error, "auth_required");
  const anonKey = await call({ action: "suggest", query: "Lagos" }, () => ok({ suggestions: [] }),
    `Bearer x.${btoa(JSON.stringify({ role: "anon" }))}.y`);
  assertEquals(anonKey.status, 401);
  let last = 0;
  for (let i = 0; i <= RATE_LIMIT_MAX; i += 1) {
    last = (await call({ action: "suggest", query: "Lagos" }, () => ok({ suggestions: [] }))).status;
  }
  assertEquals(last, 429);
});

Deno.test("C-9 retrieve: Host picks use Place Details in the session; Explorer anchors use Geocoding by place_id", async () => {
  __resetRateLimitForTests();
  const place = {
    id: "ChIJdidi",
    formattedAddress: "175 Akin Adesola St, Victoria Island, Lagos 106104, Lagos, Nigeria",
    addressComponents: [
      { longText: "Lagos", shortText: "Lagos", types: ["locality", "political"] },
      { longText: "Lagos", shortText: "LA", types: ["administrative_area_level_1", "political"] },
      { longText: "Nigeria", shortText: "NG", types: ["country", "political"] },
    ],
    location: { latitude: 6.4325, longitude: 3.4237 },
    types: ["museum", "point_of_interest", "establishment"],
  };
  const host = await call({ action: "retrieve", place_id: "ChIJdidi", session_token: "sess-9" }, () => ok(place));
  assertEquals(host.status, 200);
  assert(host.calls[0].url.startsWith("https://places.googleapis.com/v1/places/ChIJdidi?sessionToken=sess-9&languageCode=en"));
  assertEquals(host.calls[0].headers["X-Goog-FieldMask"], "id,formattedAddress,addressComponents,location,types,viewport");
  const d = host.json.details as Record<string, unknown>;
  assertEquals(d.featureType, "poi");
  assertEquals(d.city, "Lagos");
  assertEquals(d.provider, "google");

  __resetRateLimitForTests();
  const explorer = await call(
    { action: "retrieve", place_id: "ChIJlekki", lookup: "geocoding" },
    () => ok({ status: "OK", results: [{
      place_id: "ChIJlekki",
      formatted_address: "Lekki, Lagos, Nigeria",
      address_components: [
        { long_name: "Lekki", short_name: "Lekki", types: ["locality", "political"] },
        { long_name: "Lagos", short_name: "LA", types: ["administrative_area_level_1", "political"] },
        { long_name: "Nigeria", short_name: "NG", types: ["country", "political"] },
      ],
      geometry: { location: { lat: 6.4698, lng: 3.5852 } },
      types: ["locality", "political"],
    }] }),
  );
  assert(explorer.calls[0].url.startsWith("https://maps.googleapis.com/maps/api/geocode/json?place_id=ChIJlekki"));
  assert(explorer.calls[0].url.includes("language=en"));
  const e = explorer.json.details as Record<string, unknown>;
  assertEquals(e.placeId, "ChIJlekki");
  assertEquals(e.city, "Lagos");
  assertEquals(e.regionCode, "LA");
});

Deno.test("C-10 R-PREF-4/A3: forward returns coordinates AND the placeId (Geocoding, English)", async () => {
  __resetRateLimitForTests();
  const r = await call({ action: "forward", query: "atlanta georgia" }, () => ok({ status: "OK", results: [{
    place_id: "ChIJatlanta",
    formatted_address: "Atlanta, GA, USA",
    address_components: [
      { long_name: "Atlanta", short_name: "Atlanta", types: ["locality", "political"] },
      { long_name: "Georgia", short_name: "GA", types: ["administrative_area_level_1", "political"] },
      { long_name: "United States", short_name: "US", types: ["country", "political"] },
    ],
    geometry: { location: { lat: 33.749, lng: -84.388 } },
    types: ["locality", "political"],
  }] }));
  assert(r.calls[0].url.includes("address=atlanta+georgia"));
  assert(r.calls[0].url.includes("language=en"));
  const d = r.json.details as Record<string, unknown>;
  assertEquals(d.placeId, "ChIJatlanta");
  assertEquals(d.countryCode, "US");
  assertEquals(d.regionCode, "GA");
});

Deno.test("C-11 reverse skips plus-code-only results and returns the first city-level one (R-LOC-1)", async () => {
  __resetRateLimitForTests();
  const r = await call({ action: "reverse", latitude: 6.4327, longitude: 3.4234 }, () => ok({ status: "OK", results: [
    { place_id: "pc", formatted_address: "CCMF+2F Lagos", types: ["plus_code"],
      address_components: [{ long_name: "CCMF+2F", short_name: "CCMF+2F", types: ["plus_code"] }],
      geometry: { location: { lat: 6.4327, lng: 3.4234 } } },
    { place_id: "ChIJvi", formatted_address: "Victoria Island, Lagos, Nigeria", types: ["neighborhood", "political"],
      address_components: [
        { long_name: "Victoria Island", short_name: "Victoria Island", types: ["neighborhood", "political"] },
        { long_name: "Lagos", short_name: "Lagos", types: ["locality", "political"] },
        { long_name: "Lagos", short_name: "LA", types: ["administrative_area_level_1", "political"] },
        { long_name: "Nigeria", short_name: "NG", types: ["country", "political"] },
      ],
      geometry: { location: { lat: 6.43, lng: 3.42 } } },
  ] }));
  assert(r.calls[0].url.includes("latlng=6.4327%2C3.4234"));
  const d = r.json.details as Record<string, unknown>;
  assertEquals(d.placeId, "ChIJvi");
  assertEquals(d.countryCode, "NG");
  assertEquals(d.city, "Lagos");
});

Deno.test("C-12 key missing → 500 provider_key_missing (loud)", async () => {
  __resetRateLimitForTests();
  Deno.env.delete("GOOGLE_MAPS_API_KEY");
  try {
    const r = await call({ action: "suggest", query: "Lagos" }, () => ok({}));
    assertEquals(r.status, 500);
    assertEquals(r.json.error, "provider_key_missing");
  } finally {
    Deno.env.set("GOOGLE_MAPS_API_KEY", "test-google-key-not-real");
  }
});

// #4334 F-6 — Google answers a bad or revoked key on Places API (New) with HTTP
// 400 API_KEY_INVALID. That is a denied key (502 provider_denied), not a bad
// request. Fails on revert: classifyPlacesFailure → classifyPlacesHttpStatus.
const KEY_INVALID_BODY = JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }] } });
Deno.test("C-13 F-6: 400 API_KEY_INVALID on suggest, suggest_places and retrieve → 502 provider_denied", async () => {
  for (const body of [
    { action: "suggest", query: "Lagos" },
    { action: "suggest_places", query: "Lagos" },
    { action: "retrieve", place_id: "ChIJdidiMuseum00001", session_token: "s-1" },
  ]) {
    __resetRateLimitForTests();
    const r = await call(body, () => new Response(KEY_INVALID_BODY, { status: 400, headers: { "content-type": "application/json" } }));
    assertEquals([r.status, r.json.error], [502, "provider_denied"], JSON.stringify(body));
  }
  // a genuine bad request stays provider_invalid_request
  __resetRateLimitForTests();
  const bad = await call({ action: "suggest", query: "Lagos" }, () =>
    new Response(JSON.stringify({ error: { code: 400, message: "Invalid value", status: "INVALID_ARGUMENT" } }), { status: 400 }));
  assertEquals([bad.status, bad.json.error], [400, "provider_invalid_request"]);
});
