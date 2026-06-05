// [TEST-MOD-APPROVED ORCH-1079] places-autocomplete RETIRED.
//
// ORCH-1079 [Business-venue Google→Mapbox sweep] deleted the Google
// `places-autocomplete/index.ts` edge fn — all business address autocomplete now
// flows through `mapbox-geocode`. The append-only-CI policy (ORCH-0840) forbids
// DELETING a test file outright, so instead of deleting this test alongside its
// now-removed unit-under-test, we replace its body with a retirement marker:
//   • it no longer imports the deleted ./index.ts (which would not compile), and
//   • it asserts the source file is GONE — converting this into a deletion guard.
// This keeps the test file present (honoring append-only) while proving the
// retirement holds. GOOGLE_MAPS_API_KEY is intentionally RETAINED (6 other edge
// fns consume it) and is NOT asserted here.

import { assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-1079: places-autocomplete edge fn is retired (source deleted)", () => {
  let exists = true;
  try {
    // Resolve relative to this test file; the sibling source must be gone.
    Deno.statSync(new URL("./index.ts", import.meta.url));
  } catch {
    exists = false;
  }
  assert(
    !exists,
    "places-autocomplete/index.ts must NOT exist — it was retired by ORCH-1079 (use mapbox-geocode)",
  );
});
