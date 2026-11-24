// Issue #1793 rework — structural proof for the native cancellation seam.
// PaymentSheet cancellation leaves the basket/key intact; the next Pay accepts
// the server's `resumed` continuation and does not overwrite its saved tokens.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { presentVenueOrderPayment } from "../venueOrderPaymentPresentation.ts";
import { venueOrderActiveSitting } from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingSitting.ts";
import { venueOrderStatusPollDelay } from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingPoll.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repo, relative), "utf8");

test("T-1793-R8 — native cancel keeps the stable basket key and accepts the resumed PaymentIntent", () => {
  const hook = read(
    "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
  );
  const service = read("app-mobile/src/services/venueOrderingService.ts");

  assert.match(hook, /presentation\.status === "failed"/);
  assert.match(hook, /idempotencyKeyFor\(priceSignature\)/);
  assert.match(
    hook,
    /created\.kind === "free_completed" \|\| !created\.resumed/,
  );
  // TEST-MOD-APPROVED #4490: a resumed order's token now comes from the sitting
  // it belongs to (the table's, or a pickup order's own, N145); the resume
  // behaviour this guards is unchanged.
  assert.match(hook, /[sS]itting(\([\s\S]*?\))?\?\.buyerStatusToken \?\? ""\)/);
  assert.match(service, /resumed: data\.resumed === true/);
});

test("T-1793-R9 — closing Paystack can reopen the same transaction from status", () => {
  const hook = read(
    "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
  );
  const service = read("app-mobile/src/services/venueOrderingService.ts");
  const slots = read(
    "app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx",
  );

  assert.match(service, /includePaymentContinuation: true/);
  assert.match(service, /value\.kind === "requires_paystack_redirect"/);
  assert.match(hook, /resumeVenueOrderPayment\(orderId, token\)/);
  // #2227 [TEST-MOD-APPROVED #2227]: the NG hand-off moved off
  // openAuthSessionAsync — an https redirect argument made iOS >= 17.4 destroy
  // the session before it presented. The reopen behaviour this test guards is
  // unchanged; only the primitive it names moved.
  assert.match(hook, /openBrowserAsync\([\s\S]*authorizationUrl/);
  assert.doesNotMatch(hook, /openAuthSessionAsync\s*\(/);
  assert.match(slots, /onRetryPayment=\{ordering\.retryPayment\}/);
});

test("T-1793-R11 — first PaymentSheet cancel then second Pay presents the same order and PaymentIntent", async () => {
  const identity = { orderId: "order_same", paymentIntentId: "pi_same" };
  let presentations = 0;
  const present = async () => {
    presentations++;
    return presentations === 1 ? { error: { code: "Canceled" } } : {};
  };

  const first = await presentVenueOrderPayment({ ...identity, present });
  const second = await presentVenueOrderPayment({ ...identity, present });

  assert.equal(first.status, "cancelled");
  assert.equal(second.status, "completed");
  assert.equal(presentations, 2);
  assert.deepEqual(
    [first.orderId, first.paymentIntentId],
    [second.orderId, second.paymentIntentId],
  );
  assert.deepEqual(
    [second.orderId, second.paymentIntentId],
    ["order_same", "pi_same"],
  );
});

// [TEST-MOD-APPROVED #4490] The #4490 app parity cases live here so the
// existing test:issue-1793 script runs them without changing the sealed
// app-mobile/package.json authority.
// Issue #4490 (N143 / N144 / N145, Explorer app) — the app matches buyer web:
// a pickup order from a table is kept apart and linked from the table menu,
// its own tokens drive its status / cancel / retry, an unpaid order offers
// "Cancel order" (never a refund) and a real "Try again", and the app stops
// asking once a payment is declined.
// Fails-on-revert: table tokens on a pickup order fail A-1/A-2; removing the
// link fails A-3; a fixed interval or no decline stop fails A-4.


const parityHook = read("app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts");
const paritySlots = read("app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx");
const parityPane = read("packages/brand-rendering/venueOrdering/VenueOrderStatusPane.tsx");

const seat = (id) => ({
  sessionId: `s-${id}`, orderId: `o-${id}`, buyerStatusToken: `bst-${id}`,
  guestCancelToken: `gct-${id}`, tip: { bps: 0, flatCents: null }, partySizeClaimed: null,
  buyerName: "Tayo", expiresAt: Date.now() + 60_000,
});

test("A-1 a pickup order on screen uses its own sitting, the table its own", () => {
  const table = seat("table");
  const counter = seat("counter");
  assert.equal(venueOrderActiveSitting({ table, counter, viewingCounter: true }), counter);
  assert.equal(venueOrderActiveSitting({ table, counter, viewingCounter: false }), table);
});

test("A-2 the app's status, cancel and retry read the active sitting's tokens", () => {
  assert.match(parityHook, /const token = activeSitting\?\.guestCancelToken \?\? null;/);
  assert.match(parityHook, /const token = activeSitting\?\.buyerStatusToken \?\? null;\n\s+if \(orderId === null \|\| token === null\) return;/);
  assert.doesNotMatch(parityHook, /const token = sitting\?\.(guestCancelToken|buyerStatusToken)/);
  // a pickup order is remembered apart from the table and put on screen
  assert.match(parityHook, /else setCounterSitting\(/);
  assert.match(parityHook, /setViewingCounter\(toCounter\);/);
});

test("A-3 the table menu links to the pickup order; Try again is wired", () => {
  assert.match(paritySlots, /Your pickup order · See status/);
  assert.match(paritySlots, /onPress=\{ordering\.openCounterOrder\}/);
  assert.match(paritySlots, /if \(!ordering\.hasCounterOrder\) return chip;/);
  assert.match(paritySlots, /onRetryPayment=\{ordering\.retryPayment\}/);
  // the shared pane: an unpaid order offers Cancel order, never a refund
  assert.match(parityPane, /"Cancel order"/);
});

test("A-4 unpaid reads back off (5 s, 10 s, 20 s, stop) and a decline stops at once", () => {
  const pending = { paymentStatus: "pending", paymentCheck: "in_progress" };
  assert.deepEqual([0, 1, 2, 3].map((n) => venueOrderStatusPollDelay(pending, n, 4000)), [5000, 10000, 20000, null]);
  assert.equal(venueOrderStatusPollDelay({ paymentStatus: "pending", paymentCheck: "not_paid" }, 0, 4000), null);
  assert.match(parityHook, /venueOrderStatusPollDelay\(live, pendingReadsRef\.current, STATUS_POLL_INTERVAL_MS\)/);
  assert.doesNotMatch(parityHook, /setInterval\(\(\) => \{\n\s+void fetchVenueOrderStatus/);
  assert.match(parityHook, /if \(status\.paymentCheck === "not_paid"\) return;/);
});

// N149 (#4490): the pickup link uses design-system tokens and a 44 pt target.
// Fails-on-revert: hardcoded 14/20/8 or a hitSlop-only target fails A-5.
test("A-5 the pickup link uses tokens and a 44 pt tap target", () => {
  const block = paritySlots.slice(paritySlots.indexOf("const counterStyles"));
  assert.match(block, /minHeight: touchTargets\.minimum/);
  assert.match(block, /\.\.\.typography\.sm/);
  assert.match(block, /fontWeight: fontWeights\.bold/);
  assert.match(block, /gap: spacing\.sm/);
  assert.doesNotMatch(block.slice(0, block.indexOf("});")), /fontSize: \d|lineHeight: \d|gap: \d/);
  assert.match(paritySlots, /style=\{counterStyles\.target\}/);
});

test("#3645 — a 'review the new price' refusal fetches the preview again before the next Pay", () => {
  const hook = read(
    "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
  );
  const wire = read("packages/brand-rendering/venueOrdering/venueOrderingWire.ts");

  // The shared parser gives the bare 409 the guest sentence, not "Something went wrong".
  assert.match(wire, /export const VENUE_ORDER_REVIEW_REQUIRED = "checkout_review_required";/);
  assert.match(wire, /venueOrderNeedsFreshQuote\(code\)\s*\?\s*VENUE_ORDER_PRICE_CHANGED_MESSAGE/);
  // The hook refetches the preview on exactly that code, inside the submit catch,
  // so the next Pay carries the new quote digest instead of being refused again.
  assert.match(hook, /const refetchPreview = previewQuery\.refetch;/);
  assert.match(
    hook,
    /error instanceof VenueOrderError &&\s*venueOrderNeedsFreshQuote\(error\.code\)\s*\)\s*\{\s*void refetchPreview\(\);/,
  );
  assert.match(hook, /quoteDigest: previewQuery\.data\?\.quoteDigest \?\? null/);
});
