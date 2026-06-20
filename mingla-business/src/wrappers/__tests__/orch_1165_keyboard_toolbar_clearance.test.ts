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
 * Source-text approach (mirrors KeyboardRoot.test.tsx) so the test needs no RN
 * native runtime: it reads the wrapper source and parses the exported literal.
 * Reverting `DEFAULT_BOTTOM_OFFSET` to 12 makes this FAIL; restoring 54 PASSES
 * (fails-on-revert proof captured in IMPLEMENTATION_ORCH-1165_*.md).
 */

import fs from "node:fs";
import path from "node:path";

const WRAPPERS_DIR = path.resolve(__dirname, "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(WRAPPERS_DIR, relativePath), "utf8");

describe("ORCH-1165 keyboard Done-bar clearance", () => {
  it("SmartScrollView.native exports DEFAULT_BOTTOM_OFFSET >= 42 (KEYBOARD_TOOLBAR_HEIGHT)", () => {
    const src = read("SmartScrollView.native.tsx");

    // Must be EXPORTED (the §9 contract requires it to be importable/parsable).
    expect(src).toMatch(
      /export\s+const\s+DEFAULT_BOTTOM_OFFSET\s*=\s*\d+\s*;/,
    );

    const match = src.match(
      /export\s+const\s+DEFAULT_BOTTOM_OFFSET\s*=\s*(\d+)\s*;/,
    );
    expect(match).not.toBeNull();

    // ORCH-1165: the Done bar is 42pt tall (KEYBOARD_TOOLBAR_HEIGHT). If this
    // clearance drops below 42, the bar occludes the focused field — the exact
    // regression Seth flagged. Do NOT lower below 42.
    // (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE)
    const value = Number.parseInt(match![1], 10);
    expect(value).toBeGreaterThanOrEqual(42);
  });

  it("KeyboardToolbarRoot.native renders the toolbar Done-only (showArrows={false})", () => {
    const src = read("KeyboardToolbarRoot.native.tsx");
    // No Prev/Next chevrons — Seth-locked Done-only. A future edit must not
    // silently re-enable the arrows.
    expect(src).toMatch(/showArrows\s*=\s*\{\s*false\s*\}/);
  });
});
