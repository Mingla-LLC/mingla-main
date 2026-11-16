/**
 * #4420 device round 2 — keyboard inside the native bottom Sheet.
 *
 * Seen on the iOS simulator: inside every Sheet (its own RN <Modal> window) the
 * Done bar never showed, and Review changes' Save / Cancel sat behind the
 * keyboard. Root cause: the library bar's KeyboardStickyView follows the
 * provider's RN-Animated keyboard height, which never moves inside a Modal
 * window, while the same provider's Reanimated values do (the sheet's
 * useKeyboardHeight received 308). FAILS ON REVERT: put the bar back on the
 * library sticky translate, drop the sheet body's keyboard padding, drop the
 * scroll view's footer offset, or let SheetScrollLayout lift a second time
 * inside the sheet, and the matching assertion goes red.
 */
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../wrappers/keyboardClearance", () => ({ DONE_BAR_OCCUPIED: 53, MIN_VISIBLE_CLEARANCE: 12 }));

import { sheetKeyboardBottomPad, sheetScrollExtraOffset } from "../overlayKeyboard";

const read = (rel: string): string => fs.readFileSync(path.resolve(__dirname, "../../../..", rel), "utf8");

describe("#4420 round 2: the sheet body clears the keyboard and its Done bar", () => {
  test("closed keyboard: no keyboard padding (the sheet keeps its resting padding)", () => {
    expect(sheetKeyboardBottomPad(0)).toBe(0);
  });

  test("open keyboard: the body ends above the keyboard, the bar and the clearance", () => {
    // iPhone 17 Pro: 308 keyboard + 53 bar + 12 clearance.
    expect(sheetKeyboardBottomPad(308)).toBe(373);
  });

  test("the body scroll view places the field above a pinned footer, not behind it", () => {
    // No footer: only the lifted body's clearance.
    expect(sheetScrollExtraOffset(0, 0)).toBe(12);
    // Review changes: a 120pt Save / Cancel footer under the scroll view.
    expect(sheetScrollExtraOffset(120, 0)).toBe(132);
    // A short sheet that rose 80pt for the keyboard: the scroll view measured
    // the field before the rise, so the offset gives the rise back.
    expect(sheetScrollExtraOffset(120, 80)).toBe(52);
    // Negative measurements never widen the gap.
    expect(sheetScrollExtraOffset(-5, -5)).toBe(12);
  });
});

describe("#4420 round 2: wiring", () => {
  const toolbar = read("src/wrappers/KeyboardToolbarRoot.native.tsx");
  const sheet = read("src/components/ui/SheetMobile.tsx");
  const scroll = read("src/wrappers/SmartScrollView.native.tsx");
  const layout = read("src/components/ui/SheetScrollLayout.tsx");
  const review = read("src/components/event/ChangeSummaryModal.tsx");

  test("the Done bar rides the Reanimated keyboard height, not the library sticky translate", () => {
    expect(toolbar).toMatch(/useReanimatedKeyboardAnimation\(\)/);
    expect(toolbar).toMatch(/translateY: height\.value \+ OPENED_OFFSET/);
    expect((toolbar.match(/^\s+enabled=\{false\}$/gm) ?? []).length).toBe(2);
    expect((toolbar.match(/<DoneBarDock>/g) ?? []).length).toBe(2);
    expect(toolbar).toMatch(/closed: -KEYBOARD_TOOLBAR_HEIGHT/);
  });

  test("the sheet pads its body for the keyboard and shares the layout with its scroll view", () => {
    expect(sheet).toMatch(/sheetKeyboardBottomPad\(keyboardHeight\)/);
    expect(sheet).toMatch(/<SheetKeyboardContext\.Provider value=\{layout\}>/);
    expect(sheet).toMatch(/keyboardBottomPad > 0 \? keyboardBottomPad : space\[6\] \+ bottomInset/);
    // The Modal wrapper and the per-window provider + toolbar stay (I-13, ORCH-1170).
    expect(sheet).toMatch(/<Modal\b/);
    expect(sheet).toMatch(/<KeyboardRoot>/);
    expect(sheet).toMatch(/<KeyboardToolbarRoot \/>/);
  });

  test("the scroll view adds the measured footer gap inside a sheet only", () => {
    expect(scroll).toMatch(/useContext\(SheetKeyboardContext\)/);
    expect(scroll).toMatch(/sheet === null \? 0 : sheetScrollExtraOffset\(footerGap, sheet\.topShift\)/);
    expect(scroll).toMatch(/bottomOffset=\{bottomOffset \+ sheetExtraOffset\}/);
  });

  test("SheetScrollLayout does not lift a second time inside the sheet", () => {
    expect(layout).toMatch(/sheet === null \? sheetKeyboardLift\(keyboardHeight, insets\.bottom\) : 0/);
  });

  test("Review changes scrolls its title so the reason field fits above Save / Cancel", () => {
    const scrollAt = review.indexOf("<ScrollView");
    expect(scrollAt).toBeGreaterThan(-1);
    expect(review.indexOf("Review changes</Text>")).toBeGreaterThan(scrollAt);
  });
});
