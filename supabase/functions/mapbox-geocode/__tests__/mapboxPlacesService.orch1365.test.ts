// ORCH-1365 [location-search-relevance] — shared-service action guard
// (implementor-owned; SPEC §7 T-7, §8.4). Deno-runnable: the service is pure TS
// with an INJECTED `invoke`, so it imports cleanly with no network/env.
//
// PROTECTIVE COMMENT — the CONSUMER place autocomplete posts the ADDITIVE
// `action: "suggest_places"` (edge fn applies the place-type filter + trailing-
// country strip + country bias). The BUSINESS venue-name autocomplete
// (`autocompleteMapbox`) still posts `action: "suggest"` and is UNCHANGED /
// filter-free (INV-3 / ORCH-1079). NO proximity is threaded for the Preferences
// field (OQ-4) — the service forwards proximity ONLY when a caller passes it.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - change the `autocompletePlacesMapbox` body action back to "suggest" (or
//     delete the function) → the action assertions FAIL;
//   - re-add an unconditional proximity to the places body → the "no proximity"
//     assertion FAILS.
//
// Run: deno test --allow-read \
//   supabase/functions/mapbox-geocode/__tests__/mapboxPlacesService.orch1365.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  autocompleteMapbox,
  autocompletePlacesMapbox,
} from "../../../../packages/location-input/src/mapboxGeocodeService.ts";

const SESSION = "sess-uuid-0001";

type Captured = { fn: string; body: Record<string, unknown> };

function makeInvoke(suggestions: unknown[]) {
  const calls: Captured[] = [];
  const invoke = (fn: string, options: { body: Record<string, unknown> }) => {
    calls.push({ fn, body: options.body });
    return Promise.resolve({ data: { suggestions }, error: null });
  };
  return { invoke, calls };
}

// ── T-7: places service posts suggest_places (no proximity for Preferences) ────
Deno.test("T-7: autocompletePlacesMapbox posts action 'suggest_places' with the raw query", async () => {
  const { invoke, calls } = makeInvoke([
    { placeId: "p1", displayName: "Lekki Phase 2", fullAddress: "Lagos, Nigeria" },
  ]);
  const out = await autocompletePlacesMapbox("lekki nigeria", SESSION, { invoke });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "mapbox-geocode");
  assertEquals(calls[0].body.action, "suggest_places");
  // The service posts the RAW query — the edge fn does the trailing-country strip.
  assertEquals(calls[0].body.query, "lekki nigeria");
  assertEquals(calls[0].body.session_token, SESSION);
  // OQ-4 — no proximity threaded for the Preferences field.
  assert(!("proximity" in calls[0].body), "no proximity in the place-search body");
  assert(!("limit" in calls[0].body), "no limit unless the caller opts in");
  assertEquals(out.length, 1);
  assertEquals(out[0].displayName, "Lekki Phase 2");
});

Deno.test("T-7: business autocompleteMapbox STILL posts action 'suggest' (unchanged)", async () => {
  const { invoke, calls } = makeInvoke([]);
  await autocompleteMapbox("lekki", SESSION, { invoke });
  assertEquals(calls[0].body.action, "suggest");
});

Deno.test("T-7: places service merges limit + optional forward-compat proximity when present", async () => {
  const { invoke, calls } = makeInvoke([]);
  await autocompletePlacesMapbox("lekki", SESSION, { invoke }, {
    limit: 8,
    proximity: "3.4,6.45",
  });
  assertEquals(calls[0].body.limit, 8);
  assertEquals(calls[0].body.proximity, "3.4,6.45");
  assertEquals(calls[0].body.action, "suggest_places");
});

Deno.test("T-7: places service returns [] on error + on sub-3-char query (silent fallback)", async () => {
  const err = (_fn: string, _o: { body: Record<string, unknown> }) =>
    Promise.resolve({ data: null, error: { message: "boom" } });
  assertEquals(await autocompletePlacesMapbox("lekki", SESSION, { invoke: err }), []);
  // sub-min query short-circuits without invoking.
  let called = false;
  const spy = (_fn: string, _o: { body: Record<string, unknown> }) => {
    called = true;
    return Promise.resolve({ data: { suggestions: [] }, error: null });
  };
  assertEquals(await autocompletePlacesMapbox("li", SESSION, { invoke: spy }), []);
  assert(!called, "sub-3-char query must not invoke the edge fn");
});
