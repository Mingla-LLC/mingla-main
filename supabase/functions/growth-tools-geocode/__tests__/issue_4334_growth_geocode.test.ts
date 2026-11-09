// #4334 — marketing growth tools city typeahead on Google (matrix R-MKT-1).
// Fails-on-revert: delete the checkIpRateLimit call → G-3 red; drop the
// `!upstream.ok` branch → G-2 red.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
Deno.env.set("GOOGLE_MAPS_API_KEY", "test-key");
Deno.env.delete("SUPABASE_URL");
Deno.env.delete("SENTRY_DSN");
import { __resetIpRateLimitForTests, handler, IP_RATE_LIMIT_MAX } from "../index.ts";

async function post(q: string, respond: () => Response, ip = "203.0.113.9") {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return Promise.resolve(respond());
  }) as typeof fetch;
  try {
    const res = await handler(new Request("http://x", {
      method: "POST",
      headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
      body: JSON.stringify({ q }),
    }));
    return { status: res.status, json: await res.json(), calls, headers: res.headers };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("G-1 cities from Autocomplete (New): city types, English, label 'City, Region, Country'", async () => {
  __resetIpRateLimitForTests();
  const r = await post("lond", () => new Response(JSON.stringify({ suggestions: [
    { placePrediction: { structuredFormat: { mainText: { text: "London" }, secondaryText: { text: "UK" } } } },
    { placePrediction: { structuredFormat: { mainText: { text: "London" }, secondaryText: { text: "ON, Canada" } } } },
    { placePrediction: { structuredFormat: { mainText: { text: "London" }, secondaryText: { text: "ON, Canada" } } } },
  ] })));
  assertEquals(r.status, 200);
  assertEquals(r.calls[0].url, "https://places.googleapis.com/v1/places:autocomplete");
  assertEquals(r.calls[0].body.includedPrimaryTypes, ["locality", "administrative_area_level_3"]);
  assertEquals(r.calls[0].body.languageCode, "en");
  assertEquals(r.json.cities, [
    { label: "London, UK", city: "London", region: "", country: "UK" },
    { label: "London, ON, Canada", city: "London", region: "ON", country: "Canada" },
  ]);
  assertEquals(r.headers.get("cache-control"), "public, max-age=300");
});

Deno.test("G-2 an upstream failure is geocode_unavailable 502, not an empty list", async () => {
  __resetIpRateLimitForTests();
  for (const status of [403, 429, 500]) {
    const r = await post("lond", () => new Response("{}", { status }));
    assertEquals(r.status, 502);
    assertEquals(r.json.error, "geocode_unavailable");
  }
});

Deno.test("G-3 rate limit: 30 per minute per IP, then 429; another IP is unaffected", async () => {
  __resetIpRateLimitForTests();
  let last = 0;
  for (let i = 0; i <= IP_RATE_LIMIT_MAX; i += 1) {
    last = (await post("lond", () => new Response(JSON.stringify({ suggestions: [] })))).status;
  }
  assertEquals(last, 429);
  const other = await post("lond", () => new Response(JSON.stringify({ suggestions: [] })), "198.51.100.2");
  assertEquals(other.status, 200);
});

Deno.test("G-4 validation unchanged", async () => {
  __resetIpRateLimitForTests();
  const r = await post("l", () => new Response("{}"));
  assertEquals(r.status, 400);
  assert(r.calls.length === 0);
});
