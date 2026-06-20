// ORCH-1162 Bug 2 — shared static-Mapbox URL builder: trip-parity + rule-9
// failsafe. (implementor-owned happy-path; Deno-runnable — mapboxStaticUrl.ts is
// pure, no expo-constants in its chain.)
//
// THE FIX (B.0): the URL builder was duplicated byte-for-byte in two app utils;
// it is now the single owner in @mingla/offering-rendering. The pure core
// (buildStaticMapUrlWithToken) is what the event/experience/trip maps render.
//
// FAILS-ON-REVERT: (a) change the URL contract (style/overlay/center/size order
// or the pin/token encoding) → the trip-parity assertion FAILS; (b) drop the
// null-on-missing-coords/token guards → the failsafe assertions FAIL. Verified by
// true line-deletion in the implementation report. The single-owner guarantee is
// additionally CI-enforced by orch-1162-map-single-owner.mjs.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildStaticMapUrlWithToken } from "../mapboxStaticUrl.ts";

const TRIP_INPUT = {
  lat: 35.79,
  lng: -78.74,
  accentHex: "#eb7825",
  height: 180,
};

Deno.test("TC-7: trip-reference URL contract is exact + stable", () => {
  const url = buildStaticMapUrlWithToken(TRIP_INPUT, "T");
  assertEquals(
    url,
    "https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/" +
      "pin-s+eb7825(-78.74,35.79)/-78.74,35.79,11/600x180@2x" +
      "?access_token=T",
  );
});

Deno.test("TC-5a (failsafe): null when token absent", () => {
  assertEquals(buildStaticMapUrlWithToken(TRIP_INPUT, null), null);
  assertEquals(buildStaticMapUrlWithToken(TRIP_INPUT, ""), null);
});

Deno.test("TC-5b (failsafe): null when coords missing / non-finite", () => {
  assertEquals(
    buildStaticMapUrlWithToken({ lat: null, lng: -78.74 }, "T"),
    null,
  );
  assertEquals(
    buildStaticMapUrlWithToken({ lat: 35.79, lng: undefined }, "T"),
    null,
  );
  assertEquals(
    buildStaticMapUrlWithToken({ lat: Number.NaN, lng: -78.74 }, "T"),
    null,
  );
});

Deno.test("TC-8: arbitrary brand-accent hex themes the pin; invalid → fallback", () => {
  const blue = buildStaticMapUrlWithToken(
    { lat: 1, lng: 2, accentHex: "#1d4ed8" },
    "T",
  );
  assert(blue !== null && blue.includes("pin-s+1d4ed8("));
  // garbage accent falls back to the Mingla default pin, never throws.
  const bad = buildStaticMapUrlWithToken(
    { lat: 1, lng: 2, accentHex: "not-a-hex" },
    "T",
  );
  assert(bad !== null && bad.includes("pin-s+eb7825("));
});
