# Investigation: Android Discover Map Fundamentally Broken (ORCH-0410)

> **Date:** 2026-04-14
> **Confidence:** HIGH for architecture findings. PROBABLE for specific symptom causes (need device testing to confirm).

---

## Executive Summary

Android and iOS use **completely different map libraries**. iOS uses `react-native-maps` (Apple Maps) with `react-native-map-clustering`. Android uses `@maplibre/maplibre-react-native` (MapLibre) with hand-rolled Supercluster. These are separate code paths with separate rendering engines, separate gesture systems, and separate marker implementations. The "Android is buggier" experience is because MapLibre's React Native wrapper is less mature than react-native-maps, and the Android-specific code path has received less testing and optimization.

The user's three symptoms (pan/scroll issues, labels cut off, not fluid) likely have these causes:

1. **Pan/scroll jank:** MapLibre renders every marker as a full React Native View via `MarkerView`. With 30+ place pins + person pins + clusters, each frame requires layout of many React components on the GPU thread. This is fundamentally slower than react-native-maps' native bitmap markers on iOS.

2. **Labels cut off:** Place pin wrappers have fixed widths (`width: 140px`) with `overflow: 'visible'`. MapLibre's `MarkerView` may clip overflow differently than react-native-maps' `Marker` — overflow may not extend beyond the MarkerView bounds on Android.

3. **General bugginess:** Two completely separate rendering stacks with different behavior means bugs only appear on one platform. The ORCH-0378 label redesign, ORCH-0379 tap fix, ORCH-0385 avatar fix, and ORCH-0409 heartbeat were all tested/proven on the react-native-maps (iOS) path, not the MapLibre (Android) path.

---

## Finding 1: Dual-Provider Architecture — Android Uses a Different Map Library

**Classification:** ROOT CAUSE (architectural)

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/components/map/providers/MapProviderSurface.tsx:16-21` (config) |
| **Exact code** | `export const ACTIVE_DISCOVER_MAP_PROVIDER: DiscoverMapProviderKind = Platform.OS === 'ios' ? 'react-native-maps' : 'maplibre';` |
| **What it does** | iOS renders via `react-native-maps` (Apple Maps + ClusteredMapView). Android renders via `@maplibre/maplibre-react-native` (MapLibre + Supercluster). Completely different code paths, rendering engines, gesture systems, and marker APIs. |
| **What it should do** | Both platforms should deliver the same user experience. The dual-provider approach was a workaround for a MapLibre crash on iOS (MarkerView + 30+ markers = `EXC_BAD_ACCESS`). |
| **Causal chain** | 1. Config selects MapLibre for Android → 2. `MapLibreProvider.tsx` renders all markers as `MarkerView` components (React Native views on the map) → 3. Each MarkerView is a full React component requiring layout → 4. 30+ markers = 30+ View hierarchies rendered every frame → 5. Map panning/zooming triggers relayout → 6. User experiences jank, cut labels, and bugginess |
| **Verification** | Compare the same map location on iOS vs Android with the same data. iOS will be smoother because react-native-maps renders markers as native bitmaps. |

---

## Finding 2: MarkerView Performance on Android

**Classification:** ROOT CAUSE (performance)

MapLibre's `MarkerView` renders every marker as a full React Native View hierarchy placed on top of the map. Unlike react-native-maps' `Marker` (which renders to a native bitmap once, then composites), `MarkerView` requires:
- Full React component rendering
- Layout calculation
- View hierarchy traversal on every frame during animation

With 30+ place pins + ~30 person pins + cluster markers + curated route markers + user marker = potentially **100+ MarkerView instances**, each containing `View > Pressable > View > Icon + Text + Image`.

**Evidence:** `MapLibreProvider.tsx` lines 252-321 — every place marker, person marker, and cluster marker uses `MarkerView`.

The react-native-maps path (iOS) uses `Marker` which renders once to a bitmap and then uses the native map's sprite system. Orders of magnitude more efficient for many markers.

---

## Finding 3: Label Cutoff — Fixed Width Wrapper + MapLibre Overflow Behavior

**Classification:** ROOT CAUSE (rendering)

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/components/map/PlacePin.tsx` styles |
| **Exact code** | `wrapper: { width: 140, height: 60, alignItems: 'center', overflow: 'visible' }` |
| **What it does** | The place pin wrapper has a fixed width of 140px. The label text inside can exceed this width. `overflow: 'visible'` is set to allow text to extend beyond. |
| **What it should do** | Labels should be fully visible on both platforms. |
| **Causal chain** | 1. Label text (e.g., "Fine Dining · Sullivan's Steakhouse") exceeds 140px → 2. `overflow: 'visible'` allows it on react-native-maps (iOS) because `Marker` renders the entire View to a bitmap first → 3. MapLibre's `MarkerView` on Android may clip at the MarkerView bounds, ignoring `overflow: 'visible'` on child Views → 4. Label text is cut off at the edges |
| **Verification** | Test a place pin with a long label on Android MapLibre. Check if text is clipped at 140px width. Compare with iOS where the same label shows fully. |

---

## Finding 4: MapLibre Map Style — Demo Tiles in Config

**Classification:** HIDDEN FLAW

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/app.json:134` |
| **Exact code** | `"EXPO_PUBLIC_MAPLIBRE_STYLE_URL": "https://demotiles.maplibre.org/style.json"` |
| **What it does** | The app.json config references MapLibre's DEMO tile server. However, the actual MapView uses `mapStyle={MAP_STYLE_LIGHT_BLANK}` which may be a different constant. Need to verify if the app actually uses the demo tiles in production. |
| **Risk** | Demo tile servers have rate limits, lower quality tiles, and may be unreliable for production use. If the app falls back to these tiles, the map would look degraded. |

---

## Finding 5: ORCH-0409 Heartbeat Only in react-native-maps Path

**Classification:** CONTRIBUTING FACTOR

The ORCH-0409 heartbeat (45-second periodic `tracksViewChanges` reset) was added to `ReactNativeMapsProvider.tsx` — the iOS path. MapLibre's `MarkerView` doesn't use `tracksViewChanges` at all. If the avatar disappearance issue also affects Android's MapLibre path, it would manifest differently and need a different fix.

**Evidence:** `ReactNativeMapsProvider.tsx:58-70` — heartbeat code is in the iOS provider only. `MapLibreProvider.tsx` — no equivalent heartbeat.

---

## Finding 6: No Gesture Conflicts (DISPROVEN)

**Classification:** OBSERVATION (positive)

The map is NOT inside a ScrollView. `DiscoverScreen.tsx` renders DiscoverMap in a `View` with `flex: 1`, wrapped in `GestureHandlerRootView`. No gesture handler conflicts were found. The pan/scroll issues are NOT caused by ScrollView/MapView conflicts — they're caused by MapLibre MarkerView performance (Finding 2).

---

## Finding 7: MapLibre-Specific Settings That May Affect Fluidity

**Classification:** CONTRIBUTING FACTOR

`MapLibreProvider.tsx:601-627` configures:
- `surfaceView={false}` — uses TextureView instead of SurfaceView. TextureView is required for overlapping React views but has slightly different touch handling and may drop frames under heavy marker load.
- `regionDidChangeDebounceTime={500}` — 500ms debounce before cluster recalculation. This could cause a noticeable delay where markers appear in wrong positions after a pan.
- `rotateEnabled={false}`, `pitchEnabled={false}` — gesture restrictions that shouldn't cause issues but limit the user's control.

---

## Priority Ranking for Fixes

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| 1 | **MarkerView performance** — too many React views on the map | Causes all panning jank | HIGH — would require rethinking marker rendering (e.g., using MapLibre's native symbol layers instead of MarkerView) |
| 2 | **Label cutoff** — fixed width wrapper + MapLibre overflow clipping | Labels unreadable | MEDIUM — increase wrapper width, add text truncation with `numberOfLines`, or use flexible width |
| 3 | **Cluster recalc debounce** — 500ms delay causes stale marker positions | Markers lag behind pan | LOW — reduce debounce to 200ms or use a different update strategy |
| 4 | **Demo tile URL** — verify production isn't using demo tiles | Map quality degraded | LOW — check actual style constant value |

---

## Recommended Investigation Next Steps

1. **Verify label cutoff on device:** Test long labels on Android to confirm the overflow clipping hypothesis.
2. **Profile Android map performance:** Use Android Studio's Layout Inspector or React Native's Performance Monitor to measure MarkerView rendering time during pan.
3. **Check MAP_STYLE_LIGHT_BLANK constant:** Read the full MapLibreProvider to find what style URL is actually used in production.
4. **Consider MapLibre symbol layers:** For high-priority performance fix, investigate using MapLibre's native symbol layers (GeoJSON + style expressions) instead of MarkerView for place pins. This would eliminate the React component overhead entirely.

---

## Blast Radius

- **Android only** — iOS uses a completely different code path
- **Solo + collab** — both modes use the same map
- **All map features** — place pins, person pins, clusters, curated routes, bottom sheets
- **Admin** — not affected (admin uses Leaflet)
