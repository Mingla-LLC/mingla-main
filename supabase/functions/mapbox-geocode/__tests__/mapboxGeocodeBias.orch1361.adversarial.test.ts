// ORCH-1361 [location-suggestions] — TESTER-OWNED ADVERSARIAL regression suite.
//
// DIFFERENT ANGLE than the implementor's happy-path
// (`mapboxGeocodeBias.orch1361.test.ts`, which covers append-when-present + an
// EMPTY `{}` opts object + simple clamp cases). This suite attacks the
// BYTE-IDENTICAL / no-regression invariant (SC-6/SC-7) and the clamp robustness
// at the boundary/malformed-input edges the happy-path never exercises:
//
//   ANGLE 1 — SERVICE-LAYER invoke body (the ACTUAL request the client sends),
//   which the implementor's suite never touches (it only tests the pure edge
//   URL builders). The load-bearing real-world case: the consumer host builds
//   `{ proximity, country, types, limit }` where EVERY field is falsy when GPS
//   is denied (`{ proximity: undefined, country: "", types: undefined,
//   limit: 0 }`). This MUST merge to a byte-identical `{action,query,
//   session_token}` body — a bias OBJECT being present must NOT leak empty
//   params. If the `...(bias?.x ? {x} : {})` guards regress to an unconditional
//   spread, this suite goes RED (business pickers + CityPicker would silently
//   send `country:""`/`limit:0`).
//
//   ANGLE 2 — clampSuggestLimit hardening: negative, NaN, Infinity, and
//   fractional inputs (the happy-path only tested 0/8/50/undefined). Guards the
//   `Number.isFinite` + `Math.trunc` in the clamp.
//
//   ANGLE 3 — injection defense: a proximity string carrying an embedded
//   `&`/`=` query-injection payload must be url-encoded (neutralized), never
//   pass through raw into the upstream Mapbox URL.
//
// PROTECTIVE COMMENT — consumer location search must be multi-row +
// user-proximity-biased, never server-IP; and an UNBIASED / falsy-bias caller
// must be byte-identical to pre-1361 (SC-6). See SPEC_ORCH-1361.
//
// FAILS-ON-REVERT (tester-verified by true line deletion):
//   - revert the service `...(bias?.country ? {country} : {})` guard to an
//     unconditional `country: bias?.country` spread → A2/A5 FAIL (empty key
//     leaks into the body);
//   - revert `clampSuggestLimit` to drop `Number.isFinite`/`Math.trunc`
//     → B1 FAILS;
//   - revert the edge builder `if (opts.proximity)` guard to unconditional
//     append → B2 FAILS (populated-falsy opts leaks `&proximity=`).
//
// Run: deno test --allow-read --no-check \
//   supabase/functions/mapbox-geocode/__tests__/mapboxGeocodeBias.orch1361.adversarial.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildSuggestUrl, clampSuggestLimit } from "../index.ts";
import {
  autocompleteMapbox,
  forwardGeocodeMapbox,
} from "../../../../packages/location-input/src/mapboxGeocodeService.ts";

const BASE = "https://api.mapbox.com/search/searchbox/v1";
const TOKEN = "sk-server-secret";
const SESSION = "sess-uuid-adv";
const PRE_1361_SUGGEST = `${BASE}/suggest?q=lekki&session_token=${SESSION}&access_token=${TOKEN}&limit=5`;

// A capturing invoke double — records the exact body the service constructs.
function capturingInvoke() {
  const bodies: Array<Record<string, unknown>> = [];
  const invoke = (_fn: string, opts: { body: Record<string, unknown> }) => {
    bodies.push(opts.body);
    return Promise.resolve({
      data: { suggestions: [], details: null },
      error: null,
    });
  };
  return { bodies, invoke };
}

// ── ANGLE 1 — service-layer invoke body byte-identical (SC-6/SC-7) ────────────

Deno.test("A1: suggest with NO bias arg → body is EXACTLY {action,query,session_token}", async () => {
  const { bodies, invoke } = capturingInvoke();
  await autocompleteMapbox("lekki", SESSION, { invoke });
  assertEquals(bodies.length, 1);
  assertEquals(Object.keys(bodies[0]).sort(), ["action", "query", "session_token"]);
  assertEquals(bodies[0], { action: "suggest", query: "lekki", session_token: SESSION });
});

Deno.test("A2: suggest with a bias OBJECT of all-FALSY fields (GPS-denied host shape) → byte-identical, NO leaked keys", async () => {
  const { bodies, invoke } = capturingInvoke();
  // This is precisely what PreferencesSheet/CityPicker pass when getLastKnownLocation()
  // returns null and reverseGeocode yields no country: proximity undefined,
  // country "" , types undefined, limit 0 (all falsy).
  await autocompleteMapbox("lekki", SESSION, { invoke }, {
    proximity: undefined,
    country: "",
    types: undefined,
    limit: 0,
  });
  assertEquals(Object.keys(bodies[0]).sort(), ["action", "query", "session_token"]);
  assert(!("proximity" in bodies[0]), "no empty proximity leaks");
  assert(!("country" in bodies[0]), "no empty country leaks");
  assert(!("types" in bodies[0]), "no empty types leaks");
  assert(!("limit" in bodies[0]), "no zero limit leaks");
});

Deno.test("A3: forward with a falsy bias object → body is EXACTLY {action,query}", async () => {
  const { bodies, invoke } = capturingInvoke();
  await forwardGeocodeMapbox("lekki", { invoke }, {
    proximity: undefined,
    country: "",
    types: "",
  }).catch(() => {/* PlaceDetails parse not under test */});
  assertEquals(Object.keys(bodies[0]).sort(), ["action", "query"]);
  assertEquals(bodies[0], { action: "forward", query: "lekki" });
});

Deno.test("A4: a PRESENT bias is forwarded verbatim (service does not mangle casing/whitespace — caller owns normalization)", async () => {
  const { bodies, invoke } = capturingInvoke();
  // Uppercase + whitespace CSV — the service must forward exactly what it is
  // given (the host lowercases; the service is a faithful pass-through).
  await autocompleteMapbox("lekki", SESSION, { invoke }, {
    proximity: "3.4,6.45",
    country: "NG, GH",
    types: "place,locality",
    limit: 8,
  });
  assertEquals(bodies[0], {
    action: "suggest",
    query: "lekki",
    session_token: SESSION,
    proximity: "3.4,6.45",
    country: "NG, GH",
    types: "place,locality",
    limit: 8,
  });
});

Deno.test("A5: limit=0 is dropped by the service (invalid → never reaches the edge)", async () => {
  const { bodies, invoke } = capturingInvoke();
  await autocompleteMapbox("lekki", SESSION, { invoke }, { limit: 0 });
  assert(!("limit" in bodies[0]), "zero limit must be dropped (falsy) — the edge would clamp it to 1 anyway");
});

// ── ANGLE 2 — clampSuggestLimit boundary hardening ────────────────────────────

Deno.test("B1: clampSuggestLimit rejects negative / NaN / Infinity and truncates fractions", () => {
  assertEquals(clampSuggestLimit(-5), 1, "negative → floor 1");
  assertEquals(clampSuggestLimit(-0.4), 1, "small negative → 1");
  assertEquals(clampSuggestLimit(Number.NaN), 5, "NaN → default 5");
  assertEquals(clampSuggestLimit(Number.POSITIVE_INFINITY), 5, "Infinity is not finite → default 5");
  assertEquals(clampSuggestLimit(Number.NEGATIVE_INFINITY), 5, "-Infinity is not finite → default 5");
  assertEquals(clampSuggestLimit(8.9), 8, "fractional truncates DOWN, then in-range");
  assertEquals(clampSuggestLimit(10.9), 10, "fractional above max truncates to 10");
  assertEquals(clampSuggestLimit(1.999), 1, "just under 2 truncates to 1");
});

// ── ANGLE 3 — edge builder: populated-FALSY opts byte-identical + injection ───

Deno.test("B2: buildSuggestUrl with a populated-but-FALSY opts object → byte-identical to pre-1361", () => {
  const url = buildSuggestUrl(BASE, TOKEN, "lekki", SESSION, {
    proximity: "",
    country: undefined,
    types: "",
    limit: undefined,
  });
  assertEquals(url, PRE_1361_SUGGEST);
});

Deno.test("B3: an injection payload embedded in proximity is url-encoded (never raw &/= into the upstream URL)", () => {
  const url = buildSuggestUrl(BASE, TOKEN, "lekki", SESSION, {
    proximity: "3.4,6.45&access_token=EVIL&limit=999",
  });
  // The whole payload lands as ONE encoded proximity value — no raw second
  // access_token / limit override reaches Mapbox.
  assertStringIncludes(url, "&proximity=3.4%2C6.45%26access_token%3DEVIL%26limit%3D999");
  // exactly one real access_token and one real limit param survive.
  assertEquals(url.match(/&access_token=/g)?.length, 1, "only the server access_token");
  assertEquals(url.match(/&limit=/g)?.length, 1, "only the builder's own limit");
});
