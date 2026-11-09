// #4334 — Explorer location on Google (spec v2 §4, A2, A3; matrix R-PREF-1..7,
// R-DECK-5/6, R-CITY-4/5, R-ONB-1, R-LOC-1). Deno source-structure + pure
// checks (these files import React Native and cannot run under Deno).
//
// The deck's location helpers keep their imports; the proxy never reaches the
// deck's "no matches" text (the R-DECK suites guard deck behaviour).
//
// Fails-on-revert (line deleted → red):
//   E-1 geocodingService: `throw new LocationSearchUnavailableError(code)`
//   E-2 PreferencesSheet: the inline unavailable message + return in the auto-resolve catch
//   E-3 PreferencesSheet / AppHandlers: custom_location_place_id in the solo save
//   E-4 CityPickerSheet: discover_city_place_id in the persisted fields
//   E-5 resolveOnboardingPlaceId's launch-city / GPS guard
//   E-6 DiscoverScreen: `stateCode: place.stateCode` (F-10)
//   E-8 the shared field's `lookup: "geocoding"` for places mode (A2)
//   E-9 PreferencesSheet: the outage message is scrolled into view (sheet scroller bound) and announced (R3-3)
//   E-10 PreferencesSheet: topInset caps the sheet below the safe area while typing (R3-5)

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveOnboardingPlaceId } from "../../utils/onboardingLocationOverride.ts";

const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

Deno.test("E-1 A3.4: geocodingService splits 'no match' ([]) from 'search unavailable' (typed throw)", async () => {
  const src = strip(await read("../geocodingService.ts"));
  assertStringIncludes(src, 'const NO_MATCH_CODES: ReadonlySet<string> = new Set(["no_location", "no_locality", "query_required"]);');
  assertStringIncludes(src, "if (NO_MATCH_CODES.has(code)) return [];");
  assertStringIncludes(src, "reportAddressSearchUnavailable(code);");
  assertStringIncludes(src, "throw new LocationSearchUnavailableError(code);");
  // A3.3 — the typed-and-saved anchor carries its Google place id.
  assertStringIncludes(src, "...(details.placeId ? { placeId: details.placeId } : {}),");
  // A3.6 — the 5-minute cache and its key are unchanged.
  assertStringIncludes(src, "const cacheKey = query.toLowerCase().trim();");
  assertStringIncludes(src, "AUTOCOMPLETE_CACHE_TTL = 5 * 60 * 1000");
  // F-10 — the code column reads the ISO code.
  assertStringIncludes(src, "stateCode: details.regionCode || undefined,");
});

Deno.test("E-2 R-PREF-6 / N-5: a search outage on Save says so INLINE under the field (not a toast behind the sheet) and saves nothing", async () => {
  const raw = await read("../../components/PreferencesSheet.tsx");
  const src = strip(raw);
  // the exact copy, said inline in the sheet
  assertStringIncludes(raw, "'Location search is unavailable right now. Try again, or turn on Use my location.'");
  const block = src.slice(src.indexOf("await geocodingService.autocomplete(searchLocation)"));
  const catchAt = block.indexOf("} catch (err) {");
  const catchBody = block.slice(catchAt, block.indexOf("if (!resolvedSuggestion || !resolvedCoords)"));
  assertStringIncludes(catchBody, "isSavingRef.current = false;");
  assertStringIncludes(catchBody, "setLocationUnavailable(true);");
  assertStringIncludes(catchBody, "return;");
  assertEquals(catchBody.includes("toastManager.error("), false, "the outage must not be a toast (it renders behind the sheet)");
  // rendered in the sheet, beside the field's own warning, as an alert
  assertStringIncludes(src, "{LOCATION_SEARCH_UNAVAILABLE_COPY}");
  assertStringIncludes(src, 'testID="preferences-location-unavailable"');
  assertStringIncludes(src, 'accessibilityRole="alert"');
  // a new attempt clears it (typing, clearing, picking, GPS)
  for (const fn of ["handleLocationInputChange", "handleClearLocation", "handlePickLocation", "handleGpsToggle"]) {
    const body = src.slice(src.indexOf(`const ${fn} = useCallback(`), src.indexOf(`const ${fn} = useCallback(`) + 400);
    assertStringIncludes(body, "setLocationUnavailable(false);", fn);
  }
  // The "no match" path is unchanged: an honest empty answer keeps its toast.
  assertStringIncludes(block, "toastManager.warning('Tap a suggestion to set your location.', 3000);");
});

Deno.test("E-3 R-PREF-3/4/5: the place id of a picked or typed location is saved (solo), null with GPS", async () => {
  const sheet = strip(await read("../../components/PreferencesSheet.tsx"));
  assertStringIncludes(sheet, "setSelectedPlaceId(details.placeId || null);");
  assertStringIncludes(sheet, "effectivePlaceId = resolvedSuggestion.placeId ?? null;");
  assertStringIncludes(sheet, "custom_location_place_id: useGpsLocation ? null : (effectivePlaceId ?? null),");
  const handlers = strip(await read("../../components/AppHandlers.tsx"));
  assertStringIncludes(handlers, "dbPreferences.custom_location_place_id = preferences.custom_location_place_id ?? null;");
});

Deno.test("E-4 R-CITY-5: the city picker saves the Google place id with the five discover_city fields", async () => {
  const src = strip(await read("../../components/discover/CityPickerSheet.tsx"));
  assertStringIncludes(src, "discover_city_place_id: details.placeId || null,");
  assertStringIncludes(src, "discover_city_state_code: details.regionCode,");
  assert(!src.includes("suggestLimit"));
});

Deno.test("E-5 R-ONB-1: onboarding saves the pick's place id, never for GPS or the launch-city gate", () => {
  assertEquals(resolveOnboardingPlaceId({ useGpsLocation: false, cityName: null, manualLocationPlaceId: "ChIJlagos_000001" }), "ChIJlagos_000001");
  assertEquals(resolveOnboardingPlaceId({ useGpsLocation: true, cityName: null, manualLocationPlaceId: "ChIJlagos_000001" }), null);
  assertEquals(resolveOnboardingPlaceId({ useGpsLocation: false, cityName: "Lagos", manualLocationPlaceId: "ChIJlagos_000001" }), null);
  assertEquals(resolveOnboardingPlaceId({ useGpsLocation: false, cityName: null, manualLocationPlaceId: "  " }), null);
});

Deno.test("E-6 R-CITY-4 / F-10: Discover's device city stores the ISO code, not the region name", async () => {
  const src = strip(await read("../../components/DiscoverScreen.tsx"));
  assertStringIncludes(src, "stateCode: place.stateCode ?? null");
  assert(!src.includes("stateCode: place.state ?? null"));
});

Deno.test("E-7 R-DECK-5: the deck's 'no matches' text stays on the phone's own geocoder", async () => {
  const src = await read("../../utils/throttledGeocode.ts");
  const imports = [...src.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assertEquals(imports.filter((i) => !i.startsWith("expo-location")), []);
  assert(!/geocodingService|location-input|functions\.invoke/.test(src));
});

Deno.test("E-7b R-DECK-6/7 / R-PREF-7: useUserLocation keeps saved coordinates first and still catches the forward fallback", async () => {
  const src = await read("../../hooks/useUserLocation.ts");
  const savedFirst = src.indexOf("if (customLat != null && customLng != null)");
  const fallback = src.indexOf("await geocodingService.autocomplete(customLocation)");
  assert(savedFirst > -1 && fallback > savedFirst, "saved coordinates are used before any lookup");
  const after = src.slice(fallback);
  assert(/\} catch \{/.test(after.slice(0, 600)), "the forward fallback is still caught (a thrown outage keeps the old behaviour)");
});

Deno.test("E-8 A2: Explorer place picks take coordinates from Geocoding by place id", async () => {
  const src = strip(await read("../../../../packages/location-input/src/AddressInput.tsx"));
  assertStringIncludes(src, 'searchMode === "places" ? { lookup: "geocoding" } : {}');
});

Deno.test("E-9 R3-3: in the sheet, the outage message is scrolled into view and announced", async () => {
  const raw = await read("../../components/PreferencesSheet.tsx");
  const src = strip(raw);
  const block = src.slice(src.indexOf("await geocodingService.autocomplete(searchLocation)"));
  const catchBody = block.slice(block.indexOf("} catch (err) {"), block.indexOf("if (!resolvedSuggestion || !resolvedCoords)"));
  assertStringIncludes(catchBody, "scrollRef.current?.scrollTo?.({ y: Math.max(0, locationSectionY.current - 16), animated: true });");
  assertStringIncludes(catchBody, "AccessibilityInfo.announceForAccessibility(LOCATION_SEARCH_UNAVAILABLE_COPY);");
  // the scroll lands in SHEET mode too: the sheet's scroller is bound to scrollRef
  const sheet = src.slice(src.indexOf("<BaseBottomSheet"), src.indexOf("</BaseBottomSheet>"));
  assert(/scrollProps=\{\{\s*ref: scrollRef,/.test(sheet), "the sheet's scroll view is bound to scrollRef");
});

Deno.test("E-10 R3-5: the Preferences sheet stops below the safe area while typing (same cap as the city sheet)", async () => {
  const src = strip(await read("../../components/PreferencesSheet.tsx"));
  const sheet = src.slice(src.indexOf("<BaseBottomSheet"), src.indexOf("</BaseBottomSheet>"));
  assertStringIncludes(sheet, 'keyboardBehavior="interactive"');
  assertStringIncludes(sheet, "topInset={Math.max(0, insets.top) + 8}");
  const city = strip(await read("../../components/discover/CityPickerSheet.tsx"));
  assertStringIncludes(city, "topInset={Math.max(0, insets.top) + 8}");
});
