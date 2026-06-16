// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 [event-page] — CONSUMER EVENT detail Reserve/"Get tickets" CTA must
// FLOAT→DOCK exactly like the SHIPPED consumer TRIP CTA. Seth (consumer device):
// the event ticket CTA "does not FLOAT while scrolling" — it must be a compact
// floating pill while scrolling that DOCKS flush at the bottom when you reach the
// end (the float→dock language proven on the trip).
//
// This is the EVENT mirror of orch_1138_reserve_float_dock.test.ts (the trip
// regression). The float→dock mechanism has three load-bearing parts that this
// test locks in, each of which FAILS on a TRUE LINE-DELETION of the code that
// implements it:
//
//   1. ConsumerEventReserveBar has BOTH variants — a "docked" in-flow card AND a
//      "floating" compact self-width pill (NOT a docked-only/static bar).
//   2. ConsumerEventDetailScreen wires the swap — it tracks scroll offset +
//      viewport height + the docked layout, derives `floatingPillVisible`, mounts
//      the DOCKED bar as the LAST scroll child, and mounts the FLOATING pill as an
//      absolute sibling shown ONLY while the docked button is off-screen.
//   3. The float-pill visibility PREDICATE matches the trip's exactly (behavioral
//      replica below) — pill shown until the docked button scrolls into view.
//
// EVENT-only delta vs the trip: SINGLE CTA, NO split "Pay over time" (events have
// no installment plan) — asserted explicitly so the event bar never grows a split.
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions + behavioral replicas of pure logic (see the trip sibling).
//
// Run with:
//   node app-mobile/src/screens/Event/__tests__/orch_1138_event_reserve_float_dock.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const screenSrc = read("src/screens/Event/ConsumerEventDetailScreen.tsx");
const reserveBarSrc = read(
  "src/components/offering/ConsumerEventReserveBar.tsx",
);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — ConsumerEventReserveBar exposes a FLOATING variant (not docked-only).
// This is the core of the bug: a CTA that "doesn't float" is one that has no
// floating variant at all. Deleting the floating branch fails E1/E1a/E1b.
// ─────────────────────────────────────────────────────────────────────────────

ok(
  "E1 the reserve bar accepts a variant: 'docked' | 'floating'",
  /variant:\s*"docked"\s*\|\s*"floating"/.test(reserveBarSrc),
  "the float→dock CTA must be variant-driven (a floating variant must exist)",
);
ok(
  "E1a the reserve bar renders the DOCKED in-flow branch",
  /if\s*\(variant === "docked"\)/.test(reserveBarSrc),
  "the docked variant (last scroll child) must exist",
);
{
  // The FLOATING branch is everything AFTER the docked early-return: it builds a
  // compact floatBody and renders it inside the absolute floatWrapper.
  ok(
    "E1b the reserve bar renders the FLOATING compact pill branch",
    /const floatBody = tappable \?/.test(reserveBarSrc) &&
      /\{floatBody\}\s*<\/View>/.test(reserveBarSrc),
    "the floating overlay must render floatBody (the compact pill)",
  );
}

// The FLOATING pill is JUST the button — label only, no kicker, no price block,
// no full-width bar bg (mirrors the trip's device-rework #4).
{
  const floatBodyBlock = reserveBarSrc.match(
    /const floatBody = tappable \? \([\s\S]*?\n  \);/,
  );
  ok("E2 floatBody block is present", floatBodyBlock !== null);
  const floatBodyStr = floatBodyBlock ? floatBodyBlock[0] : "";
  ok(
    "E2a the floating pill renders the CTA label (the tappable 'Get tickets →')",
    /\{cta\.label\} →/.test(floatBodyStr),
  );
  ok(
    "E2b the floating pill does NOT render the kicker (docked-only)",
    !/styles\.rKicker/.test(floatBodyStr),
    "the floating pill must NOT show the 'All-in, taxes included' kicker",
  );
  ok(
    "E2c the floating pill does NOT render the price block (docked-only)",
    !/styles\.rPrice/.test(floatBodyStr),
    "the floating pill must NOT show the price block",
  );
}
{
  const floatButtonBlock = reserveBarSrc.match(
    /floatButton:\s*\{[\s\S]*?\n  \},/,
  );
  ok("E2d floatButton style block present", floatButtonBlock !== null);
  const floatButtonStr = floatButtonBlock ? floatButtonBlock[0] : "";
  ok(
    "E2e the floating button hugs its own width (alignSelf center, NOT width:'100%')",
    /alignSelf:\s*"center"/.test(floatButtonStr) &&
      !/width:\s*"100%"/.test(floatButtonStr),
    "the floating pill must be a self-width FAB, not a full-width bar",
  );
}
// The DOCKED variant still carries the full priced bar body (price block at rest).
ok(
  "E3 the DOCKED variant renders the priced ctaBody (price block intact at rest)",
  /const ctaBody = tappable \?/.test(reserveBarSrc) &&
    /styles\.rPrice/.test(reserveBarSrc),
  "the docked bar must keep its price block — only the floating variant drops it",
);
// The docked card pads its own safe-area bottom + is in NORMAL FLOW (no void).
ok(
  "E3a the docked card pads its own safe-area bottom (clears the home indicator)",
  /paddingBottom:\s*safeBottom\s*\+\s*8/.test(reserveBarSrc),
);
ok(
  "E3b the docked card is in normal flow (dockedCard has no position:absolute)",
  !/dockedCard:\s*\{[^}]*position:\s*"absolute"/.test(reserveBarSrc),
);
// EVENT-only: SINGLE CTA — no split "Pay over time" plan (events have no plan).
ok(
  "E3c the EVENT reserve bar has NO split-CTA branch (single ticket CTA only)",
  !/\bsplitCtas\b/.test(reserveBarSrc) &&
    !/ReserveSplitCtas/.test(reserveBarSrc),
  "events have no installment plan — the event bar must stay single-CTA",
);

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — ConsumerEventDetailScreen WIRES the float→dock swap (this is the part
// whose absence makes a correct component still not float). Deleting any of these
// breaks the swap and fails the matching assertion.
// ─────────────────────────────────────────────────────────────────────────────

ok(
  "E4 the screen mounts the DOCKED reserve as a scroll child",
  /variant="docked"/.test(screenSrc) &&
    /onDockLayout=\{handleDockLayout\}/.test(screenSrc),
  "the docked CTA must be the in-flow last child + report its layout",
);
ok(
  "E4a the screen mounts the FLOATING reserve as an overlay",
  /variant="floating"/.test(screenSrc),
  "the floating pill overlay must be mounted",
);
ok(
  "E4b the floating pill is gated by floatingPillVisible (hidden once docked is in view)",
  /const floatingReserve[^=]*=\s*floatingPillVisible \?/.test(screenSrc),
  "the float overlay must only render while the docked button is off-screen",
);
ok(
  "E4c the docked reserve is the LAST child of the scroll content",
  /\{dockedReserve\}\s*<\/View>\s*<\/BottomSheetScrollView>/.test(
    screenSrc.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""),
  ),
  "the docked CTA must be the final scroll child (flush at the end, no void)",
);
ok(
  "E4d the screen tracks scroll offset + viewport height + dock layout",
  /onScroll=\{handleScroll\}/.test(screenSrc) &&
    /onLayout=\{handleScrollLayout\}/.test(screenSrc) &&
    /const handleDockLayout/.test(screenSrc),
  "without scroll/viewport/dock measurement the pill can never swap",
);
ok(
  "E4e the screen derives floatingPillVisible from dock/scroll/viewport",
  /const floatingPillVisible\s*=/.test(screenSrc) &&
    /dockTopY > scrollY \+ viewportH - REVEAL_MARGIN/.test(screenSrc),
  "the visibility predicate must compare the docked top against the viewport bottom",
);
// The float overlay is an absolute sibling, NOT BaseBottomSheet.stickyFooter
// (which re-triggers the ORCH-1016/1043 scroll-freeze) — honor the invariant.
ok(
  "E5 the float CTA is NOT mounted via stickyFooter (ORCH-1016/1043 scroll-freeze guard)",
  !/stickyFooter/.test(screenSrc),
  "stickyFooter would nest the gorhom scroll and freeze it — must stay an absolute sibling",
);

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — behavioral replica of the screen's floatingPillVisible predicate.
// MUST stay in lockstep with ConsumerEventDetailScreen.tsx (and the trip):
//   const floatingPillVisible =
//     dockTopY === null || viewportH === 0
//       ? true
//       : dockTopY > scrollY + viewportH - REVEAL_MARGIN;
// ─────────────────────────────────────────────────────────────────────────────
const REVEAL_MARGIN = 24;
function floatingPillVisible({ dockTopY, scrollY, viewportH }) {
  if (dockTopY === null || viewportH === 0) return true;
  return dockTopY > scrollY + viewportH - REVEAL_MARGIN;
}

ok(
  "P1 pill VISIBLE before the dock/viewport are measured (safe default)",
  floatingPillVisible({ dockTopY: null, scrollY: 0, viewportH: 0 }) === true,
);
ok(
  "P2 pill VISIBLE at the top of a long page (docked below the fold) — it FLOATS",
  floatingPillVisible({ dockTopY: 2400, scrollY: 0, viewportH: 800 }) === true,
);
ok(
  "P3 pill VISIBLE mid-scroll while the docked button is still off-screen",
  floatingPillVisible({ dockTopY: 2400, scrollY: 1200, viewportH: 800 }) === true,
);
ok(
  "P4 pill HIDDEN once the docked button scrolls into view at the end (it DOCKS)",
  floatingPillVisible({ dockTopY: 2400, scrollY: 1700, viewportH: 800 }) === false,
);
ok(
  "P4b pill HIDDEN exactly at the reveal threshold",
  floatingPillVisible({ dockTopY: 1576, scrollY: 800, viewportH: 800 }) === false,
);
ok(
  "P4c pill still VISIBLE one px before the threshold (no premature hide)",
  floatingPillVisible({ dockTopY: 1577, scrollY: 800, viewportH: 800 }) === true,
);

console.log(
  `\n${passed} assertions passed (ORCH-1138 EVENT reserve float→dock).`,
);
