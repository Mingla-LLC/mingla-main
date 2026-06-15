// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 [trip-page-redesign] — UNIFIED SEAM-SPLIT RESERVE CTA (implementor-
// owned happy-path regression). Seth, 2026-06-15: replace the TWO DETACHED
// "Pay in full" / "Pay over time" buttons (floating AND docked) with ONE
// continuous control ("Treatment B", design/ORCH-1138/SPLIT_CTA_OPTIONS.html): a
// single rounded, bordered, overflow-clipped SHELL holding an accent-FILLED
// primary segment + a crisp fold-SEAM + a GHOST secondary segment, side by side,
// never stacking. Both segments stay INDEPENDENT real CTAs that go STRAIGHT TO
// THE CART with their payment choice. Rule 9: the split control shows ONLY when
// the trip OFFERS an installment plan; a no-plan trip keeps the SINGLE button;
// disabled states keep the single strip.
//
// [TEST-MOD-APPROVED ORCH-1138] — supersedes the prior two-detached-buttons gate
// (splitRow / splitButton / floatSplitButton / splitLabel / splitPrice), which
// asserted the OLD layout this ORCH intentionally removes.
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
  src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const screen = stripComments(screenSrc);
const bar = stripComments(barSrc);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── S-1 — the bar accepts a splitCtas payload (two segments) ──
ok(
  "S1a ConsumerTripReserveBar exposes a splitCtas prop (full + overTime)",
  /splitCtas\?:\s*ReserveSplitCtas/.test(bar) &&
    /full:\s*ReserveSplitButton/.test(bar) &&
    /overTime:\s*ReserveSplitButton/.test(bar),
);

// ── S-2 — BOTH variants render the unified seam-split shell when splitCtas is set ──
ok(
  "S2a the DOCKED variant renders the unified shell when splitCtas is set",
  /if \(splitCtas !== undefined\) \{[\s\S]*?renderSplitShell\(splitCtas,\s*false\)/.test(
    bar,
  ),
  "docked must branch to the unified seam-split shell for plan trips",
);
ok(
  "S2b the FLOATING variant renders the COMPACT shell when splitCtas is set",
  /if \(splitCtas !== undefined\) \{[\s\S]*?renderSplitShell\(splitCtas,\s*true\)/.test(
    bar,
  ),
  "floating must branch to the compact unified shell for plan trips",
);

// ── S-UNIFIED — it reads as ONE control, not two detached buttons ──
ok(
  "SU1 it is ONE shell holding [primary | seam | secondary]",
  /const renderSplitShell =/.test(bar) &&
    /"Pay in full",\s*"primary"/.test(bar) &&
    /renderSeam\(\)/.test(bar) &&
    /"Pay over time",\s*"secondary"/.test(bar),
  "the shell must wrap both segments + the seam in a single container",
);
ok(
  "SU2 the shell is a no-wrap row, rounded + bordered + overflow:hidden (one folded control)",
  /splitShell:\s*\{[^}]*flexDirection:\s*"row"[^}]*flexWrap:\s*"nowrap"/.test(
    bar,
  ) &&
    /splitShell:\s*\{[^}]*overflow:\s*"hidden"/.test(bar) &&
    /splitShell:\s*\{[^}]*borderWidth:\s*1/.test(bar) &&
    /splitShellCompact:\s*\{[^}]*flexDirection:\s*"row"[^}]*flexWrap:\s*"nowrap"/.test(
      bar,
    ) &&
    /splitShellCompact:\s*\{[^}]*overflow:\s*"hidden"/.test(bar),
  "the shell must be a no-wrap clipped row so the two segments can never stack",
);
ok(
  "SU3 the primary segment is ACCENT-FILLED + leads (flex 1.15); secondary is SOLID WHITE w/ accent hairline (flex 1)",
  // ORCH-1138 (Seth, 2026-06-15) two-tone: primary = accent fill; secondary = solid
  // white (#FFFFFF) with an accent-tinted hairline (borderColor: palette.accent) so
  // it reads on a LIGHT brand page. fails-on-revert: deleting the SECONDARY_FILL /
  // borderColor wiring flips this case red.
  /const SECONDARY_FILL = "#FFFFFF"/.test(bar) &&
    /backgroundColor:\s*isPrimary\s*\?\s*palette\.accent\s*:\s*SECONDARY_FILL/.test(
      bar,
    ) &&
    /borderColor:\s*isPrimary\s*\?\s*undefined\s*:\s*palette\.accent/.test(bar) &&
    /segmentSecondaryBorder:\s*\{[^}]*borderTopWidth:\s*1[^}]*borderRightWidth:\s*1[^}]*borderBottomWidth:\s*1/.test(
      bar,
    ) &&
    /segmentPrimary:\s*\{[^}]*flex:\s*1\.15/.test(bar) &&
    /segmentSecondary:\s*\{[^}]*flex:\s*1\b/.test(bar),
  "primary = accent fill (lead, flex 1.15); secondary = solid white #FFFFFF + accent hairline (flex 1)",
);
ok(
  "SU4 a crisp fold-SEAM (dark crease + light highlight) divides the segments",
  /const renderSeam =/.test(bar) &&
    /seam:\s*\{[^}]*rgba\(0,0,0,0\.22\)/.test(bar) &&
    /seamHighlight:\s*\{[^}]*rgba\(255,255,255,0\.10\)/.test(bar),
  "the seam is the visual proof the two segments are one control",
);
ok(
  "SU5 theme-aware text (primary on accentText; secondary WHITE-half text + kicker on the resolved palette.accent)",
  // ORCH-1138 (Seth, 2026-06-15) two-tone: the white half's amount AND kicker are
  // the resolved brand accent (theme-aware, NOT a hardcoded orange). fails-on-revert:
  // reverting either ternary back to primaryText/tertiaryText flips this case red.
  /const textColor = isPrimary \? palette\.accentText : palette\.accent/.test(
    bar,
  ) &&
    /const kickerColor = isPrimary \? palette\.accentText : palette\.accent/.test(
      bar,
    ),
  "the white half's text + kicker must be the resolved palette.accent (theme-aware)",
);
ok(
  'S2c both segments carry the "Pay in full" + "Pay over time" labels',
  /"Pay in full"/.test(bar) && /"Pay over time"/.test(bar),
);

// ── S-3 — no text/wrap bleed: kicker + amount each one-line + ellipsize + shrink ──
ok(
  "S3a the segment kicker is one line + ellipsized + shrinks first (no bleed)",
  /styles\.segmentKicker[\s\S]{0,220}numberOfLines=\{1\}[\s\S]{0,200}ellipsizeMode="tail"/.test(
    bar,
  ) && /segmentKicker:\s*\{[^}]*flexShrink:\s*1/.test(bar),
);
ok(
  "S3b the segment amount is one line + ellipsized + shrinks (no bleed)",
  /styles\.segmentAmount[\s\S]{0,260}numberOfLines=\{1\}[\s\S]{0,200}ellipsizeMode="tail"/.test(
    bar,
  ) && /segmentAmount:\s*\{[^}]*flexShrink:\s*1/.test(bar),
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

// ── S-5 — each segment routes STRAIGHT TO CART with its choice pre-selected ──
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

// ── S-7 — checkout request stays byte-identical (choice rides the EXISTING
// paymentPlanChoice path; no new request field) ──
ok(
  "S7a the screen still forwards the explicit choice via the same runNativeCheckout path",
  /paymentPlanChoice:\s*detail\.hasPlan \? paymentPlanChoice : undefined/.test(
    screen,
  ),
  "split segments reuse the existing pay-choice plumbing — no new request shape",
);
ok(
  "S7b no billing address / taxCalculationId is introduced (venue-sourced tax)",
  !/taxCalculationId/.test(screen) &&
    (!/\baddress:/.test(screen) ||
      !/runNativeCheckout\(\{[\s\S]*?\baddress:/.test(screen)),
);

console.log(
  `\n${passed} assertions passed (ORCH-1138 unified seam-split reserve CTA — consumer).`,
);
