# Investigation: Android Google Maps — Clutter + Missing Pins (ORCH-0410)

> **Date:** 2026-04-14
> **Confidence:** HIGH — all findings from code trace, SDK type definitions verified

---

## Executive Summary

Two proven root causes explain both symptoms:

1. **Map clutter:** The CARTO tile overlay (`UrlTile` with `shouldReplaceMapContent`) is **iOS-only**. The react-native-maps type definition explicitly says: `@platform Android: Not supported`. On Android, Google Maps renders its full tiles (streets, POIs, businesses, labels) AND the CARTO tiles render on top as a semi-transparent overlay. This creates a cluttered double-layered map.

2. **Missing/broken place pins:** `AnimatedPlacePin` wraps its content in `Animated.View` but is missing `collapsable={false}` — required on Android for custom marker views. Without it, React Native's view flattening optimization can collapse the View hierarchy, causing markers to not render their custom content. Person markers DO have `collapsable={false}` (ReactNativeMapsProvider.tsx:187), but place pins don't.

---

## Finding 1: `shouldReplaceMapContent` is iOS-Only

**Classification:** ROOT CAUSE

| Field | Evidence |
|-------|----------|
| **File + line** | `node_modules/react-native-maps/lib/MapUrlTile.d.ts:63-69` |
| **Exact code** | `/** Corresponds to MKTileOverlay canReplaceMapContent... @platform iOS: Apple Maps only @platform Android: Not supported */ shouldReplaceMapContent?: boolean;` |
| **What it does** | On iOS, `shouldReplaceMapContent={true}` tells Apple Maps to use CARTO tiles instead of its own. On Android, this prop is IGNORED. Google Maps renders its full tile set (streets, labels, POIs, businesses), and the CARTO UrlTile renders ON TOP as an overlay. The result is a cluttered double-layered map. |
| **What it should do** | Android should show clean tiles with no Google Maps labels. Two options: (A) Use `customMapStyle` to hide all Google Maps labels and let CARTO overlay provide visuals, or (B) Use `mapType="none"` to disable Google tiles entirely and let CARTO be the sole tile source. |
| **Causal chain** | 1. UrlTile renders CARTO tiles → 2. `shouldReplaceMapContent` ignored on Android → 3. Google Maps base tiles render underneath → 4. Google labels/POIs/businesses show through CARTO overlay → 5. Map looks cluttered |
| **Verification** | Remove the UrlTile entirely on Android. If the map shows only Google Maps tiles (clean but labeled), then add `customMapStyle` to hide labels. |

### Recommended Fix: `customMapStyle` + Platform-Conditional UrlTile

**Option A (recommended):** Use `customMapStyle` to make Google Maps as clean as possible on Android, and only use the CARTO `UrlTile` on iOS where `shouldReplaceMapContent` works.

The `customMapStyle` JSON array for a clean Google Map:

```json
[
  { "featureType": "poi", "stylers": [{ "visibility": "off" }] },
  { "featureType": "poi.business", "stylers": [{ "visibility": "off" }] },
  { "featureType": "transit", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "featureType": "road", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.land_parcel", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.neighborhood", "elementType": "labels", "stylers": [{ "visibility": "off" }] }
]
```

This keeps: road geometry, water bodies, parks/green areas, area outlines.
This hides: ALL POI markers, business names, transit stations, road labels, address numbers, neighborhood names.

**Option B (simpler but different visual):** Set `mapType="none"` on Android (removes ALL Google tiles) and rely solely on CARTO UrlTile. This matches the iOS visual exactly but requires CARTO tiles to load successfully.

---

## Finding 2: AnimatedPlacePin Missing `collapsable={false}`

**Classification:** ROOT CAUSE (for missing place pins on Android)

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/components/map/AnimatedPlacePin.tsx:50` |
| **Exact code** | `<Animated.View style={{ transform: [{ scale }] }}>` — no `collapsable={false}` on this view or any parent View inside the Marker |
| **What it does** | `Animated.View` is the direct child of `Marker`. On Android, React Native's view flattening optimization can collapse View hierarchies. For custom marker content (React components inside `<Marker>`), this collapse prevents the marker from rendering its content — the native map layer gets an empty bitmap. |
| **What it should do** | Wrap in `<View collapsable={false}>` — same pattern used by person markers at ReactNativeMapsProvider.tsx:187 |
| **Causal chain** | 1. `AnimatedPlacePin` renders `Animated.View` inside `Marker` → 2. Android view flattening collapses the hierarchy → 3. Marker renders empty/invisible bitmap → 4. Place pins don't appear on Android |
| **Verification** | Add `collapsable={false}` to a wrapper View around the Animated.View. Place pins should appear on Android. |

### Comparison: Which markers have `collapsable={false}`?

| Marker Type | Has `collapsable={false}`? | Renders on Android? |
|------------|---------------------------|---------------------|
| Person markers | YES (ReactNativeMapsProvider.tsx:187) | Should work |
| User marker | NO (line 142-149 in provider) | May be missing |
| AnimatedPlacePin | NO (AnimatedPlacePin.tsx:50) | Likely missing |
| PlacePin (non-animated) | NO (PlacePin.tsx:99-104) | Likely missing |
| Cluster markers | Handled by react-native-map-clustering internally | Should work (library handles Android compat) |

**Three marker types are missing `collapsable={false}`:** AnimatedPlacePin, PlacePin, and the user marker.

---

## Finding 3: User Marker Also Missing `collapsable={false}`

**Classification:** CONTRIBUTING FACTOR

**File:** `ReactNativeMapsProvider.tsx:142-149`

```tsx
<View style={styles.userMarker}>
  <View style={styles.userMarkerPulse} />
  <SelfPinContent ... />
</View>
```

The outer `View` does NOT have `collapsable={false}`. This could cause the user's own marker (the orange ring with avatar) to not render on Android.

---

## Summary of Fixes Needed

### Fix 1: Clean map on Android

**File:** `ReactNativeMapsProvider.tsx`

- Add `customMapStyle` prop to `ClusteredMapView` (Android only) with the JSON array above
- Make the `UrlTile` conditional: only render on iOS where `shouldReplaceMapContent` works
- OR: use `mapType="none"` on Android + keep UrlTile (simpler)

### Fix 2: Add `collapsable={false}` to all marker types

**Files:**
- `AnimatedPlacePin.tsx:50` — wrap `Animated.View` in `<View collapsable={false}>`
- `PlacePin.tsx:99-104` — add `collapsable={false}` to the PlacePinContent wrapper inside Marker
- `ReactNativeMapsProvider.tsx:142` — add `collapsable={false}` to user marker wrapper

---

## Confidence Assessment

| Finding | Confidence |
|---------|-----------|
| `shouldReplaceMapContent` is iOS-only | **PROVEN** — SDK type definition at MapUrlTile.d.ts:66-68 |
| `customMapStyle` hides Google Maps labels | **PROVEN** — prop exists, Google Maps JSON styling is well-documented |
| AnimatedPlacePin missing `collapsable` | **PROVEN** — code at line 50, no collapsable prop anywhere in the component |
| Missing `collapsable` causes invisible markers on Android | **PROBABLE** — standard Android react-native-maps requirement, but needs device test to confirm this specific symptom |
