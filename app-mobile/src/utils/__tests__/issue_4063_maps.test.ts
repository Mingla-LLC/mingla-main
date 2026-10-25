import assert from "node:assert/strict";
import test from "node:test";

import { buildMapsUrl, parseMapPoint } from "../mapsUrl.ts";

test("parses the bounded point shapes returned by Supabase", () => {
  assert.deepEqual(parseMapPoint("(-0.1276,51.5072)"), {
    lat: 51.5072,
    lng: -0.1276,
  });
  assert.deepEqual(parseMapPoint([-74.006, 40.7128]), {
    lat: 40.7128,
    lng: -74.006,
  });
  assert.deepEqual(parseMapPoint({ x: 3.3792, y: 6.5244 }), {
    lat: 6.5244,
    lng: 3.3792,
  });
  assert.deepEqual(parseMapPoint({ lat: "35.6762", lng: "139.6503" }), {
    lat: 35.6762,
    lng: 139.6503,
  });
});

test("rejects malformed and out-of-range points", () => {
  assert.equal(parseMapPoint("POINT(-0.1 51.5)"), null);
  assert.equal(parseMapPoint([181, 20]), null);
  assert.equal(parseMapPoint({ lat: 91, lng: 0 }), null);
  assert.equal(parseMapPoint(null), null);
});

test("builds the universal HTTPS maps destination", () => {
  assert.equal(
    buildMapsUrl(51.5072, -0.1276, "London"),
    "https://www.google.com/maps/search/?api=1&query=51.5072,-0.1276",
  );
});
