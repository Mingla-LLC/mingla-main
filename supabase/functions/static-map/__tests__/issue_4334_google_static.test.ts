// #4334 — static-map on the Google Maps Static API (matrix R-MAP-1, R-MAP-2).
// Replaces the ORCH-1165 Mapbox suites; keeps their security angles: the key
// is never echoed, the only fetched host is maps.googleapis.com, and any
// upstream failure is a non-200 JSON so the client <Image> hides the map
// (I-PROPOSED-1162-MAP-FAILSAFE-HIDES).
//
// Every Google response here is MOCKED (the Static Maps API is being enabled
// on the project; runtime proof comes later).
//
// Fails-on-revert:
//   S-2 drop the lat/lng order fix (lng,lat in center)            → red
//   S-3 drop fitGoogleSize (send 1280 wide)                       → red
//   S-5 drop the content-type check (403 error image passes)      → red
//   S-6 restore 43200 / no-store cache header                     → red

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const KEY = "AIzaTEST_STATIC_KEY_DO_NOT_LEAK_123";
Deno.env.set("GOOGLE_MAPS_API_KEY", KEY);
Deno.env.delete("SUPABASE_URL");
Deno.env.delete("SENTRY_DSN");

import {
  buildGoogleStaticFetchUrl,
  fitGoogleSize,
  handler,
  MINGLA_DARK_STYLE,
  validateStaticParams,
} from "../index.ts";

const FN = "https://proj.supabase.co/functions/v1/static-map";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

async function get(qs: string, respond: (url: string) => Response) {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string) => {
    urls.push(input);
    return Promise.resolve(respond(input));
  }) as typeof fetch;
  try {
    const res = await handler(new Request(`${FN}?${qs}`));
    const body = new Uint8Array(await res.arrayBuffer());
    return { res, body, text: new TextDecoder().decode(body), urls };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("S-1 the public URL contract is unchanged (validation)", () => {
  const ok = validateStaticParams(new URLSearchParams("lat=6.43&lng=3.42&accent=EB7825&zoom=14&w=600&h=180&style=dark-v11"));
  assert(!("error" in ok));
  assertEquals(validateStaticParams(new URLSearchParams("lng=3")), { error: "coordinates_required" });
  assertEquals(validateStaticParams(new URLSearchParams("lat=91&lng=3")), { error: "lat_out_of_range" });
  assertEquals(validateStaticParams(new URLSearchParams("lat=6&lng=3&accent=red")), { error: "invalid_accent" });
  assertEquals(validateStaticParams(new URLSearchParams("lat=6&lng=3&zoom=23")), { error: "invalid_zoom" });
  assertEquals(validateStaticParams(new URLSearchParams("lat=6&lng=3&style=../x")), { error: "invalid_style" });
});

Deno.test("S-2 Google URL: latitude first, accent pin, dark style, scale 2, zoom ≤ 21", () => {
  const p = validateStaticParams(new URLSearchParams("lat=6.4325&lng=3.4237&accent=eb7825&zoom=22"));
  if ("error" in p) throw new Error(p.error);
  const url = new URL(buildGoogleStaticFetchUrl(p, KEY));
  assertEquals(url.origin + url.pathname, "https://maps.googleapis.com/maps/api/staticmap");
  assertEquals(url.searchParams.get("center"), "6.4325,3.4237");
  assertEquals(url.searchParams.get("markers"), "size:mid|color:0xeb7825|6.4325,3.4237");
  assertEquals(url.searchParams.get("zoom"), "21");
  assertEquals(url.searchParams.get("scale"), "2");
  assertEquals(url.searchParams.getAll("style"), [...MINGLA_DARK_STYLE]);
  assertEquals(url.searchParams.get("maptype"), null);
});

Deno.test("S-3 size: at most 640 per side, aspect ratio kept", () => {
  assertEquals(fitGoogleSize(600, 300), { w: 600, h: 300 });
  assertEquals(fitGoogleSize(1280, 640), { w: 640, h: 320 });
  assertEquals(fitGoogleSize(600, 1280), { w: 300, h: 640 });
});

Deno.test("S-4 style ids: satellite ids map to Google map types; every other id gets the dark set", () => {
  const sat = validateStaticParams(new URLSearchParams("lat=1&lng=1&style=satellite-v9"));
  const hyb = validateStaticParams(new URLSearchParams("lat=1&lng=1&style=satellite-streets-v12"));
  const light = validateStaticParams(new URLSearchParams("lat=1&lng=1&style=light-v11"));
  if ("error" in sat || "error" in hyb || "error" in light) throw new Error("validation");
  assertEquals(new URL(buildGoogleStaticFetchUrl(sat, KEY)).searchParams.get("maptype"), "satellite");
  assertEquals(new URL(buildGoogleStaticFetchUrl(hyb, KEY)).searchParams.get("maptype"), "hybrid");
  assertEquals(new URL(buildGoogleStaticFetchUrl(light, KEY)).searchParams.getAll("style").length, MINGLA_DARK_STYLE.length);
});

Deno.test("S-5 R-MAP-2: Google's 403 error IMAGE, a 200 non-image and a thrown fetch all → 502 map_unavailable", async () => {
  for (const respond of [
    () => new Response(PNG, { status: 403, headers: { "content-type": "image/png" } }),
    () => new Response("This API is not activated", { status: 200, headers: { "content-type": "text/plain" } }),
    () => {
      throw new TypeError("network");
    },
  ]) {
    const r = await get("lat=6.43&lng=3.42", respond as (u: string) => Response);
    assertEquals(r.res.status, 502);
    assertEquals(JSON.parse(r.text), { error: "map_unavailable" });
    assert(!r.text.includes(KEY));
  }
});

Deno.test("S-6 success: image bytes, 24 h public cache, only maps.googleapis.com fetched, key never echoed", async () => {
  const r = await get("lat=6.43&lng=3.42&w=600&h=180", () =>
    new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
  assertEquals(r.res.status, 200);
  assertEquals(r.res.headers.get("cache-control"), "public, max-age=86400");
  assertEquals(r.res.headers.get("content-type"), "image/png");
  assertEquals(r.body, PNG);
  assertEquals(r.urls.length, 1);
  assertEquals(new URL(r.urls[0]).host, "maps.googleapis.com");
  for (const [, v] of r.res.headers) assert(!v.includes(KEY));
});

Deno.test("S-7 invalid input never reaches Google", async () => {
  const r = await get("lat=6.43&lng=3.42&style=https://evil.example/x", () => new Response(PNG));
  assertEquals(r.res.status, 400);
  assertEquals(r.urls.length, 0);
});
