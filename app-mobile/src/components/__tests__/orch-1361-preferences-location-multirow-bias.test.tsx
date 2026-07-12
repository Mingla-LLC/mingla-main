// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1341_guest_list_sheet.test.ts). Deno typechecks it at run.
//
// ORCH-1361 [location-suggestions] — implementor-owned happy-path guard suite
// (SPEC §9 P-1/P-2). Source-structure suite in the 1315/1341 house style
// (read the source files → strip comments → assert).
//
// PROTECTIVE COMMENT — consumer location search must be multi-row +
// user-proximity-biased, never server-IP; see SPEC_ORCH-1361.
//
// Enforces:
//   P-1: the Preferences custom-location field is the shared multi-row
//        MapboxAddressInput (imported from ../location/MapboxAddressInput),
//        rendered INSIDE the `!useGpsLocation && !isLocked` block, with the
//        OQ-2 suggestLimit=8 + OQ-3 types filter + the ≥4-char gate — and the
//        old forward/limit=1 single-row dropdown (BottomSheetScrollView +
//        onSuggestionSelect + suggestionsContainer) is GONE.
//   P-2: PreferencesSheet resolves the device anchor (getLastKnownLocation →
//        setProximity "lng,lat") and threads proximity/country/onPickLocation/
//        hasSelected to LocationInputSection; the removed host suggestion state
//        (setShowSuggestions / handleSuggestionSelect) is GONE.
//   OQ-4: CityPickerSheet threads the same proximity/country bias.
//   OQ-1: the omit-when-absent contract — device present → proximity(+country);
//         no device location → NEITHER param (never a hardcoded default).
//   Co-guard for I-1315: the `!useGpsLocation && !isLocked` guard is preserved.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - revert LocationInputSection to the raw BottomSheetTextInput +
//     geocodingService.autocomplete dropdown → P-1 tests FAIL;
//   - stop threading proximity / onPickLocation from the host → P-2 tests FAIL;
//   - drop the CityPicker proximity/country props → OQ-4 test FAILS.
//
// Run: deno test --allow-read --no-check \
//   app-mobile/src/components/__tests__/orch-1361-preferences-location-multirow-bias.test.tsx

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url).pathname);

// Strip // line comments FIRST (the `[^:]` guard protects `https://` URLs), THEN
// /* */ block comments (covers {/* JSX */}) — line-first because a `/*` inside a
// line comment would otherwise open a phantom block that swallows real code.
function stripComments(src: string): string {
  return src
    .replace(/([^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const ADVANCED = stripComments(
  await read("../PreferencesSheet/PreferencesSectionsAdvanced.tsx"),
);
const PREFS = stripComments(await read("../PreferencesSheet.tsx"));
const CITY = stripComments(await read("../discover/CityPickerSheet.tsx"));

// ── P-1: LocationInputSection is the shared multi-row field ───────────────────
Deno.test("P-1a: PreferencesSectionsAdvanced imports the shared MapboxAddressInput", () => {
  assertStringIncludes(
    ADVANCED,
    'from "../location/MapboxAddressInput"',
    "must import the shared consumer MapboxAddressInput wrapper",
  );
  assertStringIncludes(ADVANCED, "<MapboxAddressInput", "must render the shared field");
});

Deno.test("P-1b: the shared field renders INSIDE the `!useGpsLocation && !isLocked` block", () => {
  const guardIdx = ADVANCED.search(/!useGpsLocation\s*&&\s*!isLocked/);
  const fieldIdx = ADVANCED.indexOf("<MapboxAddressInput");
  assert(guardIdx !== -1, "the custom-field guard must be preserved (I-1315 co-guard)");
  assert(fieldIdx !== -1, "the shared field must render");
  assert(
    fieldIdx > guardIdx,
    "the shared field must render inside the !useGpsLocation && !isLocked block",
  );
});

Deno.test("P-1c: OQ rulings on the field — types filter (OQ-3), suggestLimit 8 (OQ-2), ≥4-char gate", () => {
  assertStringIncludes(
    ADVANCED,
    'types="place,locality,neighborhood,address,region,district"',
    "OQ-3 types filter",
  );
  assertStringIncludes(ADVANCED, "suggestLimit={8}", "OQ-2 consumer multi-row limit");
  assertStringIncludes(ADVANCED, "minQueryLength={4}", "preserve today's ≥4-char gate");
  assertStringIncludes(ADVANCED, "onPick={onPickLocation}", "pick routes to the host");
  assertStringIncludes(ADVANCED, "hasSelected ?", "chip shows on a resolved location");
});

Deno.test("P-1d: the old forward/limit=1 single-row dropdown is GONE", () => {
  assert(
    !ADVANCED.includes("onSuggestionSelect"),
    "the hand-rolled onSuggestionSelect dropdown prop must be removed",
  );
  assert(
    !ADVANCED.includes("BottomSheetScrollView"),
    "the raw dropdown BottomSheetScrollView must be removed",
  );
  assert(
    !ADVANCED.includes("suggestionsContainer"),
    "the raw suggestionsContainer style/list must be removed",
  );
});

// ── P-2: the host resolves + threads the device bias ──────────────────────────
Deno.test("P-2a: PreferencesSheet threads proximity/country/onPickLocation/hasSelected", () => {
  assertStringIncludes(PREFS, "onPickLocation={handlePickLocation}", "wire onPick");
  assertStringIncludes(PREFS, "proximity={proximity}", "thread proximity");
  assertStringIncludes(PREFS, "country={country}", "thread country");
  assertStringIncludes(PREFS, "hasSelected={selectedCoords != null}", "drive the chip");
});

Deno.test("P-2b: the host resolves the device anchor (getLastKnownLocation → proximity 'lng,lat')", () => {
  assertStringIncludes(PREFS, "getLastKnownLocation", "resolve the device anchor");
  assertStringIncludes(PREFS, "setProximity(", "set proximity state");
  assertStringIncludes(
    PREFS,
    "${loc.longitude},${loc.latitude}",
    "proximity is Mapbox 'longitude,latitude' order",
  );
});

Deno.test("P-2c: the removed host suggestion state is GONE (dead forward path deleted)", () => {
  assert(!PREFS.includes("setShowSuggestions"), "showSuggestions state removed");
  assert(!PREFS.includes("handleSuggestionSelect"), "handleSuggestionSelect removed");
});

// ── OQ-4: CityPickerSheet shares the same bias ────────────────────────────────
Deno.test("OQ-4: CityPickerSheet threads proximity + country into the shared field", () => {
  assertStringIncludes(CITY, "proximity={proximity}", "CityPicker threads proximity");
  assertStringIncludes(CITY, "country={country}", "CityPicker threads country");
  assertStringIncludes(CITY, "getLastKnownLocation", "CityPicker resolves the device anchor");
});

// ── OQ-1: behavioral omit-when-absent model ───────────────────────────────────
// Mirrors the host/CityPicker resolution: device present → proximity(+country);
// no device location → BOTH omitted (never a hardcoded default). This is the
// contract the mapboxGeocodeService merges "only when present".
function biasFromDevice(
  loc: { longitude: number; latitude: number } | null,
  countryCode: string | null,
): { proximity?: string; country?: string } {
  if (!loc) return {}; // OQ-1: no device location → omit BOTH
  const bias: { proximity?: string; country?: string } = {
    proximity: `${loc.longitude},${loc.latitude}`,
  };
  if (countryCode) bias.country = String(countryCode).toLowerCase();
  return bias;
}

Deno.test("OQ-1a: device location available → proximity + country sent", () => {
  const b = biasFromDevice({ longitude: 3.4, latitude: 6.45 }, "NG");
  assertEquals(b.proximity, "3.4,6.45");
  assertEquals(b.country, "ng");
});

Deno.test("OQ-1b: device location, no country → proximity only (country is a refinement)", () => {
  const b = biasFromDevice({ longitude: 3.4, latitude: 6.45 }, null);
  assertEquals(b.proximity, "3.4,6.45");
  assert(!("country" in b), "no country when it can't be derived");
});

Deno.test("OQ-1c: NO device location → NEITHER param (never a hardcoded default)", () => {
  const b = biasFromDevice(null, "NG");
  assert(!("proximity" in b), "omit proximity when no device location");
  assert(!("country" in b), "omit country when no device location");
});
