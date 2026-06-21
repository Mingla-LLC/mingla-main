// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1188 FIX 1 [consumer EVENT detail — BLACK BAR under the floating pill].
//
// Seth (consumer device): the expanded EVENT card shows a BLACK BAR at the
// bottom. Root cause: the ~177px floating-pill runway was applied as
// TRANSPARENT scroll-content paddingBottom, exposing the gorhom sheet's dark
// `#0c0e12` backdrop. The RSVP branch already routed its runway into the
// PAGE-COLORED `nativeBody` paddingBottom (no black void). This fix extends that
// mechanism to the EVENT branch: the body carries the clearance, the
// scroll-content paddingBottom is 0, so `palette.page` fills the runway.
//
// app-mobile has no jest/RTL runner; the repo convention (see
// orch_1138_event_reserve_float_dock.test.ts) is node:assert source-assertions.
// Each assert FAILS on a TRUE LINE-DELETION of the implementing code.
//
// Run with:
//   node app-mobile/src/screens/Event/__tests__/orch_1188_event_clearance_no_black_bar.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const screenSrc = read("src/screens/Event/ConsumerEventDetailScreen.tsx");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── The scroll-content paddingBottom is now 0 (no transparent runway). ─────────
ok(
  "F1a scrollPaddingBottom is 0 (no transparent scroll-content runway)",
  /const\s+scrollPaddingBottom\s*=\s*0\s*;/.test(screenSrc),
  "the transparent scroll-content paddingBottom that exposed the dark sheet must be 0",
);

// ── A single bodyClearance is computed for BOTH branches and applied to the
//    page-colored nativeBody (so palette.page fills the runway behind the bar). ─
ok(
  "F1b bodyClearance picks the rsvp/event runway for the page-colored body",
  /const\s+bodyClearance\s*=\s*isRsvp\s*\?\s*rsvpBarClearance\s*:\s*reserveBarClearance\s*;/
    .test(screenSrc),
  "a single bodyClearance must drive the page-colored body padding for both branches",
);

ok(
  "F1c bodyClearance is applied as the nativeBody paddingBottom",
  /paddingBottom:\s*bodyClearance/.test(screenSrc),
  "the runway must live in the page-colored nativeBody paddingBottom (not transparent)",
);

// ── The body is still page-colored at backgroundColor: palette.page (so the
//    runway it now pads is light, not the sheet's #0c0e12 dark backdrop). ───────
ok(
  "F1d the nativeBody is page-colored (palette.page) where the runway lives",
  /backgroundColor:\s*palette\.page/.test(screenSrc),
  "nativeBody must be filled with palette.page so the padded runway is light",
);

// ── The floating pill lift (floatBarBottom) is UNCHANGED — fix must not move
//    the bar, only color the runway behind it. ─────────────────────────────────
ok(
  "F1e the floating pill lift (floatBarBottom) is preserved",
  /const\s+floatBarBottom\s*=/.test(screenSrc) &&
    /floatSafeBottom\s*\+\s*SHEET_BOTTOM_OVERSHOOT\s*\+\s*FLOAT_GAP/.test(
      screenSrc,
    ),
  "the proven floatBarBottom math must be untouched",
);

// ── The dead `rsvpBodyClearance` branch is gone (replaced by unified
//    bodyClearance) — guards against a half-applied revert. ───────────────────
ok(
  "F1f the old rsvp-only body clearance variable is gone",
  !/rsvpBodyClearance/.test(screenSrc),
  "the rsvp-only clearance was unified into bodyClearance",
);

console.log(`\n${passed} assertions passed`);
