/**
 * #971 [paystack-onboard-scroll] — implementor happy-path regression.
 * Fast-follow / sibling of ORCH-1403 (onboardBodyScrolls.orch1403.source.test.ts).
 *
 * THE BUG: the Nigeria (Paystack) payout-onboarding body, reached on the SAME
 * `/brand/{id}/payments/onboard` route Seth reported ORCH-1403 on (BrandOnboardView
 * → pick Nigeria → the `paystackSelected` early-return branch), rendered its body in
 * a plain NON-scrolling `<View style={{ flex:1 }}>`. On a short (~640px) viewport the
 * tall Paystack bank-details card (pick bank → 10-digit NUBAN → verify holder name →
 * "Connect bank & get paid") is taller than the body box; with RN's default
 * `overflow:visible` the content spilled — the "Connect" action fell off-screen and
 * the heading collided with the fixed "Set up payments" top bar, exactly the
 * ORCH-1403 shape. ORCH-1403 wrapped the MAIN state-machine body in a ScrollView but
 * NOT this Paystack early-return branch, so the NG path stayed dark.
 *
 * WHY THE WRAP LIVES HERE (BrandOnboardView), NOT INSIDE BrandPaystackOnboardView:
 * that component's root is a content-sized <GlassCard> (no flex) that is embedded in
 * TWO parents — this flex:1 wrapper AND a parent ScrollView in BrandPaymentsView. A
 * flex:1 ScrollView nested inside the content-sized GlassCard collapses to height 0
 * (Yoga: flex:1 == flexBasis:0 in an auto-height parent), and nesting one inside
 * BrandPaymentsView's ScrollView double-collapses on native. The screen owner is the
 * only correct place to bound the scroll — exactly as ORCH-1403 did at
 * BrandOnboardView.host, and exactly like the reusable card stays passive.
 *
 * THE FIX: the Paystack branch body is wrapped in a `<ScrollView style={styles.bodyScroll}`
 * (flex:1 viewport under the fixed top bar) whose `contentContainerStyle` is
 * `styles.body` (flexGrow:1 + justifyContent:"center") — centers when the card fits,
 * SCROLLS when it doesn't. `renderTopBar({...})` stays OUTSIDE the scroll, always legible.
 *
 * THIS TEST is STRUCTURAL (not token-presence): it asserts the Paystack branch body
 * WRAPPER is a ScrollView whose content container is the centering `styles.body`, that
 * the bug shape (a plain flex:1 View right after the Paystack branch's `renderTopBar`)
 * is ABSENT, and that `styles.body`/`styles.bodyScroll` carry the centers-when-short /
 * scrolls-when-tall shape (flexGrow:1 + justifyContent:center; viewport flex:1).
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION of the fix, NOT a comment-out):
 *   revert the Paystack branch wrapper `<ScrollView … contentContainerStyle={[ styles.body`
 *   back to `<View style={{ flex: 1, … }}>` → assertions 2 and 3 FAIL.
 *
 * Append-only: NEW file; modifies/deletes no existing test. Runs under the default
 * `jest.config.cjs` (ts-jest / node) — no react-native import, no new config. Run:
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/paystackOnboardBodyScrolls.971.source.test.ts --runInBand
 */

import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(
  join(__dirname, "..", "BrandOnboardView.tsx"),
  "utf8",
);

// Isolate a `name: { … }` style object (anchored so it can't false-match
// `notFoundBody`, `poweredByText`, etc.).
function styleBlock(name: string): string {
  const m = SRC.match(
    new RegExp(`\\n\\s*${name}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`),
  );
  if (m === null) {
    throw new Error(`styles.${name} block not found in BrandOnboardView.tsx`);
  }
  return m[1];
}

describe("#971 — Paystack onboard body scrolls (no heading-over-top-bar overlap on the NG path)", () => {
  it("1. imports ScrollView from the SmartScrollView wrapper", () => {
    // #1834 [keyboard-blocks-bank-field] — this assertion used to pin the
    // import SOURCE to react-native. That pin was incidental to #971 (which is
    // about the body being scroll-WRAPPED) and it pinned the defect: a plain RN
    // ScrollView subscribes to no keyboard frames, so the NG account-number
    // Input sat under the keyboard + Done bar. The binding is now the canonical
    // wrapper; assertions 2-5 below are untouched.
    expect(SRC).toMatch(
      /import\s*\{\s*ScrollView\s*\}\s*from\s*["'][^"']*wrappers\/SmartScrollView["']/,
    );
  });

  it("2. the Paystack branch body wrapper is a ScrollView with a styles.body content container", () => {
    // In the `paystackSelected` early-return branch, after the fixed top bar
    // (renderTopBar({ onBack: backToPicker, backLabel: "Back" })), the
    // BrandPaystackOnboardView card is wrapped in a <ScrollView> whose
    // contentContainerStyle is styles.body. This is the decisive fails-on-revert
    // guard: reverting to <View style={{ flex: 1, … }}> removes the <ScrollView>
    // here → this fails.
    const paystackBodyWrapperIsScrollView =
      /renderTopBar\(\{\s*onBack:\s*backToPicker[\s\S]{0,80}?\}\)\}\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<ScrollView\b[\s\S]{0,400}?contentContainerStyle=\{\[\s*styles\.body\b/;
    expect(SRC).toMatch(paystackBodyWrapperIsScrollView);
  });

  it("3. the bug shape (plain flex:1 View right after the Paystack branch top bar) is ABSENT", () => {
    // The non-scrolling body View that produced the overlap must not exist: the
    // Paystack branch's renderTopBar({ onBack: backToPicker … }) must NOT be
    // immediately followed by a plain `<View style={{ flex: 1`.
    const bugShapePlainFlexView =
      /renderTopBar\(\{\s*onBack:\s*backToPicker[\s\S]{0,80}?\}\)\}\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<View\b[\s\S]{0,120}?style=\{\{\s*flex:\s*1\b/;
    expect(SRC).not.toMatch(bugShapePlainFlexView);
  });

  it("4. styles.body centers-when-short / scrolls-when-tall (flexGrow:1 + justifyContent:center, NOT flex:1)", () => {
    const body = styleBlock("body");
    expect(body).toMatch(/flexGrow:\s*1\b/);
    expect(body).toMatch(/justifyContent:\s*["']center["']/);
    // A ScrollView content container must use flexGrow, never flex:1 (flex:1
    // re-bounds the content to the viewport height and defeats the scroll).
    expect(body).not.toMatch(/(^|[^A-Za-z])flex:\s*1\b/);
  });

  it("5. the scroll viewport (styles.bodyScroll) is flex-bounded to the space under the top bar", () => {
    const bodyScroll = styleBlock("bodyScroll");
    expect(bodyScroll).toMatch(/(^|[^A-Za-z])flex:\s*1\b/);
  });
});
