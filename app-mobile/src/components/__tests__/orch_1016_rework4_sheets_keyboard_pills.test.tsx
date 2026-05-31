// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1016 [Consumer Discover Trips tab] — REWORK-4 regression test.
// Operator on-device review (2026-05-30): three distinct on-device defects.
//
//   FIX A — the reserve/tickets/checkout sheet (TicketCartSheet, opened by the
//           trip Reserve flow via ExpandedBusinessEventSheet) had its buy/Continue
//           CTA BLOCKED by the floating GlassBottomNav and the body did not scroll.
//           Root cause: it used the FROZEN scrollMode="scroll" + stickyFooter
//           sticky-footer branch (the exact config REWORK-3 proved freezes), and
//           its CTA bar only padded insets.bottom (no nav clearance). FIX mirrors
//           the proven ExpandedBusinessEventSheet / ConsumerTripDetailScreen
//           wiring: scrollMode="view" + a BottomSheetScrollView (re-exported from
//           the primitive) as a flex:1 DIRECT child + the CTA bar as a SIBLING.
//           Inline uses add BOTTOM_NAV_CONTENT_HEIGHT; overlay-carried uses only
//           safe-area because the nav is behind the modal window.
//
//   FIX B — the Trips-tab filter picker sheets (TripFilterChips) had TYPED fields
//           inside a raw RN <Modal> pinned to the bottom with NO keyboard
//           avoidance, so the soft keyboard covered the field. FIX converts the
//           sheet to the canonical input-bearing pattern (CityPickerSheet):
//           BaseBottomSheet + BottomSheetTextInput + keyboardBehavior +
//           keyboardBlurBehavior + android_keyboardInputMode + wrapInRNModal so
//           gorhom lifts the focused field above the keyboard.
//
//   FIX C — the paired-friend public-view COLLAPSED cards (PersonHolidayView
//           CompactCard) rendered category/intent GlassBadge pills in a NON-wrapping
//           row, so multi-category / intent (curated) cards bled the pills past the
//           card's padded content width. FIX mirrors the EXPANDED deck card's
//           badge-row treatment (flexWrap:'wrap') so a too-wide second pill wraps
//           instead of bleeding; the tile already clips at its rounded edge.
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions (see the sibling ORCH-1016 rework test).
// Every assertion is written to FAIL if the guard it protects is reverted.
//
// Run with:
//   node app-mobile/src/components/__tests__/orch_1016_rework4_sheets_keyboard_pills.test.tsx

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// Strip line + block comments so assertions match REAL code, never the prose in
// the explanatory comment blocks (which intentionally quote the OLD frozen config
// like scrollMode="scroll" for documentation).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const cartSrc = stripComments(read("src/components/expandedCard/TicketCartSheet.tsx"));
const filterSrc = stripComments(read("src/components/discover/TripFilterChips.tsx"));
const holidaySrc = read("src/components/PersonHolidayView.tsx");
// Canonical references the fixes mirror.
const cityPickerSrc = read("src/components/discover/CityPickerSheet.tsx");
const curatedCardSrc = read("src/components/CuratedExperienceSwipeCard.tsx");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── FIX A (ROOT-CAUSE, verified on-device iOS + Android 2026-05-31): the cart
// scrolls + CTA is reachable via bare scrollMode="scroll" + hidesBottomNav ─────
// The earlier REWORK fixes (scrollMode="view" + an injected BottomSheetScrollView
// host, plus clearFloatingNav padding to clear a still-visible nav) still froze /
// cut off the CTA on device. The proven shape is a BARE scrollMode="scroll" so
// BaseBottomSheet's OWN gorhom BottomSheetScrollView is the DIRECT child of the
// height-bounded BottomSheetContent; {header}{body}{stickyFooter} are its scroll
// children; and hidesBottomNav hides the floating nav so the Pay CTA is reachable.
ok(
  "A1 TicketCartSheet uses a BARE scrollMode='scroll' (BaseBottomSheet owns the gorhom scroll as a direct child), NOT the frozen scrollMode='view'+injected-host config",
  /scrollMode="scroll"\s*\n\s*hidesBottomNav/.test(cartSrc) &&
    !/scrollMode="view"/.test(cartSrc),
  "bare scrollMode='scroll' makes the gorhom BottomSheetScrollView the DIRECT child of BottomSheetContent — the only structure gorhom constrains to the snap height so the long billing form scrolls to reach Pay",
);
ok(
  "A2 the header + body + Pay CTA are the sheet's DIRECT children (no injected scroll host, no wrapper)",
  /scrollMode="scroll"[\s\S]{0,200}>\s*\{header\}\s*\{body\}\s*\{stickyFooter\}\s*<\/BaseBottomSheet>/.test(
    cartSrc,
  ),
  "{header}{body}{stickyFooter} render straight inside the bare scroll sheet; a wrapper child re-introduces the frozen viewport==content config that cut off the CTA",
);
ok(
  "A3 TicketCartSheet does NOT use BaseBottomSheet's stickyFooter / header / bodyContainerStyle wrapper props (each nests the scroll one BottomSheetView level deeper → frozen)",
  !/stickyFooter=\{/.test(cartSrc) &&
    !/<BaseBottomSheet[\s\S]*?bodyContainerStyle=/.test(cartSrc) &&
    !/<BaseBottomSheet[\s\S]*?\sheader=\{/.test(cartSrc),
  "the wrapper props route the sheet into the frozen nested branch; the CTA bar (the `stickyFooter` local) is a plain scroll child, not the primitive prop",
);
ok(
  "A4 the cart hides the floating nav while open (hidesBottomNav) so the Pay CTA is never covered — no faked nav-height padding needed",
  /hidesBottomNav/.test(cartSrc),
  "nav clearance is solved by hiding the nav, not by padding the CTA under a still-visible floating nav (the superseded clearFloatingNav approach)",
);

// ── FIX B: trip filter sheets keyboard-avoid via the canonical pattern ──────
ok(
  "B1 TripFilterChips imports BaseBottomSheet + BottomSheetTextInput from the primitive (canonical input-sheet pattern)",
  /import\s*\{[\s\S]*?BaseBottomSheet[\s\S]*?BottomSheetTextInput[\s\S]*?\}\s*from\s*["'][^"']*ui\/BaseBottomSheet["']/.test(
    filterSrc,
  ),
  "input-bearing sheets use BottomSheetTextInput so gorhom coordinates the field with the keyboard (mirror CityPickerSheet)",
);
ok(
  "B2 TripFilterChips no longer uses raw RN <TextInput> for its typed fields",
  !/<TextInput\b/.test(filterSrc),
  "raw RN TextInput inside a bottom-pinned modal is exactly what the keyboard covered; must be BottomSheetTextInput",
);
ok(
  "B3 all four typed fields are BottomSheetTextInput (Where to / Leaving from share one; Price + Group min/max = 3 total inputs)",
  (filterSrc.match(/<BottomSheetTextInput\b/g) || []).length >= 3,
  "the destination/departure field + the price/group min + max fields must all be BottomSheetTextInput",
);
ok(
  "B4 the filter sheet sets gorhom keyboard coordination props (interactive + restore + adjustResize), mirroring CityPickerSheet",
  /keyboardBehavior="interactive"/.test(filterSrc) &&
    /keyboardBlurBehavior="restore"/.test(filterSrc) &&
    /android_keyboardInputMode="adjustResize"/.test(filterSrc),
  "these are the exact props CityPickerSheet uses so the focused field rises above the keyboard",
);
ok(
  "B5 the filter sheet is a BaseBottomSheet with wrapInRNModal (z-stacks above the floating nav, same as CityPickerSheet)",
  /<BaseBottomSheet[\s\S]*?wrapInRNModal[\s\S]*?<\/BaseBottomSheet>/.test(
    filterSrc,
  ),
  "wrapInRNModal lifts the sheet over the in-tree GlassBottomNav and activates the gorhom keyboard window",
);
ok(
  "B6 the prior raw RN <Modal> bottom-sheet chrome is GONE (no Modal, no flex-end backdrop)",
  !/<Modal\b/.test(filterSrc) && !/styles\.backdrop/.test(filterSrc),
  "the old raw RN Modal + flex-end backdrop had no keyboard avoidance; it must be fully replaced by BaseBottomSheet",
);
ok(
  "B-ref CityPickerSheet (the canonical pattern being mirrored) still uses BottomSheetTextInput + the same keyboard props",
  /BottomSheetTextInput/.test(cityPickerSrc) &&
    /keyboardBehavior="interactive"/.test(cityPickerSrc),
  "guards that the canonical reference the fix mirrors has not drifted",
);

// ── FIX C: collapsed paired-friend card contains its pills (no bleed) ────────
ok(
  "C1 the CompactCard chip row (tileChips) wraps so multi-pill cards never bleed past the card width",
  /tileChips:\s*\{[\s\S]*?flexDirection:\s*["']row["'][\s\S]*?flexWrap:\s*["']wrap["'][\s\S]*?\}/.test(
    holidaySrc,
  ),
  "without flexWrap a wide second GlassBadge (intent/curated, multi-category) overflowed the padded content width and bled out the side",
);
ok(
  "C2 the collapsed tile clips at its rounded edge (overflow:'hidden') so any residual overflow is contained, not bled",
  /tile:\s*\{[\s\S]*?overflow:\s*["']hidden["'][\s\S]*?\}/.test(holidaySrc),
  "the card must clip its content to its rounded rect so a single over-wide pill is clipped at the edge instead of bleeding",
);
ok(
  "C-ref the EXPANDED deck card's badge row (the treatment being mirrored) uses flexWrap:'wrap'",
  /flexWrap:\s*['"]wrap['"]/.test(curatedCardSrc),
  "guards that the collapsed card now matches the EXPANDED card's existing badge-row containment (no invented look)",
);

console.log(`\nORCH-1016 REWORK-4 — ${passed} checks PASS`);
