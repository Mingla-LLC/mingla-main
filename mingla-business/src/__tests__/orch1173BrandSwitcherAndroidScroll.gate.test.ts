/**
 * ORCH-1173 R2 [brand-switcher Android scroll + opaque panel] — handle-only
 * dismiss + opaque Android fallback gate.
 *
 * # Bug (R1 failed on-device)
 * On Android the brand-switcher TopSheet's brand list could not be scrolled —
 * swiping up dismissed the sheet. R1 tried a scroll-offset-gated
 * `Gesture.Simultaneous`/`Gesture.Native` coordination between the dismiss-pan
 * and the inner scroll; it did NOT work on the Samsung (the list still didn't
 * scroll). The panel was also too translucent (0.92 alpha fallback → home
 * screen bled through on Android).
 *
 * # Fix (asserted here — SOURCE CONTRACT, R2)
 * 1. The dismiss-pan is the SIMPLE upward-drag→translateY dismiss again, and it
 *    is attached ONLY to the drag HANDLE (`TopSheetPanelInner` wraps the handle
 *    region in `WebSafeGestureDetector` with the `dismissGesture` prop). It does
 *    NOT wrap the panel/scroll body — so the brand list is a plain native
 *    `ScrollView` with zero competing Pan and scrolls normally on Android.
 * 2. The R1 coordination is GONE: no `Gesture.Simultaneous`, no
 *    `Gesture.Native()`, no `simultaneousWithExternalGesture`, no
 *    `useAnimatedScrollHandler` scroll-offset gate, and `TopSheetScrollContext`
 *    is deleted.
 * 3. BrandSwitcherSheet renders a plain react-native `<ScrollView>` (no
 *    `Animated.ScrollView`, no `useTopSheetScroll`, no `GestureDetector`).
 * 4. The non-blur (Android / unsupported-web) `FALLBACK_BACKGROUND` is FULLY
 *    OPAQUE (alpha 1.0) so nothing bleeds through
 *    (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
 *
 * # Fails-on-revert
 * - Re-wrapping the whole panel in the dismiss gesture (so the body is gesture-
 *   wrapped) or re-introducing the `Gesture.Simultaneous`/`Gesture.Native`
 *   coordination FAILS T-2/T-3.
 * - Reverting the handle to not carry `dismissGesture` FAILS T-2.
 * - Reverting BrandSwitcherSheet to `Animated.ScrollView`/`useTopSheetScroll`
 *   FAILS T-4.
 * - Lowering `FALLBACK_BACKGROUND` back below alpha 1.0 (a translucent
 *   `rgba(...,0.92)` fill) FAILS T-5.
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

describe("ORCH-1173 R2 brand-switcher handle-only dismiss + opaque panel", () => {
  // ---- T-1: the dead R1 coordination context module is removed --------------
  test("T-1 — TopSheetScrollContext.tsx is deleted (R1 coordination removed)", () => {
    expect(fs.existsSync(CONTEXT_PATH)).toBe(false);
  });

  // ---- T-2: dismiss-pan attached to the handle only, not the scroll body ----
  test("T-2 — TopSheetNative attaches the dismiss-pan to the handle only via dismissGesture", () => {
    const code = stripComments(fs.readFileSync(TOPSHEET_PATH, "utf8"));
    // The handle region carries the dismiss gesture.
    expect(code).toContain("dismissGesture");
    expect(code).toMatch(/dismissGesture=\{panGesture\}/);
    // The dismiss-pan is the simple upward-drag dismiss (no scroll-offset gate).
    expect(code).toContain("Gesture.Pan()");
    // The panel/body is NOT wrapped in the dismiss gesture anymore: the only
    // WebSafeGestureDetector usage wraps the handleWrap, never the panel.
    expect(code).not.toContain("gesture={composedGesture}");
    expect(code).not.toContain("gesture={panGesture}");
  });

  // ---- T-3: the R1 scroll-coordination is fully gone ------------------------
  test("T-3 — no Gesture.Simultaneous / Gesture.Native / scroll-offset gate remains", () => {
    const code = stripComments(fs.readFileSync(TOPSHEET_PATH, "utf8"));
    expect(code).not.toContain("Gesture.Simultaneous(");
    expect(code).not.toContain("Gesture.Native()");
    expect(code).not.toContain("simultaneousWithExternalGesture");
    expect(code).not.toContain("useAnimatedScrollHandler");
    expect(code).not.toContain("TopSheetScrollProvider");
    expect(code).not.toMatch(/scrollOffset\.value\s*<=\s*0/);
  });

  // ---- T-4: BrandSwitcherSheet uses a PLAIN ScrollView ----------------------
  test("T-4 — BrandSwitcherSheet renders a plain ScrollView (no R1 coordination)", () => {
    const code = stripComments(fs.readFileSync(SWITCHER_PATH, "utf8"));
    expect(code).toContain("<ScrollView");
    expect(code).toContain("showsVerticalScrollIndicator");
    // None of the R1 coordination wiring.
    expect(code).not.toContain("useTopSheetScroll");
    expect(code).not.toContain("Animated.ScrollView");
    expect(code).not.toContain("topSheetScroll");
    expect(code).not.toContain("GestureDetector");
  });

  // ---- T-5: the Android/non-blur fallback fill is FULLY OPAQUE ---------------
  test("T-5 — FALLBACK_BACKGROUND is fully opaque (no alpha bleed-through)", () => {
    const code = stripComments(fs.readFileSync(TOPSHEET_PATH, "utf8"));
    // Solid rgb(...) (or #hex) — NOT a translucent rgba(...,0.xx).
    expect(code).toMatch(
      /FALLBACK_BACKGROUND\s*=\s*"(?:rgb\(\s*20\s*,\s*22\s*,\s*26\s*\)|#14161[Aa])"/,
    );
    // Guard against any rgba(...) (alpha) fallback sneaking back.
    expect(code).not.toMatch(/FALLBACK_BACKGROUND\s*=\s*"rgba\(/);
  });
});
