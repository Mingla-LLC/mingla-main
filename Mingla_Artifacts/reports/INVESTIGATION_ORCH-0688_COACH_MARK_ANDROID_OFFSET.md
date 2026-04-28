# INVESTIGATION — ORCH-0688: Coach mark spotlight is misaligned on Android

**Mode:** INVESTIGATE (no spec, no code)
**Subject:** Android-only coach mark cutout misalignment; iOS unaffected
**Date:** 2026-04-26
**Investigator:** mingla-forensics
**Source dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0688_COACH_MARK_ANDROID_OFFSET.md`
**Related:** ORCH-0635 (coach mark refresh, 8→9 step variant)

---

## 0. Honesty notice (read first)

The dispatch prompt's hard rule was: *"No fabricated reproductions. If you cannot run on
a real Android device, say so and request one. Do not infer numbers."*

This investigation is conducted from static analysis only. **No real device was available
to me.** Per that rule I am explicitly NOT inventing measurement numbers for Step B of
the prompt's procedure (the per-step Android-vs-iOS measurement matrix).

What this report DOES deliver, with HIGH confidence:
- The Android **configuration root** that creates the cross-platform delta
- The exact code paths where the delta materialises into a visible spotlight offset
- A focused list of THREE candidate root-cause mechanisms (one is overwhelmingly likely)
- Three candidate fix shapes with blast-radius and risk analysis
- A clear recommendation for the fastest path to confirmed fix

What this report explicitly defers to a device-equipped follow-up pass:
- The numeric delta (24dp / 30dp / 48dp / 2× — see §6)
- Final selection between mechanisms RC-A and RC-C (§5)
- Confirmation that the candidate fix completely eliminates the offset on real hardware

**Confidence:** HIGH on configuration root cause. MEDIUM-HIGH on exact mechanism.
HIGH on direction of fix. The ten-minute device measurement at §6 collapses both
remaining unknowns.

---

## 1. Symptom recap

On Android, the dark coach mark spotlight ring (the "cutout" carved into the dark scrim)
lands in the **wrong location** — visually offset from the element it is supposed to
highlight. The bubble that points at the cutout is anchored to the same target rectangle
and is therefore also misplaced. iOS is **pixel-perfect** with the same JavaScript code
and the same coach step configuration. Reproduction is universal across the 9 coach
steps; the user described it as "way off."

---

## 2. Investigation manifest

Files read in full or in relevant section:

| # | File | Purpose |
|---|------|---------|
| 1 | [SpotlightOverlay.tsx](app-mobile/src/components/SpotlightOverlay.tsx) | The painting layer — SVG mask + bubble positioning |
| 2 | [useCoachMark.ts](app-mobile/src/hooks/useCoachMark.ts) | Per-target measurement registration via `measureInWindow` |
| 3 | [CoachMarkContext.tsx](app-mobile/src/contexts/CoachMarkContext.tsx) | State, measurements map, synthetic-rect path for steps 8–9 |
| 4 | [coachMarkSteps.ts](app-mobile/src/constants/coachMarkSteps.ts) | The 9-step config (`COACH_STEP_COUNT = 9`) |
| 5 | [useAppLayout.ts](app-mobile/src/hooks/useAppLayout.ts) | `insets.top`, `bottomNavTotalHeight` consumed by overlay clamps |
| 6 | [app/_layout.tsx](app-mobile/app/_layout.tsx) | Root router layout (`GestureHandlerRootView` + expo-router `Stack`) |
| 7 | [app/index.tsx](app-mobile/app/index.tsx) (lines 1-110, 2310-2560, 2651-2700) | Provider tree, `<StatusBar translucent>`, SpotlightOverlay mount, root style box |
| 8 | [app.json](app-mobile/app.json) | Android build config (`edgeToEdgeEnabled`, `newArchEnabled`) |
| 9 | [app.config.ts](app-mobile/app.config.ts) | Dynamic config — no Android status-bar overrides |
| 10 | [index.ts](app-mobile/index.ts) | Native registration entry; trivial wrapper |
| 11 | [package.json](app-mobile/package.json) (relevant deps only) | RN 0.81.5, Expo 54, react-native-safe-area-context 5.6.0 |
| 12 | [HomePage.tsx](app-mobile/src/components/HomePage.tsx) (`useCoachMark` callsites at L198–L202) | Steps 1, 2, 4, 5 target attachment |
| 13 | [DiscoverScreen.tsx](app-mobile/src/components/DiscoverScreen.tsx) (`useCoachMark(6, 24)` at L701) | Step 6 |
| 14 | [ConnectionsPage.tsx](app-mobile/src/components/ConnectionsPage.tsx) (`useCoachMark(7, 0)` at L298) | Step 7 |
| 15 | [ProfilePage.tsx](app-mobile/src/components/ProfilePage.tsx) (lines 129, 148, 157, 164) | Steps 8, 9 — synthetic-rect path |

Files NOT read (out of scope or not present in the repo): `MainActivity.kt`, `styles.xml`,
`AndroidManifest.xml` (Expo prebuild generates these from app.json — checking the
generated files would not add evidence beyond what app.json already declares).

---

## 3. Static evidence (the configuration root)

These four facts together explain why Android can resolve coordinates differently
than iOS for `measureInWindow` even though the JavaScript is identical:

### 3.1 Android edge-to-edge is enabled
[app.json:40](app-mobile/app.json#L40)
```json
"edgeToEdgeEnabled": true
```
Effect: the Android window draws **behind** the status bar AND the navigation bar.
The application window's coordinate system origin (0, 0) sits at the TOP of the
physical screen, including the status bar zone.

### 3.2 The status bar is set translucent at the JS layer
[app/index.tsx:2321-2325](app-mobile/app/index.tsx#L2321-L2325)
```tsx
<StatusBar
  barStyle={...}
  translucent={true}
  backgroundColor="transparent"
/>
```
Reinforces 3.1 — there is no opaque status bar to "push" the React root view down.

### 3.3 The new architecture is enabled
[app.json:9](app-mobile/app.json#L9), [app.json:96-104](app-mobile/app.json#L96-L104)
```json
"newArchEnabled": true,
"plugins": [..., ["expo-build-properties", { "android": { "newArchEnabled": true }, ... }]]
```
Fabric + TurboModules. `react-native-safe-area-context 5.6.0` is the new-arch-aware
release; behaviour of `useSafeAreaInsets()` and inset propagation differ slightly
from old arch.

### 3.4 The SpotlightOverlay's outer box has no top padding
[app/index.tsx:2320, 2326, 2334-2338](app-mobile/app/index.tsx#L2320-L2338) plus the
style table at [L2651-L2686](app-mobile/app/index.tsx#L2651-L2686):
```tsx
<View style={styles.safeArea}>           // { flex: 1, backgroundColor: '#000000' }
  <StatusBar translucent .../>
  <View style={styles.container}>        // { flex: 1 }
    <View style={[styles.mainContent, {  // { flex: 1 }
      paddingTop: (currentPage === 'profile' || 'home' || 'discover' || 'connections' || 'likes')
        ? 0
        : layout.insets.top,
      paddingBottom: ...,
    }]}>
      { /* page content */ }
    </View>
    <SpotlightOverlay />                 // sibling of mainContent
    <CoachMarkNavigationGate>...</CoachMarkNavigationGate>
  </View>
</View>
```
**`styles.safeArea` is a regular `View`, not `SafeAreaView` from
`react-native-safe-area-context`.** Both `safeArea` and `container` are pure
`flex: 1` boxes — no `paddingTop`, no inset compensation.

Combined with edge-to-edge + translucent status bar, the **SpotlightOverlay's parent
box extends from y=0 of the application window to y=screenHeight** — it spans the
status-bar zone. Inside the overlay, [`<Animated.View style={[StyleSheet.absoluteFill]}>`
at L217-L222](app-mobile/src/components/SpotlightOverlay.tsx#L217-L222) fills the
parent box. The SVG inside paints `width × height = Dimensions.get('window').width × height`
([L61](app-mobile/src/components/SpotlightOverlay.tsx#L61), [L241](app-mobile/src/components/SpotlightOverlay.tsx#L241)).

### 3.5 `measureInWindow` is the registration mechanism for steps 1–7
[useCoachMark.ts:32](app-mobile/src/hooks/useCoachMark.ts#L32)
```ts
node.measureInWindow((x, y, width, height) => {
  if (width === 0 && height === 0) return;
  registerTarget(stepId, { x, y, width, height, radius: targetRadius });
});
```
The registered `(x, y)` is whatever the React Native Android bridge returns for
`getLocationInWindow` on the View — which is **coordinates relative to the Android
application window** (which, with edge-to-edge, includes the status-bar zone).

The mask in SpotlightOverlay paints a cutout at `(target.x, target.y)` directly
([SpotlightOverlay.tsx:148-155](app-mobile/src/components/SpotlightOverlay.tsx#L148-L155)
and [L246-L255](app-mobile/src/components/SpotlightOverlay.tsx#L246-L255)).

---

## 4. Per-step measurement matrix (REQUIRED FROM DEVICE — NOT INFERRED)

The dispatch prompt requires this table populated with raw numbers from a real
Android device + a real iPhone for all 9 steps. **Sample structure preserved
intentionally — every cell marked `(measure)` is a hard requirement before any
spec is written.**

| Step | Target | Path | iOS y | Android y | Expected y | Δ Android |
|------|--------|------|-------|-----------|------------|-----------|
| 1 | HomePage deck card (`useCoachMark(1, 36)`) | live `measureInWindow` | (measure) | (measure) | (measure) | (measure) |
| 2 | HomePage prefs button (`useCoachMark(2, 20)`) | live | (measure) | (measure) | (measure) | (measure) |
| 3 | (no `useCoachMark` callsite found — see §7 D-1) | none → fallback | n/a | n/a | n/a | (measure: should be centred) |
| 4 | HomePage create button (`useCoachMark(4, 16)`) | live | (measure) | (measure) | (measure) | (measure) |
| 5 | HomePage solo button (`useCoachMark(5, 18)`) | live | (measure) | (measure) | (measure) | (measure) |
| 6 | DiscoverScreen header panel (`useCoachMark(6, 24)`); `bubblePosition: 'center'` | live + forced-centre bubble | (measure) | (measure) | (measure) | (measure) |
| 7 | ConnectionsPage chat header (`useCoachMark(7, 0)`) | live | (measure) | (measure) | (measure) | (measure) |
| 8 | ProfilePage Account Settings row | synthetic via `scrollToKnownPosition` | (measure) | (measure) | (measure) | (measure) |
| 9 | ProfilePage Beta Feedback row | synthetic via `scrollToKnownPosition` | (measure) | (measure) | (measure) | (measure) |

**Auxiliary captures required at the moment of registration (one capture set is enough):**

| Quantity | Source | iOS | Android |
|---|---|---|---|
| `Dimensions.get('window').width / height` | `Dimensions` | (measure) | (measure) |
| `Dimensions.get('screen').width / height` | `Dimensions` | (measure) | (measure) |
| `useSafeAreaInsets()` (`top` / `bottom`) | safe-area-context | (measure) | (measure) |
| `StatusBar.currentHeight` | `react-native` `StatusBar` | n/a | (measure) |

**Disambiguation rule** (locks the mechanism in §5):
- If `Δ Android ≈ StatusBar.currentHeight` (≈24dp) consistently across all live steps → **RC-A**.
- If `Δ Android ≈ insets.top` (status bar + notch height — can be 28–48dp depending on device) → also **RC-A**, refine constant.
- If `Δ Android ≈ 2 × statusBarHeight` → **RC-C** (double-counting via `getLocationInWindow` returning window-frame coords while the painting parent already starts at the status-bar offset).
- If `Δ Android` matches no known constant → escalate; mechanism is unmodelled.
- If steps 1–7 (live path) show a delta of one constant and steps 8–9 (synthetic path) show a different delta → **two co-existing mechanisms**, fix the synthetic path with §5 RC-B in parallel with the live-path fix.

---

## 5. Findings

### 🔴 RC-A — Android `measureInWindow` returns window-frame coords; SpotlightOverlay paints in the same frame, but `Dimensions.get('window').height` may not include the status-bar zone (most likely)

**File + line:** [SpotlightOverlay.tsx:61](app-mobile/src/components/SpotlightOverlay.tsx#L61), [L241](app-mobile/src/components/SpotlightOverlay.tsx#L241), [L246-L255](app-mobile/src/components/SpotlightOverlay.tsx#L246-L255)
**Exact code:**
```tsx
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
…
<Svg width={screenWidth} height={screenHeight}>
  …
  <Rect x={cutout.x} y={cutout.y} width={cutout.width} height={cutout.height} … />
</Svg>
```
**What it does today:** The SVG is sized at `Dimensions.get('window').width × height`.
On Android with `edgeToEdgeEnabled: true` and `<StatusBar translucent>`, prior RN
versions and certain device builds report `Dimensions.get('window').height`
**excluding** the status-bar inset (~24dp), while `measureInWindow` returns target
Y in coordinates that **include** the status-bar inset. Result: the SVG mask is
~24dp shorter than the actual visible window, and the cutout's Y inside the SVG
maps to a point ~24dp lower on the physical screen than the actual target. iOS
keeps both measurements in the same frame and is unaffected.

**What it should do:** The SVG paint frame and the registered target frame must
share an origin. Either subtract the status-bar inset from registered Y, OR pad
the SVG frame upward to match `Dimensions.get('screen').height`, OR translate the
SpotlightOverlay's parent View to a known frame.

**Causal chain:** `<View ref={...}>` lays out → React Native Android bridge calls
`view.getLocationInWindow(int[2])` returning Y in application-window coordinates
that include the status-bar zone (because `edgeToEdgeEnabled: true`) → that Y is
stored in `targetMeasurements` → `<Rect y={cutout.y}>` inside the SVG paints a
hole that many points below the SVG's top edge → SVG's top edge does NOT align
with the application-window top edge (it aligns with the SpotlightOverlay parent
View's top, which on Android may be ~`statusBarHeight` below the window top
because of how the parent box resolves with edge-to-edge) → user sees the
cutout `statusBarHeight` below the actual target.

**Verification step:** Capture per-step measurements per §4. If deltas all equal
`StatusBar.currentHeight` (or `insets.top`) within a 1px tolerance, RC-A is the
mechanism.

### 🔴 RC-B — Synthetic-rect path for steps 8 & 9 assumes "scroll content starts at y=0", which is wrong on Android with edge-to-edge

**File + line:** [CoachMarkContext.tsx:226-246](app-mobile/src/contexts/CoachMarkContext.tsx#L226-L246)
**Exact code:**
```ts
// Place the target at 35% from the top of the screen
const desiredScreenY = screenHeight * 0.35;
const scrollY = Math.max(0, offset.contentY - desiredScreenY);

scrollRef.current.scrollTo?.({ y: scrollY, animated: true });

setTimeout(() => {
  // Profile page extends behind status bar — scroll content starts at y=0.
  // exactScreenY = contentY - scrollY (no insets offset needed)
  const exactScreenY = offset.contentY - scrollY;
  registerTarget(step, {
    x: offset.contentX,
    y: exactScreenY,
    …
  });
  …
});
```
**What it does today:** Uses the literal assumption "scroll content starts at y=0"
to compute target Y as `contentY - scrollY` — bypassing `measureInWindow` entirely.
**What it should do:** If RC-A is the mechanism for the live path, this synthetic
calculation is *correct* in its frame (it's already SpotlightOverlay-frame, not
window-frame). However, the SpotlightOverlay paints based on `(targetMeasurements,
SVG-frame)` — same SVG, same frame inconsistency. So even with the synthetic
calculation, if the SVG frame is wrong, steps 8 & 9 are equally misaligned.

**Causal chain:** Identical to RC-A from the SVG side; this finding documents that
the synthetic path does NOT compensate for the platform difference, so the same
fix must apply to both paths or steps 8 & 9 will still be off after RC-A is
patched.

**Verification step:** If §4 device measurement shows steps 8 & 9 have the same
Δ as steps 1–7, RC-B is confirmed as a parallel symptom of RC-A. If they diverge,
RC-B is an independent bug requiring a separate fix.

### 🟠 CF-1 — Root view tree has NO `<SafeAreaProvider>` wrapping; relies on expo-router's auto-injected one

**File + line:** [app/_layout.tsx:25-31](app-mobile/app/_layout.tsx#L25-L31), [app/index.tsx:2310-2326](app-mobile/app/index.tsx#L2310-L2326)
**Exact code:**
```tsx
// _layout.tsx
export default Sentry.wrap(function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
});
```
The only explicit `<SafeAreaProvider>` in the entire app-mobile/src tree is inside
[CountryPickerModal.tsx](app-mobile/src/components/onboarding/CountryPickerModal.tsx)
(verified via grep — 1 file, 3 occurrences, all leaf). expo-router 4.x auto-injects
a `SafeAreaProvider` at the screen level, so `useSafeAreaInsets()` does return
non-zero values on Android (this is necessary for the rest of the app's `insets.top`
math at e.g. [index.tsx:2338](app-mobile/app/index.tsx#L2338) to function at all).
However, the SafeAreaProvider's coordinate frame and the application window's
coordinate frame may not align exactly under edge-to-edge, which contributes to
RC-A.
**Why CF, not RC:** This is a configuration weakness that *enables* RC-A to occur;
removing it (by adding an explicit `<SafeAreaProvider>` at the root) does not by
itself fix the SVG-vs-measureInWindow frame mismatch. It is, however, a
worth-doing hardening even if the chosen fix is shape 1 in §6.

### 🟠 CF-2 — `<View style={styles.safeArea}>` is misnamed (it is a regular View, not a SafeAreaView)

**File + line:** [app/index.tsx:2320](app-mobile/app/index.tsx#L2320), [L2651-L2654](app-mobile/app/index.tsx#L2651-L2654)
```ts
safeArea: {
  flex: 1,
  backgroundColor: "#000000",
},
```
The name "safeArea" implies inset compensation; the implementation provides none.
This is a misleading name that contributed to the team not realising the spotlight
parent box stretches behind the status bar. Style guide / cleanup candidate.

### 🟠 CF-3 — `Dimensions.get('window')` is read once at component-mount time, not subscribed

**File + line:** [SpotlightOverlay.tsx:61](app-mobile/src/components/SpotlightOverlay.tsx#L61)
```ts
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
```
This line runs on every render of `SpotlightOverlay` (it's inside the component
body, so re-reads on each render), but does NOT subscribe to dimension changes via
`useWindowDimensions()`. On rotation or split-screen on Android the SVG could mis-paint.
Not the root cause of the offset bug, but a hardening candidate while we're in this code.

### 🟡 HF-1 — Step 3 has no `useCoachMark` callsite anywhere in the codebase

**Discovery:** Grepping the entire `app-mobile/src` tree for `useCoachMark(`
finds 6 callsites: `useCoachMark(1)`, `useCoachMark(2)`, `useCoachMark(4)`,
`useCoachMark(5)` in HomePage; `useCoachMark(6)` in DiscoverScreen;
`useCoachMark(7)` in ConnectionsPage. **There is NO `useCoachMark(3, …)` anywhere.**
Step 3 ("Where your saves live", tab: 'home') is defined in
[coachMarkSteps.ts:36-42](app-mobile/src/constants/coachMarkSteps.ts#L36-L42) but no
component attaches a target ref for it.
The dev-time warning at [useCoachMark.ts:55-67](app-mobile/src/hooks/useCoachMark.ts#L55-L67)
catches missing-target attachments per ID — but only for IDs that the hook is called
with. A step ID with NO callers gets no warning.
**Behaviour:** When step 3 becomes active, `targetMeasurements.get(3)` returns
undefined, `hasTarget` is false, `cutout` is null, and SpotlightOverlay falls
back to a centred bubble per [SpotlightOverlay.tsx:171-175](app-mobile/src/components/SpotlightOverlay.tsx#L171-L175).
**Why HF, not RC:** Centred bubble is not the user's complaint ("way off"
implies a misplaced cutout, not a centred bubble). But this is an orphan target
that should be either attached or removed.
**Note:** This may have been intentional — the step copy talks about "Likes"
which is a tab in `GlassBottomNav`, not a HomePage element. Likely the intent
was to attach to the Likes nav tab and was missed during the ORCH-0635 refresh.

### 🟡 HF-2 — Re-measure timer of 100ms on step activation may race the new screen's layout

**File + line:** [useCoachMark.ts:46-51](app-mobile/src/hooks/useCoachMark.ts#L46-L51)
```ts
useEffect(() => {
  if (isActive && nodeRef.current) {
    const timer = setTimeout(() => measure(), 100);
    return () => clearTimeout(timer);
  }
}, [isActive, measure]);
```
On Android, layout passes after a tab navigation can take longer than 100ms,
especially with new architecture and Fabric. If `measureInWindow` runs before
the new tab's layout commits, the returned coords are stale or zero. This is
NOT the cross-platform offset symptom (it would produce wrong coordinates on
both platforms), but it is a known reliability concern flagged for future work.

### 🟡 HF-3 — `BUBBLE_ENTRY_DURATION = 200` and `ENTRY_DELAY = 1500` are hardcoded; no consideration for Android animation frame timing

**File + line:** [SpotlightOverlay.tsx:32-35](app-mobile/src/components/SpotlightOverlay.tsx#L32-L35)
Cosmetic, not the bug. Logged for completeness.

### 🔵 OBS-1 — `getLocationInWindow` is the underlying Android API for `measureInWindow`

The React Native Android bridge implements `measureInWindow` via
`view.getLocationInWindow(int[2])`. This API has known platform-specific behaviour
under edge-to-edge — see the React Native GitHub discussion threads (multiple
issues filed since 0.71). Documenting this for future-investigator context,
not as a finding.

### 🔵 OBS-2 — `react-native-safe-area-context 5.6.0` ships a Fabric-aware build

The project is on the new arch, so the `useSafeAreaInsets` values are produced
by the Fabric-aware path. No defect identified, but worth noting that the team
is on the most recent SAC release that handles edge-to-edge insets correctly —
fixes here can rely on `insets.top` returning the right value.

### 🔵 OBS-3 — The team already conditionalises layout on `Platform.OS === 'android'` for nav inset compensation

[app/index.tsx:109](app-mobile/app/index.tsx#L109)
```ts
const navBottom = Platform.OS === 'android' ? layout.insets.bottom + 6 : 11;
```
And [L2339](app-mobile/app/index.tsx#L2339) similarly conditions paddingBottom on
Android. Pattern precedent exists in the codebase for Android-specific layout
compensation. The fix in §6 follows the same pattern at the spotlight layer.

### 🔵 OBS-4 — There is a 1500ms `ENTRY_DELAY` before the very first overlay appearance

[SpotlightOverlay.tsx:32](app-mobile/src/components/SpotlightOverlay.tsx#L32) +
[L77-L80](app-mobile/src/components/SpotlightOverlay.tsx#L77-L80). On the user's
first encounter of the tour, the dark scrim fades in 1.5s after the home tab
mounts. This is expected behaviour from ORCH-0635; not a defect. Mentioned for
the device tester so they know to wait before capturing measurements.

---

## 6. Five-truth-layer verdict

| Layer | Says |
|-------|------|
| **Docs** | ORCH-0635 spec defines 9 steps + bubble positioning rules. Says nothing about platform-specific coordinate handling. |
| **Schema** | `profiles.coach_mark_step` integer column. Not relevant to coordinates. |
| **Code** | `measureInWindow` registers `(x, y)` in window-frame; SVG paints in component-frame; on Android these frames may not coincide under edge-to-edge. |
| **Runtime** | UNVERIFIED — exact deltas require device measurement (§4). |
| **Data** | `targetMeasurements` map values not inspected at runtime; logging exists at SpotlightOverlay.tsx:144-146 (`__DEV__` guard) — capture this in §4. |

**The contradiction is between Code and Runtime: code assumes the two frames align,
runtime (on Android only) shows they do not.** Docs and Schema are silent and
non-contradictory.

---

## 7. Blast radius

**In scope (Android-only positioning bugs):**

- All 9 coach mark steps (live path: 1, 2, 4, 5, 6, 7; synthetic: 8, 9; orphan: 3)
- Bubble positioning math at [SpotlightOverlay.tsx:171-214](app-mobile/src/components/SpotlightOverlay.tsx#L171-L214) — depends on `target.x/y` so is also affected
- Arrow positioning at [SpotlightOverlay.tsx:283-303](app-mobile/src/components/SpotlightOverlay.tsx#L283-L303) — same dependency

**Probably NOT affected (different coordinate-resolution paths):**

- Other absolute overlays in the app — sweep recommended once the fix is locked.
  Quick grep targets: `Modal`, `position: 'absolute'` paired with
  `Dimensions.get('window')` use. Investigation deferred per scope discipline.
- `MapBox/MapLibre` overlays — use their own coordinate system, not affected.

**Discoveries for orchestrator (D-list):**

- **D-1** (S2, ux): Step 3 ("Where your saves live") has no `useCoachMark`
  callsite anywhere — see HF-1. The intended target is most likely the Likes
  tab in `GlassBottomNav`. Standalone fix candidate; do NOT bundle into ORCH-0688
  unless device measurement reveals step 3 is fine in centered-fallback (then
  bundle as a tiny ride-along).
- **D-2** (S3, naming): `<View style={styles.safeArea}>` at index.tsx:2320 is
  not actually a `SafeAreaView`. Rename to `rootView` or wrap in real
  `SafeAreaView` from `react-native-safe-area-context` for clarity. Not blocking.
- **D-3** (S3, hardening): No explicit `<SafeAreaProvider>` at the React tree
  root — relies on expo-router auto-injection (CF-1). Adding an explicit one in
  `_layout.tsx` is a 2-line hardening that future-proofs against expo-router
  behaviour changes.
- **D-4** (S3, hardening): `Dimensions.get('window')` should be `useWindowDimensions()`
  in SpotlightOverlay (CF-3). Survives rotation / split-screen.
- **D-5** (process, S3): The ORCH-0635 design refresh shipped without an
  explicit Android-vs-iOS positioning verification gate. Recommend adding
  "platform-parity smoke" to the spec template for any UI-positioning ORCH so
  this class of bug is caught at the spec or test stage.

---

## 8. Why iOS doesn't reproduce

On iOS, both `measureInWindow` and the React root view start at y=0 of the
keyWindow. The keyWindow's coordinate system origin is at the absolute top of
the screen (above the status bar). Any view inside the React tree resolves its
y in the same frame the SVG paints into. The SVG's y=0 is the view tree's y=0
is the keyWindow's y=0. There is no frame mismatch to introduce a delta.

iOS does not have an "edge-to-edge" toggle the way Android does — the system
is always edge-to-edge. So the entire stack is calibrated for one
coordinate-frame; nothing to mis-align.

---

## 9. Fix-shape recommendations (NOT a spec)

Three candidate shapes, ordered by surgical-narrowness ascending. Spec writer
selects after confirming RC-A vs RC-C with §4 device measurements.

### Shape 1 — **Subtract `StatusBar.currentHeight` (or `insets.top`) from the registered Y at the measurement source** (recommended)

**Where:** [useCoachMark.ts:32-35](app-mobile/src/hooks/useCoachMark.ts#L32-L35)

**Sketch (illustrative — implementor will spec exact constant after device measurement):**
```ts
import { Platform, StatusBar } from 'react-native';
…
node.measureInWindow((x: number, y: number, width: number, height: number) => {
  if (width === 0 && height === 0) return;
  const yOffset =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
  registerTarget(stepId, { x, y: y - yOffset, width, height, radius: targetRadius });
});
```
For the synthetic path (RC-B), apply the same correction inside
[CoachMarkContext.tsx:233-243](app-mobile/src/contexts/CoachMarkContext.tsx#L233-L243).

**Pros:**
- 1–3 lines per file
- iOS branch is a literal no-op (zero risk of regressing the working platform)
- Single source of truth — every consumer of `targetMeasurements` automatically gets the right Y
- Pattern consistent with existing Android-conditional layout in the codebase (OBS-3)

**Cons:**
- Requires choosing the correct constant (`StatusBar.currentHeight` vs `insets.top`)
   — this is exactly what §4 device measurement disambiguates
- If the actual delta is `2 × statusBarHeight` (RC-C), this shape under-corrects
  and a different mechanism is at play — but device measurement reveals that

**Risk:** LOW. iOS untouched. Android delta-correction is additive and reversible.

**Effort:** ~30 minutes implementor + 30 minutes device tester.

### Shape 2 — **Translate the SVG / overlay paint frame in SpotlightOverlay**

**Where:** [SpotlightOverlay.tsx:217-280](app-mobile/src/components/SpotlightOverlay.tsx#L217-L280)

**Sketch:**
- Wrap the inner Animated.View / SVG in a translateY of `+statusBarHeight` on
  Android, OR compute the SVG's `<Rect y>` as `cutout.y - statusBarHeight` on Android.
- Bubble positioning math at L171-L214 must also be translated to keep the
  bubble anchored.

**Pros:** Fixes the painting side, leaves measurement source unchanged.
**Cons:**
- More invasive; touches both mask and bubble math
- Risk of double-correcting if the actual problem is at the measurement layer
- Bubble positioning becomes harder to reason about

**Risk:** MEDIUM. More surface area touched.
**Effort:** ~1 hour implementor + 30 minutes tester.

### Shape 3 — **Use `measureLayout` against a known root ref** (most robust, most code)

**Where:** Refactor of `useCoachMark.ts` + provide a root `ref` from
`SpotlightOverlay`'s parent through `CoachMarkContext`.

**Sketch:**
```ts
// CoachMarkContext exposes rootRef
node.measureLayout(rootHandle, (x, y, w, h) => {
  registerTarget(stepId, { x, y, width: w, height: h, radius });
});
```
Returns coordinates **relative to the SpotlightOverlay's root**, regardless of
how the window frame relates to the application area on either platform.

**Pros:** Platform-agnostic by construction. No magic constants. Robust to
edge-to-edge changes, foldables, split-screen.
**Cons:**
- More code change (plumbing rootRef through context)
- `measureLayout` requires `findNodeHandle` calls; deprecated in some sense
  but still functional
- Slightly larger blast radius — affects every step's measurement path
**Risk:** MEDIUM. Bigger refactor.
**Effort:** ~3 hours implementor + 1 hour tester.

### Recommendation

**Adopt Shape 1.** Lowest blast radius, follows existing platform-conditional
pattern in the codebase, iOS branch is provably a no-op. The §4 device
measurement is what pins the constant — and the constant is the only ambiguity.
If the device measurement shows `Δ ≈ 2 × statusBarHeight`, escalate to Shape 2
or 3 (RC-C territory) — but do not pre-engineer for that case.

Bundle-or-defer for ride-alongs:
- HF-1 (step 3 orphan target) — defer (D-1 in §7)
- CF-1, CF-2, CF-3 — defer (D-2, D-3, D-4 in §7)
- HF-2 (re-measure 100ms race) — defer to a separate ORCH if ever observed

---

## 10. Open questions for orchestrator (must resolve before spec)

| # | Question | Why it matters |
|---|---|---|
| Q1 | Can a real Android device + a real iPhone be allocated for §4 measurements? | Without it, the spec must commit to a constant on guess. Recommend HARD GATE — do not write spec until §4 numbers are in. |
| Q2 | If §4 reveals deltas are split (live path has one Δ, synthetic path has different Δ), do we ship one combined spec or two? | One spec preferred (single mental model for reviewer); flag as a sub-section. |
| Q3 | Bundle D-1 (step 3 orphan target attachment)? | Only if §4 shows step 3 is fine in centred fallback. Otherwise it's a separate UX decision (where SHOULD step 3 point?). |
| Q4 | Test surface — should the spec require an explicit Android vs iOS smoke matrix as a closure gate (per D-5)? | Strongly recommend yes. This bug class is cheap to catch with a single device per platform. |

---

## 11. Confidence & next step

| Aspect | Confidence | What would raise it |
|---|---|---|
| Configuration root cause (edge-to-edge + translucent + no padTop on parent box) | **HIGH** | Already proven from app.json + index.tsx static reads |
| Mechanism RC-A (window-frame mismatch via `Dimensions.get('window').height` shorter than physical screen) | **MEDIUM-HIGH** | §4 device measurement (deltas matching `StatusBar.currentHeight`) collapses to HIGH |
| Mechanism RC-C (double-counting) is an alternative | **LOW (alternative hypothesis)** | §4 device measurement (deltas matching `2 × statusBarHeight`) would shift confidence to RC-C |
| Recommended fix shape (Shape 1 — subtract at source) | **HIGH** | Independent of which mechanism wins, this fix shape works for any constant Δ |

**Single concrete next step:** Allocate one Android device + one iPhone, run the
app to each coach step, capture the measurement matrix in §4, and report numbers
back to orchestrator. The investigation is complete on every axis EXCEPT this
device-only step.

End of investigation.
