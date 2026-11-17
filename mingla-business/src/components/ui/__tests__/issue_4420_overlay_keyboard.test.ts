/**
 * #4420 — the one overlay / keyboard geometry rule (overlayKeyboard.ts).
 *
 * Seth's bar: no sheet or dialog ever runs off screen on any phone, and the
 * keyboard never covers a field. FAILS ON REVERT: drop the safe-area clamp (a
 * 95% "full" sheet runs under the Dynamic Island on a 667pt phone), drop the
 * short-sheet rise (a half sheet on an SE leaves ~30pt above the keyboard), or
 * stop centring dialogs above the keyboard.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../wrappers/keyboardClearance", () => ({ DONE_BAR_OCCUPIED: 42, MIN_VISIBLE_CLEARANCE: 12 }));

import {
  MIN_SHEET_VISIBLE_ABOVE_KEYBOARD,
  OVERLAY_TOP_GAP,
  clampOverlayHeight,
  dialogKeyboardInset,
  dialogMaxHeight,
  keyboardSheetHeight,
  maxOverlayHeight,
} from "../overlayKeyboard";
import { computeSheetHeight } from "../sheetSnapHeight";

const PHONES = [
  { name: "iPhone SE", height: 667, top: 20 },
  { name: "iPhone 16", height: 852, top: 59 },
  { name: "iPhone 16 Pro Max", height: 956, top: 62 },
  { name: "Pixel 8", height: 915, top: 52 },
  { name: "small Android", height: 640, top: 24 },
];

describe("#4420 overlay geometry", () => {
  test.each(PHONES)("$name: every snap height stays below the top safe area", ({ height, top }) => {
    for (const snap of ["peek", "half", "full", 0.95, 2000] as const) {
      const clamped = clampOverlayHeight(computeSheetHeight(snap, height), height, top);
      expect(clamped).toBeLessThanOrEqual(height - top - OVERLAY_TOP_GAP);
      expect(clamped).toBeGreaterThan(0);
    }
  });

  test("a height that already fits is untouched", () => {
    expect(clampOverlayHeight(300, 852, 59)).toBe(300);
    expect(maxOverlayHeight(852, 59)).toBe(852 - 59 - OVERLAY_TOP_GAP);
  });

  test.each(PHONES)("$name: with the keyboard up a sheet always shows a field above it", ({ height, top }) => {
    const keyboard = Math.round(height * 0.4);
    for (const snap of ["peek", "half", "full"] as const) {
      const resting = clampOverlayHeight(computeSheetHeight(snap, height), height, top);
      const withKeyboard = keyboardSheetHeight(resting, keyboard, height, top);
      // never off screen
      expect(withKeyboard).toBeLessThanOrEqual(height - top - OVERLAY_TOP_GAP);
      // never shorter than at rest
      expect(withKeyboard).toBeGreaterThanOrEqual(resting);
      const visible = withKeyboard - keyboard - 42;
      const room = height - top - OVERLAY_TOP_GAP - keyboard - 42;
      expect(visible).toBeGreaterThanOrEqual(Math.min(MIN_SHEET_VISIBLE_ABOVE_KEYBOARD, room));
    }
  });

  test("a tall sheet keeps its height when the keyboard opens (no movement, so the field lands flush)", () => {
    const resting = clampOverlayHeight(computeSheetHeight("full", 852), 852, 59);
    expect(keyboardSheetHeight(resting, 336, 852, 59)).toBe(resting);
  });

  test("keyboard closed: the sheet is at its resting height", () => {
    expect(keyboardSheetHeight(426, 0, 852, 59)).toBe(426);
  });

  test("dialogs centre above the keyboard and its Done bar", () => {
    expect(dialogKeyboardInset(0)).toBe(0);
    expect(dialogKeyboardInset(336)).toBe(336 + 42 + 12);
    const max = dialogMaxHeight(667, 20, 0, 260);
    expect(max).toBe(667 - 20 - OVERLAY_TOP_GAP - (260 + 42 + 12));
    // keyboard closed: bounded by both safe areas
    expect(dialogMaxHeight(852, 59, 34, 0)).toBe(852 - 59 - OVERLAY_TOP_GAP - 34 - OVERLAY_TOP_GAP);
  });
});
