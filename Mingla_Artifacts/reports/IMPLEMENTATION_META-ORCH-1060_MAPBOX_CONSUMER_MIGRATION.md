# IMPLEMENTATION — META-ORCH-1060 [Mapbox address/geocoding migration — CONSUMER LEG]

- **Skill:** mingla-implementor (Claude)
- **Date:** 2026-06-05
- **Worktree:** `~/Desktop/mingla-orchs/meta-orch-1060-[mapbox-consumer-migration]/` on branch `meta-orch-1060-mapbox-consumer-migration`
- **Base commit (fails-on-revert anchor):** `a43330850`
- **Status:** implemented and verified (sim/device UX verification deferred — see Verification Matrix)
- **Inputs:** SPEC `Mingla_Artifacts/specs/SPEC_META-ORCH-1060_MAPBOX_CONSUMER_MIGRATION.md`; DESIGN `Mingla_Artifacts/design/DESIGN_META-ORCH-1060_CONSUMER_MAPBOX_PICKER.md`.

## COMMS ledger
- Read on entry. Factored **COMMS-0002** (backend allowlist — added `META_ORCH_1060_BACKEND_ALLOWLIST` in the SAME commit as the backend changes; C7 green), **COMMS-0003** (Mapbox docs URLs cited inline in every edge-fn/helper/service header + the SPEC), **COMMS-0020** (RESOLVED — `mapbox-geocode` source already on main; no reconciliation needed; Phase 0 = verify + redeploy-from-main only).

---

## Layman summary
The consumer app's address/city search and country detection moved off the rate-limited free OpenStreetMap (Nominatim) onto Mapbox — the same proven engine the business experience picker uses. The Mapbox picker is now a shared package both apps use. The Discover city picker gets correct state/country ISO codes from Mapbox's structured fields instead of a fragile text parser. A paired friend who only has a city in their profile (no GPS) now centers the deck correctly instead of showing an empty "no recent location" state. Profile location stays on the phone's native geocoder (untouched).

---

## Files changed — Old → New receipts

### supabase/functions/mapbox-geocode/index.ts (MODIFY — keystone)
- **Before:** `retrieve` returned `region` (name) only; no `regionCode`. No `reverse`/`forward` actions. `serve()` ran at top-level (untestable).
- **Now:** added STRUCTURED `regionCode` (ISO 3166-2) + `regionCodeFull` to the `retrieve`/`reverse`/`forward` `details` from `context.region.region_code(_full)`; added `reverse` + `forward` actions; extracted a shared `featureToDetails` normalizer (exported for unit test); guarded `serve()` behind `import.meta.main`; added `handler`/`featureToDetails` exports. All v19 fields preserved byte-for-byte. Mapbox docs URLs cited inline.
- **Why:** SPEC §3.1 (keystone) + §3.7 (reverse/forward) + SC-0/SC-1/SC-6.
- **Lines:** ~180 added.

### supabase/functions/_shared/mapboxGeocode.ts (NEW)
- Server-to-server Mapbox `/forward` helper (`forwardGeocodeText`) for the paired-view fallback; reads `MAPBOX_ACCESS_TOKEN`; module-scoped text→coords cache (≤500 / 24h, caches negatives); best-effort null on any failure. Docs cited inline. SPEC §4.5/§4.6.

### supabase/functions/_shared/personHeroCards.ts (MODIFY)
- **Before:** `resolveFriendLocation` returned `null` whenever the consent-gated RPC produced no numeric coords → hero empty state.
- **Now:** after the RPC (which enforces consent) returns no coords, reads `profiles.location` text for the friend and forward-geocodes it via `forwardGeocodeText`; returns that center, else degrades to `null` (never fabricates). Profile read wrapped in try/catch (preserves the ORCH-0986 adversarial test's null result on test doubles). SPEC §4.3.
- **Lines:** ~35 added.

### packages/location-input/ (NEW shared package)
- `src/mapboxGeocodeService.ts` — extracted from business; `autocomplete/retrieve/reverse/forward` with injected `invoke`; `PlaceDetails` extended with `regionCode`/`regionCodeFull`.
- `src/MapboxAddressInput.tsx` — extracted field; token-injection (`tokens`/`IconComponent`/`invoke`/`copy`); `variant` via injected bundle; `minQueryLength`; NEW `fetching_details` + `pick_error` + `no_results` + `offline` states; gorhom-aware `TextInputComponent` injection; haptics (try/catch); inline-vs-card `dropdown.mode`; a11y + live-region announcements.
- `src/types.ts` — `LocationInputTokens` / `LocationInputCopy` / `LocationInputIcon`.
- `index.ts`, `package.json`, `tsconfig.json` — modeled on `packages/phone-input`. Pure-presentational (imports only react/react-native + relative); META-ORCH-0827 isolation gate PASS.

### mingla-business/src/components/location/MapboxAddressInput.tsx (MODIFY → thin wrapper)
- Now injects BUSINESS tokens (reproducing the pre-extraction dark-glass StyleSheet byte-for-byte: divider transparent, no focus bg lift, static border, unbounded dropdown) + business Icon/supabase/copy into the shared field. Importer prop interface UNCHANGED (drop-in). SC-7.

### mingla-business/src/services/mapboxGeocodeService.ts (MODIFY → thin shim)
- Re-exports `PlaceDetails`/`PlaceAutocompleteSuggestion`/`newMapboxSessionToken` from the package; business-supabase-bound `autocompleteMapbox`/`retrieveMapboxPlace` keep their exact old signatures (no `invoke` arg) so the 2 type-only importers compile unchanged.

### app-mobile/src/services/geocodingService.ts (MODIFY → Mapbox adapter)
- **Before:** Nominatim `/search` + `/reverse` fetches with hand-rolled extractors.
- **Now:** `autocomplete()` → Mapbox `/forward` (ONE call/query, best match WITH coords — no eager retrieve-N); `reverseGeocode()` → Mapbox `/reverse`; returns `countryCode` (structured) on the result; common-location offline fallback kept; signatures + 24h reverse cache + 5min autocomplete LRU preserved. ZERO Nominatim. SPEC §3.9.

### app-mobile/src/components/location/MapboxAddressInput.tsx (NEW — consumer wrapper)
- Injects CONSUMER tokens (light + dark variant per DESIGN §1.1/§1.2), Icon, supabase invoke, Mingla-voice copy, expo-haptics, BottomSheetTextInput into the shared field. Placeholder raised to `#6b7280` (DESIGN §5 contrast lock). Imports `@mingla/location-input` (INV-2).

### app-mobile/src/components/discover/CityPickerSheet.tsx (MODIFY — HIGH blast)
- **Before:** Nominatim via `geocodingService.autocomplete`; `parseStateCountry()` display-string parser; `split(",")[0]` city derivation; US-only state codes.
- **Now:** shared `MapboxAddressInput` (dark variant); `discover_city_name = details.city`, `discover_city_state_code = details.regionCode`, `discover_city_country_code = details.countryCode`, lat/lng from `details.location` — all STRUCTURED. `parseStateCountry` + `split(",")[0]` DELETED; `US_STATE_CODES`/`COUNTRY_NAME_TO_CODE`/`geocodingService` imports removed. SPEC §3.5.

### app-mobile/src/utils/localeDetection.ts (MODIFY)
- `detectLocaleFromCoordinates` now prefers the structured `countryCode` via `getCurrencyByCountryCode`, falling back to name lookup. SPEC §3.7 / SC-6a.

### Config + CI
- `app-mobile/metro.config.js`, `mingla-business/metro.config.js`, both `tsconfig.json` — `@mingla/location-input` alias added.
- 3 NEW strict-grep gates: `i-consumer-location-no-nominatim.mjs` (INV-1), `i-consumer-location-uses-shared-mapbox.mjs` (INV-2), `i-discover-city-codes-from-mapbox-context.mjs` (INV-3) — each with `--self-test`; 3 jobs wired into `.github/workflows/strict-grep-mingla-business.yml`.
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` — added `META_ORCH_1060_BACKEND_ALLOWLIST` (mapbox-geocode index + its test, `_shared/mapboxGeocode.ts` + test, `personHeroCards.ts` + test, the 3 gate files) wired into the combined ALLOWLIST (COMMS-0002).

### NOT touched (verified)
- `app-mobile/src/utils/throttledGeocode.ts` (Profile native geocoder — SPEC §3.4 / SC-3, byte-unchanged); the business event/trip/brand Google `AddressAutocompleteInput`/`places-autocomplete` pickers (L1).

---

## events.city token-parity verification (SPEC's flagged risk — RESOLVED)
The business event wizard (`CreatorStep3Where.tsx:88`) writes `events.city = details.city`, where `details.city` comes from the `mapbox-geocode` edge fn's `featureToDetails` (`context.place.name ?? locality.name ?? district.name`). The consumer CityPicker now writes `discover_city_name = details.city` from the **identical** edge-fn extraction. **The two tokens are byte-identical by construction** — both flow through the same `featureToDetails` city logic. This is strictly safer than the old path (consumer parsed a Nominatim `split(",")[0]` string while business used Google's `details.city` — a real mismatch hazard now eliminated). ORCH-0824 exact-match join preserved.

---

## Step 0.5 — Regression tests + fails-on-revert proof
- **Keystone** `supabase/functions/mapbox-geocode/__tests__/meta_orch_1060_region_code.test.ts` (T-01/01b/01c + honest-error cases) — PASS (5/5). **fails-on-revert verified at `a43330850`**: forcing `regionCode/regionCodeFull = null` (name-only revert) → T-01 + T-01b FAIL.
- **Paired text fallback** `supabase/functions/_shared/__tests__/meta_orch_1060_paired_text_fallback.test.ts` (T-10/10b/10c/10d + empty-text + GPS-wins) — PASS (6/6). **fails-on-revert verified at `a43330850`**: inserting an early `return null` (pre-§4 behavior) → T-10 + T-10d FAIL (runtime assertion).
- **Forward helper** `supabase/functions/_shared/__tests__/meta_orch_1060_mapbox_geocode.test.ts` (parse/null/cache/non-OK) — PASS (5/5).
- Combined run: **17 passed, 0 failed**. Existing `personHeroCards.adversarial.test.ts` still PASSES (preserved via defensive try/catch).

---

## Verification Matrix
| SC | Result | Evidence |
|---|---|---|
| SC-0 | DEFERRED to deploy | Edge fn changed; redeploy-from-main is orchestrator's step. `verify_jwt` unchanged in source. |
| SC-1 | PASS | T-01* keystone tests; `featureToDetails` reads `region_code` only. |
| SC-2/-Android | PARTIAL (code) | Preferences keeps `geocodingService.autocomplete` (now Mapbox forward) + the 0943 atomic-write block unchanged; 0943 gate green. Device UX unverified. |
| SC-3 | PASS | `throttledGeocode.ts` byte-unchanged; real `reverseGeocodeAsync` call only there (other hits are comments). |
| SC-4/-Android | PASS (code) | INV-3 gate green; structured codes; token-parity verified (above). Device UX unverified. |
| SC-5 | PASS (code) | Onboarding `geocodingService.autocomplete` now Mapbox; no Nominatim. |
| SC-6a/6b | PASS (code) | localeDetection uses structured `countryCode`; night-out via Mapbox reverse. |
| SC-7/-Android | PASS (code) | Business importers compile + drop-in; business tsc clean on mapbox files; token bundle reproduces pre-extraction styles. Device UX unverified. |
| SC-8 | PASS (code) | useUserLocation `.find(s=>s.location)` works on the Mapbox forward result; no Nominatim. |
| SC-9 | PASS | `grep -rni nominatim app-mobile/src` = 0. |
| SC-10 | PASS | T-10* tests (resolve/consent/fail-graceful/cache). |
| T-CI | PASS | C7 `no-new-backend-files` green; allowlist updated same commit. |

`tsc --noEmit`: zero errors in touched `app-mobile/src` + business mapbox files. Package "Cannot find module react" notices are baseline (identical for `packages/brand-rendering`/`phone-input` — packages type-check via their own tsconfig/metro, not the app program).

---

## Deploy notes (for orchestrator — do NOT run from worktree)
After PR merges to main and `origin/main` contains the squash commit + content-probe of `mapbox-geocode/index.ts`:
```bash
cd "/Users/sethogieva/Desktop/mingla-main" && supabase functions deploy mapbox-geocode --project-ref gqnoajqerqhnvulmnyvv
```
Only `mapbox-geocode` needs deploy (the `_shared/mapboxGeocode.ts` helper + `personHeroCards.ts` ride the consumers `get-person-hero-cards` + `get-paired-profile-cards` — redeploy those two as well so the bundled `_shared` updates):
```bash
cd "/Users/sethogieva/Desktop/mingla-main" && supabase functions deploy get-person-hero-cards get-paired-profile-cards --project-ref gqnoajqerqhnvulmnyvv
```
Verify-first-call: a live `retrieve` returns the new `regionCode`; the hero/paired fns return non-404.

## Migrations awaiting `supabase db push`
**NONE.** SPEC §4.4 explicitly defers any `profiles.location_lat/lng` column; v1 uses resolve-time geocode + in-fn cache. No DB migration in this leg.

## Deno gates
Run from worktree: `deno check` clean on all 3 touched edge-fn files; `deno test` 17/17 PASS.

---

## Discoveries for orchestrator
1. **Name collision in the C7 allowlist:** a pre-existing `ORCH_1060_BACKEND_ALLOWLIST` (stripe-mode/invite-scanner, a different prior ORCH-1060 usage) already exists in `orch-0863-marketing-hub-phase-b.mjs`. I added a distinctly-named `META_ORCH_1060_BACKEND_ALLOWLIST` to avoid clobbering it. Flag for cleanup awareness.
2. **Preferences/Onboarding kept on `geocodingService` (Mapbox forward), not the shared field.** Per SPEC §3.9 implementor latitude + the LOCKED 0943 test that asserts `geocodingService.autocomplete(searchLocation)` at PreferencesSheet:891. Result: those two surfaces show a single best-match suggestion (forward) rather than a multi-row suggest list. CityPicker (the primary city picker) got the full multi-row shared field. If multi-row UX is wanted in Preferences/Onboarding later, that's a follow-up that would need a `[TEST-MOD-APPROVED]` for the 0943 text test.
3. **Consumer `0943` text-assertion test** (`orch-0943-prefs-apply-coord-coherence.test.tsx`) is a standalone TS-`declare` module not runnable via plain node strip-types; its asserted patterns are all still present (verified by grep). The CI runner for these `.tsx` assertion files is unchanged.
