# IMPLEMENTATION — ORCH-1365 [location-search-relevance]

**Status:** implemented and self-verified (source + Deno gates GREEN; runtime device eyeball deferred to tester).
**Branch:** `1365-location-search-relevance` · **Worktree:** `~/Desktop/mingla-orchs/1365-[location-search-relevance]/`
**Fix commit:** `ffd16a8175337b987ae3f191501924daddb2f5f1`
**Corrective to:** ORCH-1361 (its proximity-bias approach was validated only on a simulated-Lagos device, not a non-Lagos user searching a Nigerian place).

---

## 1. Summary (plain English)

The consumer Preferences "custom starting point" search now finds the real place a
non-local user types. Three fixes, all proven against live Mapbox in the investigation:

1. **Search places, not businesses** — the field now filters to place/locality/
   neighborhood/region/district, so restaurants and apartments named "Lekki" no
   longer bury Lekki, Lagos.
2. **Drop the device-proximity bias** — this is a "search a place you are NOT at"
   field (it has its own separate GPS toggle), so biasing to the phone's location
   buried the target place for a London-region user. Removed.
3. **Handle a trailing country word** — typing "lekki nigeria" strips "nigeria",
   applies it as a country filter, and searches "lekki" → Lekki, Lagos #1.

Plus two UI bugs: the suggestion card list is now scrollable (was clipping rows
6–8), and the field's typed text no longer clips descenders (g/y/p).

Business venue-name search is on a **separate, byte-identical, filter-free path**
and is untouched. The Discover CityPicker was **NOT touched** (orchestrator OQ-2
declined). The Mingla+ paywall on the field (I-1315) is preserved.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1 | non-Lagos "lekki" → Lekki Lagos #1, POIs absent | ✓ source; runtime→tester | `buildPlaceSuggestUrl` types filter (`index.ts`), proven live evidence probe B; `ffd16a8` |
| SC-2 | non-Lagos "lekki nigeria" → Lekki Lagos #1 (trailing "nigeria" stripped→`country=ng`) | ✓ source; runtime→tester | `parseTrailingCountry` + `handleSuggestPlaces` (`countryNames.ts`/`index.ts`), evidence probe G/N; T-3 green; `ffd16a8` |
| SC-3 | no `feature_type=poi` for a place-mode query | ✓ | `types=place,locality,neighborhood,region,district`; T-1; `ffd16a8` |
| SC-4 | Preferences field sends no `proximity` | ✓ | host proximity effect/state/prop removed; T-7/T-8; `ffd16a8` |
| SC-5 | business `suggest` URL byte-identical to pre-1365; POIs still returned | ✓ | T-5 (`buildSuggestUrl` byte-equals pre-1365) + scoped ORCH-1079 gate; fails-on-revert @ `ffd16a8` |
| SC-5-iOS / SC-5-Android | business apps unchanged | ✓ (shared `venue` default) | business wrapper omits `searchMode`→default `venue`; runtime→tester |
| SC-6 | "lekki phase"/"lekki london" NOT over-stripped | ✓ | T-4 (probes L/M); `ffd16a8` |
| SC-7 / SC-7-iOS / SC-7-Android | 8 suggestions scroll; row 8 reachable | ✓ source; runtime→tester | gorhom `BottomSheetScrollView` injected (`ScrollComponent`); T-9b; `ffd16a8` |
| SC-8 / SC-8-iOS / SC-8-Android | descenders not clipped | ✓ source; runtime→tester | removed `lineHeight:24`; Android `textAlignVertical:"center"`; T-9c; `ffd16a8` |
| SC-9 | free users still hit the I-1315 paywall; field unreachable | ✓ | paywall wiring untouched; `!useGpsLocation && !isLocked` guard preserved (T-8c); `ffd16a8` |
| SC-10 | pick still resolves via `retrieve`, stores custom_lat/lng | ✓ | `retrieve`/`handleRetrieve`/`onPickLocation` untouched; `ffd16a8` |

Runtime rows marked "runtime→tester" are source-correct + proven on the live upstream
in the investigation; the tester must runtime-prove SC-1/SC-2 from a non-Lagos context
and eyeball SC-7/SC-8 on iOS+Android with a Mingla+ account (the field is I-1315-gated).

---

## 3. Files changed (15 files, +1432 / −140)

Edge:
- `supabase/functions/mapbox-geocode/countryNames.ts` **(NEW, +310)** — `COUNTRY_NAME_TO_ISO` (English + aliases) + `parseTrailingCountry`.
- `supabase/functions/mapbox-geocode/index.ts` **(+151/−…)** — `suggest_places` action, `PLACE_SUGGEST_TYPES`, `buildPlaceSuggestUrl`, `handleSuggestPlaces`, switch case, `parseTrailingCountry` import, `RequestBody.action` union widened.

Service + component (shared package):
- `packages/location-input/src/mapboxGeocodeService.ts` **(+47)** — `autocompletePlacesMapbox`.
- `packages/location-input/src/MapboxAddressInput.tsx` **(+109/−…)** — `searchMode` routing, `ScrollComponent` scrollable card list (F-5), TextInput text-clip fix (F-6).

Consumer (app-mobile):
- `app-mobile/src/components/location/MapboxAddressInput.tsx` **(+20)** — forwards `searchMode`, injects `BottomSheetScrollView`.
- `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` **(−38 net)** — `searchMode="places"`, `proximity` prop + type removed.
- `app-mobile/src/components/PreferencesSheet.tsx` **(−49 net)** — `getLastKnownLocation` proximity effect + `proximity` state + prop pass removed.

Gate + tests + CI + registry:
- `.github/scripts/strict-grep/i-mapbox-suggest-no-types-filter.mjs` **(scoped, [TEST-MOD-APPROVED ORCH-1365])** — scoped to the business builder; proves `buildSuggestUrl` filter-free + `handleSuggest` never borrows `buildPlaceSuggestUrl`.
- `supabase/functions/mapbox-geocode/__tests__/countryNames.orch1365.test.ts` **(NEW)** — T-3/T-4.
- `supabase/functions/mapbox-geocode/__tests__/mapboxPlaceSuggest.orch1365.test.ts` **(NEW)** — T-1/T-2/T-5.
- `supabase/functions/mapbox-geocode/__tests__/mapboxPlacesService.orch1365.test.ts` **(NEW)** — T-7.
- `app-mobile/src/components/__tests__/orch-1365-preferences-places-no-proximity.test.tsx` **(NEW)** — T-8/T-9.
- `app-mobile/src/components/__tests__/orch-1361-preferences-location-multirow-bias.test.tsx` **(updated, [TEST-MOD-APPROVED ORCH-1365])** — Preferences proximity assertions → drop-proximity contract; CityPicker OQ-4 assertions unchanged.
- `.github/workflows/supabase-migrations-and-stripe-deno.yml` — new job `orch-1365-location-search-relevance-deno-tests` + path filters.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — DRAFT `I-PROPOSED-1365-CONSUMER-PLACE-SEARCH-TYPE-FILTERED` + ORCH-1361 narrowing note.

**NOT committed (orchestrator-owned):** `Mingla_Artifacts/WORLD_MAP.md` (ORCH-1365 registration row, left uncommitted in the worktree).
**NOT touched (DO-NOT-TOUCH honored):** `app-mobile/src/components/discover/CityPickerSheet.tsx`, any `mingla-business/**`, buyer-web, admin, the I-1315 paywall wiring, `handleSuggest`/`buildSuggestUrl`/`retrieve`/`reverse`/`forward`, `verify_jwt`, session billing.

---

## 4. Data-model changes applied

None. No migration, no schema/RLS change (SPEC §2 non-goal). BACKFILL-EXEMPT for migrations.

---

## 5. Edge functions touched

- `supabase/functions/mapbox-geocode` — **additive** `suggest_places` action only. **`verify_jwt=true` MUST be preserved** (unchanged in `supabase/config.toml`). Deploy from MERGED main (orchestrator/operator-owned). Post-deploy curl-verify `suggest_places` returns Lekki Lagos #1 for "lekki" and "lekki nigeria".

---

## 6. Regression tests added — fails-on-revert PROVEN

All append-only. New CI job `orch-1365-location-search-relevance-deno-tests` + the scoped ORCH-1079 gate (in `strict-grep-mingla-business.yml`) + the updated ORCH-1361 job.

**Full suite result:** 65 passed / 0 failed (1361 + 1361-adversarial + 1365×3 + 1060 + 1079 + both source-structure suites). Gate self-test + live both exit 0.

**fails-on-revert verified at `ffd16a8175337b987ae3f191501924daddb2f5f1` (true line change, then `git checkout` restore):**

- **T-5 (business byte-identical + isolation)** — repointed `handleSuggest` at `buildPlaceSuggestUrl` (reverting the isolation) → `mapboxPlaceSuggest.orch1365.test.ts` T-5 source-isolation **RED** AND scoped ORCH-1079 gate **RED (exit 1)**. Restored → **GREEN (8/8)** + gate exit 0.
- **T-8 (Preferences drop-proximity contract)** — re-added `proximity={proximity}` to the field (the exact ORCH-1361 regression) → `orch-1365-preferences-places-no-proximity.test.tsx` T-8a **RED**. Restored → **GREEN (8/8)**.

Test paths:
- `supabase/functions/mapbox-geocode/__tests__/countryNames.orch1365.test.ts` (12 tests)
- `supabase/functions/mapbox-geocode/__tests__/mapboxPlaceSuggest.orch1365.test.ts` (8 tests)
- `supabase/functions/mapbox-geocode/__tests__/mapboxPlacesService.orch1365.test.ts` (4 tests)
- `app-mobile/src/components/__tests__/orch-1365-preferences-places-no-proximity.test.tsx` (8 tests)

---

## 7. Old → New receipts

### supabase/functions/mapbox-geocode/index.ts
**Before:** 4 actions (`suggest`/`retrieve`/`reverse`/`forward`); the suggest handler was filter-free and served both business + consumer.
**Now:** ADDITIVE `suggest_places` action + `buildPlaceSuggestUrl` (types filter + optional `country`/`proximity`) + `handleSuggestPlaces` (trims, strips trailing country, searches). The 4 original actions/builders are byte-identical; `handleSuggest` still calls `buildSuggestUrl`.
**Why:** SC-1/SC-2/SC-3 (POIs dropped, trailing-country handled) while SC-5 keeps business filter-free.
**Lines:** ~+150.

### supabase/functions/mapbox-geocode/countryNames.ts (NEW)
**Before:** did not exist.
**Now:** static English country-name→ISO map + `parseTrailingCountry` (≥2-token guard, longest trailing match, comma/case tolerant).
**Why:** SC-2 trailing-country strip; SC-6 safety (never strip a city/non-country/single word).
**Lines:** +310.

### packages/location-input/src/mapboxGeocodeService.ts
**Before:** `autocompleteMapbox` posts `action:"suggest"`.
**Now:** ADDITIVE `autocompletePlacesMapbox` posts `action:"suggest_places"`; `autocompleteMapbox` unchanged.
**Why:** route the consumer field to the place-filtered action without changing business.
**Lines:** +47.

### packages/location-input/src/MapboxAddressInput.tsx
**Before:** always called `autocompleteMapbox`; card list rendered rows in an `overflow:hidden` + `maxHeight` View (clipped, unscrollable); TextInput forced `lineHeight:24` + Android `paddingVertical:0` (descender clip).
**Now:** `searchMode` routes places→`autocompletePlacesMapbox` else `autocompleteMapbox` (default `"venue"`); card list rows wrapped in an injectable `ScrollComponent` (maxHeight bounds a scroll viewport; status rows stay above); TextInput `lineHeight:24` removed, Android `textAlignVertical:"center"`.
**Why:** SC-1..SC-4 routing, SC-7 scroll, SC-8 clip; default preserves business byte-identically.
**Lines:** ~+100.

### app-mobile/src/components/location/MapboxAddressInput.tsx
**Before:** injected `BottomSheetTextInput` only.
**Now:** forwards `searchMode` (default `"venue"`) + injects `ScrollComponent={BottomSheetScrollView}` (gorhom re-export).
**Why:** thread places mode + scroll fix into Preferences.
**Lines:** +20.

### app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx + PreferencesSheet.tsx
**Before:** resolved device anchor via `getLastKnownLocation` → `setProximity`, threaded `proximity` into the field.
**Now:** proximity effect/state/prop removed; field gets `searchMode="places"`. `enhancedLocationService` import retained (still used by the GPS deck toggle).
**Why:** SC-4 (drop proximity, OQ-4); SC-1/SC-2 rank correctly without it.
**Lines:** ~−87 net.

---

## 8. Cross-surface impact

| # | Surface | Affected | Behavior | Parity |
|---|---------|----------|----------|--------|
| 1 | Consumer iOS | **YES** | Preferences field finds the real place; list scrolls; text not clipped | shared code → auto w/ Android |
| 2 | Consumer Android | **YES** | same; verify descender + gorhom scroll on device | manual eyeball delta (tester) |
| 3 | Buyer/anon Web | NO | no location autocomplete on those routes | n/a |
| 4 | Business iOS | **NO (byte-identical search)** | venue search unchanged (default `venue` mode → `suggest`/`buildSuggestUrl`); POIs resolve. Business card uses `maxHeight:9999` (unbounded → the new ScrollView wrapper renders all rows, no scroll behavior change) + gets the benign shared text-clip fix | T-5 + scoped gate |
| 5 | Business Android | **NO (byte-identical search)** | same | same |
| 6 | Admin Web | NO | no consumer location search | n/a |
| 7 | Business Web preview | NO | no consumer location search | n/a |

Note (surfaces 4/5): the search PATH is byte-identical (proven). The shared-component
scroll container + text-clip fixes are authored per SPEC §4.3 (allowlisted shared
change); they are strict improvements to the business card UI with no behavior change
(business `maxHeight:9999` never triggers scrolling), not a regression.

---

## 9. Smoke result

- `deno check supabase/functions/mapbox-geocode/index.ts` + `countryNames.ts` → clean.
- All 4 new Deno suites + the updated ORCH-1361 suite + sibling 1060/1079 suites → **65 passed / 0 failed**.
- Scoped ORCH-1079 gate `--self-test` and live → exit 0 (business filter-free).
- fails-on-revert reproduced by true line change for T-5 (+ gate) and T-8 (see §6).
- tsc: the app-mobile touched files + the pure-TS service typecheck clean. The 17
  `packages/location-input` errors are the PRE-EXISTING "cannot find module 'react'"
  cascade (the out-of-root package's react never resolves under a consuming app's
  tsc — identical on origin/main and in both app-mobile AND mingla-business
  contexts); every one is TS2307-react / TS2875-jsx-runtime / downstream TS7031
  implicit-any — zero real type errors from the `searchMode`/`ScrollComponent`
  additions.
- eslint on touched files: no NEW problems (the reported warnings/errors —
  unused imports, hook-deps, an unescaped entity at line 1130, and the workspace
  `@mingla/location-input` import/no-unresolved — all pre-exist and are outside my
  edits; my new relative `BottomSheetScrollView` import resolved cleanly).
- Runtime device eyeball (SC-1/SC-2 from a non-Lagos context; SC-7/SC-8 iOS+Android
  on a Mingla+ account) is UNVERIFIED here → owned by the tester.

---

## 10. Known issues / deferred

- **Country-name / place-name collisions (documented limitation, in-scope of the SPEC's English map):** a handful of country names collide with US states / cities / given names (e.g. "atlanta georgia" would strip "georgia"→`ge`; "jordan"). Per the orchestrator OQ-1 ruling the map is English country names + aliases, and the SPEC declares locale/place-disambiguation out of scope for v1. The types-filter still helps these queries; if a real user hits a collision, it is a candidate follow-on ORCH (a small ambiguous-name exclusion set), NOT a fix to widen here.
- No `[TRANSITIONAL]` code introduced.
- CityPicker keeps its ORCH-1361 proximity behavior (OQ-2 declined) — intentional.

---

## 11. Operator action required (for orchestrator/CLOSE)

1. **No migration** — nothing to `db push`.
2. **Deploy the edge fn from MERGED main** (orchestrator/operator-owned):
   `supabase functions deploy mapbox-geocode` (preserve `verify_jwt=true`). Then curl-verify `suggest_places` returns Lekki, Lagos, Nigeria #1 for both `"lekki"` and `"lekki nigeria"`.
3. **JS ships via per-platform OTA** (consumer app) — no native change.
4. **At CLOSE:** flip `I-PROPOSED-1365-CONSUMER-PLACE-SEARCH-TYPE-FILTERED` ACTIVE; narrow `I-PROPOSED-1361-CONSUMER-LOCATION-PROXIMITY-BIASED` to CityPicker-only per the registry note; sync WORLD_MAP (uncommitted row present in the worktree).
5. **Comms:** COMMS-0094 (ORCH-1331) read + factored — my `supabase/functions/mapbox-geocode` change is unrelated to partner splits and does not trip the `orch-1331-*` gates.

---

## 12. Discoveries for Orchestrator

- **Package react-resolution quirk (pre-existing):** `packages/location-input` source cannot resolve `react` under either app's tsc/eslint (out-of-root path). Not introduced here and not blocking (ORCH-1361 shipped the same file), but the package has no isolated typecheck — a future ORCH could add one (its own `node_modules`/project references) so the shared package is type-gated on its own.
- **Country/place collision** (see §10) — registerable as a low-priority follow-on if a user reports it.
