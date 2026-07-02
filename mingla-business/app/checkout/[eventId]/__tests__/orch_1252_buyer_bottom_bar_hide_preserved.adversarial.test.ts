/**
 * ORCH-1252 — ADVERSARIAL angle: prove the fix did NOT break the ONE behavior
 * that legitimately depended on the keyboard listener.
 *
 * The buyer screen has a sticky bottom bar (Total + Continue button) that is
 * translated off-screen WHILE THE KEYBOARD IS OPEN, so it doesn't sit wedged
 * between the focused field and the keyboard. That hide previously keyed off
 * `keyboardHeight > 0`. Ripping out the manual `keyboardHeight` state (the fix)
 * risks silently deleting the bottom-bar hide too — which would regress a
 * different UX (bar overlapping the keyboard).
 *
 * This test attacks exactly that risk: after the fix, the bottom-bar hide MUST
 * still be driven by a keyboard-visible signal (`keyboardVisible` from
 * useKeyboardIsVisible), and the `bottomBarHidden` style must still exist and
 * still be conditionally applied. It also re-asserts (from a different file
 * angle than the happy-path test) that NO manual scrollToEnd survives.
 *
 * FAILS-ON-REVERT: if a "fix" removed the bottom-bar hide, or left it keyed off
 * the deleted `keyboardHeight`, these FAIL. Hash recorded in the PR body.
 */

import fs from "node:fs";
import path from "node:path";

const BUYER_SCREENS: ReadonlyArray<{ label: string; file: string }> = [
  { label: "event checkout", file: "checkout/[eventId]/buyer.tsx" },
  { label: "trip checkout", file: "checkout-trip/[tripEventId]/buyer.tsx" },
  {
    label: "experience checkout",
    file: "checkout-experience/[experienceEventId]/buyer.tsx",
  },
];

const APP_DIR = path.resolve(__dirname, "..", "..", "..");
const readScreen = (relativePath: string): string =>
  fs.readFileSync(path.join(APP_DIR, relativePath), "utf8");

describe("ORCH-1252 buyer checkout — bottom-bar hide preserved", () => {
  describe.each(BUYER_SCREENS)("$label ($file)", ({ file }) => {
    const src = readScreen(file);

    it("still defines the bottomBarHidden style (the hide affordance survives)", () => {
      expect(src).toMatch(/bottomBarHidden\s*:/);
    });

    it("still conditionally applies bottomBarHidden while the keyboard is open", () => {
      // The hide must be conditionally applied on a keyboard-visible signal.
      expect(src).toMatch(
        /keyboardVisible\s*\?\s*styles\.bottomBarHidden\s*:\s*null/,
      );
    });

    it("drives the hide from useKeyboardIsVisible (the retained minimal signal), not manual keyboardHeight", () => {
      expect(src).toMatch(
        /const\s+keyboardVisible\s*=\s*useKeyboardIsVisible\(\)/,
      );
      expect(src).toMatch(
        /import\s*\{\s*useKeyboardIsVisible\s*\}\s*from\s*["'][^"']*wrappers\/useKeyboardIsVisible["']/,
      );
      // The retained signal must NOT be the height-based state that caused the bug.
      expect(src).not.toMatch(/keyboardHeight\s*>\s*0\s*\?\s*styles\.bottomBarHidden/);
    });

    it("fires no manual scrollToEnd anywhere in the screen (attacked from the retained-behavior side)", () => {
      expect(src).not.toMatch(/scrollToEnd/);
      expect(src).not.toMatch(/pendingScrollToBottom/);
      expect(src).not.toMatch(/requestScrollToInput/);
    });
  });
});
