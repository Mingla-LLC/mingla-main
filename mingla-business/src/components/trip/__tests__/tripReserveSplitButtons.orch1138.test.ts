/**
 * ORCH-1138 [trip-page-redesign] — UNIFIED SEAM-SPLIT RESERVE CTA (business /
 * public-web parity with the consumer app). Seth, 2026-06-15: the two DETACHED
 * "Pay in full" / "Pay over time" buttons are replaced by ONE continuous control
 * ("Treatment B", design/ORCH-1138/SPLIT_CTA_OPTIONS.html): a single rounded,
 * bordered, overflow-clipped SHELL holding an accent-FILLED primary segment + a
 * crisp fold-SEAM + a GHOST secondary segment, side by side, never stacking. Both
 * segments stay INDEPENDENT real CTAs routing STRAIGHT to checkout with their
 * payment choice. Rule 9: the split control shows ONLY when the trip OFFERS an
 * installment plan AND is bookable; a no-plan / disabled trip keeps the SINGLE bar.
 *
 * [TEST-MOD-APPROVED ORCH-1138] — supersedes the prior two-detached-buttons gate
 * (splitRow / splitButton / floatSplitButton / splitLabel / splitPrice), which
 * asserted the OLD layout this ORCH intentionally removes.
 *
 * Source-string assertions (the RN components can't mount under ts-jest — mirrors
 * the sibling tripReserveFloatDock gate). fails-on-revert: deleting any asserted
 * line flips a case red. Owner: mingla-implementor.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const routeSrc = read("app/t/[brandSlug]/[tripSlug].tsx");
const reserveBarSrc = read("src/components/trip/TripReserveBar.tsx");
// [TEST-MOD-APPROVED META-ORCH-1174] the split-CTA construction (the rule-9 gate +
// the distinct full/installments routing + the per-segment deposit/full price) was
// LIFTED out of the route into the shared useTripOfferingState (one owner — the box
// + both bars read the same splitCtas). SP6–SP9 read its new home; behavior preserved.
const hookSrc = read("../packages/offering-rendering/useTripOfferingState.ts");

describe("ORCH-1138 — trip Reserve UNIFIED seam-split CTA (business/web)", () => {
  test("SP1 TripReserveBar exposes a splitCtas prop (full + overTime)", () => {
    expect(reserveBarSrc).toMatch(/splitCtas\?:\s*ReserveSplitCtas/);
    expect(reserveBarSrc).toMatch(/full:\s*ReserveSplitButton/);
    expect(reserveBarSrc).toMatch(/overTime:\s*ReserveSplitButton/);
  });

  test("SP2 the DOCKED variant renders the unified seam-split shell when splitCtas is set", () => {
    const docked = reserveBarSrc.match(
      /if \(variant === "docked"\) \{[\s\S]*?\n {2}\}/,
    );
    expect(docked).not.toBeNull();
    expect(docked?.[0]).toMatch(/if \(splitCtas !== undefined\)/);
    expect(docked?.[0]).toMatch(/renderSplitShell\(splitCtas,\s*false\)/);
  });

  test("SP3 the FLOATING variant renders the COMPACT seam-split shell when splitCtas is set", () => {
    expect(reserveBarSrc).toMatch(
      /if \(splitCtas !== undefined\) \{[\s\S]*?renderSplitShell\(splitCtas,\s*true\)/,
    );
  });

  // ── SP-UNIFIED: the control reads as ONE shell, not two detached buttons ──
  test("SP-U1 it is ONE container — the shell holds [primary | seam | secondary]", () => {
    // renderSplitShell wraps the two segments + the seam in a SINGLE bordered,
    // overflow-clipped View (the visual proof it's one folded control).
    expect(reserveBarSrc).toMatch(/const renderSplitShell =/);
    const shell = reserveBarSrc.match(
      /const renderSplitShell =[\s\S]*?\n {2}\);/,
    );
    expect(shell).not.toBeNull();
    const str = shell?.[0] ?? "";
    expect(str).toMatch(/"Pay in full",\s*"primary"/);
    expect(str).toMatch(/renderSeam\(\)/);
    expect(str).toMatch(/"Pay over time",\s*"secondary"/);
  });

  test("SP-U2 the shell is a no-wrap row, rounded + bordered + overflow:hidden (one folded control)", () => {
    expect(reserveBarSrc).toMatch(
      /splitShell:\s*\{[^}]*flexDirection:\s*"row"[^}]*flexWrap:\s*"nowrap"/,
    );
    expect(reserveBarSrc).toMatch(/splitShell:\s*\{[^}]*overflow:\s*"hidden"/);
    expect(reserveBarSrc).toMatch(/splitShell:\s*\{[^}]*borderWidth:\s*1/);
    // compact (floating) shell is the same anatomy.
    expect(reserveBarSrc).toMatch(
      /splitShellCompact:\s*\{[^}]*flexDirection:\s*"row"[^}]*flexWrap:\s*"nowrap"/,
    );
    expect(reserveBarSrc).toMatch(
      /splitShellCompact:\s*\{[^}]*overflow:\s*"hidden"/,
    );
  });

  test("SP-U3 the primary segment is ACCENT-FILLED and leads (flex 1.15); secondary is SOLID WHITE w/ accent hairline", () => {
    // ORCH-1138 (Seth, 2026-06-15) two-tone: primary = accent fill; secondary = solid
    // white (#FFFFFF) with an accent-tinted hairline (borderColor: palette.accent) so
    // it reads on a LIGHT brand page. fails-on-revert: deleting the SECONDARY_FILL /
    // borderColor wiring flips this case red.
    expect(reserveBarSrc).toMatch(/const SECONDARY_FILL = "#FFFFFF"/);
    expect(reserveBarSrc).toMatch(
      /backgroundColor:\s*isPrimary\s*\?\s*palette\.accent\s*:\s*SECONDARY_FILL/,
    );
    expect(reserveBarSrc).toMatch(
      /borderColor:\s*isPrimary\s*\?\s*undefined\s*:\s*palette\.accent/,
    );
    expect(reserveBarSrc).toMatch(
      /segmentSecondaryBorder:\s*\{[^}]*borderTopWidth:\s*1[^}]*borderRightWidth:\s*1[^}]*borderBottomWidth:\s*1/,
    );
    expect(reserveBarSrc).toMatch(/segmentPrimary:\s*\{[^}]*flex:\s*1\.15/);
    expect(reserveBarSrc).toMatch(/segmentSecondary:\s*\{[^}]*flex:\s*1\b/);
  });

  test("SP-U4 there is a crisp fold-SEAM (dark crease + light highlight) between the segments", () => {
    expect(reserveBarSrc).toMatch(/const renderSeam =/);
    expect(reserveBarSrc).toMatch(/seam:\s*\{[^}]*rgba\(0,0,0,0\.22\)/);
    expect(reserveBarSrc).toMatch(
      /seamHighlight:\s*\{[^}]*rgba\(255,255,255,0\.10\)/,
    );
  });

  test("SP-U5 theme-aware text: primary on accentText, secondary WHITE-half text + kicker on the resolved palette.accent", () => {
    // ORCH-1138 (Seth, 2026-06-15) two-tone: the white half's amount AND kicker are
    // the resolved brand accent (theme-aware, NOT a hardcoded orange). fails-on-revert:
    // reverting either ternary back to primaryText/tertiaryText flips this case red.
    expect(reserveBarSrc).toMatch(
      /const textColor = isPrimary \? palette\.accentText : palette\.accent/,
    );
    expect(reserveBarSrc).toMatch(
      /const kickerColor = isPrimary \? palette\.accentText : palette\.accent/,
    );
  });

  test("SP4 each segment shows its kicker + its own amount, shrink-to-fit (no wrap, no bleed)", () => {
    expect(reserveBarSrc).toMatch(
      /styles\.segmentKicker[\s\S]{0,220}numberOfLines=\{1\}[\s\S]{0,200}ellipsizeMode="tail"/,
    );
    expect(reserveBarSrc).toMatch(/styles\.segmentKicker[\s\S]{0,220}adjustsFontSizeToFit/);
    expect(reserveBarSrc).toMatch(/segmentKicker:\s*\{[^}]*flexShrink:\s*1/);
    expect(reserveBarSrc).toMatch(/segmentAmount:\s*\{[^}]*flexShrink:\s*1/);
  });

  test("SP5 the single-button path (no-plan + disabled) is still intact", () => {
    expect(reserveBarSrc).toMatch(/\{ctaBody\}\s*<\/View>/);
    expect(reserveBarSrc).toMatch(/\{floatBody\}\s*<\/View>/);
  });

  test("SP6 the shared state machine gates the split on a bookable plan trip (rule 9)", () => {
    // [TEST-MOD-APPROVED META-ORCH-1174] Leg B3 — the split-CTA fast path is now the
    // SINGLE-package plan case ONLY (multi-package rows own their own per-row toggle).
    // The gate became `hasSingleTierPlan && !multiTier && cta.tappable`.
    expect(hookSrc).toMatch(
      /const splitCtas:\s*ReserveSplitCtas \| undefined =\s*\n?\s*hasSingleTierPlan && !multiTier && cta\.tappable/,
    );
  });

  test("SP7 the route passes the shared splitCtas to BOTH the docked + floating bars", () => {
    const matches = routeSrc.match(/splitCtas=\{offeringState\.splitCtas\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("SP8 each segment routes STRAIGHT to checkout with its OWN plan choice (byte-identical)", () => {
    // The route's reserve handler threads the choice into the plan route param…
    // [TEST-MOD-APPROVED META-ORCH-1174] Leg B3 — the handler signature grew a
    // `lines?: TripReserveLine[]` arg (DEC-B multi-package selection rides the
    // checkout as a JSON param). The plan-param threading is unchanged.
    expect(routeSrc).toMatch(/handleTripReserve = useCallback\(/);
    expect(routeSrc).toMatch(
      /\(choice\?:\s*TripPaymentPlanChoice,\s*lines\?:\s*TripReserveLine\[\]\):\s*void/,
    );
    expect(routeSrc).toMatch(/plan:\s*choice \?\? paymentPlanChoice/);
    // …and the shared state wires each segment to its OWN choice.
    expect(hookSrc).toMatch(/onPress:\s*\(\)\s*=>\s*onReserve\("full"\)/);
    expect(hookSrc).toMatch(/onPress:\s*\(\)\s*=>\s*onReserve\("installments"\)/);
  });

  test("SP9 'Pay over time' shows the deposit due today; 'Pay in full' the full price", () => {
    const block = hookSrc.match(/const splitCtas[\s\S]*?:\s*undefined;/);
    expect(block).not.toBeNull();
    const str = block?.[0] ?? "";
    expect(str).toContain('label: "Pay in full"');
    expect(str).toMatch(/price:\s*priceLabel/);
    expect(str).toContain('label: "Pay over time"');
    expect(str).toMatch(/From \$\{depositLabel\} today/);
  });
});
