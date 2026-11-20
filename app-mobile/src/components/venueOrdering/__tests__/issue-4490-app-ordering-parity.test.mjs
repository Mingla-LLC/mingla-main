// Issue #4490 (N143 / N144 / N145, Explorer app) — the app matches buyer web:
// a pickup order from a table is kept apart and linked from the table menu,
// its own tokens drive its status / cancel / retry, an unpaid order offers
// "Cancel order" (never a refund) and a real "Try again", and the app stops
// asking once a payment is declined.
// Fails-on-revert: table tokens on a pickup order fail A-1/A-2; removing the
// link fails A-3; a fixed interval or no decline stop fails A-4.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { venueOrderActiveSitting } from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingSitting.ts";
import { venueOrderStatusPollDelay } from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingPoll.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repo, relative), "utf8");
const hook = read("app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts");
const slots = read("app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx");
const pane = read("packages/brand-rendering/venueOrdering/VenueOrderStatusPane.tsx");

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
  assert.match(hook, /const token = activeSitting\?\.guestCancelToken \?\? null;/);
  assert.match(hook, /const token = activeSitting\?\.buyerStatusToken \?\? null;\n\s+if \(orderId === null \|\| token === null\) return;/);
  assert.doesNotMatch(hook, /const token = sitting\?\.(guestCancelToken|buyerStatusToken)/);
  // a pickup order is remembered apart from the table and put on screen
  assert.match(hook, /else setCounterSitting\(/);
  assert.match(hook, /setViewingCounter\(toCounter\);/);
});

test("A-3 the table menu links to the pickup order; Try again is wired", () => {
  assert.match(slots, /Your pickup order · See status/);
  assert.match(slots, /onPress=\{ordering\.openCounterOrder\}/);
  assert.match(slots, /if \(!ordering\.hasCounterOrder\) return chip;/);
  assert.match(slots, /onRetryPayment=\{ordering\.retryPayment\}/);
  // the shared pane: an unpaid order offers Cancel order, never a refund
  assert.match(pane, /"Cancel order"/);
});

test("A-4 unpaid reads back off (5 s, 10 s, 20 s, stop) and a decline stops at once", () => {
  const pending = { paymentStatus: "pending", paymentCheck: "in_progress" };
  assert.deepEqual([0, 1, 2, 3].map((n) => venueOrderStatusPollDelay(pending, n, 4000)), [5000, 10000, 20000, null]);
  assert.equal(venueOrderStatusPollDelay({ paymentStatus: "pending", paymentCheck: "not_paid" }, 0, 4000), null);
  assert.match(hook, /venueOrderStatusPollDelay\(live, pendingReadsRef\.current, STATUS_POLL_INTERVAL_MS\)/);
  assert.doesNotMatch(hook, /setInterval\(\(\) => \{\n\s+void fetchVenueOrderStatus/);
  assert.match(hook, /if \(status\.paymentCheck === "not_paid"\) return;/);
});

// N149 (#4490): the pickup link uses design-system tokens and a 44 pt target.
// Fails-on-revert: hardcoded 14/20/8 or a hitSlop-only target fails A-5.
test("A-5 the pickup link uses tokens and a 44 pt tap target", () => {
  const block = slots.slice(slots.indexOf("const counterStyles"));
  assert.match(block, /minHeight: touchTargets\.minimum/);
  assert.match(block, /\.\.\.typography\.sm/);
  assert.match(block, /fontWeight: fontWeights\.bold/);
  assert.match(block, /gap: spacing\.sm/);
  assert.doesNotMatch(block.slice(0, block.indexOf("});")), /fontSize: \d|lineHeight: \d|gap: \d/);
  assert.match(slots, /style=\{counterStyles\.target\}/);
});
