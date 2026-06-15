// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 [trip-page-redesign] — SPLIT RESERVE BUTTONS (implementor-owned
// happy-path regression). Seth, 2026-06-15: replace the single "Reserve my spot"
// CTA (floating AND docked) with TWO split buttons — "Pay in full" and "Pay over
// time" — that go STRAIGHT TO THE CART with that payment choice pre-selected.
// Rule 9: show BOTH buttons ONLY when the trip OFFERS an installment plan; a
// no-plan trip keeps the SINGLE button; disabled states keep the single strip.
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions. Every assertion FAILS on a TRUE LINE-DELETION of the wiring
// it protects (fails-on-revert).
//
// Run with:
//   node app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_split_buttons.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const screenSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");
const barSrc = read("src/components/offering/ConsumerTripReserveBar.tsx");

const stripComments = (src) =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
const screen = stripComments(screenSrc);
const bar = stripComments(barSrc);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── S-1 — the bar accepts a splitCtas payload (two buttons) ──
ok(
  "S1a ConsumerTripReserveBar exposes a splitCtas prop (full + overTime)",
  /splitCtas\?:\s*ReserveSplitCtas/.test(bar) &&
    /full:\s*ReserveSplitButton/.test(bar) &&
    /overTime:\s*ReserveSplitButton/.test(bar),
);

// ── S-2 — BOTH variants render the two split buttons when splitCtas is set ──
ok(
  "S2a the DOCKED variant renders the split row when splitCtas is set",
  /if \(splitCtas !== undefined\) \{[\s\S]*?styles\.splitRow/.test(bar),
  "docked must branch to a two-button row for plan trips",
);
ok(
  "S2b the FLOATING variant renders the split pills when splitCtas is set",
  /if \(splitCtas !== undefined\) \{[\s\S]*?styles\.floatSplitWrapper/.test(bar),
  "floating must branch to two side-by-side pills for plan trips",
);

// ── S-2.5 — ORCH-1138 device-fix (Seth, 2026-06-15): the two split buttons MUST
// sit SIDE BY SIDE (a horizontal row), NOT stacked, in BOTH variants. Both the
// docked splitRow and the floating floatSplitWrapper are flexDirection:"row" with
// NO flexWrap, and each split button takes flex:1 to share the row. These FAIL
// the instant anyone reverts a wrapper to a stacked column.
ok(
  "S2.5a the DOCKED splitRow is a flexDirection:row that never wraps (side by side)",
  /splitRow:\s*\{[^}]*flexDirection:\s*"row"[^}]*flexWrap:\s*"nowrap"/.test(bar),
  "splitRow must be a row with flexWrap:nowrap so the two buttons never stack",
);
ok(
  "S2.5b the FLOATING floatSplitWrapper is a flexDirection:row (side by side, not stacked)",
  /floatSplitWrapper:\s*\{[^}]*flexDirection:\s*"row"/.test(bar) &&
    !/floatSplitWrapper:\s*\{[^}]*flexWrap:\s*"wrap"/.test(bar),
  "floatSplitWrapper must be a row (no column / no flexWrap:wrap) so the two pills never stack",
);
ok(
  "S2.5c the FLOATING split pill flexes to half the row (flex:1, minWidth:0)",
  /floatSplitButton:\s*\{[^}]*flex:\s*1[^}]*minWidth:\s*0/.test(bar) &&
    !/floatSplitButton:\s*\{[^}]*width:\s*"100%"/.test(bar),
  "each floating split pill must share the row (flex:1), not be full-width (which forces a stack)",
);
ok(
  "S2.5d the DOCKED split button flexes to half the row (flex:1, minWidth:0)",
  /splitButton:\s*\{[^}]*flex:\s*1[^}]*minWidth:\s*0/.test(bar),
);
ok(
  "S2.5e the split label + price shrink-to-fit at narrow width (adjustsFontSizeToFit)",
  /styles\.splitLabel[\s\S]{0,200}adjustsFontSizeToFit/.test(bar) &&
    /styles\.splitPrice[\s\S]{0,200}adjustsFontSizeToFit/.test(bar),
  "the inner text must shrink to fit so the side-by-side buttons stay legible at 360px",
);
ok(
  'S2c both split buttons carry the "Pay in full" + "Pay over time" labels',
  /"Pay in full"/.test(bar) && /"Pay over time"/.test(bar),
);
ok(
  "S2d each split button renders its OWN amount (full price / deposit)",
  /splitCtas\.full,\s*"Pay in full"/.test(bar) &&
    /splitCtas\.overTime,\s*"Pay over time"/.test(bar),
);

// ── S-3 — no text/arrow bleed: label + price each one-line + ellipsize + shrink ──
ok(
  "S3a the split label is one line + ellipsized + shrinks first (no bleed)",
  /styles\.splitLabel[\s\S]{0,200}numberOfLines=\{1\}[\s\S]{0,160}ellipsizeMode="tail"/.test(
    bar,
  ) && /splitLabel:\s*\{[^}]*flexShrink:\s*1[^}]*minWidth:\s*0/.test(bar),
);
ok(
  "S3b the split price is one line + ellipsized + shrinks (no bleed)",
  /styles\.splitPrice[\s\S]{0,200}numberOfLines=\{1\}[\s\S]{0,160}ellipsizeMode="tail"/.test(
    bar,
  ) && /splitPrice:\s*\{[^}]*flexShrink:\s*1[^}]*minWidth:\s*0/.test(bar),
);

// ── S-4 — rule 9: split shown ONLY for a bookable plan trip ──
ok(
  "S4a the screen gates split on a plan trip AND a tappable CTA (rule 9)",
  /const showSplit = planSchedule !== null && reserveCta\.tappable/.test(screen),
  "no-plan / disabled trips must keep the SINGLE button",
);
ok(
  "S4b splitCtas is undefined when not a bookable plan trip",
  /const splitCtas:\s*ReserveSplitCtas \| undefined = showSplit/.test(screen),
);
ok(
  "S4c the single docked/floating bar still falls back to the single ctaBody",
  /\{ctaBody\}\s*<\/View>/.test(bar) && /\{floatBody\}\s*<\/View>/.test(bar),
  "the single-button path (no-plan + disabled) must remain intact",
);

// ── S-5 — each button routes STRAIGHT TO CART with its choice pre-selected ──
ok(
  "S5a Pay-in-full seeds the cart with the 'full' choice (openCartWithChoice)",
  /onPress:\s*\(\)\s*=>\s*openCartWithChoice\("full"\)/.test(screen),
);
ok(
  "S5b Pay-over-time seeds the cart with the 'installments' choice",
  /onPress:\s*\(\)\s*=>\s*openCartWithChoice\("installments"\)/.test(screen),
);
ok(
  "S5c openCartWithChoice sets the payment choice THEN opens the SAME cart",
  /const openCartWithChoice = useCallback\([\s\S]*?setPaymentPlanChoice\(choice\)[\s\S]*?openCart\(\)/.test(
    screen,
  ),
  "the choice must seed paymentPlanChoice before the cart opens (byte-identical request)",
);

// ── S-6 — the 'Pay over time' amount = the deposit due today; full = full price ──
ok(
  "S6a Pay-over-time shows the deposit 'From {deposit} today'",
  /splitDepositPrice =\s*[\s\S]*?planSchedule\.depositCents[\s\S]*?today/.test(
    screen,
  ),
);
ok(
  "S6b Pay-in-full shows the full price label",
  /splitFullPrice =\s*[\s\S]*?priceLabel/.test(screen),
);

// ── S-7 — checkout request stays byte-identical (the choice rides the EXISTING
// paymentPlanChoice path; no new request field) ──
ok(
  "S7a the screen still forwards the explicit choice via the same runNativeCheckout path",
  /paymentPlanChoice:\s*detail\.hasPlan \? paymentPlanChoice : undefined/.test(
    screen,
  ),
  "split buttons reuse the existing pay-choice plumbing — no new request shape",
);
ok(
  "S7b no billing address / taxCalculationId is introduced (venue-sourced tax)",
  !/taxCalculationId/.test(screen) &&
    (!/\baddress:/.test(screen) ||
      !/runNativeCheckout\(\{[\s\S]*?\baddress:/.test(screen)),
);

console.log(
  `\n${passed} assertions passed (ORCH-1138 split reserve buttons — consumer).`,
);
