// #4334 — the re-pin script (spec v2 §7, matrix R-REPIN-1) and the Google
// preflight (spec v2 §2). Mocked Google; no network, no database.
//
// Invariant I-4334-HOST-TEXT-PERMANENT: the re-pin never sends host text to
// the write path (applyArgs carries no text field; the SQL side is pinned in
// supabase/migrations/__tests__/issue_4334_google_places.implementor.pg17.test.sql).
//
// Fails-on-revert:
//   R-2 drop the 25 km approximate bound                         → red
//   G-1..G-6 (R3-2 guard, the tester's production cases): drop the 150 m
//        exact bound, the 25 km bound or the locality check      → red
//   G-7 review rows not written to the CSV / applied anyway       → red
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
  reviewCsv,
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

// [TEST-MOD-APPROVED #4334] R3-2: results carry their city / locality, which the
// guard compares with the host's text (default "Lagos" / "Lekki").
const place = (id: string, lat: number, lng: number, cc: string, types: string[], localities = ["Lekki", "Lagos"]) => ({
  places: [{
    id,
    location: { latitude: lat, longitude: lng },
    types,
    addressComponents: [
      ...localities.map((name, i) => ({ longText: name, shortText: name, types: [i === 0 ? "locality" : "administrative_area_level_2", "political"] })),
      { shortText: cc, types: ["country", "political"] },
    ],
  }],
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

// [TEST-MOD-APPROVED #4334] R3-2: a far move is no longer a silent reject; it is
// listed for review (not moved) under the 25 km approximate bound.
Deno.test("R-2 more than 25 km away → review, old pin kept", async () => {
  const d = deps(() => new Response(JSON.stringify(place("ChIJibadan_000001", 7.3775, 3.947, "NG", ["locality"], ["Ibadan"]))));
  const { decisions } = await planRepin([KYMA], d);
  assertEquals(decisions[0].outcome, "review");
  assertEquals(decisions[0].reason, "approximate_pin_moved_over_25km");
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
      ? place("ChIJfar_000000001", 9.0, 7.4, "NG", ["locality"], ["Abuja"])
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


// ── R3-2: the move guard, on the tester's production dry-run cases ──────────
// Old pins and Google's answers are placed at the distances the production dry
// run measured (evidence/repin_dry_run_production.json). Moving north by
// `m` metres: Δlat = m / 111 194.93 (the haversine metre-per-degree).
const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / 111_194.93, lng: p.lng });
const exactRow = (row_id: string, label: string, pin: { lat: number; lng: number }, cc: string): RepinCandidate => ({
  pin_kind: "event_location", row_id, label, lat: pin.lat, lng: pin.lng, country_code: cc, coordinate_precision: "exact",
});
async function decideOne(c: RepinCandidate, answer: { lat: number; lng: number }, cc: string, localities: string[]) {
  const d = deps(() => new Response(JSON.stringify(place("ChIJguard_case_001", answer.lat, answer.lng, cc, ["point_of_interest", "establishment"], localities))));
  return (await planRepin([c], d)).decisions[0];
}

const SOHO = { lat: 51.51366, lng: -0.13216 };
const HARMATTAN = { lat: 6.42813, lng: 3.42189 };
const WYTHE = { lat: 40.72146, lng: -73.95793 };
const ONIJEKUJE = { lat: 6.61671, lng: 3.29801 };

Deno.test("G-1 QA Test Venue · 12 Soho Square (exact) moved 4.2 km → review, not moved", async () => {
  const d = await decideOne(exactRow("soho", "QA Test Venue · 12 Soho Square, Westminster, London, W1D 3QF, UK", SOHO, "GB"), north(SOHO, 4161), "GB", ["London"]);
  assertEquals([d.outcome, d.reason, d.distanceM], ["review", "exact_pin_moved_over_150m", 4161]);
});

Deno.test("G-2 Harmattan Club (exact) at 8.6 km and at 815 m → review; a 60 m nudge onto Google's pin → accept", async () => {
  const row = exactRow("harmattan", "Harmattan Club · Ozumba Mbadiwe Rd 12, Lagos 10, Lagos, Nigeria", HARMATTAN, "NG");
  const far = await decideOne(row, north(HARMATTAN, 8592), "NG", ["Lagos"]);
  assertEquals([far.outcome, far.reason], ["review", "exact_pin_moved_over_150m"]);
  const mid = await decideOne(row, north(HARMATTAN, 815), "NG", ["Lagos"]);
  assertEquals([mid.outcome, mid.reason], ["review", "exact_pin_moved_over_150m"]);
  const nudge = await decideOne(row, north(HARMATTAN, 60), "NG", ["Lagos"]);
  assertEquals([nudge.outcome, nudge.reason], ["accept", null]);
});

Deno.test("G-3 Lantern Room · 11 Wythe Ave (exact) moved 1.5 km → review", async () => {
  const d = await decideOne(exactRow("wythe", "Lantern Room · 11 Wythe Avenue, Brooklyn, New York 11249, United States", WYTHE, "US"), north(WYTHE, 1525), "US", ["New York", "Brooklyn"]);
  assertEquals([d.outcome, d.reason], ["review", "exact_pin_moved_over_150m"]);
});

Deno.test("G-4 Onijekuje Chopify moved 38 km → review whether the row is exact or approximate", async () => {
  const label = "Onijekuje Chopify · 1st Avenue, 121 Road, Gowon Estate, Egbeda, Lagos";
  const asExact = await decideOne(exactRow("oni", label, ONIJEKUJE, "NG"), north(ONIJEKUJE, 38255), "NG", ["Ikorodu", "Lagos"]);
  assertEquals([asExact.outcome, asExact.reason], ["review", "exact_pin_moved_over_150m"]);
  const asApprox = await decideOne({ ...exactRow("oni2", label, ONIJEKUJE, "NG"), coordinate_precision: "approximate" }, north(ONIJEKUJE, 38255), "NG", ["Ikorodu", "Lagos"]);
  assertEquals([asApprox.outcome, asApprox.reason], ["review", "approximate_pin_moved_over_25km"]);
});

Deno.test("G-5 a Lagos-centroid row (precision unknown) moves ≤25 km only into a locality its text names", async () => {
  const centroid = { ...KYMA, coordinate_precision: null };
  const inTown = await decideOne(centroid, { lat: 6.4227, lng: 3.4843 }, "NG", ["Lekki"]);
  assertEquals([inTown.outcome, inTown.reason], ["accept", null]);
  const elsewhere = await decideOne(centroid, { lat: 6.4227, lng: 3.4843 }, "NG", ["Ikeja"]);
  assertEquals([elsewhere.outcome, elsewhere.reason], ["review", "result_locality_not_in_host_text"]);
  const unknown = await decideOne(centroid, { lat: 6.4227, lng: 3.4843 }, "NG", []);
  assertEquals([unknown.outcome, unknown.reason], ["review", "result_locality_unknown"]);
});

Deno.test("G-6 the locality match is whole-word and accent-insensitive", async () => {
  const row = { ...KYMA, label: "Café Zoé · Rue de la Paix, Montréal", country_code: "CA", coordinate_precision: "approximate" };
  const ok = await decideOne(row, north({ lat: KYMA.lat, lng: KYMA.lng }, 900), "CA", ["Montreal"]);
  assertEquals(ok.outcome, "accept");
  const partial = await decideOne({ ...row, label: "Lagoon Bar · Victoria Island" }, north({ lat: KYMA.lat, lng: KYMA.lng }, 900), "CA", ["Lagos"]);
  assertEquals([partial.outcome, partial.reason], ["review", "result_locality_not_in_host_text"]);
});

Deno.test("G-7 review rows are written to the CSV and never applied", async () => {
  const soho = exactRow("soho-row", "QA Test Venue · 12 Soho Square, London", SOHO, "GB");
  const candidates = [KYMA, soho];
  const answer = (b: Record<string, unknown>) =>
    new Response(JSON.stringify(String(b.textQuery).startsWith("QA Test Venue")
      ? place("ChIJsoho_far_0001", north(SOHO, 4161).lat, SOHO.lng, "GB", ["establishment"], ["London"])
      : place("ChIJkyma_beach_0001", 6.4227, 3.4843, "NG", ["establishment"])));
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const written: Record<string, string> = {};
  const code = await run(["--apply", "--review-csv", "review.csv"], {
    ...deps(answer),
    log: () => {},
    rpc: (fn, args) => {
      rpcCalls.push([fn, args]);
      return Promise.resolve(fn === "places_repin_candidates" ? candidates : true);
    },
    writeText: (p, text) => {
      written[p] = text;
      return Promise.resolve();
    },
  });
  assertEquals(code, 0);
  const applies = rpcCalls.filter((c) => c[0] === "places_repin_apply").map((c) => c[1].p_row_id);
  assertEquals(applies, [KYMA.row_id]);
  const lines = written["review.csv"].trim().split("\n");
  assertEquals(lines[0], "id,kind,host_text,old_lat,old_lng,new_lat,new_lng,distance_m,reason");
  assertEquals(lines.length, 2);
  assert(lines[1].startsWith(`soho-row,event_location,"QA Test Venue · 12 Soho Square, London",51.51366,-0.13216,`), lines[1]);
  assert(lines[1].endsWith(",4161,exact_pin_moved_over_150m"), lines[1]);
  // a quote in host text is escaped
  assert(reviewCsv([{ kind: "brand", rowId: "b", query: "q", label: 'Say "hi", Lagos', old: { lat: 1, lng: 2 }, outcome: "review", reason: "r", placeId: "p", new: { lat: 3, lng: 4 }, distanceM: 5, precision: null, featureType: null }]).includes('"Say ""hi"", Lagos"'));
});
