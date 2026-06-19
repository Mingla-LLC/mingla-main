// ORCH-1165 [Mapbox static map server-proxy] — edge-fn regression test
// (implementor-owned happy-path; Deno-runnable — validate + URL build are pure).
//
// Proves:
//  - valid query params → a WELL-FORMED Mapbox Static Images fetch URL that uses
//    the SERVER env token, with logo=false & attribution=false (the stack-hiding
//    + logo-suppression contract).
//  - invalid inputs (bad lat/lng range, bad accent, bad zoom, bad style, bad
//    dimension) → an { error } (handler returns 400) — the open-proxy abuse guard.
//  - width/height clamp to the Mapbox 1280 cap.
//
// FAILS-ON-REVERT (verified by true line-deletion in the implementation report):
//  - delete `logo=false&attribution=false` from buildMapboxStaticFetchUrl →
//    the logo/attribution-off assertion FAILS;
//  - delete the lat/lng-range or style/zoom allowlist guards in
//    validateStaticParams → the corresponding 400-input assertions FAIL.
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/mapbox-static/__tests__/mapboxStatic.orch1165.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildMapboxStaticFetchUrl,
  validateStaticParams,
} from "../index.ts";

const SERVER_TOKEN = "sk-server-secret-token";

function qs(record: Record<string, string>): URLSearchParams {
  return new URLSearchParams(record);
}

Deno.test("valid coords → server-side Mapbox URL with env token + logo/attribution OFF", () => {
  const v = validateStaticParams(
    qs({ lat: "35.79", lng: "-78.74", accent: "eb7825", h: "180" }),
  );
  assert(!("error" in v), "expected valid params");
  if ("error" in v) return;

  const url = buildMapboxStaticFetchUrl(v, SERVER_TOKEN);

  // Well-formed Mapbox Static Images URL, lng,lat order (Mapbox is lon-first).
  assertStringIncludes(
    url,
    "https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/",
  );
  assertStringIncludes(url, "pin-s+eb7825(-78.74,35.79)");
  assertStringIncludes(url, "/-78.74,35.79,11/");
  assertStringIncludes(url, "600x180@2x");

  // Logo + attribution suppressed; the SERVER token is used (never a client one).
  assertStringIncludes(url, "logo=false");
  assertStringIncludes(url, "attribution=false");
  assertStringIncludes(url, `access_token=${SERVER_TOKEN}`);
});

Deno.test("defaults applied when optional params omitted (style/zoom/size)", () => {
  const v = validateStaticParams(qs({ lat: "1", lng: "2" }));
  assert(!("error" in v));
  if ("error" in v) return;
  assertEquals(v.style, "dark-v11");
  assertEquals(v.zoom, 11);
  assertEquals(v.width, 600);
  assertEquals(v.height, 300);
  assertEquals(v.pin, "eb7825"); // default pin
});

Deno.test("width/height clamp to the 1280 Mapbox cap", () => {
  const v = validateStaticParams(qs({ lat: "1", lng: "2", w: "5000", h: "9999" }));
  assert(!("error" in v));
  if ("error" in v) return;
  assertEquals(v.width, 1280);
  assertEquals(v.height, 1280);
});

Deno.test("INVALID inputs → { error } (400 path) — open-proxy abuse guard", () => {
  // missing coords
  assert("error" in validateStaticParams(qs({ lng: "2" })));
  assert("error" in validateStaticParams(qs({ lat: "1" })));
  // out-of-range lat/lng
  assert("error" in validateStaticParams(qs({ lat: "91", lng: "2" })));
  assert("error" in validateStaticParams(qs({ lat: "1", lng: "181" })));
  // non-finite coords
  assert("error" in validateStaticParams(qs({ lat: "abc", lng: "2" })));
  // bad accent (not 6-hex)
  assert("error" in validateStaticParams(qs({ lat: "1", lng: "2", accent: "xyz" })));
  assert(
    "error" in validateStaticParams(qs({ lat: "1", lng: "2", accent: "eb782" })),
  );
  // bad zoom (out of range / non-integer)
  assert("error" in validateStaticParams(qs({ lat: "1", lng: "2", zoom: "23" })));
  assert("error" in validateStaticParams(qs({ lat: "1", lng: "2", zoom: "1.5" })));
  // bad dimension
  assert("error" in validateStaticParams(qs({ lat: "1", lng: "2", w: "0" })));
  assert("error" in validateStaticParams(qs({ lat: "1", lng: "2", h: "-3" })));
  // non-allowlisted style
  assert(
    "error" in validateStaticParams(qs({ lat: "1", lng: "2", style: "evil-v1" })),
  );
});

Deno.test("allowlisted style is accepted; pin accent is lowercased", () => {
  const v = validateStaticParams(
    qs({ lat: "1", lng: "2", style: "light-v11", accent: "AABBCC" }),
  );
  assert(!("error" in v));
  if ("error" in v) return;
  assertEquals(v.style, "light-v11");
  assertEquals(v.pin, "aabbcc");
});
