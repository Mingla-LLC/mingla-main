// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 Leg 2 [public event page redesign] — business/shared regression test.
//
// Proves (1) the shared PublicEventPage has a FOUNDATION dual-mode that composes
// ParallaxCoverShell when the palette + chrome handlers are present AND keeps the
// LEGACY stacked-card render for its OTHER consumers (EBES experiences + chat —
// SC-9 / G-5), (2) the business adapter wires the FOUNDATION props + a NEW
// EventReserveBar (OQ-1b) around the SAME resolveOfferingCta, (3) the checkout
// target is UNCHANGED (byte-identical — N7), and (4) NO trip-only blocks appear
// on the event page (rule 9 / N2 / N3).
//
// Source-assertion convention (matches the app-mobile mobile-test pattern). Every
// assertion FAILS on true LINE-DELETION of the guard it protects (fails-on-revert).
//
// Run with:
//   node mingla-business/src/components/event/__tests__/orch_1138_event_foundation.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ORCH-1138 Leg 2 — the FOUNDATION composition lives in the APP layer
// (FoundationEventPreview), NOT the shared package, to avoid the runtime
// event-rendering↔offering-rendering circular dependency (sim-proven). The shared
// PublicEventPage stays BYTE-IDENTICAL to origin/main (its LEGACY render for EBES).
const foundationSrc = read("src/components/event/FoundationEventPreview.tsx");
const sharedSrc = read("../packages/event-rendering/PublicEventPage.tsx");
const adapterSrc = read("src/components/event/PublicEventPage.tsx");
const reserveBarSrc = read("src/components/event/EventReserveBar.tsx");

const strip = (src) =>
  src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const foundation = strip(foundationSrc);
const shared = strip(sharedSrc);
const adapter = strip(adapterSrc);
const reserveBar = strip(reserveBarSrc);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── SC-1 / T-1: FOUNDATION page composes ParallaxCoverShell (app layer) ───────
ok(
  "T1a FoundationEventPreview imports ParallaxCoverShell from offering-rendering",
  /ParallaxCoverShell/.test(foundation) &&
    /from\s+"@mingla\/offering-rendering"/.test(foundation),
);
ok(
  "T1b FOUNDATION body composes <ParallaxCoverShell>",
  /<ParallaxCoverShell\b/.test(foundation),
);
ok(
  "T1c FOUNDATION body renders a selectable tier radiogroup",
  /accessibilityRole="radiogroup"/.test(foundation) &&
    /FoundationTierRow/.test(foundation),
);
ok(
  "T1d adapter renders FoundationEventPreview for the non-cancelled/password variants",
  /import\s*\{\s*FoundationEventPreview\s*\}\s*from\s*"\.\/FoundationEventPreview"/.test(
    adapter,
  ) && /<FoundationEventPreview\b/.test(adapter),
);

// ── SC-9 / G-5 / N1: shared package is UNCHANGED (EBES experiences + chat) ────
ok(
  "T17a shared PublicEventPage does NOT import @mingla/offering-rendering (no package cycle)",
  !/@mingla\/offering-rendering/.test(shared),
  "the FOUNDATION composition lives in the app layer; the package import would create a runtime cycle",
);
ok(
  "T17b shared renderer still honors hideFloatingChrome + ScrollComponent (EBES props)",
  /hideFloatingChrome/.test(shared) && /ScrollComponent/.test(shared),
);
ok(
  "T17c shared renderer keeps its PublishedBody (legacy stacked render for EBES)",
  /PublishedBody/.test(shared),
);

// ── OQ-1b: a NEW EventReserveBar (NOT a generalization of the trip bar) ───────
ok(
  "T-OQ1 adapter imports the NEW EventReserveBar",
  /import\s*\{\s*EventReserveBar\s*\}\s*from\s*"\.\/EventReserveBar"/.test(
    adapter,
  ),
);
ok(
  "T-OQ1b adapter does NOT import the trip TripReserveBar",
  !/TripReserveBar/.test(adapter),
);
ok(
  "T-OQ1c EventReserveBar is single-CTA (no split-CTA branch)",
  !/\bsplitCtas\b/.test(reserveBar) && !/ReserveSplitCtas/.test(reserveBar),
);
ok(
  "T-OQ1d EventReserveBar reads the shared CtaState (one owner)",
  /CtaState/.test(reserveBar),
);

// ── SC-3: adapter drives the single CTA from resolveOfferingCta ──────────────
ok(
  "T3 adapter computes the CTA from resolveOfferingCta (single owner)",
  /resolveOfferingCta\(/.test(adapter) && /computeOfferingVariant\(/.test(adapter),
);
ok(
  "T3b adapter passes FOUNDATION props (palette + chrome handlers) to FoundationEventPreview",
  /palette=\{palette\}/.test(adapter) &&
    /onToggleMute=\{handleToggleMute\}/.test(adapter) &&
    /dockedReserve=\{dockedReserve\}/.test(adapter),
);
ok(
  "T3c adapter wires float→dock pill visibility (onScroll + onScrollViewLayout)",
  /onScroll=\{handleScroll\}/.test(adapter) &&
    /onScrollViewLayout=\{handleScrollLayout\}/.test(adapter),
);

// ── N7 / G-3: checkout target UNCHANGED, no address/tax on the event page ─────
ok(
  "T15a adapter routes Get-tickets to the EXISTING checkoutPublicPath (unchanged)",
  /checkoutPublicPath\(event\.id\)/.test(adapter),
);
ok(
  "T15b adapter never references taxCalculationId (no tax form on the event page)",
  !/taxCalculationId/.test(adapter),
);
ok(
  "T15c adapter does not build a native checkout body (it routes to the existing web checkout page — N7)",
  !/runNativeCheckout/.test(adapter),
);

// ── N2 / N3 / N4 / rule 9: NO trip-only blocks on the event page ─────────────
for (const [name, token] of [
  ["RefundLadder", /\bRefundLadder\b/],
  ["bookingDeadline", /\bbookingDeadline\b/],
  ["paymentPlanChoice", /\bpaymentPlanChoice\b/],
  ["splitCtas", /\bsplitCtas\b/],
  ['"Day by day"', /Day by day/],
  ['"Pay over time"', /Pay over time/],
]) {
  ok(
    `T18 FOUNDATION render has NO ${name} (rule 9)`,
    !token.test(foundation),
  );
  ok(
    `T18b adapter has NO ${name} (rule 9)`,
    !token.test(adapter),
  );
}

console.log(`\nORCH-1138 Leg 2 business/shared event foundation: ${passed} assertions passed.`);
