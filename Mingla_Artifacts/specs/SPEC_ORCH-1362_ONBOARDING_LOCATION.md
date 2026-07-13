# SPEC — ORCH-1362 [onboarding-location]

**Reuse the shipped ORCH-1365 place-search engine in the onboarding manual-location field.** Swap the
onboarding "Choose your city" hand-rolled forward/limit=1 search for the shared
`@mingla/location-input` `MapboxAddressInput` in `searchMode="places"` (place-type filter +
trailing-country strip + country ISO bias + zero-result fallback), with NO proximity. Client-only,
OTA-able. NO edge-fn change, NO migration.

- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1362_ONBOARDING_LOCATION.md`
- **Evidence:** `Mingla_Artifacts/evidence/ORCH-1362/broken_path_and_engine_facts.txt`
- **Engine spec (already shipped):** `Mingla_Artifacts/specs/SPEC_ORCH-1365_LOCATION_SEARCH_RELEVANCE.md`
- **Worktree:** `~/Desktop/mingla-orchs/1362-[onboarding-location]/` on `1362-onboarding-location`

---

## 1. Executive summary

The onboarding no-GPS "Choose your city" field (`OnboardingFlow.tsx` `renderManualLocationPanel`)
calls `geocodingService.autocomplete()` → edge `forward` action (`limit=1`), so it can only ever show
ONE POI-polluted, server-IP wrong-country row (`forward "lekki, Nigeria"` → "Lekki London Nigerian
Restaurant, London, GB"). ORCH-1361 F-7 flagged this as the onboarding follow-on to the Preferences
fix. ORCH-1365 already shipped the cure — a `suggest_places` edge action consumed via the shared
`MapboxAddressInput` with `searchMode="places"`. This ORCH points the onboarding field at that same
engine: it now returns a real multi-row PLACE list ("lekki" AND "lekki nigeria" → Lekki, Lagos #1),
POIs dropped, no proximity. One blocker: onboarding is a plain screen (not a gorhom sheet), so the
consumer wrapper's hardcoded gorhom `BottomSheetScrollView`/`BottomSheetTextInput` must be made
optional (an `inBottomSheet` flag) so the field falls back to plain RN inputs.

---

## 2. Scope & non-goals

**In scope (consumer app-mobile only):**
- Extend the consumer wrapper `app-mobile/src/components/location/MapboxAddressInput.tsx` with an
  optional `inBottomSheet?: boolean` (default `true`). When `false`, OMIT `TextInputComponent` and
  `ScrollComponent` so the shared field uses plain RN `TextInput` + `ScrollView`. Default preserves
  Preferences/CityPicker behavior byte-for-byte.
- Swap the onboarding manual-location search block (`OnboardingFlow.tsx`) from the hand-rolled
  `TextInput` + `geocodingService.autocomplete()` dropdown to
  `<MapboxAddressInput variant="light" searchMode="places" inBottomSheet={false} ... />`.
- Remove the now-dead onboarding search state + effect + handler + styles (see §4.3).
- Preserve the pick semantic: `onPick(details)` maps `PlaceDetails` → the existing `selectedLocation`
  shape (`{displayName, fullAddress, location:{lat,lng}}`); `handleManualLocation` is UNCHANGED.
- One fails-on-revert source-structure regression test (§7 T-6/§9).

**Non-goals (MUST NOT touch):**
- The edge fn `mapbox-geocode` — `suggest_places` is ALREADY DEPLOYED. No edit, no deploy.
- The shared package `MapboxAddressInput.tsx` / `mapboxGeocodeService.ts` — reused as-is (props already
  exist). No shared-package change.
- `geocodingService.ts` — leave `autocomplete()` intact (still used by `useUserLocation`/`localeDetection`
  fallbacks; D-1). Do NOT delete it.
- `LaunchCityPicker` (ORCH-1028 frozen-cities gate — different mechanism, DEC-1028-6), Preferences,
  CityPicker, business venue pickers (INV-3 / ORCH-1079), buyer-web, admin.
- No proximity threading. No migration. No DB. No new i18n keys (reuse existing `onboarding:location.*`).

**Assumptions:** `MAPBOX_ACCESS_TOKEN` provisioned (ORCH-1361/1365 verified). Consumer OTA live at
runtime 1.1.1 (COMMS-0095).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|-----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | **YES** | Onboarding "type your city" returns a real multi-row place list; picks the right place; POIs absent; no wrong-country | `app-mobile/.../location/MapboxAddressInput.tsx`, `OnboardingFlow.tsx` | Shared field → auto with Android |
| 2 | Consumer Android (`app-mobile/`) | **YES** | Same as iOS; verify nested-scroll (plain RN ScrollView inside the shell ScrollView) + descender clip (already fixed in shared field) | same | Manual eyeball delta (SC split) |
| 3 | Buyer/anon Web (`mingla-business/`) | NO | No onboarding/location autocomplete | — | n/a |
| 4 | Business iOS (`mingla-business/`) | **NO — untouched** | Venue-name `suggest` path unchanged (INV-3/ORCH-1079) | — | n/a |
| 5 | Business Android | **NO — untouched** | Same | — | n/a |
| 6 | Admin Web | NO | No location search | — | n/a |
| 7 | Business Web preview | NO | No location search | — | n/a |

**Hard gate:** the wrapper change is additive with a default (`inBottomSheet=true`) that preserves the
Preferences/CityPicker gorhom injection exactly (SC-3). Business paths are never imported here.

---

## 4. Layered specification

Only the **component/host layer** is touched (client-only). No DB / edge / service / hook / realtime.

### 4.1 Consumer wrapper — `app-mobile/src/components/location/MapboxAddressInput.tsx` (ADDITIVE)

- Add to `ConsumerMapboxAddressInputProps`:
  ```
  /** True (default) = gorhom sheet host → inject BottomSheetTextInput + BottomSheetScrollView.
      False = plain screen host (e.g. Onboarding) → omit both so the shared field falls back to
      RN TextInput + RN ScrollView. gorhom's BottomSheetScrollView throws outside a <BottomSheet>. */
  inBottomSheet?: boolean;
  ```
  Destructure with `inBottomSheet = true`.
- Change the two hardcoded injections (`:244`, `:246`) to conditional:
  ```
  TextInputComponent={inBottomSheet ? BottomSheetTextInput : undefined}
  ScrollComponent={inBottomSheet ? BottomSheetScrollView : undefined}
  ```
  (When `undefined`, the shared field uses `TextInputComponent ?? RNTextInput` and
  `ScrollComponent ?? RNScrollView` — its documented non-sheet path.)
- Nothing else changes; `LIGHT_TOKENS`/`DARK_TOKENS`/`CONSUMER_COPY`/Icon/invoke/haptics all reused.

### 4.2 Onboarding host — `app-mobile/src/components/OnboardingFlow.tsx`

**(a) Import the consumer wrapper:**
```
import { MapboxAddressInput, type PlaceDetails } from './location/MapboxAddressInput'
```

**(b) New pick handler** (replaces `handleSelectLocationSuggestion`, `:1749`), maps `PlaceDetails` →
the existing `selectedLocation` shape so `handleManualLocation` stays UNCHANGED:
```
const handlePickLocationDetails = useCallback((details: PlaceDetails) => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  setSelectedLocation({
    displayName: details.city || details.formattedAddress,
    fullAddress: details.formattedAddress,
    location: { lat: details.location.lat, lng: details.location.lng },
  })
  setManualLocationText(details.city || details.formattedAddress)
  logger.action('Onboarding location picked', { displayName: details.city || details.formattedAddress })
}, [])
```
Keep `handleClearLocationSelection` (`:1759`) and `handleManualLocation` (`:1768`) EXACTLY as-is —
they already consume `selectedLocation.location.{lat,lng}` and write `data.coordinates` +
`data.manualLocation`, call `goNext()`, and background-detect locale.

**(c) Replace the search block** in `renderManualLocationPanel` (`:2810-2858`, the `else` branch of
`selectedLocation ? card : searchContainer`). The `selectedLocation` chip card (`:2787-2808`) and the
confirm button (`:2860-2875` → `handleManualLocation`) STAY. New else-branch:
```
<View style={styles.locationSearchContainer}>
  <MapboxAddressInput
    variant="light"
    inBottomSheet={false}
    searchMode="places"
    value={manualLocationText}
    onChangeText={setManualLocationText}
    onPick={handlePickLocationDetails}
    onClear={handleClearLocationSelection}
    placeholder={t('onboarding:location.manual_placeholder')}
    accessibilityLabel={t('onboarding:location.manual_placeholder')}
    leadingIcon="location"
    minQueryLength={3}
    suggestLimit={8}
  />
</View>
```
Rationale: `searchMode="places"` (POIs dropped + trailing-country strip + country bias + INC-1
zero-result fallback), NO `proximity` (Q4/§6). `suggestLimit={8}` mirrors Preferences; `minQueryLength={3}`
matches today's onboarding behavior (`autocomplete` gates at 3, wrapper default is 3).

**(d) Remove dead state/effect** (the shared field now owns suggestions internally):
- State `:923 locationSuggestions`, `:929 locationSearchLoading`, `:930 showLocationSuggestions`,
  `:931 locationHasSearched`, `:940 locationSearchTimer` — DELETE.
- The debounced search `useEffect` (`:976-1005`) — DELETE.
- `handleSelectLocationSuggestion` (`:1749`) — DELETE (replaced by `handlePickLocationDetails`).
- KEEP `manualLocationText` (`:922`, the controlled value + AsyncStorage restore) and `selectedLocation`
  (`:924`, restored from `initialData.manualLocation`; D-2).
- Remove `geocodingService` import IF no longer referenced elsewhere in the file (grep first — it may be
  used by other onboarding paths; if so, leave the import).

**(e) Remove dead styles** in `OnboardingFlow.tsx` StyleSheet: `locationSearchInputWrap`,
`locationSearchInputWrapFocused`, `locationSearchIcon`, `locationSearchInput`, `locationSearchSpinner`,
`locationDropdown`, `locationDropdownScroll`, `locationSuggestionRow`, `locationSuggestionRowPressed`,
`locationSuggestionIconWrap`, `locationSuggestionIcon`, `locationSuggestionTextWrap`,
`locationSuggestionName`, `locationSuggestionAddress`, `locationNoResults`, `locationNoResultsText`.
KEEP `locationSearchContainer` (still wraps the field), `locationSelectedCard` + its children (the chip),
and the confirm-button styles. Grep each name before deleting to confirm no other reference.

### 4.3 Component states (owned by the shared field — no host work)

loading / no-results / offline-retry / fetching-details (retrieve) / picked / pick-error are all owned
by the shared `MapboxAddressInput` with `CONSUMER_COPY`. The host renders only the chip (picked) + the
confirm button. The `onClear` X on the field resets `manualLocationText` + `selectedLocation`.

---

## 5. Success criteria (observable, testable)

- **SC-1 (multi-row places):** In onboarding (GPS off), typing "lekki" shows a scrollable multi-row list
  with **Lekki, Lagos, Nigeria** at row #1, POIs absent. Split **SC-1-iOS / SC-1-Android**.
- **SC-2 (trailing country):** Typing "lekki nigeria" returns **Lekki, Lagos, Nigeria** #1 (trailing
  "nigeria" stripped → `country=ng`) — the exact class F-7 flagged.
- **SC-3 (Preferences/CityPicker byte-identical):** With `inBottomSheet` defaulting true, Preferences and
  CityPicker still inject `BottomSheetTextInput`/`BottomSheetScrollView` — no behavior change.
- **SC-4 (no proximity):** The onboarding field sends no `proximity` param; results do not depend on
  device location.
- **SC-5 (pick writes coords):** Picking a suggestion resolves via `retrieve` and stores
  `data.coordinates` + `data.manualLocation`; the confirm button advances (`goNext`) exactly as before.
  Split **SC-5-iOS / SC-5-Android**.
- **SC-6 (no crash on plain screen):** The field renders + scrolls its card list inside the onboarding
  shell's plain ScrollView with no gorhom-context error. Split **SC-6-iOS / SC-6-Android**.
- **SC-7 (restore):** Re-entering onboarding with a previously stored `manualLocation` still shows the
  selected chip (AsyncStorage restore preserved).
- **SC-8 (no paywall):** No Mingla+ paywall appears on the onboarding field (pre-account).

---

## 6. Invariants

**Preserved:**
- **ORCH-1079 / INV-3** (business `suggest`/`buildSuggestUrl` filter-free) — untouched; onboarding uses
  `suggest_places`, never the business path. Test: existing ORCH-1365 gate stays green (no edit).
- **`I-PROPOSED-1365-CONSUMER-PLACE-SEARCH-TYPE-FILTERED`** — onboarding now conforms to it (routes
  through `suggest_places`, no proximity).
- **`I-1230-APP-FUNCTIONAL-WITHOUT-GPS`** (if registered) — the no-GPS manual path still works; the swap
  keeps `data.coordinates` + `use_gps_location=false` semantics.
- **DEC-1028-6 / LaunchCityPicker** — untouched (separate frozen-cities gate).

**New (DRAFT — orchestrator flips ACTIVE at CLOSE):**
- **`I-PROPOSED-1362-ONBOARDING-LOCATION-USES-SHARED-PLACE-SEARCH` (DRAFT):** The onboarding
  manual-location field MUST render the shared `@mingla/location-input` `MapboxAddressInput` in
  `searchMode="places"` (never `geocodingService.autocomplete`/forward/limit=1), with no proximity, and
  MUST NOT inject gorhom `BottomSheetScrollView`/`BottomSheetTextInput` (plain-screen host →
  `inBottomSheet={false}`). Enforcement: §7 T-6, fails-on-revert §9.
  *Alternatively, the orchestrator MAY extend `I-PROPOSED-1365-*` clause (e) to name the onboarding host
  as a second `suggest_places` consumer — implementor's DRAFT registers whichever the orchestrator prefers;
  default to the new 1362 invariant above.*

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Onboarding renders shared field in places mode | render `renderManualLocationPanel` (no selection) | a `MapboxAddressInput` with `searchMode="places"` + `inBottomSheet={false}` is present | app-mobile jest (source/shallow) |
| T-2 | Wrapper omits gorhom when `inBottomSheet={false}` | render wrapper `inBottomSheet={false}` | shared field receives `TextInputComponent===undefined` and `ScrollComponent===undefined` | component |
| T-3 | Wrapper injects gorhom by default | render wrapper (no flag) | shared field receives `BottomSheetTextInput` + `BottomSheetScrollView` (SC-3) | component |
| T-4 | Pick maps PlaceDetails → coords | call `handlePickLocationDetails({city:"Lekki",formattedAddress:"Lekki, Lagos, Nigeria",location:{lat,lng}})` | `selectedLocation.location==={lat,lng}`; `manualLocationText==="Lekki"` | app-mobile jest |
| T-5 | Confirm still writes data + advances | with a `selectedLocation`, press confirm → `handleManualLocation` | `setData` called with `coordinates` + `manualLocation`; `goNext()` fired (SC-5) | app-mobile jest |
| T-6 | **Fails-on-revert: onboarding uses places field, not forward** | source-structure of `OnboardingFlow.tsx` | asserts `searchMode="places"` + `inBottomSheet={false}` present AND `geocodingService.autocomplete(` absent from the manual-location render path; the debounced `locationSearchTimer` effect removed | app-mobile jest |
| T-7 | No proximity | inspect the wrapper call in the onboarding render | no `proximity=` prop threaded to the field (SC-4) | source/jest |
| T-8 | No-results / offline states | shared field returns `[]` / throws | field shows `noResults` / `offline` copy (owned by shared field, CONSUMER_COPY) | component |
| T-9 | Restore | mount with `initialData.manualLocation` set | selected chip renders (SC-7) | app-mobile jest |

Happy: T-1/T-4/T-5. Error/edge: T-8. No-regression/fails-on-revert: T-3/T-6.

---

## 8. Implementation order

1. **Wrapper:** add `inBottomSheet` prop + conditional gorhom injection (`location/MapboxAddressInput.tsx`) + tests T-2/T-3.
2. **Host:** import wrapper + `PlaceDetails`; add `handlePickLocationDetails`; swap the search block (§4.2c); wire `searchMode="places"`, `inBottomSheet={false}`, `suggestLimit={8}`, `minQueryLength={3}` (`OnboardingFlow.tsx`).
3. **Host cleanup:** delete dead state/effect/handler/styles (§4.2d/e); grep-confirm `geocodingService` import can stay or go.
4. **Tests:** T-1/T-4/T-5/T-6/T-7/T-9 (new onboarding test file); register in the app-mobile jest paths filter.
5. **Registry:** DRAFT `I-PROPOSED-1362-*` (or the 1365-clause-(e) extension per §6). Orchestrator flips at CLOSE.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** onboarding renders the SHARED multi-row `suggest_places` field, a different
  code path (edge action + builder) from the retired forward/limit=1 single-shot — a code-level wall.
- **Fails-on-revert test T-6** (must FAIL on revert, PASS on restore): if the onboarding manual-location
  render reverts to `geocodingService.autocomplete()` / drops `searchMode="places"` / re-adds the
  `locationSearchTimer` debounce effect → **RED**. Encodes the F-7 contract ("onboarding gets the same
  multi-row + place treatment").
- **Companion T-3** (default gorhom injection) guards SC-3: if the wrapper stops injecting gorhom by
  default (breaking Preferences/CityPicker) → **RED**.
- **Protective comments:** the new test file header explains WHY (F-7 follow-on; places-mode not
  forward; plain-screen host omits gorhom) referencing this SPEC + SPEC_ORCH-1365.

---

## 10. Open questions

- **OQ-1 (minQueryLength):** onboarding today gates at 3 chars; Preferences uses 4. Spec uses **3**
  (matches current onboarding behavior + wrapper default). Confirm no product desire to align to 4.
- **OQ-2 (invariant form):** register a NEW `I-PROPOSED-1362-*` (default) OR extend `I-PROPOSED-1365-*`
  clause (e) to name onboarding? Orchestrator decides at DRAFT/CLOSE.
- **OQ-3 (geocodingService.autocomplete retirement):** after this swap, `autocomplete()` may have no
  user-facing suggestion-list caller left (only `useUserLocation`/`localeDetection` fallbacks use forward
  differently). Spec leaves it intact (out of scope); a future cleanup ORCH could retire it.

---

## 11. Downstream routing

- **Next = mingla-implementor** (worktree `~/Desktop/mingla-orchs/1362-[onboarding-location]/` on
  `1362-onboarding-location`). Build per §8, honoring the allowlist. Client-only; no edge deploy, no
  migration.
- **Then = mingla-tester** — live-fire the onboarding no-GPS "type your city" field on iOS + Android:
  prove SC-1/SC-2 ("lekki" / "lekki nigeria" → Lekki Lagos #1, multi-row), SC-5 (pick writes coords +
  advances), SC-6 (no gorhom crash on the plain screen, list scrolls), SC-3 (Preferences/CityPicker
  unchanged). The field is no-GPS-gated — drive it via Location Services OFF or the "type your city" link.
- **Then = orchestrator CLOSE** — flip `I-PROPOSED-1362-*` (or the 1365 extension) ACTIVE; per-platform
  consumer OTA (JS-only; NO edge deploy, NO migration); World Map + registry sync.

---

## Allowlist (implementor MAY modify) + DO-NOT-TOUCH

**Allowlist:**
- `app-mobile/src/components/location/MapboxAddressInput.tsx` (add `inBottomSheet` prop + conditional gorhom injection)
- `app-mobile/src/components/OnboardingFlow.tsx` (swap the manual-location search block; remove dead state/effect/handler/styles)
- `app-mobile/src/components/__tests__/orch-1362-onboarding-location-places.test.tsx` (NEW test file)
- `.github/workflows/*` app-mobile jest paths filter (register the new test file, if a paths gate requires it)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (DRAFT `I-PROPOSED-1362-*` OR note the 1365 extension — orchestrator flips at CLOSE)

**DO-NOT-TOUCH:**
- `supabase/functions/mapbox-geocode/**` (edge — `suggest_places` already deployed; no edit, no deploy).
- `packages/location-input/**` (shared field/service — reused as-is; props already exist).
- `app-mobile/src/services/geocodingService.ts` (`autocomplete()` stays for other callers — D-1).
- `LaunchCityPicker.tsx`, `PreferencesSheet.tsx`, `PreferencesSectionsAdvanced.tsx`, `CityPickerSheet.tsx`.
- Any `mingla-business/**`, buyer-web, admin; the business `suggest`/`buildSuggestUrl` path (INV-3/ORCH-1079).
- Do NOT thread proximity; do NOT add i18n keys; do NOT add a paywall.

Any change outside the allowlist → **stop-and-amend** (append here or `SPEC_AMENDMENT_ORCH-1362_*.md`).
