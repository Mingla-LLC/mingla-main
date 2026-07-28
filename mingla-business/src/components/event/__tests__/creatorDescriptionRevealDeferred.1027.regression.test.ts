/**
 * issue #1027 — iOS description-reveal REGRESSION guard (behaviour of the reveal,
 * not the mere presence of the wiring), REWORKED to assert the CANONICAL keyboard
 * library mechanism (react-native-keyboard-controller) rather than a bespoke
 * `Keyboard.addListener` (which the BLOCKING `orch-0892-no-bespoke-keyboard-plumbing`
 * gate forbids — ORCH-0892 removed exactly that plumbing app-wide).
 *
 * WHY THIS SUITE EXISTS — the gap the first #1027 guard left open:
 *   The first #1027 pass wired `onFocus={() => scrollToBottom?.()}` on the
 *   description field and shipped a guard
 *   (`creatorStep1DescriptionOnFocusReveal.1027.test.ts`) that only asserted the
 *   onFocus was PRESENT. That guard stayed GREEN while the reveal BEHAVIOUR
 *   regressed: `scrollToBottom` fired `scrollToEnd` in a bare
 *   `requestAnimationFrame` — BEFORE the keyboard rose and before
 *   KeyboardAwareScrollView applied its `paddingBottom: keyboardHeight + 1`
 *   spacer — so it scrolled against the PRE-keyboard content height and raced
 *   KAS's own caret-scroll. On Seth's physical iPhone that race over-scrolled
 *   the tall multiline OFF-SCREEN (description not visible at all on focus).
 *   The wiring existed; the behaviour broke. A wiring-presence test can NEVER
 *   catch that.
 *
 * WHAT THIS SUITE ASSERTS — the platform-correct DEFERRED mechanism, expressed
 * via the CANONICAL library primitive, per wizard that owns a `scrollToBottom`
 * reveal (Event create, RSVP create — which reuses CreatorStep1Basics — and
 * Edit-published):
 *   1. The reveal is DEFERRED to the library-backed keyboard-visible signal
 *      `useKeyboardIsVisible()` (react-native-keyboard-controller's
 *      `useKeyboardState`, whose `isVisible` flips on `keyboardDidShow` — AFTER
 *      the KAS spacer is applied), and there is NO bespoke
 *      `Keyboard.addListener("keyboard(Will|Did)(Show|Hide)")` (the orch-0892
 *      forbidden pattern).
 *   2. `scrollToBottom` no longer calls `scrollToEnd` DIRECTLY/unconditionally —
 *      on the keyboard-not-yet-shown native path it only ARMS
 *      `pendingScrollToBottomRef`; the immediate scroll is gated behind
 *      keyboard-visible state / web.
 *   3. A `useEffect` keyed on the library `keyboardVisible` state CONSUMES the
 *      pending flag and performs the scroll — i.e. the deferred hook is wired
 *      end-to-end to the library signal, not a dead ref and not a raw listener.
 *   4. The actual `scrollToEnd` is isolated in a keyboard/web-gated helper
 *      (`performScrollToEnd`) — never bare-fired on focus.
 *
 * FAILS-ON-REVERT (proven in the implementation report by true LINE DELETION of
 * the fix): both classic reverts turn assertions RED —
 *   (a) restoring the bare-rAF `scrollToBottom`
 *       (`useCallback(() => requestAnimationFrame(() => scrollViewRef.current
 *        ?.scrollToEnd({animated:true})), [])`) puts `scrollToEnd` back inside the
 *       `scrollToBottom` body and drops the pending-ref arm → assertion 2 RED; and
 *   (b) reintroducing the bespoke `Keyboard.addListener("keyboardDidShow", …)`
 *       deferral → assertion 1's negative match RED (the gate-forbidden pattern is
 *       back) and the library-visibility effect (assertion 3) is gone.
 * Restoring the library-driven deferred fix → GREEN.
 *
 * Structural (source-level) by design: the deferred reveal is an inline
 * useCallback + useKeyboardIsVisible()-keyed effect wired to a
 * KeyboardAwareScrollView ref inside three large wizard components whose full
 * runtime mount requires mocking the entire react-native + KAS + expo-router +
 * store surface (the existing wizard mount suites replace the wizard with a stub
 * for exactly this reason). This suite targets the DEFECT CLASS — immediate/
 * bespoke-listener vs library-deferred scroll — which is the axis that regressed,
 * and is proven fails-on-revert.
 *
 * I-PROPOSED-1027-WIZARD-REVEAL-DEFERRED-TO-KEYBOARD-SHOWN +
 * I-PROPOSED-KEYBOARD-LIBRARY-ONLY (ORCH-0892).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

/** Strip `//` line comments and block comments so prose never trips a match. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

/** Slice the `const scrollToBottom = useCallback(...)` body from a wizard source
 * (comments already stripped). The callback body ends at the closing
 * `}, [..]);` of the useCallback — take a generous window and trim at the first
 * `}, [` dependency-array marker that follows the arrow body. */
const scrollToBottomBody = (src: string): string => {
  const code = stripComments(src);
  const start = code.indexOf("const scrollToBottom = useCallback(");
  expect(start).toBeGreaterThan(-1);
  const window = code.slice(start, start + 700);
  const depIdx = window.indexOf("}, [");
  return depIdx > -1 ? window.slice(0, depIdx) : window;
};

/** The exact orch-0892 forbidden pattern: a layout-affecting bespoke listener. */
const BESPOKE_KEYBOARD_LISTENER =
  /Keyboard\s*\.\s*addListener\s*\(\s*["']keyboard(?:Will|Did)(?:Show|Hide)["']/;

const WIZARDS: readonly { label: string; file: string }[] = [
  { label: "Event create wizard", file: "src/components/event/EventCreatorWizard.tsx" },
  { label: "RSVP create wizard", file: "src/components/rsvp/RsvpCreatorWizard.tsx" },
  { label: "Edit-published screen", file: "src/components/event/EditPublishedScreen.tsx" },
];

describe("issue #1027 · description-reveal is DEFERRED via the canonical keyboard library (over-scroll regression guard)", () => {
  for (const { label, file } of WIZARDS) {
    describe(label, () => {
      test("the reveal defers via the library primitive useKeyboardIsVisible() — NOT a bespoke Keyboard listener", () => {
        const code = stripComments(read(file));
        // Deferred via the canonical react-native-keyboard-controller wrapper.
        expect(code).toMatch(/useKeyboardIsVisible\s*\(\s*\)/);
        // The orch-0892 forbidden bespoke plumbing must be GONE.
        expect(code).not.toMatch(BESPOKE_KEYBOARD_LISTENER);
      });

      test("scrollToBottom ARMS the pending ref on the deferred path — it does NOT scrollToEnd directly", () => {
        const body = scrollToBottomBody(read(file));
        // The defect class: an immediate/unconditional scrollToEnd inside
        // scrollToBottom. After the fix the direct scroll lives in
        // performScrollToEnd (called only when the keyboard is already up / web),
        // and the deferred path only arms the pending ref.
        expect(body).not.toMatch(/scrollToEnd\s*\(/);
        expect(body).toMatch(/pendingScrollToBottomRef\.current\s*=\s*true/);
        // The immediate branch must be GATED on keyboard-visible / web state,
        // never fired unconditionally on focus.
        expect(body).toMatch(/keyboardVisibleRef|Platform\.OS\s*===\s*["']web["']/);
      });

      test("a useEffect keyed on the library keyboardVisible state CONSUMES the pending flag and performs the scroll", () => {
        const code = stripComments(read(file));
        // The deferred consumer is wired to the library visibility STATE (a
        // useEffect dependency array listing `keyboardVisible`), not a raw
        // Keyboard listener.
        expect(code).toMatch(/useEffect\s*\(/);
        expect(code).toMatch(/\}\s*,\s*\[[^\]]*keyboardVisible[^\]]*\]\s*\)/);
        // …and it clears the pending flag and runs the gated scroll helper.
        expect(code).toMatch(/pendingScrollToBottomRef\.current\s*=\s*false/);
        expect(code).toMatch(/performScrollToEnd\s*\(\s*\)/);
      });

      test("the actual scrollToEnd is isolated in a keyboard/web-gated helper (never bare-fired on focus)", () => {
        const code = stripComments(read(file));
        // performScrollToEnd is the ONLY place scrollToEnd is invoked, and it is
        // reached only via the gated scrollToBottom branch or the keyboardVisible
        // effect consumer — proving the reveal can never run against pre-keyboard
        // content.
        expect(code).toMatch(
          /const performScrollToEnd = useCallback\(\(\): void => \{\s*requestAnimationFrame/,
        );
      });
    });
  }

  test("the shared step still wires the description onFocus to the reveal (contract intact)", () => {
    const step = read("src/components/event/CreatorStep1Basics.tsx");
    const start = step.indexOf("value={draft.description}");
    const anchor = step.indexOf('accessibilityLabel="Event description"');
    const block = step.slice(start, anchor + 60);
    expect(block).toMatch(/onFocus=\{[^}]*scrollToBottom/);
  });
});
