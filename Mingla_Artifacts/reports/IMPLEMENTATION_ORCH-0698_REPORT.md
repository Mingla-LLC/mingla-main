# IMPLEMENTATION_ORCH-0698_REPORT — Map view dead-code cleanup

**Implementor:** mingla-implementor
**Dispatch:** [prompts/IMPL_ORCH-0698_MAP_VIEW_DEAD_CODE_CLEANUP.md](../prompts/IMPL_ORCH-0698_MAP_VIEW_DEAD_CODE_CLEANUP.md)
**Date:** 2026-04-29
**Status:** IMPLEMENTED · Verification: PASSED (tsc clean at 3 baseline; 4/4 grep checks return 0 matches)

---

## §1 Layman summary

The Map view was orphaned — no nav tab, no JSX render, no callers. Deleted the entire `app-mobile/src/components/map/` directory (17 files), plus 1 transitively-dead React Query hook (`useMapSettings.ts`), plus the import + JSX render + hook usage in `AccountSettings.tsx`, plus 3 native dependencies (`react-native-maps`, `@maplibre/maplibre-react-native`, `react-native-map-clustering`) plus 3 orphaned expo config blocks (iOS Google Maps SDK config, Android Google Maps config, MapLibre plugin + 2 EXPO_PUBLIC env vars). 25 file changes total (18 deletions + 7 edits). tsc still clean at exactly 3 baseline errors (zero new). Net Constitution #8 win.

---

## §2 Files changed (25 total)

### §2.1 Deletions (18 files)

| # | File | Reason |
|---|---|---|
| 1-17 | `app-mobile/src/components/map/**/*` (17 files) | Entire orphaned subtree per dispatch §D.1 |
| 18 | `app-mobile/src/hooks/useMapSettings.ts` | Transitively dead — only consumers were the 3 dying components (DiscoverMap.tsx + MapPrivacySettings.tsx + AccountSettings.tsx). Adding to deletion list is a SCOPE EXPANSION explicitly approved per "implementor sweep" caveat in dispatch §E.7e. |

### §2.2 Edits (7 files)

| # | File | Change |
|---|---|---|
| 1 | `app-mobile/src/components/profile/AccountSettings.tsx` | Deleted 2 imports (`MapPrivacySettings`, `useMapSettings`) at lines 20-21; deleted hook destructure at line 84; deleted JSX block (Map Privacy section + preceding orphan divider) at lines 629-634 — net -10 LOC |
| 2 | `app-mobile/src/utils/mutateCuratedCard.ts` | Removed stale comment reference to `DiscoverMap:170` from inline JSDoc at line 119 (pre-existing comment described callsites; now-deleted file became invalid reference) — net -1 line |
| 3 | `app-mobile/package.json` | Deleted 3 dep lines: `@maplibre/maplibre-react-native@^10.4.2` (line 22), `react-native-map-clustering@^4.0.0` (line 72), `react-native-maps@^1.20.1` (line 73) |
| 4 | `app-mobile/package-lock.json` | Regenerated via `npm install`. Result: 15 packages removed (3 direct + 12 transitive). |
| 5 | `app-mobile/app.config.ts` | Deleted 14 lines: iOS `config.googleMapsApiKey` block (lines 7-12) + Android `config.googleMaps` block (lines 13-20). Both were build-time native SDK config for `react-native-maps` — orphaned. |
| 6 | `app-mobile/app.json` | Deleted 3 entries: `@maplibre/maplibre-react-native` plugin (line 123), `EXPO_PUBLIC_DISCOVER_MAP_PROVIDER` extra var (line 134), `EXPO_PUBLIC_MAPLIBRE_STYLE_URL` extra var (line 135). All orphaned post-package removal. |
| 7 | `app-mobile/.env.example` | Deleted `GOOGLE_MAPS_API_KEY` env var entry (lines 1-2) — was only consumed by the now-deleted iOS/Android map config in app.config.ts |

---

## §3 Old → New receipts

### §3.1 `app-mobile/src/components/profile/AccountSettings.tsx`

**What it did before:**
- Imported `MapPrivacySettings` from `../map/MapPrivacySettings`
- Imported `useMapSettings` from `../../hooks/useMapSettings`
- Called `useMapSettings()` hook on every render to get `mapSettings` + `updateMapSettings`
- Rendered Map Privacy settings inside the Privacy accordion section, below a divider after Notifications row

**What it does now:**
- No map-related imports
- No `useMapSettings()` call
- Privacy accordion section ends cleanly at the Notifications row (no orphan divider, no orphan Map Privacy block)

**Why:** Map Privacy UI is for the now-deleted Map view. Settings have no purpose without the Map view they configure. Removing the orphan section.

**Lines changed:** -2 imports, -1 hook destructure, -6 JSX lines (5 lines block + 1 preceding divider) = ~10 net LOC removed

### §3.2 `app-mobile/src/utils/mutateCuratedCard.ts`

**What it did before:** Inline JSDoc comment listed callsites for `useIsPlaceOpen()` consumers, including `DiscoverMap:170` as one of three reference points.

**What it does now:** Comment lists only the still-existing callsites: `ExpandedCardModal:1191`, `ActionButtons:121`, `ProposeDateTimeModal:128`. Removed the stale `DiscoverMap:170` reference + the trailing sentence about strict `=== false` check (which described DiscoverMap's specific behavior).

**Why:** Comment hygiene. Per dispatch §C: "scope expansion to fix unrelated comments" is allowed only if the reference is now stale due to the deletion. This is exactly that case.

**Lines changed:** -1 line in a 7-line comment block

### §3.3 `app-mobile/package.json`

**What it did before:** Listed 3 native dependencies for the Map view's rendering pipeline (`react-native-maps` for iOS Google Maps + Android Google Maps SDK; `@maplibre/maplibre-react-native` for the alternate MapLibre provider; `react-native-map-clustering` for marker clustering).

**What it does now:** None of those 3 lines exist. `npm install` reports "removed 15 packages, audited 1066" (3 direct removals + 12 transitive cleanup).

**Why:** All 3 packages were consumed exclusively by the deleted `app-mobile/src/components/map/` subtree. Verified via grep: 0 references in `app-mobile/src` or `app-mobile/app` post-deletion.

**Lines changed:** -3 lines in dependencies block

### §3.4 `app-mobile/app.config.ts`

**What it did before:** Configured iOS native build with `googleMapsApiKey` and Android native build with `googleMaps.apiKey` for `react-native-maps` SDK authentication.

**What it does now:** No iOS/Android native map config blocks. Plugins + extra blocks unchanged.

**Why:** These config keys are baked into the native build at compile time — without `react-native-maps` consuming them, they're inert. Mapbox env var (`EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`) KEPT — still consumed by `busynessService.ts:17` for Mapbox Directions REST API (real traffic + travel time).

**Lines changed:** -14 lines (removed iOS+Android map config blocks)

### §3.5 `app-mobile/app.json`

**What it did before:** Listed `@maplibre/maplibre-react-native` as an Expo plugin + 2 EXPO_PUBLIC env vars for MapLibre provider config.

**What it does now:** No MapLibre plugin entry; no MAPLIBRE env vars.

**Why:** All consumed exclusively by the deleted map subtree. Plugin entry orphaned post-package-removal would have caused build errors at next EAS build. Env vars were specific to the MapLibre provider config (which file is also deleted).

**Lines changed:** -1 plugin entry, -2 extra env var entries = -3 lines

### §3.6 `app-mobile/.env.example`

**What it did before:** Listed `GOOGLE_MAPS_API_KEY` as a required env var with comment "Google Maps (iOS/Android native SDK + Places API)".

**What it does now:** No `GOOGLE_MAPS_API_KEY` entry. `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (a SEPARATE env var with `EXPO_PUBLIC_` prefix, used by `geocodingService.ts` for Google's REST geocoding API) was never in `.env.example` — pre-existing documentation gap, NOT touched by this IMPL.

**Why:** `GOOGLE_MAPS_API_KEY` (without prefix) was only consumed by the iOS/Android map config in app.config.ts (deleted in §3.4). Now genuinely orphaned.

**Lines changed:** -2 lines (1 comment + 1 entry)

---

## §4 Verification matrix

| # | Check | Command | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| V-1 | tsc clean | `cd app-mobile && npx tsc --noEmit` | 3 baseline errors only | ConnectionsPage:2763 + HomePage:246 + HomePage:249 (verbatim match) | ✅ PASS |
| V-2 | No `react-native-maps` references | `Grep "react-native-maps" app-mobile/src + app-mobile/app` | 0 matches | 0 matches | ✅ PASS |
| V-3 | No `@maplibre` references | `Grep "@maplibre" app-mobile/src + app-mobile/app` | 0 matches | 0 matches | ✅ PASS |
| V-4 | No `react-native-map-clustering` references | `Grep "react-native-map-clustering" app-mobile/src` | 0 matches | 0 matches | ✅ PASS |
| V-5 | No imports from `/map/` | `Grep "from ['\"][^'\"]*\\/map\\/" app-mobile/src` | 0 matches | 0 matches | ✅ PASS |
| V-6 | No references to deleted symbols | `Grep "useMapSettings\|MapPrivacySettings\|DiscoverMap\|MapBottomSheet\|PersonBottomSheet\|..." app-mobile` | 0 references in code (comments only acceptable) | 0 matches in code; 0 stale comments after mutateCuratedCard.ts cleanup | ✅ PASS |
| V-7 | npm install clean | `cd app-mobile && npm install` | "removed N packages" without errors | "removed 15 packages, audited 1066, 0 errors" | ✅ PASS |
| V-8 | Git status sane | `git status --short --untracked-files=no app-mobile` | 18 deletions + 7 modifications | Confirmed: 18 D + 7 M | ✅ PASS |

**All 8 verification checks PASS.** Per dispatch §I: ready for orchestrator REVIEW + commit + EAS Updates.

---

## §5 Invariant verification

| Invariant | Status | Reason |
|---|---|---|
| C-1 No dead taps | ✅ PRESERVED — no UI tappable surfaces removed (only orphan settings UI) |
| C-2 One owner per truth | ✅ STRENGTHENED — fewer parallel sources of bottom-sheet chrome (only 1 ProposeDateTimeModal + 1 future ORCH-0696 modal will exist) |
| C-3 No silent failures | ✅ PRESERVED — no error paths touched |
| C-7 Label temporary fixes | ✅ UPHELD — no `[TRANSITIONAL]` markers introduced |
| C-8 Subtract before adding | ✅ STRONGLY UPHELD — pure deletion, zero new code added |
| All others | ✅ N/A — not touched by this IMPL |

---

## §6 Parity check

| Surface | Status |
|---|---|
| Solo / Collab modes | ✅ N/A — Map view was solo-only (it never had a collab variant). |
| Mobile / Admin / Backend | ⏸️ Mobile only per dispatch §B.1. Backend artifacts flagged in §10 below. |

---

## §7 Cache safety

| Concern | Status |
|---|---|
| React Query keys | ✅ Removed `['map-settings', user?.id]` query key (only consumer was deleted hook). No surviving consumers. |
| AsyncStorage | ✅ Untouched |
| Persisted data shape | ✅ Untouched |
| Mutation invalidation | ✅ N/A — only mutation was the deleted `useMapSettings` mutation |

---

## §8 Regression surface (recommended tester focus)

1. **Cold-start the app on iOS + Android.** Verify all 5 nav tabs render normally (`home / discover / connections / likes / profile`). Verify no native crash from missing map module symbols.
2. **Open AccountSettings → Privacy accordion.** Verify the section renders cleanly: Profile visibility → Notifications → end. No orphan divider, no orphan Map Privacy block, no console warnings about missing `useMapSettings`.
3. **Open any Discover event card → tap "Get Tickets" → in-app browser opens with Mapbox-driven traffic data behind the scenes.** Verify `busynessService.ts` traffic info still loads (this is the only surviving Mapbox consumer; if traffic info shows "—" universally, env var didn't propagate cleanly).
4. **Open expo build / EAS Update on iOS + Android.** Now that `react-native-maps` is gone, `--platform all` SHOULD work (was previously broken per memory rule). If `eas update --branch production --platform all --message "..."` succeeds without web bundle errors, that's a process win to memorialize. If it still fails for non-map reasons, document.
5. **Geocoding.** Geocoding service uses `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (different env var, kept). Verify geocoding-dependent flows still work (e.g., manual location entry in Onboarding Step 4).

---

## §9 Constitutional compliance check

| # | Principle | Outcome |
|---|---|---|
| 1 | No dead taps | ✅ N/A (no UI changes that affect tap targets) |
| 2 | One owner per truth | ✅ STRENGTHENED (ORCH-0696 OQ-6 retrofit scope evaporates — fewer parallel chrome owners) |
| 3 | No silent failures | ✅ N/A |
| 7 | Label temporary fixes | ✅ UPHELD (zero `[TRANSITIONAL]` markers introduced) |
| 8 | Subtract before adding | ✅ STRONGLY UPHELD (pure deletion ~1500+ LOC; zero new code) |
| All others | ✅ N/A |

---

## §10 Discoveries for orchestrator

Side issues found during IMPL — flagged for orchestrator triage, NOT bundled per dispatch §B.10:

1. **D-OBS-1 (Backend artifact — Supabase table `user_map_settings`):** The deleted `useMapSettings` hook persisted/read from `user_map_settings` table in Supabase. Schema includes columns: `visibility_level`, `show_saved_places`, `show_scheduled_places`, `activity_status`, `discovery_radius_km`, `time_delay_enabled`, `go_dark_until`, `activity_status_expires_at`, `is_discoverable`, `available_seats`. No mobile consumer remains. **Recommend separate ORCH** to: (a) confirm zero remaining backend consumers (edge functions, RLS policies referencing this table, admin dashboard pages); (b) drop the table via migration if confirmed dead. **Out of ORCH-0698 scope** per dispatch §B.10.

2. **D-OBS-2 (Pre-existing inconsistency — env var naming):** `geocodingService.ts` references `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (with EXPO_PUBLIC_ prefix) at lines 297 + 402, but `.env.example` had `GOOGLE_MAPS_API_KEY` (without prefix). The `.env.example` entry was for the now-deleted `app.config.ts` native map config. The geocoding service env var was never documented in `.env.example`. **Recommend orchestrator triage:** add `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` to `.env.example` with comment "Google Geocoding REST API (used by geocodingService)" — small documentation cleanup. Could be folded into the next IMPL touching env config OR a documentation-only commit.

3. **D-OBS-3 (Mapbox token survives):** `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` env var KEPT — consumed by `busynessService.ts:17 + 115 + 174` for Mapbox Directions REST API (traffic + travel time). NOT a map-rendering dependency. The `MAPBOX_DIRECTIONS_URL` constant + `fetchMapboxTraffic` helper continue to work. No action needed; documented for clarity.

4. **D-OBS-4 (`googleMaps` references in `categories.ts` are unrelated):** The 11 `googleMaps: { type: 'restaurant' }` entries in `app-mobile/src/constants/categories.ts` are Google Places category constants (used to map Mingla categories to Google Places API queries). NOT map-rendering related. Same with `googleMapsUri` in `SessionViewModal.tsx:69` and `collabSaveCard.ts:52` (URL strings to open Google Maps website for "Get Directions"). Same with `googleMapsMode` in `categories.ts:674-706` (travel mode for Google Distance Matrix). All preserved correctly.

5. **D-OBS-5 (Memory rule update candidate):** Per dispatch §I.3 — once this commit ships, the memory rule "EAS Update: two separate commands, never combined" (file: `feedback_eas_update_no_web.md`) becomes partially obsolete. The `--platform all` failure was caused by `react-native-maps` web bundle incompatibility. With `react-native-maps` removed, `--platform all` should now work. **Recommend orchestrator update memory after device-side EAS smoke confirms** `eas update --platform all` succeeds without web bundle errors. Don't update memory before runtime verification.

6. **D-OBS-6 (Possible orphaned edge function?):** Did not audit `supabase/functions/` for map-querying edge functions. Per dispatch §B.10, backend artifacts are out of scope. If an edge function exists that queries `user_map_settings` table (e.g., a friend-location-feed function that reads visibility_level), it's NOW DEAD because no client calls it. Recommend separate audit. NOT touched by this IMPL.

---

## §11 Transition register

**NONE.** Per dispatch §F.5 — zero `[TRANSITIONAL]` markers introduced. Pure deletion IMPL.

---

## §12 Net LOC delta

| Bucket | Estimate |
|---|---|
| Deleted source files (18) | ~1,500-2,000 LOC removed |
| Deleted lines in 7 modified files | ~30 LOC removed |
| **Total mobile-side deletion** | **~1,500-2,000 LOC** |
| Native deps removed (npm) | 15 packages (3 direct + 12 transitive) |
| Lines added | 0 (pure deletion) |

Constitution #8 win confirmed.

---

## §13 EAS Update implication

Per memory rule `feedback_eas_update_no_web.md`, `eas update --platform all` has been broken due to `react-native-maps` web bundle incompatibility. Post-this-IMPL:
- `react-native-maps` is gone
- The web bundle should now build cleanly
- `--platform all` is a candidate for re-enablement

**Recommend operator test once after this lands:** `cd app-mobile && rm -rf dist && eas update --branch production --platform all --message "ORCH-0698 Map view dead-code cleanup"`. If clean, memory rule retires. If still fails, the `--ios` then `--android` two-step pattern continues.

---

End of report.
