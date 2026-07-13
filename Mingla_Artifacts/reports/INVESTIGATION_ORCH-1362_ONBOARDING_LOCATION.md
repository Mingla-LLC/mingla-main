# INVESTIGATION — ORCH-1362 [onboarding-location]

**Apply the shipped ORCH-1365 place-search engine to the onboarding manual-location field.**
Scoped confirmation investigation — the fix engine already exists and is proven (ORCH-1365 shipped),
so this report confirms the host, the broken path, the reuse targets, and the one design blocker.

- **Worktree:** `~/Desktop/mingla-orchs/1362-[onboarding-location]/` on `1362-onboarding-location` (rebased onto origin/main — contains ORCH-1361 + ORCH-1365).
- **Evidence:** `Mingla_Artifacts/evidence/ORCH-1362/broken_path_and_engine_facts.txt`
- **Predecessors:** `INVESTIGATION_ORCH-1361_LOCATION_SUGGESTIONS.md` (F-7 registered this follow-on); `SPEC_ORCH-1365_LOCATION_SEARCH_RELEVANCE.md` (the engine).

---

## Symptom summary

**Expected:** In onboarding, a user with GPS off/denied who types their city (e.g. "lekki", "lagos
nigeria") sees a real multi-row list of PLACES and picks the right one.
**Actual:** The onboarding "Choose your city" field routes through `geocodingService.autocomplete()`
→ edge `forward` action (`limit=1`) → a single best-match row that is POI-polluted and server-IP
wrong-country (e.g. `forward "lekki, Nigeria"` → "Lekki London Nigerian Restaurant, London, GB").
A multi-row list is structurally impossible on this path. This is the exact class ORCH-1365 fixed for
Preferences, flagged by ORCH-1361 F-7 as the onboarding follow-on.

---

## Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `SPEC_ORCH-1365_LOCATION_SEARCH_RELEVANCE.md` | The shipped engine + §12 zero-result fallback |
| 2 | `packages/location-input/src/MapboxAddressInput.tsx` | The `searchMode`/`ScrollComponent`/`TextInputComponent` props + RN fallbacks |
| 3 | `packages/location-input/src/mapboxGeocodeService.ts` | `autocompletePlacesMapbox`, `forwardGeocodeMapbox`, `PlaceDetails` shape |
| 4 | `supabase/functions/mapbox-geocode/index.ts` | Confirm `suggest_places` DEPLOYED (no edge change) |
| 5 | `app-mobile/src/components/location/MapboxAddressInput.tsx` | Consumer wrapper (tokens/copy) — the hardcoded gorhom injection |
| 6 | `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | Reference host wiring (`searchMode="places"`, onPick) |
| 7 | `app-mobile/src/components/OnboardingFlow.tsx` | The broken host: state, debounced effect, handlers, render |
| 8 | `app-mobile/src/services/geocodingService.ts` | The single-shot `autocomplete()` (forward/limit=1) |
| 9 | `app-mobile/src/components/onboarding/OnboardingShell.tsx` | Host chrome — plain ScrollView, NOT a gorhom sheet |
| 10 | `app-mobile/src/components/onboarding/LaunchCityPicker.tsx` | Confirm it is the separate frozen-cities GATE (out of scope) |

---

## Q-scorecard

**Q1 — Which onboarding component + field is the target?**
Verdict: **PROVEN.** `app-mobile/src/components/OnboardingFlow.tsx` — the ORCH-1230 no-GPS "Choose
your city" manual-location panel (`renderManualLocationPanel`, `:2784`, mounted at `:3052/:3101/:3146`
in idle/settings/error location states). Its search field is a hand-rolled `TextInput` (`:2813`) +
custom dropdown (`:2828`). NOT `LaunchCityPicker` (that is the ORCH-1028 launch-city gate, which
filters a FROZEN live-cities list — never free-text geocode, DEC-1028-6 — and is out of scope).

**Q2 — Is the broken path the forward/limit=1 single-shot?**
Verdict: **PROVEN (cited, live-proven in ORCH-1361).** `OnboardingFlow.tsx:991` →
`geocodingService.autocomplete()` (`geocodingService.ts:203-234`) → `forwardGeocodeMapbox` → edge
`forward` (`limit=1`) wrapped into a one-element array (`:217-223`). No `types`, no `country`,
proximity defaults to the edge-datacenter IP. ORCH-1361 F-7 (`INVESTIGATION_ORCH-1361:127-129`)
registered this exact line as the follow-on. (F-1)

**Q3 — Design context / injected tokens?**
Verdict: **PROVEN.** Onboarding uses a LIGHT glass canvas (`OnboardingShell` → SafeAreaView +
KeyboardAwareView + plain RN `ScrollView`; `backgroundWarmGlow`). The right token bundle already
exists: the consumer wrapper's `LIGHT_TOKENS` (`dropdown.mode: "card"`) — the same variant
Preferences uses. Reuse `variant="light"`, `leadingIcon="location"`. (F-2)

**Q4 — Proximity: pass it or not?**
Verdict: **DECIDED — no proximity.** The panel exists BY DEFINITION for the no-GPS case (Location
Services off / permission denied / not-yet-requested — the ORCH-1230 path); a device anchor is
usually unavailable exactly when this field is shown. The place-type filter + trailing-country strip
(which handles "lagos nigeria") are the real wins and need no proximity. This matches the shipped
Preferences posture (`searchMode="places"`, no proximity). (F-3)

**Q5 — Any paywall gating? What does a pick DO downstream?**
Verdict: **PROVEN.** NO Mingla+ paywall on this field (no `isLocked`/`onLockedTap` in `:2784-2877`);
onboarding is pre-account. A pick must yield COORDINATES: `handleManualLocation` (`:1768`) reads
`selectedLocation.location.{lat,lng}` → writes `data.manualLocation` (city name) + `data.coordinates`,
calls `goNext()`, then background locale-detect; final save persists with `use_gps_location=false`.
The swap must preserve this: the new `onPick(details: PlaceDetails)` maps `details` →
`{displayName: details.city, fullAddress: details.formattedAddress, location: details.location}` so
`handleManualLocation` is UNCHANGED. (F-4)

**Q6 — Client-only? Any edge change?**
Verdict: **PROVEN.** `suggest_places` is already deployed (`index.ts:116/:231/:411`). The change is a
pure client swap → OTA-able. Consumer OTA is LIVE at runtime 1.1.1 (COMMS-0095). No edge fn, no
migration. (F-5)

**Q7 — Can onboarding reuse the existing consumer wrapper as-is?**
Verdict: **PROVEN — NO, one blocker.** The consumer wrapper hardcodes
`ScrollComponent={BottomSheetScrollView}` (`:246`) and `TextInputComponent={BottomSheetTextInput}`
(`:244`). gorhom v5.2.8 `BottomSheetScrollView` calls `useBottomSheetInternal()` and THROWS outside a
`<BottomSheet>`. Onboarding is a plain screen (Q3) → dropping the wrapper in would hard-crash when the
card-mode list wraps rows in the ScrollComponent (shared component `:516`). Fix: extend the wrapper
with an optional `inBottomSheet` flag (default true) that OMITS the gorhom injections when false — the
shared field then falls back to plain RN `TextInput`/`ScrollView` (its documented non-sheet path,
component doc `:24`). (F-6)

---

## Findings

### F-1 — Onboarding field is forward/limit=1 (single wrong row) — CONFIRMED ROOT CAUSE
- **Symptom:** onboarding "type your city" shows ≤1 POI-polluted, wrong-country result.
- **Layer:** code (service) + runtime (edge).
- **Probe:** read `OnboardingFlow.tsx:976-1005, :991`; `geocodingService.ts:203-234`; cite ORCH-1361 live `forward` probes A1–A3.
- **Evidence:** `:991 const results = await geocodingService.autocomplete(...)`; `geocodingService.ts:216-223` wraps `forwardGeocodeMapbox` best match into `[ {…} ]`. ORCH-1361 live: `forward "lekki, Nigeria"` → `{"city":"London","countryCode":"GB",…}`.
- **Mechanism:** forward action → `limit=1` → one feature → one-element array → the dropdown can render at most one row, chosen by POI-inclusive, IP-biased forward ranking.
- **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — LIGHT_TOKENS variant is the correct injected design — (context, not a defect)
- **Evidence:** consumer wrapper `LIGHT_TOKENS` (`:93-147`, `dropdown.mode:"card"`, `maxHeight:280`), used by Preferences today. `OnboardingShell` light glass canvas matches.
- **Severity:** N/A (design context).

### F-3 — No device anchor at onboarding-time — SUPPORTS no-proximity — (decision support)
- **Evidence:** `renderManualLocationPanel` is gated on `manualLocationOpen` and mounted only in the idle/settings/error location states (`:3052/:3101/:3146`) — the ORCH-1230 no-GPS path.
- **Severity:** N/A (justifies Q4).

### F-4 — Pick must carry coords; `handleManualLocation` consumes `selectedLocation.location` — CONSTRAINT
- **Evidence:** `OnboardingFlow.tsx:1773-1780` reads `selectedLocation.location.lat/lng` → `data.coordinates`. `PlaceDetails.location:{lat,lng}` (`mapboxGeocodeService.ts:59`) supplies it via the retrieve round-trip fired by `onPick`.
- **Severity:** CONFIRMED CONSTRAINT (spec must preserve).

### F-5 — Client-only, OTA-able, no edge change — SCOPE FACT
- **Evidence:** `index.ts:116` action union already contains `suggest_places`; `:411 handleSuggestPlaces` deployed. No DB touch.
- **Severity:** N/A (scope guard).

### F-6 — Consumer wrapper's hardcoded gorhom injection crashes on a non-sheet host — CONFIRMED BLOCKER
- **Symptom:** would throw at render in onboarding.
- **Layer:** code (component).
- **Probe:** read consumer wrapper `:244/:246`; `OnboardingShell.tsx:271-300`; `package.json` gorhom `^5.2.8`; shared component `:493/:516` (Scroll wrap) + `:24` (non-sheet fallback doc).
- **Evidence:** wrapper `:246 ScrollComponent={BottomSheetScrollView}`; onboarding chrome is plain RN ScrollView; gorhom v5 `BottomSheetScrollView` requires a `<BottomSheet>` ancestor.
- **Mechanism:** LIGHT_TOKENS `dropdown.mode:"card"` → the field wraps the suggestion rows in `Scroll = ScrollComponent ?? RNScrollView` (`:493/:516`); an injected `BottomSheetScrollView` with no sheet ancestor throws `useBottomSheetInternal` → hard crash.
- **Severity:** CONFIRMED BLOCKER (drives the wrapper's `inBottomSheet` prop).

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction |
|-------|-------|---------------|
| Docs | Consumer wrapper doc lists "Onboarding" as a light-variant host (`:11`) and documents the non-sheet RN fallback (`:24`). | Aspirational — onboarding is NOT wired to the wrapper today (still uses `geocodingService.autocomplete`). |
| Schema | No DB change; `suggest_places` action exists in the edge fn. | none |
| Code | Onboarding calls forward/limit=1; wrapper hardcodes gorhom. | Wrapper cannot mount on a non-sheet host (F-6). |
| Runtime | ORCH-1361 proved forward returns POI/wrong-country; ORCH-1365 proved `suggest_places` returns the real place. | none — engine reachable. |
| Data | Pick writes `data.coordinates` + `data.manualLocation`; final save `use_gps_location=false`. | Coords must come from `onPick`→retrieve, not the suggestion (F-4). |

---

## Repro evidence

Not independently sim-run: the field is I-1230 no-GPS-gated and requires a full onboarding run; the
broken mechanism is **source-proven here and runtime-proven in ORCH-1361** (`forward "lekki, Nigeria"`
→ London GB, evidence cited `INVESTIGATION_ORCH-1361:149-151`). The fix mechanism is runtime-proven in
ORCH-1365 (`suggest_places "lekki nigeria"` → Lekki Lagos #1). Confidence: **proven (by citation of the
sibling live-fire) for the mechanism; the swap is a source-structure change.** The tester must live-fire
the deployed field in onboarding.

## Blast radius / cross-surface map

- **In scope:** Consumer iOS + Android (`app-mobile` onboarding). Shared code → automatic parity;
  Android needs the eyeball delta (nested scroll + descender clip, already fixed in the shared field).
- **Out of scope (untouched):** Business iOS/Android (venue `suggest` path, INV-3/ORCH-1079);
  buyer/anon web (no location autocomplete); admin; Preferences (already shipped); CityPicker;
  LaunchCityPicker (frozen-cities gate). No edge fn change.

## Invariant impact (flagged, not resolved)

- `I-PROPOSED-1365-CONSUMER-PLACE-SEARCH-TYPE-FILTERED` (DRAFT) — onboarding becomes a second consumer
  place-search consumer; extend/cover it (spec proposes the extension).
- `I-1315` paywall — N/A to onboarding (no paywall here); do not import Preferences paywall wiring.
- ORCH-1079 / INV-3 (business `suggest` filter-free) — preserved (onboarding uses `suggest_places`,
  never the business `suggest`/`buildSuggestUrl`).

## Discoveries for Orchestrator

- **D-1:** `throttledGeocode.ts` and `useUserLocation.ts` legacy fallback also use forward/reverse
  geocode; NOT in this scope (reverse-geocode name resolution, not a user-facing suggestion list).
- **D-2:** `selectedLocation`/`manualLocation` initial-data round-trips from AsyncStorage
  (`initialData.manualLocation`, `:922/:924`); the swap must keep the `selectedLocation` state shape so
  restore-on-reopen still works.

## Confidence

**PROVEN** for host, broken path, reuse targets, pick-semantic constraint, and the gorhom blocker
(all six-field or cited-live-fire). The onboarding field itself was not sim-run (no-GPS-gated, full
onboarding required) — tester owns the live-fire.

## Recommended next phase + scope

**SPEC (this same worktree) → then implementor.** Scope: a CLIENT-ONLY swap of the onboarding
manual-location search field to the shared `MapboxAddressInput` in `searchMode="places"` with NO
proximity, via a `inBottomSheet={false}`-extended consumer wrapper (plain RN inputs), preserving the
coords-from-`onPick` pick semantic and the confirm-button flow. No edge fn, no migration, no business
touch. See `SPEC_ORCH-1362_ONBOARDING_LOCATION.md`.
