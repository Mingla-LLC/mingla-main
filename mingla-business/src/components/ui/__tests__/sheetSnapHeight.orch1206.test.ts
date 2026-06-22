/**
 * ORCH-1206 — sheet snapPoint ratio fix (the TRUE cause of "venue sheets
 * bleed/cut off at the bottom").
 *
 * Root cause (proven over CDP on a real Samsung device): the 8 venue sheets
 * pass a FRACTIONAL numeric snapPoint intending a RATIO (e.g. 0.9 = 90%), but
 * `computeSheetHeight` treated EVERY numeric snapPoint as absolute pixels and
 * clamped it UP to MIN_SNAP_PX = 120px → the panel rendered only 120px tall,
 * `overflow:hidden` clipped the form + CTA below the fold.
 *
 * Fix: a numeric snapPoint in (0, 1] is a RATIO of screen height; values > 1
 * stay absolute pixels (backward-compatible with the measured-pixel callers).
 * Both the native (`Sheet`/`SheetMobile`) and web (`SheetWeb`) variants share
 * this single helper, so this one test covers both surfaces.
 *
 * Fails-on-revert: delete the `snapPoint > 0 && snapPoint <= 1` ratio branch
 * in `computeSheetHeight` (so a fractional numeric falls back to the
 * MIN_SNAP_PX clamp) → the (T-1206-01) "0.9 ≈ 90% screen, NOT 120px"
 * assertions FAIL.
 */

import {
  computeSheetHeight,
  MAX_SNAP_RATIO,
  MIN_SNAP_PX,
  SNAP_RATIOS,
} from "../sheetSnapHeight";

const SCREEN = 800; // a typical phone screen height in px

describe("ORCH-1206 — computeSheetHeight numeric ratio semantics", () => {
  describe("(T-1206-01) fractional numeric snapPoint = RATIO of screen (the bug)", () => {
    it("0.9 → ~90% of screen height, NOT the 120px MIN_SNAP_PX floor", () => {
      const h = computeSheetHeight(0.9, SCREEN);
      // 0.9 * 800 = 720 (still under the 95% = 760 cap)
      expect(h).toBeCloseTo(SCREEN * 0.9, 5);
      expect(h).toBe(720);
      // The pre-fix bug clamped this UP to MIN_SNAP_PX (120). It must NOT.
      expect(h).not.toBe(MIN_SNAP_PX);
      expect(h).toBeGreaterThan(MIN_SNAP_PX);
    });

    it("the venue-suite ratios (0.7–0.92) all render as that fraction of screen", () => {
      for (const ratio of [0.7, 0.75, 0.8, 0.85, 0.9, 0.92]) {
        const h = computeSheetHeight(ratio, SCREEN);
        expect(h).toBeCloseTo(SCREEN * ratio, 5);
        expect(h).toBeGreaterThan(MIN_SNAP_PX);
      }
    });

    it("1.0 (exactly the screen) → still a ratio (full screen), capped at 95%", () => {
      const h = computeSheetHeight(1, SCREEN);
      // ratio path gives 800, then capped to 95% = 760
      expect(h).toBe(SCREEN * MAX_SNAP_RATIO);
    });
  });

  describe("(T-1206-02) numeric > 1 = ABSOLUTE PIXELS (backward-compatible)", () => {
    it("520 → 520px (real pixel callers pass values > 1)", () => {
      expect(computeSheetHeight(520, SCREEN)).toBe(520);
    });

    it("a tiny pixel value is clamped UP to the MIN_SNAP_PX floor", () => {
      // e.g. a measured onLayout height of 40px should still floor at 120.
      expect(computeSheetHeight(40, SCREEN)).toBe(MIN_SNAP_PX);
    });

    it("a huge pixel value is capped at 95% of screen", () => {
      expect(computeSheetHeight(99999, SCREEN)).toBe(SCREEN * MAX_SNAP_RATIO);
    });
  });

  describe("(T-1206-03) string presets unchanged", () => {
    it("'half' → 50% of screen", () => {
      expect(computeSheetHeight("half", SCREEN)).toBe(SCREEN * SNAP_RATIOS.half);
      expect(computeSheetHeight("half", SCREEN)).toBe(400);
    });

    it("'peek' → 25%, 'full' → 90% of screen", () => {
      expect(computeSheetHeight("peek", SCREEN)).toBe(SCREEN * 0.25);
      expect(computeSheetHeight("full", SCREEN)).toBe(SCREEN * 0.9);
    });
  });
});
