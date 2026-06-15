/**
 * RT-5 — ORCH-1138 R2 device-parity-rework gate.
 *
 * The first ORCH-1138 Leg-1 pass was source-verified only; Seth tested on device
 * and found the trip page diverged from DIRECTION_A_V2_FULL_RESPONSIVE.html. This
 * gate locks the four code-level parity fixes from the rework so a future edit
 * can't silently regress them:
 *
 *   #1 FONTS — the public /t/ route LOADS the resolved brand font on demand via
 *      useThemeFont(theme.fontFamilyValue). Without this the FONT_FAMILY_MAP
 *      family ("Poppins_500Medium", …) is never registered with expo-font and
 *      native silently falls back to the system font (the device finding).
 *   #6 PAYMENT — when a brand palette is present (public page only), the pay block
 *      renders the mockup's full-width TABBED segmented control (dark track, two
 *      equal tabs, active = accent fill) + a 34px amount + dotted schedule rows,
 *      via PaymentMockupCard. The no-palette path stays byte-identical (RT-2).
 *   #7 CANCELLATION — the FOUNDATION path renders a PALETTE-THEMED refund ladder
 *      (RefundLadder) built from real refundPolicy.tiers, NOT the warm-orange
 *      shared <RefundPolicyDisplay/> (which the consumer app still uses).
 *   #8 RESERVE BAR — the phone floating bar is the bespoke brand-accent
 *      TripReserveBar (kicker + price + "Reserve my spot →"), NOT the hardcoded
 *      warm-orange shared FloatingOfferingBar.
 *
 * Source-string assertions (the RN components can't mount under ts-jest — mirrors
 * RT-1..RT-4). fails-on-revert: deleting any of the asserted lines flips a case
 * red. Owner: mingla-implementor.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const routeSrc = read("app/t/[brandSlug]/[tripSlug].tsx");
const previewSrc = read("src/components/trip/TripPreview.tsx");
const paymentSrc = read("src/components/trip/TripPaymentChoice.tsx");
const reserveBarSrc = read("src/components/trip/TripReserveBar.tsx");

describe("RT-5 ORCH-1138 R2 — public trip page device-parity rework", () => {
  test("#1 FONTS: the /t/ route loads the resolved brand font via useThemeFont", () => {
    expect(routeSrc).toContain(
      'import { useThemeFont } from "../../../src/theme/useThemeFont";',
    );
    expect(routeSrc).toContain("useThemeFont(theme.fontFamilyValue);");
  });

  test("#1 FONTS: the themed payment amount + reserve CTA carry the brand font", () => {
    // PaymentMockupCard threads a fontFamily onto the 34px amount.
    expect(paymentSrc).toContain("const fontStyle = fontFamily !== undefined");
    expect(paymentSrc).toContain("mock.amt, { color: palette.primaryText }, fontStyle");
    // The reserve bar CTA + price carry the brand font too.
    expect(reserveBarSrc).toContain("styles.rCta, { color: palette.accentText }, fontStyle");
  });

  test("#6 PAYMENT: palette path renders the mockup TABBED seg control (no radio dots)", () => {
    // A dedicated mockup card is rendered ONLY when a palette is present.
    expect(paymentSrc).toContain("if (palette !== undefined) {");
    expect(paymentSrc).toContain("<PaymentMockupCard");
    // The mockup seg: dark track + two flex tabs, active = solid accent fill.
    expect(paymentSrc).toContain('backgroundColor: "rgba(0,0,0,0.28)"');
    expect(paymentSrc).toContain("isFull ? { backgroundColor: palette.accent }");
    // The 34px amount block (mockup `.pay-amt`).
    expect(paymentSrc).toMatch(/amt:\s*\{[\s\S]*?fontSize:\s*34/);
  });

  test("#7 CANCELLATION: FOUNDATION path uses the palette-themed RefundLadder, not the shared warm-orange display", () => {
    expect(previewSrc).toContain("<RefundLadder");
    expect(previewSrc).toContain("const RefundLadder: React.FC");
    // the mockup ladder renders accent/tertiary refund percentages from real tiers.
    expect(previewSrc).toContain("refundTierLabel(tier, index, tiers)");
    // the shared warm-orange RefundPolicyDisplay is NOT RENDERED as JSX in
    // TripPreview (a `<RefundPolicyDisplay policy=…` / `<RefundPolicyDisplay/>`
    // usage). It may still be MENTIONED in an explanatory comment.
    expect(previewSrc).not.toMatch(/<RefundPolicyDisplay\s+policy/);
  });

  test("#8 RESERVE BAR: the phone bar is the bespoke TripReserveBar, not the warm-orange shared bar", () => {
    expect(routeSrc).toContain(
      'import { TripReserveBar } from "../../../src/components/trip/TripReserveBar";',
    );
    expect(routeSrc).toContain("<TripReserveBar");
    expect(routeSrc).not.toContain("<FloatingOfferingBar");
    // the bar fills with the BRAND accent (not a hardcoded warm orange) + a kicker.
    expect(reserveBarSrc).toContain("backgroundColor: palette.accent");
    expect(routeSrc).toContain("kicker={barKicker}");
  });

  test("#8 RESERVE BAR: the bespoke bar never dead-taps an unavailable CTA", () => {
    // unavailable branch has NO onPress + accessibilityRole text (Constitution #1).
    expect(reserveBarSrc).toContain('accessibilityRole="text"');
    expect(reserveBarSrc).toContain("if (!cta.tappable) return;");
  });
});
