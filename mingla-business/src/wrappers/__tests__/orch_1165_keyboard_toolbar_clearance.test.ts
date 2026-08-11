/**
 * ORCH-1165 — keyboard Done-bar clearance regression test (implementor
 * happy-path; the tester adds a second, adversarial angle separately).
 *
 * The app-wide Done bar (react-native-keyboard-controller <KeyboardToolbar>)
 * is exactly KEYBOARD_TOOLBAR_HEIGHT = 42pt tall and sits ON TOP of the
 * keyboard. The SmartScrollView auto-scroll clearance (`DEFAULT_BOTTOM_OFFSET`)
 * MUST be >= 42 so the focused field lands above the bar instead of behind it
 * — the exact occlusion Seth flagged. This test guards the structural invariant
 * I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE.
 *
 * #1834 [keyboard-blocks-bank-field] — assertion 1 EXECUTES the wrapper instead
 * of regex-parsing its source. It used to require the literal form
 * `export const DEFAULT_BOTTOM_OFFSET = <digits>;` and parse the digits out.
 * That pin is now actively wrong: #1834 measured the Done bar OCCUPYING 53pt on
 * iOS 26+ (the library floats it 11pt clear of the keyboard's rounded corners)
 * and the auto-scroll aligning the focused TextInput's inner text frame rather
 * than the `Input` primitive's bordered box, so the constant had to become a
 * per-platform derivation — an expression the old regex can no longer match. It
 * is also the source-text-pin shape that `i-proposed-1047-biz-no-sole-source-pin`
 * exists to reject. Importing the real module is strictly stronger: it still
 * fails if the clearance ever drops below the bar's own height, and it now also
 * moves when the derivation moves.
 *
 * Reverting `DEFAULT_BOTTOM_OFFSET` below KEYBOARD_TOOLBAR_HEIGHT makes this
 * FAIL (fails-on-revert proof captured in IMPLEMENTATION_ORCH-1165_*.md and
 * re-demonstrated on #1834).
 */

// The native keyboard library touches its native bindings at import time and
// cannot load under this default node/ts-jest runtime, so it is mocked with a
// DISTINCT sentinel — the same technique the #1834 tester suite uses. Only the
// wrapper's own exported arithmetic is under test here; the library component
// is never rendered.
jest.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: "KeyboardAwareScrollView@library",
}));

import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_BOTTOM_OFFSET,
  DONE_BAR_OCCUPIED,
  INPUT_CHROME_BELOW_TEXT_FRAME,
  KEYBOARD_TOOLBAR_HEIGHT,
  MIN_VISIBLE_CLEARANCE,
} from "../SmartScrollView.native";

const WRAPPERS_DIR = path.resolve(__dirname, "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(WRAPPERS_DIR, relativePath), "utf8");

describe("ORCH-1165 keyboard Done-bar clearance", () => {
  it("SmartScrollView.native exports DEFAULT_BOTTOM_OFFSET >= 42 (KEYBOARD_TOOLBAR_HEIGHT)", () => {
    // Must be EXPORTED and must be a number the module actually computes — the
    // import itself is the "is it exported" proof, and a broken derivation
    // surfaces as NaN/undefined here rather than as a matching regex.
    expect(typeof DEFAULT_BOTTOM_OFFSET).toBe("number");
    expect(Number.isFinite(DEFAULT_BOTTOM_OFFSET)).toBe(true);

    // ORCH-1165: the Done bar is KEYBOARD_TOOLBAR_HEIGHT (42) tall. If this
    // clearance drops below 42, the bar occludes the focused field — the exact
    // regression Seth flagged. Do NOT lower below 42.
    // (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE)
    expect(KEYBOARD_TOOLBAR_HEIGHT).toBe(42);
    expect(DEFAULT_BOTTOM_OFFSET).toBeGreaterThanOrEqual(KEYBOARD_TOOLBAR_HEIGHT);

    // #1834: and the budget is still the three named terms, in the open —
    // bar height + input chrome + visible clearance — with the promised gap
    // left over after both costs are paid.
    expect(DEFAULT_BOTTOM_OFFSET).toBe(
      DONE_BAR_OCCUPIED + INPUT_CHROME_BELOW_TEXT_FRAME + MIN_VISIBLE_CLEARANCE,
    );
    expect(DONE_BAR_OCCUPIED).toBeGreaterThanOrEqual(KEYBOARD_TOOLBAR_HEIGHT);
    expect(MIN_VISIBLE_CLEARANCE).toBeGreaterThanOrEqual(12);
  });

  it("KeyboardToolbarRoot.native renders the toolbar Done-only (showArrows={false})", () => {
    const src = read("KeyboardToolbarRoot.native.tsx");
    // No Prev/Next chevrons — Seth-locked Done-only. A future edit must not
    // silently re-enable the arrows.
    expect(src).toMatch(/showArrows\s*=\s*\{\s*false\s*\}/);
  });
});
