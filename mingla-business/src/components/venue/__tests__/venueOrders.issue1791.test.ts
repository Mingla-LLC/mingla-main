/**
 * Issue #1791 (#1767 Phase 3) — the Orders queue's pure logic, proven.
 *
 * These are the client halves of contracts whose server halves live in
 * `20270315001791_issue_1791_venue_order_queue_and_alerting.sql` and are
 * proven by `issue_1791_venue_order_queue_and_alerting.test.sql`. The two must
 * agree: the server is authoritative, and a client that offers a button the
 * server bounces is a busy-service error message nobody needed.
 *
 * # Fails-on-revert
 *  - Widen or narrow `isVenueOrderTransitionLegal` away from
 *    `pg_venue_order_transition_is_legal` → T-V1 goes RED.
 *  - Add an action that targets `refunded` → T-V2 goes RED (a fulfillment
 *    status of "refunded" is a money claim; only the refund rail may make it).
 *  - Drop `orders` from either `deriveVenueModules` branch, gate it on the
 *    reservations toggle, or order it after Settings → T-V7 goes RED.
 *  - Make the queue venue-scoped instead of brand-scoped → T-V4 goes RED.
 *  - Silence the escalation notice on the ticket → T-V6 goes RED.
 */

import { describe, expect, test } from "@jest/globals";

import {
  VENUE_ORDER_ACTION_TARGET,
  VENUE_ORDER_STATUS_PRESENTATION,
  VENUE_ORDER_VIEWS,
  availableZones,
  escalationNotice,
  filterVenueOrdersByScope,
  filterVenueOrdersForView,
  hasOpenRefundRequest,
  isVenueOrderTransitionLegal,
  legalActionsFor,
  liveOrderCount,
  sortForQueue,
  venueOrderDestinationLabel,
  waitingLabel,
  waitingMinutes,
  type VenueOrder,
  type VenueOrderFulfillmentStatus,
} from "../venueOrderViews";
import { VENUE_MODULES, deriveVenueModules, isBookingModule } from "../venueModules";
import { moduleSelfScrolls } from "../venueShellScroll";

const ORDER: VenueOrder = {
  id: "o1",
  brandId: "b1",
  venueId: "v1",
  sessionId: "s1",
  fulfillmentStatus: "placed",
  paymentStatus: "paid",
  source: "guest_qr",
  spotLabel: "Table 12",
  pickupCode: null,
  zone: "indoor",
  buyerName: "Amara",
  currency: "GBP",
  totalCents: 4500,
  tipCents: 500,
  itemCount: 2,
  lines: [],
  placedAt: new Date("2026-08-10T18:00:00Z").toISOString(),
  acknowledgedAt: null,
  acknowledgedByUserId: null,
  readyAt: null,
  deliveredAt: null,
  refundRequestedAt: null,
  refundDecision: null,
  escalationLevel: 0,
};

const make = (over: Partial<VenueOrder>): VenueOrder => ({ ...ORDER, ...over });

describe("issue #1791 — the ack state machine, mirrored", () => {
  test("T-V1 — the client map is EXACTLY pg_venue_order_transition_is_legal", () => {
    const legal: Array<[VenueOrderFulfillmentStatus, VenueOrderFulfillmentStatus]> = [
      ["placed", "acknowledged"],
      ["placed", "cancelled"],
      ["acknowledged", "in_progress"],
      ["acknowledged", "ready"],
      ["acknowledged", "cancelled"],
      ["in_progress", "ready"],
      ["in_progress", "cancelled"],
      ["ready", "delivered"],
      ["ready", "cancelled"],
      ["delivered", "refunded"],
    ];
    const illegal: Array<[VenueOrderFulfillmentStatus, VenueOrderFulfillmentStatus]> = [
      ["placed", "in_progress"],
      ["placed", "ready"],
      ["placed", "delivered"],
      ["acknowledged", "delivered"],
      ["acknowledged", "acknowledged"],
      ["ready", "in_progress"],
      ["delivered", "ready"],
      ["cancelled", "acknowledged"],
      ["refunded", "delivered"],
    ];
    for (const [from, to] of legal) {
      expect([from, to, isVenueOrderTransitionLegal(from, to)]).toEqual([from, to, true]);
    }
    for (const [from, to] of illegal) {
      expect([from, to, isVenueOrderTransitionLegal(from, to)]).toEqual([from, to, false]);
    }
  });

  test("T-V2 — no ACTION ever targets `refunded`; terminal states offer nothing", () => {
    // Refunding is a claim that money went back. The queue's buttons cannot
    // make that claim — only the refund rail can.
    expect(Object.values(VENUE_ORDER_ACTION_TARGET)).not.toContain("refunded");
    expect(legalActionsFor("cancelled")).toEqual([]);
    expect(legalActionsFor("refunded")).toEqual([]);
    // `delivered` has a legal transition (to refunded) but NO action for it.
    expect(legalActionsFor("delivered")).toEqual([]);
  });

  test("T-V3 — the only thing a NEW order offers is the acknowledgement (and a cancel)", () => {
    // If "Got it" were derivable from anything but a tap, this list would grow
    // something that happens by itself. It does not.
    expect(legalActionsFor("placed").sort()).toEqual(["acknowledge", "cancel"]);
    expect(legalActionsFor("acknowledged").sort()).toEqual(["cancel", "ready", "start"]);
    expect(legalActionsFor("ready").sort()).toEqual(["cancel", "deliver"]);
  });

  test("T-V3b — every status has a LABEL, so colour is never the only signal", () => {
    const statuses: VenueOrderFulfillmentStatus[] = [
      "placed", "acknowledged", "in_progress", "ready", "delivered", "cancelled", "refunded",
    ];
    for (const s of statuses) {
      expect(VENUE_ORDER_STATUS_PRESENTATION[s].label.length).toBeGreaterThan(0);
    }
  });
});

describe("issue #1791 — one queue per brand (D-3b)", () => {
  test("T-V4 — the queue holds every venue, and the filters narrow it", () => {
    const orders = [
      make({ id: "a", venueId: "v1", zone: "indoor" }),
      make({ id: "b", venueId: "v2", zone: null, spotLabel: "Room 204" }),
      make({ id: "c", venueId: "v1", zone: "terrace" }),
    ];
    // Unfiltered: a hotel's rooms and its restaurant's tables in ONE list,
    // because it is ONE kitchen.
    expect(filterVenueOrdersByScope(orders, null, null).map((o) => o.id))
      .toEqual(["a", "b", "c"]);
    expect(filterVenueOrdersByScope(orders, "v1", null).map((o) => o.id))
      .toEqual(["a", "c"]);
    expect(filterVenueOrdersByScope(orders, "v1", "terrace").map((o) => o.id))
      .toEqual(["c"]);
    expect(filterVenueOrdersByScope(orders, "v2", null).map((o) => o.id))
      .toEqual(["b"]);
    // Zones come from what is actually in the queue — never a hardcoded list.
    expect(availableZones(orders)).toEqual(["indoor", "terrace"]);
  });

  test("T-V5 — every ticket says where it is GOING", () => {
    expect(venueOrderDestinationLabel(make({ spotLabel: "Table 12" }))).toBe("Table 12");
    expect(venueOrderDestinationLabel(make({ spotLabel: "Room 204" }))).toBe("Room 204");
    expect(
      venueOrderDestinationLabel(
        make({ spotLabel: null, pickupCode: "42", buyerName: "Amara" }),
      ),
    ).toBe("COLLECT · 42 · Amara");
    expect(
      venueOrderDestinationLabel(make({ spotLabel: null, pickupCode: null, buyerName: null })),
    ).toBe("Counter");
  });

  test("T-V5b — the client label matches the PUSH label, character for character", () => {
    // The alert on a phone and the row on the queue must name the same place.
    // (Mirrors venueOrderDestinationLabel in _shared/venueOrderNotify.ts, whose
    // own proof is T-N1 in issue_1791_venue_order_alerting.test.ts.)
    expect(
      venueOrderDestinationLabel(make({ spotLabel: null, pickupCode: "42", buyerName: null })),
    ).toBe("COLLECT · 42");
    expect(
      venueOrderDestinationLabel(make({ spotLabel: "   ", pickupCode: null, buyerName: "Amara" })),
    ).toBe("Amara");
  });
});

describe("issue #1791 — the views and the honesty on the ticket", () => {
  test("T-V6 — an escalated, unacknowledged ticket SAYS SO, and rung 3 says it stops", () => {
    expect(escalationNotice(make({ escalationLevel: 0 }))).toBeNull();
    expect(escalationNotice(make({ escalationLevel: 1 }))).toMatch(/2\+ minutes/);
    // Rung 2 tells staff the guest has been told AND can walk away with their
    // money — the honesty half of D-7a.
    const rung2 = escalationNotice(make({ escalationLevel: 2 })) ?? "";
    expect(rung2).toMatch(/guest/i);
    expect(rung2).toMatch(/refund/i);
    // Rung 3 says the alerts stop. It never implies the order was cancelled or
    // that ordering was paused — Mingla does neither (D-7a/D-7b).
    const rung3 = escalationNotice(make({ escalationLevel: 3 })) ?? "";
    expect(rung3).toMatch(/last alert|still here/i);
    expect(rung3).not.toMatch(/paused|cancelled|refunded automatically/i);
    // Once a human has picked it up, the nagging text disappears entirely.
    expect(
      escalationNotice(make({ escalationLevel: 3, acknowledgedAt: "2026-08-10T18:05:00Z" })),
    ).toBeNull();
  });

  test("T-V6b — a refund REQUEST stays visible on the live queue, not hidden", () => {
    const asked = make({
      fulfillmentStatus: "acknowledged",
      refundRequestedAt: "2026-08-10T18:03:00Z",
    });
    const answered = make({
      fulfillmentStatus: "acknowledged",
      refundRequestedAt: "2026-08-10T18:03:00Z",
      refundDecision: "declined",
    });
    expect(hasOpenRefundRequest(asked)).toBe(true);
    expect(hasOpenRefundRequest(answered)).toBe(false);
    // It shows in Refunds AND stays in the live view: a guest asking for their
    // money back does not stop the kitchen holding the food.
    expect(filterVenueOrdersForView([asked], "refunds")).toHaveLength(1);
    expect(filterVenueOrdersForView([asked], "in_progress")).toHaveLength(1);
  });

  test("T-V6c — the views bucket the whole lifecycle with nothing falling through", () => {
    const all = [
      make({ id: "1", fulfillmentStatus: "placed" }),
      make({ id: "2", fulfillmentStatus: "acknowledged" }),
      make({ id: "3", fulfillmentStatus: "in_progress" }),
      make({ id: "4", fulfillmentStatus: "ready" }),
      make({ id: "5", fulfillmentStatus: "delivered" }),
      make({ id: "6", fulfillmentStatus: "cancelled" }),
      make({ id: "7", fulfillmentStatus: "refunded" }),
    ];
    const seen = new Set<string>();
    for (const v of VENUE_ORDER_VIEWS) {
      for (const o of filterVenueOrdersForView(all, v.id)) seen.add(o.id);
    }
    expect(seen.size).toBe(all.length);
    // "Live" is the four states somebody is still waiting on.
    expect(liveOrderCount(all)).toBe(4);
  });

  test("T-V6d — the queue reads newest-first: the thing nobody has looked at is on top", () => {
    const older = make({ id: "old", placedAt: "2026-08-10T18:00:00Z" });
    const newer = make({ id: "new", placedAt: "2026-08-10T18:09:00Z" });
    expect(sortForQueue([older, newer]).map((o) => o.id)).toEqual(["new", "old"]);
    // ...and sorting does not mutate the caller's array.
    const input = [older, newer];
    sortForQueue(input);
    expect(input.map((o) => o.id)).toEqual(["old", "new"]);
  });

  test("T-V6e — the wait renders in plain minutes, never negative", () => {
    const base = Date.parse("2026-08-10T18:00:00Z");
    expect(waitingMinutes("2026-08-10T18:00:00Z", base)).toBe(0);
    expect(waitingMinutes("2026-08-10T17:53:00Z", base)).toBe(7);
    // A clock skew must never render "-3 min ago" during service.
    expect(waitingMinutes("2026-08-10T18:03:00Z", base)).toBe(0);
    expect(waitingMinutes("not-a-date", base)).toBe(0);
    expect(waitingLabel(0)).toBe("Just now");
    expect(waitingLabel(1)).toBe("1 min ago");
    expect(waitingLabel(12)).toBe("12 min ago");
  });
});

describe("issue #1791 — the module registration", () => {
  test("T-V7 — Orders is COMMAND band in BOTH branches, Settings still last", () => {
    // A venue can take orders without taking reservations. Gating the surface
    // that watches money on the BOOKINGS toggle would hide it from exactly the
    // venues most likely to be using it.
    const off = deriveVenueModules(false);
    const on = deriveVenueModules(true);
    expect(off).toContain("orders");
    expect(on).toContain("orders");
    expect(isBookingModule("orders")).toBe(false);
    expect(VENUE_MODULES.orders.band).toBe("command");
    for (const mods of [off, on]) {
      expect(mods[mods.length - 1]).toBe("settings");
      expect(mods.indexOf("orders")).toBeGreaterThan(mods.indexOf("insights"));
      expect(mods.indexOf("orders")).toBeLessThan(mods.indexOf("settings"));
    }
  });

  test("T-V8 — Orders renders inside the shell's ScrollView (it owns no scroll)", () => {
    // Getting this wrong is the nested-same-axis-scroll bug: the module would
    // silently stop scrolling on a phone, mid-service.
    expect(moduleSelfScrolls("orders")).toBe(false);
  });

  test("T-V9 — the module has a label and a one-line job description", () => {
    expect(VENUE_MODULES.orders.label).toBe("Orders");
    expect(VENUE_MODULES.orders.summary.length).toBeGreaterThan(10);
  });
});
