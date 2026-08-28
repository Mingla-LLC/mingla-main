import type { Reservation } from "../../../types/venueReservation";
import {
  calendarWeek,
  projectMonthDay,
  projectReservations,
  reservationScopeCounts,
  venueDayKeyForInstant,
} from "../reservationCalendarModel";

const reservation = (
  id: string,
  reservedFor: string,
  status: Reservation["status"] = "confirmed",
): Reservation => ({
  id,
  brandId: "brand",
  venueId: "venue",
  placePoolId: null,
  tableId: null,
  reservedFor,
  partySize: 2,
  status,
  source: "mingla",
  createdVia: "consumer",
  guestName: null,
  guestPhoneE164: null,
  guestEmail: null,
  consumerUserId: null,
  occasion: null,
  guestNotes: null,
  tags: [],
  feeCents: null,
  feeCurrency: null,
  paymentStatus: "none",
  createdAt: "2026-01-01T00:00:00.000Z",
  refund: null,
});

describe("issue #2737 tester adversarial venue-time projection", () => {
  it("projects the same UTC instant into opposite venue days at the date line", () => {
    const instant = "2026-01-04T11:30:00.000Z";
    const row = reservation("date-line", instant);

    expect(venueDayKeyForInstant(instant, "Pacific/Kiritimati")).toBe(
      "2026-01-05",
    );
    expect(venueDayKeyForInstant(instant, "Pacific/Pago_Pago")).toBe(
      "2026-01-04",
    );

    const januaryFifth = calendarWeek("2026-01-05");
    expect(
      projectReservations([row], januaryFifth, "active", "Pacific/Kiritimati"),
    ).toEqual([row]);
    expect(
      projectReservations([row], januaryFifth, "active", "Pacific/Pago_Pago"),
    ).toEqual([]);
  });

  it("keeps both cancellation authorities distinct from no-show counts", () => {
    const range = calendarWeek("2026-01-02");
    const rows = [
      reservation("guest-cancel", "2026-01-02T12:00:00.000Z", "cancelled_by_guest"),
      reservation("venue-cancel", "2026-01-02T13:00:00.000Z", "cancelled_by_venue"),
      reservation("no-show", "2026-01-02T14:00:00.000Z", "no_show"),
    ];

    expect(reservationScopeCounts(rows, range, "UTC")).toEqual({
      active: 0,
      waitlist: 0,
      completed: 0,
      no_shows: 1,
      canceled: 2,
    });
  });

  it("accounts for every booking in a 50-record month overflow", () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      reservation(
        `dense-${String(index).padStart(2, "0")}`,
        `2026-01-02T${String(12 + Math.floor(index / 60)).padStart(2, "0")}:${String(
          index % 60,
        ).padStart(2, "0")}:00.000Z`,
      ),
    );
    const projection = projectMonthDay(rows, 2);

    expect(projection.visible).toHaveLength(1);
    expect(projection.visible[0]?.id).toBe("dense-00");
    expect(projection.overflowCount).toBe(49);
    expect(projection.visible.length + projection.overflowCount).toBe(rows.length);
  });
});
