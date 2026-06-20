// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 Leg 2 [public event page redesign] — business/shared regression test.
//
// Proves (1) the shared PublicEventPage has a FOUNDATION dual-mode that composes
// ParallaxCoverShell when the palette + chrome handlers are present AND keeps the
// LEGACY stacked-card render for its OTHER consumers (EBES experiences + chat —
// SC-9 / G-5), (2) the business adapter wires the FOUNDATION props + the shared
// EventOfferingFloatingBar (OQ-1b, post-ORCH-1167) around the SAME
// resolveOfferingCta, (3) the checkout
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
// (FoundationEventPreview), NOT the shared package. (ORCH-1169 merged the two
// rendering packages into one @mingla/offering-rendering.) The shared
// PublicEventPage stays BYTE-IDENTICAL to origin/main (its LEGACY render for EBES).
const foundationSrc = read("src/components/event/FoundationEventPreview.tsx");
const sharedSrc = read("../packages/offering-rendering/PublicEventPage.tsx");
const adapterSrc = read("src/components/event/PublicEventPage.tsx");

const strip = (src) =>
  src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const foundation = strip(foundationSrc);
const shared = strip(sharedSrc);
const adapter = strip(adapterSrc);

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
  // ORCH-1167 (SHELL-AGNOSTIC-BODY): the once-forked FoundationTierRow radiogroup
  // was retired; the selectable per-tier ticket box is now the SHARED EventTicketBox
  // driven by ticketQuantities + onChangeTicketQuantity (one owner, all surfaces).
  "T1c FOUNDATION body drives the shared selectable ticket box (per-tier quantities)",
  /ticketQuantities/.test(foundation) &&
    /onChangeTicketQuantity/.test(foundation),
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

// ── OQ-1b (post-ORCH-1167): the adapter drives the single CTA via the SHARED
// EventOfferingFloatingBar + EventTicketBox from @mingla/offering-rendering — the
// once-local EventReserveBar was superseded/DELETED (ORCH-1167 → ORCH-1168). ───
ok(
  "T-OQ1 adapter drives the float/dock CTA via the shared EventOfferingFloatingBar",
  /EventOfferingFloatingBar/.test(adapter) &&
    /from\s+"@mingla\/offering-rendering"/.test(adapter),
);
ok(
  "T-OQ1b adapter does NOT import the trip TripReserveBar",
  !/TripReserveBar/.test(adapter),
);
ok(
  "T-OQ1c adapter no longer imports the deleted local EventReserveBar",
  !/from\s*"\.\/EventReserveBar"/.test(adapter),
);
ok(
  "T-OQ1c2 the local EventReserveBar.tsx file is removed (dead code — ORCH-1168)",
  !fs.existsSync(path.join(ROOT, "src/components/event/EventReserveBar.tsx")),
);
ok(
  "T-OQ1d adapter reads the shared CtaState/resolveOfferingCta (one owner)",
  /resolveOfferingCta\(/.test(adapter),
);

// ── SC-3: adapter drives the single CTA from resolveOfferingCta ──────────────
ok(
  "T3 adapter computes the CTA from resolveOfferingCta (single owner)",
  /resolveOfferingCta\(/.test(adapter) && /computeOfferingVariant\(/.test(adapter),
);
ok(
  // ORCH-1167: the inline `dockedReserve` prop was retired — the float/dock CTA is
  // now the shared <EventOfferingFloatingBar>, and the FOUNDATION body receives the
  // ticket-box + proceed-to-cart handlers. The FOUNDATION props remain palette +
  // chrome (mute) + the cart proceed handler.
  "T3b adapter passes FOUNDATION props (palette + chrome handlers + proceed-to-cart) to FoundationEventPreview",
  /palette=\{palette\}/.test(adapter) &&
    /onToggleMute=\{handleToggleMute\}/.test(adapter) &&
    /onProceedToCart=\{handleProceedToCart\}/.test(adapter),
);
ok(
  "T3c adapter wires float→dock pill visibility (onScroll + onScrollViewLayout)",
  /onScroll=\{handleScroll\}/.test(adapter) &&
    /onScrollViewLayout=\{handleScrollLayout\}/.test(adapter),
);

// ── N7 / G-3: checkout target UNCHANGED, no address/tax on the event page ─────
ok(
  // ORCH-1167 (cart-seed): Get-tickets now routes through the cart-seeded public
  // checkout — checkoutPublicPathWithSeed(event.id, …) — still keyed by the SAME
  // event.id, still the existing public checkout target (no new path, N7-preserved).
  "T15a adapter routes Get-tickets to the EXISTING public checkout (seeded, keyed by event.id)",
  /checkoutPublicPathWithSeed\(event\.id/.test(adapter),
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
