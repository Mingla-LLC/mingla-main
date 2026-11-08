// #4334 — the re-pin script (spec v2 §7, matrix R-REPIN-1) and the Google
// preflight (spec v2 §2). Mocked Google; no network, no database.
//
// Invariant I-4334-HOST-TEXT-PERMANENT: the re-pin never sends host text to
// the write path (applyArgs carries no text field; the SQL side is pinned in
// supabase/migrations/__tests__/issue_4334_google_places.implementor.pg17.test.sql).
//
// Fails-on-revert:
//   R-2 drop the `distanceM > MAX_DISTANCE_M` reject            → red
//   R-3 drop the country-mismatch reject                         → red
//   R-4 stop catching StopRun (no early stop on 429)            → red
//   R-5 --apply without the `stoppedAt === null` guard          → red
//   P-2 accept a 200 REQUEST_DENIED in preflight                → red

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyArgs,
  planRepin,
  queryFor,
  type RepinCandidate,
  type RepinDeps,
  run,
  TEXT_SEARCH_MASK,
} from "../repin-to-google.ts";
import { preflight } from "../preflight-google.ts";

// A centroid row: Kyma Beach, stored on the retired provider's Lagos fallback.
const KYMA: RepinCandidate = {
  pin_kind: "event_location",
  row_id: "00000000-0000-0000-0000-00000000k001",
  label: "Kyma Beach · Elegushi Beach, Lekki, Lagos",
  lat: 6.453928,
  lng: 3.38975,
  country_code: "NG",
  coordinate_precision: "approximate",
};

const place = (id: string, lat: number, lng: number, cc: string, types: string[]) => ({
  places: [{ id, location: { latitude: lat, longitude: lng }, types, addressComponents: [{ shortText: cc, types: ["country", "political"] }] }],
});

function deps(answer: (body: Record<string, unknown>) => Response): RepinDeps & { calls: Array<Record<string, unknown>>; headers: Array<Record<string, string>> } {
  const calls: Array<Record<string, unknown>> = [];
  const headers: Array<Record<string, string>> = [];
  return {
    apiKey: "k",
    calls,
    headers,
    sleep: () => Promise.resolve(),
    fetch: (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      headers.push(init.headers as Record<string, string>);
      return Promise.resolve(answer(body));
    },
  };
}

Deno.test("R-1 query is the host text with ' · ' → ', '; biased 50 km at the old pin, in the stored country, English", async () => {
  assertEquals(queryFor(KYMA.label), "Kyma Beach, Elegushi Beach, Lekki, Lagos");
  const d = deps(() => new Response(JSON.stringify(place("ChIJkyma_beach_0001", 6.4227, 3.4843, "NG", ["point_of_interest", "establishment"]))));
  const { decisions } = await planRepin([KYMA], d);
  assertEquals(d.calls[0].textQuery, "Kyma Beach, Elegushi Beach, Lekki, Lagos");
  assertEquals(d.calls[0].regionCode, "ng");
  assertEquals(d.calls[0].languageCode, "en");
  assertEquals(d.calls[0].maxResultCount, 1);
  assertEquals((d.calls[0].locationBias as { circle: { radius: number } }).circle.radius, 50000);
  assertEquals(d.headers[0]["X-Goog-FieldMask"], TEXT_SEARCH_MASK);
  assertEquals(decisions[0].outcome, "accept");
  assertEquals(decisions[0].precision, "exact");
  // a centroid row moves ~10 km onto the venue — inside the 50 km window
  assert(decisions[0].distanceM! > 9000 && decisions[0].distanceM! < 12000, `${decisions[0].distanceM}`);
});

Deno.test("R-2 more than 50 km away → rejected, old pin kept", async () => {
  const d = deps(() => new Response(JSON.stringify(place("ChIJibadan_000001", 7.3775, 3.947, "NG", ["locality"]))));
  const { decisions } = await planRepin([KYMA], d);
  assertEquals(decisions[0].outcome, "reject");
  assertEquals(decisions[0].reason, "too_far");
});

Deno.test("R-3 country mismatch (Lagos, Portugal) → rejected", async () => {
  const d = deps(() => new Response(JSON.stringify(place("ChIJlagos_pt_0001", 6.45, 3.39, "PT", ["locality"]))));
  const { decisions } = await planRepin([KYMA], d);
  assertEquals(decisions[0].reason, "country_mismatch:PT");
});

Deno.test("R-4 first 429 stops the run; no further Google calls", async () => {
  const d = deps(() => new Response("{}", { status: 429 }));
  const { decisions, stoppedAt } = await planRepin([KYMA, { ...KYMA, row_id: "x2" }, { ...KYMA, row_id: "x3" }], d);
  assertEquals(stoppedAt, 429);
  assertEquals(d.calls.length, 1);
  assertEquals(decisions.length, 0);
});

Deno.test("R-5 dry run writes nothing; apply writes only accepted rows, with no host text; a stopped run writes nothing", async () => {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const candidates = [KYMA, { ...KYMA, row_id: "far", label: "Far away" }];
  const answer = (b: Record<string, unknown>) =>
    new Response(JSON.stringify(b.textQuery === "Far away"
      ? place("ChIJfar_000000001", 9.0, 7.4, "NG", ["locality"])
      : place("ChIJkyma_beach_0001", 6.4227, 3.4843, "NG", ["establishment"])));
  const base = { ...deps(answer), log: () => {}, rpc: (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push([fn, args]);
    return Promise.resolve(fn === "places_repin_candidates" ? candidates : true);
  } };
  assertEquals(await run([], base), 0);
  assertEquals(rpcCalls.map((c) => c[0]), ["places_repin_candidates"]);
  rpcCalls.length = 0;
  assertEquals(await run(["--apply"], base), 0);
  const applies = rpcCalls.filter((c) => c[0] === "places_repin_apply");
  assertEquals(applies.length, 1);
  assertEquals(Object.keys(applies[0][1]).sort(), ["p_kind", "p_lat", "p_lng", "p_place_id", "p_precision", "p_row_id"]);
  assertEquals(applyArgs({
    kind: "venue_listing", rowId: "v", query: "q", old: { lat: 1, lng: 1 }, outcome: "accept", reason: null,
    placeId: "ChIJx_000000000", new: { lat: 1, lng: 1 }, distanceM: 0, precision: "exact", featureType: "poi",
  }).p_place_id, "ChIJx_000000000");

  rpcCalls.length = 0;
  const stopped = { ...deps(() => new Response("{}", { status: 403 })), log: () => {}, rpc: base.rpc };
  assertEquals(await run(["--apply"], stopped), 1);
  assertEquals(rpcCalls.filter((c) => c[0] === "places_repin_apply").length, 0);
});

Deno.test("R-6 --restore replays the applied list through places_repin_restore", async () => {
  const rpcCalls: string[] = [];
  const code = await run(["--restore", "applied.json"], {
    ...deps(() => new Response("{}")),
    log: () => {},
    rpc: (fn) => {
      rpcCalls.push(fn);
      return Promise.resolve(true);
    },
    readText: () => Promise.resolve(JSON.stringify({ applied: [{ kind: "brand", rowId: "b1" }, { kind: "event_location", rowId: "e1" }] })),
  });
  assertEquals(code, 0);
  assertEquals(rpcCalls, ["places_repin_restore", "places_repin_restore"]);
});

Deno.test("P-1/P-2 preflight: four body verdicts; 200 + REQUEST_DENIED and the 403 error image fail", async () => {
  const good = (url: string) => {
    if (url.includes("places:autocomplete")) return new Response(JSON.stringify({ suggestions: [{}] }));
    if (url.includes("/v1/places/")) return new Response(JSON.stringify({ location: { latitude: 1, longitude: 2 } }));
    if (url.includes("geocode")) return new Response(JSON.stringify({ status: "OK" }));
    return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
  };
  const rows = await preflight("k", (u) => Promise.resolve(good(String(u))));
  assertEquals(rows.map((r) => r.ok), [true, true, true, true]);
  const bad = await preflight("k", (u) => {
    const url = String(u);
    if (url.includes("geocode")) return Promise.resolve(new Response(JSON.stringify({ status: "REQUEST_DENIED" })));
    if (url.includes("staticmap")) return Promise.resolve(new Response(new Uint8Array([1]), { status: 403, headers: { "content-type": "image/png" } }));
    return Promise.resolve(good(url));
  });
  assertEquals(bad.map((r) => [r.api, r.ok]), [["places_autocomplete", true], ["place_details", true], ["geocoding", false], ["static_maps", false]]);
});
