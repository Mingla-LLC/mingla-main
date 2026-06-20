/**
 * ORCH-1173 [brand-switcher Android scroll] — scroll-gated dismiss-pan
 * coordination gate.
 *
 * # Bug
 * On Android the brand-switcher TopSheet's brand list could not be scrolled —
 * swiping up dismissed the sheet instead of scrolling, so brands below the fold
 * were unreachable. Root cause: `TopSheetNative` wrapped its children (incl. the
 * inner `ScrollView`) in a bare `Gesture.Pan()` that translated the panel up on
 * ANY upward drag, which won vertical-drag arbitration over the ScrollView.
 *
 * # Fix (asserted here — SOURCE CONTRACT)
 * 1. TopSheetNative tracks the consumer's scroll offset in a UI-thread shared
 *    value (`scrollOffset`) via `useAnimatedScrollHandler`, and gates the
 *    dismiss-pan on `scrollOffset.value <= 0` (list at top) so the pan only
 *    dismisses from the top; otherwise the ScrollView consumes the drag.
 * 2. The dismiss-pan is composed `Gesture.Simultaneous(...)` with a
 *    `Gesture.Native()` representing the inner scroll, so both run.
 * 3. The handle is exposed via `TopSheetScrollProvider`; BrandSwitcherSheet
 *    consumes it (`useTopSheetScroll`) and renders an `Animated.ScrollView`
 *    wired with the gate's `onScroll` + the native gesture.
 *
 * # Fails-on-revert
 * Reverting any leg — restoring the bare `Gesture.Pan()` wrap (drop the
 * `scrollOffset` gate / the `Gesture.Simultaneous` / the
 * `useAnimatedScrollHandler`), or reverting BrandSwitcherSheet's
 * `Animated.ScrollView`/`useTopSheetScroll` back to a plain `ScrollView` —
 * removes the asserted token(s) and FAILS the corresponding test below.
 */

import * as fs from "fs";
import * as path from "path";

const BUSINESS_ROOT = path.resolve(__dirname, "..", "..");
const TOPSHEET_PATH = path.join(
  BUSINESS_ROOT,
  "src",
  "components",
  "ui",
  "TopSheet.tsx",
);
const CONTEXT_PATH = path.join(
  BUSINESS_ROOT,
  "src",
  "components",
  "ui",
  "TopSheetScrollContext.tsx",
);
const SWITCHER_PATH = path.join(
  BUSINESS_ROOT,
  "src",
  "components",
  "brand",
  "BrandSwitcherSheet.tsx",
);

/** Strip comments so we assert on EXECUTABLE source only. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("ORCH-1173 brand-switcher Android scroll gate", () => {
  // ---- T-1: the scroll-gating context module exists + exports the contract --
  test("T-1 — TopSheetScrollContext exposes onScroll + nativeGesture handle", () => {
    expect(fs.existsSync(CONTEXT_PATH)).toBe(true);
    const code = stripComments(fs.readFileSync(CONTEXT_PATH, "utf8"));
    expect(code).toContain("onScroll");
    expect(code).toContain("nativeGesture");
    expect(code).toContain("useTopSheetScroll");
    expect(code).toContain("TopSheetScrollProvider");
  });

  // ---- T-2: TopSheetNative gates the dismiss-pan on scroll offset -----------
  test("T-2 — TopSheetNative tracks scrollOffset and gates the dismiss-pan on it (at-top only)", () => {
    const code = stripComments(fs.readFileSync(TOPSHEET_PATH, "utf8"));
    // UI-thread scroll-offset tracking.
    expect(code).toContain("useAnimatedScrollHandler");
    expect(code).toMatch(/scrollOffset\s*=\s*useSharedValue\(0\)/);
    // The gate predicate: pan only dismisses when the list is at the top.
    expect(code).toMatch(/scrollOffset\.value\s*<=\s*0/);
  });

  // ---- T-3: dismiss-pan composed SIMULTANEOUS with the inner native scroll --
  test("T-3 — dismiss-pan is composed Gesture.Simultaneous with a Gesture.Native scroll gesture", () => {
    const code = stripComments(fs.readFileSync(TOPSHEET_PATH, "utf8"));
    expect(code).toContain("Gesture.Native()");
    expect(code).toContain("Gesture.Simultaneous(");
    expect(code).toContain("simultaneousWithExternalGesture");
    // The composed gesture (not the bare panGesture) drives the detector.
    expect(code).toContain("gesture={composedGesture}");
    // The dismiss-pan must NOT be wired bare anymore (the reverted bug shape).
    expect(code).not.toContain("gesture={panGesture}");
  });

  // ---- T-4: TopSheet provides the scroll handle to its children -------------
  test("T-4 — TopSheetNative wraps children in TopSheetScrollProvider", () => {
    const code = stripComments(fs.readFileSync(TOPSHEET_PATH, "utf8"));
    expect(code).toContain("TopSheetScrollProvider");
  });

  // ---- T-5: BrandSwitcherSheet consumes the gate via Animated.ScrollView ----
  test("T-5 — BrandSwitcherSheet wires Animated.ScrollView to the TopSheet scroll gate", () => {
    const code = stripComments(fs.readFileSync(SWITCHER_PATH, "utf8"));
    expect(code).toContain("useTopSheetScroll");
    expect(code).toContain("Animated.ScrollView");
    // It must hand the gate's onScroll + native gesture to the scrollable.
    expect(code).toContain("topSheetScroll.onScroll");
    expect(code).toContain("topSheetScroll.nativeGesture");
    expect(code).toContain("GestureDetector");
  });
});
