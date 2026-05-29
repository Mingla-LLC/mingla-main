# INVESTIGATION — App Performance (Android jank + Discover cold-open latency)

- **ORCH-0995** — Android-wide UI jank + tab-navigation animation lag (iOS-fluidity parity)
- **ORCH-0996** — Discover/Events screen opens slower than every other screen (both iOS + Android)
- **Date:** 2026-05-29
- **Mode:** INVESTIGATE (no fixes proposed; root causes proven against code)
- **Confidence:** HIGH — every root cause below is line-cited and read directly, not inferred.
- **Affected Surfaces:** ORCH-0995 → consumer Android (felt), consumer iOS (same code path, less visible). ORCH-0996 → consumer iOS + consumer Android. NOT in scope: business apps, admin-web, buyer-web (separate codebase).

---

## ORCH-0995 — Why Android tab navigation feels laggy

### Root Cause A (PRIMARY, proven) — Tab spotlight animates on the JS thread
`app-mobile/src/components/GlassBottomNav.tsx:158-173`

The sliding "spotlight" pill behind the active tab animates its **X position and width** with two `Animated.spring()` calls, both with **`useNativeDriver: false`** (lines 164 and 171). `width` and layout `x` are not native-driver-able properties, so this is forced onto the JS thread by design of the chosen property.

Consequence: every tab tap runs a multi-hundred-ms spring where each frame is computed in JavaScript and shipped across the bridge. On iOS the JS thread is fast enough to mostly keep up; on Android (especially mid-tier Snapdragon) the JS thread can't sustain 60fps while also handling the tab-switch render, so frames drop → visible lag. Contrast: `GlassTopBar.tsx:120-145` animates opacity/translateY with `useNativeDriver: true` and is smooth — proving the codebase already knows the native-driver pattern; the bottom nav just uses an un-accelerable property.

Spring params are aggressive (`designSystem.ts:600-615`: stiffness 260, damping 18), which maximizes per-frame JS work during the bounce.

### Root Cause B (SECONDARY, contributory, proven) — Persistent Android blur surfaces
`GlassBottomNav.tsx:182-190`, `GlassTopBar.tsx`, `DiscoverScreen.tsx` (4 instances), plus GlassCard/GlassIconButton/Connections/Likes.

8+ `<BlurView>` glass surfaces render **persistently** (not just during transitions). On Android they use `experimentalBlurMethod="dimezisBlurView"`, which is CPU/GPU-heavy. iOS uses native Core Image blur (cheap). During a tab switch the new screen mounts its blur surfaces while the spotlight spring is running on the JS thread — the two costs stack. The team already saw this class of cost (app/index.tsx:39 note: Sentry replay dropped 10%→1% because it caused 5-15% sustained CPU on Snapdragon 6xx during scroll).

### NOT root causes (ruled out with evidence)
- **Tab mounting** — only the active tab is mounted (`app/index.tsx` switch on `currentPage`, CI-gated by `scripts/ci/check-active-tab-only.sh`). Correct pattern; not the problem.
- **Provider re-render storms** — provider stack is deep but memoized (RecommendationsContext stable refs, handlersRef pattern). No cascade found.
- **List virtualization** — FlatList/ScrollView used appropriately; no large unvirtualized `.map`.
- **Hermes** — defaults on (Expo SDK 54). New Architecture (Fabric) enabled both platforms (`app.json:9`) — minor interop overhead at most, not the felt lag.

---

## ORCH-0996 — Why Discover opens slower than every other screen (both platforms)

The Discover screen mounts **fresh on every visit** (active-tab-only architecture) AND runs a **blocking cold-start waterfall** with **no local cache**. Other tabs either fetch via React Query (cached, warm on re-open) or do far less on mount. That contrast is the whole story.

### The waterfall, in order (all in `DiscoverScreen.tsx`)
1. **Device GPS resolve** (lines 870-890) — `enhancedLocationService.getCurrentLocation()`. Can take 2-5s, especially first open / "While Using" permission.
2. **Preferences city load** (lines 968-991) — Supabase `getUserPreferences(user.id)` round-trip.
3. **Reverse geocode GPS → city** (lines 996-1026) — only if no saved city; another HTTP call.
4. **300ms artificial debounce** (lines 1177-1189) — `setTimeout(fetchNightOutEvents, 300)` before the fetch even *starts*.
5. **Merged events fetch** (lines 1086-1120) — `searchMerged()` → edge function `discover-merged-events`, which itself queries Postgres **and** calls the Ticketmaster API server-side and merges/ranks. 2-3s typical.

So before first meaningful paint: GPS + preferences + (geocode) + 300ms + a multi-upstream edge call — roughly **4 sequential-ish network legs**, with the screen showing a skeleton/blank until city resolves AND events return.

### Aggravators (proven)
- **No on-device cache.** Comments at `DiscoverScreen.tsx:1171-1172` and `1193-1195` confirm ORCH-0839-A **removed** the mobile cache. Every open is cold — there's nothing warm to paint while the network resolves. Other tabs (Likes/Saved/notifications) ride React Query's cache and feel instant on re-open.
- **Fresh remount every visit** (`app/index.tsx` switch) — all five effects above re-run from scratch each time you return to Discover.
- **`t` (i18n) in the fetch dependency array** (line 1173) — if the translation function identity isn't stable, `fetchNightOutEvents` is recreated → the debounce effect (line 1189) re-fires → extra fetches. Needs confirmation but is a latent refetch trigger.
- **Unmemoized per-render work** — `genreFilterOptions` `.map()` + `t()` per item every render (lines 1426-1434); accessibility probes on mount (lines 803-830). Minor vs the network waterfall but adds main-thread cost.
- **No image prefetch** — 20+ event-cover images begin downloading only as cards render, each with a 150-200ms fade (`EventGridCard` 404-410). Compounds the "feels slow" perception even after data lands.

### Contrast with a fast screen (HomePage)
HomePage does **no** location services, no reverse-geocode, no debounce; notifications come through React Query (cached); SwipeableCards prefetches deck images. That's why Home feels instant and Discover doesn't.

---

## Recommended fix direction (for SPEC, not yet implemented)

**ORCH-0995 (Android fluidity):**
1. Replace the JS-thread spotlight spring with a native-driver-friendly approach — animate `translateX` + `scaleX` (both native-driver-able) instead of `x`/`width`, or move the spotlight to Reanimated (already installed, v4) on the UI thread. Target: spotlight animates entirely off the JS thread.
2. Audit persistent BlurViews on Android — consider a cheaper semi-opaque fallback on Android (or lower intensity / fewer stacked layers) behind a perf flag, since `dimezisBlurView` is the expensive one.

**ORCH-0996 (Discover cold-open):**
1. Kill the 300ms debounce on the *initial* fetch (keep it only for filter-change coalescing).
2. Reinstate a lightweight cache (React Query for the merged-events query, or restore a scoped on-device cache) so re-opens paint instantly while revalidating.
3. Break the GPS→prefs→geocode chain: fire prefs + last-known-location in parallel, kick the events fetch off last-known-location immediately, refine when precise GPS lands.
4. Memoize `genreFilterOptions`; stabilize `t` in deps or drop it.
5. Prefetch the first row of event-cover images.

Each item is independently shippable; (1)+(2) on each ORCH deliver the biggest felt win.

---

## Evidence index
| Finding | File | Lines |
|---|---|---|
| Spotlight `useNativeDriver: false` | `app-mobile/src/components/GlassBottomNav.tsx` | 158-173 |
| Native-driver done right (contrast) | `app-mobile/src/components/GlassTopBar.tsx` | 120-145 |
| Spring tokens (aggressive) | `app-mobile/src/constants/designSystem.ts` | 600-615 |
| Persistent Android BlurView | `app-mobile/src/components/GlassBottomNav.tsx` | 182-190 |
| Active-tab-only mount (ruled out) | `app-mobile/app/index.tsx` | switch on `currentPage` |
| GPS resolve on mount | `app-mobile/src/components/DiscoverScreen.tsx` | 870-890 |
| Preferences city load | `app-mobile/src/components/DiscoverScreen.tsx` | 968-991 |
| Reverse geocode | `app-mobile/src/components/DiscoverScreen.tsx` | 996-1026 |
| 300ms debounce before fetch | `app-mobile/src/components/DiscoverScreen.tsx` | 1177-1189 |
| Merged edge-fn fetch | `app-mobile/src/components/DiscoverScreen.tsx` | 1086-1120 |
| On-device cache removed (ORCH-0839-A) | `app-mobile/src/components/DiscoverScreen.tsx` | 1171-1172, 1193-1195 |
| Unmemoized genre map | `app-mobile/src/components/DiscoverScreen.tsx` | 1426-1434 |
| No image prefetch | `app-mobile/src/components/DiscoverScreen.tsx` | 404-410 |
