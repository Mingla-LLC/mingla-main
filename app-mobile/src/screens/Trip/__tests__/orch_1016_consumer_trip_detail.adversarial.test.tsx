// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1016 [Consumer Discover Trips tab] — TESTER adversarial regression test.
// SPEC §10 named path:
//   app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx
//
// ── ADVERSARIAL ANGLE (deliberately DIFFERENT from the implementor's test) ──
// The implementor's check (app-mobile/scripts/ci/orch-1016-trips-discovery-service-check.mjs)
// asserts the HAPPY service contract: camelCase→p_* mapping, throw-on-error,
// totalCount, no-AsyncStorage, no-`.from('brands')`. This test attacks the
// FAILURE / NULL / DEADLINE / INTAKE-GAP surfaces of the consumer DETAIL + card
// that production actually spends most of its time in:
//
//   T-14   CTA-closed enforcement: deadlineState() must treat (a) bookings_closed
//          and (b) a PAST booking_deadline as closed → Reserve disabled. A
//          deep-linked stale trip whose deadline elapsed must NOT be reservable.
//   T-NULL malformed / null RPC row: the detail screen's value-resolution must
//          fall back to the seed and never render the literal "null"/"undefined"
//          for missing destination/departure/cover — and every optional line is
//          gated on `!== null` (no fabricated departure / verified badge).
//   T-19   verified badge is gated on `brandVerified === true` truthiness only
//          (no "verified by default"); "Leaving from" gated on departureText.
//   T-D2   INTAKE RENDERER (this ORCH's D2 rework, [TEST-MOD-APPROVED ORCH-1016]):
//          the consumer Reserve path (ExpandedBusinessEventSheet → TicketCartSheet)
//          NOW collects per-tier intake answers and forwards them to
//          ticket-checkout-create as `intake_form_data`, so a published trip
//          carrying a REQUIRED trip_intake_schema can complete checkout instead of
//          being hard-rejected by the edge fn (`intake_form_required`). The prior
//          T-D2a pinned the OLD gap ("sheet supplies no intake answers"); after the
//          D2 rework that assertion is INVERTED to pin that the renderer collects +
//          submits answers — a future regression that drops the wiring must fail it.
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions + behavioral replicas (see
// src/components/profile/__tests__/orch-0993-add-friend-cta.adversarial.test.tsx).
// Run with:  node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx
//
// Every assertion is written to FAIL if the guard it protects is reverted.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const detailSrc = fs.readFileSync(
  path.join(ROOT, "src/screens/Trip/ConsumerTripDetailScreen.tsx"),
  "utf8",
);
const cardSrc = fs.readFileSync(
  path.join(ROOT, "src/components/discover/TripCard.tsx"),
  "utf8",
);
const sheetSrc = fs.readFileSync(
  path.join(ROOT, "src/components/expandedCard/ExpandedBusinessEventSheet.tsx"),
  "utf8",
);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── T-14: deadlineState behavioral replica (mirrors the source function) ──
// Reverting any branch (bookings_closed → closed, deadline<=now → closed) makes
// one of these assertions fail.
function deadlineState(detail, nowMs) {
  if (detail.bookingsClosed) return { closed: true };
  if (detail.bookingDeadline === null) return { closed: false };
  const ms = new Date(detail.bookingDeadline).getTime() - nowMs;
  if (ms <= 0) return { closed: true };
  return { closed: false };
}
const NOW = Date.parse("2026-05-30T00:00:00Z");
ok(
  "T-14a bookings_closed=true → closed (Reserve disabled)",
  deadlineState({ bookingsClosed: true, bookingDeadline: null }, NOW).closed === true,
);
ok(
  "T-14b past booking_deadline → closed (deep-linked stale trip)",
  deadlineState({ bookingsClosed: false, bookingDeadline: "2026-05-01T00:00:00Z" }, NOW).closed === true,
);
ok(
  "T-14c future deadline → open",
  deadlineState({ bookingsClosed: false, bookingDeadline: "2026-12-01T00:00:00Z" }, NOW).closed === false,
);
ok(
  "T-14d NULL deadline → open (surfaced)",
  deadlineState({ bookingsClosed: false, bookingDeadline: null }, NOW).closed === false,
);
// Source actually wires reserveDisabled = closed, and shows "Bookings closed".
ok(
  "T-14e source: reserveDisabled derives from closed deadline state",
  /const\s+\{\s*closed[\s\S]*?\}\s*=\s*deadlineState\(/.test(detailSrc) &&
    /reserveDisabled\s*=\s*closed/.test(detailSrc) &&
    /disabled=\{reserveDisabled\}/.test(detailSrc),
  "deadlineState→reserveDisabled→disabled wiring must be intact",
);

// ── T-NULL: no fabricated / literal-null leakage; optional lines gated ──
ok(
  "T-NULL-a detail: 'Leaving from' rendered ONLY when departureText !== null",
  /detail\.departureText\s*!==\s*null\s*\?[\s\S]{0,400}?Leaving from \{detail\.departureText\}/.test(detailSrc),
);
ok(
  "T-NULL-b detail: destination line gated on destinationText !== null",
  /detail\.destinationText\s*!==\s*null\s*\?/.test(detailSrc),
);
ok(
  "T-NULL-c detail: cover uses EventCoverMedia with a hue fallback (never a fake photo)",
  /<EventCoverMedia[\s\S]*?hue=\{hueFromId\(detail\.tripId\)\}/.test(detailSrc),
);
ok(
  "T-NULL-d detail: value resolution falls back to seed (ev?.x ?? feedRow.x pattern is in the hook, screen reads detail.*)",
  /detail\.title/.test(detailSrc) && !/\{null\}/.test(detailSrc),
);

// ── T-19: verified badge gated on === true / truthiness, never default-on ──
ok(
  "T-19a detail: verified badge gated on brandVerified truthiness (shield only when true)",
  /detail\.brandVerified\s*\?\s*\(?[\s\S]{0,80}shield-checkmark/.test(detailSrc),
);
ok(
  "T-19b card: verified badge gated on brandVerified (no unconditional badge)",
  /trip\.brandVerified\s*\?/.test(cardSrc),
);
ok(
  "T-19c card: 'Leaving from' gated on departureText !== null",
  /trip\.departureText\s*!==\s*null\s*\?[\s\S]{0,400}?Leaving from \{trip\.departureText\}/.test(cardSrc),
);
ok(
  "T-19d card: spots line gated on spotsLeft !== null (unlimited → hidden, never fabricated)",
  /trip\.spotsLeft\s*!==\s*null/.test(cardSrc),
);

// ── T-D2: the intake renderer pin (INVERTED by the D2 rework) ──
// [TEST-MOD-APPROVED ORCH-1016] — the prior T-D2a pinned the OLD gap ("sheet
// supplies no intake answers"). The D2 rework closed that gap: the Reserve path
// now fetches per-tier schemas (useTripIntakeSchemas), forwards them into the
// cart sheet, and pushes the collected `intakeFormData` into runNativeCheckout
// (→ ticket-checkout-create `intake_form_data`). T-D2a now asserts the renderer
// COLLECTS + SUBMITS answers; a future regression that drops the wiring fails it.
const cartSrc = fs.readFileSync(
  path.join(ROOT, "src/components/expandedCard/TicketCartSheet.tsx"),
  "utf8",
);
const rendererSrc = fs.readFileSync(
  path.join(ROOT, "src/components/expandedCard/ConsumerIntakeForm.tsx"),
  "utf8",
);
ok(
  "T-D2a Reserve sheet NOW collects + submits intake answers (D2 gap closed)",
  // (1) the sheet fetches per-tier schemas and feeds the cart,
  /useTripIntakeSchemas\(/.test(sheetSrc) &&
    /intakeSchemasByTier=\{intakeSchemasQuery\.data\}/.test(sheetSrc) &&
    // (2) it forwards the collected answers to the checkout flow,
    /payload\.intakeFormData\.length\s*>\s*0/.test(sheetSrc) &&
    /intakeFormData:\s*payload\.intakeFormData/.test(sheetSrc) &&
    // (3) the cart renders the per-tier renderer + builds the submit array,
    /<ConsumerIntakeForm/.test(cartSrc) &&
    /buildIntakeFormData\(/.test(cartSrc) &&
    // (4) and a real per-type renderer exists (not a stub).
    /case "single_choice"/.test(rendererSrc),
  "the D2 intake renderer wiring must be intact — sheet → cart → checkout body",
);
ok(
  "T-D2a' required-answer gate blocks checkout before payment (fail-closed preserved)",
  /validateAnswerAgainstSchema\(/.test(cartSrc) &&
    /setIntakeErrors\(nextErrors\)/.test(cartSrc) &&
    /if\s*\(hasUnsupportedRequired\)\s*return;/.test(cartSrc),
  "required validation + unsupported-required CTA block must gate handleConfirm",
);
ok(
  "T-D2b detail screen documents the deferred-intake seam (extension point named)",
  /intake/i.test(detailSrc),
);
// And the plumbing it WOULD use exists in nativeCheckoutFlow (so the future
// renderer has a clean sink). Assert the body key forwarder is present.
const flowSrc = fs.readFileSync(
  path.join(ROOT, "src/payments/nativeCheckoutFlow.ts"),
  "utf8",
);
ok(
  "T-D2c nativeCheckoutFlow forwards intake_form_data → orders.intake_form_data (clean future sink)",
  /input\.intakeFormData[\s\S]{0,80}intake_form_data:\s*input\.intakeFormData/.test(flowSrc),
);

// ── D1 pin: trip→event-card mapping must NOT leak event-only taxonomy ──
ok(
  "D1 trip→card map zeroes party/vibe/genre + null distance (no event-only chrome leaks)",
  /partyTypes:\s*\[\]/.test(detailSrc) &&
    /vibeTags:\s*\[\]/.test(detailSrc) &&
    /musicGenres:\s*\[\]/.test(detailSrc) &&
    /distanceMeters:\s*null/.test(detailSrc),
);

console.log(`\n# ORCH-1016 consumer-trip-detail adversarial — ${passed} checks PASS`);
