// #4490 P4-3 — Admin request disputes: the booking id from a pasted guest
// link, state labels, the saved refund terms in words, timeline words (never a
// raw event key), when a hold can be ended, and plain error words.
import test from "node:test";
import assert from "node:assert/strict";

import {
  bookingAdminError,
  bookingIdFromInput,
  bookingStateLabel,
  canForceExpire,
  ladderWords,
  timelineLabel,
} from "../venueOffersAdmin.js";

test("reads the booking id from a guest link or a bare id", () => {
  assert.equal(
    bookingIdFromInput("http://127.0.0.1:8491/visit/1A2B3C4D-1111-4111-8111-111111111111#t=secret"),
    "1a2b3c4d-1111-4111-8111-111111111111",
  );
  assert.equal(bookingIdFromInput("  1a2b3c4d-1111-4111-8111-111111111111 "), "1a2b3c4d-1111-4111-8111-111111111111");
  assert.equal(bookingIdFromInput("VB-6251"), null);
  assert.equal(bookingIdFromInput(null), null);
});

test("labels every booking state, the refund terms and the timeline in words", () => {
  for (const s of ["request_pending", "approved_payment_required", "confirmed", "declined", "request_expired", "reconciliation_required"]) {
    assert.notEqual(bookingStateLabel(s).label, "Unknown");
  }
  assert.equal(
    ladderWords([{ minMinutesBefore: 43200, refundBps: 7500 }, { minMinutesBefore: 21600, refundBps: 5000 }]),
    "75% back up to 30 days before, then 50% back up to 15 days before",
  );
  assert.equal(ladderWords([]), "No refunds");
  assert.equal(timelineLabel("stay_offer_request_declined", "staff"), "Venue declined · venue");
  assert.equal(timelineLabel("stay_offer_something_new", "guest"), "Something new · guest");
});

test("only an unpaid request or hold can be ended; errors are plain words", () => {
  assert.equal(canForceExpire({ state: "request_pending" }), true);
  assert.equal(canForceExpire({ state: "approved_payment_required" }), true);
  assert.equal(canForceExpire({ state: "confirmed" }), false);
  assert.equal(canForceExpire(null), false);
  assert.match(bookingAdminError("offer_payment_already_pending"), /payment was started/);
  assert.doesNotMatch(bookingAdminError("weird_code"), /_/);
});
