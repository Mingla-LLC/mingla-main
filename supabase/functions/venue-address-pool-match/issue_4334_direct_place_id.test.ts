// #4334 §4.12 — a picked Google place id skips the text search (no Google
// spend) and a retired Mapbox-era id never reaches the pool lookup.
// Fails-on-revert: drop usableGooglePlaceId's dXJuOm guard → V-2 red;
// make the handler always call resolveGooglePlaceId → V-3 red.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseResolveInput, usableGooglePlaceId } from "./index.ts";

const GOOD = { formatted_address: "175 Akin Adesola St, Lagos", lat: 6.43, lng: 3.42 };

Deno.test("V-1 a Google place id is carried through", () => {
  const r = parseResolveInput({ ...GOOD, google_place_id: "ChIJ0Wq9hS_1OxAR" });
  assert(!("error" in r));
  if ("error" in r) return;
  assertEquals(r.googlePlaceId, "ChIJ0Wq9hS_1OxAR");
});

Deno.test("V-2 retired or malformed ids are dropped (text search fallback)", () => {
  assertEquals(usableGooglePlaceId("dXJuOm1ieHBvaTpkaWRp"), null);
  assertEquals(usableGooglePlaceId("short"), null);
  assertEquals(usableGooglePlaceId("has space in it"), null);
  assertEquals(usableGooglePlaceId(42), null);
  const r = parseResolveInput({ ...GOOD, google_place_id: "dXJuOm1ieHBvaTpkaWRp" });
  if ("error" in r) throw new Error("parse");
  assertEquals(r.googlePlaceId, null);
});

Deno.test("V-3 the handler only asks Google when no id was picked", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const block = src.slice(src.indexOf("let googlePlaceId: string | null = parsed.googlePlaceId;"));
  assert(block.length > 0, "the direct-id path is missing");
  assert(/if \(googlePlaceId === null\) \{[\s\S]*resolveGooglePlaceId\(parsed, apiKey\)/.test(block));
});
