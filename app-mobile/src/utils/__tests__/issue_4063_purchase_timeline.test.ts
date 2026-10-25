import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPurchaseTimeline,
  type PurchaseSources,
} from "../purchaseTimeline.ts";

const NOW = new Date("2026-10-24T18:00:00.000Z");

function sources(): PurchaseSources {
  return {
    orders: [
      {
        id: "tonight",
        eventId: "event-tonight",
        eventTitle: "Tonight Live",
        eventType: "event",
        brandName: "Mingla",
        coverMediaUrl: null,
        startAt: "2026-10-24T19:30:00.000Z",
        endAt: "2026-10-24T22:00:00.000Z",
        timezone: "Europe/London",
        venueLine: "The Venue",
        paymentStatus: "paid",
        ticketCount: 2,
        validTicketCount: 2,
        source: "online_checkout",
        currency: "GBP",
        buyerTotalCents: 4200,
        refundedAmountCents: 0,
        raw: {},
      },
      {
        id: "next-month",
        eventId: "event-next",
        eventTitle: "November Night",
        eventType: "event",
        brandName: "Mingla",
        coverMediaUrl: null,
        startAt: "2026-11-02T20:00:00.000Z",
        endAt: "2026-11-02T23:00:00.000Z",
        timezone: "Europe/London",
        venueLine: "The Venue",
        paymentStatus: "paid",
        ticketCount: 1,
        validTicketCount: 1,
        source: "online_checkout",
        currency: "GBP",
        buyerTotalCents: 2000,
        refundedAmountCents: 0,
        raw: {},
      },
      {
        id: "refunded-future",
        eventId: "event-refund",
        eventTitle: "Refunded Future",
        eventType: "event",
        brandName: "Mingla",
        coverMediaUrl: null,
        startAt: "2026-11-03T20:00:00.000Z",
        endAt: "2026-11-03T23:00:00.000Z",
        timezone: "Europe/London",
        venueLine: "The Venue",
        paymentStatus: "refunded",
        ticketCount: 1,
        validTicketCount: 0,
        source: "online_checkout",
        currency: "GBP",
        buyerTotalCents: 2500,
        refundedAmountCents: 2500,
        raw: {},
      },
    ],
    rsvps: [],
    reservations: [{
      id: "cancelled-reservation",
      title: "Dinner",
      coverMediaUrl: null,
      startAt: "2026-11-04T20:00:00.000Z",
      timezone: "Europe/London",
      venueLine: "Venue",
      status: "cancelled",
      partySize: 2,
      feeCents: 1000,
      currency: "GBP",
      refundedAmountCents: 1000,
      raw: {},
    }],
    venueOrders: [{
      id: "meal",
      title: "Dinner receipt",
      coverMediaUrl: null,
      createdAt: "2026-10-24T20:00:00.000Z",
      timezone: "Europe/London",
      venueLine: "Venue",
      paymentStatus: "paid",
      totalCents: 3500,
      refundedAmountCents: 0,
      currency: "GBP",
      raw: {},
    }],
  };
}

test("groups Tonight and future months in soonest-first order", () => {
  const result = buildPurchaseTimeline(sources(), NOW, "en-GB");
  assert.deepEqual(result.upcoming.map((group) => group.title), ["Tonight", "November"]);
  assert.deepEqual(
    result.upcoming.flatMap((group) => group.items.map((item) => item.id)),
    ["tonight", "next-month"],
  );
});

test("keeps refunded, cancelled, and food receipts in Past", () => {
  const result = buildPurchaseTimeline(sources(), NOW, "en-GB");
  const past = result.past.flatMap((group) => group.items);
  assert.deepEqual(past.map((item) => item.id), [
    "cancelled-reservation",
    "refunded-future",
    "meal",
  ]);
  assert.equal(past.find((item) => item.id === "refunded-future")?.refundedAmountCents, 2500);
});

test("uses effective end so an in-progress event remains Upcoming", () => {
  const input = sources();
  input.orders[0] = {
    ...input.orders[0],
    startAt: "2026-10-24T16:00:00.000Z",
    endAt: "2026-10-24T19:00:00.000Z",
  };
  const result = buildPurchaseTimeline(input, NOW);
  assert.equal(result.upcoming[0]?.items[0]?.id, "tonight");
});
