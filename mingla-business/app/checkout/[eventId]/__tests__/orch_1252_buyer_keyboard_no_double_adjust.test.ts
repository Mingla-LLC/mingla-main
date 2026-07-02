/**
 * ORCH-1252 — checkout "Your details" keyboard over-scroll regression test
 * (implementor HAPPY-PATH angle).
 *
 * THE BUG: on a real iPhone, tapping the Full name / Email / Phone field on the
 * buyer-details checkout step auto-scrolled the focused field almost/fully OFF
 * the TOP of the screen. ROOT CAUSE: a DOUBLE keyboard adjustment — the screen
 * had a manual `Keyboard.addListener` that (a) added dynamic
 * `paddingBottom: keyboardHeight + 140 + 42` to the ScrollView and (b) fired a
 * manual `scrollToEnd` on keyboard show. That STACKED on top of the
 * keyboard-aware scroller's own auto-scroll, overshooting the field off-screen.
 *
 * THE FIX: delegate focused-field scrolling entirely to SmartScrollView
 * (react-native-keyboard-controller's KeyboardAwareScrollView, bottomOffset=54).
 * Remove the keyboardHeight-based padding, the manual scrollToEnd effects, and
 * the manual Keyboard.addListener. All that remains is a single visibility
 * boolean (useKeyboardIsVisible) used ONLY to hide the sticky bottom bar.
 *
 * Source-text approach (mirrors src/wrappers/__tests__/
 * orch_1165_keyboard_toolbar_clearance.test.ts + KeyboardRoot.test.tsx): the
 * fix is a pure scroll/layout behavior with no unit-testable runtime seam
 * (rendering the screen needs the full cart + phone-input + router provider
 * stack). We assert the structural invariant on the three buyer screens' source.
 *
 * FAILS-ON-REVERT: re-introducing the manual `keyboardHeight + 140 + 42` padding
 * (or the `Keyboard.addListener` / `scrollToEnd`) makes these FAIL; the shipped
 * fix PASSES. Fails-on-revert hash recorded in the PR body.
 */

import fs from "node:fs";
import path from "node:path";

const BUYER_SCREENS: ReadonlyArray<{ label: string; file: string }> = [
  {
    label: "event checkout",
    file: "checkout/[eventId]/buyer.tsx",
  },
  {
    label: "trip checkout",
    file: "checkout-trip/[tripEventId]/buyer.tsx",
  },
  {
    label: "experience checkout",
    file: "checkout-experience/[experienceEventId]/buyer.tsx",
  },
];

// __dirname = app/checkout/[eventId]/__tests__  →  app/ is three levels up.
const APP_DIR = path.resolve(__dirname, "..", "..", "..");

const readScreen = (relativePath: string): string =>
  fs.readFileSync(path.join(APP_DIR, relativePath), "utf8");

describe("ORCH-1252 buyer checkout — no double keyboard adjustment", () => {
  describe.each(BUYER_SCREENS)("$label ($file)", ({ file }) => {
    const src = readScreen(file);

    it("does NOT add keyboardHeight-based paddingBottom to the scroll content (the double-adjust)", () => {
      // The buggy line was:
      //   keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 + 42 } : null
      // Any keyboard-height-driven padding re-introduces the overshoot.
      expect(src).not.toMatch(/paddingBottom:\s*keyboardHeight/);
      expect(src).not.toMatch(/keyboardHeight\s*\+\s*140/);
    });

    it("keeps the base insets-driven paddingBottom (insets.bottom + 140) as the ONLY scroll-content bottom padding", () => {
      // The static base padding stays so content isn't hidden behind the bar.
      expect(src).toMatch(/paddingBottom:\s*insets\.bottom\s*\+\s*140/);
    });

    it("does NOT run a manual Keyboard.addListener (library owns keyboard tracking)", () => {
      expect(src).not.toMatch(/Keyboard\.addListener/);
    });

    it("does NOT manually scrollToEnd on keyboard show (that double-scrolls)", () => {
      expect(src).not.toMatch(/scrollToEnd/);
    });

    it("no longer tracks a keyboardHeight state (dead state removed)", () => {
      expect(src).not.toMatch(/keyboardHeight/);
    });

    it("delegates focused-field scroll to SmartScrollView (sole scroller)", () => {
      expect(src).toMatch(
        /import\s*\{\s*ScrollView\s*\}\s*from\s*["'][^"']*wrappers\/SmartScrollView["']/,
      );
      // And NOT react-native's plain ScrollView (which would not auto-reveal).
      expect(src).not.toMatch(
        /import\s*\{[^}]*\bScrollView\b[^}]*\}\s*from\s*["']react-native["']/,
      );
    });
  });
});
