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
| `app-mobile/src/components/GlassBottomNav.tsx` | `b91770195` | +34 / -33 |
| `app-mobile/src/components/__tests__/orch-0995-bottom-nav-spotlight-ui-thread.test.tsx` | `b91770195` | new file |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0995_ANDROID_NAV_FLUIDITY.md` | `b91770195` | new file |

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

---

# IMPLEMENT-2 — instant tab-tap feedback (optimistic nav + deferred mount)

- **Date:** 2026-05-29
- **Builds on:** IMPLEMENT-1 spotlight UI-thread fix (`b91770195`) + hash-record commit (`22ad396ae`).
- **Commit:** the single IMPLEMENT-2 commit on branch `ORCH-0995-android-nav-jank` whose parent is `22ad396ae` (the IMPLEMENT-1 hash-record commit). The exact hash is reported in the chat handoff and is the current branch HEAD; it is omitted here to avoid a self-referential amend loop (a report that records its own commit hash changes the hash on every edit).
- **Status:** implemented and verified (automated tsc + lint + regression test with fails-on-revert) · runtime perceptual confirmation pending Seth on the attached mid-tier device.

## Operator feedback that triggered this
After IMPLEMENT-1 (spotlight off the JS thread), tab-switching was "much better but still a noticeable lag between tapping a tab and seeing the effect."

## Proven root cause
The bottom-nav highlight was **hostage to the destination screen's mount**. Flow before: tap → `GlassBottomNav` `onNavigate(key)` → parent `app/index.tsx` onNavigate (`closeProfileOverlays()` + `setCurrentPage(page)`) → `AppContent` re-renders → the `switch(currentPage)` IIFE **unmounts the old screen and mounts the new heavy screen SYNCHRONOUSLY on the JS thread** → only after that commit does `GlassBottomNav` receive the new `currentPage` prop and move the spotlight + active icon. So the tap feedback (highlight) was blocked behind the heavy mount. `currentPage`/`setCurrentPage` is plain React `useState` (`AppStateManager.tsx:124`), so React transitions apply to it.

## The fix — two parts

### PART A — `GlassBottomNav.tsx` optimistic selection (instant tap feedback, decoupled from mount)
Added local optimistic state so the highlight responds on the tap frame regardless of when `currentPage` catches up:
- `const [pendingPage, setPendingPage] = useState<BottomNavPage | null>(null);`
- `const displayPage = pendingPage ?? currentPage;`
- Reconcile: `useEffect(() => { setPendingPage(null); }, [currentPage]);` — clears the optimistic lead whenever the REAL `currentPage` commits (the tapped page OR a programmatic page via deep-link/notification). This guarantees the optimistic state can never desync from the source of truth.
- The spotlight `useEffect` now looks up `tabLayoutsRef.current[displayPage]` and its dep array is `[displayPage, layoutTick, reduceMotion, spotlightX, spotlightWidth]`.
- The `active` flag is now `key === displayPage`, which already feeds the icon color, the active/inactive label style, AND `accessibilityState.selected` (all three derive from `active`).
- `reduceMotion` instant-set path and the `layoutTick` re-run are **unchanged** (still in the same effect; reduceMotion still instant-sets, layoutTick still in deps).

**onPress — exact before/after:**

Before:
```tsx
onPress={() => {
  if (active) return;
  if (Platform.OS === 'ios') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }
  onNavigate(key);
}}
```
After:
```tsx
onPress={() => {
  // Guard against re-tapping the already-selected tab (optimistic-aware).
  if (key === displayPage) return;
  if (Platform.OS === 'ios') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }
  // ORCH-0995 IMPLEMENT-2: set optimistic selection FIRST so the
  // spotlight + active styling move on the tap frame, then trigger the
  // (heavier) navigation. The reconcile effect clears pendingPage once
  // currentPage catches up.
  setPendingPage(key);
  onNavigate(key);
}}
```
The guard switched from the stale `active` closure to `key === displayPage` so an in-flight optimistic tap isn't re-fired. iOS haptic preserved in place.

### PART B — `app/index.tsx` onNavigate: defer the heavy mount via `React.startTransition`
`React` is already imported (`import React, { ... } from "react"`), React 19.1.0 — `startTransition` is a named React export and concurrent features are live (New Architecture/Fabric).

Before:
```tsx
onNavigate={(page: BottomNavPage) => {
  logger.action(`Tab pressed: ${page}`);
  closeProfileOverlays();
  setCurrentPage(page);
}}
```
After:
```tsx
onNavigate={(page: BottomNavPage) => {
  logger.action(`Tab pressed: ${page}`);
  // closeProfileOverlays() stays URGENT (commits synchronously).
  closeProfileOverlays();
  // ORCH-0995 IMPLEMENT-2: de-prioritize the heavy screen mount so the
  // urgent optimistic nav highlight + spotlight animation commit first.
  React.startTransition(() => {
    setCurrentPage(page);
  });
}}
```
`closeProfileOverlays()` stays outside the transition (urgent — overlay must be gone before the new screen paints). Only `setCurrentPage(page)` — which drives the `switch(currentPage)` IIFE mount — is deferred/interruptible. **No pending spinner** added; the optimistic nav state IS the feedback. The mount structure is untouched (still single active tab via the IIFE).

## Optimistic-state mechanism (why it can't desync)
`displayPage = pendingPage ?? currentPage` means the optimistic page only ever *leads* the real page. The `[currentPage]` reconcile effect fires on EVERY `currentPage` commit — whether from the tap's deferred `setCurrentPage`, OR from any programmatic caller (deep links / push notification at `app/index.tsx` lines ~455/469/764/1008+/2039, e.g. a notification that switches to `'connections'` with no tab tapped). In the no-tap case `pendingPage` is already `null`, so `displayPage === currentPage` and the highlight follows the programmatic nav immediately. In the tap case, once the deferred `setCurrentPage` commits, the effect clears `pendingPage` and `displayPage` falls back to the now-correct `currentPage`. If a programmatic nav lands on a DIFFERENT page than an in-flight optimistic tap, the reconcile still clears `pendingPage` and `displayPage` follows the authoritative `currentPage` — the highlight can never strand on a stale optimistic page.

## Files changed (IMPLEMENT-2)
| File | Lines | What |
|---|---|---|
| `app-mobile/src/components/GlassBottomNav.tsx` | +~24 / -3 | optimistic `pendingPage` + `displayPage`, reconcile effect, effect/active/onPress driven by `displayPage` |
| `app-mobile/app/index.tsx` | +~12 / -1 | tab `onNavigate` wraps `setCurrentPage(page)` in `React.startTransition`; `closeProfileOverlays()` stays urgent |
| `app-mobile/src/components/__tests__/orch-0995-impl2-optimistic-tab-feedback.test.tsx` | new | behavioral + source-wiring regression test |
| `app-mobile/src/components/__tests__/orch-0995-bottom-nav-spotlight-ui-thread.test.tsx` | T-07 updated | dep-array assertion repointed `currentPage` → `displayPage` (`[TEST-MOD-APPROVED ORCH-0995]`) |

## Regression Test (IMPLEMENT-2)
- **Path:** `app-mobile/src/components/__tests__/orch-0995-impl2-optimistic-tab-feedback.test.tsx`
- **Run:** `cd app-mobile && node src/components/__tests__/orch-0995-impl2-optimistic-tab-feedback.test.tsx`
- **Passing output:** `PASS T-08..T-18 ORCH-0995 IMPLEMENT-2 optimistic tab-tap feedback ...`
- **Coverage:** T-08 press sets optimistic `displayPage` to the pressed key BEFORE `currentPage` changes; T-09 reconcile clears the optimistic state once `currentPage` commits to the tapped page; T-10 a programmatic `currentPage` change (deep-link/notification, no tap) is reflected by `displayPage`; T-11 an optimistic lead that diverges from a programmatic `currentPage` change is cleared (no desync); T-12 re-tapping the active tab is a no-op; T-13..T-18 static source-wiring keys binding the test to the real `GlassBottomNav.tsx` + `app/index.tsx` (these are the fails-on-revert keys).
- **fails-on-revert verified at `22ad396aee5b4f2376d6e11e27dd8cee14e7a8f2`** (HEAD before IMPLEMENT-2): reverted both source files to HEAD (keeping the test), re-ran → **FAILED at T-13** (`T-13 GlassBottomNav must declare optimistic 'pendingPage' state`). Restored the fix → **PASSES** again. The IMPLEMENT-1 test also re-passes (T-07 now asserts the `displayPage` dep array).

## Verification Matrix (IMPLEMENT-2)
| Criterion | How verified | Result |
|---|---|---|
| Tapping a tab moves the highlight on the tap frame (optimistic `displayPage`) | onPress sets `setPendingPage(key)` before `onNavigate`; spotlight effect + active flag read `displayPage`; T-08 + T-16 + T-17 assert. | PASS |
| Heavy screen mount no longer blocks the feedback | `setCurrentPage(page)` wrapped in `React.startTransition`; `closeProfileOverlays()` stays urgent; T-18 asserts. | PASS |
| Only the active tab still mounts | `switch(currentPage)` IIFE untouched; `check-active-tab-only.sh` → `I-ONLY-ACTIVE-TAB-MOUNTED: PASS`. | PASS |
| All programmatic nav paths still drive the highlight | `[currentPage]` reconcile effect clears `pendingPage` on every commit; T-10 + T-11 assert deep-link/notification semantics. | PASS |
| reduceMotion + layoutTick preserved | reduceMotion instant-set branch and `layoutTick` in deps unchanged; IMPLEMENT-1 T-06/T-07 still pass. | PASS |
| No new native dependency (OTA-safe) | `React.startTransition` is built into React 19.1.0; `pendingPage` is plain `useState`. Zero package.json change. | PASS |
| tsc clean (touched files) | `npx tsc --noEmit` → 0 errors referencing `GlassBottomNav.tsx` / `app/index.tsx`; pre-existing unrelated errors only. | PASS |
| lint clean (touched files) | `npx eslint app/index.tsx src/components/GlassBottomNav.tsx` → 0 errors; only pre-existing warnings (`TabConfig` unused; app/index unused-vars/exhaustive-deps), none on changed lines. | PASS |
| Runtime perceptual confirmation | Perceptual — not machine-verifiable. Physical SM-A725F mid-tier attached for Seth's eyeball. | UNVERIFIED — needs Seth device eyeball |

## Scope guards honored
- Did NOT reintroduce `tabVisible`/`tabHidden` or the all-mounted pattern; CI gate passes.
- `switch(currentPage)` IIFE mount structure untouched — only WHEN `setCurrentPage` commits changed.
- Spotlight resting geometry pixel-identical (animates `left`+`width` via existing Reanimated shared values, no scaleX); reduceMotion + layoutTick preserved.
- No new native dependency. Scope limited to `GlassBottomNav.tsx` + the onNavigate handler in `app/index.tsx` + tests. Did NOT touch DiscoverScreen / ORCH-0996.
