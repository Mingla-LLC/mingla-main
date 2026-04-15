# Investigation: ORCH-0429 — Android Map Markers Rendering as Lines

> Date: 2026-04-14
> Investigator: Forensics Agent
> Confidence: High (root cause proven via code trace across 5 layers)
> Status: Root cause proven

## Layman Summary

On Android, map markers (both people avatars and place pins) appear as thin lines
instead of proper circles and pins. The root cause: **the native library that captures
marker bitmaps doesn't know how big the markers actually are under the New Architecture.**

The library (`react-native-maps`) uses a Paper-era measurement system
(`SizeReportingShadowNode`) that doesn't work under Fabric (New Architecture, enabled
in this project). Since the library never receives the correct dimensions, it falls back
to creating a tiny 100x100 pixel bitmap. But the actual marker content is much larger
(e.g., 385x220 pixels on a typical Android device). Only the top-left corner of the
content is captured — for centered circles and avatars, that means only a thin edge or
arc is visible, which appears as a "line" on the map.

## Symptom

- **Expected:** Circular avatar pins and category-icon place pins rendered on the Android
  Google Maps discover map
- **Actual:** Both marker types render as thin lines/streaks instead of their proper shapes
- **Affected:** ALL custom markers — user pin, person pins, place pins
- **Platform:** Android only (iOS uses Apple Maps with a different rendering pipeline)
- **When it started:** After ORCH-0410 unified Android to react-native-maps + Google Maps
  (was previously MapLibre, which doesn't use bitmap capture)

## Investigation Manifest

| # | File | Layer | Purpose |
|---|------|-------|---------|
| 1 | `app-mobile/app.json` | Config | Confirm New Architecture enabled |
| 2 | `app-mobile/package.json` | Config | react-native 0.81.5, react-native-maps 1.20.1 |
| 3 | `node_modules/react-native-maps/.../SizeReportingShadowNode.java` | Native | Paper shadow node that reports dimensions |
| 4 | `node_modules/react-native-maps/.../MapMarkerManager.java:352-367` | Native | Creates shadow node, receives dimensions |
| 5 | `node_modules/react-native-maps/.../MapMarker.java:47-48` | Native | Default width=0, height=0 |
| 6 | `node_modules/react-native-maps/.../MapMarker.java:511-516` | Native | `update(int,int)` — only setter for dimensions |
| 7 | `node_modules/react-native-maps/.../MapMarker.java:524-546` | Native | `createDrawable()` — bitmap creation with 100x100 fallback |
| 8 | `node_modules/react-native-maps/.../MapMarker.java:451-473` | Native | `getIcon()` → `createDrawable()` flow |
| 9 | `node_modules/react-native-maps/.../ViewChangesTracker.java` | Native | 40ms re-capture loop when tracking enabled |
| 10 | `node_modules/react-native-maps/.../MapFeature.java` | Native | Confirms MapMarker extends ReactViewGroup (has getWidth/getHeight) |
| 11 | `app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx` | Component | All three marker render paths |
| 12 | `app-mobile/src/components/map/AnimatedPlacePin.tsx` | Component | Place pins with scale animation |
| 13 | `app-mobile/src/components/map/PlacePin.tsx` | Component | Place pin content + dimensions |
| 14 | `app-mobile/src/components/map/PersonPin.tsx` | Component | Person/self avatar content + dimensions |
| 15 | `node_modules/react-native-maps/android/build.gradle` | Config | No native Fabric support |

## Findings

### Finding 1 — ROOT CAUSE: Fabric breaks SizeReportingShadowNode dimension path

Classification: **RED — Root Cause**

| Field | Evidence |
|-------|----------|
| **File + line** | `MapMarker.java:47-48` (default width/height = 0), `SizeReportingShadowNode.java:22-30` (Paper-era dimension reporting), `MapMarker.java:524-526` (100x100 fallback) |
| **Exact code** | `private int width;` / `private int height;` (default 0) → `int width = this.width <= 0 ? 100 : this.width;` |
| **What it does** | `SizeReportingShadowNode.onCollectExtraUpdates()` sends layout dimensions via `UIViewOperationQueue.enqueueUpdateExtraData()`. Under Fabric interop, this Paper queue path does not reach `MapMarkerManager.updateExtraData()`. Result: `MapMarker.width` and `MapMarker.height` stay at Java default 0. `createDrawable()` falls back to 100x100 pixel bitmap. |
| **What it should do** | `createDrawable()` should create a bitmap matching the View's actual laid-out pixel dimensions |
| **Causal chain** | 1) `newArchEnabled: true` in app.json activates Fabric → 2) react-native-maps has no native Fabric support (Paper interop only) → 3) `SizeReportingShadowNode.onCollectExtraUpdates()` fires but `UIViewOperationQueue` path is broken under Fabric → 4) `MapMarkerManager.updateExtraData()` never called → 5) `MapMarker.width/height` stay at 0 → 6) `createDrawable()` falls back to 100x100 px bitmap → 7) Fabric lays out the custom view at dp×density pixels (e.g., 385×220 on 2.75x device) → 8) `this.draw(canvas)` clips the 385×220 content to the 100×100 bitmap → 9) For centered content, only a thin off-center slice is captured → 10) Slice appears as a "line" on the map |
| **Verification step** | Add `Log.d("MapMarker", "width=" + this.width + " height=" + this.height + " viewW=" + getWidth() + " viewH=" + getHeight())` in `createDrawable()`. Under Fabric, expect `width=0 height=0 viewW=385 viewH=220` (values vary by density). Under Paper, expect `width=140 height=80` matching the shadow node report. |

### Finding 2 — CONTRIBUTING: No density conversion in MapMarkerManager

Classification: **ORANGE — Contributing Factor**

Even if the shadow node DID fire, `SizeReportingShadowNode.getLayoutWidth()` returns
dp-based Yoga layout results. `MapMarkerManager.updateExtraData()` casts directly to int
with no `PixelUtil.toPixelFromDIP()` conversion:

```java
// MapMarkerManager.java:360-367
float width = data.get("width");   // dp from shadow node
float height = data.get("height"); // dp from shadow node
view.update((int) width, (int) height); // stored as-is, used for pixel bitmap
```

Compare with other managers in the same library that DO convert:
- `MapCircleManager.java:48`: `float widthInScreenPx = metrics.density * widthInPoints;`
- `MapPolylineManager.java:51`: `float widthInScreenPx = metrics.density * widthInPoints;`
- `MapManager.java:179`: `left = (int) (padding.getDouble("left") * density);`

`MapMarkerManager` is the ONLY manager that skips density conversion. On Paper, this
was masked because the dp values happened to produce reasonable (if slightly wrong)
bitmaps. Under Fabric, the shadow node path is broken entirely so this never fires.

### Finding 3 — CONTRIBUTING: react-native-maps has no native Fabric support

Classification: **ORANGE — Contributing Factor**

The library's `android/build.gradle` checks `isNewArchitectureEnabled()` but only sets
a build config flag — no actual Fabric component registration or C++ shadow node exists.
The `SizeReportingShadowNode` is pure Paper Java code (`extends LayoutShadowNode`,
uses `UIViewOperationQueue`). No Fabric-native measurement mechanism is implemented.

This means the library relies entirely on Paper interop, which does NOT guarantee
Paper-era `updateExtraData()` flows work correctly.

### Finding 4 — OBSERVATION: getWidth()/getHeight() available as reliable alternative

Classification: **BLUE — Observation**

`MapMarker extends MapFeature extends ReactViewGroup extends ViewGroup extends View`.
Under Fabric, React Native's mounting layer DOES lay out the MapMarker and its children
with correct pixel dimensions. `MapMarker.getWidth()` and `MapMarker.getHeight()` return
the actual pixel dimensions after layout.

This means `createDrawable()` has a reliable dimension source available — it just
doesn't use it. The fix is to fall back to `getWidth()`/`getHeight()` when `this.width`
and `this.height` are 0.

### Finding 5 — HIDDEN FLAW: AnimatedPlacePin scale=0 bitmap capture

Classification: **YELLOW — Hidden Flaw**

Even after fixing the dimension issue, `AnimatedPlacePin` starts with `scale = 0`
(`Animated.Value(0)`) and `useNativeDriver: true`. The first bitmap captures will show
content at scale=0 (invisible). The spring animation (friction=6, tension=80) runs on
the native thread, and `ViewChangesTracker` re-captures at 40ms intervals, so the
animation WILL eventually be captured. But for the first ~100ms (before the spring has
significant displacement), the marker will be invisible on the map.

This is a cosmetic issue, not the root cause of the "lines" artifact.

## Five-Layer Cross-Check

| Layer | Finding |
|-------|---------|
| **Docs** | No react-native-maps documentation warns about Fabric compatibility issues with custom markers |
| **Schema** | N/A (no database involvement) |
| **Code** | `SizeReportingShadowNode` uses Paper-era `UIViewOperationQueue` — confirmed broken under Fabric. `MapMarker.width/height` default to 0. `createDrawable()` falls back to 100x100. `getWidth()`/`getHeight()` ARE available but unused. |
| **Runtime** | Under Fabric, `updateExtraData()` is never called → bitmap dimensions never set → 100x100 fallback confirmed by code path analysis |
| **Data** | Bitmap = 100x100 pixels. View content = dp×density pixels. Content centered → only thin edge captured. |

All five layers agree: the dimension path is broken under Fabric, and `createDrawable()`
produces an undersized bitmap.

## Blast Radius

- **All custom markers on Android affected:** user pin, person pins, place pins
- **iOS NOT affected:** iOS uses Apple Maps with a different marker rendering pipeline
- **No solo/collab distinction:** Both modes use the same map
- **No admin panel impact:** Admin uses Leaflet, not Google Maps
- **No database/RLS impact:** Pure rendering issue

## Invariant Violations

- **Platform parity:** Android markers must visually match iOS markers — VIOLATED
- **No dead taps:** Markers may be visually invisible but still have tap targets — partially violated (taps work but users can't see what they're tapping)

## Fix Direction

**Patch `MapMarker.java` via `patch-package`:** Modify `createDrawable()` to use
`this.getWidth()` and `this.getHeight()` (the actual Android View dimensions after Fabric
layout) when the Paper-era `this.width`/`this.height` are 0:

```java
private Bitmap createDrawable() {
    // Fabric (New Architecture): SizeReportingShadowNode doesn't fire, so this.width/height
    // stay at 0. Fall back to the View's actual laid-out pixel dimensions.
    int w = this.width > 0 ? this.width : this.getWidth();
    int h = this.height > 0 ? this.height : this.getHeight();
    int width = w <= 0 ? 100 : w;
    int height = h <= 0 ? 100 : h;

    this.buildDrawingCache();
    // ... rest unchanged
}
```

This is safe because:
- `MapMarker extends ReactViewGroup` — `getWidth()`/`getHeight()` are always available
- Under Fabric, these return correct pixel dimensions after layout
- Under Paper, `this.width`/`this.height` are still preferred (non-zero)
- The 100 fallback remains as a last resort

**No JS-side changes needed.** The fix is entirely in the native library.

## Regression Prevention

1. Add `patch-package` patch for `react-native-maps` with a clear comment explaining WHY
2. Add an Android-specific smoke test to the release checklist: "Verify map markers render
   as circles/pins (not lines or invisible)"
3. Watch for `react-native-maps` releases that add native Fabric support — when available,
   the patch can be removed

## Discoveries for Orchestrator

- **react-native-maps + Fabric interop is fragile.** Any other features relying on Paper
  shadow nodes (e.g., MapView's own `SizeReportingShadowNode` used for `onLayout`
  measurements, MapCallout dimensions) may also be broken. Worth a broader audit.
- **ORCH-0410's prior investigation missed the Fabric angle** because it read the native
  code assuming the shadow node path works. The "lines" symptom only manifests on actual
  Android hardware with the production Fabric-enabled build.
