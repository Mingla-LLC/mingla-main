# SPEC — ORCH-0688: Fix Android coach mark spotlight offset

**Status:** READY FOR IMPLEMENTOR
**Severity:** S1-high (every Android first-run user; Constitution #1 risk)
**Platform scope:** Android only (iOS branch must remain a literal no-op)
**Investigation:** [reports/INVESTIGATION_ORCH-0688_COACH_MARK_ANDROID_OFFSET.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0688_COACH_MARK_ANDROID_OFFSET.md)
**Dispatch:** [prompts/SPEC_ORCH-0688_COACH_MARK_ANDROID_OFFSET.md](Mingla_Artifacts/prompts/SPEC_ORCH-0688_COACH_MARK_ANDROID_OFFSET.md)
**Mobile-only.** No DB. No edge function. No native build. **OTA-eligible.**

---

## 1. Pre-bound decisions (LOCKED — implementor does NOT re-open)

| Decision | Locked value | Source |
|---|---|---|
| D-FIX-1: direction of correction | **ADD** to registered Y on Android (NOT subtract) | Founder Samsung Galaxy screenshots: step 2 cutout sits ON system clock; step 4 cutout sits at very top of screen on a status-bar icon — both prove cutout is rendered too high; the correction must push the cutout DOWN |
| D-FIX-2: magnitude / constant | **`StatusBar.currentHeight ?? 0`** (Option A from dispatch §3) | Static module constant; no React hook re-render concern in `useCoachMark`'s callback; founder Samsung One UI delta = 24dp matches `StatusBar.currentHeight` |
| D-FIX-3: platform conditional | `Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0` | iOS branch is a literal no-op (zero risk of regressing the working platform) |
| D-FIX-4: paths to correct | TWO: live `measureInWindow` path AND synthetic `scrollToKnownPosition` path | Both feed the same `targetMeasurements` map consumed by SpotlightOverlay's SVG mask; both must produce coords in the same frame |
| D-FIX-5: D-3 SafeAreaProvider | **NO ACTION NEEDED** — verified expo-router 6.0.23 auto-injects `<SafeAreaProvider>` at [ExpoRoot.js:77-83](app-mobile/node_modules/expo-router/build/ExpoRoot.js#L77-L83) with `initialMetrics={INITIAL_METRICS}` | Spec dispatch §2 made D-3 conditional on this verification; verification done in spec phase 1 |
| D-FIX-6: D-2 cosmetic rename | **IN-SCOPE** — rename `styles.safeArea` → `styles.rootView` in `app/index.tsx` | Misleading name (the View is not a SafeAreaView); style key has 1 consumer (the inline `style={styles.safeArea}` at L2320) |
| D-FIX-7: D-4 hardening | **IN-SCOPE** — replace `Dimensions.get('window')` at SpotlightOverlay.tsx:61 with `useWindowDimensions()` | Survives rotation/split-screen; no behavior change on phones in portrait-only mode (which is locked per [app.json:6](app-mobile/app.json#L6) `"orientation": "portrait"`) |
| D-FIX-8: investigation HF-1 | **CLOSED — NO ACTION** — step 3 IS attached via `coachLikesRef` at [GlassBottomNav.tsx:60,226](app-mobile/src/components/GlassBottomNav.tsx#L60); founder screenshot of step 3 shows cutout roughly correct on Likes nav tab | Provisional ORCH-0689 closed before opening |

---

## 2. Scope

### IN-SCOPE

| File | Change |
|---|---|
| [app-mobile/src/hooks/useCoachMark.ts](app-mobile/src/hooks/useCoachMark.ts) | §3.1 — Android Y-correction in `measureInWindow` callback (live path) |
| [app-mobile/src/contexts/CoachMarkContext.tsx](app-mobile/src/contexts/CoachMarkContext.tsx) | §3.2 — Android Y-correction in `scrollToKnownPosition` synthetic-rect callback |
| [app-mobile/src/components/SpotlightOverlay.tsx](app-mobile/src/components/SpotlightOverlay.tsx) | §3.3 — Replace `Dimensions.get('window')` with `useWindowDimensions()` (D-4 hardening) |
| [app-mobile/app/index.tsx](app-mobile/app/index.tsx) | §3.4 — Rename `styles.safeArea` → `styles.rootView` (D-2 cosmetic) |

Total: **4 files modified.** No files created. No files deleted.

### OUT-OF-SCOPE (do NOT touch)

- iOS-specific code paths — every change is either Android-conditional or platform-agnostic (D-2 rename + D-4 hook swap are platform-agnostic but provably no-op on iOS)
- `_layout.tsx` (D-3 already satisfied per D-FIX-5)
- Bubble positioning math at [SpotlightOverlay.tsx:171-214](app-mobile/src/components/SpotlightOverlay.tsx#L171-L214) — bubble follows cutout; once cutout Y is correct, bubble auto-corrects
- Arrow positioning at [SpotlightOverlay.tsx:283-303](app-mobile/src/components/SpotlightOverlay.tsx#L283-L303) — same auto-correction
- Coach mark step config, copy, animation timing, accessibility, ordering, entry delay, fade durations
- HF-1 / step 3 attachment plumbing — already correct per device evidence
- HF-2 (100ms re-measure race in useCoachMark.ts:46-51) — separate ORCH if ever observed
- HF-3 (hardcoded animation timings) — cosmetic, separate ORCH if needed
- Other absolute overlays / modals / tooltips — blast-radius sweep deferred per investigation §7
- Any change to `SCROLL_STEPS`, `COACH_STEPS`, `COACH_STEP_COUNT`, or `coachMarkSteps.ts`
- Any change to permission orchestrator, tour completion analytics, mixpanel events, or DB persistence of `coach_mark_step`

### Assumptions

- Android `StatusBar.currentHeight` returns a numeric value > 0 on Samsung Galaxy / Pixel devices in portrait orientation. The `?? 0` fallback handles the rare case where it's `undefined` (would cause graceful no-op rather than crash).
- The app remains portrait-locked per [app.json:6](app-mobile/app.json#L6). If portrait lock is ever removed, `useWindowDimensions()` (D-4) ensures the overlay re-renders on rotation, but the Y-correction constant `StatusBar.currentHeight` may need re-evaluation in landscape (out of scope — register as future ORCH if portrait lock changes).
- expo-router 6.0.23 continues to auto-inject `<SafeAreaProvider>` via [ExpoRoot.js](app-mobile/node_modules/expo-router/build/ExpoRoot.js). If a future expo-router upgrade removes auto-injection, D-3 must be re-opened.

---

## 3. Code contract (per file)

### 3.1 — `app-mobile/src/hooks/useCoachMark.ts`

**Current behavior (file content read):** [useCoachMark.ts:28-36](app-mobile/src/hooks/useCoachMark.ts#L28-L36) calls `node.measureInWindow((x, y, w, h) => { ... registerTarget(stepId, { x, y, width, height, radius: targetRadius }); })` and registers the raw window-frame Y returned by Android.

**Required new behavior:** Add a platform-conditional Y offset BEFORE calling `registerTarget`. iOS path receives the same Y as today (no change). Android path receives `y + (StatusBar.currentHeight ?? 0)`.

**Exact change instructions for implementor:**

1. Add to the existing import from `'react-native'` at the top of the file (currently `import { View } from 'react-native';`): the named imports `Platform` and `StatusBar`. Final form: `import { View, Platform, StatusBar } from 'react-native';`.
2. Inside the `measure` callback (currently at L32), AFTER the `if (width === 0 && height === 0) return;` guard and BEFORE the `registerTarget(...)` call, compute a corrected Y:
   - On Android: `y + (StatusBar.currentHeight ?? 0)`
   - On iOS: unchanged `y`
3. Pass the corrected Y into the `registerTarget` payload.
4. Add a comment block above the correction line citing this spec and explaining WHY: the SVG mask in `SpotlightOverlay` paints in the application-window frame (which extends behind the status bar under edge-to-edge), but `node.measureInWindow` on Android returns Y in the application-content frame; the offset is exactly `StatusBar.currentHeight`. Implementor MUST include this comment so future maintainers don't "clean up" the line. Comment text MUST reference `ORCH-0688`.

**Forbidden in this file:**
- No new exports
- No change to the `UseCoachMarkResult` interface
- No change to the `useEffect` block at L46-L51 (HF-2 is out of scope)
- No change to the `__DEV__` warning at L55-L67

### 3.2 — `app-mobile/src/contexts/CoachMarkContext.tsx`

**Current behavior (file content read):** [CoachMarkContext.tsx:226-246](app-mobile/src/contexts/CoachMarkContext.tsx#L226-L246) computes `exactScreenY = offset.contentY - scrollY` and calls `registerTarget(step, { x: offset.contentX, y: exactScreenY, width: offset.width, height: offset.height, radius: 12 })` with the assumption "Profile page extends behind status bar — scroll content starts at y=0."

**Required new behavior:** Apply the same Android Y-correction immediately before calling `registerTarget` in this synthetic-rect path. Same constant (`StatusBar.currentHeight ?? 0`), same platform conditional, same direction (ADD on Android, no-op on iOS).

**Exact change instructions for implementor:**

1. The file already imports `Dimensions` from `'react-native'` at L2. Extend that import to also include `Platform` and `StatusBar`. Final form: `import { Dimensions, Platform, StatusBar } from 'react-native';` (preserve existing imports verbatim if there are others).
2. Inside the `setTimeout` callback that calls `registerTarget` (currently at L233-L243), BEFORE constructing the registration payload, compute the corrected Y:
   - On Android: `exactScreenY + (StatusBar.currentHeight ?? 0)`
   - On iOS: unchanged `exactScreenY`
3. Pass the corrected Y into the `registerTarget` payload's `y` field.
4. Update the existing comment at L234-L235 (`Profile page extends behind status bar — scroll content starts at y=0. exactScreenY = contentY - scrollY (no insets offset needed)`) to ALSO reference ORCH-0688 and explain that the Android Y-correction is now applied because the SVG mask in SpotlightOverlay paints in the application-window frame.

**Forbidden in this file:**
- No change to scroll-target offset capture (the `registerTargetScrollOffset` callback at L277-L279)
- No change to `scrollToKnownPosition` logic ABOVE the `registerTarget` call (scrolling math is correct)
- No change to other parts of the provider (auth, persist, mixpanel, navigation, etc.)
- No new state, no new context fields

### 3.3 — `app-mobile/src/components/SpotlightOverlay.tsx`

**Current behavior (file content read):** [SpotlightOverlay.tsx:10](app-mobile/src/components/SpotlightOverlay.tsx#L10) imports `Dimensions` from `'react-native'`; [L61](app-mobile/src/components/SpotlightOverlay.tsx#L61) reads `const { width: screenWidth, height: screenHeight } = Dimensions.get('window');` once per render via static call.

**Required new behavior:** Replace the static dimensions read with the `useWindowDimensions()` hook so the overlay re-renders on dimension changes (rotation, split-screen). No other behavior change.

**Exact change instructions for implementor:**

1. Remove `Dimensions` from the `'react-native'` import at L10. Add `useWindowDimensions` to the same import. Final form preserves all other named imports unchanged.
2. Replace L61 (`const { width: screenWidth, height: screenHeight } = Dimensions.get('window');`) with `const { width: screenWidth, height: screenHeight } = useWindowDimensions();`. The destructuring shape and variable names stay identical so all downstream consumers (lines 158-159, 173-174, 179-182, 241, 244, 261-264) continue to work without further change.

**Forbidden in this file:**
- No change to bubble positioning math (L171-L214)
- No change to arrow rendering (L283-L303)
- No change to SVG mask structure (L240-L280)
- No change to keyboard, accessibility, animation, or step-change effects
- No change to any constant at L19-L35

### 3.4 — `app-mobile/app/index.tsx`

**Current behavior (file content read):** [index.tsx:2320](app-mobile/app/index.tsx#L2320) wraps the app in `<View style={styles.safeArea}>`; [L2651-L2654](app-mobile/app/index.tsx#L2651-L2654) defines the style as `{ flex: 1, backgroundColor: "#000000" }`. The View is NOT a `SafeAreaView` from `react-native-safe-area-context` — the name is misleading.

**Required new behavior:** Rename the style key to `rootView` for clarity. Visual behavior unchanged.

**Exact change instructions for implementor:**

1. At L2320, change `<View style={styles.safeArea}>` to `<View style={styles.rootView}>`.
2. At L2651-L2654, change the style key name from `safeArea:` to `rootView:`. Style body unchanged: `{ flex: 1, backgroundColor: "#000000" }`.
3. Verify no other consumer references `styles.safeArea` (implementor MUST grep `styles.safeArea` across the file and confirm zero remaining matches before committing).

**Forbidden in this file:**
- No other style renames
- No change to the `<StatusBar>` JSX at L2321-L2325
- No change to provider tree, conditional padding, page-conditional logic, or any other rendering
- No new imports

---

## 4. Success criteria

| ID | Criterion | How to verify |
|---|---|---|
| SC-1 | On the founder's Samsung Galaxy device, the cutout for **step 1** ("Meet your deck") visually surrounds the swipeable card body (not above it, not in the status bar). | Manual smoke: trigger the tour, observe step 1, confirm cutout ring is around the visible card content area. |
| SC-2 | On the same Android device, the cutout for **step 2** ("Your taste, your rules") visually centers on the prefs/sliders icon button on the left of the Solo pill row — NOT on the system clock. | Manual smoke: observe step 2, confirm cutout center within ±4px of the prefs icon center. |
| SC-3 | On the same Android device, the cutout for **step 4** ("Better together") visually centers on the "+" create button next to the Solo pill — NOT on a status-bar icon. | Manual smoke: observe step 4, confirm cutout center within ±4px of the "+" button center. |
| SC-4 | On the same Android device, the cutout for **step 3** ("Where your saves live") visually surrounds the Likes tab in the bottom nav (must be unchanged-or-better from current screenshots — already roughly correct). | Manual smoke: observe step 3, confirm Likes tab is fully inside the cutout ring. |
| SC-5 | On the same Android device, the cutouts for **steps 5, 6, 7, 8, 9** all visually align with their target elements per the dispatch criteria (step 5 Solo button; step 6 Discover header; step 7 Connections chat header; step 8 Profile Account Settings row; step 9 Profile Beta Feedback row). | Manual smoke: walk the entire tour on Android end-to-end. |
| SC-6 | On any iOS device, all 9 cutouts land at the same visual positions they land at today. | Manual smoke: walk the entire tour on iOS, compare against pre-fix iOS visual baseline. |
| SC-7 | `git diff` against the pre-fix commit shows ONLY: (a) the 4 files in §2 IN-SCOPE table; (b) Android-conditional additions in `useCoachMark.ts` and `CoachMarkContext.tsx`; (c) the `Dimensions` → `useWindowDimensions` swap in `SpotlightOverlay.tsx`; (d) the `safeArea` → `rootView` rename in `app/index.tsx`. NO iOS-affecting line touched outside platform-conditional branches. | Implementor runs `git diff main...HEAD` and reviews. Tester re-verifies. |
| SC-8 | After the rename in §3.4, grepping `styles.safeArea` in `app-mobile/` returns zero matches. Grepping `styles.rootView` returns exactly one match (the consumer at L2320). | `grep -rn "styles\.safeArea" app-mobile/src app-mobile/app` → 0 matches; `grep -rn "styles\.rootView" app-mobile/app` → 1 match. |
| SC-9 | The `?? 0` fallback in §3.1 and §3.2 prevents crash when `StatusBar.currentHeight` is `undefined` (rare device edge case). On the founder's device, `StatusBar.currentHeight` is a defined positive number (verifiable via the existing `__DEV__` `[Spotlight]` log already at [SpotlightOverlay.tsx:144-146](app-mobile/src/components/SpotlightOverlay.tsx#L144-L146)). | Implementor adds a one-time `__DEV__` console.log inside the §3.1 callback printing `StatusBar.currentHeight` to confirm the value on the test device, then removes the log before commit. |
| SC-10 | The mandatory ORCH-0688 comment exists above each Y-correction line (one in `useCoachMark.ts`, one in `CoachMarkContext.tsx`). | Tester greps for `ORCH-0688` in both files; expects exactly 2 matches across the two files (or more if implementor adds additional inline notes — minimum 1 per file). |

---

## 5. Test cases

| Test | Scenario | Input / Action | Expected | Layer |
|---|---|---|---|---|
| T-01 | Step 1 Android | Trigger tour, observe step 1 on Samsung Galaxy | Cutout surrounds the swipeable card body (SC-1) | Component (visual) |
| T-02 | Step 2 Android | Step 2 on Samsung Galaxy | Cutout on prefs icon, NOT on system clock (SC-2) | Component (visual) |
| T-03 | Step 3 Android | Step 3 on Samsung Galaxy | Cutout on Likes nav tab (SC-4) — proves bottom-of-screen target works post-fix | Component (visual) |
| T-04 | Step 4 Android | Step 4 on Samsung Galaxy | Cutout on "+" button, NOT in status bar (SC-3) | Component (visual) |
| T-05 | Step 5 Android | Step 5 on Samsung Galaxy | Cutout on Solo button (SC-5) | Component (visual) |
| T-06 | Step 6 Android | Step 6 on Samsung Galaxy | Cutout on Discover header (SC-5); bubble centered (`bubblePosition: 'center'`) | Component (visual) |
| T-07 | Step 7 Android | Step 7 on Samsung Galaxy | Cutout on Connections chat header (SC-5) | Component (visual) |
| T-08 | Step 8 Android (synthetic path) | Step 8 on Samsung Galaxy | Cutout on Profile Account Settings row (SC-5) — proves §3.2 synthetic path correction works | Component (visual + synthetic-rect) |
| T-09 | Step 9 Android (synthetic path) | Step 9 on Samsung Galaxy | Cutout on Beta Feedback row (SC-5) | Component (visual + synthetic-rect) |
| T-10 | Full tour iOS regression | Walk all 9 steps on any iPhone | All cutouts land identically to the pre-fix iOS visual baseline (SC-6) | Component (visual) |
| T-11 | Code-path proof | `git diff main...HEAD --stat` | Only 4 files changed: `useCoachMark.ts`, `CoachMarkContext.tsx`, `SpotlightOverlay.tsx`, `app/index.tsx`. No iOS-affecting line outside platform-conditionals (SC-7) | Static |
| T-12 | Rename safety grep | `grep -rn "styles\.safeArea" app-mobile/` and `grep -rn "styles\.rootView" app-mobile/app/` | First returns 0 matches; second returns exactly 1 match (SC-8) | Static |
| T-13 | StatusBar.currentHeight defined | `__DEV__` log on Samsung Galaxy during smoke | `StatusBar.currentHeight` is a number > 0 (typically 24) | Runtime |
| T-14 | Comment block present | `grep -n "ORCH-0688" app-mobile/src/hooks/useCoachMark.ts app-mobile/src/contexts/CoachMarkContext.tsx` | At least 1 match per file (SC-10) | Static |
| T-15 | TSC clean | `cd app-mobile && npx tsc --noEmit` | Zero NEW errors introduced by this change. Pre-existing errors in unrelated files (per parallel ORCH work) are acceptable. | Static |
| T-16 | Negative-control: revert the §3.1 correction only, observe step 2 | Manually revert the Android Y-correction in `useCoachMark.ts`, leave §3.2 in place, run on Samsung Galaxy | Step 2 cutout returns to its original misaligned position (on system clock) — proves §3.1 is doing the work. Then re-apply. | Component (visual) |
| T-17 | Negative-control: revert the §3.2 correction only, observe step 8 | Manually revert the Android Y-correction in `CoachMarkContext.tsx`, leave §3.1 in place, run on Samsung Galaxy | Step 8 cutout misaligns on Profile (synthetic path proven independent). Then re-apply. | Component (visual + synthetic-rect) |

T-01..T-09 + T-10 are the closure-gate visual matrix. T-11..T-15 are mechanical gates. T-16, T-17 are optional negative-control proofs the implementor MAY run for confidence.

---

## 6. Implementation order

1. **Pre-flight.** Implementor confirms working tree is clean OR understands which other ORCHs have unrelated edits (parallel work on ORCH-0684 / ORCH-0685 / ORCH-0686 may have files in working tree — implementor MUST use explicit `git add <file>` paths, never `git add .`).
2. **Apply §3.1** in `useCoachMark.ts`: extend the `'react-native'` import to include `Platform` and `StatusBar`; add the Android Y-correction inside the `measureInWindow` callback; add the ORCH-0688 explanatory comment.
3. **Apply §3.2** in `CoachMarkContext.tsx`: extend the `'react-native'` import to include `Platform` and `StatusBar`; add the same Android Y-correction inside the `setTimeout` callback before `registerTarget`; update the existing comment to reference ORCH-0688.
4. **Apply §3.3** in `SpotlightOverlay.tsx`: remove `Dimensions` from import, add `useWindowDimensions`; replace L61 with the hook call.
5. **Apply §3.4** in `app/index.tsx`: rename `styles.safeArea` → `styles.rootView` at the consumer (L2320) and at the style definition (L2651-L2654); grep-verify SC-8.
6. **Verify.** Run `npx tsc --noEmit` from `app-mobile/` (T-15). Run T-12 grep (SC-8). Run T-14 comment grep (SC-10).
7. **Smoke on real Android device.** Capture screenshots for all 9 steps (T-01..T-09). Compare against the founder's pre-fix screenshots. Each cutout must be visually correct per §4 SCs.
8. **Smoke on iOS** (regression — T-10). Walk the tour, confirm zero visual change vs pre-fix iOS baseline.
9. **Single commit.** Commit message template in §9.
10. **OTA both platforms.** Two separate `eas update` invocations per memory rule `feedback_eas_update_no_web.md` — `--platform ios` then `--platform android`. Combined `--platform ios,android` syntax and `--platform all` are forbidden.

---

## 7. Invariants

### 7.1 Preserved (must continue to hold)

| ID | Description | Why preserved by this change |
|---|---|---|
| Constitution #1 (no dead taps) | Every interactive element must respond to user input. | RESTORED on Android (cutout now visually identifies the actual tappable element; pre-fix users may have tapped wrong region). |
| Constitution #3 (no silent failures) | Errors must surface, never be swallowed. | The `?? 0` fallback for `StatusBar.currentHeight` is graceful degradation, not silent failure — on a device that returns `undefined`, the correction becomes a no-op and the bug is unchanged from today (no regression). |

### 7.2 New (informational only — NOT CI-gated)

| ID | Description | Why informational only |
|---|---|---|
| `I-COACH-MARK-PLATFORM-PARITY` | Coach mark cutouts must visually align with their target elements on both iOS and Android. | Visual alignment is not grep-checkable. Enforcement is via human visual smoke (SC-1..SC-6) at every UI-positioning ORCH closure. The D-5 process improvement (platform-parity smoke gate added to spec template) is the structural enforcement; this invariant documents the rule. |

### 7.3 NOT introducing

- No new CI gate (visual alignment is not grep-checkable; structural enforcement is via D-5 process improvement at orchestrator level)
- No new database invariant (no DB layer touched)
- No new RPC invariant (no RPC layer touched)
- No new edge function invariant (no edge function layer touched)

---

## 8. Regression prevention

1. **Inline ORCH-0688 comments** in `useCoachMark.ts` and `CoachMarkContext.tsx` above each Y-correction line, citing this spec and explaining WHY (frame mismatch + edge-to-edge + measureInWindow vs SVG paint frame). Future editors who think "this looks unnecessary" will see the comment and check the spec before removing.
2. **D-2 rename** removes the misleading `safeArea` style key — future engineers won't assume the wrapping View is a `SafeAreaView` and design around it incorrectly.
3. **D-4 hook swap** ensures the overlay survives any future rotation / split-screen support without re-introducing a coordinate-frame mismatch.
4. **D-5 process improvement (orchestrator-side, NOT in this spec):** add "platform-parity smoke gate" requirement to the spec template for any UI-positioning ORCH. Would have caught this class at ORCH-0635 closure. Tracked as orchestrator process refinement.

---

## 9. Closure gate

Two confirmations close ORCH-0688 Grade A:

1. **Founder visual confirmation on Samsung Galaxy:** all 9 coach steps look correct (cutout centered on intended target ±4px). Founder posts screenshots of at least steps 2 and 4 (the most-broken in the pre-fix baseline) showing post-fix alignment.
2. **iOS regression confirmation:** tester or founder walks the tour on any iPhone and confirms zero visual change vs pre-fix iOS baseline.

On both confirmations, orchestrator runs the CLOSE protocol: 7-artifact sync + commit message + EAS Updates (already published per §6 step 10).

### Commit message template (no Co-Authored-By per memory rule)

```
fix(coach-mark): ORCH-0688 align spotlight cutout on Android (status-bar offset)

On Android with edge-to-edge enabled and a translucent status bar, node.measureInWindow
returns Y in the application-content frame (excluding the status-bar zone), while the
SVG mask in SpotlightOverlay paints in the application-window frame (including the
status-bar zone). The frame mismatch placed the cutout one StatusBar.currentHeight (~24dp
on Samsung One UI) above the actual target — visibly misaligned in the founder's
screenshots (step 2 cutout sat on the system clock; step 4 cutout sat on a status-bar
icon). iOS is unaffected because keyWindow + React root view share one frame.

Fix is platform-conditional and additive: on Android, add StatusBar.currentHeight to the
registered Y inside both (a) the live measureInWindow callback in useCoachMark.ts and
(b) the synthetic-rect path in CoachMarkContext.tsx scrollToKnownPosition. iOS branch
is a literal no-op.

Bundled hardening:
- D-2: rename misnamed styles.safeArea -> styles.rootView in app/index.tsx (the
  wrapping View is not a SafeAreaView, never was)
- D-4: replace Dimensions.get('window') with useWindowDimensions() in
  SpotlightOverlay.tsx (survives any future rotation/split-screen)

D-3 (explicit SafeAreaProvider) verified unnecessary — expo-router 6.0.23 auto-injects
one in ExpoRoot.js.

Files: 4 modified, 0 created, 0 deleted. Mobile-only. OTA-eligible.
Estimated cycle: spec ~30min + impl ~30min + tester ~30min + 2 EAS Updates ~10min.
```

### EAS Update template (TWO separate invocations per memory rule)

```bash
cd app-mobile && eas update --branch production --platform ios --message "ORCH-0688: fix Android coach mark spotlight offset"
cd app-mobile && eas update --branch production --platform android --message "ORCH-0688: fix Android coach mark spotlight offset"
```
