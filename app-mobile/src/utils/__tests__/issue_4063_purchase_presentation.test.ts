import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPurchaseMoney,
  purchaseCountLabel,
  purchaseKindLabel,
  purchaseRefundLabel,
  purchaseStatusLabel,
} from "../purchasePresentation.ts";
import type { PurchaseTimelineItem } from "../purchaseTimeline.ts";

const item: PurchaseTimelineItem = {
  key: "order:1",
  id: "1",
  kind: "order",
  title: "Dinner",
  brandName: "Mingla",
  coverMediaUrl: null,
  startsAt: "2026-10-25T19:00:00.000Z",
  endsAt: "2026-10-25T21:00:00.000Z",
  timezone: "Europe/London",
  venueLine: null,
  status: "partial_refund",
  count: 2,
  amountCents: 2450,
  refundedAmountCents: 500,
  currency: "GBP",
  source: null,
  raw: null,
};

test("presents purchase kinds, statuses, and quantities in buyer language", () => {
  assert.equal(purchaseKindLabel("order"), "Ticket");
  assert.equal(purchaseKindLabel("reservation"), "Booking");
  assert.equal(purchaseStatusLabel("partial_refund"), "Partially refunded");
  assert.equal(purchaseStatusLabel("awaiting_host"), "Awaiting Host");
  assert.equal(purchaseCountLabel(item), "2 tickets");
});

test("formats provider-neutral minor-unit money and refund copy", () => {
  assert.match(formatPurchaseMoney(2450, "GBP") ?? "", /24\.50/);
  assert.match(purchaseRefundLabel(item) ?? "", /5\.00 refunded/);
  assert.equal(formatPurchaseMoney(null, "GBP"), null);
});
