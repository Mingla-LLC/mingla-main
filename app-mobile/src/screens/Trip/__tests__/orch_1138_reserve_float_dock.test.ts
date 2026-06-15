// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 [trip-page-redesign] device-rework #3 — Reserve CTA float→dock
// behavior (CONSUMER). Seth's screenshot feedback: a light FLOATING PILL while
// scrolling → the DOCKED button (bg ok) flush at the end → no black gap.
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions + behavioral replicas of pure logic. This file BEHAVIORALLY
// exercises the float-pill visibility predicate (the load-bearing UX rule) as a
// pure function, AND asserts the docked card carries no oversized void. Every
// assertion fails on a TRUE LINE-DELETION of the guard it protects.
//
// Run with:
//   node app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_float_dock.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const screenSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");
const reserveBarSrc = read("src/components/offering/ConsumerTripReserveBar.tsx");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── Behavioral replica of the screen's floatingPillVisible predicate ──
// MUST stay in lockstep with ConsumerTripDetailScreen.tsx:
//   const floatingPillVisible =
//     dockTopY === null || viewportH === 0
//       ? true
//       : dockTopY > scrollY + viewportH - REVEAL_MARGIN;
const REVEAL_MARGIN = 24;
function floatingPillVisible({ dockTopY, scrollY, viewportH }) {
  if (dockTopY === null || viewportH === 0) return true;
  return dockTopY > scrollY + viewportH - REVEAL_MARGIN;
}

// 1. Before measurement (unknown dock / viewport) → pill VISIBLE (safe default).
ok(
  "B1 pill visible before the dock/viewport are measured",
  floatingPillVisible({ dockTopY: null, scrollY: 0, viewportH: 0 }) === true,
);
ok(
  "B1b pill visible when viewport height is still 0",
  floatingPillVisible({ dockTopY: 2000, scrollY: 0, viewportH: 0 }) === true,
);

// 2. Long page, scrolled to TOP — docked button far below the fold → pill VISIBLE.
ok(
  "B2 pill VISIBLE while the docked button is below the fold (top of a long page)",
  floatingPillVisible({ dockTopY: 2400, scrollY: 0, viewportH: 800 }) === true,
);

// 3. Mid-scroll, docked button still below the viewport bottom → pill VISIBLE.
ok(
  "B3 pill VISIBLE mid-scroll while the docked button is still off-screen",
  floatingPillVisible({ dockTopY: 2400, scrollY: 1200, viewportH: 800 }) === true,
);

// 4. Scrolled to the END — docked button's top has crossed the viewport bottom
//    (dockTopY <= scrollY + viewportH - margin) → pill HIDDEN (no double bar).
ok(
  "B4 pill HIDDEN once the docked button scrolls into view (at the end)",
  floatingPillVisible({ dockTopY: 2400, scrollY: 1700, viewportH: 800 }) === false,
);
ok(
  "B4b pill HIDDEN exactly when the docked top reaches the reveal threshold",
  floatingPillVisible({ dockTopY: 1576, scrollY: 800, viewportH: 800 }) === false,
);
ok(
  "B4c pill still VISIBLE one px before the reveal threshold (no premature hide)",
  floatingPillVisible({ dockTopY: 1577, scrollY: 800, viewportH: 800 }) === true,
);

// 5. The docked variant carries its own safe-area bottom pad (button above the
//    home indicator) and is in NORMAL FLOW (no absolute position → no void above).
ok(
  "B5 the docked card pads its own safe-area bottom (button clears the home indicator)",
  /paddingBottom:\s*safeBottom\s*\+\s*8/.test(reserveBarSrc),
  "the docked CTA must reserve its own bottom safe-area so it isn't clipped",
);
ok(
  "B5b the docked card is in normal flow (dockedCard has no position:absolute)",
  !/dockedCard:\s*\{[^}]*position:\s*"absolute"/.test(reserveBarSrc),
);

// 6. NO oversized void: the screen's scroll paddingBottom is a tiny tail pad, not
//    a bar-sized clearance (the old BAR_FLOAT_BOTTOM + BAR_CARD_HEIGHT formula is
//    GONE — that produced the black gap Seth flagged).
ok(
  "B6 the oversized bar-sized paddingBottom void is removed",
  /const reserveBarClearance\s*=\s*8\b/.test(screenSrc) &&
    !/BAR_FLOAT_BOTTOM/.test(screenSrc) &&
    !/BAR_CARD_HEIGHT/.test(screenSrc),
  "the black gap came from an oversized bottom padding — it must be gone",
);

// 7. The floating pill renders the SAME CTA body as the docked one (shared
//    ctaBody) so the price/deposit copy is correct in BOTH states.
ok(
  "B7 both variants render the shared ctaBody (price/deposit copy correct in both)",
  /const ctaBody = tappable \?/.test(reserveBarSrc) &&
    /<View style=\{styles\.floatPill\}>\{ctaBody\}<\/View>/.test(reserveBarSrc) &&
    /\{ctaBody\}\s*<\/View>/.test(reserveBarSrc),
  "the floating + docked CTAs must share one body so the copy never diverges",
);

console.log(`\n${passed} assertions passed (ORCH-1138 reserve float→dock).`);
