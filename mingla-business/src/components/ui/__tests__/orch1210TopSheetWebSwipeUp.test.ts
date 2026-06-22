import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1210 [business-web top sheet swipe-UP-to-dismiss] — implementor-owned
 * happy-path regression over the TopSheetWeb source contract.
 *
 * Seth: on business web the brand-switcher TopSheet (and the "Create" menu) could
 * NOT be dismissed by swiping up — only by tapping outside. The NATIVE variant
 * (TopSheetNative) has a reanimated upward PanGesture; the WEB variant
 * (TopSheetWeb) had ONLY scrim-tap + Escape. This adds a pointer-driven swipe-up,
 * mirroring SheetWeb's drag-to-dismiss (ORCH-1207/1208) inverted for the
 * top-anchored sheet.
 *
 * The load-bearing runtime proof lives in the real-Chromium Playwright probe
 * (playwright/orch1210/topsheet-web-swipeup.spec.ts): it dispatches real UPWARD
 * pointer drags to prove onClose fires past threshold + springs back below it, and
 * reads the drag-catch computed `touch-action` (must be `none`). This jest test is
 * the cheap CI-runnable static guard for the SAME contracts.
 *
 * Fails-on-revert (verified by true line-DELETION, not comment-out): delete the
 * `touchAction:"none"` line from the `webDragCatch` style block OR delete the
 * upward-threshold close logic and the matching assertions fail. Verified at the
 * commit recorded in IMPLEMENT_ORCH-1210.md.
 */
const root = path.resolve(__dirname, "..", "..", "..", "..");
const SRC = fs.readFileSync(
  path.join(root, "src/components/ui/TopSheet.tsx"),
  "utf8",
);

/** Strip `//` line comments + block comments so assertions match REAL code, not
 *  doc text (the ORCH-1208-lesson comment literally contains `touchAction:"none"`
 *  — without stripping, a touch-action deletion would still false-pass). */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Slice out the `webDragCatch: { ... }` style block body (comments stripped). */
function webDragCatchBlock(): string {
  const start = SRC.indexOf("webDragCatch:");
  expect(start).toBeGreaterThan(-1);
  // The block body runs to the `} as unknown as ViewStyle,` close — slice on that
  // sentinel so the comment-laden body is captured whole, then strip comments.
  const open = SRC.indexOf("{", start);
  const close = SRC.indexOf("} as unknown as ViewStyle", open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return stripComments(SRC.slice(open, close + 1));
}

/** Isolate the TopSheetWeb component body (up to the StyleSheet block). */
const webBlock = SRC.slice(
  SRC.indexOf("const TopSheetWeb"),
  SRC.indexOf("const styles = StyleSheet.create"),
);

describe("ORCH-1210 — TopSheetWeb has a pointer swipe-UP-to-dismiss", () => {
  it("wires pointer drag handlers onto a drag-catch element", () => {
    expect(/onPointerDown:/.test(webBlock)).toBe(true);
    expect(/onPointerMove:/.test(webBlock)).toBe(true);
    expect(/onPointerUp:/.test(webBlock)).toBe(true);
    expect(/onPointerCancel:/.test(webBlock)).toBe(true);
    expect(/\{\.\.\.dragHandlers\}/.test(webBlock)).toBe(true);
    expect(/-drag-handle/.test(webBlock)).toBe(true);
  });

  it("commits a close past 25% of panel height UP OR an upward flick velocity", () => {
    expect(/TOPSHEET_DRAG_CLOSE_RATIO\s*=\s*0\.25/.test(SRC)).toBe(true);
    expect(/TOPSHEET_DRAG_CLOSE_VELOCITY\s*=/.test(SRC)).toBe(true);
    // INVERTED vs the bottom sheet: dismiss = UPWARD drag → `-dragged` past the
    // ratio, and an UPWARD flick → velocity < -threshold.
    expect(
      /-dragged\s*>\s*panelHeight\s*\*\s*TOPSHEET_DRAG_CLOSE_RATIO\s*\|\|\s*velocity\s*<\s*-TOPSHEET_DRAG_CLOSE_VELOCITY/.test(
        webBlock,
      ),
    ).toBe(true);
    expect(/onClose\(\)/.test(webBlock)).toBe(true);
  });

  it("clamps the drag to UPWARD-only (downward drag does nothing / springs back)", () => {
    // handleDragMove keeps only negative (upward) deltas; downward → 0.
    expect(/const\s+next\s*=\s*delta\s*<\s*0\s*\?\s*delta\s*:\s*0/.test(webBlock)).toBe(true);
  });

  it("translates the panel with the finger and disables transition while dragging", () => {
    expect(/openWithDrag\s*=\s*dragY/.test(webBlock)).toBe(true);
    expect(/transition:\s*dragging\s*\n?\s*\?\s*["']none["']/.test(webBlock)).toBe(true);
  });

  it("keeps the existing scrim-tap + Escape dismissal (does not replace them)", () => {
    expect(/handleScrimPress/.test(webBlock)).toBe(true);
    expect(/dismissOnScrimTap/.test(webBlock)).toBe(true);
    expect(/event\.key\s*===\s*["']Escape["']/.test(SRC)).toBe(true);
  });
});

describe("ORCH-1210 — drag-catch carries touch-action:none on web (ORCH-1208 lesson)", () => {
  it("styles.webDragCatch sets touchAction:\"none\" so touch devices route the drag to the pointer handler", () => {
    const block = webDragCatchBlock();
    expect(/touchAction:\s*["']none["']/.test(block)).toBe(true);
  });

  it("anchors the drag-catch at the BOTTOM of the panel (over the top sheet's handle)", () => {
    const block = webDragCatchBlock();
    // Inverted vs the bottom sheet (whose drag-catch is `top:0`): the top sheet's
    // handle renders LAST, at the bottom edge, so the band is `bottom:0`.
    expect(/bottom:\s*0/.test(block)).toBe(true);
  });

  it("does NOT add a PanGesture/touch-action to TopSheetNative (native already has the reanimated swipe)", () => {
    // The native variant keeps its `Gesture.Pan()` upward dismiss untouched; the
    // web touch-action fix must not leak a touchAction into the native style path.
    const nativeBlock = SRC.slice(
      SRC.indexOf("const TopSheetNative"),
      SRC.indexOf("const TopSheetPanelInner"),
    );
    expect(/touchAction/.test(nativeBlock)).toBe(false);
    expect(/Gesture\.Pan\(\)/.test(nativeBlock)).toBe(true);
  });
});
