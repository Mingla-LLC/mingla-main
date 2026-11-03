// MINGLA-INVARIANT: I-4238-ERROR-IS-NOT-MISSING | issue #4238 | A provider error during a targeting search is returned with `unavailable: true` and is shown as "Couldn't check <app>. Try again", never recorded as no match.
// MINGLA-INVARIANT: I-4238-PER-APP-MATCH | issue #4238 | Each ad app is matched on its own: a place or interest is looked up in that app's own list and the app's best result is used; no surface requires one app's name to equal another app's name.
/**
 * #4238 media-buyer, wave A — each app is matched on its own, and an app
 * error is never read as "not found".
 *
 * Guards I-4238-PER-APP-MATCH and I-4238-ERROR-IS-NOT-MISSING
 * (declared in ../adTargetingMatch.ts and here).
 *
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  matchInterest,
  matchPlace,
  normalizeTargetName,
  searchMatch,
} from "../adTargetingMatch.ts";

const tt = (id: string, name: string, level: string) => ({
  id,
  name,
  meta: { geo_type: level, level },
});

Deno.test("A1 TikTok knows Lagos only as a state: the match is the wider area", () => {
  const result = matchPlace("Lagos", "city", [], [
    tt("2332453", "Lagos State", "PROVINCE"),
  ]);
  assertEquals(result.state, "wider");
  assertEquals(result.state === "wider" ? result.wider.id : "", "2332453");
});

Deno.test("A1 a city-level answer wins over a wider one", () => {
  const result = matchPlace("Lagos", "city", [tt("1", "Lagos", "CITY")], [
    tt("2", "Lagos State", "PROVINCE"),
  ]);
  assertEquals(result.state, "match");
  assertEquals(result.state === "match" ? result.best.id : "", "1");
});

Deno.test("A1 DMA suffix and admin words do not block a match", () => {
  assertEquals(normalizeTargetName("New York, DMA®"), "new york");
  assertEquals(normalizeTargetName("Lagos State"), "lagos");
  const result = matchPlace("New York", "city", [
    tt("9", "Albany", "DISTRICT"),
    tt("5128581", "New York, DMA®", "DMA"),
  ]);
  assertEquals(result.state === "match" ? result.best.id : "", "5128581");
});

Deno.test("A1 no exact-name rule: an app's own differently-named city still matches", () => {
  // Meta lists neighbourhoods as cities; Google may name it its own way.
  const result = matchPlace("Lekki", "city", [
    { id: "g1", name: "Lekki Phase 1", meta: { level: "CITY" } },
  ]);
  assertEquals(result.state, "match");
});

Deno.test("A1 a region search keeps region-level answers", () => {
  const result = matchPlace("Lagos State", "region", [
    { id: "r", name: "Lagos", meta: { level: "REGION" } },
  ]);
  assertEquals(result.state, "match");
  assertEquals(matchPlace("Lagos", "city", []).state, "none");
});

Deno.test("A7 interests: each app's own first answer is its match", () => {
  const meta = matchInterest("Live music", [
    { id: "m1", name: "Concerts", meta: {} },
    { id: "m2", name: "Live music", meta: {} },
  ]);
  assertEquals(meta.state === "match" ? meta.best.id : "", "m2");
  // TikTok has no "Live music"; its own top category is used, never "not found".
  const tiktok = matchInterest("Live music", [
    { id: "t7", name: "Music › Live performances", meta: {} },
  ]);
  assertEquals(tiktok.state, "match");
  assertEquals(matchInterest("Live music", []).state, "none");
});

Deno.test("A1 searchMatch covers every kind", () => {
  assertEquals(
    searchMatch("pin", "Beach club, Lekki", {
      results: [{ id: "pin:x", name: "Beach club, Lekki", meta: {} }],
    }).state,
    "match",
  );
  assertEquals(
    searchMatch("city", "Lagos", {
      results: [],
      wider: [tt("2", "Lagos State", "PROVINCE")],
    }).state,
    "wider",
  );
  assertEquals(
    searchMatch("language", "fr", {
      results: [{ id: "fr", name: "French", meta: {} }],
    }).state,
    "match",
  );
});

Deno.test("A2 the search edge marks every provider error unavailable, Host and admin", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-targeting-search/index.ts", import.meta.url),
  );
  const failOpen = src.slice(
    src.indexOf("function failOpen("),
    src.indexOf("async function resolveMeta("),
  );
  // Both the Host branch and the admin branch return the flag.
  assertEquals(failOpen.split("unavailable: true,\n").length - 1, 1);
  assertStringIncludes(failOpen, "return { results: [], warning, unavailable: true };");
  // The TikTok city lookup falls back to PROVINCE for the wider area.
  assertStringIncludes(src, 'geoTypes: ["PROVINCE"]');
  assert(src.includes("match: searchMatch(k, q, out)"));
});
