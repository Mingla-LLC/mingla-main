# IMPLEMENTATION — ORCH-1361 [location-suggestions]

Consumer location search: multi-row suggestions + user-proximity bias.

- **SPEC (contract):** `Mingla_Artifacts/specs/SPEC_ORCH-1361_LOCATION_SUGGESTIONS.md`
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1361_LOCATION_SUGGESTIONS.md`
- **Worktree:** `~/Desktop/mingla-orchs/1361-[location-suggestions]/` on branch `1361-location-suggestions`
- **Fix commit:** `f80cbf729` (rebased on `origin/main`; NOT pushed).
- **Status:** implemented and verified (source + edge Deno gates green; runtime device-GPS ranking is `implemented, unverified` — needs a device/sim eyeball with a Lagos anchor, the tester's job).

---

## 1. Summary (plain English)

Typing a place in the consumer **Preferences → "Where should we look"** custom-location box used to show ONE result, biased to the server's datacenter IP (Europe) — so "lekki, Nigeria" returned a **London** restaurant. This swaps that box to the same shared multi-row Mapbox suggest→retrieve list the Discover city picker already uses, and threads the user's **device location (proximity + country)** through the shared service into the `mapbox-geocode` edge function so Nigerian results rank first. The edge-fn change is **additive**: any caller that omits the new params sends a **byte-identical** request to today, so the 7 business address pickers are untouched. The same bias is also wired into the Discover **city picker** (OQ-4). The Mingla+ paywall on this field (ORCH-1315) is preserved unchanged.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1 | ≥4 chars → multi-row list (not single row) | ✓ built | Field swapped to shared `MapboxAddressInput` (multi-row suggest→retrieve); edge `.slice(0,5)` widened to the effective limit so 8 rows actually reach the caller. `f80cbf729`. Runtime row count = tester eyeball. |
| SC-2 | Lagos anchor + "lekki" → Lekki Lagos NG; stores Lekki coords | ✓ built / unverified runtime | Proximity `${lng},${lat}` + `country=ng` threaded; `onPickLocation` stores `custom_lat/lng` from `details.location`. Live suggest already returns Lekki Lagos at rank #1 (investigation A4). Device-GPS ranking = tester. |
| SC-3 | Pick → chip with working clear; clear → editable field | ✓ built | `hasSelected` (selectedCoords != null) renders the existing `locationChip`; clear → `onClearLocation` zeroes coords → field returns. `f80cbf729`. |
| SC-4 | No device location → field still works, proximity omitted | ✓ built | OQ-1: `getLastKnownLocation()` null → proximity+country stay undefined → service omits → today's behavior. Modeled by test OQ-1c. |
| SC-5 | FREE user still hits the Mingla+ paywall (I-1315) | ✓ verified | ORCH-1315 paywall test PASSES post-change (GPS-row `TouchableOpacity`/labels + `overlay={paywall}`/`presentInline` untouched). |
| SC-6 | Omitted params → byte-identical edge request; business + CityPicker unchanged | ✓ verified | Edge Deno test asserts `buildSuggestUrl`/`buildForwardUrl` equal the exact pre-1361 string when unbiased; business wrapper + `mingla-business/src/services/mapboxGeocodeService.ts` untouched. |
| SC-7 | Bias off by default; CityPicker not regressed | ✓ verified | New props all optional; when absent the service merges nothing. CityPicker only ADDS proximity/country (its own prior IP-bias fixed, not regressed). |

Parity iOS↔Android is automatic (one shared RN path).

---

## 3. Files changed (10; all allowlist + authorized CityPicker)

| File | +/− | Layer |
|------|-----|-------|
| `supabase/functions/mapbox-geocode/index.ts` | ~+140/−12 | Edge fn — additive `SearchOpts` + pure `buildSuggestUrl`/`buildForwardUrl` + `clampSuggestLimit` + handler threading |
| `supabase/functions/mapbox-geocode/__tests__/mapboxGeocodeBias.orch1361.test.ts` | +117 (new) | Edge Deno test (P-3) |
| `packages/location-input/src/mapboxGeocodeService.ts` | +41/−8 | Shared service — `LocationBias` + optional trailing `bias` arg |
| `packages/location-input/src/MapboxAddressInput.tsx` | +32/−5 | Shared field — optional `proximity`/`country`/`types`/`suggestLimit` props |
| `app-mobile/src/components/location/MapboxAddressInput.tsx` | +20 | Consumer wrapper — pass-through props |
| `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | +50/−145 | `LocationInputSection` — swap to shared field; delete hand-rolled dropdown + dead styles |
| `app-mobile/src/components/PreferencesSheet.tsx` | ~+70/−63 | Host — resolve proximity/country; wire `onPickLocation`/`hasSelected`; delete dead suggestion state |
| `app-mobile/src/components/discover/CityPickerSheet.tsx` | +42 | OQ-4 — resolve + thread proximity/country |
| `app-mobile/src/components/__tests__/orch-1361-preferences-location-multirow-bias.test.tsx` | +171 (new) | App-mobile source-structure test (P-1/P-2/OQ-1/OQ-4) |
| `.github/workflows/supabase-migrations-and-stripe-deno.yml` | +55 | CI wiring — path filters + `orch-1361-location-suggestions-deno-tests` job |

Commit total: 717 insertions, 237 deletions.

---

## 4. Data-model changes applied

**None.** No migration, schema, RLS, or realtime change (SPEC §4.7). `custom_lat`/`custom_lng`/`custom_location` columns already exist. **BACKFILL/DB-PUSH not required.**

---

## 5. Edge functions touched

| Fn | Change | `verify_jwt` (preserve) | Deploy |
|----|--------|------------------------|--------|
| `mapbox-geocode` | ADDITIVE optional `proximity`/`country`/`types`/`limit` on suggest+forward; retrieve/reverse UNCHANGED | **`verify_jwt = true`** (config.toml:175 — untouched) | Orchestrator/operator deploys from MERGED main; verify first call with curl |

Additive/backward-compatible **proven**: the edge Deno test asserts a byte-identical URL when params are omitted (SC-6).

---

## 6. Regression tests added

Both ship in the fix branch/commit `f80cbf729` (visible in `git diff origin/main...HEAD --name-only`) and are CI-registered in the new `orch-1361-location-suggestions-deno-tests` job.

1. **Edge (P-3):** `supabase/functions/mapbox-geocode/__tests__/mapboxGeocodeBias.orch1361.test.ts` — 7 Deno tests. Byte-identical-when-unbiased (SC-6, dual-direction), proximity/country/types appended only when present, limit default-5/consumer-8/clamped-≤10, forward stays limit=1, url-encoding.
2. **App-mobile source-structure (P-1/P-2/OQ-1/OQ-4):** `app-mobile/src/components/__tests__/orch-1361-preferences-location-multirow-bias.test.tsx` — 11 Deno tests. Field is the shared multi-row field inside the `!useGpsLocation && !isLocked` block with the OQ-3 types + OQ-2 suggestLimit=8; old dropdown/state GONE; host threads proximity/onPickLocation/hasSelected + resolves the device anchor; CityPicker threads bias; OQ-1 omit-when-absent behavioral model.

**fails-on-revert verified at `f80cbf729`** (true LINE DELETION, not comment-out):
- Deleted the `if (opts.proximity/country/types) url +=` append lines + reverted the suggest `limit` to hardcoded `&limit=5` in `buildSuggestUrl`/`buildForwardUrl` → edge suite went **RED (4 failed / 3 passed)**.
- Deleted the `types="…"` + `suggestLimit={8}` lines from the field → app-mobile suite went **RED (P-1c failed / 10 passed)**.
- Restored via `git checkout` → both suites **GREEN (18 passed / 0 failed)**; working tree clean.

Protective backstop: **ORCH-1315 paywall test still PASSES** (`orch-1315-preferences-custom-location-paywall.test.tsx`, run via `npx tsx`).

---

## 7. Old → New receipts

### `supabase/functions/mapbox-geocode/index.ts`
- **Before:** `handleSuggest`/`handleForward` built the Search Box URL inline with no proximity/country/types; suggest hardcoded `&limit=5` and `.slice(0,5)`.
- **Now:** URL built by pure exported `buildSuggestUrl`/`buildForwardUrl` that append `proximity`/`country`/`types` ONLY when present and resolve `limit` via `clampSuggestLimit` (default 5, ≤10); suggest slices to the effective limit; `handler` threads `body.proximity/country/types/limit` into `SearchOpts` for suggest/forward only.
- **Why:** SC-1/SC-2 (bias + multi-row) and SC-6 (byte-identical when omitted). retrieve/reverse and `verify_jwt` untouched.

### `packages/location-input/src/mapboxGeocodeService.ts`
- **Before:** `autocompleteMapbox(query, sessionToken, deps)` / `forwardGeocodeMapbox(query, deps)` sent a fixed body.
- **Now:** optional trailing `bias?: LocationBias` merged into the body only when present. 2/3-arg callers unaffected.
- **Why:** additive plumbing seam (SC-6/SC-7).

### `packages/location-input/src/MapboxAddressInput.tsx`
- **Before:** field called `autocompleteMapbox(next, session, {invoke})`.
- **Now:** optional `proximity`/`country`/`types`/`suggestLimit` props threaded as the 4th `bias` arg; added to the `handleChangeText` deps. Session-token rotation/billing untouched.
- **Why:** consumer hosts bias the suggest; business hosts (no props) are byte-identical.

### `app-mobile/src/components/location/MapboxAddressInput.tsx`
- **Before/Now:** consumer wrapper forwards the 4 new optional props to the shared field. No token/copy change.

### `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` (`LocationInputSection`)
- **Before:** raw `BottomSheetTextInput` + hand-rolled `BottomSheetScrollView` dropdown fed by host `suggestions[]` (forward/limit=1 → 1 row).
- **Now:** chip (on `hasSelected`) OR the shared `<MapboxAddressInput variant="light" minQueryLength={4} types="place,locality,neighborhood,address,region,district" suggestLimit={8} proximity country onPick=…>`. Removed 9 dead styles + `ActivityIndicator`/`BottomSheetScrollView` imports. GPS-row `TouchableOpacity`/labels + `!useGpsLocation && !isLocked` guard **byte-preserved** (I-1315 / T-A4).
- **Why:** SC-1/SC-3; kills the single-row path (Constitution #8 subtract-before-add).

### `app-mobile/src/components/PreferencesSheet.tsx` (host)
- **Before:** `handleLocationInputChange` debounced `geocodingService.autocomplete()` into `suggestions`/`showSuggestions`/`isLoadingSuggestions`; `handleSuggestionSelect`/`handleInputBlur`.
- **Now:** device anchor resolved once per open (`getLastKnownLocation()` → `setProximity("${lng},${lat}")`; country via `geocodingService.reverseGeocode().countryCode`, lowercased; OQ-1 omit-both when unavailable). `handleLocationInputChange` = plain setter; new `handlePickLocation(details)` stores `custom_lat/lng`. Dead suggestion state deleted; `LocationInputSection` gets `onPickLocation`/`hasSelected`/`proximity`/`country`. `overlay={paywall}`/`presentInline`/`canAccess`/downgrade effect **untouched**.
- **Why:** SC-2/SC-4; feeds the bias; preserves I-1315.

### `app-mobile/src/components/discover/CityPickerSheet.tsx` (OQ-4)
- **Before:** shared field with no bias → same server-IP wrong-country risk.
- **Now:** resolves the device anchor on open and threads `proximity`/`country` to the field (omit-when-absent). No other behavior change.

---

## 8. Cross-surface impact

| Surface | Affected | User-visible | Parity |
|---------|----------|--------------|--------|
| Consumer iOS | YES | Preferences + Discover city search → multi-row, ranked to the user's area | shared RN → auto |
| Consumer Android | YES | same | automatic (shared) |
| Buyer/anon Web | NO | no caller of the edge fn | — |
| Business iOS | NO (no-regression) | pickers omit params → byte-identical requests | SC-6 verified in source; runtime = tester |
| Business Android | NO (no-regression) | same | same |
| Admin Web | NO | no caller | — |
| Business Web preview | NO (no-regression) | same business pickers | SC-6 |

Shared code touched (`mapbox-geocode`, `packages/location-input`) is consumed by 1,2,4,5,7 — hence the additive-only constraint + the SC-6 gate. **No manual parity gap.**

---

## 9. Smoke result

Static/unit gates only (no device drive this pass — that is the tester's live-fire):
- `deno check supabase/functions/mapbox-geocode/index.ts` → GREEN.
- ORCH-1361 edge + app-mobile Deno suites → **18 passed / 0 failed** (CI command `deno test --allow-read --no-check`).
- ORCH-1315 paywall (`npx tsx`) → **PASS**.
- app-mobile tsc on the 4 touched SOURCE files → **0 errors**.
- eslint on the 4 touched files → **net −1 problem vs baseline** (0 new; see Known issues).

---

## 10. Known issues / deferred

- **tsc "errors" in `packages/location-input`** (18 vs baseline 14, delta 4): the package has no resolvable `react` from its own dir under BOTH app-mobile and business tsc (repo root has no `node_modules`), so the shared field's FC degrades and every prop shows implicit-`any`. **Pre-existing, repo-structural — identical class on `origin/main` (baseline 902 total errors vs branch 906; the +4 are exactly my 4 new props on that already-broken file).** The props are correctly typed (validated in the app-mobile SOURCE files, which have react and show 0 errors). Not a real type defect.
- **2 pre-existing eslint errors on touched files** (unchanged from baseline, NOT introduced here): `PreferencesSheet.tsx` `react/no-unescaped-entities` on the `{name}'s picks` participant banner (never touched by this ORCH); `location/MapboxAddressInput.tsx` `import/no-unresolved '@mingla/location-input'` (eslint workspace-package resolver limitation on the pre-existing import). My change REMOVED one warning (net 22→21 problems).
- **Save-path fallback left unbiased (deliberate scope call):** `PreferencesSheet.handleApplyPreferences` still calls `geocodingService.autocomplete(searchLocation)` for a typed-but-unpicked string WITHOUT the bias. `app-mobile/src/services/geocodingService.ts` is **NOT in the allowlist**, so I did not widen its signature (SPEC §4.6 marked this "OPTIONAL / non-blocking"). With the multi-row field a pick always sets `selectedCoords`, so the fallback rarely fires; unchanged behavior for that edge case (no regression). Registered below for the orchestrator.
- **Runtime device-GPS ranking `unverified`:** the proximity/country bias mechanism is proven-by-proxy (live suggest returns Lekki Lagos NG) + doc-confirmed; the end-to-end "device in Lagos → Lekki ranks #1" needs a sim/device eyeball with a spoofed Lagos location — the tester's live-fire.

---

## 11. Operator action required

- **Migration `db push`:** NONE (no migration).
- **Edge deploy (orchestrator/operator, from MERGED main — NOT this phase):** deploy `mapbox-geocode` and verify the first call with curl. Preserve **`verify_jwt = true`**. Additive change → existing callers unaffected pre/post deploy.
- **No OTA/merge/push performed here.**

---

## 12. Discoveries for Orchestrator

1. **OQ-5 / F-7 OnboardingFlow** — `OnboardingFlow.tsx:~991` has the identical forward/limit=1 + no-bias bug with its own hand-rolled dropdown. OUT OF SCOPE here (per OQ-5 ruling, tracked as ORCH-1362). Same multi-row + bias treatment recommended.
2. **geocodingService.autocomplete bias follow-on** — to also bias the Preferences save-path fallback (and any other `geocodingService.autocomplete` caller), `geocodingService.ts` would need an optional bias arg (it's not in the 1361 allowlist). Small, low-risk; register if desired.
3. **Invariant flip owed at CLOSE:** `I-PROPOSED-1361-CONSUMER-LOCATION-PROXIMITY-BIASED` → ACTIVE (orchestrator owns the flip). Now genuinely holds for Preferences + CityPicker; OnboardingFlow remains the one consumer location surface not yet biased (ORCH-1362).

---

## 13. REWORK 2026-07-12 — ORCH-1079 / INV-3 conflict resolution (NEEDS-REWORK loop)

**What failed:** CI gate `ORCH-1079: mapbox-geocode suggest stays filter-free for POI/name search (INV-3)` — strict-grep `.github/scripts/strict-grep/i-mapbox-suggest-no-types-filter.mjs` — went RED. The prior pass added a `types` FILTER (`&types=` in `buildSuggestUrl`/`buildForwardUrl`) to the shared `suggest` handler. That handler ALSO serves BUSINESS venue-name search, which MUST return POIs, so the gate (correct, must stay) forbids any `types` filter there.

**Root-cause resolution (no gate weakening):** removed the `types` FILTER entirely and dropped `country` from everything the consumer passes; kept ONLY the `proximity` RANKING bias + `limit` pagination. Proximity biases ranking WITHOUT excluding any result, so it still fixes "lekki → London" (a Lagos device ranks Lekki Lagos first) while the suggest handler stays filter-free (INV-3 preserved). `country` was dropped because a country filter would over-restrict an "explore anywhere" field (Lagos → "london" must still return London).

**Files changed in this rework (vs the prior `f80cbf729` state):**
- `supabase/functions/mapbox-geocode/index.ts` — removed `country`/`types` from `RequestBody`, `SearchOpts`, both URL builders (`buildSuggestUrl`/`buildForwardUrl`), and the `handler()` `searchOpts` collection. Kept `proximity` + `limit` (+ `clampSuggestLimit`). Suggest builder is now byte-identical to pre-1361 except the optional `proximity` + `limit` additions. **ORCH-1079 gate PASSES.**
- `packages/location-input/src/mapboxGeocodeService.ts` — dropped `country`/`types` from `LocationBias` + the `autocompleteMapbox`/`forwardGeocodeMapbox` body spreads. Kept `proximity` + `limit`.
- `packages/location-input/src/MapboxAddressInput.tsx` — dropped `country`/`types` props + destructure + `autocompleteMapbox` args + deps. Kept `proximity` + `suggestLimit`.
- `app-mobile/src/components/location/MapboxAddressInput.tsx` — dropped `country`/`types` pass-through props. Kept `proximity` + `suggestLimit`.
- `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` — removed `country` prop from `LocationInputSection` + removed `country={country}` and `types="place,locality,neighborhood,address,region,district"` from `<MapboxAddressInput>`. Kept `proximity` + `suggestLimit={8}` + `minQueryLength={4}`.
- `app-mobile/src/components/PreferencesSheet.tsx` — removed the `country` state and the `geocodingService.reverseGeocode → setCountry` derivation in the device-anchor effect; removed `country={country}` from `<LocationInputSection>`. Kept `proximity` resolution + threading. (`geocodingService` import retained — still used by the save-path fallback.)
- `app-mobile/src/components/discover/CityPickerSheet.tsx` — removed the `country` state + the `geocodingService.reverseGeocode → setCountry` block + the now-unused `geocodingService` import; removed `country={country}` from `<MapboxAddressInput>`. Kept `proximity`.
- **Tests (all net-new in-branch → append-only SAFE):** `mapboxGeocodeBias.orch1361.test.ts`, `mapboxGeocodeBias.orch1361.adversarial.test.ts`, `orch-1361-preferences-location-multirow-bias.test.tsx` — rewritten to the NEW contract (proximity+limit appended when present; byte-identical when unbiased; explicit filter-free assertions that NO `&types=`/`&country=` ever appears + no `types`/`country` prop on the field/host/CityPicker). Fails-on-revert preserved.

**Gates (this rework):**
- `node .github/scripts/strict-grep/i-mapbox-suggest-no-types-filter.mjs` → `OK`, exit 0. `--self-test` → OK, exit 0.
- `deno test --allow-read --no-check` (all 3 ORCH-1361 suites) → **25 passed, 0 failed**.
- `deno check supabase/functions/mapbox-geocode/index.ts` → OK, exit 0.
- **Fails-on-revert (true line deletion):** deleted the `if (opts.proximity) url += …` line in `buildSuggestUrl` → 3 tests RED (suggest-proximity-appended, injection-safe, adversarial B3); restored → 25 green. Fails-on-revert verified at commit `ed2ef5c5c` (rework commit; the restored/committed code is byte-identical to the tested state).
- ORCH-1315 paywall tests (`orch-1315-preferences-custom-location-paywall.test.tsx`, `orch-1315-1314-paywall-inline-closed-null.test.tsx`, run via `tsx`) → both **PASS** (I-1315 preserved).
- app-mobile tsc → **0 errors in the 4 touched app-mobile files**; no dangling `country`/`types` references (the `packages/location-input` `Cannot find module 'react'` output is a pre-existing cross-package resolution cascade affecting every prop, not this change).
- eslint (4 touched app-mobile files) → **no NEW problems**; the 2 errors (`PreferencesSheet.tsx` unescaped apostrophe; `location/MapboxAddressInput.tsx` `@mingla/location-input` import/no-unresolved) are pre-existing (present on HEAD, outside this diff).

**Nothing else changed:** `handleRetrieve`/`handleReverse`, session-billing, `verify_jwt=true`, the multi-row swap, business pickers, and the `mingla-business` wrapper are untouched. No gate/workflow logic edited.
