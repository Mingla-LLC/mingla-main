// #4452 follow-up (B15) — the city search puts the city the visitor typed first
// and ranks for the visitor's region, still one Google request.
// Fails-on-revert: drop rankCities from the response → R-1 red; drop the
// regionCode line → R-2 red; a second upstream call → R-3 red.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
Deno.env.set("GOOGLE_MAPS_API_KEY", "test-key");
Deno.env.delete("SUPABASE_URL");
Deno.env.delete("SENTRY_DSN");
import { __resetIpRateLimitForTests, handler, rankCities, regionHint } from "../index.ts";

function pred(city: string, tail: string) {
  return { placePrediction: { structuredFormat: { mainText: { text: city }, secondaryText: { text: tail } } } };
}

async function post(body: Record<string, unknown>, suggestions: unknown[]) {
  const calls: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? "{}")));
    return Promise.resolve(new Response(JSON.stringify({ suggestions })));
  }) as typeof fetch;
  try {
    __resetIpRateLimitForTests();
    const res = await handler(new Request("http://x", { method: "POST", headers: { "x-forwarded-for": "198.51.100.7" }, body: JSON.stringify(body) }));
    return { status: res.status, json: await res.json(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("R-1 a city named exactly what was typed comes first, then name prefixes, else Google's order", async () => {
  const r = await post({ q: "Lagos" }, [
    pred("Lagos de Moreno", "Jalisco, Mexico"),
    pred("Lagos", "Portugal"),
    pred("Lagoa", "Portugal"),
    pred("Lagos", "Nigeria"),
  ]);
  assertEquals(r.status, 200);
  assertEquals(r.json.cities.map((c: { label: string }) => c.label), [
    "Lagos, Portugal", "Lagos, Nigeria", "Lagos de Moreno, Jalisco, Mexico", "Lagoa, Portugal",
  ]);
});

Deno.test("R-2 the visitor's region is passed as Google's regionCode (lower case); a bad hint is dropped", async () => {
  const withRegion = await post({ q: "Lag", region: "NG" }, [pred("Lagos", "Nigeria")]);
  assertEquals(withRegion.calls[0].regionCode, "ng");
  const bad = await post({ q: "Lag", region: "Nigeria" }, [pred("Lagos", "Nigeria")]);
  assertEquals("regionCode" in bad.calls[0], false);
  const none = await post({ q: "Lag" }, [pred("Lagos", "Nigeria")]);
  assertEquals("regionCode" in none.calls[0], false);
  assertEquals(regionHint("gb"), "gb");
  assertEquals(regionHint("g1"), null);
});

Deno.test("R-3 still exactly one Google request, and nothing is added or dropped by the ranking", async () => {
  const r = await post({ q: "Lag", region: "US" }, [pred("Laguna Beach", "CA, USA"), pred("LaGrange", "GA, USA"), pred("Lagos", "Nigeria")]);
  assertEquals(r.calls.length, 1);
  assertEquals(r.json.cities.length, 3);
  const hits = [{ label: "B", city: "Bb", region: "", country: "" }, { label: "A", city: "Ab", region: "", country: "" }];
  assertEquals(rankCities("zz", hits), hits, "no match keeps Google's order");
  assertEquals(rankCities("Sao", [{ label: "x", city: "Sorocaba", region: "", country: "" }, { label: "y", city: "São Paulo", region: "", country: "" }]).map((h) => h.label), ["y", "x"], "accents fold");
});
