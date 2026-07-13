// @ts-nocheck — Deno-runtime source-structure suite (Deno globals + deno.land
// import); the app-mobile tsc sweep has no Deno types (house convention — see
// orch-1362-onboarding-location-places.test.tsx / orch-1365-*.test.tsx). Deno
// checks it at run.
//
// ORCH-1362 [onboarding-location] — TESTER adversarial regression guard.
// DIFFERENT ANGLE than the implementor's happy-path suite
// (orch-1362-onboarding-location-places.test.tsx). The implementor's tests prove
// the *producer* links of the no-crash chain (onboarding passes
// inBottomSheet={false}; the wrapper maps that to `undefined`) and the *presence*
// of the PlaceDetails→selectedLocation mapping. They do NOT prove:
//
//   A-1  the *consumer* link of the no-crash chain — that the SHARED field
//        actually falls back to RN when the component prop is `undefined`, and
//        that the shared field can NEVER render a gorhom node on its own (no
//        direct @gorhom import; the only gorhom nodes are the injected props).
//        If a refactor broke `?? RNScrollView` or added a hardcoded
//        <BottomSheet*> to the shared field, onboarding would crash EVEN WITH
//        inBottomSheet={false} intact — and every implementor test would still
//        pass. This suite closes that hole.
//   A-2  the *precedence* of the display-name mapping. The implementor's T-4
//        asserts that BOTH `details.city` and `details.formattedAddress` appear,
//        but not their ORDER. A regression to `formattedAddress || city` (chip
//        shows a full POI address instead of the city) passes T-4 yet is wrong.
//        A-2 pins `details.city || details.formattedAddress` (city FIRST).
//   A-3  the producer↔consumer coordinate KEY-PATH join. The mapper WRITES
//        `selectedLocation.location = {lat,lng}` and the UNCHANGED confirm READS
//        `selectedLocation.location?.lat/?.lng`. T-4 checks the write and T-5
//        checks the read, but neither checks the two KEY PATHS MATCH. If the
//        mapper wrote `.coords`/`.coordinates` instead, confirm would silently
//        lose the picked coords (fall through to the native-geocoder fallback).
//        A-3 pins both ends to the SAME `.location.{lat,lng}` path.
//   A-4  the crash-vector negative on the host — onboarding must import NO
//        @gorhom/bottom-sheet and render NO <BottomSheet*> node around the
//        plain-screen field.
//
// FAILS-ON-REVERT: A-2 and A-3 reference `handlePickLocationDetails`, which is
// DELETED when the swap is reverted to the old geocodingService.autocomplete()
// path → RED. (A-1/A-4 are standing invariants that guard the OTHER half of the
// mechanism the implementor suite leaves unguarded.)
//
// Run: deno test --allow-read --no-check \
//   app-mobile/src/components/__tests__/orch-1362-onboarding-location-adversarial.test.tsx

import {
  assert,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url).pathname);

// Strip // line comments FIRST (`[^:]` guard protects `https://`), THEN /* */
// block comments — so absence/precedence assertions ignore the source comments.
function stripComments(src: string): string {
  return src
    .replace(/([^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const ONBOARDING = stripComments(await read("../OnboardingFlow.tsx"));
const WRAPPER = stripComments(await read("../location/MapboxAddressInput.tsx"));
const SHARED = stripComments(
  await read("../../../../packages/location-input/src/MapboxAddressInput.tsx"),
);

// ── A-1: the SHARED field is the missing consumer half of the no-crash chain ──
// inBottomSheet={false} → wrapper passes `undefined` → the shared field MUST turn
// `undefined` into a plain RN component. If this fallback is gone, or the shared
// field ever renders gorhom on its own, the plain onboarding screen crashes.
Deno.test("A-1: shared field falls back to RN on undefined AND imports no gorhom itself (no-crash chain, consumer link)", () => {
  // the undefined→RN fallback for BOTH the text input and the scroll container
  assertMatch(
    SHARED,
    /TextInputComponent\s*\?\?\s*RNTextInput/,
    "shared field must fall back TextInputComponent ?? RNTextInput (undefined → plain RN TextInput)",
  );
  assertMatch(
    SHARED,
    /ScrollComponent\s*\?\?\s*RNScrollView/,
    "shared field must fall back ScrollComponent ?? RNScrollView (undefined → plain RN ScrollView)",
  );
  // the shared field must NEVER import gorhom directly — the ONLY gorhom nodes are
  // the injected props, so inBottomSheet={false} (undefined props) can never mount
  // a gorhom node.
  assert(
    !/from\s+['"]@gorhom\/bottom-sheet['"]/.test(SHARED),
    "shared field must NOT import @gorhom/bottom-sheet directly (gorhom arrives ONLY via injected props)",
  );
  // and no hardcoded <BottomSheet*> node hides in the shared field render
  assert(
    !/<BottomSheet[A-Za-z]*/.test(SHARED),
    "shared field must render NO hardcoded <BottomSheet*> node (would crash a plain-screen host regardless of inBottomSheet)",
  );
});

// ── A-1b: the consumer WRAPPER renders no gorhom node of its own ───────────────
// The wrapper imports gorhom to INJECT it, but must render only the shared field.
// A stray <BottomSheetView> wrapper here would crash onboarding even with the
// injection gated off.
Deno.test("A-1b: consumer wrapper renders only the shared field, no gorhom node of its own", () => {
  assertMatch(
    WRAPPER,
    /<SharedMapboxAddressInput/,
    "wrapper must render the shared field",
  );
  assert(
    !/<BottomSheet[A-Za-z]*/.test(WRAPPER),
    "wrapper must render NO <BottomSheet*> node itself (gorhom is injected as props, never mounted here)",
  );
});

// ── A-2: display-name precedence is city FIRST (order-sensitive) ──────────────
// A regression to `formattedAddress || city` shows a full POI address in the chip
// yet passes the implementor's presence-only T-4. Pin the exact order.
Deno.test("A-2: handlePickLocationDetails maps displayName city-FIRST (details.city || details.formattedAddress)", () => {
  assertMatch(
    ONBOARDING,
    /displayName:\s*details\.city\s*\|\|\s*details\.formattedAddress/,
    "selectedLocation.displayName must be city FIRST, formattedAddress fallback (never the reverse)",
  );
  assertMatch(
    ONBOARDING,
    /setManualLocationText\(\s*details\.city\s*\|\|\s*details\.formattedAddress\s*\)/,
    "the field text must also be set city-FIRST so the chip reads the city, not a POI address",
  );
  // negative: the flipped precedence must NOT appear
  assert(
    !/details\.formattedAddress\s*\|\|\s*details\.city/.test(ONBOARDING),
    "the flipped precedence (formattedAddress || city) must not exist",
  );
});

// ── A-3: producer↔consumer coordinate KEY-PATH join ───────────────────────────
// The mapper WRITES selectedLocation.location.{lat,lng}; the UNCHANGED confirm
// READS selectedLocation.location?.{lat,lng}. Both ends must use the SAME path or
// the picked coords are silently dropped.
Deno.test("A-3: picked coords flow through the SAME selectedLocation.location.{lat,lng} key path (producer↔consumer join)", () => {
  // producer (the new mapper) writes the nested `location: {lat,lng}` shape
  assertMatch(
    ONBOARDING,
    /location:\s*\{\s*lat:\s*details\.location\.lat,\s*lng:\s*details\.location\.lng\s*\}/,
    "mapper must write selectedLocation.location = {lat: details.location.lat, lng: details.location.lng}",
  );
  // consumer (the unchanged confirm) reads the SAME nested path
  assertMatch(
    ONBOARDING,
    /selectedLocation\.location\?\.lat/,
    "confirm must read selectedLocation.location?.lat (same key path the mapper wrote)",
  );
  assertMatch(
    ONBOARDING,
    /selectedLocation\.location\?\.lng/,
    "confirm must read selectedLocation.location?.lng (same key path the mapper wrote)",
  );
});

// ── A-4: crash-vector negative on the host ────────────────────────────────────
// Onboarding is a plain SafeAreaView+ScrollView. It must not import gorhom nor
// wrap the plain-screen field in a <BottomSheet*> node.
Deno.test("A-4: onboarding host imports no @gorhom/bottom-sheet and wraps the field in no <BottomSheet*> node", () => {
  assert(
    !/from\s+['"]@gorhom\/bottom-sheet['"]/.test(ONBOARDING),
    "OnboardingFlow must not import @gorhom/bottom-sheet (plain-screen host — gorhom would crash)",
  );
  const PANEL = ONBOARDING.indexOf("renderManualLocationPanel");
  assert(PANEL !== -1, "renderManualLocationPanel must exist");
  const panelRegion = ONBOARDING.slice(PANEL, PANEL + 4000);
  assert(
    !/<BottomSheet[A-Za-z]*/.test(panelRegion),
    "the manual-location panel must render NO <BottomSheet*> node around the shared field",
  );
});
