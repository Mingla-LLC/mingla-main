// @ts-nocheck — Deno-runtime source-structure suite (Deno globals + deno.land
// import); the app-mobile tsc sweep has no Deno types (house convention — see
// orch-1365-preferences-places-no-proximity.test.tsx). Deno checks it at run.
//
// ORCH-1362 [onboarding-location] — implementor-owned regression guard
// (SPEC §7 T-1/T-2/T-3/T-6/T-7, §9). Follow-on to ORCH-1361 F-7 and the
// ORCH-1365 Preferences fix: the onboarding no-GPS "Choose your city" manual
// field must reuse the SAME shared place-search engine, not the retired
// hand-rolled forward/limit=1 single-shot.
//
// PROTECTIVE COMMENT — the onboarding manual-location field is a "type the city
// you live in" field shown when GPS is off/denied (Apple 5.1.5 no-GPS path). It
// MUST route through the shared @mingla/location-input `MapboxAddressInput` in
// `searchMode="places"` (edge `suggest_places`: place-type filter + trailing-
// country strip + country ISO bias + zero-result fallback) so "lekki" /
// "lekki nigeria" return a real multi-row list with Lekki, Lagos #1 (POIs
// dropped), instead of the single POI-polluted wrong-country row the old
// `geocodingService.autocomplete()` forward/limit=1 path produced. It MUST pass
// `inBottomSheet={false}` because onboarding is a plain SafeAreaView+ScrollView,
// NOT a gorhom <BottomSheet> — injecting gorhom's BottomSheetScrollView/
// BottomSheetTextInput OUTSIDE a <BottomSheet> THROWS. It MUST NOT thread
// `proximity` (a "search a place you are NOT at" field; §6/SC-4).
//
// The consumer wrapper's gorhom injection is now GATED by `inBottomSheet`
// (default true), so Preferences + CityPicker keep injecting BottomSheet* and
// render byte-identically (SC-3) — T-2/T-3 guard both sides of that gate.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - revert the onboarding swap back to geocodingService.autocomplete() /
//     drop `searchMode="places"` / drop `inBottomSheet={false}` / re-add the
//     `locationSearchTimer` debounce effect → T-1 / T-6 FAIL;
//   - drop the wrapper's `inBottomSheet ? BottomSheet... : undefined` gate
//     (e.g. hardcode BottomSheet* again) → T-2 FAIL; remove the default
//     `inBottomSheet = true` → T-3 FAIL (breaks Preferences/CityPicker parity);
//   - thread `proximity` onto the onboarding field → T-7 FAIL.
//
// Run: deno test --allow-read --no-check \
//   app-mobile/src/components/__tests__/orch-1362-onboarding-location-places.test.tsx

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url).pathname);

// Strip // line comments FIRST (the `[^:]` guard protects `https://` URLs), THEN
// /* */ block comments (covers {/* JSX */}). This is what lets the absence
// assertions ignore the explanatory comments in the source.
function stripComments(src: string): string {
  return src
    .replace(/([^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const ONBOARDING = stripComments(await read("../OnboardingFlow.tsx"));
const WRAPPER = stripComments(await read("../location/MapboxAddressInput.tsx"));

// Isolate the manual-location render panel so the absence assertions target the
// swapped block, not the whole 4k-line file (the confirm button + chip stay).
const PANEL_START = ONBOARDING.indexOf("renderManualLocationPanel");
assert(PANEL_START !== -1, "renderManualLocationPanel must exist");

// ── T-1: onboarding renders the shared field in places mode ───────────────────
Deno.test('T-1: OnboardingFlow renders <MapboxAddressInput searchMode="places" inBottomSheet={false}>', () => {
  assertStringIncludes(
    ONBOARDING,
    "import { MapboxAddressInput, type PlaceDetails } from './location/MapboxAddressInput'",
    "onboarding must import the shared consumer place-search wrapper",
  );
  assertStringIncludes(ONBOARDING, "<MapboxAddressInput", "the shared field must be rendered");
  assertStringIncludes(ONBOARDING, 'searchMode="places"', "onboarding must use the places engine (POIs dropped + country strip)");
  assertStringIncludes(ONBOARDING, "inBottomSheet={false}", "onboarding is a plain screen — gorhom injection must be OFF");
  assertStringIncludes(ONBOARDING, "suggestLimit={8}", "consumer multi-row limit");
  assertStringIncludes(ONBOARDING, "minQueryLength={3}", "onboarding gates at 3 chars (OQ-1)");
  assertStringIncludes(ONBOARDING, "onPick={handlePickLocationDetails}", "pick routes to the PlaceDetails→selectedLocation mapper");
  assertStringIncludes(ONBOARDING, "onClear={handleClearLocationSelection}", "clear resets the selection + text");
});

// ── T-2: wrapper OMITS gorhom when inBottomSheet is false ─────────────────────
Deno.test("T-2: consumer wrapper gates gorhom injection on inBottomSheet (plain-screen path)", () => {
  assertStringIncludes(
    WRAPPER,
    "TextInputComponent={inBottomSheet ? BottomSheetTextInput : undefined}",
    "TextInput injection must be conditional (undefined → RN TextInput fallback)",
  );
  assertStringIncludes(
    WRAPPER,
    "ScrollComponent={inBottomSheet ? BottomSheetScrollView : undefined}",
    "Scroll injection must be conditional (undefined → RN ScrollView fallback)",
  );
  // hardcoded gorhom injection (the pre-1362 form) must be gone — it crashes a
  // plain-screen host.
  assert(
    !WRAPPER.includes("TextInputComponent={BottomSheetTextInput}"),
    "the unconditional BottomSheetTextInput injection must be gone",
  );
  assert(
    !WRAPPER.includes("ScrollComponent={BottomSheetScrollView}"),
    "the unconditional BottomSheetScrollView injection must be gone",
  );
});

// ── T-3 (companion, SC-3): wrapper injects gorhom BY DEFAULT ───────────────────
// Guards Preferences + CityPicker parity: they pass no inBottomSheet, so the
// default MUST keep them on the gorhom-aware inputs.
Deno.test("T-3: consumer wrapper defaults inBottomSheet=true so Preferences/CityPicker keep gorhom (SC-3)", () => {
  assert(
    /inBottomSheet\s*=\s*true/.test(WRAPPER),
    "inBottomSheet must default to true (Preferences/CityPicker unchanged)",
  );
  // The wrapper still imports + references both gorhom-aware components (used
  // when inBottomSheet is true).
  assertStringIncludes(WRAPPER, "BottomSheetTextInput", "wrapper still uses BottomSheetTextInput when in a sheet");
  assertStringIncludes(WRAPPER, "BottomSheetScrollView", "wrapper still uses BottomSheetScrollView when in a sheet");
});

// ── T-4: the pick handler maps PlaceDetails → the existing selectedLocation shape
Deno.test("T-4: handlePickLocationDetails maps PlaceDetails → {displayName, fullAddress, location}", () => {
  assertStringIncludes(ONBOARDING, "handlePickLocationDetails", "the new pick handler must exist");
  assertStringIncludes(ONBOARDING, "(details: PlaceDetails)", "pick handler receives resolved PlaceDetails");
  assertStringIncludes(ONBOARDING, "details.formattedAddress", "maps formattedAddress → fullAddress");
  assertStringIncludes(ONBOARDING, "details.city", "maps city → displayName");
  assert(
    /location:\s*{\s*lat:\s*details\.location\.lat,\s*lng:\s*details\.location\.lng\s*}/.test(ONBOARDING),
    "maps details.location → selectedLocation.location {lat,lng}",
  );
});

// ── T-5: the confirm path (handleManualLocation) is UNCHANGED — writes coords +
// manualLocation and advances (goNext).
Deno.test("T-5: confirm still routes to handleManualLocation which writes coordinates + manualLocation + goNext", () => {
  assertStringIncludes(ONBOARDING, "onPress={handleManualLocation}", "the confirm button still calls handleManualLocation");
  assertStringIncludes(ONBOARDING, "coordinates: { lat: lat!, lng: lng! }", "confirm still writes data.coordinates");
  assertStringIncludes(ONBOARDING, "manualLocation: selectedLocation.displayName", "confirm still writes data.manualLocation");
  assertStringIncludes(ONBOARDING, "goNext()", "confirm still advances");
});

// ── T-6 (FAILS-ON-REVERT): onboarding uses the places field, NOT the retired
// forward/limit=1 path. This is the load-bearing guard for the F-7 contract.
Deno.test("T-6: the retired forward/autocomplete + debounce dropdown are GONE from onboarding", () => {
  // the shared places field is present (a different code path than forward/limit=1)
  assertStringIncludes(ONBOARDING, 'searchMode="places"', "onboarding must be on the places engine");
  assertStringIncludes(ONBOARDING, "inBottomSheet={false}", "onboarding must omit gorhom (plain screen)");
  // the old single-shot autocomplete call is gone from the file (comments stripped)
  assert(
    !ONBOARDING.includes("geocodingService.autocomplete("),
    "the retired geocodingService.autocomplete() call must be gone",
  );
  // the debounced search machinery is gone
  assert(!ONBOARDING.includes("locationSearchTimer"), "the debounce timer ref/effect must be removed");
  assert(!ONBOARDING.includes("setShowLocationSuggestions"), "the show-suggestions state must be removed");
  assert(!ONBOARDING.includes("setLocationSuggestions"), "the suggestions state must be removed");
  assert(!ONBOARDING.includes("handleSelectLocationSuggestion"), "the old row-select handler must be replaced");
  // the geocodingService runtime import is gone (inline type import survives; the
  // `.autocomplete(` call assertion above is the real guard against the old path)
  assert(
    !ONBOARDING.includes("import { geocodingService } from '../services/geocodingService'"),
    "the geocodingService runtime import must be removed (dead after the swap)",
  );
});

// ── T-7: no proximity threaded to the onboarding field (§6 / SC-4) ─────────────
Deno.test("T-7: onboarding threads NO proximity to the shared field", () => {
  // scope to the render panel → the confirm button to avoid matching unrelated
  // occurrences elsewhere in the 4k-line file.
  const panel = ONBOARDING.slice(PANEL_START, PANEL_START + 4000);
  assert(!panel.includes("proximity"), "onboarding must not thread proximity (search a place you are NOT at)");
});
