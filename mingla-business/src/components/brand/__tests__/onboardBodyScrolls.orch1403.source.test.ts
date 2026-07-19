/**
 * ORCH-1403 [connect-bank-heading-collision] — implementor happy-path regression.
 *
 * THE BUG (Seth, business web on a real phone / ~640px viewport): the
 * "connect your bank" onboarding page (`/brand/{id}/payments/onboard` →
 * BrandOnboardView) painted TWO headings on top of each other — the idle body
 * heading "Connect bank to start selling tickets" overlapped the fixed top bar
 * ("Set up payments" + "Cancel"), illegible. Root cause (forensics, proven on
 * device): the body was a NON-scrolling `<View style={[styles.body]}>` with
 * `styles.body = { flex: 1, justifyContent: "center" }`. On a short viewport the
 * idle content is taller than the body box; with `justifyContent:"center"` and
 * RN's default `overflow:visible`, the overflow spilled equally top & bottom, so
 * the TOP of the content (the heading) painted ABOVE the body box — directly over
 * the fixed top bar. Clean at 820px, collides at 640px.
 *
 * THE FIX: the state content is wrapped in a `<ScrollView>` whose
 * `contentContainerStyle` is `styles.body` with `flexGrow: 1` +
 * `justifyContent: "center"` (and the scroll viewport `styles.bodyScroll` carries
 * `flex: 1`). Short content still CENTERS (unchanged look on tall screens); tall
 * content GROWS past the viewport and SCROLLS instead of overflowing upward —
 * killing the heading-over-top-bar overlap. The fixed top bar stays OUTSIDE the
 * scroll area, always legible.
 *
 * THIS TEST is STRUCTURAL (not token-presence): it asserts the body WRAPPER in
 * the main render is a ScrollView whose content container is the centering
 * `styles.body`, that the bug shape (a plain View bound to `styles.body` right
 * after the fixed top bar) is ABSENT, and that `styles.body` is `flexGrow:1`
 * (centers-when-short / scrolls-when-tall) — NOT the bug's `flex:1`.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION of the fix, NOT a comment-out):
 *   revert the body wrapper `<ScrollView … contentContainerStyle={[ styles.body`
 *   back to `<View … style={[ styles.body` AND `styles.body.flexGrow: 1` back to
 *   `flex: 1` → assertions 2/3/4 FAIL.
 *
 * Append-only: NEW file; modifies/deletes no existing test. Runs under the
 * default `jest.config.cjs` (ts-jest / node) — no react-native import, no new
 * config. Run:
 *   cd mingla-business && npx jest --config jest.config.cjs \
 *     --testPathPattern onboardBodyScrolls.orch1403 --runInBand
 */

import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(
  join(__dirname, "..", "BrandOnboardView.tsx"),
  "utf8",
);

// Isolate the `body: { … }` and `bodyScroll: { … }` style objects (anchored so
// they can't false-match `notFoundBody`, `bodyScroll`, `poweredByText`, etc.).
function styleBlock(name: string): string {
  const m = SRC.match(
    new RegExp(`\\n\\s*${name}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`),
  );
  if (m === null) {
    throw new Error(`styles.${name} block not found in BrandOnboardView.tsx`);
  }
  return m[1];
}

describe("ORCH-1403 — onboard body scrolls (no heading-over-top-bar overlap)", () => {
  it("1. imports ScrollView from react-native", () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*\bScrollView\b[^}]*\}\s*from\s*["']react-native["']/,
    );
  });

  it("2. the main-render body wrapper is a ScrollView with a styles.body content container", () => {
    // After the fixed top bar (empty-arg renderTopBar() — the MAIN render, not
    // the Paystack branch's renderTopBar({...})), the state content is wrapped in
    // a <ScrollView> whose contentContainerStyle is styles.body. This is the
    // decisive fails-on-revert guard: reverting to <View style={[styles.body]}>
    // removes the <ScrollView> here → this fails.
    const bodyWrapperIsScrollView =
      /\{renderTopBar\(\)\}\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<ScrollView\b[\s\S]{0,400}?contentContainerStyle=\{\[\s*styles\.body\b/;
    expect(SRC).toMatch(bodyWrapperIsScrollView);
  });

  it("3. the bug shape (plain View bound to styles.body after the top bar) is ABSENT", () => {
    // The non-scrolling body View that produced the overlap must not exist: no
    // `{renderTopBar()}` immediately followed by `<View … style={[ styles.body`.
    const bugShapePlainViewBody =
      /\{renderTopBar\(\)\}\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<View\b[\s\S]{0,200}?style=\{\[\s*styles\.body\b/;
    expect(SRC).not.toMatch(bugShapePlainViewBody);
  });

  it("4. styles.body centers-when-short / scrolls-when-tall (flexGrow:1 + justifyContent:center, NOT flex:1)", () => {
    const body = styleBlock("body");
    expect(body).toMatch(/flexGrow:\s*1\b/);
    expect(body).toMatch(/justifyContent:\s*["']center["']/);
    // The bug shape used `flex: 1` on a plain View — a ScrollView content
    // container must use flexGrow, never flex (flex:1 would re-bound the content
    // to the viewport height and defeat the scroll).
    expect(body).not.toMatch(/(^|[^A-Za-z])flex:\s*1\b/);
  });

  it("5. the scroll viewport (styles.bodyScroll) is flex-bounded to the space under the top bar", () => {
    const bodyScroll = styleBlock("bodyScroll");
    expect(bodyScroll).toMatch(/(^|[^A-Za-z])flex:\s*1\b/);
  });
});
