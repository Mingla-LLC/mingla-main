# IMPLEMENTATION — ORCH-0995 [Android-wide UI jank + tab-navigation animation lag — iOS-fluidity parity]

- **Date:** 2026-05-29
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-0995-[android-nav-jank]/` on branch `ORCH-0995-android-nav-jank` (from main `2a30c8edc`)
- **Status:** implemented and verified (automated) · runtime perceptual smoothness pending Seth on a mid-tier device
- **Investigation read:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0995_AND_0996_APP_PERFORMANCE.md` (ORCH-0995 section, Root Cause A)
- **Comms ledger:** read on entry; no OPEN entry targets ORCH-0995 / this skill. No new cross-ORCH discovery to write.

---

## Outcome

The tab "spotlight" pill in the consumer-app bottom nav now animates **entirely on the UI thread** via `react-native-reanimated` shared values, instead of the old `Animated.spring(..., { useNativeDriver: false })` that ran every frame on the JS thread. On mid-tier Android the JS thread can't sustain 60fps during a tab switch while also rendering the incoming screen, so the old approach dropped frames → the lag Seth felt. The new approach removes the JS thread from the per-frame loop entirely. Resting geometry, the reduce-motion path, the first-mount layout-tick re-run, and the spring feel are all preserved pixel-for-pixel.

This is **OTA-deliverable**: `react-native-reanimated@4.1.5` + `react-native-worklets@0.5.1` are already in the native binary (`package.json` line 137; `app-mobile/babel.config.js` has `react-native-worklets/plugin`), and the component is already used elsewhere (PopularityIndicators, Toast, ConfidenceScore, SwipeableMessage, DoubleTapHeart). **No new native dependency added.**

---

## Files changed

| File | Commit | Lines |
|---|---|---|
| `app-mobile/src/components/GlassBottomNav.tsx` | `<see below>` | +34 / -33 |
| `app-mobile/src/components/__tests__/orch-0995-bottom-nav-spotlight-ui-thread.test.tsx` | `<see below>` | new file |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0995_ANDROID_NAV_FLUIDITY.md` | `<see below>` | new file |

Commit hash recorded in the chat summary / git log after commit.

---

## Old → New Receipt

### `app-mobile/src/components/GlassBottomNav.tsx`

**What it did before:**
- Imported `Animated`, `Easing`, `useMemo`, `useWindowDimensions` from `react-native` (the last three were unused dead imports).
- `spotlightX` / `spotlightWidth` were RN `Animated.Value`s (`useRef(new Animated.Value(0)).current`).
- On tab switch the effect ran `Animated.parallel([Animated.spring(spotlightX,…), Animated.spring(spotlightWidth,…)])` with **`useNativeDriver: false`** on both. `left` and `width` are not native-drivable layout props, so every frame of the spring was computed in JavaScript and shipped over the bridge → JS-thread-bound layout animation → dropped frames on mid-tier Android.
- The spotlight `<Animated.View>` consumed the values inline as `{ left: spotlightX, width: spotlightWidth }`.

**What it does now:**
- Imports `Animated, { useSharedValue, useAnimatedStyle, withSpring }` from `react-native-reanimated`. Removed the three unused `react-native` imports (`useMemo`, `Easing`, `useWindowDimensions`) — subtract-before-add.
- `spotlightX` / `spotlightWidth` are Reanimated `useSharedValue(0)` (UI-thread state).
- On tab switch the effect sets `spotlightX.value = withSpring(targetX, springConfig)` and `spotlightWidth.value = withSpring(targetWidth, springConfig)`. Reanimated drives `left` + `width` on the **UI thread** — it is NOT subject to the RN-Animated native-driver limitation for layout props, so the JS thread is out of the per-frame loop.
- A `useAnimatedStyle(() => ({ left: spotlightX.value, width: spotlightWidth.value }))` worklet feeds the spotlight `<Animated.View style={[styles.spotlight, spotlightAnimatedStyle]}>`.
- **reduceMotion branch preserved**: instant set (`spotlightX.value = targetX; spotlightWidth.value = targetWidth;`), no spring.
- **layoutTick branch preserved**: identical dep array `[currentPage, layoutTick, reduceMotion, spotlightX, spotlightWidth]` so the effect re-runs when `onLayout` fires on first mount.
- **Resting geometry pixel-identical**: `targetX = layout.x + c.nav.spotlightInset`, `targetWidth = layout.width - c.nav.spotlightInset * 2` — unchanged. Same `spotlightInset` (0), same `spotlightRadius` (32), same `styles.spotlight`. Animating true `left`/`width` (not `scaleX`) means **no corner-radius distortion** — preferred path per the contract.
- **Spring feel preserved**: `withSpring` config maps the designSystem motion tokens 1:1 — `damping: c.motion.springDamping` (18), `stiffness: c.motion.springStiffness` (260), `mass: c.motion.springMass` (0.9). Reanimated's spring uses the same damping/stiffness/mass physical model as RN Animated's spring.

**Why:** ORCH-0995 Root Cause A — JS-thread-driven layout animation on tab switch. Contract clause 1 (animate off the JS thread), clause 2 (pixel-identical resting geometry), clause 3 (preserve reduceMotion + layoutTick + spring feel), clause 4 (no new native dep, OTA-deliverable).

**Lines changed:** ~34 changed / 33 removed.

### `app-mobile/src/components/__tests__/orch-0995-bottom-nav-spotlight-ui-thread.test.tsx` (new)

Source-static-analysis regression test (the repo convention for component tests — mirrors `orch-0945-dead-end-render.test.tsx`: standalone `node:assert` script, `require.main === module` runner). Asserts:
- **T-01 [fails-on-revert key]**: no `useNativeDriver: false` anywhere in the file.
- **T-02 / T-02b**: no RN `Animated.spring(` / `Animated.parallel(` (the old JS-thread path).
- **T-03**: imports from `react-native-reanimated` + uses `useSharedValue`, `useAnimatedStyle`, `withSpring`.
- **T-04**: resting geometry math preserved — `targetX = layout.x + c.nav.spotlightInset`, `targetWidth = layout.width - c.nav.spotlightInset * 2`, and the animated style drives `left`/`width` (not scaleX).
- **T-05**: spring feel — `withSpring` damping/stiffness/mass come from `c.motion.spring*`.
- **T-06**: reduceMotion branch instant-sets the shared values and does NOT call `withSpring`.
- **T-07**: effect dep array still includes `layoutTick`.

---

## Regression Test

- **Path:** `app-mobile/src/components/__tests__/orch-0995-bottom-nav-spotlight-ui-thread.test.tsx`
- **Run command:** `cd app-mobile && node src/components/__tests__/orch-0995-bottom-nav-spotlight-ui-thread.test.tsx`
- **Passing-run output (on the fix):**
  ```
  PASS T-01..T-07 ORCH-0995 bottom-nav spotlight animates on UI thread with pixel-identical resting geometry + preserved reduceMotion/layoutTick paths
  ```
- **fails-on-revert verified at `2a30c8edcfa11607b5cbf6140b86b6bc36db5db0`** (HEAD before fix). Procedure: `git stash push -- app-mobile/src/components/GlassBottomNav.tsx` (restores the old JS-thread `useNativeDriver: false` code, keeps the test), re-ran the test → **FAILED at T-01** (`AssertionError: T-01 spotlight must NOT use any 'useNativeDriver: false' animation`). `git stash pop` restored the fix → test PASSES again. Proven the test exercises the actual bug, not a tautology.

---

## Verification Matrix

| Clause | How verified | Result |
|---|---|---|
| 1. Spotlight animates off the JS thread | Converted to Reanimated shared values + `useAnimatedStyle` worklet; `react-native-worklets/plugin` confirmed in babel.config.js (transforms worklet to UI thread); full Android bundle export succeeded (worklet transform would fail the export otherwise). | PASS |
| 2. Resting geometry pixel-identical | `targetX`/`targetWidth` math byte-unchanged; same `spotlightInset`/`spotlightRadius`/`styles.spotlight`; animates true `left`/`width` (no scaleX distortion). T-04 asserts. | PASS |
| 3a. reduceMotion path preserved | Instant `.value` set, no spring. T-06 asserts. | PASS |
| 3b. layoutTick first-mount re-run preserved | Dep array unchanged. T-07 asserts. | PASS |
| 3c. Spring feel preserved | `withSpring` damping/stiffness/mass = designSystem tokens (18/260/0.9). T-05 asserts. | PASS |
| 4. No new native dependency / OTA-deliverable | reanimated 4.1.5 + worklets 0.5.1 already resolved in node_modules + already in native binary + babel plugin present. Zero package.json change. | PASS |
| tsc clean (touched file) | `npx tsc --noEmit` → exit 0, no GlassBottomNav / orch-0995 errors. | PASS |
| lint clean (touched file) | `npx expo lint` → no NEW warnings/errors on GlassBottomNav.tsx. (`require()` warnings on the test file match the existing orch-0945 test convention; `TabConfig` unused warning is pre-existing in original, out of scope.) | PASS |
| Bundle compiles through worklets transform | `npx expo export --platform android` → succeeded, 16.7 MB Hermes bundle, no errors. | PASS |
| Runtime perceptual smoothness on mid-tier Android | NOT auto-verifiable (perceptual). A physical Samsung Galaxy A72 (SM-A725F, mid-tier) with `com.mingla.app.v2` dev client is attached — ideal for Seth to eyeball. | UNVERIFIED — needs Seth device eyeball |

---

## Cross-Surface Impact

- **Consumer iOS** (affected, automatic parity): same `GlassBottomNav.tsx` code path; spotlight now Reanimated on iOS too. iOS was already smooth (fast JS thread); this keeps it smooth and removes bridge traffic. File: `app-mobile/src/components/GlassBottomNav.tsx`.
- **Consumer Android** (affected, automatic parity): the primary win — UI-thread animation eliminates the felt tab-switch lag. Same file.
- **Buyer/anon Web, Business iOS, Business Android, Admin Web, Business Web preview**: NOT affected — `GlassBottomNav` is consumer-app-only chrome; none of those surfaces render it.

Parity is automatic (single shared component, no platform-forked code).

---

## Invariant / Constitutional Check

- No invariant in `references/invariant-checklist.md` governs the bottom-nav animation mechanism. No DB / RLS / edge / query-key / Zustand boundary touched.
- Constitution: state handling unchanged (no async states added); no silent failures introduced; StyleSheet-only styling preserved; copy untouched; accessibility (`accessibilityRole`/`accessibilityState`/labels) untouched. PASS / N/A across all 14.

---

## Parity / Cache / Regression Surface

- **Parity (solo/collab):** N/A — bottom nav is global chrome, not deck-mode-specific.
- **Cache:** no query keys touched.
- **Regression surface (for tester):** (1) tab-switch spotlight lands at correct x/width on all 5 tabs; (2) first-mount spotlight positions correctly (layoutTick path) — no x:0/width:0 flash; (3) reduce-motion ON → spotlight jumps instantly, no animation; (4) spotlight corner radius not distorted mid-animation; (5) rapid tab tapping doesn't strand the spotlight.

---

## Secondary (blur) — report only, NO change made

Per contract, no blur/visual treatment was changed. The investigation's Root Cause B (persistent Android `dimezisBlurView` surfaces) remains in place at `GlassBottomNav.tsx` L1 BlurView and elsewhere. No profiling was performed to attribute residual jank to blur after this fix (would require a native dev build + frame trace on a mid-tier device). If Seth still feels tab-switch jank after this ships, the next lever is the Android blur cost — but that is a product/visual decision and a separate ORCH, not changed here.

---

## Discoveries for Orchestrator

- `TabConfig` type (GlassBottomNav.tsx line ~47) is defined but never used — pre-existing dead code, lint warning, NOT introduced by this ORCH. Left untouched (out of scope). Flag for a future cleanup sweep if desired.
- Runtime perceptual smoothness is the one criterion that can't be machine-verified. A mid-tier physical device (SM-A725F) with the consumer dev client is attached and is the correct target for Seth's eyeball confirmation.
