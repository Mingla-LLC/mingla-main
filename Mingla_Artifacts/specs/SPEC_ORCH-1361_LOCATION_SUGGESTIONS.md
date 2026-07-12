# SPEC — ORCH-1361 [location-suggestions]

Consumer Preferences custom-location field: multi-row suggestions + user-proximity bias.

- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1361_LOCATION_SUGGESTIONS.md`
- **Evidence:** `Mingla_Artifacts/evidence/ORCH-1361/live_edge_fn_probes.txt`
- **Worktree:** `~/Desktop/mingla-orchs/1361-[location-suggestions]/` on branch `1361-location-suggestions`.
- **Next phase after this SPEC:** mingla-implementor.

---

## 1. Executive summary

The Preferences "custom starting point" field shows one suggestion and returns wrong-country places (typing "lekki, Nigeria" returns a **London** restaurant). Two proven causes: (1) the field routes through `geocodingService.autocomplete()` which calls the edge **`forward`** action at `limit=1` and wraps the single result into a one-element array — a list is impossible; (2) the `mapbox-geocode` edge fn builds the Mapbox Search Box URL with no `proximity`/`country`, so Mapbox falls back to its `proximity=ip` default — biased to the Supabase edge datacenter IP, not the user's device.

The fix (FULL FIX, Seth's choice): (a) swap the Preferences custom-location field to the shared multi-row `@mingla/location-input` `MapboxAddressInput` suggest→retrieve list (the exact field CityPicker already uses), and (b) thread OPTIONAL `proximity` + `country` (and `types`/`limit`) params — ADDITIVE — from the consumer host's device location through the service → shared field → edge fn, so consumer location search biases to the user, never the server IP. All existing callers that omit the params are byte-identical to today.

---

## 2. Scope & non-goals

**In scope:**
- Swap the Preferences custom-location text field + hand-rolled dropdown for the shared `MapboxAddressInput` (consumer light variant).
- Add OPTIONAL `proximity`, `country`, `types`, `limit` params to `handleSuggest` + `handleForward` (edge), to `autocompleteMapbox` + `forwardGeocodeMapbox` (shared service), to the shared `MapboxAddressInput` props, to the consumer wrapper, and to `LocationInputSection` — wired to the consumer's device proximity + country in `PreferencesSheet`.

**Non-goals (explicit):**
- **OnboardingFlow** location field (same bug, F-7) — follow-on ORCH, NOT this pass.
- **CityPickerSheet** proximity bias — Open Question OQ-4; default = leave unchanged this pass.
- **Business address pickers** (7 sites) — no behavior change; they must NOT pass the new params.
- **buyer-web** — no caller exists; nothing to do.
- No DB/schema change (`custom_lat/custom_lng/custom_location` already exist).
- No change to `handleRetrieve`/`handleReverse`, session-billing, or INV-3 code-derivation.
- No redesign — reuse the existing `LIGHT_TOKENS` variant and CityPicker wiring; no new design tokens.

**Assumptions:** the consumer app can obtain a device location via `enhancedLocationService.getLastKnownLocation()` without a new permission prompt; when it cannot, the field falls back to today's behavior (no proximity) and still functions.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|-----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | YES | Preferences custom-location shows a multi-row list biased to the user's area; "lekki" → Lekki, Lagos NG. | PreferencesSheet + PreferencesSectionsAdvanced + consumer wrapper | Shared RN code → auto with #2 |
| 2 | Consumer Android (`app-mobile/`) | YES | Same as iOS. | (same) | Automatic (shared) |
| 3 | Buyer/anon Web (`mingla-business/` web) | NO | No change. | none | No caller of the edge fn — reason: buyer-web has no address autocomplete. |
| 4 | Business iOS (`mingla-business/`) | NO (no-regression) | Unchanged — pickers omit the new params → byte-identical requests. | none | Manual verify (SC-6). |
| 5 | Business Android (`mingla-business/`) | NO (no-regression) | Unchanged. | none | Manual verify (SC-6). |
| 6 | Admin Web (`mingla-admin/`) | NO | No caller. | none | n/a. |
| 7 | Business Web preview | NO (no-regression) | Unchanged (same business pickers). | none | Manual verify (SC-6). |

Shared code touched by this SPEC (`supabase/functions/mapbox-geocode`, `packages/location-input`) is consumed by surfaces 1,2,4,5,7 — hence the ADDITIVE-only constraint and the SC-6 no-regression gate.

---

## 4. Layered specification

### 4.1 Edge function — `supabase/functions/mapbox-geocode/index.ts` (ADDITIVE ONLY)

Add to `RequestBody`:
```ts
proximity?: string; // "lng,lat" (Mapbox longitude,latitude order) OR "ip"
country?: string;   // ISO 3166-1 alpha-2, comma-separated (e.g. "ng" or "ng,gh")
types?: string;     // comma-separated Search Box types (e.g. "place,locality,address")
limit?: number;     // suggest override; default 5 (byte-identical when omitted)
```

`handleSuggest(token, query, sessionToken, opts)` and `handleForward(token, query, opts)` gain an `opts` object carrying `{ proximity?, country?, types?, limit? }`. Build the URL by APPENDING each param **only when present and non-empty**:
```ts
if (opts.proximity) url += `&proximity=${encodeURIComponent(opts.proximity)}`;
if (opts.country)   url += `&country=${encodeURIComponent(opts.country)}`;
if (opts.types)     url += `&types=${encodeURIComponent(opts.types)}`;
```
- `handleSuggest` limit: `&limit=${opts.limit ?? 5}` (keep default 5 → business unchanged).
- `handleForward` limit: unchanged `&limit=1` (forward stays single-result; forward `limit>1` requires a single `types`, out of scope).
- **When `opts` is empty, the emitted URL is byte-identical to today** (this is the no-regression contract; SC-6).
- Thread `body.proximity`/`body.country`/`body.types`/`body.limit` in `handler()` `switch` into `opts` for the `suggest`/`forward` cases only. `retrieve`/`reverse` unchanged.
- Preserve `verify_jwt = true` (config.toml:174-175 unchanged).
- **Mapbox param formats (verified against `https://docs.mapbox.com/api/search/search-box/`, COMMS-0003):** `proximity` default `"ip"`, value `"longitude,latitude"`; `country` = ISO 3166 alpha-2 CSV; `types` ∈ {country,region,postcode,district,place,city,locality,neighborhood,street,address,poi,category}; `limit` ≤ 10.

### 4.2 Shared service — `packages/location-input/src/mapboxGeocodeService.ts` (ADDITIVE ONLY)

```ts
export interface LocationBias { proximity?: string; country?: string; types?: string; limit?: number; }

export async function autocompleteMapbox(
  query: string, sessionToken: string,
  deps: { invoke: InvokeFn }, bias?: LocationBias,   // ← new optional trailing arg
): Promise<PlaceAutocompleteSuggestion[]>

export async function forwardGeocodeMapbox(
  query: string, deps: { invoke: InvokeFn }, bias?: LocationBias,  // ← new optional trailing arg
): Promise<PlaceDetails>
```
- Merge `bias` fields into the invoke body ONLY when present:
  `body: { action:"suggest", query:q, session_token, ...(bias?.proximity && {proximity:bias.proximity}), ...(bias?.country && {country:bias.country}), ...(bias?.types && {types:bias.types}), ...(bias?.limit && {limit:bias.limit}) }`.
- `bias` optional & trailing → **existing 2/3-arg callers unaffected** (business wrapper, consumer geocodingService, MapboxAddressInput).

### 4.3 Shared field — `packages/location-input/src/MapboxAddressInput.tsx` (ADDITIVE ONLY)

Add optional props to `MapboxAddressInputProps`: `proximity?: string; country?: string; types?: string; suggestLimit?: number;`. In `handleChangeText`, pass them through:
```ts
const results = await autocompleteMapbox(next, sessionToken.current, { invoke },
  { proximity, country, types, limit: suggestLimit });
```
- When all absent → `bias` object has only undefined fields → service omits them → byte-identical to today (CityPicker + business unaffected).
- Everything else (session-token rotation, debounce, states, a11y) UNCHANGED — session-billing discipline preserved automatically.

### 4.4 Consumer wrapper — `app-mobile/src/components/location/MapboxAddressInput.tsx` (ADDITIVE ONLY)

Add optional pass-through props `proximity?`, `country?`, `types?`, `suggestLimit?` to `ConsumerMapboxAddressInputProps` and forward them to `SharedMapboxAddressInput`. No token/copy change. `variant="light"` already exists (`LIGHT_TOKENS`).

### 4.5 Component — `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` (`LocationInputSection`)

Replace the inner custom-location field ONLY (the `locationInputContainer` `BottomSheetTextInput` at ~242-253 AND the hand-rolled `suggestionsContainer` dropdown at ~271-315). Keep everything else.

- **New props (additive):** `onPickLocation: (details: PlaceDetails) => void`, `proximity?: string`, `country?: string`. Remove the now-unused suggestion-plumbing props (`showSuggestions`, `suggestions`, `isLoadingSuggestions`, `onSuggestionSelect`, `onFocus`, `onBlur`) — but see Implementation order for the host cleanup.
- **Selected state = chip (PRESERVED):** render the existing `locationChip` (unchanged markup) when a resolved location exists — trigger `selectedCoords != null` (host passes a `hasSelected` bool). The chip's clear affordance (`onClearLocation`) is unchanged.
- **Editing state = shared field:** when NOT selected, render
  ```tsx
  <MapboxAddressInput
    variant="light"
    value={searchLocation}
    onChangeText={onLocationInputChange}
    onPick={onPickLocation}
    onClear={onClearLocation}
    placeholder={t('preferences:location.search_placeholder')}
    accessibilityLabel="Search for a starting point"
    leadingIcon="location"
    minQueryLength={4}
    proximity={proximity}
    country={country}
    types="place,locality,neighborhood,address,region,district"   // OQ-3 (recommended)
    suggestLimit={8}                                              // OQ-2 (recommended)
  />
  ```
  (imported from `../location/MapboxAddressInput`, mirroring CityPickerSheet.)
- **`minQueryLength={4}`** preserves today's ≥4-char gate for this field.
- **HARD — ORCH-1315 preservation (I-1315, T-A4):** do NOT alter the GPS-row block. The `isLocked ? ( <TouchableOpacity onPress={onLockedTap} accessibilityRole="button" accessibilityLabel="Upgrade to set a custom starting point"> … </TouchableOpacity> ) : ( <View> … )` structure and the `{!useGpsLocation && !isLocked && ( … field … )}` guard and the locked-hint block MUST remain byte-compatible with the strings pinned in `orch-1315-…paywall.test.tsx` T-A4. The swapped field goes INSIDE the existing `!useGpsLocation && !isLocked` guard, replacing only the chip/input sub-tree.
- **States (all handled by the shared field, no host work):** idle / loading_suggestions ("Searching…") / suggestions_open (multi-row) / no_results ("No matches — try a broader search.") / offline (tap-to-retry) / fetching_details / pick_error / picked. Copy = existing `CONSUMER_COPY`.

### 4.6 Host — `app-mobile/src/components/PreferencesSheet.tsx`

- **Resolve proximity + country (new, additive):** on sheet open, resolve a device anchor once and memoize:
  ```ts
  // additive; independent of use_gps_location deck toggle
  const loc = await enhancedLocationService.getLastKnownLocation();  // fast, no prompt
  if (loc) setProximity(`${loc.longitude},${loc.latitude}`);         // Mapbox lng,lat
  ```
  Country (optional refinement, OQ-1): derive from the same coords via `geocodingService.reverseGeocode(lat,lng).countryCode` (already cached), lowercased, → `setCountry(code)`. If unavailable, leave `country` undefined (proximity alone fixes ranking).
- **Wire the field:** pass `proximity`, `country`, `hasSelected={selectedCoords != null}`, and `onPickLocation` to `LocationInputSection`. `onPickLocation(details)` sets `searchLocation = details.formattedAddress` and `selectedCoords = details.location` (replacing `handleSuggestionSelect`).
- **Remove the dead forward path for this field:** delete the `geocodingService.autocomplete()` call + debounce in `handleLocationInputChange` (659-673) and the `suggestions`/`showSuggestions`/`isLoadingSuggestions` state used ONLY by this field. `onLocationInputChange` becomes a plain `setSearchLocation` (+ `setSelectedCoords(null)` while typing).
- **Save path (894-930):** with the shared field, a pick always yields `selectedCoords`, so `custom_lat/custom_lng` come from `selectedCoords` (unchanged logic). Keep the legacy re-geocode fallback (909) for a typed-but-unpicked string; OPTIONALLY pass `{proximity, country}` into that `geocodingService.autocomplete` call (it now accepts a bias) so the fallback is also user-biased. Non-blocking.
- **Do NOT touch** `overlay={paywall}`, `presentInline`, the `canAccess('custom_starting_point')` lock, or the downgrade `useEffect` (293-299).

### 4.7 Realtime / DB / RLS

None. No schema, RLS, migration, or realtime change.

---

## 5. Success criteria

- **SC-1** (Consumer, shared parity): typing ≥4 chars in the Preferences custom-location field (Mingla+, GPS off) renders a **multi-row** list of ≥2 candidate places (when Mapbox returns ≥2), not a single row.
- **SC-2**: with a resolved device anchor in Lagos (proximity ≈ `3.4,6.45`) typing "lekki" surfaces "Lekki Phase 1/2, Lagos, Nigeria" in the list; picking it stores `custom_lat/custom_lng` = Lekki, Lagos coords (NOT London).
- **SC-3**: picking a row shows the selected-location **chip** with a working clear (X) affordance; clearing returns to the editable field.
- **SC-4** (fallback): when no device location is available, the field still functions (renders a list, no crash) — proximity simply omitted (today's behavior, no worse).
- **SC-5** (paywall preserved): a FREE user still sees the locked GPS row fire the Mingla+ paywall over the sheet (I-1315 unbroken); the custom field stays hidden for locked users.
- **SC-6** (no-regression, shared fn): a `suggest`/`forward`/`retrieve` request that omits `proximity`/`country`/`types`/`limit` emits a URL byte-identical to pre-change; the 7 business pickers + CityPicker behave exactly as before.
- **SC-7** (bias off by default): the shared field and CityPicker, when NOT passed proximity/country, produce identical requests to today (CityPicker is not regressed by the new props).

(Parity across iOS/Android is automatic — one shared RN path; SC-1..SC-5 verified on iOS sim, spot-checked on Android.)

---

## 6. Invariants

- **Preserve — `I-1315-PAYWALL-PRESENTS-FROM-SHEET` (ACTIVE):** the swap keeps the T-A4 GPS-row `TouchableOpacity`/labels and the `overlay={paywall}`/`presentInline` wiring untouched; verified by the existing `orch-1315-…paywall.test.tsx` (must still PASS).
- **Preserve — INV-3 (structured codes never parsed):** the shared field's `retrieve` already reads structured `regionCode`/`countryCode`; the swap introduces no name-parsing.
- **Preserve — Mapbox session billing:** one `session_token` across suggest→retrieve, rotated after each pair (shared field, unchanged); `forward`/`reverse` per-request.
- **NEW (DRAFT) — `I-PROPOSED-1361-CONSUMER-LOCATION-PROXIMITY-BIASED`:** consumer location search MUST bias by the user's device proximity (and/or country) and MUST NOT silently rely on server-IP proximity. Enforced by the regression test in §9. Flips ACTIVE at CLOSE (orchestrator owns the flip).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 happy | multi-row list | "lekki" + proximity=Lagos | ≥2 rows, Lekki Lagos NG present | field/edge |
| T-2 bias | proximity threaded | edge `suggest` body `{proximity:"3.4,6.45",country:"ng"}` | URL contains `&proximity=3.4%2C6.45&country=ng` | edge unit (Deno) |
| T-3 no-regression | params omitted | edge `suggest`/`forward` body without bias | URL byte-identical to pre-change (no `&proximity/&country/&types`) | edge unit (Deno) |
| T-4 pick | retrieve → coords | pick a suggestion | `onPickLocation(details)` fires; `selectedCoords` set from `details.location` | field |
| T-5 chip | selected state | after pick | chip renders, clear X returns to field | component |
| T-6 error | offline | suggest throws | field shows "Couldn't reach search. Tap to try again." | field |
| T-7 edge/GPS-denied | no device loc | proximity undefined | field renders a list, no crash; proximity omitted | host |
| T-8 paywall | free user | tap locked GPS row | Mingla+ paywall presents over sheet (existing T-A4 PASS) | component |
| T-9 fails-on-revert | swap reverted | LocationInputSection reverts to `geocodingService.autocomplete` | regression test FAILS | source test |

---

## 8. Implementation order

1. **Edge fn** (`mapbox-geocode/index.ts`) — add `opts` param + append-when-present URL builder + `handler` threading. Add Deno unit test (T-2/T-3). Deploy is the orchestrator's, NOT this phase.
2. **Shared service** (`packages/location-input/src/mapboxGeocodeService.ts`) — add `LocationBias` + optional trailing `bias` arg on `autocompleteMapbox`/`forwardGeocodeMapbox`.
3. **Shared field** (`packages/location-input/src/MapboxAddressInput.tsx`) — add optional `proximity`/`country`/`types`/`suggestLimit` props → thread to `autocompleteMapbox`.
4. **Consumer wrapper** (`app-mobile/src/components/location/MapboxAddressInput.tsx`) — pass-through props.
5. **`LocationInputSection`** (`PreferencesSectionsAdvanced.tsx`) — swap the inner field for the shared `MapboxAddressInput`; keep chip + GPS-row + paywall structures.
6. **Host** (`PreferencesSheet.tsx`) — resolve proximity/country on open; wire `onPickLocation`/`hasSelected`/`proximity`/`country`; delete the dead `geocodingService.autocomplete` field path + unused suggestion state.
7. **Tests** — the regression source test (T-9) + edge Deno tests (T-2/T-3); confirm `orch-1315-…paywall.test.tsx` still PASSES.

---

## 9. Regression prevention (fails-on-revert contract)

New source-structure test `app-mobile/src/components/__tests__/orch-1361-preferences-location-multirow-bias.test.tsx` (mirror the ORCH-1315 `readSource` + `assert.match` convention), pinning:
- **P-1:** `PreferencesSectionsAdvanced.tsx` imports `MapboxAddressInput` from `../location/MapboxAddressInput` AND renders `<MapboxAddressInput` inside the `!useGpsLocation && !isLocked` block → FAILS if reverted to the raw `BottomSheetTextInput` + `geocodingService.autocomplete` dropdown.
- **P-2:** `PreferencesSheet.tsx` passes `proximity=` and `onPickLocation=` to `LocationInputSection` → FAILS if the host stops threading proximity.
- **P-3 (edge, Deno):** `handleSuggest`/`handleForward` append `&proximity=`/`&country=` when present AND emit no such param when absent (byte-identical) → dual-direction fails-on-revert (guards both the fix and the no-regression contract). Wire into `.github/workflows/supabase-migrations-and-stripe-deno.yml`.
- **P-4:** the existing `orch-1315-…paywall.test.tsx` must remain green (protective backstop — no CI change needed).

Protective comment on each pin: "ORCH-1361 — consumer location search must be multi-row + user-proximity-biased, never server-IP; see SPEC_ORCH-1361."

---

## 10. Open questions (for the orchestrator)

- **OQ-1 (default country when GPS denied):** recommend — pass `country` only when derivable from a device anchor; when no device location at all, omit both proximity+country (falls back to today, no worse). Alternative: default `country` to the user's profile/last-market country. **Decision needed.**
- **OQ-2 (`suggestLimit`):** recommend **8** for the multi-row Preferences list (Search Box max 10; 8 balances coverage vs sheet height). Business stays at 5 (unchanged). **Confirm.**
- **OQ-3 (`types` filter):** recommend `types="place,locality,neighborhood,address,region,district"` for the Preferences field — it is a "starting POINT to search from," so dropping noisy POIs (e.g. "Lekki Kitchen" restaurant) sharpens results. Trade-off: a user wanting a specific POI as their anchor loses it. **Confirm include vs omit.**
- **OQ-4 (CityPicker bias):** CityPicker shares the wrong-country risk (noisy list) and uses the SAME wrapper+field — passing the user's proximity/country there is a ~2-line add. In scope for this pass, or defer? **Decision needed.**
- **OQ-5 (OnboardingFlow):** F-7 — same bug in onboarding; register a follow-on ORCH (out of this scope).

---

## 11. Downstream routing

- **This phase:** SPEC (complete).
- **Next:** mingla-implementor — build per §4/§8 in the worktree; run the gates; prove T-9/P-3 fail-on-revert; do NOT deploy the edge fn, migrate, merge, or push. Working tree: `~/Desktop/mingla-orchs/1361-[location-suggestions]/` on branch `1361-location-suggestions`.
- **Then:** mingla-tester — adversarial: (a) verify the London repro is gone with a Lagos anchor; (b) verify SC-6 byte-identical business requests (drive a business picker); (c) verify the Mingla+ paywall still presents (I-1315); (d) GPS-denied fallback; (e) session-billing (one token per suggest→retrieve).
- **Then:** orchestrator CLOSE — flip `I-PROPOSED-1361-…` ACTIVE, deploy `mapbox-geocode` (verify first call with curl), register OQ-5 follow-on, decide OQ-4.

---

## Scoped allowlist (implementor may change ONLY these)

1. `supabase/functions/mapbox-geocode/index.ts`
2. `packages/location-input/src/mapboxGeocodeService.ts`
3. `packages/location-input/src/MapboxAddressInput.tsx`
4. `app-mobile/src/components/location/MapboxAddressInput.tsx`
5. `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx`
6. `app-mobile/src/components/PreferencesSheet.tsx`
7. NEW `app-mobile/src/components/__tests__/orch-1361-preferences-location-multirow-bias.test.tsx`
8. NEW edge Deno test under `supabase/functions/mapbox-geocode/__tests__/` + its CI wiring line in `.github/workflows/supabase-migrations-and-stripe-deno.yml`
9. `packages/location-input/index.ts` (only if a new type export — e.g. `LocationBias` — is needed)

## DO-NOT-TOUCH

- `handleRetrieve` / `handleReverse` in the edge fn; `verify_jwt` in `config.toml`.
- The 7 business picker sites, `mingla-business/src/services/mapboxGeocodeService.ts`, and the business `MapboxAddressInput` wrapper — must remain unchanged and must NOT pass the new params (SC-6).
- `CityPickerSheet.tsx` (unless OQ-4 is approved).
- `OnboardingFlow.tsx` (OQ-5 follow-on).
- `CustomPaywallScreen.tsx`, `BaseBottomSheet.tsx` overlay slot, and the ORCH-1315 GPS-row `TouchableOpacity`/labels + `overlay={paywall}`/`presentInline` wiring.
- `useUserLocation.ts` query keys (do not add proximity to the deck's location query).
