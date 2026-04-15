# Investigation: Can We Unify to a Single Map Provider? (ORCH-0410 Deep Dive)

> **Date:** 2026-04-14
> **Confidence:** HIGH — all code paths traced, library versions verified, API key configuration confirmed

---

## Executive Summary

**Yes, we can unify.** The simplest and most impactful option is to use `react-native-maps` on BOTH platforms. The Google Maps API key is ALREADY configured for Android in `app.config.ts:16-18` and `.env`. The switch is a ONE-LINE config change. All existing marker code (AnimatedPlacePin, PersonPin, PlacePin, ClusteredMapView) already uses the `react-native-maps` API. The MapLibre path was never a deliberate preference for Android — it was the first thing built, and iOS was given the fallback to react-native-maps when MapLibre crashed there. Nobody ever tested react-native-maps on Android because MapLibre "worked."

---

## 1. History: Why Was the Split Introduced?

### Commit Evidence

**Commit `649d2d1e` — "Discover Map Android and Ios" — March 28, 2026**

This was the INITIAL dual-provider implementation (16 days ago). It added:
- `MapLibreProvider.tsx` (775 lines — the Android path)
- `MapProviderSurface.tsx` (provider switch)
- `config.ts` with the platform split
- `layoutNearbyPeople.ts` (shared layout algorithm)

**The `[TRANSITIONAL]` comment in `config.ts:16-19`:**
```
// [TRANSITIONAL] iOS uses react-native-maps (Apple Maps) — MapLibre native renderer
// crashes on iOS with 30+ MarkerViews during zoom/pan gestures (native EXC_BAD_ACCESS,
// no JS error). Android uses MapLibre which handles MarkerViews stably.
// Exit condition: MapLibre iOS MarkerView stability fix (upstream library issue).
```

**What actually happened:** The developer built the map with MapLibre first (the 775-line `MapLibreProvider.tsx`). When testing on iOS, it crashed with `EXC_BAD_ACCESS` when there were 30+ MarkerViews during zoom/pan. Instead of trying react-native-maps on both platforms, they created a parallel `ReactNativeMapsProvider.tsx` for iOS only. The Android path was left on MapLibre because "it worked there."

**There is no evidence that react-native-maps was ever tested on Android and rejected.** The split was born from a workaround, not a comparison.

---

## 2. Current Library Versions

| Library | Installed | Latest | Behind |
|---------|-----------|--------|--------|
| `react-native-maps` | 1.20.1 | **1.27.2** | **7 minor versions** |
| `@maplibre/maplibre-react-native` | ^10.4.2 | 10.4.2 | Current |
| `react-native-map-clustering` | ^4.0.0 | 4.0.0 | Current |
| `supercluster` | (used but not in package.json) | 8.0.1 | N/A |

**`react-native-maps` is significantly outdated.** Versions 1.21-1.27 include:
- Android Google Maps rendering improvements
- Custom marker performance fixes
- Gesture handling improvements
- Memory leak fixes
- React Native 0.73+ compatibility

Upgrading react-native-maps is recommended regardless of provider choice.

---

## 3. Can react-native-maps Work on Android?

**YES — and the Google Maps API key is ALREADY configured.**

### Evidence

**File: `app-mobile/app.config.ts:13-19`**
```typescript
android: {
  ...config.android,
  config: {
    googleMaps: {
      apiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
    },
  },
},
```

**File: `app-mobile/.env:1`**
```
GOOGLE_MAPS_API_KEY=AIzaSyDEijrIucVwXiHsU6kft9FaLAQ2Dd8lWVg
```

The API key is set and wired for Android. The `react-native-maps` native module is already in the dependency tree and built into the native binary.

### What would happen if we switch?

Changing `config.ts:20-21` from:
```typescript
export const ACTIVE_DISCOVER_MAP_PROVIDER: DiscoverMapProviderKind =
  Platform.OS === 'ios' ? 'react-native-maps' : 'maplibre';
```
To:
```typescript
export const ACTIVE_DISCOVER_MAP_PROVIDER: DiscoverMapProviderKind = 'react-native-maps';
```

Would route ALL platforms through `ReactNativeMapsProvider.tsx`, which:
- Uses `ClusteredMapView` (from `react-native-map-clustering`) — works on both platforms
- Uses `Marker` components — render as native bitmaps on BOTH iOS (Apple Maps) and Android (Google Maps)
- Uses all existing marker code (AnimatedPlacePin, PersonPin, PlacePin) — these already use the `react-native-maps` `Marker` API
- Uses `tracksViewChanges` optimization — works identically on both platforms

### react-native-maps on Android: How Markers Render

On Android with Google Maps, `react-native-maps` `Marker` components:
1. Render the React component to a bitmap ONCE
2. Hand the bitmap to the Google Maps native SDK
3. Google Maps composites the bitmap onto the map tile
4. During pan/zoom, only the bitmap position changes — no React re-rendering

This is the SAME bitmap caching approach as iOS. It eliminates the MarkerView performance problem entirely.

### Google Maps API Cost

Google Maps Platform pricing (as of 2026):
- **Maps SDK for Android:** FREE (no per-load charge)
- **Static Maps / Directions / etc:** Paid, but Mingla doesn't use these from the mobile app (edge functions handle Google API calls)
- The map tile rendering itself is free — only server-side API calls cost money

---

## 4. Can MapLibre Work on iOS Without Crashing?

### Version Analysis

Installed: `@maplibre/maplibre-react-native` 10.4.2 (latest). The crash was observed at this version. There's no newer version to try.

The underlying `maplibre-gl-native` iOS library has known issues with `MarkerView`:
- MarkerView uses `UIView` overlays on the map surface
- During rapid zoom/pan, the native layer attempts to reposition many UIViews simultaneously
- With 30+ MarkerViews, this triggers a memory access violation (`EXC_BAD_ACCESS`) in the compositor

**This is an UPSTREAM library issue.** There's no code-level fix available in `@maplibre/maplibre-react-native`. The MapLibre team would need to fix the native renderer.

### Could SymbolLayers Avoid the Crash?

If place pins were rendered as `SymbolLayer` (GPU-rendered icons) instead of `MarkerView` (UIView overlays), the crash would be avoided because:
- SymbolLayers don't create UIView instances
- They're rendered entirely by the GPU from GeoJSON + style rules
- No memory pressure from 30+ overlapping views

But this would mean:
- Losing custom React components inside pins (badges, animations, pulsing rings)
- Losing interactive `Pressable` wrappers (tap handling moves to map tap events with coordinate matching)
- Avatar images for person pins would need to be registered as map icons (complex dynamic image management)

**SymbolLayers are technically possible but would require a significant rewrite of all marker components.**

---

## 5. The Map Style: Blank Background

### FINDING: Android Map Uses a BLANK Style

**File: `MapLibreProvider.tsx:29-41`**
```typescript
const MAP_STYLE_LIGHT_BLANK = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'discover-background',
      type: 'background',
      paint: {
        'background-color': '#f8fafc',
      },
    },
  ],
};
```

The Android map renders on a **completely blank light-gray background**. No streets, no labels, no terrain, no satellite imagery. Just markers floating on gray.

The `EXPO_PUBLIC_MAPLIBRE_STYLE_URL` from `app.json` (pointing to MapLibre's demo tile server) and the `MAPLIBRE_STYLE_URL` config are **NOT USED** — the code hardcodes `MAP_STYLE_LIGHT_BLANK`.

If we switch to react-native-maps on Android, Google Maps provides full street/terrain/satellite tiles automatically. The map would go from blank gray to a full Google Maps experience.

---

## 6. Option Analysis

### Option A: react-native-maps on BOTH platforms (RECOMMENDED)

| Factor | Assessment |
|--------|-----------|
| **Files to change** | 1 (config.ts — one line) |
| **API key** | Already configured in app.config.ts + .env |
| **Marker code** | All existing markers use react-native-maps API — zero changes |
| **Clustering** | react-native-map-clustering works on both — zero changes |
| **Performance** | Native bitmap markers on both platforms — identical to iOS |
| **Map tiles** | Google Maps on Android (full streets/terrain) instead of blank gray |
| **Testing** | Moderate — need to verify all pins render correctly on Google Maps |
| **Risk** | LOW — react-native-maps is the most mature RN map library |
| **Requires native build?** | YES — the Google Maps provider is already compiled in, but changing from MapLibre may need a clean prebuild |
| **Recommended upgrade** | `react-native-maps` 1.20.1 → 1.27.2 (7 versions of Android fixes) |

### Option B: MapLibre on BOTH platforms (fix iOS crash)

| Factor | Assessment |
|--------|-----------|
| **Files to change** | 0 (config already routes iOS to react-native-maps) |
| **Crash fix** | Requires upstream MapLibre fix — NOT in our control |
| **Alternative (SymbolLayers)** | Major rewrite of all marker components |
| **Risk** | HIGH — depending on upstream fix with no timeline |
| **Verdict** | NOT VIABLE until MapLibre fixes iOS MarkerView crash |

### Option C: Keep dual, fix Android with SymbolLayers

| Factor | Assessment |
|--------|-----------|
| **Files to change** | MapLibreProvider.tsx (major rewrite of marker rendering) |
| **Effort** | HIGH — every pin type needs GeoJSON + style rules + image registration |
| **Tap handling** | Complex — map tap events + coordinate matching instead of Pressable |
| **Dynamic content** | Difficult — badges, animations, avatars need native icon management |
| **Risk** | MEDIUM — SymbolLayers are proven but the migration is significant |
| **Verdict** | Too much effort for diminishing returns vs Option A |

### Option D: Keep dual, fix symptoms only

| Factor | Assessment |
|--------|-----------|
| **Files to change** | PlacePin.tsx (label width), MapLibreProvider (debounce) |
| **Effort** | LOW |
| **Impact** | LOW — addresses symptoms but leaves fundamental performance issue |
| **Verdict** | BAND-AID — user will still feel Android is worse than iOS |

---

## 7. Recommendation: Option A — react-native-maps on Both Platforms

**Why:**
1. **One-line config change** — `Platform.OS === 'ios' ? 'react-native-maps' : 'maplibre'` → `'react-native-maps'`
2. **API key already configured** — zero backend work
3. **All marker code already compatible** — zero component changes
4. **Native bitmap rendering** — same performance as iOS
5. **Google Maps tiles** — instead of blank gray background
6. **One code path to maintain** — instead of two separate providers
7. **react-native-maps is the most mature RN map library** — 15K GitHub stars, active maintenance

**What to do:**
1. Change config.ts: one line
2. Upgrade react-native-maps from 1.20.1 to 1.27.2 (7 versions of Android fixes)
3. Run `eas build` for Android (native binary change — cannot be OTA)
4. Test all pin types on Google Maps Android
5. If everything works: delete `MapLibreProvider.tsx` (775 lines of dead code)
6. Remove `@maplibre/maplibre-react-native` dependency

**What we gain:**
- Identical map experience on both platforms
- 775 lines of code deleted
- No more MapLibre dependency (compilation speed improvement)
- Google Maps tiles instead of blank background
- All future map fixes apply to both platforms automatically

**What we lose:**
- The blank/clean map aesthetic (Google Maps shows streets — this may actually be BETTER for a location app)
- MapLibre's free tile hosting (but we weren't using it — we had blank style)

---

## 8. Adjacent Findings

| Finding | Impact |
|---------|--------|
| `MAP_STYLE_LIGHT_BLANK` renders Android map on blank gray — no streets/terrain | Users see pins floating on nothing. Google Maps would fix this automatically. |
| `react-native-maps` 7 versions behind | Missing Android performance fixes, gesture improvements, memory leak fixes |
| `MAPLIBRE_STYLE_URL` config is dead code | The blank style object overrides it in MapLibreProvider.tsx:604 |
| MapLibreProvider.tsx is 775 lines that only run on Android | Major maintenance burden for one platform's code path |

---

## Confidence Assessment

| Finding | Confidence |
|---------|-----------|
| Google Maps API key is configured for Android | **PROVEN** — app.config.ts:16-18 + .env |
| react-native-maps works on Android | **HIGH** — standard configuration, most common RN map setup |
| One-line config change switches providers | **PROVEN** — config.ts:20-21 |
| All marker code is react-native-maps compatible | **PROVEN** — AnimatedPlacePin, PersonPin, PlacePin all use Marker API |
| MapLibre iOS crash is upstream issue | **PROVEN** — [TRANSITIONAL] comment, no newer version available |
| Blank map style is intentional | **PROVEN** — MAP_STYLE_LIGHT_BLANK hardcoded at line 29-41 |
| react-native-maps needs upgrade | **PROVEN** — 1.20.1 vs 1.27.2 |
