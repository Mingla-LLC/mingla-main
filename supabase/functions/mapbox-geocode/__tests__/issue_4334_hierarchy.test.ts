// #4334 — forward_hierarchy (#1363) on the Geocoding API (matrix R-HIER-1/2).
// The place → city → country ladder and "saved context only when the query
// names it" are unchanged; only the transport is Google.
//
// Fails-on-revert:
//   H-2 drop the HIERARCHY_CITY_TYPES filter in step 2 → a street result is
//       accepted as the city, red.
//   H-3 drop `components=country:` → the country step query changes, red.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("GOOGLE_MAPS_API_KEY", "test-google-key-not-real");
Deno.env.delete("SUPABASE_URL");
Deno.env.delete("SENTRY_DSN");

import { __resetRateLimitForTests, handler } from "../index.ts";
import { deriveHierarchyLocalities, savedHierarchyContextForQuery } from "../google.ts";

const JWT = `x.${btoa(JSON.stringify({ sub: "host-1" }))}.y`;

const result = (
  types: string[],
  comps: Array<[string, string, string]>,
  lat: number,
  lng: number,
) => ({
  place_id: `ChIJ${types[0]}_${lat}`,
  formatted_address: comps.map((c) => c[0]).join(", "),
  types,
  address_components: comps.map(([l, s, t]) => ({ long_name: l, short_name: s, types: [t, "political"] })),
  geometry: { location: { lat, lng } },
});

const LEKKI_LOCALITY = result(["locality", "political"], [
  ["Lekki", "Lekki", "locality"],
  ["Lagos", "LA", "administrative_area_level_1"],
  ["Nigeria", "NG", "country"],
], 6.4698, 3.5852);

async function run(query: string, savedContext: unknown, answer: (url: string) => unknown) {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string) => {
    urls.push(input);
    return Promise.resolve(new Response(JSON.stringify(answer(input)), { status: 200 }));
  }) as typeof fetch;
  try {
    __resetRateLimitForTests();
    const res = await handler(new Request("http://localhost", {
      method: "POST",
      headers: { authorization: `Bearer ${JWT}` },
      body: JSON.stringify({ action: "forward_hierarchy", query, saved_context: savedContext }),
    }));
    return { json: await res.json(), urls };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("H-1 place level: the full query's first result names a user-supplied locality", async () => {
  const r = await run("12 Admiralty Way, Lekki, Nigeria", null, () => ({
    status: "OK",
    results: [result(["route"], [
      ["Admiralty Way", "Admiralty Way", "route"],
      ["Lekki", "Lekki", "locality"],
      ["Lagos", "LA", "administrative_area_level_1"],
      ["Nigeria", "NG", "country"],
    ], 6.4476, 3.4676)],
  }));
  assertEquals(r.json.matchLevel, "place");
  assertEquals(r.json.details.city, "Lagos");
  assertEquals(r.json.details.countryCode, "NG");
  assert(r.urls[0].includes("components=country%3ANG"));
});

Deno.test("H-2 city level: a non-matching place falls back to the locality, street results refused", async () => {
  const r = await run("Some Unknown Venue, Lekki", null, (url) => {
    if (url.includes("address=Some+Unknown+Venue")) {
      return { status: "OK", results: [result(["route"], [["Elsewhere Rd", "Elsewhere Rd", "route"], ["Ibadan", "Ibadan", "locality"], ["Nigeria", "NG", "country"]], 7.4, 3.9)] };
    }
    return { status: "OK", results: [
      result(["route"], [["Lekki Road", "Lekki Road", "route"], ["Lekki", "Lekki", "locality"], ["Nigeria", "NG", "country"]], 6.5, 3.5),
      LEKKI_LOCALITY,
    ] };
  });
  assertEquals(r.json.matchLevel, "city");
  assertEquals(r.json.matchedQuery, "Lekki");
  assertEquals(r.json.details.lat, 6.4698);
});

Deno.test("H-3 country level: an explicit country with nothing else → country centroid, no city", async () => {
  const r = await run("my place nigeria", null, (url) => {
    if (url.includes("address=")) return { status: "ZERO_RESULTS", results: [] };
    return { status: "OK", results: [result(["country", "political"], [["Nigeria", "NG", "country"]], 9.08, 8.67)] };
  });
  assertEquals(r.json.matchLevel, "country");
  assertEquals(r.json.details.city, null);
  assert(r.urls.at(-1)!.includes("components=country%3ANG"));
});

Deno.test("H-4 nothing usable → needs_context (never a guess)", async () => {
  const r = await run("asdfgh", null, () => ({ status: "ZERO_RESULTS", results: [] }));
  assertEquals(r.json, { details: null, reason: "needs_context" });
});

Deno.test("H-5 a Geocoding refusal inside HTTP 200 is loud, not needs_context", async () => {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((u: string) => {
    urls.push(u);
    return Promise.resolve(new Response(JSON.stringify({ status: "REQUEST_DENIED" }), { status: 200 }));
  }) as typeof fetch;
  try {
    __resetRateLimitForTests();
    const res = await handler(new Request("http://localhost", {
      method: "POST",
      headers: { authorization: `Bearer ${JWT}` },
      body: JSON.stringify({ action: "forward_hierarchy", query: "Didi Museum, Lekki" }),
    }));
    assertEquals(res.status, 502);
    assertEquals((await res.json()).error, "provider_denied");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("H-6 #1363 helpers unchanged: localities come only from the user's words; saved context only when named", () => {
  assertEquals(deriveHierarchyLocalities("Didi Museum, Lekki"), ["Lekki", "Museum, Lekki", "Didi Museum, Lekki"]);
  assertEquals(savedHierarchyContextForQuery("12 Admiralty Way", { city: "Lagos", country_code: "ng" }), { city: null, countryIso: null });
  assertEquals(savedHierarchyContextForQuery("Admiralty Way Lagos", { city: "Lagos", country_code: "ng" }), { city: "Lagos", countryIso: "NG" });
});
