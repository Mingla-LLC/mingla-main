# Investigation: Android Markers Not Rendering + iOS OTA Banner (ORCH-0410)

> **Date:** 2026-04-14
> **Confidence:** PROBABLE for Android markers (need runtime diagnostic). PROBABLE for iOS OTA.

---

## Executive Summary

**Android markers:** The native Java source (MapMarker.java) shows that bitmap creation happens during `addToMap()` AND `updateExtraData()` (layout callback) — so markers SHOULD create their initial bitmaps even with `tracksViewChanges={false}`. However, `AnimatedPlacePin` starts with `Animated.Value(0)` (scale 0 = invisible), so the bitmap captures an invisible view. Person markers start with `tracksViewChanges={true}` and should render. User marker has no animation and should render.

**The fact that NOTHING shows (not even person markers which start with tracksViewChanges=true) suggests something more fundamental than tracksViewChanges.** The most productive next step is a runtime diagnostic: set `tracksViewChanges={true}` on ALL markers and test. If they still don't show, the issue is NOT tracksViewChanges — it's something else (possibly ClusteredMapView interaction with Google Maps on Android, or a react-native-maps 1.20.1 Android bug).

**iOS OTA:** The OTA code has `if (__DEV__) return;` — it skips update checks in development builds. If the user's iOS app is a development client (not a production TestFlight build), the OTA check never runs and the banner never shows. No `Platform.OS` check exists — the code is platform-agnostic.

---

## Issue 1: Android Markers — Analysis from Native Java Source

### Native Marker Lifecycle (MapMarker.java)

I traced the FULL lifecycle from the react-native-maps Android native source:

**Step 1: `addView(child)` (line 402-411)**
- Sets `hasCustomMarkerView = true`
- Calls `updateTracksViewChanges()` — but `marker` is null at this point, so `shouldTrack = false`
- Calls `update(true)` — but `marker` is null, so returns early (line 491-492)
- **Result: no bitmap created yet**

**Step 2: `addToMap(collection)` (line 434-438)**
- Creates the native Google Maps marker via `markerCollection.addMarker(getMarkerOptions())`
- `getMarkerOptions()` → `fillMarkerOptions(options)` → `options.icon(getIcon())` → `createDrawable()`
- **`createDrawable()` (line 524-546) captures the current state of the React view**
- If the view is at scale 0 (AnimatedPlacePin) or not yet laid out → bitmap may be empty/transparent
- Calls `updateTracksViewChanges()` — if `tracksViewChanges=false`, no tracking starts

**Step 3: `updateExtraData(width, height)` (MapMarkerManager.java:360-367)**
- Called from React Native's shadow node when the view layout completes
- Triggers `view.update(width, height)` → `update(true)` → `updateMarkerIcon()` → `getIcon()` → `createDrawable()`
- **This recreates the bitmap with the actual laid-out view**
- This should work even with `tracksViewChanges={false}`

### Why ALL markers might be invisible

The `updateExtraData` callback SHOULD create valid bitmaps. But there are scenarios where it might not:

1. **If the shadow node never reports dimensions** — React Native's Fabric renderer may handle `updateExtraData` differently than the old architecture. If the callback never fires, no bitmap is created after the initial (possibly empty) one from `addToMap`.

2. **If `createDrawable()` captures the view before React children render** — The `this.draw(canvas)` at line 543 draws whatever is currently in the view hierarchy. If React children haven't mounted yet (async rendering), the draw captures nothing.

3. **If the ClusteredMapView wrapper interferes** — `react-native-map-clustering` clones children and manages their rendering. The clustering library might delay rendering markers until the initial region settles, and the initial bitmap is created before markers are visible.

### What I CANNOT prove from code alone

I cannot determine whether `updateExtraData` is actually being called on Android for these markers. This is a RUNTIME question — it depends on React Native's rendering pipeline and the Fabric architecture.

### Recommended Diagnostic (CRITICAL)

**Test 1: Set `tracksViewChanges={true}` on ALL markers temporarily.**

In `ReactNativeMapsProvider.tsx`, change:
- User marker: `tracksViewChanges={false}` → `tracksViewChanges={true}`
- AnimatedPlacePin: `tracksViewChanges={tracking}` → `tracksViewChanges={true}`
- Person markers: keep as-is (already starts true)

If markers appear → `tracksViewChanges={false}` prevents bitmap creation on Android. Fix: start ALL markers with `tracksViewChanges={true}`, then switch to false after a delay.

If markers STILL don't appear → the issue is NOT tracksViewChanges. It's either:
- ClusteredMapView not rendering children on Android Google Maps
- react-native-maps 1.20.1 Android rendering bug
- Google Maps API key restriction or permission issue

**Test 2: Remove ClusteredMapView, use plain MapView.**

Temporarily replace `ClusteredMapView` with `MapView` from react-native-maps. If markers appear, the clustering library is the problem.

**Test 3: Add a single hardcoded test marker.**

Add a simple `<Marker coordinate={{latitude: 35.79, longitude: -78.74}} />` (no custom view, default pin) directly inside the ClusteredMapView. If the default pin appears, the issue is with CUSTOM VIEW markers. If even the default pin doesn't appear, the issue is with the MapView itself.

---

## Issue 2: iOS OTA Banner

### Root Cause: `__DEV__` Guard

**File:** `app-mobile/src/hooks/useOtaUpdates.ts:47`

```typescript
const checkForUpdate = useCallback(async (): Promise<void> => {
    // Guard: expo-updates throws in dev mode
    if (__DEV__) return;
```

**Classification:** PROBABLE — depends on which build the user is testing on

The OTA check immediately returns if `__DEV__` is true. Development client builds (built with `eas build --profile development` or `npx expo run:ios`) have `__DEV__ = true`. Production builds (built with `eas build --profile production` or TestFlight) have `__DEV__ = false`.

**No `Platform.OS` check exists.** The code is completely platform-agnostic. The banner component (`OtaUpdateBanner.tsx`) renders on both platforms equally.

**The most likely explanation:** The user's Android app is a production build (Play Store internal testing) while the iOS app is either a development client or a build that doesn't have expo-updates configured.

### What to check

1. Is the iOS build a production build or a development client?
2. Was the iOS build created with `eas build --profile production`?
3. Does the `updates` section exist in `app.json`?

<br/>

Let me verify the updates configuration:
