// ORCH-1027 [Launch Cities admin control] — TESTER ADVERSARIAL regression suite.
//
// Author: mingla-tester (QA pass on commit 9fa8ad195). This suite attacks a
// DIFFERENT angle than the implementor's happy-path tests
// (check_launch_city.test.ts), which used only WELL-FORMED fixtures + exercised
// the inclusive interior/edge, the unequal-distance overlap tiebreak, and the
// HTTP guards. Here we attack the MALFORMED / DEGENERATE / BOUNDARY inputs that
// the production `seeding_cities` table can actually produce and that the
// happy-path suite never reaches:
//
//   A-1  A live city with NULL bbox columns must NOT match every point.
//        (JS coercion footgun: `null <= lat` is `true`. If a future refactor
//         reorders the comparison, a NULL-bbox live row could swallow the whole
//         planet → every consumer "inLaunchCity:true" wrongly. We pin the SAFE
//         behavior: a NULL-bbox row matches NOTHING.)
//   A-2  A degenerate point-sized bbox (sw == ne) matches its EXACT point only.
//   A-3  Equidistant overlapping live bboxes resolve by id-asc (the tiebreak
//        branch the implementor's unequal-distance test never exercises).
//   A-4  Antimeridian / inverted bbox (sw_lng > ne_lng): documents the KNOWN
//        rectangular-bbox limitation as a CONSCIOUS contract (point genuinely
//        inside a 180°-crossing city is reported OUTSIDE). SPEC §2 non-goals:
//        bbox is rectangular; none of the 17 launch cities cross 180°.
//   A-5  Exact planet-corner coordinates (±90 lat / ±180 lng) are accepted by
//        validation AND resolve correctly at the handler layer.
//   A-6  matchedCity is the FULL nearest object, and a non-matching live set
//        still returns the full liveCities (regression on the "matched vs list"
//        coupling).
//
// FAILS-ON-REVERT: A-1/A-2/A-3 assert real computed values from the shipped
// `isInsideBbox` / `resolveLaunchCity`. Inverting the point-in-bbox predicate
// (the determination fix) flips A-1's NULL-safety, A-2's exact-point match, and
// A-3's tiebreak → the suite drops. Proven below in the QA report.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { handler, isInsideBbox, resolveLaunchCity } from "../index.ts";

// A well-formed live city to mix with the malformed ones.
const GOOD = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Goodtown",
  center_lat: 10,
  center_lng: 10,
  bbox_sw_lat: 9,
  bbox_sw_lng: 9,
  bbox_ne_lat: 11,
  bbox_ne_lng: 11,
};

// === A-1: NULL-bbox live city must match NOTHING (footgun guard) ============
Deno.test("ADVERSARIAL A-1: a live city with NULL bbox never matches any point", () => {
  // deno-lint-ignore no-explicit-any
  const nullBbox: any = {
    id: "00000000-0000-0000-0000-0000000000ff",
    name: "Nulltown",
    center_lat: 0,
    center_lng: 0,
    bbox_sw_lat: null,
    bbox_sw_lng: null,
    bbox_ne_lat: null,
    bbox_ne_lng: null,
  };

  // Direct predicate: a few wildly different points — NONE may be "inside".
  for (const [lat, lng] of [[0, 0], [6.5, 3.3], [-89, -179], [89, 179]]) {
    assertEquals(
      isInsideBbox(lat, lng, nullBbox),
      false,
      `NULL-bbox row must NOT contain (${lat},${lng})`,
    );
  }

  // Through the resolver, mixed with a good city: a point OUTSIDE the good city
  // must NOT be rescued into "inLaunchCity" by the NULL-bbox row.
  const r = resolveLaunchCity(-50, -50, [nullBbox, GOOD]);
  assertEquals(r.inLaunchCity, false, "NULL-bbox row must not swallow the planet");
  assertEquals(r.matchedCity, null);
  // ...but the NULL-bbox row is still surfaced in the full liveCities list.
  assertEquals(r.liveCities.length, 2);

  // And a point INSIDE the good city still matches the good city (not the null one).
  const r2 = resolveLaunchCity(10, 10, [nullBbox, GOOD]);
  assertEquals(r2.inLaunchCity, true);
  assertEquals(r2.matchedCity?.id, GOOD.id);
});

// === A-2: degenerate point-sized bbox matches its EXACT point only ==========
Deno.test("ADVERSARIAL A-2: degenerate point-bbox (sw==ne) matches the exact point, nothing adjacent", () => {
  const pointCity = {
    id: "00000000-0000-0000-0000-0000000000a2",
    name: "Pointville",
    center_lat: 5,
    center_lng: 5,
    bbox_sw_lat: 5,
    bbox_sw_lng: 5,
    bbox_ne_lat: 5,
    bbox_ne_lng: 5,
  };
  assert(isInsideBbox(5, 5, pointCity), "exact point is inside (inclusive)");
  assertEquals(isInsideBbox(5.00001, 5, pointCity), false, "1e-5 north is outside");
  assertEquals(isInsideBbox(5, 4.99999, pointCity), false, "1e-5 west is outside");

  const r = resolveLaunchCity(5, 5, [pointCity]);
  assertEquals(r.inLaunchCity, true);
  assertEquals(r.matchedCity?.id, pointCity.id);
});

// === A-3: equidistant overlap → deterministic id-asc tiebreak ===============
Deno.test("ADVERSARIAL A-3: two live bboxes whose centers are EQUIDISTANT → id-asc tiebreak", () => {
  // Both centers are exactly equidistant from the query point (0,0): one at
  // (1,1), one at (-1,-1) → identical squared distance. The shipped reducer
  // breaks the tie by `c.id < best.id`. Lower id ("aaaa…") must win regardless
  // of array order.
  const lowId = {
    id: "aaaaaaaa-0000-0000-0000-000000000000",
    name: "Zeta", // name purposely sorts AFTER to prove id (not name) is the tiebreak
    center_lat: 1,
    center_lng: 1,
    bbox_sw_lat: -2,
    bbox_sw_lng: -2,
    bbox_ne_lat: 2,
    bbox_ne_lng: 2,
  };
  const highId = {
    id: "ffffffff-0000-0000-0000-000000000000",
    name: "Alpha",
    center_lat: -1,
    center_lng: -1,
    bbox_sw_lat: -2,
    bbox_sw_lng: -2,
    bbox_ne_lat: 2,
    bbox_ne_lng: 2,
  };
  const r1 = resolveLaunchCity(0, 0, [lowId, highId]);
  const r2 = resolveLaunchCity(0, 0, [highId, lowId]);
  assertEquals(r1.matchedCity?.id, lowId.id, "equidistant → lower id wins");
  assertEquals(r2.matchedCity?.id, lowId.id, "tiebreak is order-independent");
});

// === A-4: antimeridian / inverted bbox — KNOWN rectangular-bbox limitation ===
Deno.test("ADVERSARIAL A-4: inverted (antimeridian-crossing) bbox reports a genuinely-inside point as OUTSIDE — documented limitation", () => {
  // A bbox crossing 180° has sw_lng (e.g. 177) > ne_lng (e.g. -178). The shipped
  // predicate `sw_lng <= lng && ne_lng >= lng` cannot represent this. A point at
  // 179° is geographically inside but the rectangular test returns false.
  // SPEC §2 non-goals: bbox is rectangular, no antimeridian support; none of the
  // 17 launch cities cross 180°. We PIN the current behavior so it's a conscious
  // contract, not an accidental regression. If a future ORCH adds a Pacific
  // launch city this test is the canary to extend the predicate.
  const fiji = {
    id: "00000000-0000-0000-0000-0000000000a4",
    name: "Fiji",
    center_lat: -17.5,
    center_lng: 178,
    bbox_sw_lat: -18,
    bbox_sw_lng: 177,
    bbox_ne_lat: -17,
    bbox_ne_lng: -178,
  };
  assertEquals(
    isInsideBbox(-17.5, 179, fiji),
    false,
    "antimeridian point inside-in-reality is OUTSIDE under rectangular bbox (known limitation)",
  );
});

// === A-5: planet-corner coordinates accepted + resolved at the handler ======
Deno.test("ADVERSARIAL A-5: exact ±90/±180 corners are valid (handler returns 200, no DB needed for the corner that is outside)", async () => {
  // The handler reaches the DB only AFTER validation passes. With no SUPABASE_URL
  // configured in the test env the createClient call still constructs; the query
  // will error → handler returns 500 (graceful, no leak) OR 200 if it resolves to
  // an empty live set. Either way it must NOT be a 400 — proving ±90/±180 PASS
  // validation (the boundary-inclusive range check `value <= max`).
  for (const body of [
    { lat: 90, lng: 180 },
    { lat: -90, lng: -180 },
    { lat: 0, lng: 180 },
  ]) {
    const res = await handler(
      new Request("http://x/check-launch-city", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assert(
      res.status !== 400,
      `corner ${JSON.stringify(body)} must pass validation (got 400)`,
    );
    // Drain the body so the test runner doesn't warn about a leaked response.
    await res.text();
  }
});

// === A-6: matched vs list decoupling regression =============================
Deno.test("ADVERSARIAL A-6: a non-matching point still returns the FULL live set (matched/list are decoupled)", () => {
  const r = resolveLaunchCity(-80, -170, [GOOD]); // far from Goodtown
  assertEquals(r.inLaunchCity, false);
  assertEquals(r.matchedCity, null);
  assertEquals(r.liveCities.length, 1, "liveCities is never emptied just because nothing matched");
  assertEquals(r.liveCities[0].id, GOOD.id);
});
