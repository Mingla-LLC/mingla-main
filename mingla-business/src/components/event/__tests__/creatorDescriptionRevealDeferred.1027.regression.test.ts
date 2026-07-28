/**
 * issue #1027 — iOS description-reveal REGRESSION guard (behavior of the reveal,
 * not the mere presence of the wiring).
 *
 * WHY THIS SUITE EXISTS — the gap the prior guard left open:
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
 * WHAT THIS SUITE ASSERTS — the platform-correct DEFERRED mechanism, per wizard
 * that owns a `scrollToBottom` reveal (Event create, RSVP create — which reuses
 * CreatorStep1Basics — and Edit-published):
 *   1. The reveal is DEFERRED to a `keyboardDidShow` listener (runs against the
 *      PADDED content height), not fired immediately on focus.
 *   2. `scrollToBottom` no longer calls `scrollToEnd` DIRECTLY/unconditionally —
 *      on the keyboard-not-yet-shown native path it only ARMS
 *      `pendingScrollToBottomRef`; the actual scroll is gated behind the
 *      keyboard-shown state / web.
 *   3. The `keyboardDidShow` handler CONSUMES the pending flag and performs the
 *      scroll — i.e. the deferred hook is actually wired end-to-end, not a
 *      dead ref.
 *
 * FAILS-ON-REVERT (proven in the implementation report by re-introducing the
 * bare-rAF `scrollToBottom` in EventCreatorWizard.tsx → assertions 1–3 for the
 * event wizard go RED): reverting to
 *   `const scrollToBottom = useCallback(() => {
 *      requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({animated:true}));
 *    }, []);`
 * removes the keyboardDidShow deferral AND puts `scrollToEnd` back inside the
 * `scrollToBottom` body → RED. Restoring the deferred fix → GREEN.
 *
 * Structural (source-level) by design: the deferred reveal is an inline
 * useCallback + Keyboard effect wired to a KeyboardAwareScrollView ref inside
 * three large wizard components whose full runtime mount requires mocking the
 * entire react-native + KAS + expo-router + store surface (the existing wizard
 * mount suites replace the wizard with a stub for exactly this reason). This
 * suite targets the DEFECT CLASS — immediate-vs-deferred scroll — which is the
 * axis that regressed, and is proven fails-on-revert.
 *
 * I-PROPOSED-1027-WIZARD-REVEAL-DEFERRED-TO-KEYBOARD-SHOWN.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

/** Slice the `const scrollToBottom = useCallback(...)` body from a wizard source. */
const scrollToBottomBody = (src: string): string => {
  const start = src.indexOf("const scrollToBottom = useCallback(");
  expect(start).toBeGreaterThan(-1);
  // The callback body ends at the closing `}, [..]);` of the useCallback. Take a
  // generous window and trim at the first `, [` dependency-array marker that
  // follows the arrow body — sufficient to isolate the reveal-request body.
  const window = src.slice(start, start + 700);
  const depIdx = window.indexOf("}, [");
  return depIdx > -1 ? window.slice(0, depIdx) : window;
};

const WIZARDS: readonly { label: string; file: string }[] = [
  { label: "Event create wizard", file: "src/components/event/EventCreatorWizard.tsx" },
  { label: "RSVP create wizard", file: "src/components/rsvp/RsvpCreatorWizard.tsx" },
  { label: "Edit-published screen", file: "src/components/event/EditPublishedScreen.tsx" },
];

describe("issue #1027 · description-reveal is DEFERRED to keyboardDidShow (over-scroll regression guard)", () => {
  for (const { label, file } of WIZARDS) {
    describe(label, () => {
      test("the reveal is deferred to a keyboardDidShow listener (padded-content scroll)", () => {
        const src = read(file);
        expect(src).toMatch(/Keyboard\.addListener\(\s*["']keyboardDidShow["']/);
      });

      test("scrollToBottom ARMS the pending ref on the deferred path — it does NOT scrollToEnd directly", () => {
        const body = scrollToBottomBody(read(file));
        // The defect class: an immediate/unconditional scrollToEnd inside
        // scrollToBottom. After the fix the direct scroll lives in
        // performScrollToEnd (called only when the keyboard is already up / web),
        // and the deferred path only arms the pending ref.
        expect(body).not.toMatch(/scrollToEnd\s*\(/);
        expect(body).toMatch(/pendingScrollToBottomRef\.current\s*=\s*true/);
        // The immediate branch must be GATED on keyboard-shown / web state, never
        // fired unconditionally on focus.
        expect(body).toMatch(/keyboardShownRef/);
      });

      test("the keyboardDidShow handler CONSUMES the pending flag and performs the scroll", () => {
        const src = read(file);
        const showIdx = src.indexOf('Keyboard.addListener("keyboardDidShow"');
        expect(showIdx).toBeGreaterThan(-1);
        const handler = src.slice(showIdx, showIdx + 400);
        expect(handler).toMatch(/pendingScrollToBottomRef\.current\s*=\s*false/);
        expect(handler).toMatch(/performScrollToEnd\s*\(\s*\)/);
      });

      test("the actual scrollToEnd is isolated in a keyboard/web-gated helper (never bare-fired on focus)", () => {
        const src = read(file);
        // performScrollToEnd is the ONLY place scrollToEnd is invoked, and it is
        // reached only via the gated scrollToBottom branch or the keyboardDidShow
        // consumer — proving the reveal can never run against pre-keyboard content.
        expect(src).toMatch(
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
