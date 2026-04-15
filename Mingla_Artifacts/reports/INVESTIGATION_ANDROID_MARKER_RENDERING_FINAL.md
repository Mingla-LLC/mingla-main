# Investigation: Android Google Maps Custom Marker Rendering - Final (ORCH-0410)

> Date: 2026-04-14
> Confidence: High for the current code path and historical root causes traced from git + native library source. Runtime-only visual severity remains an inference where noted.

## Scope

- Feature: Discover Map custom marker rendering on Android after ORCH-0410 provider unification
- User / actor: Signed-in mobile user opening Discover Map on an Android native build
- Environment: `ACTIVE_DISCOVER_MAP_PROVIDER = 'react-native-maps'`, `AIRMap` native module present, Google Maps SDK available in the native binary
- Success definition: user marker, place pins, and person markers all render as Android Google Maps custom markers; marker taps work; Android Google Maps native toolbar is hidden
- Assumptions:
  - This report reflects the live repo state on 2026-04-14, not just the earlier prompt assumptions.
  - The prompt file predates the final ORCH-0410 fixes that landed later the same day.

## Intended Journey

1. `DiscoverScreen` mounts `DiscoverMap`, which routes into `MapProviderSurface`.
2. `MapProviderSurface` selects `ReactNativeMapsProvider`.
3. `ReactNativeMapsProvider` renders `ClusteredMapView` plus three custom-marker families:
   - user marker
   - place pins (`AnimatedPlacePin`)
   - nearby people markers
4. Each custom marker child is measured by `react-native-maps` Android shadow-node plumbing.
5. `MapMarker.createDrawable()` snapshots the React view into a bitmap.
6. Google Maps displays that bitmap until tracking is turned back on.

## Evidence Chain

- Entry point:
  - `app-mobile/src/components/map/providers/config.ts:15-26` hard-selects `react-native-maps` for Discover Map on both platforms.
  - `app-mobile/src/components/map/providers/MapProviderSurface.tsx` routes that config to `ReactNativeMapsProvider`.

- Client path:
  - `ReactNativeMapsProvider` renders:
    - user marker at `ReactNativeMapsProvider.tsx:157-175`
    - place pins at `ReactNativeMapsProvider.tsx:179-190`
    - people markers at `ReactNativeMapsProvider.tsx:194-216`
  - `AnimatedPlacePin` returns a `Marker` with a custom React child at `AnimatedPlacePin.tsx:45-64`.
  - `PlacePinContent` defines the place pin visual bounds at `PlacePin.tsx:117-221`.
  - `PersonPinContent` / `SelfPinContent` define the avatar marker bounds at `PersonPin.tsx:19-147`.

- Cluster-library path:
  - `react-native-map-clustering/lib/helpers.js:6-10` only treats a child as a clusterable marker if the immediate child props contain `coordinate`.
  - `AnimatedPlacePin` is passed to `ClusteredMapView` as a component whose immediate props do not contain `coordinate`.
  - `react-native-map-clustering/lib/ClusteredMapView.js:81-87, 215` therefore places `AnimatedPlacePin` into `otherChildren` and renders it directly, not through Supercluster.
  - Conclusion: clustering was not swallowing `AnimatedPlacePin`; the failure lived in the Android custom-marker bitmap path.

- Native Android marker path:
  - `MapMarkerManager.java:352-367` uses a shadow node to send measured width and height into the native marker view.
  - `MapMarker.java:255-276` only keeps live bitmap tracking active when `tracksViewChanges && hasCustomMarkerView && marker != null`.
  - `MapMarker.java:402-410` marks a marker as a custom view when a child view is attached.
  - `MapMarker.java:433-438` creates the Google marker and then updates tracking.
  - `MapMarker.java:524-540` snapshots the custom view into a bitmap using the measured width/height, falling back to `100x100` when those dimensions are still unset.

- Verification performed:
  - Read the live app code, installed `react-native-maps` Android source, and installed `react-native-map-clustering` source.
  - Reviewed the ORCH-0410 fix commits:
    - `232e504d` - provider unification to `react-native-maps`
    - `c667bcd3` - `collapsable={false}` added to custom marker roots
    - `ea484dd9` - initial `tracksViewChanges=true` added for all custom markers
  - Ran focused lint on the relevant marker/provider files:
    - `npx eslint src/components/map/AnimatedPlacePin.tsx src/components/map/PlacePin.tsx src/components/map/PersonPin.tsx src/components/map/providers/ReactNativeMapsProvider.tsx src/components/map/providers/config.ts`
    - Result: clean

## Direct Answers

1. Why is the user marker clipped?
   - The custom-marker bitmap is bounded by `styles.userMarker` (`56x68`) in `ReactNativeMapsProvider.tsx:225-237`.
   - The base avatar fits inside that box, but overflow visuals can exceed it:
     - `statusBubble` can grow up to `maxWidth: 100` in `PersonPin.tsx:134-137`
     - `selfRing` adds shadow/elevation in `PersonPin.tsx:109-116`
   - `MapMarker.createDrawable()` clips to the measured bitmap size (`MapMarker.java:524-540`).
   - So the clipping is not "user marker has no size"; it is "the measured marker box is smaller than the full visual footprint."

2. Why did `AnimatedPlacePin` fail to render?
   - The complete answer is now proven by the ORCH-0410 diffs:
     - first, Android needed a real non-collapsed root view (`collapsable={false}`), added in `c667bcd3`
     - second, Android needed an initial tracked render pass, added in `ea484dd9`
   - Before those fixes:
     - `AnimatedPlacePin` had no non-collapsable wrapper
     - it started with `tracksViewChanges={false}`
     - its first visible frame was also `scale = 0`
   - That combination let Android snapshot an empty or flattened custom-marker view before a stable bitmap existed.
   - In the live code, `AnimatedPlacePin.tsx:21-25` now starts tracking `true`, and `AnimatedPlacePin.tsx:53-63` wraps content in `View collapsable={false}`.
   - Clustering was not the cause.

3. Do person avatars render?
   - Yes, the current code path should render the avatar marker itself.
   - Evidence:
     - `peopleTrackChanges` starts `true` and stays on for 3 seconds at `ReactNativeMapsProvider.tsx:65-70`
     - a 45-second heartbeat re-enables tracking at `ReactNativeMapsProvider.tsx:72-84`
     - the marker root uses `View collapsable={false}` at `ReactNativeMapsProvider.tsx:211-213`
     - `PersonPinContent` has explicit wrapper dimensions `52x58` at `PersonPin.tsx:100-101`
   - Residual risk:
     - the avatar itself should render
     - the overflowing status bubble or taste-match badge can still clip because they extend beyond that `52x58` box

4. How do we hide the Android Google Maps native buttons?
   - Add `toolbarEnabled={false}` to `ClusteredMapView` / `MapView`.
   - `react-native-maps/lib/MapView.d.ts:502-508` documents this exact prop as hiding the Android "Navigate" / "Open in Maps" buttons.
   - The current provider does not set it anywhere in `ReactNativeMapsProvider.tsx:116-144`.

5. What is the complete fix for all marker types?
   - The marker-rendering fix is already mostly present in the repo:
     - keep Android on `react-native-maps` (`config.ts:15-26`)
     - keep `collapsable={false}` on every custom marker root
     - start custom markers with `tracksViewChanges=true`
     - turn tracking back off after the initial render/image-load window
   - The remaining hardening still needed:
     - add `toolbarEnabled={false}` on the map
     - enlarge marker wrapper dimensions, or stop using overflowing marker visuals that extend beyond the measured bitmap box

## Findings

1. Severity: High
   Type: confirmed bug (historical root cause, fixed in current code)
   Summary: Android custom markers originally failed because ORCH-0410 needed both a non-collapsable root and an initial tracked render pass.
   Broken journey step: custom React marker view -> Android bitmap capture
   Evidence:
   - `c667bcd3` added `collapsable={false}` to `AnimatedPlacePin`, `PlacePin`, and the user marker root.
   - `ea484dd9` changed custom markers to start with `tracksViewChanges=true`.
   - Native proof lives in `MapMarker.java:255-276, 402-410, 524-540`.
   User impact: invisible place pins and unstable custom marker rendering on Android.
   Fix direction: keep the current two-part fix in place; do not revert either part.
   Missing test or guardrail: no Android device screenshot/smoke test covers this path.

2. Severity: Medium
   Type: likely bug
   Summary: user/person marker wrappers are smaller than some of the visuals they try to render.
   Broken journey step: measured marker bounds -> final visible custom marker bitmap
   Evidence:
   - user marker wrapper: `56x68` at `ReactNativeMapsProvider.tsx:225-237`
   - person/self wrapper: `52x58` at `PersonPin.tsx:100-101`
   - status bubble: `maxWidth: 100` at `PersonPin.tsx:134-137`
   - taste badge overhang: `bottom: -4, left: -4` at `PersonPin.tsx:139-145`
   - native bitmap clipping: `MapMarker.java:524-540`
   User impact: base avatar should show, but status bubbles/badges can be clipped on Android.
   Fix direction: make marker root dimensions large enough for the full visual footprint, or avoid overflowing marker visuals on Android.
   Missing test or guardrail: no screenshot diff for long status text or stranger badge variants.

3. Severity: Medium
   Type: confirmed observation
   Summary: `AnimatedPlacePin` is not being consumed by clustering.
   Broken journey step: none; this rules out a false lead.
   Evidence:
   - cluster detection requires immediate `child.props.coordinate` at `helpers.js:6-10`
   - non-marker children are rendered directly via `{otherChildren}` at `ClusteredMapView.js:81-87, 215`
   User impact: the actual bug lived in marker bitmap capture, not in clustering logic.
   Fix direction: none; keep this as the forensic explanation.
   Missing test or guardrail: no regression test proving component-wrapped markers still render through the `otherChildren` path.

4. Severity: Medium
   Type: confirmed bug
   Summary: Android Google Maps native toolbar is still enabled.
   Broken journey step: marker press -> post-tap map chrome
   Evidence:
   - `toolbarEnabled?: boolean` exists specifically for Android in `MapView.d.ts:502-508`
   - `ReactNativeMapsProvider.tsx:116-144` does not set it
   User impact: Mingla shows unwanted Google Maps "Navigate" / "Open in Maps" buttons after marker taps.
   Fix direction: add `toolbarEnabled={false}` to the `ClusteredMapView` props.
   Missing test or guardrail: no Android interaction checklist for post-marker-tap chrome.

5. Severity: Medium
   Type: production-hardening gap
   Summary: ORCH-0410 marker fixes are protected by recent code comments and git history, not by automated coverage.
   Broken journey step: regression prevention
   Evidence:
   - repo search found marker code references but no focused automated tests for `AnimatedPlacePin`, `PlacePin`, `PersonPin`, or `ReactNativeMapsProvider`
   User impact: a future cleanup can silently reintroduce invisible Android markers by removing `collapsable={false}` or changing initial tracking defaults.
   Fix direction: add at least one Android smoke test or manual release checklist item for custom markers.
   Missing test or guardrail: the test itself

## Production-Readiness Verdict

- Ready / Not ready:
  - Marker rendering itself is now substantially fixed in source.
  - The Android toolbar gap is still unresolved.
  - Marker overflow clipping remains a residual risk for status/badge variants.

- Launch blockers:
  - `toolbarEnabled={false}` is still missing.
  - Native-build verification is still required because `ReactNativeMapsProvider` falls back when `AIRMap` is unavailable (`ReactNativeMapsProvider.tsx:97-112`).

- Residual risks:
  - long status text or badge overhang clipping on avatar markers
  - no automated Android marker regression coverage

- Fastest next verification:
  1. Add `toolbarEnabled={false}`.
  2. Test Android on a native build with:
     - user marker with a long activity status
     - stranger marker with taste-match badge + status bubble
     - first-load place pins with stagger animation
  3. Capture screenshots before and after to confirm there is no clipping and no Google Maps toolbar.
