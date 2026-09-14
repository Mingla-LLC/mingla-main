/**
 * issue #3313 — recurring events: every date, a chosen night, capacity per night.
 *
 * These are the ORGANISER-side and copy halves. The database half (publish,
 * the live edit, checkout, finalize, the public reader, the tier editor) is
 * executed by supabase/migrations/__tests__/
 * issue_3313_recurring_event_occurrences.implementor.happy.pg17.test.sql.
 *
 * FAILS ON REVERT:
 *   - busiestNightSoldByTicketType counting the run's total (or dropping
 *     no-night passes) fails the per-night tests;
 *   - the capacity guard reading soldCountByTier instead of the per-night floor
 *     fails "a recurring event may lower capacity to its busiest night";
 *   - the sales summary dividing a run total by a per-night capacity fails the
 *     summary test;
 *   - the public date display falling back to the draft formatter for
 *     recurring events prints "Recurring (incomplete)" and fails;
 *   - the toast ignoring the server count fails the toast test.
 */
import { describe, expect, test } from "@jest/globals";

import {
  busiestNightSoldByTicketType,
  isPerNightCapacity,
} from "../perNightCapacity";
import { formatEventLiveToast } from "../eventPublishCopy";
import { buildEventSalesSummary } from "../eventSalesSummary";
import { resolvePublicEventDateDisplay } from "../eventDateDisplay";
import { validateLiveEventFieldUpdate } from "../publishedEventEditGuards";
import { buildSoldCountContextFromOrders } from "../../services/eventOrdersService";
import type { LiveEvent } from "../../store/liveEventStore";
import type { OrderRecord } from "../../store/orderStore";
import type { TicketStub } from "../../store/draftEventStore";

const EVENT = "evt-3313";
const TABLE = "tt-table";
const BAR = "tt-bar";
const TUE1 = "night-1";
const TUE2 = "night-2";
const TUE3 = "night-3";

const pass = (
  ticketTypeId: string,
  eventDateIds: string[],
  status = "valid",
) => ({ ticketId: `p-${Math.random()}`, ticketTypeId, eventDateIds, status, usedAt: null });

const order = (
  ticketDays: ReturnType<typeof pass>[],
  status: OrderRecord["status"] = "paid",
  eventId = EVENT,
): OrderRecord =>
  ({
    id: `o-${Math.random()}`,
    eventId,
    brandId: "b",
    buyer: { name: "Guest", email: "g@example.test", phone: "", marketingOptIn: false },
    lines: ticketDays.map((d) => ({
      orderLineItemId: `l-${Math.random()}`,
      ticketTypeId: d.ticketTypeId,
      ticketNameAtPurchase: "Table Seat",
      unitPriceGbpAtPurchase: 0,
      unitPriceAtPurchase: 0,
      quantity: 1,
      refundedQuantity: 0,
      refundedAmountGbp: 0,
    })),
    ticketDays,
    totalGbpAtPurchase: 0,
    currency: null,
    paymentMethod: "free",
    paidAt: "2026-09-14T00:00:00.000Z",
    status,
    refundedAmountGbp: 0,
    refunds: [],
  }) as unknown as OrderRecord;

describe("issue #3313 — capacity is per night on a recurring event", () => {
  test("only a recurring event has per-night capacity", () => {
    expect(isPerNightCapacity("recurring")).toBe(true);
    expect(isPerNightCapacity("multi_date")).toBe(false);
    expect(isPerNightCapacity("single")).toBe(false);
    expect(isPerNightCapacity(null)).toBe(false);
  });

  test("busiest night, per ticket type: 3 on Tue 1 and 1 on Tue 2 is 3, not the run's 4", () => {
    const orders = [
      order([pass(TABLE, [TUE1]), pass(TABLE, [TUE1]), pass(TABLE, [TUE1])]),
      order([pass(TABLE, [TUE2]), pass(BAR, [TUE3])]),
    ];
    expect(busiestNightSoldByTicketType(orders, EVENT)).toEqual({
      [TABLE]: 3,
      [BAR]: 1,
    });
  });

  test("a pass with no night admits any night, so it counts on EVERY night (the server's rule)", () => {
    const orders = [order([pass(TABLE, [TUE1]), pass(TABLE, [TUE2]), pass(TABLE, [])])];
    expect(busiestNightSoldByTicketType(orders, EVENT)[TABLE]).toBe(2);
  });

  test("void and refunded passes, other events and untyped legacy records hold no place", () => {
    const orders = [
      order([pass(TABLE, [TUE1], "refunded"), pass(TABLE, [TUE1], "void")]),
      order([pass(TABLE, [TUE1])], "paid", "another-event"),
      order([{ ticketId: "legacy", eventDateIds: [TUE1], status: "valid", usedAt: null } as never]),
      order([pass(TABLE, [TUE2], "used"), pass(TABLE, [TUE2], "transferred")]),
    ];
    expect(busiestNightSoldByTicketType(orders, EVENT)).toEqual({ [TABLE]: 2 });
  });

  test("a two-night pass (all_days) takes one place on each of its nights", () => {
    const orders = [order([pass(TABLE, [TUE1, TUE2])]), order([pass(TABLE, [TUE2])])];
    expect(busiestNightSoldByTicketType(orders, EVENT)[TABLE]).toBe(2);
  });

  test("the sold-count context carries the per-night floor only when asked", () => {
    const orders = [order([pass(TABLE, [TUE1]), pass(TABLE, [TUE2]), pass(TABLE, [TUE2])])];
    const perNight = buildSoldCountContextFromOrders(orders, { eventId: EVENT });
    expect(perNight.capacityFloorByTier).toEqual({ [TABLE]: 2 });
    expect(perNight.soldCountByTier[TABLE]).toBe(3);
    expect(buildSoldCountContextFromOrders(orders).capacityFloorByTier).toBeUndefined();
  });
});

const ticket = (patch: Partial<TicketStub> = {}): TicketStub =>
  ({
    id: TABLE,
    name: "Table Seat",
    description: null,
    priceGbp: 0,
    currency: null,
    isFree: true,
    isUnlimited: false,
    capacity: 60,
    visibility: "public",
    displayOrder: 0,
    approvalRequired: false,
    passwordProtected: false,
    password: null,
    allowTransfers: true,
    availableAt: "online",
    saleStartAt: null,
    saleEndAt: null,
    minPurchaseQty: 1,
    maxPurchaseQty: null,
    waitlistEnabled: false,
    ...patch,
  }) as TicketStub;

describe("issue #3313 — the organiser's capacity floor on a recurring event", () => {
  const liveEvent = {
    id: EVENT,
    whenMode: "recurring",
    date: "2026-10-13",
    doorsOpen: "19:00",
    endsAt: "23:00",
    timezone: "America/New_York",
    recurrenceRule: { preset: "weekly", byDay: "TU", termination: { kind: "count", count: 8 } },
    multiDates: null,
    tickets: [ticket()],
  } as unknown as LiveEvent;

  test("a recurring event may lower capacity to its busiest night (60 sold over 3 nights, 25 at most per night)", () => {
    const result = validateLiveEventFieldUpdate(
      liveEvent,
      { tickets: [ticket({ capacity: 25 })] },
      { soldCountByTier: { [TABLE]: 60 }, soldCountForEvent: 60, capacityFloorByTier: { [TABLE]: 25 } },
      "Lowering capacity per night",
    );
    expect(result.ok).toBe(true);
  });

  test("...but never below the busiest night", () => {
    const result = validateLiveEventFieldUpdate(
      liveEvent,
      { tickets: [ticket({ capacity: 24 })] },
      { soldCountByTier: { [TABLE]: 60 }, soldCountForEvent: 60, capacityFloorByTier: { [TABLE]: 25 } },
      "Lowering capacity per night",
    );
    expect(result).toMatchObject({ ok: false, reason: "capacity_below_sold" });
  });

  test("every other event keeps the sold-count floor", () => {
    const result = validateLiveEventFieldUpdate(
      { ...liveEvent, whenMode: "single" } as LiveEvent,
      { tickets: [ticket({ capacity: 25 })] },
      { soldCountByTier: { [TABLE]: 60 }, soldCountForEvent: 60 },
      "Lowering the shared capacity",
    );
    expect(result).toMatchObject({ ok: false, reason: "capacity_below_sold" });
  });
});

describe("issue #3313 — what the organiser reads", () => {
  test("a recurring event's summary never divides the run's sold count by a per-night capacity", () => {
    const orders = [
      order([pass(TABLE, [TUE1]), pass(TABLE, [TUE2])]),
      order([pass(TABLE, [TUE3])]),
    ];
    const perNight = buildEventSalesSummary({
      eventId: EVENT,
      tickets: [ticket({ capacity: 60 })],
      orders,
      capacityPerNight: true,
    });
    expect(perNight.soldLabel).toBe("3 sold · 60 per night");
    expect(perNight.finiteCapacity).toBeNull();

    const shared = buildEventSalesSummary({
      eventId: EVENT,
      tickets: [ticket({ capacity: 60 })],
      orders,
    });
    expect(shared.soldLabel).toBe("3 / 60");
    expect(shared.finiteCapacity).toBe(60);
  });

  test("the live toast names how many dates the server created", () => {
    expect(formatEventLiveToast("Tuesday Night Jazz", 8)).toBe(
      "Tuesday Night Jazz is live with 8 dates.",
    );
    expect(formatEventLiveToast("Launch", 1)).toBe("Launch is live.");
    expect(formatEventLiveToast("Launch", undefined)).toBe("Launch is live.");
  });
});

describe("issue #3313 — the public page labels a recurring event from its real dates", () => {
  const occurrence = (id: string, startAt: string, endAt: string) => ({
    id,
    startAt,
    endAt,
    timezone: "America/New_York",
  });
  const occurrences = [
    occurrence(TUE1, "2026-10-13T23:00:00.000Z", "2026-10-14T03:00:00.000Z"),
    occurrence(TUE2, "2026-10-20T23:00:00.000Z", "2026-10-21T03:00:00.000Z"),
    occurrence(TUE3, "2026-10-27T23:00:00.000Z", "2026-10-28T03:00:00.000Z"),
  ];
  const publicEvent = (patch: Record<string, unknown>) =>
    ({
      whenMode: "recurring",
      date: "2026-10-13",
      doorsOpen: "19:00",
      endsAt: "23:00",
      timezone: "America/New_York",
      recurrenceRule: null,
      multiDates: null,
      ...patch,
    }) as Parameters<typeof resolvePublicEventDateDisplay>[0];

  test("with its rule: 'Every Tuesday · 3 dates' over the real dates", () => {
    const display = resolvePublicEventDateDisplay(
      publicEvent({
        recurrenceRule: { preset: "weekly", byDay: "TU", termination: { kind: "count", count: 8 } },
      }),
      occurrences,
    );
    expect(display.dateSubline).toBe("Every Tuesday · 3 dates");
    expect(display.datesList).toHaveLength(3);
  });

  test("without a rule it is never 'Recurring (incomplete)' once real dates exist", () => {
    const display = resolvePublicEventDateDisplay(publicEvent({}), occurrences);
    expect(display.dateSubline).not.toBe("Recurring (incomplete)");
    expect(display.dateSubline).toMatch(/^3 dates · first /);
  });

  test("a recurring event the reader reports as a day-choice event (multi_date) still names its rule", () => {
    const display = resolvePublicEventDateDisplay(
      publicEvent({
        whenMode: "multi_date",
        recurrenceRule: { preset: "weekly", byDay: "TU", termination: { kind: "never" } },
      }),
      occurrences,
    );
    expect(display.dateSubline).toBe("Every Tuesday · 3 dates");
  });

  test("a single-date event is untouched", () => {
    const display = resolvePublicEventDateDisplay(
      publicEvent({ whenMode: "single" }),
      occurrences,
    );
    expect(display.dateSubline).toBeNull();
  });
});
