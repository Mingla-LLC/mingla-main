# IMPLEMENTATION — ORCH-1362 [onboarding-location]

**Status:** implemented; self-verified (tsc + lint clean on touched files, 15/15 Deno tests green, fails-on-revert proven). Client-only, OTA-able. No edge deploy, no migration.
**Branch:** `1362-onboarding-location` @ `f32b231a6` (worktree `~/Desktop/mingla-orchs/1362-[onboarding-location]/`), pushed to origin.
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1362_ONBOARDING_LOCATION.md` (binding).

---

## 1. Summary

The onboarding no-GPS "Choose your city" manual-location field (shown when Location Services are off/denied — the Apple 5.1.5 path) was calling `geocodingService.autocomplete()` → the edge `forward` action (`limit=1`), so it could only ever surface ONE POI-polluted, server-IP wrong-country row ("lekki, Nigeria" → "Lekki London Nigerian Restaurant, London, GB"). This ORCH points that field at the already-shipped ORCH-1365 place-search engine: the shared `@mingla/location-input` `MapboxAddressInput` in `searchMode="places"` (place-type filter + trailing-country strip + country ISO bias + INC-1 zero-result fallback, NO proximity). Typing "lekki" / "lekki nigeria" now returns a real multi-row PLACE list with **Lekki, Lagos, Nigeria #1**, POIs dropped.

The one blocker the swap required: onboarding is a plain `SafeAreaView`+`ScrollView`, not a gorhom `<BottomSheet>`, and the consumer wrapper hardcoded gorhom `BottomSheetTextInput`/`BottomSheetScrollView` (which THROW outside a `<BottomSheet>` provider). Fixed with an additive `inBottomSheet?: boolean` prop (**default `true`**) that gates the gorhom injection — `false` for onboarding (plain RN fallback), default `true` keeps Preferences + CityPicker byte-identical.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | How verified | Result | Commit |
|----|-----------|--------------|--------|--------|
| SC-1-iOS / SC-1-Android | Multi-row places list, Lekki Lagos #1, POIs absent | Routes through `suggest_places` (ORCH-1365 engine, already live-proven); source-structure T-1/T-6. **Runtime multi-row on device = tester.** | ✓ code path; runtime→tester | f32b231a6 |
| SC-2 | "lekki nigeria" → Lekki Lagos #1 (trailing-country strip) | Inherited from `suggest_places` engine (ORCH-1365 I-PROPOSED-1365 clause b). No new code. | ✓ inherited; runtime→tester | f32b231a6 |
| SC-3 | Preferences/CityPicker byte-identical | `inBottomSheet` defaults `true`; Preferences/CityPicker pass no flag → gorhom still injected. Companion **T-3** + ORCH-1365 suite still green (8/8). Neither host's source changed (0 diff). | ✓ verified | f32b231a6 |
| SC-4 | No proximity | Onboarding field threads no `proximity` prop. **T-7** asserts absence in the render panel. | ✓ verified | f32b231a6 |
| SC-5-iOS / SC-5-Android | Pick writes `data.coordinates` + `data.manualLocation`, confirm advances | `handlePickLocationDetails` maps `PlaceDetails`→`selectedLocation`; `handleManualLocation` UNCHANGED. **T-4/T-5**. **Runtime advance on device = tester.** | ✓ code path; runtime→tester | f32b231a6 |
| SC-6-iOS / SC-6-Android | No gorhom crash on the plain screen; list scrolls | `inBottomSheet={false}` → shared field falls back to RN `TextInput`/`ScrollView` (shared field lines 177/493). **Runtime no-crash+scroll = tester.** | ✓ code path; runtime→tester | f32b231a6 |
| SC-7 | Restore prior `manualLocation` chip | `selectedLocation` state + `initialData.manualLocation` restore KEPT unchanged. | ✓ preserved | f32b231a6 |
| SC-8 | No paywall (pre-account) | No I-1315 paywall imported or added to this field. | ✓ verified | f32b231a6 |

Runtime SCs (SC-1/2/5/6 on-device) are the tester's live-fire remit (SPEC §11); the implementor guarantees the code path + source-structure guards.

---

## 3. Files changed (vs origin/main)

| File | +/− | What |
|------|-----|------|
| `app-mobile/src/components/location/MapboxAddressInput.tsx` | +17/−4 | Add `inBottomSheet?: boolean` (default true) + conditional gorhom injection |
| `app-mobile/src/components/OnboardingFlow.tsx` | +~46/−185 (net −139) | Swap search block → shared field; add `handlePickLocationDetails`; delete dead state/effect/handler/import/17 styles |
| `app-mobile/src/components/__tests__/orch-1362-onboarding-location-places.test.tsx` | +170 (NEW) | Deno source-structure suite T-1..T-7 |
| `app-mobile/src/components/__tests__/orch-1365-preferences-places-no-proximity.test.tsx` | +6/−1 | T-9b updated to the gated form (`[TEST-MOD-APPROVED ORCH-1362]`) |
| `.github/workflows/supabase-migrations-and-stripe-deno.yml` | +50 | Paths filter (OnboardingFlow + new test) + dedicated `orch-1362-onboarding-location-deno-tests` job |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | +6 | DRAFT `I-PROPOSED-1362-ONBOARDING-LOCATION-USES-SHARED-PLACE-SEARCH` |

(The 3 spec/investigation/evidence docs in the diff-vs-origin shipped with the branch's spec commit `aef9f6fac`, not this implementation.)

---

## 4. Data-model changes applied

**None.** No migration, no DB, no RLS. Client-only.

---

## 5. Edge functions touched

**None.** `suggest_places` (action on `supabase/functions/mapbox-geocode`) was already deployed by ORCH-1365 (`verify_jwt=true` — unchanged, do NOT redeploy). No edge deploy required for this ORCH.

---

## 6. Regression tests added + fails-on-revert

**New file:** `app-mobile/src/components/__tests__/orch-1362-onboarding-location-places.test.tsx` (7 tests, Deno source-structure, house style).
- **T-1** onboarding renders `<MapboxAddressInput searchMode="places" inBottomSheet={false}>` + `suggestLimit={8}`/`minQueryLength={3}`/`onPick`/`onClear`.
- **T-2** wrapper gates gorhom on `inBottomSheet` (conditional injection present; hardcoded form gone).
- **T-3** (companion, SC-3) wrapper defaults `inBottomSheet = true` → Preferences/CityPicker keep gorhom.
- **T-4** `handlePickLocationDetails` maps `PlaceDetails` → `{displayName, fullAddress, location:{lat,lng}}`.
- **T-5** confirm still routes to unchanged `handleManualLocation` (writes `coordinates` + `manualLocation` + `goNext()`).
- **T-6** (fails-on-revert) retired `geocodingService.autocomplete(` + `locationSearchTimer` debounce + old row-select handler + runtime import GONE.
- **T-7** no `proximity` threaded to the onboarding field.

**Run (all green):** `deno test --allow-read --no-check … orch-1362-…test.tsx` → **7 passed / 0 failed**. Combined with ORCH-1365 → **15 passed / 0 failed**.

**fails-on-revert verified at commit `f32b231a6`:** true LINE DELETION of the fix lines `inBottomSheet={false}` + `searchMode="places"` from `OnboardingFlow.renderManualLocationPanel` → **T-1 FAILED + T-6 FAILED**. Restored via `git checkout` → **7 passed / 0 failed**. (Console output captured in the implementor session.)

**Append-only:** the new file is ADDED (additions only). The ORCH-1365 test's single deleted line is accepted by `test-append-only-check.js` (`✅ MODIFIED … override token [TEST-MOD-APPROVED ORCH-1362] present`, exit 0). Both tests ship in this branch/PR and are visible in `git diff origin/main...HEAD --name-only`.

---

## 7. Old → New receipts

### `app-mobile/src/components/location/MapboxAddressInput.tsx`
- **Before:** always injected `TextInputComponent={BottomSheetTextInput}` + `ScrollComponent={BottomSheetScrollView}` (gorhom-only; crashes on a plain screen).
- **Now:** new `inBottomSheet?: boolean` prop (default `true`); injection is `inBottomSheet ? BottomSheet* : undefined`. Undefined → shared field falls back to RN `TextInput`/`ScrollView`.
- **Why:** SC-6 (plain-screen host must not inject gorhom) + SC-3 (default preserves Preferences/CityPicker).
- **Lines:** ~17 added / 4 changed.

### `app-mobile/src/components/OnboardingFlow.tsx`
- **Before:** hand-rolled `TextInput` + custom suggestion dropdown driven by a 350ms debounce effect calling `geocodingService.autocomplete()` (forward/`limit=1`); `handleSelectLocationSuggestion` row-select; ~17 dropdown styles.
- **Now:** renders the shared consumer `MapboxAddressInput` (`variant="light"`, `inBottomSheet={false}`, `searchMode="places"`, `suggestLimit={8}`, `minQueryLength={3}`); new `handlePickLocationDetails` maps `PlaceDetails`→`selectedLocation`; dead state (`locationSuggestions`/`locationSearchLoading`/`showLocationSuggestions`/`locationHasSearched`/`locationSearchTimer`), the debounce effect, the old handler, the `geocodingService` runtime import, and 17 styles DELETED. `handleManualLocation` (confirm), the selected-chip card, and the confirm button are UNCHANGED.
- **Why:** SC-1/2/4/5 (multi-row place engine, no proximity, preserved pick/advance).
- **Lines:** ~46 added / 185 removed (net −139; subtract-before-add).
- **Spec reconciliation (documented deviation):** SPEC §4.2(b) says keep `handleClearLocationSelection` "EXACTLY as-is," but §4.2(d) deletes the `locationSuggestions`/`showLocationSuggestions`/`locationHasSearched` state it reset. These conflict; keeping it verbatim would not compile. Resolved by keeping the handler's observable contract (reset `selectedLocation` + `manualLocationText`) and dropping only the now-dead setter calls. No behavior change (the shared field owns suggestion state).

---

## 8. Cross-surface impact

| Surface | Affected | Note | Parity |
|---------|----------|------|--------|
| Consumer iOS (`app-mobile/`) | **YES** | Onboarding no-GPS city field → shared places engine | shared code → auto with Android |
| Consumer Android (`app-mobile/`) | **YES** | Same; nested plain-RN scroll + descender clip (shared-field fix) | tester eyeball delta (SC split) |
| Buyer/anon Web (`mingla-business/`) | NO | No onboarding/location autocomplete | n/a |
| Business iOS (`mingla-business/`) | **NO — untouched** | `suggest`/`buildSuggestUrl` path never imported here (INV-3/ORCH-1079) | n/a |
| Business Android | **NO — untouched** | Same | n/a |
| Admin Web | NO | No location search | n/a |
| Business Web preview | NO | No location search | n/a |

Preferences (`LocationInputSection`) + Discover `CityPickerSheet` are consumers of the SAME wrapper but pass no `inBottomSheet` → default `true` → **0 source diff, byte-identical** (SC-3, proven by companion T-3 + the still-green ORCH-1365 suite).

---

## 9. Smoke result

Source-structure + gate smoke only (no device drive — that is the tester's live-fire remit per SPEC §11):
- `deno test` ORCH-1362 suite → 7/7 green; combined with ORCH-1365 → 15/15 green.
- fails-on-revert reproduced by true line-deletion, restored green.
- `tsc --noEmit` → 0 errors in the two touched source files (the 16 `packages/location-input` "Cannot find module 'react'" errors are the pre-existing monorepo baseline; that package has 0 diff).
- `eslint` on the two touched files → only pre-existing problems (wrapper line-27 `@mingla/location-input` import-resolver gap — unchanged line; OnboardingFlow pre-existing unescaped-entities/unused-vars/exhaustive-deps at unrelated lines). Zero new problems at changed lines.
- `test-append-only-check.js` → exit 0.

**UNVERIFIED (needs tester on device):** SC-1/SC-2 live multi-row + Lekki Lagos #1 ranking; SC-5 pick→coords→advance on iOS + Android; SC-6 no-crash + card-list scroll inside the plain onboarding ScrollView on both platforms. The field is no-GPS-gated — drive via Location Services OFF or the "type your city" link.

---

## 10. Known issues / deferred

- **OQ-1 (minQueryLength):** used **3** per SPEC (matches prior onboarding + wrapper default; Preferences uses 4). No product decision to align to 4 was requested.
- **OQ-2 (invariant form):** registered the standalone DRAFT `I-PROPOSED-1362-*`; the orchestrator MAY instead fold onboarding into `I-PROPOSED-1365-*` clause (e) at CLOSE (noted in the registry entry).
- **OQ-3 (`geocodingService.autocomplete` retirement):** now has no onboarding caller; `autocomplete()` left intact for `useUserLocation`/`localeDetection` fallbacks (D-1, out of scope). A future cleanup ORCH could retire it.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

- **Migration `db push`:** NONE (no migration).
- **Edge-function deploy:** NONE. `suggest_places` on `mapbox-geocode` was deployed by ORCH-1365 (`verify_jwt=true`, unchanged). Do NOT redeploy for this ORCH.
- **At CLOSE (orchestrator):** flip `I-PROPOSED-1362-ONBOARDING-LOCATION-USES-SHARED-PLACE-SEARCH` DRAFT→ACTIVE (or fold into 1365 clause (e)); per-platform consumer OTA (JS-only, runtime 1.1.1 per COMMS-0095) — **NO edge deploy, NO migration**; World Map + registry sync.

---

## 12. Discoveries for Orchestrator

- **Required cross-test modification (authorized):** the wrapper change made ORCH-1365 T-9b's exact-string assertion (`ScrollComponent={BottomSheetScrollView}`) stale; updated to the gated form under `[TEST-MOD-APPROVED ORCH-1362]` (dispatch-authorized). Not a scope expansion — a mandatory consequence of the additive prop. The ORCH-1365 suite is fully green after the update (8/8).
- No unrelated bugs found. The business `suggest` path, the shared package, and the edge fn were read but not touched.
- COMMS ledger: no BLOCK/WARN row addressed to ORCH-1362 or mingla-implementor; the standing OTA BLOCKs (COMMS-0052/0063) don't apply (JS-only, no OTA performed by the implementor).
