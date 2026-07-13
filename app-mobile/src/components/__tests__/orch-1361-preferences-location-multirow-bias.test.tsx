// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1341_guest_list_sheet.test.ts). Deno typechecks it at run.
//
// ORCH-1361 [location-suggestions] — implementor-owned happy-path guard suite
// (SPEC §9 P-1/P-2). Source-structure suite in the 1315/1341 house style
// (read the source files → strip comments → assert).
//
// ── [TEST-MOD-APPROVED ORCH-1365] — CORRECTIVE UPDATE ─────────────────────────
// ORCH-1365 [location-search-relevance] RETIRED the device-proximity lever for
// the Preferences custom-location field (it is a "search a place you are NOT at"
// field — biasing to the device buried the target place for a non-local user).
// The Preferences P-1c/P-2a/P-2b assertions below are UPDATED from "must thread
// proximity" to the new contract: the field routes through `searchMode="places"`
// and the host threads NO proximity (the getLastKnownLocation proximity effect is
// removed). The affirmative ORCH-1365 contract lives in
// `orch-1365-preferences-places-no-proximity.test.tsx`. CityPicker is UNCHANGED
// (orchestrator OQ-2 declined) so the OQ-4 CityPicker proximity assertion stays.
//
// PROTECTIVE COMMENT — consumer location search must be multi-row +
// user-proximity-biased (RANK-only), never server-IP; and the shared suggest
// handler must stay FILTER-FREE (no types/country — INV-3 / ORCH-1079); see
// SPEC_ORCH-1361.
//
// Enforces:
//   P-1: the Preferences custom-location field is the shared multi-row
//        MapboxAddressInput (imported from ../location/MapboxAddressInput),
//        rendered INSIDE the `!useGpsLocation && !isLocked` block, with the
//        suggestLimit=8 + the ≥4-char gate, and NO types/country FILTER on the
//        field (INV-3 / ORCH-1079) — and the old forward/limit=1 single-row
//        dropdown (BottomSheetScrollView + onSuggestionSelect +
//        suggestionsContainer) is GONE.
//   P-2: [ORCH-1365] PreferencesSheet wires onPickLocation/hasSelected and threads
//        NO proximity (the getLastKnownLocation → setProximity device-anchor
//        effect is REMOVED — OQ-4) and NO country prop; the removed host
//        suggestion state (setShowSuggestions / handleSuggestionSelect) is GONE.
//   OQ-4: CityPickerSheet (UNCHANGED — orchestrator OQ-2 declined) still threads
//        the proximity rank bias (NO country).
//   OQ-1: the omit-when-absent contract — device present → proximity;
//         no device location → no param (never a hardcoded default).
//   Co-guard for I-1315: the `!useGpsLocation && !isLocked` guard is preserved.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - revert LocationInputSection to the raw BottomSheetTextInput +
//     geocodingService.autocomplete dropdown → P-1 tests FAIL;
//   - [ORCH-1365] re-introduce proximity threading / the getLastKnownLocation
//     proximity effect in the host → P-2 tests FAIL (device-bias is retired);
//   - drop the CityPicker proximity prop → OQ-4 test FAILS;
//   - re-add a types/country FILTER to the field → the filter-free P-1 assertion
//     FAILS (guards INV-3 / ORCH-1079).
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

Deno.test("P-1c: field config — suggestLimit 8, ≥4-char gate, places-mode, NO proximity [TEST-MOD-APPROVED ORCH-1365]", () => {
  assertStringIncludes(ADVANCED, "suggestLimit={8}", "consumer multi-row limit");
  assertStringIncludes(ADVANCED, "minQueryLength={4}", "preserve today's ≥4-char gate");
  assertStringIncludes(ADVANCED, "onPick={onPickLocation}", "pick routes to the host");
  assertStringIncludes(ADVANCED, "hasSelected ?", "chip shows on a resolved location");
  // ORCH-1365 — the field now routes through the `places` search mode (POIs
  // dropped + trailing-country strip + country bias) and threads NO proximity
  // (OQ-4). The device-bias lever is retired for this "search a place you are NOT
  // at" field. The business `suggest` path stays byte-identical + filter-free.
  assertStringIncludes(ADVANCED, 'searchMode="places"', "field uses the places search mode");
  assert(!ADVANCED.includes("proximity"), "proximity is no longer threaded to the field (ORCH-1365 / OQ-4)");
  assert(!ADVANCED.includes("types="), "no types filter leaked into the host");
  assert(!ADVANCED.includes("country={country}"), "no country filter on the field");
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

// ── P-2: the host wires the field (device-proximity path RETIRED by ORCH-1365) ─
Deno.test("P-2a: PreferencesSheet wires onPick/hasSelected + threads NO proximity/country [TEST-MOD-APPROVED ORCH-1365]", () => {
  assertStringIncludes(PREFS, "onPickLocation={handlePickLocation}", "wire onPick");
  assertStringIncludes(PREFS, "hasSelected={selectedCoords != null}", "drive the chip");
  // ORCH-1365 — the host no longer threads proximity to the field (OQ-4), and
  // still never threads a country filter (business path filter-free).
  assert(!PREFS.includes("proximity"), "host must not thread proximity (ORCH-1365 / OQ-4)");
  assert(!PREFS.includes("country={country}"), "host must not thread a country filter");
});

Deno.test("P-2b: the device-anchor proximity effect is REMOVED from the host [TEST-MOD-APPROVED ORCH-1365]", () => {
  // ORCH-1365 — the getLastKnownLocation → setProximity effect is retired. The
  // field ranks the real place #1 via the `places` search mode without proximity.
  assert(!PREFS.includes("getLastKnownLocation"), "the device-anchor proximity effect is removed");
  assert(!PREFS.includes("setProximity"), "the proximity state setter is removed");
});

Deno.test("P-2c: the removed host suggestion state is GONE (dead forward path deleted)", () => {
  assert(!PREFS.includes("setShowSuggestions"), "showSuggestions state removed");
  assert(!PREFS.includes("handleSuggestionSelect"), "handleSuggestionSelect removed");
});

// ── OQ-4: CityPickerSheet shares the same rank bias ───────────────────────────
Deno.test("OQ-4: CityPickerSheet threads proximity into the shared field (NO country filter)", () => {
  assertStringIncludes(CITY, "proximity={proximity}", "CityPicker threads proximity");
  assertStringIncludes(CITY, "getLastKnownLocation", "CityPicker resolves the device anchor");
  // FILTER-FREE contract (INV-3 / ORCH-1079).
  assert(!CITY.includes("country={country}"), "CityPicker must not thread a country filter");
});

// ── OQ-1: behavioral omit-when-absent model ───────────────────────────────────
// Mirrors the host/CityPicker resolution: device present → proximity;
// no device location → omitted (never a hardcoded default). This is the
// contract the mapboxGeocodeService merges "only when present". NO country —
// proximity biases ranking without excluding results (INV-3 / ORCH-1079).
function biasFromDevice(
  loc: { longitude: number; latitude: number } | null,
): { proximity?: string } {
  if (!loc) return {}; // OQ-1: no device location → omit
  return { proximity: `${loc.longitude},${loc.latitude}` };
}

Deno.test("OQ-1a: device location available → proximity sent (rank-only, no country)", () => {
  const b = biasFromDevice({ longitude: 3.4, latitude: 6.45 });
  assertEquals(b.proximity, "3.4,6.45");
  assert(!("country" in b), "no country filter — proximity biases ranking without excluding");
});

Deno.test("OQ-1c: NO device location → no proximity (never a hardcoded default)", () => {
  const b = biasFromDevice(null);
  assert(!("proximity" in b), "omit proximity when no device location");
});
