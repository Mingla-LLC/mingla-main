// @ts-nocheck — Deno-runtime source-structure suite (Deno globals + deno.land
// import); the app-mobile tsc sweep has no Deno types (house convention — see
// orch-1361-preferences-location-multirow-bias.test.tsx). Deno checks it at run.
//
// ORCH-1365 [location-search-relevance] — implementor-owned regression guard
// (SPEC §7 T-8/T-9, §9). CORRECTIVE to ORCH-1361: encodes the "non-Lagos user
// finds Lekki Lagos" contract that ORCH-1361 lacked (it only proved a simulated-
// Lagos happy path). Source-structure suite in the 1315/1341/1361 house style.
//
// PROTECTIVE COMMENT — the Preferences custom-location field is a "search a place
// you are NOT at" field. It MUST route through the `places` search mode
// (edge `suggest_places`: place-type filter + trailing-country strip + country
// ISO bias) and MUST NOT bias by device proximity (OQ-4 — proximity buried the
// target place for a non-local user). The BUSINESS venue-name search stays on the
// separate filter-free `suggest` path (INV-3 / ORCH-1079).
//
// Enforces:
//   T-8a: PreferencesSectionsAdvanced passes searchMode="places" (+ keeps
//         suggestLimit=8, the ≥4-char gate, onPick, and the hasSelected chip),
//         and NO longer threads `proximity` / any `types` filter.
//   T-8b: PreferencesSheet drops the device-proximity path entirely — no
//         `proximity` threaded, no `getLastKnownLocation`/`setProximity` effect,
//         no `proximity` state.
//   T-8c: the I-1315 co-guard (`!useGpsLocation && !isLocked`) is preserved.
//   T-9a: the shared MapboxAddressInput routes by searchMode — `places` →
//         autocompletePlacesMapbox, default/venue → autocompleteMapbox (business
//         path UNCHANGED).
//   T-9b: the consumer wrapper forwards searchMode + injects the gorhom-aware
//         BottomSheetScrollView (card-list scroll fix, F-5).
//   T-9c: the input text-clip fix (F-6) — the forced `lineHeight: 24` is removed
//         from the shared field's TextInput; Android uses textAlignVertical.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - revert `searchMode="places"` → T-8a FAILS;
//   - re-introduce `proximity={proximity}` on the field OR the getLastKnownLocation
//     proximity effect in the host → T-8a / T-8b FAIL (this is the exact gap that
//     let ORCH-1361 through);
//   - revert the shared component's searchMode routing → T-9a FAILS;
//   - restore the forced `lineHeight: 24` on the TextInput → T-9c FAILS.
//
// Run: deno test --allow-read --no-check \
//   app-mobile/src/components/__tests__/orch-1365-preferences-places-no-proximity.test.tsx

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url).pathname);

// Strip // line comments FIRST (the `[^:]` guard protects `https://` URLs), THEN
// /* */ block comments (covers {/* JSX */}).
function stripComments(src: string): string {
  return src
    .replace(/([^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const ADVANCED = stripComments(
  await read("../PreferencesSheet/PreferencesSectionsAdvanced.tsx"),
);
const PREFS = stripComments(await read("../PreferencesSheet.tsx"));
const WRAPPER = stripComments(await read("../location/MapboxAddressInput.tsx"));
const SHARED = stripComments(
  await read("../../../../packages/location-input/src/MapboxAddressInput.tsx"),
);

// ── T-8a: Preferences field routes through the `places` mode, no proximity ─────
Deno.test("T-8a: PreferencesSectionsAdvanced passes searchMode=\"places\" + keeps config", () => {
  assertStringIncludes(ADVANCED, 'searchMode="places"', "field must use places mode (POIs dropped + country strip)");
  assertStringIncludes(ADVANCED, "suggestLimit={8}", "consumer multi-row limit preserved");
  assertStringIncludes(ADVANCED, "minQueryLength={4}", "≥4-char gate preserved");
  assertStringIncludes(ADVANCED, "onPick={onPickLocation}", "pick routes to the host");
  assertStringIncludes(ADVANCED, "hasSelected ?", "chip shows on a resolved location");
});

Deno.test("T-8a: the device-proximity prop + any types filter are GONE from the field", () => {
  assert(!ADVANCED.includes("proximity"), "proximity must not be threaded to the field (OQ-4)");
  assert(!ADVANCED.includes("types="), "no types filter leaked into the host");
  assert(!ADVANCED.includes("country={"), "no country filter threaded from the host");
});

// ── T-8b: the host drops the device-proximity path entirely ───────────────────
Deno.test("T-8b: PreferencesSheet no longer threads proximity to LocationInputSection", () => {
  assert(!PREFS.includes("proximity"), "host must not thread proximity (the retired ORCH-1361 lever)");
});

Deno.test("T-8b: the getLastKnownLocation proximity effect + proximity state are removed", () => {
  assert(!PREFS.includes("getLastKnownLocation"), "the proximity-resolution effect is removed");
  assert(!PREFS.includes("setProximity"), "the proximity state setter is removed");
});

// ── T-8c: I-1315 paywall co-guard preserved ───────────────────────────────────
Deno.test("T-8c: the `!useGpsLocation && !isLocked` custom-field guard is preserved (I-1315)", () => {
  assert(
    /!useGpsLocation\s*&&\s*!isLocked/.test(ADVANCED),
    "the custom-field guard (I-1315 co-guard) must be preserved",
  );
});

// ── T-9a: the shared component routes by searchMode ───────────────────────────
Deno.test("T-9a: shared MapboxAddressInput routes by searchMode (places vs venue/business)", () => {
  assertStringIncludes(SHARED, 'searchMode === "places"', "must branch on the places mode");
  assertStringIncludes(SHARED, "autocompletePlacesMapbox(", "places → the place-search service");
  assertStringIncludes(SHARED, "autocompleteMapbox(", "venue/default → the business service (unchanged)");
  // default is venue so business callers that omit searchMode are byte-identical.
  assertStringIncludes(SHARED, 'searchMode = "venue"', "default preserves business behavior");
});

// ── T-9b: the consumer wrapper forwards searchMode + injects the scroll container
Deno.test("T-9b: consumer wrapper forwards searchMode + injects BottomSheetScrollView (F-5)", () => {
  assertStringIncludes(WRAPPER, "searchMode={searchMode}", "wrapper forwards searchMode");
  // [TEST-MOD-APPROVED ORCH-1362] — the gorhom scroll injection is now GATED by
  // `inBottomSheet` (default true) so the shared field can fall back to a plain
  // RN ScrollView on non-sheet hosts (Onboarding). Preferences/CityPicker pass
  // no flag → default true → still inject BottomSheetScrollView (F-5 preserved).
  assertStringIncludes(WRAPPER, "ScrollComponent={inBottomSheet ? BottomSheetScrollView : undefined}", "wrapper injects the gorhom scroll container when in a sheet (default)");
  assertStringIncludes(WRAPPER, "BottomSheetScrollView", "wrapper imports BottomSheetScrollView");
  // the shared field actually consumes the injected scroll container.
  assertStringIncludes(SHARED, "ScrollComponent", "shared field accepts a ScrollComponent");
  assertStringIncludes(SHARED, "keyboardShouldPersistTaps", "the scroll list keeps taps working");
});

// ── T-9c: input text-clip fix (F-6) ───────────────────────────────────────────
Deno.test("T-9c: the forced lineHeight:24 is removed from the TextInput; Android centers vertically", () => {
  assert(!SHARED.includes("lineHeight: 24"), "the forced lineHeight:24 (descender clip) is removed");
  assertStringIncludes(SHARED, 'textAlignVertical: "center"', "Android centers text vertically instead of squeezing descenders");
});
