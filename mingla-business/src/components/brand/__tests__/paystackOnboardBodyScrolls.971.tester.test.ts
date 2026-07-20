/**
 * #971 [paystack-onboard-scroll] — TESTER adversarial regression (independent, DIFFERENT angle).
 *
 * The implementor's happy-path suite (paystackOnboardBodyScrolls.971.source.test.ts) asserts the
 * paystack-branch body wrapper IS a ScrollView with a centering content container. This tester
 * suite attacks THREE different structural invariants — the ones that make the deviation ("wrap at
 * the SCREEN OWNER BrandOnboardView, NOT inside the reusable BrandPaystackOnboardView card") SAFE:
 *
 *   ANGLE 1 — top bar is a SIBLING that stays OUTSIDE the scroll (positional, index-based).
 *     Inside the isolated `paystackSelected` branch region, the fixed top bar
 *     (renderTopBar({ onBack: backToPicker … })) renders BEFORE and OUTSIDE the <ScrollView>, and
 *     the <ScrollView> is the element that wraps <BrandPaystackOnboardView>. Isolating the branch
 *     region (index slice, NOT a whole-file regex) deliberately avoids the comment-swallowing
 *     backtracking that lets a naive regex bridge into the MAIN render's ScrollView — so this
 *     assertion genuinely pins the NG branch. FAILS-ON-REVERT: reverting the branch to a plain
 *     <View style={{ flex:1 }}> deletes the <ScrollView> from this region → angle 1 fails.
 *
 *   ANGLE 2 — the reusable card stays PASSIVE (cross-file, BrandPaystackOnboardView).
 *     Its root is a content-sized <GlassCard> (NOT a ScrollView — proving the wrap was NOT added
 *     inside it, which would collapse to height 0 in an auto-height parent), and its internal
 *     bank-picker <Modal> still owns its OWN distinct <ScrollView style={styles.bankList}> — the
 *     fix left that untouched.
 *
 *   ANGLE 3 — the SECOND render site is still scroll-wrapped (cross-file, BrandPaymentsView).
 *     BrandPaystackOnboardView on the /payments "change bank" surface is embedded INSIDE a parent
 *     <ScrollView> … </ScrollView>, so that site remains scroll-bounded and is not regressed /
 *     double-collapsed by wrapping at the screen owner.
 *
 * Append-only: NEW file; modifies/deletes nothing. Runs under jest.config.cjs (ts-jest / node) —
 * no react-native import, no new config. Run:
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/paystackOnboardBodyScrolls.971.tester.test.ts --runInBand
 */

import { readFileSync } from "fs";
import { join } from "path";

const DIR = join(__dirname, "..");
const ONBOARD = readFileSync(join(DIR, "BrandOnboardView.tsx"), "utf8");
const PAYSTACK = readFileSync(join(DIR, "BrandPaystackOnboardView.tsx"), "utf8");
const PAYMENTS = readFileSync(join(DIR, "BrandPaymentsView.tsx"), "utf8");

/**
 * Isolate ONLY the `paystackSelected` early-return branch region. The branch's own return is
 * 4-space-indented (`    return (`); the MAIN render that follows the branch is 2-space-indented
 * (`\n  return (`) — a unique marker — so the slice cannot bleed into the main render.
 */
function paystackBranchRegion(): string {
  const start = ONBOARD.indexOf("paystackSelected) {");
  if (start === -1) {
    throw new Error("paystackSelected branch start not found in BrandOnboardView.tsx");
  }
  const end = ONBOARD.indexOf("\n  return (", start);
  if (end === -1) {
    throw new Error("main-render return after the paystack branch not found");
  }
  return ONBOARD.slice(start, end);
}

describe("#971 tester — top bar stays outside the scroll; reusable card stays passive; second site scroll-wrapped", () => {
  it("0. the branch region is correctly isolated (contains the NG branch, not the main render)", () => {
    const region = paystackBranchRegion();
    // Positive: it is the NG branch.
    expect(region).toContain("<BrandPaystackOnboardView");
    expect(region).toContain("backToPicker");
    // Negative: it must NOT contain the main render's empty-arg top bar call — proves no bleed.
    expect(region).not.toContain("{renderTopBar()}");
  });

  it("1. the fixed top bar renders OUTSIDE and BEFORE the ScrollView, which wraps the Paystack card", () => {
    const region = paystackBranchRegion();
    const topBarIdx = region.indexOf("renderTopBar({");
    const scrollOpenIdx = region.indexOf("<ScrollView");
    const scrollCloseIdx = region.indexOf("</ScrollView>");
    const cardIdx = region.indexOf("<BrandPaystackOnboardView");

    // Top bar exists and is a real sibling.
    expect(topBarIdx).toBeGreaterThan(-1);
    // Decisive fails-on-revert guard: a ScrollView must exist in THIS branch region.
    // Reverting to <View style={{ flex:1 }}> removes it → scrollOpenIdx === -1 → fails here.
    expect(scrollOpenIdx).toBeGreaterThan(-1);
    expect(scrollCloseIdx).toBeGreaterThan(scrollOpenIdx);
    // Top bar is OUTSIDE (before) the scroll — never scrolled away.
    expect(topBarIdx).toBeLessThan(scrollOpenIdx);
    // The ScrollView is what wraps the Paystack card (card is between open & close).
    expect(cardIdx).toBeGreaterThan(scrollOpenIdx);
    expect(cardIdx).toBeLessThan(scrollCloseIdx);
    // And the top bar is NOT re-rendered inside the scroll body.
    expect(region.slice(scrollOpenIdx, scrollCloseIdx)).not.toContain("renderTopBar");
  });

  it("2. the reusable BrandPaystackOnboardView card stays passive: root is GlassCard, not a ScrollView", () => {
    // Root element of the component's render is a content-sized <GlassCard> — the wrap was NOT
    // added inside it (a flex:1 ScrollView here would collapse to height 0 in the auto-height card).
    expect(PAYSTACK).toMatch(/return\s*\(\s*<GlassCard\b/);
    expect(PAYSTACK).not.toMatch(/return\s*\(\s*<ScrollView\b/);
  });

  it("3. the card's internal bank-picker Modal still owns its OWN distinct ScrollView (untouched)", () => {
    expect(PAYSTACK).toMatch(/<Modal\b/);
    // The bank list scroll inside the modal is preserved and distinct from the body wrap.
    expect(PAYSTACK).toMatch(/<ScrollView[\s\S]{0,80}?style=\{styles\.bankList\}/);
    expect(PAYSTACK).toMatch(/\bbankList:\s*\{/);
  });

  it("4. the SECOND render site (BrandPaymentsView) still embeds the card INSIDE a parent ScrollView", () => {
    const cardIdx = PAYMENTS.indexOf("<BrandPaystackOnboardView");
    expect(cardIdx).toBeGreaterThan(-1);
    const scrollOpenBefore = PAYMENTS.lastIndexOf("<ScrollView", cardIdx);
    const scrollCloseAfter = PAYMENTS.indexOf("</ScrollView>", cardIdx);
    // A ScrollView opens before the card and closes after it → the card is scroll-bounded here.
    expect(scrollOpenBefore).toBeGreaterThan(-1);
    expect(scrollCloseAfter).toBeGreaterThan(cardIdx);
  });
});
