# IMPLEMENTATION — ORCH-1063 [gorhom scroll-recursion crash] (the REAL production freeze)

Status: FIXED (sim-verified app behavior; TestFlight is the crash-gone proof).
Date: 2026-06-03

## The crash (Sentry-confirmed)
Sentry issue `REACT-NATIVE-T` (mingla-llc/react-native), event `efb55c0337144fa08c6bade175556450`:
- **`RangeError: Maximum call stack size exceeded (native stack depth)`** — fatal, `mechanism: cpp_exception`, level fatal.
- Release `com.mingla.app.v2@1.1.0+22` (**build 22**), iOS 26.5, iPhone15,4, real device, production TestFlight, in foreground. First+last seen 2026-06-03T20:07:43Z (single occurrence so far on the brand-new build 22).
- Stack is an infinite loop: `gorhom useScrollEventsHandlersDefault → useScrollHandler → reanimated useAnimatedScrollHandler → scrollTo → dispatchCommand → (native) → handleAndFlushAnimationFrame → useScrollEventsHandlersDefault → …`
- Session replay attached: `cad9fcfc33144aa5a0f6c6ddf4fc07a2`.

## Root cause
`@gorhom/bottom-sheet@5.2.8` ⊕ `react-native-reanimated@4.1.5` (Expo SDK 54 / RN 0.81.5, New Architecture). In `node_modules/@gorhom/bottom-sheet/src/hooks/useScrollEventsHandlersDefault.ts`, when the scrollable is `LOCKED` the scroll worklets call `scrollTo(scrollableRef, 0, lockPosition, false)` to pin the position. Under reanimated v4 + new arch, `scrollTo()` synchronously re-fires the scroll event, re-entering the same worklet (still LOCKED) → calls `scrollTo()` again → unbounded recursion → native stack overflow → fatal crash. The user-visible symptom is the "freeze then app dies" on a content-rich/nested-scroll sheet (e.g. the curated expanded card). Known upstream, unfixed: gorhom #2546, #2592, discussion #2617. Changelog 5.2.9–5.2.14 contains **no** fix → a version bump does not resolve it.

This is a DIFFERENT bug from the modal-instance fix (commit b3afeb01e) in the same ORCH; both ship together.

## The fix (JS-only → OTA-able)
`patch-package` patch `patches/@gorhom+bottom-sheet+5.2.8.patch`: at all three `scrollTo` sites (handleOnScroll / handleOnEndDrag / handleOnMomentumEnd) guard the call with `if (y !== lockPosition) { scrollTo(...) }`. The first call still snaps the scrollable to `lockPosition` (lock behavior preserved); the re-fired event now has `y === lockPosition` → guard skips the redundant `scrollTo` → the recursion can never start. Wired via `package.json` `"postinstall": "patch-package"` + `patch-package@^8.0.1` devDependency, so every install (local, CI, EAS build, `eas update` OTA) re-applies it. `react-native: src/index.ts` is gorhom's RN entry, so Metro/EAS bundle the patched source.

## Verification (iOS sim, patched gorhom in the bundle — 3 guards confirmed in source)
- App loads + deck renders with the patch (no startup/worklet error).
- Opened a curated expanded card (multi-stop nested-scroll content — the crash-prone shape), scrolled heavily down and back up → smooth, no stack-overflow, no freeze.
- Swiped the sheet closed → app navigated to Discover → fully responsive.
- Could not reproduce the original crash on the dev sim (release/specific-trigger only); TestFlight build 22 + OTA is the definitive crash-gone proof.

## Files
- `app-mobile/patches/@gorhom+bottom-sheet+5.2.8.patch` (new)
- `app-mobile/package.json` (postinstall + patch-package devDep)
- `app-mobile/package-lock.json` (patch-package)
