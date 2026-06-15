/**
 * ORCH-1138 [trip-page-redesign] — SPLIT RESERVE BUTTONS (business / public-web
 * parity with the consumer app). Seth, 2026-06-15: the single "Reserve my spot"
 * CTA (floating AND docked) becomes TWO split buttons — "Pay in full" and "Pay
 * over time" — routing STRAIGHT to checkout with that payment choice in the `plan`
 * param. Rule 9: BOTH buttons show ONLY when the trip OFFERS an installment plan
 * AND is bookable; a no-plan / disabled trip keeps the SINGLE bar.
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

describe("ORCH-1138 — trip Reserve SPLIT buttons (business/web)", () => {
  test("SP1 TripReserveBar exposes a splitCtas prop (full + overTime)", () => {
    expect(reserveBarSrc).toMatch(/splitCtas\?:\s*ReserveSplitCtas/);
    expect(reserveBarSrc).toMatch(/full:\s*ReserveSplitButton/);
    expect(reserveBarSrc).toMatch(/overTime:\s*ReserveSplitButton/);
  });

  test("SP2 the DOCKED variant renders a two-button split row when splitCtas is set", () => {
    const docked = reserveBarSrc.match(
      /if \(variant === "docked"\) \{[\s\S]*?\n {2}\}/,
    );
    expect(docked).not.toBeNull();
    expect(docked?.[0]).toMatch(/if \(splitCtas !== undefined\)/);
    expect(docked?.[0]).toContain("styles.splitRow");
    expect(docked?.[0]).toContain('"Pay in full"');
    expect(docked?.[0]).toContain('"Pay over time"');
  });

  test("SP3 the FLOATING variant renders two stacked split pills when splitCtas is set", () => {
    expect(reserveBarSrc).toMatch(
      /if \(splitCtas !== undefined\) \{[\s\S]*?styles\.floatSplitWrapper/,
    );
    expect(reserveBarSrc).toContain("styles.floatSplitButton");
  });

  test("SP4 each split button shows its label + its own amount (no bleed)", () => {
    // label + price each one-line + ellipsized + shrink-first (arrow-bleed pattern).
    expect(reserveBarSrc).toMatch(
      /styles\.splitLabel[\s\S]{0,160}numberOfLines=\{1\}[\s\S]{0,80}ellipsizeMode="tail"/,
    );
    expect(reserveBarSrc).toMatch(
      /styles\.splitPrice[\s\S]{0,160}numberOfLines=\{1\}[\s\S]{0,80}ellipsizeMode="tail"/,
    );
    expect(reserveBarSrc).toMatch(/splitLabel:\s*\{[^}]*flexShrink:\s*1/);
    expect(reserveBarSrc).toMatch(/splitPrice:\s*\{[^}]*flexShrink:\s*1/);
  });

  test("SP5 the single-button path (no-plan + disabled) is still intact", () => {
    // ctaBody / floatBody fall-through remains for non-split trips.
    expect(reserveBarSrc).toMatch(/\{ctaBody\}\s*<\/View>/);
    expect(reserveBarSrc).toMatch(/\{floatBody\}\s*<\/View>/);
  });

  test("SP6 the route gates the split on a bookable plan trip (rule 9)", () => {
    expect(routeSrc).toMatch(
      /const tripSplitCtas:\s*ReserveSplitCtas \| undefined =\s*\n?\s*tripHasPlan && tripCta\.tappable/,
    );
  });

  test("SP7 the route passes splitCtas to BOTH the docked + floating bars", () => {
    const matches = routeSrc.match(/splitCtas=\{tripSplitCtas\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("SP8 each button routes STRAIGHT to checkout with its OWN plan choice", () => {
    // handleTripReserve forwards the choice into the `plan` param (checkout-trip
    // seeds CartContext.paymentPlanChoice from it → byte-identical request).
    expect(routeSrc).toMatch(
      /handleTripReserve = \(choice\?:\s*TripPaymentChoiceValue\)/,
    );
    expect(routeSrc).toMatch(/plan:\s*choice \?\? paymentPlanChoice/);
    expect(routeSrc).toMatch(/onPress:\s*\(\)\s*=>\s*handleTripReserve\("full"\)/);
    expect(routeSrc).toMatch(
      /onPress:\s*\(\)\s*=>\s*handleTripReserve\("installments"\)/,
    );
  });

  test("SP9 'Pay over time' shows the deposit due today; 'Pay in full' the full price", () => {
    const block = routeSrc.match(
      /const tripSplitCtas[\s\S]*?:\s*undefined;/,
    );
    expect(block).not.toBeNull();
    const str = block?.[0] ?? "";
    expect(str).toContain('label: "Pay in full"');
    expect(str).toContain("price: tripPrice");
    expect(str).toContain('label: "Pay over time"');
    expect(str).toMatch(/From \$\{depositLabel\} today/);
  });
});
