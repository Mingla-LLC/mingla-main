// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 [trip-page-redesign] — Reserve goes STRAIGHT TO CART (happy-path
// regression test, implementor-owned). Seth, 2026-06-15: tapping "Reserve my
// spot" on the consumer trip detail must open the CART directly — NOT the
// duplicate ExpandedBusinessEventSheet detail page — and the docked CTA arrow
// must stay inside the button when "Pay over time" is selected.
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions + behavioral replicas of pure logic. Every assertion below
// FAILS on a TRUE LINE-DELETION of the wiring it protects (fails-on-revert).
//
// Run with:
//   node app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_straight_to_cart.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const screenSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");
const reserveBarSrc = read("src/components/offering/ConsumerTripReserveBar.tsx");

// Strip line comments first, then block comments — the screen's doc comments
// contain a literal "/*)" inside a `//` line, so a block-first strip would
// swallow real code. (Same fix as the ORCH-1138 strict-grep gate.)
const stripComments = (src) =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
const screen = stripComments(screenSrc);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── T-1 — Reserve opens the cart, NOT EBES ──
ok(
  "T1a the screen mounts <TicketCartSheet> (the direct cart)",
  /<TicketCartSheet\b/.test(screen),
  "Reserve must open the cart directly",
);
ok(
  "T1b the screen does NOT import ExpandedBusinessEventSheet (no duplicate detail hop)",
  !/import\s*\{[^}]*\bExpandedBusinessEventSheet\b/.test(screen),
);
ok(
  "T1c the screen does NOT mount <ExpandedBusinessEventSheet>",
  !/<ExpandedBusinessEventSheet\b/.test(screen),
);
ok(
  "T1d both Reserve CTAs route to openCart (not a setReserveSheetVisible detail toggle)",
  /onPress=\{openCart\}/.test(screen) &&
    !/setReserveSheetVisible/.test(screen),
  "the docked + floating Reserve must call openCart",
);

// ── T-2 — the dead trip-only adapter is gone ──
ok(
  "T2 the dead tripToBusinessEventCard adapter is removed",
  !/\btripToBusinessEventCard\b/.test(screen),
);

// ── T-3 — pay-over-time forwards the choice AND leads the cart with dueToday ──
ok(
  "T3a the screen forwards the explicit pay choice into its own runNativeCheckout",
  /paymentPlanChoice:\s*detail\.hasPlan \? paymentPlanChoice : undefined/.test(
    screen,
  ),
  "plan trips must send an EXPLICIT choice — never silent 'auto' (DISC-1130-A)",
);
ok(
  // [TEST-MOD-APPROVED ORCH-1182] ORCH-1182 replaced the qty-1 `dueTodayCents`
  // scalar with `planTiersByTicketId` — the cart now sums the QTY-SCALED deposit
  // (tripTierDepositTodayCents) over its own live lines, so qty 2 of a €500/25%
  // tier shows €250 today, not the stale €125 unit deposit. Still fails on revert.
  "T3b the cart's sticky bar leads with the qty-scaled deposit due today on pay-over-time",
  /planTiersByTicketId=\{planTiersByTicketId\}/.test(screen) &&
    /tripTierDepositTodayCents/.test(screen),
);

// ── T-4 — checkout request stays byte-identical (no address, no taxCalculationId) ──
ok(
  "T4a the trip checkout NEVER sends a billing address",
  !/\baddress:/.test(screen) || !/runNativeCheckout\(\{[\s\S]*?\baddress:/.test(screen),
  "venue-sourced tax (ORCH-1025/1130) — the buyer never types an address",
);
ok(
  "T4b the trip checkout NEVER sends a taxCalculationId",
  !/taxCalculationId/.test(screen),
);
ok(
  "T4c the checkout forwards the cart lines + buyer + marketingOptIn (same shape as the EBES path)",
  /lines:\s*payload\.lines/.test(screen) &&
    /marketingOptIn:\s*payload\.marketingOptIn/.test(screen),
);

// ── T-4d — post-success cache invalidations ported verbatim (SPEC OQ-1) ──
ok(
  "T4d a successful trip purchase invalidates the same caches the EBES path did (orders + circle)",
  /queryKey:\s*\["businessEventOrders",\s*userId\]/.test(screen) &&
    /queryKey:\s*circleKeys\.all/.test(screen),
);

// ── T-7 — the docked CTA arrow stays inside the button on pay-over-time ──
const bar = reserveBarSrc;
ok(
  "T7a the price/kicker block YIELDS space first (flexShrink:1 + minWidth:0)",
  /rLeft:\s*\{[^}]*flexShrink:\s*1[^}]*minWidth:\s*0/.test(bar) ||
    /rLeft:\s*\{[^}]*minWidth:\s*0[^}]*flexShrink:\s*1/.test(bar),
  "the long 'From {deposit} today' price must shrink, not push the arrow out",
);
ok(
  "T7b the label+arrow (rCta) never shrink (flexShrink:0) so '→' stays pinned inside",
  /rCta:\s*\{[^}]*flexShrink:\s*0/.test(bar),
);
ok(
  "T7c the price truncates with one-line ellipsis instead of overflowing",
  /styles\.rPrice[\s\S]{0,120}numberOfLines=\{1\}/.test(bar),
);
ok(
  "T7d the docked CTA label stays on one line (arrow can't wrap off the row)",
  /styles\.rCta[\s\S]{0,120}numberOfLines=\{1\}/.test(bar),
);

console.log(
  `\n${passed} assertions passed (ORCH-1138 reserve straight-to-cart + arrow-bleed).`,
);
