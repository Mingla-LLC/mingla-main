import type { Reservation } from "../../../types/venueReservation";
import {
  calendarMonth,
  calendarWeek,
  groupReservationsByVenueDay,
  projectMonthDay,
  projectReservations,
  reservationScopeCounts,
  resolveVenueTimeZone,
  stableSortReservations,
  venueDayKeyForInstant,
} from "../reservationCalendarModel";

const reservation = (
  id: string,
  reservedFor: string,
  status: Reservation["status"] = "confirmed",
  createdAt = "2026-08-01T00:00:00.000Z",
): Reservation => ({
  id,
  brandId: "brand",
  venueId: "venue",
  placePoolId: null,
  tableId: "table-1",
  reservedFor,
  partySize: 4,
  status,
  source: "mingla",
  createdVia: "consumer",
  guestName: `Guest ${id}`,
  guestPhoneE164: null,
  guestEmail: null,
  consumerUserId: null,
  occasion: null,
  guestNotes: null,
  tags: [],
  feeCents: null,
  feeCurrency: null,
  paymentStatus: "none",
  createdAt,
  refund: null,
});

describe("issue #2737 venue-time reservation calendar model", () => {
  it("classifies midnight and DST-boundary instants in the venue timezone", () => {
    expect(
      venueDayKeyForInstant("2026-03-08T04:30:00.000Z", "America/New_York"),
    ).toBe("2026-03-07");
    expect(
      venueDayKeyForInstant("2026-03-08T05:30:00.000Z", "America/New_York"),
    ).toBe("2026-03-08");
    expect(
      venueDayKeyForInstant("2026-08-27T23:30:00.000Z", "Africa/Lagos"),
    ).toBe("2026-08-28");
    expect(resolveVenueTimeZone("Not/AZone")).toEqual({
      timeZone: "UTC",
      degraded: true,
    });
  });

  it("builds a Monday week and an exact 42-cell month grid", () => {
    const week = calendarWeek("2026-08-27");
    expect(week.days).toHaveLength(7);
    expect(week.startKey).toBe("2026-08-24");
    expect(week.endKey).toBe("2026-08-30");

    const month = calendarMonth("2026-08-27");
    expect(month.days).toHaveLength(42);
    expect(month.startKey).toBe("2026-07-27");
    expect(month.endKey).toBe("2026-09-06");
    expect(month.days.filter((day) => day.inAnchorMonth)).toHaveLength(31);
  });

  it("sorts deterministically, groups by venue day, and counts orthogonal statuses", () => {
    const rows = [
      reservation("late", "2026-08-29T19:00:00.000Z"),
      reservation("wait", "2026-08-28T14:00:00.000Z", "waitlisted"),
      reservation("cancel", "2026-08-28T15:00:00.000Z", "cancelled_by_guest"),
      reservation("early-b", "2026-08-28T13:00:00.000Z", "confirmed", "2026-08-02T00:00:00.000Z"),
      reservation("early-a", "2026-08-28T13:00:00.000Z", "confirmed", "2026-08-01T00:00:00.000Z"),
    ];
    expect(stableSortReservations(rows).map((row) => row.id)).toEqual([
      "early-a",
      "early-b",
      "wait",
      "cancel",
      "late",
    ]);

    const range = calendarWeek("2026-08-28");
    const counts = reservationScopeCounts(rows, range, "Africa/Lagos");
    expect(counts).toEqual({
      active: 3,
      waitlist: 1,
      completed: 0,
      no_shows: 0,
      canceled: 1,
    });
    const active = projectReservations(rows, range, "active", "Africa/Lagos");
    const grouped = groupReservationsByVenueDay(active, "Africa/Lagos");
    expect(grouped.get("2026-08-28")?.map((row) => row.id)).toEqual([
      "early-a",
      "early-b",
    ]);
    expect(grouped.get("2026-08-29")?.map((row) => row.id)).toEqual(["late"]);
  });

  it("preserves every month overflow booking behind an accurate action", () => {
    const rows = [
      reservation("one", "2026-08-28T13:00:00.000Z"),
      reservation("two", "2026-08-28T14:00:00.000Z"),
      reservation("three", "2026-08-28T15:00:00.000Z"),
      reservation("four", "2026-08-28T16:00:00.000Z"),
    ];
    const projection = projectMonthDay(rows, 2);
    expect(projection.visible.map((row) => row.id)).toEqual(["one"]);
    expect(projection.overflowCount).toBe(3);
  });
});
