// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1182 [cart-duetoday-qty] — implementor-owned SOURCE-CONTRACT test (the
// app-mobile node:assert convention; app-mobile has no jest/RTL runner). Proves
// the qty-scaled "Due today" + the full "Total" wiring is in place and FAILS on a
// true line-deletion (fails-on-revert).
//
// THE BUG: the consumer cart's sticky bar showed "Due today €125,00" for a €500 /
// 25%-deposit tier at QTY 2 — must be €250,00. Root cause: the screen passed the
// qty-1 `offeringState.projectedSchedule.depositCents` to <TicketCartSheet>. The
// fix hands the cart the per-tier plan data (planTiersByTicketId) so it sums the
// qty-scaled deposit (tripTierDepositTodayCents) over its OWN live lines, and the
// cart shows BOTH a "Total" and a "Due today" line.
//
// Run with:
//   node app-mobile/src/screens/Trip/__tests__/orch_1182_cart_duetoday_qty_wiring.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const screenSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");
const cartSrc = read("src/components/expandedCard/TicketCartSheet.tsx");

// Strip line comments then block comments (the screen's doc comments contain a
// literal "/*)" inside a // line; block-first would swallow real code) — so the
// assertions below only see ACTIVE code, never prose mentioning the old prop.
const stripComments = (src) =>
  src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const screen = stripComments(screenSrc);
const cart = stripComments(cartSrc);

let passed = 0;
const ok = (name, cond, why) => {
  assert.ok(cond, `FAIL: ${name}${why ? ` — ${why}` : ""}`);
  passed += 1;
  console.log(`  ok  ${name}`);
};

// ── §1 — the screen passes the qty-scaled source, NOT the qty-1 unit deposit ──
ok(
  "§1a the screen no longer passes the qty-1 projectedSchedule.depositCents to the cart",
  !/dueTodayCents=\{[\s\S]*?projectedSchedule\.depositCents/.test(screen),
  "the stale unit-deposit scalar prop must be gone (it ignored quantity)",
);
ok(
  "§1b the screen passes planTiersByTicketId (the qty-scalable per-tier plan data) to the cart",
  /planTiersByTicketId=\{planTiersByTicketId\}/.test(screen),
);
ok(
  "§1c planTiersByTicketId is built from the shared tier shape, gated on detail.hasPlan + installments choice",
  /const planTiersByTicketId\s*=\s*useMemo/.test(screen) &&
    /if \(detail === null \|\| !detail\.hasPlan\) return map/.test(screen) &&
    /choice !== "installments"/.test(screen),
);

// ── §2 — the cart computes due-today from its OWN live lines via the shared math ─
ok(
  "§2a the cart imports the SINGLE-OWNER deposit helper (no rebuilt deposit math)",
  /tripTierDepositTodayCents/.test(cart) &&
    /from "@mingla\/offering-rendering"/.test(cart),
);
ok(
  "§2b the cart sums the qty-scaled deposit over its OWN live cart lines",
  /tripTierDepositTodayCents\(planTier, line\.quantity\)/.test(cart),
);

// ── §3 — the cart renders BOTH a Total line AND a Due today line on a plan cart ─
ok(
  "§3a the sticky bar shows a 'Total' label (the qty-scaled all-in) on a plan cart",
  /showsDueToday \? "Total" : "Subtotal"/.test(cart),
);
ok(
  "§3b the sticky bar renders a second 'Due today' line gated on showsDueToday",
  /showsDueToday \? \(/.test(cart) &&
    /Due today<\/Text>/.test(cart) &&
    /dueTodayValueText/.test(cart),
);
ok(
  "§3c the two-line bar is gated so no-plan / pay-in-full carts stay single-line",
  /dueToday\.hasPlanLine/.test(cart),
);

// ── §4 — the charge path is UNTOUCHED (display-only fix) ──
ok(
  "§4a totalCents (the telemetry total) still rides the cart's server all-in, not the deposit",
  /totalCents:\s*pricing\.allInCents/.test(cart),
);
ok(
  "§4b the screen still forwards the explicit pay choice ONLY for a plan trip (consent unchanged)",
  /paymentPlanChoice:\s*detail\.hasPlan \? paymentPlanChoice : undefined/.test(
    screen,
  ),
);

console.log(`\nORCH-1182 cart due-today wiring: ${passed} assertions passed.`);
